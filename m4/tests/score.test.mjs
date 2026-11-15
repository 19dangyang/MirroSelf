import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreCards as serverScore, bandOf, overlapCounts, cosine } from '../lib/score.js';
// 交叉验证：服务端打分必须和插件里的实现逐位相等，否则"服务器说同频、你本地算出不同"就成了两套真相
import { scoreCards as clientScore, band as clientBand } from '../../extension/src/core/score.js';

const cardA = { p: { 科技: 15, 生活: 4 }, g: { 装机: 15, 硬件: 12, 水冷: 5 } };
const cardB = { p: { 科技: 12, 游戏: 6 }, g: { 硬件: 14, 显卡: 9 } };
const cardC = { p: { 音乐: 15 }, g: { 混音: 15, 编曲: 11 } };

test('服务端与客户端的分数逐位相等', () => {
  const pairs = [
    [cardA, cardB],
    [cardA, cardC],
    [cardB, cardC],
    [cardA, cardA],
  ];
  for (const [a, b] of pairs) {
    const s = serverScore(a, b);
    const c = clientScore(a, b).score;
    assert.equal(s, c, `分数不一致：server=${s} client=${c}`);
  }
});

test('服务端分档与客户端一致', () => {
  for (const score of [0, 0.19, 0.2, 0.44, 0.45, 0.9, 1]) {
    assert.equal(bandOf(score).level, clientBand(score).level, `分值 ${score}`);
  }
});

test('cosine 基本性质', () => {
  assert.equal(cosine({ a: 1 }, { a: 1 }), 1);
  assert.equal(cosine({ a: 1 }, { b: 1 }), 0);
  assert.equal(cosine({}, { a: 1 }), 0);
});

test('缺失信号不重新归一化：只有标签时最高 0.45', () => {
  const onlyTags = { p: {}, g: cardA.g };
  const s = serverScore(cardA, onlyTags);
  assert.ok(Math.abs(s - 0.45) < 1e-9, `实际 ${s}`);
});

test('共同点只回数量，不回名字', () => {
  const o = overlapCounts(cardA, cardB);
  assert.deepEqual(o, { partitions: 1, tags: 1 });
  const json = JSON.stringify(o);
  assert.equal(json.includes('科技'), false, '响应里不能出现分区名');
  assert.equal(json.includes('硬件'), false, '响应里不能出现标签名');
});
