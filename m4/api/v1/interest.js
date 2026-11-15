import { defaultStore } from '../../lib/store.js';
import { createPool } from '../../lib/pool.js';
import { handler, readJson } from '../../lib/http.js';

const pool = createPool(defaultStore);

export default handler(async (req) => {
  if (req.method !== 'POST') return { status: 405, error: 'method-not-allowed' };
  const body = await readJson(req);
  if (!body.ok) return { status: 400, error: body.error };
  return pool.interest({ token: body.value.token, to: body.value.to, blob: body.value.blob });
});
