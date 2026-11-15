import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorker } from '../worker.js';
import { memoryStore, createStore } from '../lib/store.js';
import { powDigest, leadingZeroBits } from '../lib/pow.js';
import { POW_BITS } from '../lib/config.js';

// Workers 运行时没有 process.env 和 node:crypto，所以这一层必须单独测：
// 用 Node 20 自带的 Request/Response 模拟，注入同一个 store 让状态跨请求保留。

let cachedNonce = null;
async function solvePow(bits = POW_BITS) {
  if (cachedNonce) return cachedNonce;
  for (let i = 0; i < 2_000_000; i += 1) {
    const nonce = 'w' + i.toString(36);
    if (leadingZeroBits(await powDigest(nonce)) >= bits) {
      cachedNonce = nonce;
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
    id: 'workercard' + seq,
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

const PUBKEY = 'C'.repeat(43);

function harness() {
  const store = createStore(memoryStore());
  const worker = createWorker(() => store);
  const call = (path, { method = 'GET', body } = {}) =>
    worker.fetch(
      new Request(`https://api.example.test${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      {},
    );
  return { call, store };
}

test('Worker：根路径返回 JSON，并说明这是纯 API', async () => {
  const { call } = harness();
  const res = await call('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.equal(body.service, 'mirroself-api');
  assert.equal(body.note.includes('纯 API'), true);
});

test('Worker：CORS 预检返回 204 且带通配来源', async () => {
  const { call } = harness();
  const res = await call('/api/v1/join', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('Worker：完整链路 join → match → leave', async () => {
  const { call } = harness();

  const health = await (await call('/api/v1/health')).json();
  assert.equal(health.ok, true);

  const joined = await (await call('/api/v1/join', { method: 'POST', body: { card: makeCard(), pubkey: PUBKEY, pow: await solvePow() } })).json();
  assert.ok(joined.token, '应该拿到 token：' + JSON.stringify(joined));

  for (let i = 0; i < 6; i += 1) {
    const r = await call('/api/v1/join', { method: 'POST', body: { card: makeCard(), pubkey: PUBKEY, pow: await solvePow() } });
    assert.equal(r.status, 200);
  }

  const matched = await (await call('/api/v1/match', { method: 'POST', body: { token: joined.token, limit: 3 } })).json();
  assert.ok(matched.matches.length > 0, '同桶应该匹配到人');
  assert.ok(matched.matches.length <= 3);
  for (const m of matched.matches) {
    assert.equal(m.card, undefined, '不能下发名片');
    assert.ok(['high', 'mid', 'low'].includes(m.band));
  }

  await call('/api/v1/leave', { method: 'POST', body: { token: joined.token } });
  const after = await call('/api/v1/match', { method: 'POST', body: { token: joined.token } });
  assert.equal(after.status, 404, '退出后 token 立即失效');
});

test('Worker：畸形 JSON 与未知路径', async () => {
  const { call } = harness();
  const bad = await call('/api/v1/join', {
    method: 'POST',
    body: undefined,
  });
  // 空 body 会被当成 {}，触发名片校验失败而不是崩溃
  assert.equal(bad.status, 400);

  const missing = await call('/api/v1/nope');
  assert.equal(missing.status, 404);
});

test('Worker：用错方法返回 405', async () => {
  const { call } = harness();
  const res = await call('/api/v1/join', { method: 'GET' });
  assert.equal(res.status, 405);
});
