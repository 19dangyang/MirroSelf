/**
 * 名片校验。服务端不认识名片的历史版本，只接受当前格式。
 *
 * 这里刻意比客户端更严格：服务端要面对的是"任意人发来的任意 JSON"，
 * 所以字段上限、类型、体积三样都必须自己兜住，不能信任客户端。
 */

export const LIMITS = Object.freeze({
  maxPartitions: 12,
  maxTags: 24,
  maxHighlight: 8,
  maxNickname: 32,
  maxBodyBytes: 8 * 1024,
  maxPubkeyLength: 200,
});

export const MIN_QUALITY = 12;

export function validateCard(card) {
  if (!card || typeof card !== 'object') return 'card-missing';
  if (card.v !== 2) return 'card-version';
  if (card.k !== 'mirroself-card') return 'card-kind';
  if (typeof card.id !== 'string' || card.id.length < 4 || card.id.length > 40) return 'card-id';
  if (card.h !== undefined) return 'card-fingerprint-not-allowed';
  if (!isWeightMap(card.p, LIMITS.maxPartitions)) return 'card-partitions';
  if (!isWeightMap(card.g, LIMITS.maxTags)) return 'card-tags';
  if (typeof card.q !== 'number' || !Number.isFinite(card.q) || card.q < 0 || card.q > 100) return 'card-quality';
  if (card.q < MIN_QUALITY) return 'card-too-thin';
  if (card.n !== undefined && (typeof card.n !== 'string' || card.n.length > LIMITS.maxNickname)) return 'card-nickname';
  if (card.hl !== undefined && (!Array.isArray(card.hl) || card.hl.length > LIMITS.maxHighlight)) return 'card-highlight';
  return '';
}

export function isWeightMap(map, maxKeys) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  const keys = Object.keys(map);
  if (keys.length > maxKeys) return false;
  for (const k of keys) {
    const v = map[k];
    if (typeof k !== 'string' || !k || k.length > 48) return false;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 15) return false;
  }
  return true;
}

/** 公钥：客户端导出的是 P-256 未压缩点（65 字节）的 base64url。 */
export function validatePubkey(pubkey) {
  if (typeof pubkey !== 'string') return 'pubkey-missing';
  if (pubkey.length < 40 || pubkey.length > LIMITS.maxPubkeyLength) return 'pubkey-length';
  if (!/^[A-Za-z0-9_-]+$/.test(pubkey)) return 'pubkey-charset';
  return '';
}

/** token：服务端签发，客户端原样带回。 */
export function validateToken(token) {
  if (typeof token !== 'string' || token.length < 8 || token.length > 64) return 'token-missing';
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return 'token-charset';
  return '';
}

/** 加密后的联系卡 blob。服务端只存不读，所以只校验体积与字符集。 */
export function validateBlob(blob) {
  if (typeof blob !== 'string') return 'blob-missing';
  if (blob.length < 8 || blob.length > 4096) return 'blob-size';
  if (!/^[A-Za-z0-9_-]+$/.test(blob)) return 'blob-charset';
  return '';
}
