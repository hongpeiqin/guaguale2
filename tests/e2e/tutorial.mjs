import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Separate from the regression flow: every capture is a phone viewport frame.
export async function runTutorial(browser, base, directory) {
  await mkdir(directory, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    hasTouch: true, isMobile: true, reducedMotion: 'no-preference',
  });
  await context.addInitScript(() => {
    let seed = 7;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  });
  const page = await context.newPage(), shots = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const id = name => page.getByTestId(name);
  let cursor = { x: 195, y: 422 }, cursorTarget = null;
  const center = async target => {
    await target.scrollIntoViewIfNeeded();
    cursorTarget = await target.elementHandle();
    const box = await target.boundingBox(); assert(box, '操作目标必须可见');
    cursor = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    return cursor;
  };
  const capture = async (step, note, delay = 350) => {
    if (delay) await page.waitForTimeout(delay);
    const file = `${String(shots.length + 1).padStart(3, '0')}.png`;
    const targetBox = cursorTarget && await cursorTarget.boundingBox();
    if (targetBox) cursor = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
    await page.screenshot({ path: resolve(directory, file), fullPage: false });
    shots.push({ file, step, note, cursor: { ...cursor, scrollY: await page.evaluate(() => scrollY) } });
    // Keep a usable manifest even if a later action fails.
    await writeFile(resolve(directory, 'shots.json'), JSON.stringify(shots, null, 2) + '\n');
  };
  const tap = async target => { await center(target); await target.tap(); };
  const panel = async selector => {
    await page.locator(selector).evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await center(page.locator(selector + ' h2'));
  };
  const records = () => page.evaluate(() => window.__guaguale.state.records.length);
  async function scratch(expected, segments) {
    await page.locator('.play-panel').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
    const canvas = id('scratch-canvas'); await center(canvas);
    const box = await canvas.boundingBox(); assert(box);
    const pointer = { pointerId: 51, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, bubbles: true };
    const dispatch = async (type, x, y) => {
      cursorTarget = null; cursor = { x, y };
      await canvas.dispatchEvent(type, { ...pointer, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y });
    };
    // Half a stripe per segment keeps the first reveal near frame 11–12.
    // The second card uses whole stripes for a shorter, six-frame sequence.
    const halves = segments === 12, rows = halves ? 6 : segments;
    let previous = { x: box.x + 12, y: box.y + 14 };
    await dispatch('pointerdown', previous.x, previous.y);
    for (let segment = 0; segment < segments; segment++) {
      const row = halves ? Math.floor(segment / 2) : segment;
      const y = box.y + 14 + row * 11;
      const left = box.x + 12, right = box.x + box.width - 12, middle = (left + right) / 2;
      const end = halves && segment % 2 === 0 ? middle : row % 2 ? left : right;
      // Start each new stripe on the side where the previous stripe ended.
      for (let sample = 1; sample <= 12; sample++) {
        const fraction = sample / 12;
        await dispatch('pointermove', previous.x + (end - previous.x) * fraction, previous.y + (y - previous.y) * fraction);
      }
      previous = { x: end, y };
      await page.waitForTimeout(40); // let the scratch coverage RAF commit
      await capture(`scratch-${expected}`, `第 ${expected} 张：第 ${segment + 1} 段刮奖`, 0);
      if (await records() >= expected) break;
    }
    // Narrow canvases can need one last stripe because of edge clipping.
    for (let row = rows; await records() < expected && row < rows + 4; row++) {
      const y = box.y + 14 + row * 11, end = previous.x < box.x + box.width / 2 ? box.x + box.width - 12 : box.x + 12;
      for (let sample = 1; sample <= 16; sample++) {
        const fraction = sample / 16;
        await dispatch('pointermove', previous.x + (end - previous.x) * fraction, previous.y + (y - previous.y) * fraction);
      }
      previous = { x: end, y }; await page.waitForTimeout(40);
      await capture(`scratch-${expected}`, `第 ${expected} 张：补充刮开奖面`, 0);
    }
    await dispatch('pointerup', previous.x, previous.y);
    await page.waitForFunction(n => window.__guaguale.state.records.length === n, expected);
    for (let frame = 1; frame <= 3; frame++) await capture(`reveal-${expected}`, `揭晓庆祝动效 ${frame}/3`, 150);
    await page.waitForTimeout(1500);
  }
  try {
    await page.goto(base);
    await id('empty-pool').waitFor({ state: 'visible' });
    assert.equal(await records(), 0);
    await center(id('empty-pool'));
    await capture('home', '空数据首页');
    await panel('#pool-panel');
    const name = id('prize-name-input'), quantity = id('prize-count-input');
    await tap(name);
    for (const text of ['奶', '茶', '一杯']) {
      await name.pressSequentially(text, { delay: 140 }); await center(name);
      await capture('type-prize', `逐字输入：${await name.inputValue()}`);
    }
    await center(quantity); await quantity.fill('2'); await capture('quantity', '奶茶一杯，数量 2');
    await tap(id('add-prize')); await capture('add-prize', '添加奶茶一杯 2 份');
    for (const label of ['电影票', '免作业卡']) {
      await center(name); await name.pressSequentially(label, { delay: 180 });
      await quantity.fill('1'); await tap(id('add-prize')); await capture('add-prize', `添加${label} 1 份`);
    }
    await tap(id('prize-inc').first()); await capture('increase', '奶茶数量增加一次');
    await scratch(1, 12);
    await tap(id('next-card')); await capture('next-card', '开启下一张');
    await scratch(2, 6);
    await page.waitForFunction(() => !document.querySelector('[data-testid=toast]'));
    await panel('#records-panel'); await capture('records', '查看中奖记录');
    await tap(id('redeem-btn').first()); await capture('redeem', '兑换一份奖品');
    await tap(id('filter-redeemed')); await capture('filter-redeemed', '筛选已兑奖');
    await tap(id('filter-unredeemed')); await capture('filter-unredeemed', '筛选未兑奖');
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await tap(page.locator('#data-menu summary')); await capture('data-menu', '打开数据管理菜单');
    await tap(id('export-btn')); await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
    await capture('export-confirm', '导出确认对话框');
    await tap(id('confirm-cancel'));
    assert.deepEqual(errors, [], '教学流程不应有浏览器错误');
    console.log(`教学录制完成：${shots.length} 张 PNG，清单：${resolve(directory, 'shots.json')}`);
  } finally { await context.close(); }
}
