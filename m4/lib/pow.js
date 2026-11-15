/**
 * 工作量证明：建号时要求客户端做一点廉价计算，挡住"批量建号刷候选池"。
 *
 * 实现刻意只用 **WebCrypto + 全大写 globals**，这样同一份代码能跑在
 * Node 20 / Cloudflare Workers / Deno / 浏览器里，不需要按运行时分叉。
 * （早先版本用了 node:crypto 的 createHash，Workers 上直接跑不起来。）
 */

import { POW_BITS, POW_SALT } from './config.js';

const enc = new TextEncoder();

/** SHA-256 摘要，返回 Uint8Array。 */
export async function powDigest(nonce) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error('当前运行时没有 WebCrypto');
  const buf = await subtle.digest('SHA-256', enc.encode(`${POW_SALT}:${nonce}`));
  return new Uint8Array(buf);
}

export function leadingZeroBits(bytes) {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    let b = byte;
    let z = 0;
    while ((b & 0x80) === 0) {
      z += 1;
      b = (b << 1) & 0xff;
    }
    bits += z;
    break;
  }
  return bits;
}

/** 校验 nonce 是否满足难度。这里是 async 的，调用方要 await。 */
export async function verifyPow(nonce, bits = POW_BITS) {
  if (typeof nonce !== 'string' || nonce.length < 1 || nonce.length > 64) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(nonce)) return false;
  return leadingZeroBits(await powDigest(nonce)) >= bits;
}

/** 生成匿名 token：WebCrypto 随机源，任何运行时都有。 */
export function randomToken(bytes = 16) {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return base64url(buf);
}

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  // btoa 在 Node 20 / Workers / 浏览器里都有
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
