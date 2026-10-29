const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const moduleURL = filename => `data:text/javascript;base64,${readFileSync(resolve(__dirname, '../src', filename)).toString('base64')}`;
const source = readFileSync(resolve(__dirname, '../src/ui.js'), 'utf8').replace("'./store.js'", JSON.stringify(moduleURL('store.js')));
const ready = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
class Node extends EventTarget {
  constructor() { super(); this.children = []; this.dataset = {}; this.isConnected = true; this.open = false; }
  focus() {}
  append(node) { this.children.push(node); node.parent = this; }
  remove() { if (!this.parent) return; this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  get firstElementChild() { return this.children[0]; }
  showModal() { this.open = true; }
  close(value) { this.open = false; this.returnValue = value; setImmediate(() => this.dispatchEvent(new Event('close'))); }
}
test('连续确认框在原生 close 事件排队时仍保留各自选择；Escape 取消', async () => {
  const ui = await ready, dialog = new Node(), form = new Node();
  const nodes = { '#confirm-dialog': dialog, '#confirm-title': new Node(), '#confirm-message': new Node(), '[data-testid="confirm-cancel"]': new Node() };
  dialog.querySelector = () => form;
  const previous = global.document;
  global.document = { querySelector: selector => nodes[selector], activeElement: new Node() };
  const submit = value => { const e = new Event('submit', { cancelable: true }); e.submitter = { value }; form.dispatchEvent(e); assert(e.defaultPrevented); };
  try {
    const clear = ui.confirmAction('清空？', ''); submit('ok');
    assert.equal(await clear, true);
    const imported = ui.confirmAction('导入？', ''); let settled = false;
    imported.then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, '上一个排队的 close 不得取消新确认框');
    submit('ok'); assert.equal(await imported, true);
    const cancel = ui.confirmAction('取消？', '');
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    assert.equal(await cancel, false); assert.equal(dialog.open, false);
  } finally { global.document = previous; }
});
test('Toast 最多两条，先进先出，并在 2200ms 后移除', async () => {
  const ui = await ready, container = new Node(), timers = [];
  const previous = { document: global.document, setTimeout: global.setTimeout };
  global.document = { querySelector: () => container, createElement: () => new Node() };
  global.setTimeout = (callback, delay) => { timers.push({ callback, delay }); };
  try {
    ui.toast('第一条'); ui.toast('第二条'); ui.toast('第三条');
    assert.deepEqual(container.children.map(n => n.textContent), ['第二条', '第三条']);
    assert(timers.every(timer => timer.delay === 2200));
    // A detached node's timer is harmless, just as Element.remove() in the DOM.
    for (const timer of timers) timer.callback();
    assert.equal(container.children.length, 0);
  } finally { Object.assign(global, previous); }
});
