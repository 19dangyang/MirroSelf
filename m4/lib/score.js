/**
 * 服务端打分：和插件里的 core/score.js 必须完全一致。
 *
 * 这里刻意复制了一份实现，而不是去 import 插件目录——服务端不该依赖前端打包。
 * 代价是两份代码可能漂移，所以 `tests/score.test.mjs` 里有一条交叉测试：
 * 同一组名片，两边算出来的分数必须逐位相等。
 */

export const WEIGHTS = Object.freeze({ partition: 0.55, tag: 0.45 });

export const BANDS = Object.freeze([
  { level: 'high', min: 0.45, label: '高度同频' },
  { level: 'mid', min: 0.2, label: '有交集' },
  { level: 'low', min: 0, label: '交集较少' },
]);

function dot(a, b) {
  const small = Object.keys(a).length <= Object.keys(b).length ? a : b;
  const big = small === a ? b : a;
  let sum = 0;
  for (const k in small) if (Object.hasOwn(big, k)) sum += small[k] * big[k];
  return sum;
}

function norm(v) {
  let s = 0;
  for (const k in v) s += v[k] * v[k];
  return Math.sqrt(s);
}

export function cosine(a, b) {
  if (!a || !b) return 0;
  const na = norm(a);
  const nb = norm(b);
  if (!(na > 0) || !(nb > 0)) return 0;
  return dot(a, b) / (na * nb);
}

/**
 * 分数 = Σ(权重 × 余弦) / Σ全部权重。
 * 缺失信号**不重新归一化**（和客户端一致）：只有标签的人最高 0.45。
 */
export function scoreCards(a, b, weights = WEIGHTS) {
  const total = weights.partition + weights.tag;
  let acc = 0;
  if (Object.keys(a.p || {}).length && Object.keys(b.p || {}).length) {
    acc += weights.partition * cosine(a.p, b.p);
  }
  if (Object.keys(a.g || {}).length && Object.keys(b.g || {}).length) {
    acc += weights.tag * cosine(a.g, b.g);
  }
  const score = total > 0 ? acc / total : 0;
  return score < 0 ? 0 : score > 1 ? 1 : score;
}

export function bandOf(score) {
  for (const b of BANDS) if (score >= b.min) return b;
  return BANDS[BANDS.length - 1];
}

/**
 * 共同点**只回数量，不回名字**。
 *
 * 回名字（"你们都爱 #显卡"）会让响应本身变成一份兴趣泄露；
 * 回数量足以解释"为什么像"，具体标签等双方同意后再交换名片即可。
 */
export function overlapCounts(a, b) {
  const parts = Object.keys(a.p || {}).filter((k) => b.p && b.p[k] !== undefined).length;
  const tags = Object.keys(a.g || {}).filter((k) => b.g && b.g[k] !== undefined).length;
  return { partitions: parts, tags };
}
