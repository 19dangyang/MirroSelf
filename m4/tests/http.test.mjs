import test from 'node:test';
import assert from 'node:assert/strict';

// 必须在 import 应用之前设置：config.js 在模块加载时读环境变量。
// 这些用例会连续建十几个号，默认的"每 IP 3 个"会把自己限住。
process.env.MIRROSELF_JOIN_PER_IP = '10000';

const { listenRandom } = await import('../lib/app.js');
const { powDigest, leadingZeroBits } = await import('../lib/pow.js');
const { POW_BITS, K_FLOOR } = await import('../lib/config.js');

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
    id: 'httpcard' + seq,
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

const PUBKEY = 'B'.repeat(43);
const post = (base, path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('HTTP 层：health / join / candidates / leave 全链路（含中文名片）', async (t) => {
  const app = await listenRandom();
  t.after(() => app.close());

  const health = await (await fetch(app.url + '/api/v1/health')).json();
  assert.equal(health.ok, true);

  // 中文分区与标签：这正是在 PowerShell + curl 下会被编码弄坏的部分
  const joinRes = await post(app.url, '/api/v1/join', { card: makeCard(), pubkey: PUBKEY, pow: await solvePow() });
  assert.equal(joinRes.status, 200);
  const join = await joinRes.json();
  assert.ok(join.token);

  const candRes = await post(app.url, '/api/v1/candidates', { token: join.token });
  assert.equal(candRes.status, 200);
  const cand = await candRes.json();
  assert.equal(cand.items.length, 0, '只有自己一个人在池子里');

  const leaveRes = await post(app.url, '/api/v1/leave', { token: join.token });
  assert.equal(leaveRes.status, 200);

  const again = await post(app.url, '/api/v1/candidates', { token: join.token });
  assert.equal(again.status, 404, '退出后 token 立即失效');
});

test('HTTP 层：CORS 预检与未知路径', async (t) => {
  const app = await listenRandom();
  t.after(() => app.close());

  const preflight = await fetch(app.url + '/api/v1/join', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');

  const missing = await fetch(app.url + '/api/v1/nope');
  assert.equal(missing.status, 404);
});

test('HTTP 层：/match 只回公钥与分档，不回名片内容', async (t) => {
  const app = await listenRandom();
  t.after(() => app.close());
  const join = async (card) =>
    (await (await post(app.url, '/api/v1/join', { card, pubkey: PUBKEY, pow: await solvePow() })).json()).token;

  const me = await join(makeCard());
  const others = [];
  for (let i = 0; i < K_FLOOR + 2; i += 1) others.push(await join(makeCard()));

  const res = await post(app.url, '/api/v1/match', { token: me, limit: 5 });
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.ok(body.matches.length > 0, '同桶应该能匹配到人');
  assert.ok(body.matches.length <= 5, 'limit 生效');

  for (const m of body.matches) {
    assert.equal(typeof m.token, 'string');
    assert.equal(typeof m.pubkey, 'string');
    assert.ok(['high', 'mid', 'low'].includes(m.band));
    assert.equal(typeof m.shared.partitions, 'number');
    assert.equal(typeof m.shared.tags, 'number');
    // 关键：响应里不能出现任何名片字段
    assert.equal(m.card, undefined, '不能下发名片');
    assert.equal(m.n, undefined);
    assert.equal(m.p, undefined);
    assert.equal(m.g, undefined);
  }

  const raw = JSON.stringify(body);
  assert.equal(raw.includes('科技'), false, '响应里不能出现分区名');
  assert.equal(raw.includes('装机'), false, '响应里不能出现标签名');
});

test('HTTP 层：/match 对未知 token 返回 404', async (t) => {
  const app = await listenRandom();
  t.after(() => app.close());
  const res = await post(app.url, '/api/v1/match', { token: 'aaaaaaaaaaaa' });
  assert.equal(res.status, 404);
});

test('HTTP 层：根路径是 JSON，不是网页', async (t) => {
  const app = await listenRandom();
  t.after(() => app.close());
  const res = await fetch(app.url + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const body = await res.json();
  assert.equal(body.service, 'mirroself-api');
});

test('HTTP 层：完整同意流程（加密联系卡只在双方同意后互换）', async (t) => {
  const app = await listenRandom();
  t.after(() => app.close());
  const join = async (card) => (await (await post(app.url, '/api/v1/join', { card, pubkey: PUBKEY, pow: await solvePow() })).json()).token;

  const a = await join(makeCard());
  const b = await join(makeCard());
  // 补足 k-匿名下限，保证候选接口会返回人
  for (let i = 0; i < K_FLOOR; i += 1) await join(makeCard());

  await post(app.url, '/api/v1/interest', { token: a, to: b, blob: 'ENCRYPTED_A_TO_B' });
  const inbox1 = await (await fetch(`${app.url}/api/v1/inbox?token=${b}`)).json();
  assert.equal(inbox1.items[0].mutual, false);
  assert.equal(inbox1.items[0].blob, null);

  await post(app.url, '/api/v1/interest', { token: b, to: a, blob: 'ENCRYPTED_B_TO_A' });
  const inbox2 = await (await fetch(`${app.url}/api/v1/inbox?token=${b}`)).json();
  assert.equal(inbox2.items[0].mutual, true);
  assert.equal(inbox2.items[0].blob, 'ENCRYPTED_A_TO_B');
});
