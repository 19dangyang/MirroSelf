/** 服务端参数。全部可以通过环境变量覆盖，但默认值就是线上该用的值。 */

/**
 * Cloudflare Workers 里**没有 process 对象**，裸写 process.env 会在模块加载时
 * 直接抛 ReferenceError（而且是在 import 阶段，表现为整个 Worker 500）。
 * 所以这里必须探测着取。
 */
const ENV = (typeof process !== 'undefined' && process.env) || {};

const num = (name, fallback) => {
  const v = Number(ENV[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** 一条记录的存活时间（秒）—— 退出即删，过期是兜底 */
export const TTL = 30 * 86400;
/** 未回应的同意请求 7 天过期 */
export const MAIL_TTL = 7 * 86400;

/** 桶内少于这个人数就不返回（k-匿名下限） */
export const K_FLOOR = num('MIRROSELF_K_FLOOR', 5);
/** 每个 token 每天最多拉多少张候选卡 */
export const DAILY_CANDIDATES = num('MIRROSELF_DAILY_CANDIDATES', 120);
/** 单次最多返回多少条 */
export const MAX_RETURN = num('MIRROSELF_MAX_RETURN', 40);
/** 每个 IP 每天最多建几个 token */
export const JOIN_PER_IP = num('MIRROSELF_JOIN_PER_IP', 3);
/** 每天最多发起多少次"想认识" */
export const INTEREST_PER_DAY = num('MIRROSELF_INTEREST_PER_DAY', 20);
/** 参与匹配的最低名片质量分 */
export const MIN_QUALITY = num('MIRROSELF_MIN_Q', 12);
/** 建号需要的工作量证明位数 */
export const POW_BITS = num('MIRROSELF_POW_BITS', 12);

export const POW_SALT = 'mirroself-pow-v1';
