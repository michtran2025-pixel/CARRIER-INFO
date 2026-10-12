// Kiểm thử: bookmarklet EMC → dán vào MAU_NHAP → onEdit tự nhập vào LICH_CU_THE.
// Chạy: node apps-script/test/test_paste_import.js   (cần Playwright để lấy dữ liệu bookmarklet thật)
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const HEADER = ['Hãng', 'Service', 'Vessel', 'Voyage', 'POL', 'Terminal POL', 'POD', 'Terminal POD', 'Booking cut-off',
  'SI cut-off', 'VGM cut-off', 'Port (CY) cut-off', 'ETD', 'ETA', 'Direct / T/S', 'Cảng T/S', 'Ghi chú'];

const { makeSheet, loadCodeGs, TZ } = require('./mock');

// Sheets tự đổi "2026-10-30 17:00" thành ô ngày (Date theo múi giờ của file)
function asSheetsCell(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(v);
  if (!m) return v;
  const utc = Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  return new Date(utc - 7 * 3600000);   // Asia/Ho_Chi_Minh = UTC+7
}

(async () => {
  // 1) Lấy dữ liệu thật từ bookmarklet trên trang ShipmentLink đã lưu
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route(/^https?:/, r => r.abort());
  await page.goto('file://' + path.join(__dirname, '..', '..', 'bookmarklet', 'test', 'fixtures', 'emc_hph_sin.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } });
    window.alert = () => {};
  });
  await page.evaluate(src => eval(src), fs.readFileSync(path.join(__dirname, '..', '..', 'bookmarklet', 'evergreen.js'), 'utf8'));
  await page.waitForFunction(() => window.__copied);
  const tsv = await page.evaluate(() => window.__copied);
  await browser.close();

  for (const mode of ['chuỗi', 'ô ngày']) {
    const sheets = {
      MAU_NHAP: makeSheet('MAU_NHAP', 50, 17),
      LICH_CU_THE: makeSheet('LICH_CU_THE', 1501, 27),
      PORTS: makeSheet('PORTS', 20, 3),
      NHAT_KY: makeSheet('NHAT_KY', 1000, 6)
    };
    sheets.MAU_NHAP.g[0] = HEADER.slice();
    sheets.PORTS.g[1][0] = 'Tất cả'; sheets.PORTS.g[2] = ['VNHPH', 'Hai Phong', 'Vietnam']; sheets.PORTS.g[3] = ['SGSIN', 'Singapore', 'Singapore'];
    const toasts = [];
    const { ctx, ss } = loadCodeGs(sheets, toasts);

    // 2) Dán (Ctrl + V) vào A2 → onEdit
    const lines = tsv.split('\n').map(l => l.split('\t').map(v => mode === 'ô ngày' ? asSheetsCell(v) : v));
    const rg = sheets.MAU_NHAP.getRange(2, 1, lines.length, 17);
    rg.setValues(lines);
    ctx.onEdit({ range: rg, source: ss });

    const L = sheets.LICH_CU_THE.g.slice(1).filter(r => r[2] !== '');
    assert.strictEqual(L.length, 5, mode + ': 5 dòng vào LICH_CU_THE');
    const w = L.find(r => r[5] === '0497-042S');
    const ser = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) / 86400000 + 25569;
    assert.strictEqual(w[2], 'EVERGREEN'); assert.strictEqual(w[4], 'EVER WISE'); assert.strictEqual(w[6], 'VNHPH'); assert.strictEqual(w[8], 'SGSIN');
    assert.ok(Math.abs(w[12] - ser(2026, 10, 30, 14)) < 1e-6, mode + ': VGM cut-off');
    assert.ok(Math.abs(w[13] - ser(2026, 10, 30, 17)) < 1e-6, mode + ': Port cut-off');
    assert.ok(Math.abs(w[14] - ser(2026, 11, 3)) < 1e-6, mode + ': ETD');
    assert.ok(Math.abs(w[16] - ser(2026, 11, 8)) < 1e-6, mode + ': ETA');
    assert.strictEqual(w[19], 'Direct');
    assert.ok(sheets.MAU_NHAP.g.slice(1).every(r => r.every(v => v === '')), mode + ': vùng dán đã xoá');
    assert.ok(/thêm 5, cập nhật 0/.test(toasts[0]), mode + ': báo ' + toasts[0]);

    // 3) Dán lại lần 2 → không thêm trùng
    rg.setValues(lines); ctx.onEdit({ range: rg, source: ss });
    assert.strictEqual(sheets.LICH_CU_THE.g.slice(1).filter(r => r[2] !== '').length, 5, mode + ': không trùng');
    assert.ok(/thêm 0, cập nhật 0, không đổi 5/.test(toasts[1]), mode + ': lần 2 ' + toasts[1]);

    // 4) Gõ tay 1 ô hoặc sửa sheet khác → không tự nhập
    const one = sheets.MAU_NHAP.getRange(2, 1, 1, 1); one.setValues([['EVERGREEN']]);
    ctx.onEdit({ range: one, source: ss });
    assert.strictEqual(sheets.MAU_NHAP.g[1][0], 'EVERGREEN', 'gõ 1 ô: giữ nguyên, chưa nhập');
    assert.strictEqual(toasts.length, 2);
  }
  console.log('✅ Dán vào MAU_NHAP → tự nhập: đạt (cả dạng chuỗi và ô ngày)');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
