// Kiểm thử: file text lịch Evergreen (ShipmentLink "Schedules_yyyymmdd.txt") → Inbox → LICH_CU_THE.
// Chạy: node apps-script/test/test_emc_text.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { makeSheet, loadCodeGs } = require('./mock');

const FILE = 'Schedules_20261012.txt';
const TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', FILE), 'utf8');
const ser = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) / 86400000 + 25569;
const day = s => new Date((s - 25569) * 86400000).toISOString().slice(0, 10);

// "Hôm nay" cố định = 12/10/2026 10:00 giờ VN để kết quả không đổi theo ngày chạy
const NOW = Date.UTC(2026, 9, 12, 3, 0);
class FixedDate extends Date { constructor(...a) { a.length ? super(...a) : super(NOW); } static now() { return NOW; } }

function setup(gmail) {
  const sheets = {
    LICH_CU_THE: makeSheet('LICH_CU_THE', 1501, 27),
    PORTS: makeSheet('PORTS', 60, 3),
    NHAT_KY: makeSheet('NHAT_KY', 1000, 6),
    MAU_NHAP: makeSheet('MAU_NHAP', 10, 17)
  };
  sheets.PORTS.g[1][0] = 'Tất cả';
  sheets.PORTS.g[2] = ['VNHPH', 'Hai Phong', 'Vietnam'];
  const moved = [];
  const file = {
    getName: () => FILE, getMimeType: () => 'text/plain', getId: () => 'f1',
    getBlob: () => ({ getDataAsString: () => TEXT }), moveTo: f => moved.push(f.id)
  };
  const folder = (id, files) => ({
    id, files,
    getFiles: () => { let i = 0; return { hasNext: () => i < files.length, next: () => files[i++] }; },
    createFile: blob => { files.push({ getName: () => blob.name, getMimeType: () => 'text/plain', getId: () => blob.name,
      getBlob: () => ({ getDataAsString: () => blob.text }), moveTo: f => moved.push(f.id) }); }
  });
  const folders = { inbox: folder('inbox', gmail ? [] : [file]), done: folder('done', []), fail: folder('fail', []) };
  const props = {};
  const labels = [];
  const toasts = [];
  const { ctx } = loadCodeGs(sheets, toasts, {
    Date: FixedDate,
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet', CSV: 'text/csv', PLAIN_TEXT: 'text/plain' },
    PropertiesService: { getDocumentProperties: () => ({ getProperty: k => (k === 'CAP' ? '1500' : props[k] || null), setProperty: (k, v) => { props[k] = v; } }) },
    GmailApp: gmail ? {
      search: q => { gmail.queries.push(q); return gmail.threads.map(t => Object.assign({ addLabel: l => labels.push(l.name) }, t)); },
      getUserLabelByName: () => null, createLabel: n => ({ name: n })
    } : undefined,
    DriveApp: { getFolderById: id => ({ '13vrfYKmay8tTryUyLblcC9ttyQrrQ3m2': folders.inbox, '1E_ux26FSoNJdt8NjUHocWtJHmTS83fOy': folders.done, '1QPfJKhaGhzlHGvXiSH90L762FXA0qqBg': folders.fail })[id] }
  });
  ctx.console = { log: () => {} };
  return { sheets, ctx, moved, folders, labels };
}
const rowsOf = sh => sh.g.slice(1).filter(r => r[2] !== '');

// 1) Bộ đọc
{
  const { ctx } = setup();
  const recs = ctx.parseFile_([{ name: 'txt', text: TEXT, values: [] }], FILE);
  assert.ok(recs.every(r => r.car === 'EVERGREEN' && r.pol === 'VNHPH' && r.ts === 'Direct'), 'chỉ chuyến đi từ VNHPH');
  assert.ok(recs.every(r => /^[A-Z]{5}$/.test(r.pod) && r.eta >= r.etd), 'POD là mã 5 ký tự, ETA không trước ETD');
  // Ngày lùi lại so với cảng trước (EVER CHANT 0163-119B: Hong Kong 11/11 sau Zhanjiang 11/13) → bỏ
  assert.ok(!recs.some(r => r.voy === '0163-119B' && r.pod === 'HKHKG'), 'bỏ ngày không theo thứ tự');
  assert.ok(recs.some(r => r.voy === '0159-088B' && r.pod === 'CNQZH'), 'HPH → Qinzhou đến trong ngày vẫn giữ');
  assert.ok(recs.every(r => r.etd < ser(2027, 1, 1)), 'không có chuyến bị đẩy sang 2027');
  const w = recs.filter(r => r.voy === '0497-042S');
  assert.deepStrictEqual(w.map(r => [r.svc, r.ves, r.pod, day(r.etd), day(r.eta)]), [
    ['CVM', 'EVER WISE', 'VNDAD', '2026-11-03', '2026-11-04'],
    ['CVM', 'EVER WISE', 'MYKUA', '2026-11-03', '2026-11-06'],
    ['CVM', 'EVER WISE', 'SGSIN', '2026-11-03', '2026-11-08'],
    ['CVM', 'EVER WISE', 'MYPKG', '2026-11-03', '2026-11-09']
  ]);
  // Dấu * (chuyển tải): EVER CONSIST 0556-070S ở Tanjung Pelepas "10/10 10/11*" → bỏ
  assert.ok(!recs.some(r => r.voy === '0556-070S' && r.pod === 'MYTPP'), 'bỏ cảng có dấu *');
  assert.ok(recs.some(r => r.voy === '0556-070S' && r.pod === 'MYPGU'), 'cảng sau đó vẫn giữ');
  // Chuyến cũ không có năm (WAN HAI 295 N062, 04/04) → năm 2026, không phải 2027
  const old = recs.find(r => r.voy === 'N062');
  assert.strictEqual(day(old.etd), '2026-04-04');
  // Cùng tàu, nhiều POD; KTH đi Hàn/Nhật
  assert.ok(recs.some(r => r.svc === 'KTH' && r.pod === 'KRPUS'));
}

// 2) Thả vào Inbox → 📥 Nhập
{
  const { sheets, ctx, moved } = setup();
  ctx.importInbox();
  const L = rowsOf(sheets.LICH_CU_THE);
  assert.strictEqual(moved[0], 'done', 'file chuyển sang Da xu ly');
  assert.ok(L.length > 150 && L.length < 250, 'số dòng hợp lý: ' + L.length);
  assert.ok(L.every(r => r[14] >= ser(2026, 10, 12) - 14), 'bỏ chuyến đã chạy quá 14 ngày');
  assert.ok(/Thêm \d+/.test(sheets.NHAT_KY.g[1][3]), 'ghi NHAT_KY: ' + sheets.NHAT_KY.g[1][3]);
  const ports = sheets.PORTS.g.map(r => r[0]);
  assert.ok(ports.includes('KRPUS') && ports.includes('MYKUA'), 'tự thêm cảng mới vào PORTS');
}

// 3) Đã có chuyến từ bookmarklet (có cut-off) → nhập file text → giữ cut-off, không trùng
{
  const { sheets, ctx } = setup();
  ctx.upsert_(ctx.SpreadsheetApp.getActive(), [{
    car: 'EVERGREEN', svc: 'CVM', ves: 'EVER WISE', voy: '0497-042S', pol: 'VNHPH', tpol: '', pod: 'SGSIN', tpod: '',
    bk: '', si: '', vgm: ser(2026, 10, 30, 14), port: ser(2026, 10, 30, 17), etd: ser(2026, 11, 3), eta: ser(2026, 11, 7),
    ts: 'Direct', tsp: '', src: 'MAU_NHAP', note: ''
  }]);
  ctx.importInbox();
  const hits = rowsOf(sheets.LICH_CU_THE).filter(r => r[5] === '0497-042S' && r[8] === 'SGSIN');
  assert.strictEqual(hits.length, 1, 'không trùng dòng');
  const r = hits[0];
  assert.ok(Math.abs(r[16] - ser(2026, 11, 8)) < 1e-6, 'ETA cập nhật theo file mới');
  assert.ok(Math.abs(r[13] - ser(2026, 10, 30, 17)) < 1e-6 && Math.abs(r[12] - ser(2026, 10, 30, 14)) < 1e-6, 'giữ Port/VGM cut-off cũ');
  assert.ok(/Cập nhật 12\/10: ETA 07\/11 → 08\/11/.test(r[22]), 'ghi chú thay đổi: ' + r[22]);
}

// 4) File text không phải của Evergreen → chuyển sang Can bo doc
{
  const { ctx, moved } = setup();
  const res = (() => { try { ctx.parseFile_([{ name: 'txt', text: 'hello', values: [['hello']] }], 'x.txt'); return 'ok'; } catch (e) { return e.message; } })();
  assert.ok(/Chưa có bộ đọc cho file text/.test(res));
  assert.strictEqual(moved.length, 0);
}

// 5) Email từ schedules@shipmentlink.com → Inbox → nhập; chạy lại không lấy trùng
{
  const att = (name, text, type = 'text/plain') => ({
    getName: () => name, getContentType: () => type, getDataAsString: () => text,
    copyBlob: () => ({ setName(n) { return { name: n, text }; } })
  });
  const gmail = {
    queries: [],
    threads: [{ getMessages: () => [{
      getId: () => 'm1', getDate: () => new Date(Date.UTC(2026, 9, 12, 1)),
      getAttachments: () => [att('Schedules_20261012.txt', TEXT), att('ghi_chu.txt', 'không phải lịch'), att('logo.png', 'x', 'image/png')]
    }] }]
  };
  const { sheets, ctx, folders, labels } = setup(gmail);
  ctx.importInbox();
  assert.ok(/^from:schedules@shipmentlink\.com /.test(gmail.queries[0]), 'lọc theo người gửi');
  assert.deepStrictEqual(folders.inbox.files.map(f => f.getName()), ['EMC_20261012_Schedules_20261012.txt'], 'chỉ lấy file lịch');
  assert.deepStrictEqual(labels, ['Lich tau'], 'gắn nhãn email');
  const n = rowsOf(sheets.LICH_CU_THE).length;
  assert.ok(n > 150, 'đã nhập: ' + n);
  ctx.importInbox();
  assert.strictEqual(folders.inbox.files.length, 1, 'email đã lấy thì không lấy lại');
  assert.strictEqual(rowsOf(sheets.LICH_CU_THE).length, n);
}

console.log('✅ File text lịch Evergreen: đọc đúng, nhập vào Sổ tay, gộp với dữ liệu bookmarklet, lấy từ Gmail – đạt');
