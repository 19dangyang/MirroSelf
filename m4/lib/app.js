/**
 * 把 7 个 handler 组装成一个 http 服务。
 *
 * 单独抽出来是为了让编排逻辑可测：测试可以直接 listen(0) 起一个临时端口，
 * 用真实 HTTP 走一遍 join → candidates → leave，而不依赖脚本或 curl
 * （Windows 上 curl 传中文 JSON 会被本地代码页弄坏，这类坑必须由测试兜住）。
 */

import { createServer } from 'node:http';

import join from '../api/v1/join.js';
import candidates from '../api/v1/candidates.js';
import match from '../api/v1/match.js';
import interest from '../api/v1/interest.js';
import inbox from '../api/v1/inbox.js';
import block from '../api/v1/block.js';
import leave from '../api/v1/leave.js';
import health from '../api/v1/health.js';
import root from '../api/index.js';

export const ROUTES = Object.freeze({
  '/': root,
  '/api': root,
  '/api/v1/join': join,
  '/api/v1/candidates': candidates,
  '/api/v1/match': match,
  '/api/v1/interest': interest,
  '/api/v1/inbox': inbox,
  '/api/v1/block': block,
  '/api/v1/leave': leave,
  '/api/v1/health': health,
});

export function createApp(routes = ROUTES) {
  return createServer(async (req, res) => {
    const raw = (req.url || '/').split('?')[0];
    // 根路径要保留成 '/'，其余去掉尾斜杠
    const path = raw.length > 1 ? raw.replace(/\/+$/, '') || '/' : '/';
    const handler = routes[path];
    if (!handler) {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'not-found', path }));
      return;
    }
    await handler(req, res);
  });
}

/** 测试与本地开发用：起在随机端口，返回 { url, close }。 */
export function listenRandom() {
  return new Promise((resolve) => {
    const server = createApp();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
