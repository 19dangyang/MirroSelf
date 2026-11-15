/**
 * 粗键：把一张名片压成 2–3 个倒排索引键。
 *
 * 为什么不用 SimHash：检测报告用实测证明 FNV-1a 的位不独立，中等相似召回 0%、
 * 极不相似误命中 13.8%，而且桶严重倾斜。语义键没有这个问题，桶大小也天然可控。
 */

/** 第二、第三高的标签权重只要不低于第一的 75%，就单独建一个"标签对"键。 */
const PAIR_RATIO = 0.75;

export function coarseKeys(card) {
  const keys = [];
  if (!card || typeof card !== 'object') return keys;

  const partitions = sortDesc(card.p);
  if (partitions[0]) keys.push('p:' + partitions[0][0]);

  const tags = sortDesc(card.g);
  if (tags[0]) keys.push('t:' + tags[0][0]);
  if (tags[1] && tags[0][1] > 0 && tags[1][1] >= tags[0][1] * PAIR_RATIO) {
    keys.push('c:' + tags[0][0] + '+' + tags[1][0]);
  }
  return keys;
}

function sortDesc(map) {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

/**
 * 键里可能带用户标签，长度要限，避免有人塞一坨东西当键名。
 * 键名会进 Redis，所以只允许比较保守的字符集。
 */
export function sanitizeKey(key) {
  const s = String(key || '');
  if (!s || s.length > 80) return '';
  return /^[pct]:[\w\u4e00-\u9fa5+#.-]{1,60}$/u.test(s) ? s : '';
}
