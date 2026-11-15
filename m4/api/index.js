import { handler } from '../lib/http.js';
import { hasRemoteStore } from '../lib/store.js';

/**
 * 根路径：这个服务是**纯 API**，不提供网页。
 * 打开域名只会看到这段 JSON，用户不需要、也不应该来这里。
 */
export default handler(async (req) => {
  if (req.method !== 'GET') return { status: 405, error: 'method-not-allowed' };
  return {
    status: 200,
    service: 'mirroself-api',
    ok: true,
    storage: hasRemoteStore ? 'kv' : 'memory',
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
  };
});
