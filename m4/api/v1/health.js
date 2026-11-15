import { defaultStore } from '../../lib/store.js';
import { createPool } from '../../lib/pool.js';
import { handler } from '../../lib/http.js';

const pool = createPool(defaultStore);

export default handler(async (req) => {
  if (req.method !== 'GET') return { status: 405, error: 'method-not-allowed' };
  return pool.health();
});
