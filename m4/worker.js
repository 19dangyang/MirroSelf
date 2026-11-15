/**
 * Cloudflare Workers 入口。
 *
 * 和 `api/v1/*.js`（Vercel / 自建 Node）共用同一套业务逻辑，区别只在外壳：
 * Workers 用 Request/Response，Node 用 req/res。业务代码因此不能依赖
 * `process.env` 或 `node:crypto`，这也是 pow.js 改成 WebCrypto 的原因。
 *
 * 部署：wrangler deploy（见 m4/README.md）
 */

import { storeFromEnv, hasRemoteInEnv } from './lib/store.js';
import { createPool } from './lib/pool.js';
import { createMatcher } from './lib/match.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });
}

function respond(result) {
  const { status = 200, ...rest } = result || {};
  return json(rest, status);
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('bad-body');
  return parsed;
}

/**
 * @param {(env: object) => object} getStore 返回一个 store；测试里可以注入共享实例
 */
export function createWorker(getStore) {
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

      try {
        const store = getStore(env);
        const pool = createPool(store);

        if (path === '/' || path === '/api') {
          if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
          return json({
            service: 'mirroself-api',
            ok: true,
            storage: hasRemoteInEnv(env) ? 'kv' : 'memory',
            note: '纯 API 服务，请在浏览器插件里填写本域名（不含 /api/v1）',
            endpoints: [
              'POST /api/v1/join',
              'POST /api/v1/match',
              'POST /api/v1/candidates',
              'POST /api/v1/interest',
              'GET  /api/v1/inbox?token=',
              'POST /api/v1/block',
              'POST /api/v1/leave',
              'GET  /api/v1/health',
            ],
          });
        }

        if (path === '/api/v1/health') {
          if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
          return respond(await pool.health());
        }

        if (path === '/api/v1/inbox') {
          if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
          return respond(await pool.inbox({ token: url.searchParams.get('token') || '' }));
        }

        const routes = {
          '/api/v1/join': async (body) =>
            pool.join({ ...body, ip: request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '' }),
          '/api/v1/match': async (body) => createMatcher(store).match({ token: body.token, limit: body.limit }),
          '/api/v1/candidates': async (body) => pool.candidates({ token: body.token }),
          '/api/v1/interest': async (body) => pool.interest({ token: body.token, to: body.to, blob: body.blob }),
          '/api/v1/block': async (body) => pool.block({ token: body.token, target: body.target }),
          '/api/v1/leave': async (body) => pool.leave({ token: body.token }),
        };

        const handler = routes[path];
        if (!handler) return json({ error: 'not-found', path }, 404);
        if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);

        return respond(await handler(await readJson(request)));
      } catch (err) {
        const message = String((err && err.message) || err).slice(0, 200);
        return json({ error: message === 'bad-body' ? 'body-json' : 'internal', message }, message === 'bad-body' ? 400 : 500);
      }
    },
  };
}

export default createWorker((env) => storeFromEnv(env));
