import test from 'node:test';
import assert from 'node:assert/strict';

import { memoryStore, createStore } from '../lib/store.js';
import { createPool } from '../lib/pool.js';
import { powDigest, leadingZeroBits, verifyPow } from '../lib/pow.js';
import { coarseKeys, sanitizeKey } from '../lib/keys.js';
import { validateCard, validatePubkey, validateBlob } from '../lib/validate.js';
import { POW_BITS, K_FLOOR, JOIN_PER_IP } from '../lib/config.js';

// ---------------------------------------------------------------- 工具

// powDigest 走 WebCrypto，是 async 的；解一次缓存起来复用（协议本身没有 challenge，
// 同一个 nonce 可以反复用，它只是抬高批量建号成本）。
let cachedNonce = null;
async function solvePow(bits = POW_BITS) {
  if (bits === POW_BITS && cachedNonce) return cachedNonce;
  for (let i = 0; i < 2_000_000; i += 1) {
    const nonce = 'n' + i.toString(36);
    if (leadingZeroBits(await powDigest(nonce)) >= bits) {
      if (bits === POW_BITS) cachedNonce = nonce;
      return nonce;
    }
  }
  throw new Error('pow 求解失败');
}

let seq = 0;
function makeCard(overrides = {}) {
  seq += 1;
  return {
    v: 2,
    k: 'mirroself-card',
    id: 'card' + seq + 'aaaa',
    n: '测试者' + seq,
    p: { 科技: 15 },
    g: { 装机: 15, 硬件: 12 },
    q: 60,
    c: 300,
    hl: [],
    ts: 1794640000,
    s: 'salt' + seq,
    ...overrides,
  };
}

const PUBKEY = 'A'.repeat(43);

function freshPool() {
  const store = createStore(memoryStore());
  return { pool: createPool(store), store };
}

async function joinAs(pool, card, extra = {}) {
  const res = await pool.join({ card, pubkey: PUBKEY, pow: await solvePow(), ...extra });
  assert.equal(res.status, 200, 'join 应该成功：' + JSON.stringify(res));
  return res.token;
}

// ---------------------------------------------------------------- 粗键

test('粗键：取最高分区 + 最高标签，标签接近时再加一个标签对', () => {
  const keys = coarseKeys({ p: { 科技: 15, 音乐: 3 }, g: { 装机: 15, 硬件: 12, 水冷: 2 } });
  assert.deepEqual(keys, ['p:科技', 't:装机', 'c:装机+硬件']);
});

test('粗键：第二标签权重明显偏低时不生成标签对', () => {
  const keys = coarseKeys({ p: { 科技: 15 }, g: { 装机: 15, 水冷: 2 } });
  assert.deepEqual(keys, ['p:科技', 't:装机']);
});

test('粗键：空名片不产生键', () => {
  assert.deepEqual(coarseKeys({}), []);
  assert.deepEqual(coarseKeys(null), []);
});

test('键名白名单：非法字符被拒绝', () => {
  assert.equal(sanitizeKey('p:科技'), 'p:科技');
  assert.equal(sanitizeKey('t:显卡'), 't:显卡');
  assert.equal(sanitizeKey('p:科技\nSET hacked'), '');
  assert.equal(sanitizeKey('x:科技'), '');
  assert.equal(sanitizeKey('p:' + 'a'.repeat(100)), '');
});

// ---------------------------------------------------------------- 名片校验

test('名片校验：接受合法 v2 名片', () => {
  assert.equal(validateCard(makeCard()), '');
});

test('名片校验：拒绝旧版本、带指纹、质量分过低', () => {
  assert.equal(validateCard(makeCard({ v: 1 })), 'card-version');
  assert.equal(validateCard(makeCard({ h: 'deadbeef' })), 'card-fingerprint-not-allowed');
  assert.equal(validateCard(makeCard({ q: 3 })), 'card-too-thin');
  assert.equal(validateCard(makeCard({ g: { 装机: 99 } })), 'card-tags');
});

test('名片校验：超大名片被拒绝（防塞爆）', () => {
  const big = makeCard();
  big.g = {};
  for (let i = 0; i < 40; i += 1) big.g['tag' + i] = 5;
  assert.equal(validateCard(big), 'card-tags');
});

test('公钥与 blob 的字符集校验', () => {
  assert.equal(validatePubkey(PUBKEY), '');
  assert.equal(validatePubkey('short'), 'pubkey-length');
  assert.equal(validatePubkey('!!!'.repeat(20)), 'pubkey-charset');
  assert.equal(validateBlob('A'.repeat(50)), '');
  assert.equal(validateBlob('x'), 'blob-size');
});

// ---------------------------------------------------------------- 工作量证明

test('PoW：正确解通过，错误解不通过，位数不足不通过', async () => {
  const nonce = await solvePow();
  assert.equal(await verifyPow(nonce), true);
  assert.equal(await verifyPow('definitely-not-a-solution'), false);
  assert.equal(await verifyPow(''), false);
  assert.equal(await verifyPow(nonce, POW_BITS + 12), false, '位数要求更高时同一个解不够');
});

// ---------------------------------------------------------------- 加入

test('加入：返回 token，并写入倒排桶', async () => {
  const { pool, store } = freshPool();
  const token = await joinAs(pool, makeCard());
  assert.ok(token.length >= 8);
  const members = await store.smembers('band:p:科技');
  assert.deepEqual(members, [token]);
});

test('加入：PoW 不合法被拒绝', async () => {
  const { pool } = freshPool();
  const res = await pool.join({ card: makeCard(), pubkey: PUBKEY, pow: 'nope' });
  assert.equal(res.status, 400);
  assert.equal(res.error, 'pow-invalid');
});

test('加入：同一 IP 建号数超限后返回 429', async () => {
  const { pool } = freshPool();
  for (let i = 0; i < JOIN_PER_IP; i += 1) await joinAs(pool, makeCard(), { ip: '9.9.9.9' });
  const res = await pool.join({ card: makeCard(), pubkey: PUBKEY, pow: await solvePow(), ip: '9.9.9.9' });
  assert.equal(res.status, 429);
  assert.equal(res.error, 'rate-join');
});

// ---------------------------------------------------------------- 召回

test('召回：同桶的人能被召回，自己不在结果里', async () => {
  const { pool } = freshPool();
  const me = await joinAs(pool, makeCard());
  const others = [];
  for (let i = 0; i < K_FLOOR; i += 1) others.push(await joinAs(pool, makeCard()));

  const res = await pool.candidates({ token: me });
  assert.equal(res.status, 200);
  const tokens = res.items.map((x) => x.token);
  assert.equal(tokens.includes(me), false, '不能把自己返回给自己');
  for (const t of others) assert.ok(tokens.includes(t), '同桶的人都该被召回');
  assert.ok(res.items.every((x) => x.pubkey === PUBKEY), '候选必须带公钥，否则无法加密联系卡');
});

test('k-匿名：桶内人数不足时整桶不返回', async () => {
  const { pool } = freshPool();
  const me = await joinAs(pool, makeCard());
  // 只再加 2 个人，总数 3 < K_FLOOR
  await joinAs(pool, makeCard());
  await joinAs(pool, makeCard());

  const res = await pool.candidates({ token: me });
  assert.equal(res.items.length, 0);
  assert.ok(res.skippedBuckets > 0, '应该记录跳过的桶数');
});

test('召回：不同口味的人不会出现在候选里', async () => {
  const { pool } = freshPool();
  const me = await joinAs(pool, makeCard());
  for (let i = 0; i < K_FLOOR; i += 1) {
    await joinAs(pool, makeCard({ p: { 音乐: 15 }, g: { 混音: 15, 编曲: 12 } }));
  }
  const res = await pool.candidates({ token: me });
  assert.equal(res.items.length, 0, '科技桶和音乐桶不该串味');
});

test('召回：未知 token 返回 404', async () => {
  const { pool } = freshPool();
  const res = await pool.candidates({ token: 'aaaaaaaaaaaa' });
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------- 双向同意

test('双向同意：只有一方时 pending，双方都发起才 mutual 并交出加密联系卡', async () => {
  const { pool } = freshPool();
  const a = await joinAs(pool, makeCard());
  const b = await joinAs(pool, makeCard());

  const first = await pool.interest({ token: a, to: b, blob: 'BLOB_A_TO_B' });
  assert.equal(first.state, 'pending');

  const bInbox = await pool.inbox({ token: b });
  assert.equal(bInbox.items.length, 1);
  assert.equal(bInbox.items[0].from, a);
  assert.equal(bInbox.items[0].mutual, false);
  assert.equal(bInbox.items[0].blob, null, '单方面同意时不能交出联系卡');

  const second = await pool.interest({ token: b, to: a, blob: 'BLOB_B_TO_A' });
  assert.equal(second.state, 'mutual');

  const bInbox2 = await pool.inbox({ token: b });
  assert.equal(bInbox2.items[0].mutual, true);
  assert.equal(bInbox2.items[0].blob, 'BLOB_A_TO_B', 'B 应该拿到 A 的加密联系卡');

  const aInbox = await pool.inbox({ token: a });
  assert.equal(aInbox.items[0].blob, 'BLOB_B_TO_A', 'A 应该拿到 B 的加密联系卡');
});

test('双向同意：不能对自己发起', async () => {
  const { pool } = freshPool();
  const a = await joinAs(pool, makeCard());
  const res = await pool.interest({ token: a, to: a, blob: 'BLOB_SELF_X' });
  assert.equal(res.status, 400);
  assert.equal(res.error, 'self-interest');
});

test('屏蔽：被屏蔽的人从候选移除，且请求被拒', async () => {
  const { pool } = freshPool();
  const me = await joinAs(pool, makeCard());
  const others = [];
  for (let i = 0; i < K_FLOOR; i += 1) others.push(await joinAs(pool, makeCard()));
  const target = others[0];

  await pool.block({ token: me, target });

  const cand = await pool.candidates({ token: me });
  assert.equal(cand.items.map((x) => x.token).includes(target), false);

  const res = await pool.interest({ token: target, to: me, blob: 'BLOB_BLOCKED_X' });
  assert.equal(res.status, 403);
  assert.equal(res.error, 'blocked');
});

// ---------------------------------------------------------------- 退出

test('退出：从倒排桶里彻底移除，之后不再被召回', async () => {
  const { pool, store } = freshPool();
  const me = await joinAs(pool, makeCard());
  const others = [];
  for (let i = 0; i < K_FLOOR; i += 1) others.push(await joinAs(pool, makeCard()));

  await pool.leave({ token: others[0] });

  const members = await store.smembers('band:p:科技');
  assert.equal(members.includes(others[0]), false, '桶里不能再有这个人');
  assert.equal(await store.getJson(`tok:${others[0]}`), null, '记录要真的删掉');

  const cand = await pool.candidates({ token: me });
  assert.equal(cand.items.map((x) => x.token).includes(others[0]), false);
});

test('健康检查报告存储类型', async () => {
  const { pool } = freshPool();
  const res = await pool.health();
  assert.equal(res.ok, true);
  assert.equal(res.storage, 'memory');
});
