/**
 * 匹配接口：服务器替用户算好，只回几个公钥。
 *
 * 这是给"用户只想要结果、不想等下载"的场景用的。相比 candidates 多下发了
 * 200 张名片，这里只回 5–20 条 {token, pubkey, band, 共同点数量}。
 *
 * 代价（必须在文档里说清）：服务器现在知道"谁和谁像"。
 */

import { K_FLOOR, DAILY_CANDIDATES, MAX_RETURN } from './config.js';
import { scoreCards, bandOf, overlapCounts } from './score.js';
import { validateToken } from './validate.js';

export function createMatcher(store, options = {}) {
  const now = options.now || (() => Date.now());
  const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

  async function takeRate(token, limit) {
    const key = `rl:cand:${token}:${dayKey(now())}`;
    const n = await store.incr(key);
    if (n === 1) await store.expire(key, 86400);
    return n <= limit;
  }

  return {
    /**
     * @param {{token: string, limit?: number}} input
     * @returns 只含公钥与分档的结果，不含任何名片内容
     */
    async match({ token, limit }) {
      const tokenError = validateToken(token);
      if (tokenError) return { status: 400, error: tokenError };

      const self = await store.getJson(`tok:${token}`);
      if (!self) return { status: 404, error: 'token-unknown' };
      if (!(await takeRate(token, DAILY_CANDIDATES))) return { status: 429, error: 'rate-candidates' };

      const want = Math.max(1, Math.min(Number(limit) || MAX_RETURN, MAX_RETURN));
      const blocked = new Set(await store.smembers(`blk:${token}`));

      // 1. 召回：自己的粗键命中的桶，逐桶取成员（k-匿名下限）
      const seen = new Set();
      let skippedBuckets = 0;
      for (const key of self.keys) {
        const members = await store.smembers(`band:${key}`);
        if (members.length < K_FLOOR) {
          skippedBuckets += 1;
          continue;
        }
        for (const m of members) {
          if (m === token || blocked.has(m)) continue;
          seen.add(m);
        }
      }

      // 2. 精排：在召回集合里逐个算分（数量受桶大小限制，成本可控）
      const ranked = [];
      for (const other of seen) {
        const rec = await store.getJson(`tok:${other}`);
        if (!rec || !rec.card) continue;
        const score = scoreCards(self.card, rec.card);
        ranked.push({
          token: other,
          pubkey: rec.pubkey,
          band: bandOf(score).level,
          bandLabel: bandOf(score).label,
          score: Number(score.toFixed(4)),
          shared: overlapCounts(self.card, rec.card),
        });
      }

      ranked.sort((a, b) => b.score - a.score || String(a.token).localeCompare(String(b.token)));

      return {
        status: 200,
        count: ranked.length,
        skippedBuckets,
        matches: ranked.slice(0, want).map((m) => ({
          token: m.token,
          pubkey: m.pubkey,
          band: m.band,
          bandLabel: m.bandLabel,
          score: m.score,
          shared: m.shared,
        })),
      };
    },
  };
}
