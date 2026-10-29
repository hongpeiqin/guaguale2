import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { runTutorial } from './tutorial.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), screenshotFlag = args.indexOf('--screenshots');
if (screenshotFlag >= 0 && (!args[screenshotFlag + 1] || args[screenshotFlag + 1].startsWith('--'))) throw new Error('--screenshots 需要一个目录参数');
const tutorialFlag = args.indexOf('--tutorial');
if (tutorialFlag >= 0 && (!args[tutorialFlag + 1] || args[tutorialFlag + 1].startsWith('--'))) throw new Error('--tutorial 需要一个目录参数');
const tutorialDir = tutorialFlag >= 0 ? resolve(args[tutorialFlag + 1]) : null;
const screenshotDir = screenshotFlag >= 0 ? resolve(args[screenshotFlag + 1]) : null;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
const temporary = await mkdtemp(resolve(tmpdir(), 'guaguale2-e2e-'));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // Serve under a subpath as an explicit GitHub Pages compatibility check.
    if (!pathname.startsWith('/guaguale2/')) { res.writeHead(404); res.end(); return; }
    const relative = pathname.slice('/guaguale2/'.length) || 'index.html';
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/guaguale2/`;
let browser;
const errors = [];
const id = (page, name) => page.getByTestId(name);
async function snapshot(page, filename, target = null, delay = null) {
  if (!screenshotDir) return;
  if (target) await target.scrollIntoViewIfNeeded();
  if (delay === null) await page.waitForFunction(() => !document.querySelector('[data-testid=toast]'));
  else await page.waitForTimeout(delay);
  if (target && filename === 'desktop-04-records.png') {
    await target.screenshot({ path: resolve(screenshotDir, filename) }); return;
  }
  await page.screenshot({ path: resolve(screenshotDir, filename), fullPage: false });
}
async function state(page) { return page.evaluate(() => window.__guaguale.state); }
async function confirm(page, yes = true) {
  await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
  await id(page, yes ? 'confirm-ok' : 'confirm-cancel').click();
  await page.locator('#confirm-dialog').waitFor({ state: 'hidden' });
}
async function menu(page, action) { await page.locator('#data-menu summary').click(); await id(page, action).click(); }
async function add(page, name, quantity) {
  await id(page, 'prize-name-input').fill(name); await id(page, 'prize-count-input').fill(String(quantity)); await id(page, 'add-prize').click();
  assert((await state(page)).prizes.some(p => p.name === name && p.count === quantity));
}
async function waitWins(page, expected) { await page.waitForFunction(n => window.__guaguale.state.records.length === n, expected); }
async function dragScratch(page, expected, takeHalfScreenshot = false) {
  const canvas = id(page, 'scratch-canvas'); await canvas.scrollIntoViewIfNeeded();
  const b = await canvas.boundingBox(); assert(b && b.width > 0 && b.height > 0);
  const before = await state(page);
  await page.mouse.move(b.x + 12, b.y + 16); await page.mouse.down();
  // Two nearby stripes expose about one third; a second pointerdown resumes the card.
  await page.mouse.move(b.x + b.width - 12, b.y + 16, { steps: 24 });
  await page.mouse.move(b.x + b.width - 12, b.y + 47, { steps: 4 });
  await page.mouse.move(b.x + 12, b.y + 47, { steps: 24 });
  await page.mouse.up(); await page.waitForTimeout(100);
  assert.equal((await state(page)).records.length, before.records.length, '少量刮开不应扣减库存');
  assert.deepEqual((await state(page)).prizes, before.prizes);
  if (takeHalfScreenshot) await snapshot(page, 'desktop-02-scratching.png');
  await page.mouse.move(b.x + 12, b.y + 73); await page.mouse.down();
  for (let y = 73, row = 0; y < b.height; y += 25, row++) {
    await page.mouse.move(b.x + (row % 2 ? 12 : b.width - 12), b.y + y, { steps: 22 });
    await page.waitForTimeout(35);
    if ((await state(page)).records.length >= expected) break;
  }
  await page.mouse.up(); await waitWins(page, expected);
  await id(page, 'reveal-text').filter({ hasText: '恭喜获得' }).waitFor();
}
function track(page) { page.on('pageerror', error => errors.push(error.message)); }
try {
  const options = { headless: true };
  if (process.env.CHROME_PATH) options.executablePath = process.env.CHROME_PATH;
  browser = await chromium.launch(options);
  if (tutorialDir) {
    await runTutorial(browser, base, tutorialDir);
  } else {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await desktop.newPage(); track(page); await page.goto(base);
    await id(page, 'empty-pool').waitFor({ state: 'visible' });
    // Inline errors, Enter submission and zero inventory changes before reveal.
    await id(page, 'add-prize').click(); assert(await page.locator('#form-error').textContent());
    await add(page, '电影票', 1); await add(page, '奶茶一杯', 2);
    assert.equal((await state(page)).records.length, 0);
    await page.reload(); await id(page, 'scratch-canvas').waitFor({ state: 'visible' });
    assert.equal((await state(page)).prizes.reduce((n, p) => n + p.count, 0), 3);
    await snapshot(page, 'desktop-01-home.png');
    await dragScratch(page, 1, true); await snapshot(page, 'desktop-03-revealed.png', null, 300);
    // The hook must also be idempotent on an already revealed card.
    await page.evaluate(() => window.__guaguale.revealNow()); assert.equal((await state(page)).records.length, 1);
    await id(page, 'next-card').click(); await dragScratch(page, 2);
    await id(page, 'next-card').click(); await dragScratch(page, 3);
    assert.equal(await id(page, 'empty-pool').isVisible(), false);
    assert.equal(await page.locator('#progress-label').textContent(), '这是最后一份奖品');
    await id(page, 'toast').filter({ hasText: '奖池已抽完' }).waitFor({ state: 'visible' });
    assert.equal((await state(page)).prizes.reduce((n, p) => n + p.count, 0), 0);
    await id(page, 'next-card').click();
    await id(page, 'empty-pool').waitFor({ state: 'visible' });
    assert.equal(await id(page, 'next-card').isDisabled(), true);
    await snapshot(page, 'desktop-05-empty-pool.png');
    const firstPrize = id(page, 'prize-item').first();
    await firstPrize.getByTestId('prize-inc').click();
    assert.equal((await state(page)).prizes[0].count, 1);
    await firstPrize.getByTestId('prize-dec').click();
    assert.equal((await state(page)).prizes[0].count, 0);
    await firstPrize.getByTestId('prize-count').fill('');
    await page.locator('#pool-heading').click();
    assert.equal(await firstPrize.getByTestId('prize-count').inputValue(), '0');
    assert.equal(await firstPrize.locator('.quantity-error').textContent(), '');
    await firstPrize.getByTestId('prize-count').fill('3'); await firstPrize.getByTestId('prize-count').press('Enter');
    assert.equal((await state(page)).prizes[0].count, 3);
    await firstPrize.getByTestId('prize-count').fill('-1'); await firstPrize.getByTestId('prize-count').press('Enter');
    assert.equal((await state(page)).prizes[0].count, 3, '负库存应拒绝');
    assert.match(await firstPrize.locator('.quantity-error').textContent(), /数量须/);
    assert.equal(await id(page, 'toast').filter({ hasText: '数量须' }).count(), 0);
    await firstPrize.getByTestId('prize-count').press('Escape');
    // Rename with an Enter commit and ensure historical names remain snapshots.
    await firstPrize.getByTestId('prize-name').click();
    await firstPrize.getByRole('textbox', { name: '编辑奖品名称' }).fill('免作业卡');
    await firstPrize.getByRole('textbox', { name: '编辑奖品名称' }).press('Enter');
    assert.equal((await state(page)).prizes[0].name, '免作业卡');
    await id(page, 'redeem-btn').first().click();
    assert.equal((await state(page)).records.filter(r => r.redeemTime !== null).length, 1);
    assert.match(await id(page, 'filter-all').textContent(), /3/);
    assert.match(await id(page, 'filter-unredeemed').textContent(), /2/);
    assert.match(await id(page, 'filter-redeemed').textContent(), /1/);
    await id(page, 'filter-redeemed').click(); assert.equal(await id(page, 'record-item').count(), 1);
    await id(page, 'filter-unredeemed').click(); assert.equal(await id(page, 'record-item').count(), 2);
    const unredeemed = (await state(page)).records.filter(r => r.redeemTime === null);
    await id(page, 'record-search').fill(unredeemed[0].prize);
    assert.equal(await id(page, 'record-item').count(), unredeemed.filter(r => r.prize.includes(unredeemed[0].prize)).length);
    await id(page, 'record-search').fill('');
    await snapshot(page, 'desktop-04-records.png', page.locator('#records-panel'));
    await id(page, 'redeem-all').click();
    assert.match(await page.locator('#confirm-title').textContent(), /2/);
    await snapshot(page, 'desktop-06-confirm-dialog.png'); await confirm(page);
    assert.equal((await state(page)).records.filter(r => r.redeemTime === null).length, 0);
    await id(page, 'filter-all').click(); assert.equal(await id(page, 'record-item').count(), 3);
    assert.match(await id(page, 'filter-redeemed').textContent(), /3/);
    await menu(page, 'export-btn');
    const downloadPromise = page.waitForEvent('download'); await confirm(page);
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^guaguale2-backup-\d{8}-\d{4}\.json$/);
    const backupPath = resolve(temporary, download.suggestedFilename()); await download.saveAs(backupPath);
    const backup = JSON.parse(await readFile(backupPath, 'utf8'));
    assert.equal(backup.version, 1); assert.equal(backup.prizes.length, 2); assert.equal(backup.records.length, 3);
    assert.deepEqual(backup, await state(page));
    await menu(page, 'clear-btn'); await confirm(page, false); assert.deepEqual(await state(page), backup);
    await menu(page, 'clear-btn'); await confirm(page); assert.equal((await state(page)).prizes.length, 0); assert.equal((await state(page)).records.length, 0);
    await id(page, 'import-input').setInputFiles(backupPath); await confirm(page); await page.waitForFunction(expected => JSON.stringify(window.__guaguale.state) === JSON.stringify(expected), backup); assert.deepEqual(await state(page), backup);
    await page.reload(); await page.waitForFunction(() => window.__guaguale?.state.records.length === 3); assert.deepEqual(await state(page), backup);
    // Importing the same file again must fire change after the input reset.
    await id(page, 'import-input').setInputFiles(backupPath); await confirm(page);
    await page.waitForFunction(() => document.querySelector('#import-input').value === '');
    assert.deepEqual(await state(page), backup);
    // A bad import is rejected without replacing valid data.
    const badPath = resolve(temporary, 'invalid.json'); await writeFile(badPath, '{"version":1,"prizes":false}');
    await id(page, 'import-input').setInputFiles(badPath); await id(page, 'toast').filter({ hasText: '备份格式或版本无效' }).waitFor(); assert.deepEqual(await state(page), backup);
    // Escape cancels and returns focus to a live control.
    await id(page, 'reset-game').click(); await page.keyboard.press('Escape'); assert.deepEqual(await state(page), backup);
    assert.equal(await page.locator('#confirm-dialog').isVisible(), false);
    await desktop.close();

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const touchPage = await mobile.newPage(); track(touchPage); await touchPage.goto(base);
    await add(touchPage, '神秘大奖', 2); await add(touchPage, '奶茶一杯', 1);
    await touchPage.evaluate(() => scrollTo(0, 0)); await snapshot(touchPage, 'mobile-01-home.png');
    const touchCanvas = id(touchPage, 'scratch-canvas');
    await touchCanvas.scrollIntoViewIfNeeded(); const box = await touchCanvas.boundingBox(); assert(box);
    const pointer = { pointerId: 41, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, bubbles: true };
    await touchCanvas.dispatchEvent('pointerdown', { ...pointer, clientX: box.x + 12, clientY: box.y + 15 });
    outer: for (let row = 0; row < Math.ceil(box.height / 24); row++) {
      const y = box.y + Math.min(15 + row * 24, box.height - 4);
      for (let step = 0; step <= 18; step++) {
        const fraction = row % 2 ? 1 - step / 18 : step / 18;
        await touchCanvas.dispatchEvent('pointermove', { ...pointer, clientX: box.x + 12 + fraction * (box.width - 24), clientY: y });
      }
      await touchPage.waitForTimeout(45);
      if ((await state(touchPage)).records.length === 1) break outer;
    }
    await touchCanvas.dispatchEvent('pointerup', { ...pointer, buttons: 0, clientX: box.x + 12, clientY: box.y + box.height - 5 });
    await waitWins(touchPage, 1); await touchPage.evaluate(() => scrollTo(0, 0));
    await snapshot(touchPage, 'mobile-02-revealed.png', null, 300);
    await snapshot(touchPage, 'mobile-03-prizes.png', touchPage.locator('#pool-panel'));
    await snapshot(touchPage, 'mobile-04-records.png', touchPage.locator('#records-panel'));
    assert.equal(await touchPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '手机页面不应横向溢出');
    await mobile.close();
    assert.deepEqual(errors, [], '浏览器不应有未捕获错误');
    console.log('完整流程通过：鼠标 / 触屏刮奖、库存、兑奖、筛选、导出、清空与导入。');
    if (screenshotDir) console.log(`截图已写入：${screenshotDir}`);
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
