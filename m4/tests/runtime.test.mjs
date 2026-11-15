import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Cloudflare Workers 的运行时限制是**静态**的：没有 process、没有 node: 内置模块。
 * 这两类问题在 Node 里跑测试完全测不出来（Node 里一切正常），一上线就是整个 Worker 500。
 * 所以这里直接扫源码。
 */

const M4 = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** worker.js 直接或间接引入的模块 */
const CHAIN = [
  'worker.js',
  'lib/store.js',
  'lib/pool.js',
  'lib/match.js',
  'lib/keys.js',
  'lib/validate.js',
  'lib/pow.js',
  'lib/config.js',
  'lib/score.js',
];

const read = (rel) => readFileSync(join(M4, rel), 'utf8');

/** 注释里提到 process 不算数，扫之前先剥掉注释（注意别把 https:// 当成行注释）。 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('Workers：依赖链里的文件都存在', () => {
  for (const rel of CHAIN) assert.ok(existsSync(join(M4, rel)), `缺少 ${rel}`);
});

test('Workers：依赖链不引用 node: 内置模块', () => {
  const offenders = [];
  for (const rel of CHAIN) {
    const src = stripComments(read(rel));
    const hits = src.match(/from\s+['"]node:[^'"]+['"]/g) || [];
    if (hits.length) offenders.push(`${rel}: ${hits.join(', ')}`);
  }
  assert.deepEqual(offenders, [], '这些模块在 Workers 上不存在，请换成 Web API');
});

test('Workers：用到 process 的文件必须有运行时探测', () => {
  const offenders = [];
  for (const rel of CHAIN) {
    const src = stripComments(read(rel));
    if (!/\bprocess\b/.test(src)) continue;
    const guarded = /typeof\s+process\s*!==\s*['"]undefined['"]/.test(src);
    if (!guarded) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], '裸用 process 会在 Workers 导入阶段抛 ReferenceError');
});

test('Workers：入口文件导出 fetch 处理器', () => {
  const src = read('worker.js');
  assert.match(src, /export default createWorker\(/);
  assert.match(src, /async fetch\(request, env/);
});

test('仓库根有 wrangler.toml，且 main 指向 m4/worker.js', () => {
  const rootConfig = resolve(M4, '..', 'wrangler.toml');
  assert.ok(existsSync(rootConfig), 'Cloudflare 的 Git 部署在仓库根找 wrangler.toml');
  const src = readFileSync(rootConfig, 'utf8');
  assert.match(src, /main\s*=\s*"m4\/worker\.js"/);
  assert.equal(/KV_REST_API_TOKEN\s*=\s*"/.test(src), false, 'token 不能写进仓库');
});
