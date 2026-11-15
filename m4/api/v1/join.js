import { defaultStore } from '../../lib/store.js';
import { createPool } from '../../lib/pool.js';
import { handler, readJson, clientIp } from '../../lib/http.js';

const pool = createPool(defaultStore);

export default handler(async (req, res) => {
  if (req.method !== 'POST') return { status: 405, error: 'method-not-allowed' };
  const body = await readJson(req);
  if (!body.ok) return { status: 400, error: body.error };
  const result = await pool.join({ ...body.value, ip: clientIp(req) });
  return result;
});
