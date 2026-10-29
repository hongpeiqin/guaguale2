const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
// A data URL loads the browser ES module on Node without package-level metadata.
const ready = import(`data:text/javascript;base64,${readFileSync(resolve(__dirname, '../src/store.js')).toString('base64')}`);
const make = s => s.addPrize(s.addPrize(s.emptyState(), '电影票', 1, 'p1'), '奶茶一杯', 2, 'p2');
test('加权抽取精确边界、零库存和空奖池', async () => {
  const s = await ready, state = make(s);
  assert.equal(s.pickPrize([], () => 0), null);
  assert.equal(s.pickPrize([{ ...state.prizes[0], count: 0 }], () => 0), null);
  assert.equal(s.pickPrize(state.prizes, () => 0).id, 'p1');
  assert.equal(s.pickPrize(state.prizes, () => 1 / 3 - Number.EPSILON).id, 'p1');
  assert.equal(s.pickPrize(state.prizes, () => 1 / 3).id, 'p2');
  assert.equal(s.pickPrize(state.prizes, () => .999999).id, 'p2');
  assert.throws(() => s.pickPrize(state.prizes, () => 1));
  assert.throws(() => s.pickPrize(state.prizes, () => -1));
  assert.throws(() => s.pickPrize(state.prizes, () => NaN));
  assert.equal(state.prizes[0].count, 1);
});
test('同名累加并保持输入不可变；名称和数量校验', async () => {
  const s = await ready, state = make(s);
  assert.equal(s.addPrize(state, ' 电影票 ', 3, 'unused').prizes[0].count, 4);
  assert.equal(state.prizes[0].count, 1);
  for (const n of [-1, 1.5, NaN, Infinity, 1000001]) assert.throws(() => s.setCount(state, 'p1', n));
  assert.equal(s.setCount(state, 'p1', 0).prizes[0].count, 0);
  assert.throws(() => s.addPrize(state, '  ', 1, 'p3'));
  assert.throws(() => s.addPrize(state, '大奖', 0, 'p3'));
  assert.throws(() => s.addPrize(state, '大奖', 1, 'p1'));
  assert.throws(() => s.addPrize(state, '奖'.repeat(81), 1, 'p3'));
});
test('重命名、删除及历史记录独立', async () => {
  const s = await ready, state = s.commitWin(make(s), 'p1', 100, 'r1');
  const renamed = s.rename(state, 'p1', '免作业卡');
  assert.equal(renamed.prizes[0].name, '免作业卡'); assert.equal(renamed.records[0].prize, '电影票');
  assert.throws(() => s.rename(state, 'p1', '奶茶一杯'));
  assert.equal(s.removePrize(state, 'p1').prizes.length, 1);
  assert.equal(s.removePrize(state, 'p1').records.length, 1);
});
test('选卡不扣库存，提交恰好扣一份；无库存、重复记录拒绝', async () => {
  const s = await ready, state = make(s); s.pickPrize(state.prizes, () => 0);
  assert.equal(state.prizes[0].count, 1); assert.equal(state.records.length, 0);
  const next = s.commitWin(state, 'p1', 100, 'r1');
  assert.equal(next.prizes[0].count, 0); assert.equal(next.records.length, 1); assert.equal(next.records[0].redeemTime, null);
  assert.throws(() => s.commitWin(next, 'p1', 101, 'r2'));
  assert.throws(() => s.commitWin(next, 'p2', 101, 'r1'));
});
test('筛选、关键字搜索及批量兑奖只处理选中未兑奖记录', async () => {
  const s = await ready;
  let state = s.commitWin(make(s), 'p1', 100, 'r1');
  state = s.commitWin(state, 'p2', 101, 'r2'); state = s.commitWin(state, 'p2', 102, 'r3');
  state = s.redeem(state, 'r1', 200);
  assert.equal(s.filterRecords(state.records, 'all').length, 3);
  assert.equal(s.filterRecords(state.records, 'redeemed').length, 1);
  assert.equal(s.filterRecords(state.records, 'unredeemed', ' 奶茶 ').length, 2);
  assert.equal(s.filterRecords(state.records, 'all', '不存在').length, 0);
  state = s.redeemMany(state, ['r1', 'r2', 'missing'], 300);
  assert.equal(state.records[0].redeemTime, 200); assert.equal(state.records[1].redeemTime, 300); assert.equal(state.records[2].redeemTime, null);
  state = s.redeemMany(state, ['r3'], 301);
  assert.equal(s.filterRecords(state.records, 'unredeemed').length, 0);
});
test('JSON 往返只保留 schema 字段，拒绝坏数据', async () => {
  const s = await ready, state = s.commitWin(make(s), 'p1', 100, 'r1');
  assert.deepEqual(s.parseBackup(s.serialize(state)), state);
  const bad = [null, {}, { ...state, version: 2 }, { ...state, prizes: 'bad' }, { ...state, prizes: [{ id: 'x', name: '奖品', count: -1 }] }, { ...state, prizes: [state.prizes[0], state.prizes[0]] }, { ...state, records: [{ ...state.records[0], redeemTime: 'bad' }] }, { ...state, records: [{ ...state.records[0], redeemTime: 99 }] }, { ...state, records: [{ ...state.records[0], time: 1e20 }] }];
  for (const data of bad) assert.throws(() => s.parseBackup(JSON.stringify(data)));
  assert.throws(() => s.parseBackup('{bad'));
  assert.equal(s.parseBackup(s.serialize(state)).records[0].prize, '电影票');
});
test('日期格式符合本地 YYYY-MM-DD HH:mm', async () => {
  const s = await ready;
  assert.equal(s.formatTime(new Date(2026, 0, 2, 3, 4).getTime()), '2026-01-02 03:04');
});
