/**
 * 匹配池的全部业务逻辑。
 *
 * 刻意与 HTTP 解耦：handlers 只是薄薄一层壳，这样单测可以直接对着
 * 内存存储跑完整流程，不需要起服务器。
 *
 * 服务端**永远不存**：作品 ID、标题、观看时间、UP 主列表、真实的账号信息。
 * 它只存：一张量化过的名片、一个公钥、一个匿名 token、一封加密后的联系卡。
 */

import {
  TTL,
  MAIL_TTL,
  K_FLOOR,
  DAILY_CANDIDATES,
  MAX_RETURN,
  JOIN_PER_IP,
  INTEREST_PER_DAY,
} from './config.js';
import { coarseKeys, sanitizeKey } from './keys.js';
import { verifyPow, randomToken } from './pow.js';
import { validateCard, validatePubkey, validateToken, validateBlob } from './validate.js';

const dayKey = (now) => new Date(now).toISOString().slice(0, 10);

export function createPool(store, options = {}) {
  const now = options.now || (() => Date.now());

  async function takeRate(bucket, subject, limit) {
    const key = `rl:${bucket}:${subject}:${dayKey(now())}`;
    const n = await store.incr(key);
    if (n === 1) await store.expire(key, 86400);
    return n <= limit;
  }

  return {
    /** 加入匹配池：校验名片 + 公钥 + PoW，写入倒排索引。 */
    async join({ card, pubkey, pow, ip }) {
      if (!(await verifyPow(pow))) return { status: 400, error: 'pow-invalid' };
      const cardError = validateCard(card);
      if (cardError) return { status: 400, error: cardError };
      const pkError = validatePubkey(pubkey);
      if (pkError) return { status: 400, error: pkError };
      if (ip && !(await takeRate('join', ip, JOIN_PER_IP))) return { status: 429, error: 'rate-join' };

      const token = randomToken();
      const keys = coarseKeys(card).map(sanitizeKey).filter(Boolean);
      if (keys.length === 0) return { status: 400, error: 'card-no-keys' };

      await store.setJson(`tok:${token}`, { card, pubkey, keys, at: now() }, TTL);
      for (const key of keys) {
        await store.sadd(`band:${key}`, token);
        await store.expire(`band:${key}`, TTL);
      }
      return { status: 200, token, keys: keys.length, expiresIn: TTL };
    },

    /**
     * 候选召回：按自己的粗键查倒排集合，取并集后随机抽样。
     * 桶内人数低于 K_FLOOR 的整桶跳过（k-匿名）。
     */
    async candidates({ token }) {
      const tokenError = validateToken(token);
      if (tokenError) return { status: 400, error: tokenError };

      const self = await store.getJson(`tok:${token}`);
      if (!self) return { status: 404, error: 'token-unknown' };
      if (!(await takeRate('cand', token, DAILY_CANDIDATES))) return { status: 429, error: 'rate-candidates' };

      const blocked = new Set(await store.smembers(`blk:${token}`));
      const seen = new Map(); // token -> 命中的键
      let skippedBuckets = 0;

      for (const key of self.keys) {
        const members = await store.smembers(`band:${key}`);
        if (members.length < K_FLOOR) {
          skippedBuckets += 1;
          continue;
        }
        for (const member of members) {
          if (member === token || blocked.has(member)) continue;
          if (!seen.has(member)) seen.set(member, key);
        }
      }

      const pool = [...seen.keys()];
      // 随机抽样：不让调用者按顺序把池子扫穿
      for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }

      const items = [];
      for (const candidate of pool.slice(0, MAX_RETURN)) {
        const rec = await store.getJson(`tok:${candidate}`);
        if (!rec) continue;
        items.push({ token: candidate, card: rec.card, pubkey: rec.pubkey });
      }

      return { status: 200, items, total: pool.length, skippedBuckets, remaining: Math.max(0, DAILY_CANDIDATES - 1) };
    },

    /**
     * 发起"想认识"：客户端已经用自己的私钥 + 对方公钥加密好联系卡，
     * 服务端只做转交，读不懂内容。
     */
    async interest({ token, to, blob }) {
      const tokenError = validateToken(token) || validateToken(to);
      if (tokenError) return { status: 400, error: tokenError };
      if (token === to) return { status: 400, error: 'self-interest' };
      // 语义错误优先于格式错误：对自己发起请求时，blob 长短无关紧要
      const blobError = validateBlob(blob);
      if (blobError) return { status: 400, error: blobError };

      const [fromRec, toRec] = await Promise.all([store.getJson(`tok:${token}`), store.getJson(`tok:${to}`)]);
      if (!fromRec) return { status: 404, error: 'token-unknown' };
      if (!toRec) return { status: 404, error: 'peer-unknown' };

      const blocked = await store.smembers(`blk:${to}`);
      if (blocked.includes(token)) return { status: 403, error: 'blocked' };

      if (!(await takeRate('interest', token, INTEREST_PER_DAY))) return { status: 429, error: 'rate-interest' };

      await store.setJson(`req:${token}:${to}`, { blob, at: now() }, MAIL_TTL);
      await store.sadd(`inbox:${to}`, token);
      await store.expire(`inbox:${to}`, MAIL_TTL);
      await store.sadd(`outbox:${token}`, to);
      await store.expire(`outbox:${token}`, MAIL_TTL);

      const reverse = await store.getJson(`req:${to}:${token}`);
      return { status: 200, state: reverse ? 'mutual' : 'pending' };
    },

    /** 收件箱：别人对我发起的请求，双方都点过才把对方的加密联系卡放出来。 */
    async inbox({ token }) {
      const tokenError = validateToken(token);
      if (tokenError) return { status: 400, error: tokenError };
      if (!(await store.getJson(`tok:${token}`))) return { status: 404, error: 'token-unknown' };
      if (!(await takeRate('inbox', token, 240))) return { status: 429, error: 'rate-inbox' };

      const incoming = await store.smembers(`inbox:${token}`);
      const items = [];
      for (const from of incoming) {
        const theirs = await store.getJson(`req:${from}:${token}`);
        if (!theirs) continue;
        const mine = await store.getJson(`req:${token}:${from}`);
        const fromRec = await store.getJson(`tok:${from}`);
        items.push({
          from,
          at: theirs.at,
          mutual: Boolean(mine),
          nickname: fromRec && fromRec.card ? fromRec.card.n || '' : '',
          // 只有双方都表达过意愿，才交出对方的加密联系卡
          blob: mine ? theirs.blob : null,
        });
      }

      const outgoing = await store.smembers(`outbox:${token}`);
      const sent = [];
      for (const to of outgoing) {
        const mine = await store.getJson(`req:${token}:${to}`);
        if (!mine) continue;
        const theirs = await store.getJson(`req:${to}:${token}`);
        sent.push({ to, at: mine.at, mutual: Boolean(theirs) });
      }

      return { status: 200, items, sent };
    },

    async block({ token, target }) {
      const tokenError = validateToken(token) || validateToken(target);
      if (tokenError) return { status: 400, error: tokenError };
      await store.sadd(`blk:${token}`, target);
      await store.expire(`blk:${token}`, TTL);
      await store.srem(`inbox:${token}`, target);
      await store.del(`req:${target}:${token}`);
      return { status: 200, ok: true };
    },

    /** 退出 = 物理删除：把自己从所有倒排桶、信箱、索引里抹掉。 */
    async leave({ token }) {
      const tokenError = validateToken(token);
      if (tokenError) return { status: 400, error: tokenError };

      const rec = await store.getJson(`tok:${token}`);
      for (const key of rec ? rec.keys : []) await store.srem(`band:${key}`, token);

      const inbox = await store.smembers(`inbox:${token}`);
      for (const from of inbox) await store.del(`req:${from}:${token}`);
      const outbox = await store.smembers(`outbox:${token}`);
      for (const to of outbox) await store.del(`req:${token}:${to}`);

      await store.del(`tok:${token}`);
      await store.del(`inbox:${token}`);
      await store.del(`outbox:${token}`);
      await store.del(`blk:${token}`);
      return { status: 200, ok: true };
    },

    async health() {
      return { status: 200, ok: true, at: now(), storage: store.kind };
    },
  };
}
