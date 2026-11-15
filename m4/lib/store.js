/**
 * 存储层：Upstash / Vercel KV 的 REST 接口，外加一个纯内存实现。
 *
 * 之所以自己写这层：Vercel 函数是无状态的，状态必须外置；但本地开发和单测
 * 需要一个不用连网的实现。两个实现共用同一套接口，业务逻辑对它们无感知。
 */

/** Workers 没有 process，必须探测（见 config.js 的说明）。 */
const ENV = (typeof process !== 'undefined' && process.env) || {};
const REST_URL = ENV.KV_REST_API_URL || ENV.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = ENV.KV_REST_API_TOKEN || ENV.UPSTASH_REDIS_REST_TOKEN || '';

export const hasRemoteStore = Boolean(REST_URL && REST_TOKEN);

// ---------------------------------------------------------------- Upstash REST

function restStore(url, token) {
  return {
    kind: 'kv',
    async cmd(...args) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(args.map((a) => (typeof a === 'number' ? String(a) : a))),
      });
      if (!res.ok) throw new Error(`kv-${res.status}`);
      const data = await res.json();
      if (data && data.error) throw new Error('kv-' + data.error);
      return data ? data.result : null;
    },
  };
}

// ---------------------------------------------------------------- 内存实现

export function memoryStore(nowFn = () => Date.now()) {
  const data = new Map(); // key -> { type:'string'|'set', value, expiresAt }

  const alive = (entry) => {
    if (!entry) return false;
    if (entry.expiresAt && entry.expiresAt <= nowFn()) return false;
    return true;
  };
  const get = (key) => {
    const entry = data.get(key);
    if (!alive(entry)) {
      data.delete(key);
      return null;
    }
    return entry;
  };

  return {
    kind: 'memory',
    async cmd(...args) {
      const [op, key, ...rest] = args.map(String);
      const upper = op.toUpperCase();
      if (upper === 'SET') {
        const ttlIndex = rest.findIndex((v) => v.toUpperCase() === 'EX');
        const ttl = ttlIndex >= 0 ? Number(rest[ttlIndex + 1]) : 0;
        data.set(key, { type: 'string', value: rest[0], expiresAt: ttl > 0 ? nowFn() + ttl * 1000 : 0 });
        return 'OK';
      }
      if (upper === 'GET') {
        const entry = get(key);
        return entry && entry.type === 'string' ? entry.value : null;
      }
      if (upper === 'DEL') {
        const had = data.delete(key);
        return had ? 1 : 0;
      }
      if (upper === 'EXPIRE') {
        const entry = get(key);
        if (!entry) return 0;
        entry.expiresAt = nowFn() + Number(rest[0]) * 1000;
        return 1;
      }
      if (upper === 'INCR') {
        const entry = get(key);
        const next = (entry ? Number(entry.value) || 0 : 0) + 1;
        data.set(key, { type: 'string', value: String(next), expiresAt: entry ? entry.expiresAt : 0 });
        return next;
      }
      if (upper === 'SADD') {
        const entry = get(key) || { type: 'set', value: new Set(), expiresAt: 0 };
        const before = entry.value.size;
        for (const v of rest) entry.value.add(v);
        data.set(key, entry);
        return entry.value.size - before;
      }
      if (upper === 'SREM') {
        const entry = get(key);
        if (!entry || entry.type !== 'set') return 0;
        let removed = 0;
        for (const v of rest) if (entry.value.delete(v)) removed += 1;
        return removed;
      }
      if (upper === 'SMEMBERS') {
        const entry = get(key);
        return entry && entry.type === 'set' ? [...entry.value] : [];
      }
      if (upper === 'SCARD') {
        const entry = get(key);
        return entry && entry.type === 'set' ? entry.value.size : 0;
      }
      if (upper === 'SRANDMEMBER') {
        const entry = get(key);
        if (!entry || entry.type !== 'set') return [];
        const all = [...entry.value];
        const want = rest.length > 0 ? Math.min(Number(rest[0]) || 0, all.length) : all.length;
        for (let i = all.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [all[i], all[j]] = [all[j], all[i]];
        }
        return all.slice(0, want);
      }
      throw new Error('memory-store: unsupported command ' + upper);
    },
  };
}

// ---------------------------------------------------------------- 门面

export function createStore(raw) {
  return {
    kind: raw.kind,
    cmd: (...args) => raw.cmd(...args),

    async setJson(key, value, ttlSec) {
      await raw.cmd('SET', key, JSON.stringify(value), 'EX', String(ttlSec));
    },
    async getJson(key) {
      const raw0 = await raw.cmd('GET', key);
      if (typeof raw0 !== 'string' || !raw0) return null;
      try {
        return JSON.parse(raw0);
      } catch {
        return null;
      }
    },
    del: (key) => raw.cmd('DEL', key),
    expire: (key, ttlSec) => raw.cmd('EXPIRE', key, String(ttlSec)),
    sadd: (key, member) => raw.cmd('SADD', key, member),
    srem: (key, member) => raw.cmd('SREM', key, member),
    smembers: async (key) => {
      const res = await raw.cmd('SMEMBERS', key);
      return Array.isArray(res) ? res : [];
    },
    scard: async (key) => Number(await raw.cmd('SCARD', key)) || 0,
    incr: async (key) => Number(await raw.cmd('INCR', key)) || 0,
  };
}

/** 生产环境用 KV，本地没有环境变量时退化成内存（重启即丢，只适合开发）。 */
export const defaultStore = createStore(hasRemoteStore ? restStore(REST_URL, REST_TOKEN) : memoryStore());

/**
 * 按运行时提供的 env 造一个 store。
 *
 * Cloudflare Workers 没有 process.env，环境变量从 fetch(request, env) 的第 2 个参数进来；
 * 所以那边每个请求调一次这个函数（开销就是造个对象，可忽略）。
 */
export function storeFromEnv(env = {}) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '';
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '';
  if (url && token) return createStore(restStore(url, token));
  return createStore(memoryStore());
}

export function hasRemoteInEnv(env = {}) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '';
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '';
  return Boolean(url && token);
}
