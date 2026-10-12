// Kiểm thử bookmarklet Evergreen trên trang ShipmentLink đã lưu, bằng Chromium thật.
// Chạy: node bookmarklet/test/test_evergreen.js
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require('playwright');
const { build } = require('../build');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'evergreen.js'), 'utf8');
const FIXTURE = 'file://' + path.join(__dirname, 'fixtures', 'emc_hph_sin.html');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Trang lưu offline: chặn mọi tải từ mạng cho nhanh
  await page.route(/^https?:/, r => r.abort());
  await page.goto(FIXTURE, { waitUntil: 'domcontentloaded' });

  // 1) Dữ liệu đọc được
  const rows = await page.evaluate(src => { window.__emcTest = true; eval(src); return window.__emcRows; }, SRC);
  assert.strictEqual(rows.length, 5, 'phải có 5 chuyến');
  const byVoy = {};
  rows.forEach(r => { assert.strictEqual(r.cells.length, 17, 'đủ 17 cột'); byVoy[r.cells[3]] = r.cells; });
  assert.deepStrictEqual(byVoy['0497-042S'], [
    'EVERGREEN', 'CVM', 'EVER WISE', '0497-042S', 'VNHPH', '', 'SGSIN', '',
    '', '', '2026-10-30 14:00', '2026-10-30 17:00', '2026-11-03', '2026-11-08', 'Direct', '', ''
  ]);
  assert.deepStrictEqual(byVoy['0494-046S'].slice(10, 15), ['2026-10-09 10:00', '2026-10-09 17:00', '2026-10-12', '2026-10-17', 'Direct']);
  assert.deepStrictEqual(byVoy['0498-048S'].slice(2, 14), ['EVER WILL', '0498-048S', 'VNHPH', '', 'SGSIN', '', '', '', '2026-11-05 10:00', '2026-11-05 17:00', '2026-11-07', '2026-11-13']);

  // 2) Bấm bookmarklet thật (bản rút gọn javascript:) → clipboard, sắp xếp theo ETD
  await page.evaluate(() => {
    delete window.__emcTest;
    window.__copied = null; window.__alert = null;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } });
    window.alert = m => { window.__alert = m; };
  });
  const url = build(SRC);
  await page.evaluate(code => { (0, eval)(decodeURIComponent(code.slice('javascript:'.length))); }, url);
  await page.waitForFunction(() => window.__alert);
  const tsv = await page.evaluate(() => window.__copied);
  const lines = tsv.split('\n');
  assert.strictEqual(lines.length, 5);
  assert.deepStrictEqual(lines.map(l => l.split('\t')[12]), ['2026-10-12', '2026-10-18', '2026-10-24', '2026-11-03', '2026-11-07']);
  lines.forEach(l => assert.strictEqual(l.split('\t').length, 17));
  assert.ok(/Đã copy 5 chuyến/.test(await page.evaluate(() => window.__alert)));

  // 3) Chuyến chuyển tải: thêm chặng 2 vào Routing Details của seq=14
  await page.evaluate(() => {
    const tb = document.querySelector('#detailSeq14 table tbody');
    const first = tb.querySelector('tr');
    first.children[2].textContent = 'KAOHSIUNG, TAIWAN';
    const leg2 = first.cloneNode(true);
    leg2.children[0].textContent = '2';
    leg2.children[1].textContent = 'KAOHSIUNG, TAIWAN';
    leg2.children[2].textContent = 'SINGAPORE';
    leg2.children[5].textContent = 'CIX';
    leg2.children[6].textContent = 'EVER GIVEN 1234-567S';
    tb.appendChild(leg2);
    window.__emcTest = true;
  });
  const ts = await page.evaluate(src => { eval(src); return window.__emcRows; }, SRC);
  const r = ts.find(x => x.cells[3] === '0497-042S').cells;
  assert.deepStrictEqual(r.slice(14), ['T/S', 'TWKHH', 'Nối tàu EVER GIVEN 1234-567S (CIX)']);

  // 4) Trang không phải trang kết quả → báo, không copy
  await page.setContent('<html><body><p>Trang khác</p></body></html>');
  await page.evaluate(() => { delete window.__emcTest; window.__alert = null; window.alert = m => { window.__alert = m; }; });
  await page.evaluate(src => eval(src), SRC);
  assert.ok(/Không thấy lịch tàu/.test(await page.evaluate(() => window.__alert)));

  await browser.close();
  console.log('✅ Tất cả kiểm thử bookmarklet Evergreen đều đạt');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
