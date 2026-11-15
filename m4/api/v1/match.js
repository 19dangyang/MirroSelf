import { defaultStore } from '../../lib/store.js';
import { createMatcher } from '../../lib/match.js';
import { handler, readJson } from '../../lib/http.js';

const matcher = createMatcher(defaultStore);

export default handler(async (req) => {
  if (req.method !== 'POST') return { status: 405, error: 'method-not-allowed' };
  const body = await readJson(req);
  if (!body.ok) return { status: 400, error: body.error };
  return matcher.match({ token: body.value.token, limit: body.value.limit });
});
