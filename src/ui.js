import { filterRecords, formatTime } from './store.js';
export const $ = selector => document.querySelector(selector);
export const test = name => $(`[data-testid="${name}"]`);
// All dynamic content is inserted as text nodes or input values, never HTML.
export function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function button(text, testId, label, action, className = '') {
  const node = el('button', text, className); node.type = 'button';
  if (testId) node.dataset.testid = testId;
  node.setAttribute('aria-label', label); node.addEventListener('click', action); return node;
}
export function toast(message) {
  const node = el('div', message, 'toast'); node.dataset.testid = 'toast';
  const container = $('#toasts');
  while (container.children.length >= 2) container.firstElementChild.remove();
  container.append(node); setTimeout(() => node.remove(), 2200);
}
export function confirmAction(title, message) {
  const dialog = $('#confirm-dialog');
  if (dialog.open) return Promise.resolve(false);
  const previous = document.activeElement;
  $('#confirm-title').textContent = title; $('#confirm-message').textContent = message;
  return new Promise(resolve => {
    const form = dialog.querySelector('form');
    const finish = value => {
      form.removeEventListener('submit', submit);
      dialog.removeEventListener('cancel', cancel);
      if (dialog.open) dialog.close(value);
      if (previous?.isConnected) previous.focus(); else test('prize-name-input').focus();
      resolve(value === 'ok');
    };
    // Capture the choice before another dialog can reset returnValue. Native close
    // events are queued, so waiting for close alone races consecutive operations.
    const submit = event => { event.preventDefault(); finish(event.submitter?.value || 'cancel'); };
    const cancel = event => { event.preventDefault(); finish('cancel'); };
    form.addEventListener('submit', submit);
    dialog.addEventListener('cancel', cancel);
    dialog.returnValue = ''; dialog.showModal(); test('confirm-cancel').focus();
  });
}
export function renderPrizes(state, actions) {
  const list = $('#prize-list'); list.replaceChildren();
  $('#pool-total').textContent = state.prizes.reduce((sum, p) => sum + p.count, 0);
  $('#prize-types').textContent = `${state.prizes.length} 种`;
  if (!state.prizes.length) list.append(el('div', '奖池还是空的，添加第一份惊喜吧。', 'list-empty'));
  state.prizes.forEach((p, index) => {
    const row = el('div', undefined, 'prize-row'); row.dataset.testid = 'prize-item'; row.dataset.id = p.id;
    const icon = el('span', ['✦', '♡', '✿', '◇'][index % 4], `prize-icon tone-${index % 4}`); icon.setAttribute('aria-hidden', 'true');
    const title = button(p.name, 'prize-name', `重命名 ${p.name}`, () => {
      const input = el('input'); input.value = p.name; input.maxLength = 80; input.className = 'rename-input'; input.setAttribute('aria-label', '编辑奖品名称');
      title.replaceWith(input); input.focus(); input.select(); let done = false;
      const save = () => { if (done) return; done = true; actions.rename(p.id, input.value); };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { done = true; input.replaceWith(title); title.focus(); }
      });
    }, 'prize-name');
    const stepper = el('div', undefined, 'stepper');
    const input = el('input'); input.type = 'number'; input.min = '0'; input.max = '1000000'; input.step = '1'; input.value = p.count; input.dataset.testid = 'prize-count'; input.setAttribute('aria-label', `${p.name} 剩余数量`);
    const error = el('span', '', 'quantity-error'); error.id = `quantity-error-${index}`; error.setAttribute('role', 'alert');
    input.setAttribute('aria-describedby', error.id);
    const save = (explicit = false) => {
      if (!input.value.trim() && !explicit) { input.value = p.count; return; }
      if (input.value === String(p.count)) return;
      const message = actions.count(p.id, input.value);
      if (message) { error.textContent = message; input.setAttribute('aria-invalid', 'true'); }
    };
    input.addEventListener('input', () => { error.textContent = ''; input.removeAttribute('aria-invalid'); });
    input.addEventListener('blur', event => {
      if (stepper.contains(event.relatedTarget)) { input.value = p.count; return; }
      save();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); save(true); }
      if (e.key === 'Escape') { input.value = p.count; error.textContent = ''; input.removeAttribute('aria-invalid'); }
    });
    stepper.append(button('−', 'prize-dec', `减少 ${p.name} 数量`, () => actions.count(p.id, p.count - 1)), input, button('＋', 'prize-inc', `增加 ${p.name} 数量`, () => actions.count(p.id, p.count + 1)));
    stepper.firstChild.disabled = p.count === 0; stepper.lastChild.disabled = p.count === 1000000;
    row.append(icon, title, stepper, button('×', 'prize-delete', `删除 ${p.name}`, () => actions.remove(p), 'delete-prize'), error); list.append(row);
  });
}
export function renderRecords(state, filter, query, onRedeem) {
  $('#record-total').textContent = state.records.length;
  for (const key of ['all', 'unredeemed', 'redeemed']) {
    const node = test(`filter-${key}`); node.querySelector('span').textContent = filterRecords(state.records, key).length; node.setAttribute('aria-pressed', String(filter === key));
  }
  const visible = filterRecords(state.records, filter, query);
  const available = visible.filter(r => r.redeemTime === null).length;
  test('redeem-all').disabled = !available; test('redeem-all').textContent = available ? `一键兑奖 (${available})` : '一键兑奖';
  const list = $('#record-list'); list.replaceChildren();
  if (!visible.length) list.append(el('div', state.records.length ? '没有找到符合条件的记录' : '还没有幸运记录，刮开第一张试试吧。', 'list-empty records-empty'));
  const positions = new Map(state.records.map((r, i) => [r.id, i + 1]));
  for (const r of visible) {
    const row = el('article', undefined, 'record-row'); row.dataset.testid = 'record-item';
    row.append(el('span', String(positions.get(r.id)).padStart(2, '0'), 'record-number'), el('strong', r.prize, 'record-prize'));
    const win = el('span', undefined, 'record-time'); win.append(el('span', '中奖时间', 'mobile-label'), document.createTextNode(formatTime(r.time)));
    const redeemed = el('span', undefined, 'record-time'); redeemed.append(el('span', '兑奖时间', 'mobile-label'), document.createTextNode(r.redeemTime === null ? '—' : formatTime(r.redeemTime)));
    row.append(win, redeemed);
    row.append(r.redeemTime === null ? button('兑奖', 'redeem-btn', `兑换 ${r.prize}`, () => onRedeem(r.id), 'redeem-button') : el('span', '✓ 已兑奖', 'redeemed-badge'));
    list.append(row);
  }
}
let celebrationTimer;
export function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  clearTimeout(celebrationTimer);
  const container = $('#confetti'); container.replaceChildren();
  for (let i = 0; i < 36; i++) {
    const piece = el('i', undefined, 'confetti'); piece.style.left = `${Math.random() * 100}%`; piece.style.background = ['#ef7056', '#dfb95d', '#76938a', '#f3b7a4'][i % 4];
    piece.style.setProperty('--drift', `${(Math.random() - .5) * 180}px`); piece.style.animationDelay = `${Math.random() * .1}s`; container.append(piece);
  }
  celebrationTimer = setTimeout(() => container.replaceChildren(), 1500);
}
