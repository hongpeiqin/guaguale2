export const VERSION = 1;
export const emptyState = () => ({ version: VERSION, prizes: [], records: [] });
const validCount = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000;
const validName = s => typeof s === 'string' && s.trim().length > 0 && s.length <= 80;
const validId = s => typeof s === 'string' && s.length > 0 && s.length <= 100;
const validTime = n => Number.isSafeInteger(n) && n >= 0 && n <= 8640000000000000;
function count(n) { if (!validCount(n)) throw new Error('数量须为 0 至 1000000 的整数'); return n; }
function name(s) { if (!validName(s)) throw new Error('请输入 1 至 80 字的奖品名称'); return s.trim(); }
function total(prizes) { return prizes.reduce((sum, p) => sum + p.count, 0); }
export function pickPrize(prizes, rng = Math.random) {
  const sum = total(prizes);
  if (!sum) return null;
  const value = rng();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('随机数须在 [0, 1) 内');
  let weight = value * sum;
  for (const p of prizes) { if (weight < p.count) return { ...p }; weight -= p.count; }
  return null;
}
export function addPrize(state, text, amount, id) {
  const label = name(text); count(amount);
  if (!amount) throw new Error('添加数量至少为 1');
  const existing = state.prizes.find(p => p.name === label);
  if (existing) return setCount(state, existing.id, count(existing.count + amount));
  if (!validId(id) || state.prizes.some(p => p.id === id)) throw new Error('奖品标识无效');
  return { ...state, prizes: [...state.prizes, { id, name: label, count: amount }] };
}
export function setCount(state, id, amount) {
  count(amount);
  return { ...state, prizes: state.prizes.map(p => p.id === id ? { ...p, count: amount } : p) };
}
export function rename(state, id, text) {
  const label = name(text);
  if (state.prizes.some(p => p.id !== id && p.name === label)) throw new Error('该名称已存在，请使用其他名称');
  return { ...state, prizes: state.prizes.map(p => p.id === id ? { ...p, name: label } : p) };
}
export function removePrize(state, id) { return { ...state, prizes: state.prizes.filter(p => p.id !== id) }; }
export function commitWin(state, prizeId, time, recordId) {
  const p = state.prizes.find(p => p.id === prizeId && p.count > 0);
  if (!p) throw new Error('该奖品已无库存，请开启新卡');
  if (!validTime(time) || !validId(recordId) || state.records.some(r => r.id === recordId)) throw new Error('中奖记录无效');
  return { ...setCount(state, p.id, p.count - 1), records: [...state.records, { id: recordId, prize: p.name, time, redeemTime: null }] };
}
export function redeemMany(state, ids, time) {
  if (!validTime(time)) throw new Error('兑奖时间无效');
  const selected = new Set(ids);
  return { ...state, records: state.records.map(r => selected.has(r.id) && r.redeemTime === null ? { ...r, redeemTime: Math.max(time, r.time) } : r) };
}
export function redeem(state, id, time) { return redeemMany(state, [id], time); }
export function filterRecords(records, filter = 'all', query = '') {
  const q = query.trim().toLocaleLowerCase();
  return records.filter(r => (filter === 'all' || (filter === 'redeemed' ? r.redeemTime !== null : r.redeemTime === null)) && r.prize.toLocaleLowerCase().includes(q));
}
export function parseBackup(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('无法读取 JSON 文件'); }
  if (!data || data.version !== VERSION || !Array.isArray(data.prizes) || !Array.isArray(data.records) || data.prizes.length > 10000 || data.records.length > 100000) throw new Error('备份格式或版本无效');
  const prizes = data.prizes.map(p => {
    if (!p || !validId(p.id) || !validName(p.name) || !validCount(p.count)) throw new Error('备份包含无效奖品');
    return { id: p.id, name: p.name.trim(), count: p.count };
  });
  const records = data.records.map(r => {
    if (!r || !validId(r.id) || !validName(r.prize) || !validTime(r.time) || !(r.redeemTime === null || (validTime(r.redeemTime) && r.redeemTime >= r.time))) throw new Error('备份包含无效记录');
    return { id: r.id, prize: r.prize.trim(), time: r.time, redeemTime: r.redeemTime };
  });
  if (new Set(prizes.map(p => p.id)).size !== prizes.length || new Set(prizes.map(p => p.name)).size !== prizes.length || new Set(records.map(r => r.id)).size !== records.length) throw new Error('备份包含重复标识或名称');
  return { version: VERSION, prizes, records };
}
export function serialize(state) { return JSON.stringify(parseBackup(JSON.stringify(state)), null, 2); }
export function formatTime(time) {
  const d = new Date(time), pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
