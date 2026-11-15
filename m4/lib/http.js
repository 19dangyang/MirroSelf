/** HTTP 小工具：CORS、JSON 读写、统一的错误形状。 */

const MAX_BODY = 16 * 1024;

export function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function send(res, status, payload) {
  applyCors(res);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return { ok: true, value: req.body };
  if (typeof req.body === 'string') {
    if (req.body.length > MAX_BODY) return { ok: false, error: 'body-too-large' };
    try {
      return { ok: true, value: JSON.parse(req.body || '{}') };
    } catch {
      return { ok: false, error: 'body-json' };
    }
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) return { ok: false, error: 'body-too-large' };
    chunks.push(chunk);
  }
  if (size === 0) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false, error: 'body-json' };
  }
}

/** 从各种运行时里取调用方 IP（Vercel / Node 本地都要能用）。 */
export function clientIp(req) {
  const header = req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  if (typeof header === 'string' && header) return header.split(',')[0].trim();
  const socket = req.socket || {};
  return socket.remoteAddress || '';
}

/** 统一包装：处理 OPTIONS、异常、以及"结果里带 status"的约定。 */
export function handler(fn) {
  return async function wrapped(req, res) {
    if (req.method === 'OPTIONS') {
      applyCors(res);
      res.statusCode = 204;
      res.end();
      return;
    }
    try {
      const result = await fn(req, res);
      if (res.writableEnded) return;
      const status = (result && result.status) || 200;
      const body = { ...result };
      delete body.status;
      send(res, status, body);
    } catch (err) {
      send(res, 500, { error: 'internal', message: String((err && err.message) || err).slice(0, 200) });
    }
  };
}
