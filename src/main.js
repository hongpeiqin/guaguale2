import * as store from './store.js';
import { $, test, toast, confirmAction, renderPrizes, renderRecords, celebrate } from './ui.js';
import { ScratchCard } from './scratch.js';
const KEY = 'guaguale2:v1';
let state = store.emptyState(), current = null, revealed = false, filter = 'all', query = '';
let loadError = false;
try { const saved = localStorage.getItem(KEY); if (saved) state = store.parseBackup(saved); } catch { loadError = true; }
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const total = () => state.prizes.reduce((sum, p) => sum + p.count, 0);
const scratch = new ScratchCard(test('scratch-canvas'), reveal, ratio => {
  $('#progress-label').textContent = `${Math.round(ratio * 100)}%`; $('#progress-bar').style.width = `${ratio * 100}%`;
});
function save() {
  try { localStorage.setItem(KEY, store.serialize(state)); } catch { toast('浏览器无法保存数据，请及时导出备份'); }
}
function update(next, refreshCard = false) {
  const wasEmpty = !total();
  state = next; save(); render();
  const p = current && state.prizes.find(p => p.id === current.id);
  if (refreshCard || (wasEmpty && total() > 0) || (!revealed && (!p || !p.count || p.name !== current.name))) newCard();
}
function guarded(action) {
  try { action(); } catch (error) { toast(error.message); render(); }
}
const actions = {
  count(id, value) {
    try {
      if (String(value).trim() === '') throw new Error('请输入数量');
      update(store.setCount(state, id, Number(value)));
      return '';
    } catch (error) { return error.message; }
  },
  rename(id, value) { guarded(() => update(store.rename(state, id, value))); },
  async remove(p) { if (await confirmAction('删除这份奖品？', `将从奖池移除「${p.name}」，已有中奖记录会保留。`)) update(store.removePrize(state, p.id)); }
};
function render() {
  renderPrizes(state, actions); renderRecords(state, filter, query, id => { update(store.redeem(state, id, Date.now())); toast('兑奖成功，开心收下！'); });
}
function newCard() {
  current = store.pickPrize(state.prizes); revealed = false;
  $('#prize-result').classList.remove('pop'); $('#ticket').classList.remove('is-revealed');
  const empty = !current;
  test('empty-pool').hidden = !empty; $('#scratch-surface').hidden = empty;
  $('#empty-title').textContent = state.prizes.length || state.records.length ? '奖池已抽完' : '好运，等你装满';
  $('#fill-pool').textContent = state.prizes.length || state.records.length ? '＋ 补充奖品' : '＋ 添加奖品';
  $('#empty-description').textContent = state.prizes.length || state.records.length ? '快乐不打烊，再补充一点小惊喜吧。' : '先添加喜欢的奖品，再来试试手气吧。';
  $('#prize-result-name').textContent = current?.name || '';
  test('reveal-text').textContent = current ? '轻轻刮开，看看今天的好运' : '添加奖品，开启一份期待';
  test('next-card').disabled = !current; test('next-card').classList.remove('ready');
  $('#card-number').textContent = `NO. ${String(state.records.length + 1).padStart(3, '0')}`;
  scratch.reset(!empty);
}
function reveal() {
  if (!current || revealed) return;
  try {
    const p = state.prizes.find(p => p.id === current.id && p.count > 0);
    if (!p) { newCard(); return; }
    const next = store.commitWin(state, p.id, Date.now(), uid());
    revealed = true; scratch.reveal(); $('#prize-result-name').textContent = p.name;
    $('#prize-result').classList.add('pop'); $('#ticket').classList.add('is-revealed');
    test('reveal-text').textContent = `恭喜获得 ${p.name}`; test('next-card').classList.add('ready');
    update(next); celebrate();
    if (!total()) { toast('奖池已抽完'); $('#progress-label').textContent = '这是最后一份奖品'; }
  } catch (error) { toast(error.message); newCard(); }
}
$('#prize-form').addEventListener('submit', e => {
  e.preventDefault(); const nameInput = test('prize-name-input'), countInput = test('prize-count-input');
  try {
    const next = store.addPrize(state, nameInput.value, Number(countInput.value), uid());
    $('#form-error').textContent = ''; nameInput.removeAttribute('aria-invalid'); countInput.removeAttribute('aria-invalid');
    const wasEmpty = !total(); update(next, wasEmpty); nameInput.value = ''; countInput.value = '1'; nameInput.focus(); toast('惊喜已加入奖池');
  } catch (error) {
    $('#form-error').textContent = error.message;
    const invalid = !nameInput.value.trim() || nameInput.value.trim().length > 80 ? nameInput : countInput;
    invalid.setAttribute('aria-invalid', 'true'); invalid.focus();
  }
});
test('next-card').addEventListener('click', newCard);
$('#fill-pool').addEventListener('click', () => { $('#pool-panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); test('prize-name-input').focus({ preventScroll: true }); });
async function clearData(title) {
  if (await confirmAction(title, '将清空所有奖品和中奖记录，此操作无法撤销。建议先导出备份。')) {
    filter = 'all'; query = ''; test('record-search').value = ''; update(store.emptyState(), true); toast('数据已清空');
  }
}
test('reset-game').addEventListener('click', () => clearData('重置游戏？'));
test('clear-btn').addEventListener('click', () => { $('#data-menu').open = false; clearData('清空所有数据？'); });
for (const node of document.querySelectorAll('[data-filter]')) node.addEventListener('click', () => { filter = node.dataset.filter; renderRecords(state, filter, query, id => { update(store.redeem(state, id, Date.now())); toast('兑奖成功，开心收下！'); }); });
test('record-search').addEventListener('input', e => { query = e.target.value; render(); });
test('redeem-all').addEventListener('click', async () => {
  const ids = store.filterRecords(state.records, filter, query).filter(r => r.redeemTime === null).map(r => r.id);
  if (ids.length && await confirmAction(`确认兑换 ${ids.length} 份奖品？`, `将为当前筛选结果中的 ${ids.length} 条未兑奖记录标记兑奖时间。`)) { update(store.redeemMany(state, ids, Date.now())); toast(`已兑换 ${ids.length} 份奖品`); }
});
test('export-btn').addEventListener('click', async () => {
  $('#data-menu').open = false;
  if (!await confirmAction('导出数据备份？', '将下载包含全部奖品与中奖记录的 JSON 文件。')) return;
  const date = store.formatTime(Date.now()).replaceAll('-', '').replaceAll(':', '').replace(' ', '-');
  const url = URL.createObjectURL(new Blob([store.serialize(state)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `guaguale2-backup-${date}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('备份已导出');
});
$('#import-btn').addEventListener('click', () => { $('#data-menu').open = false; test('import-input').click(); });
test('import-input').addEventListener('change', async e => {
  const input = e.currentTarget, file = input.files[0]; if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('备份文件过大，请使用 20 MB 以内的文件');
    const next = store.parseBackup(await file.text());
    if (await confirmAction('导入备份？将覆盖当前数据', `包含 ${next.prizes.length} 种奖品、${next.records.length} 条记录。将覆盖当前数据，且无法撤销。`)) {
      filter = 'all'; query = ''; test('record-search').value = ''; update(next, true); toast('备份已恢复');
    }
  } catch (error) { toast(error.message); } finally { input.value = ''; }
});
document.addEventListener('click', e => { if (!$('#data-menu').contains(e.target)) $('#data-menu').open = false; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#data-menu').open = false; });
window.__guaguale = { get state() { return structuredClone(state); }, revealNow: reveal };
render(); newCard(); if (loadError) toast('本地数据无法读取，已安全开启空奖池');
