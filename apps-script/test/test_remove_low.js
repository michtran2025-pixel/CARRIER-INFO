// Kiểm thử: 🧽 Xoá service độ tin cậy "Thấp" – dồn ô nhập liệu, không đụng cột công thức.
// Chạy: node apps-script/test/test_remove_low.js [file SERVICE_MASTER.json tuỳ chọn]
const fs = require('fs');
const assert = require('assert');
const { makeSheet, loadCodeGs } = require('./mock');

const HDR = ['ID', 'POL', 'POD', 'Tên cảng POD', 'Hãng', 'Service', 'Thứ ETD (1=T2 … 7=CN)', 'Thứ ETD', 'Cut-off trước ETD (ngày)',
  'Giờ cut-off', 'Thứ cut-off', 'Transit (ngày)', 'Direct / T/S', 'Cảng T/S', 'Trạng thái', 'Hiệu lực từ', 'Hiệu lực đến',
  'Số lô lịch sử', 'Tỷ lệ đúng thứ ETD', 'Độ tin cậy', 'ETD gần nhất (lịch sử)', 'Nguồn', 'Cập nhật', 'Ghi chú', 'KEY'];
const FX = [0, 3, 7, 10, 17, 18, 19, 20, 24];           // A D H K R S T U Y là công thức

function build(rows) {
  const sh = makeSheet('SERVICE_MASTER', 101, 25);
  sh.g[0] = HDR.slice();
  for (let r = 1; r <= 100; r++) sh.f[r] = Array.from({ length: 25 }, (_, c) => FX.includes(c) ? '=F' + c + '_' + (r + 1) : '');
  rows.forEach((x, i) => { sh.g[i + 1] = x.slice(); });
  return sh;
}
function row(pod, car, rel, transit) {
  const r = Array(25).fill('');
  r[1] = 'VNHPH'; r[2] = pod; r[4] = car; r[11] = transit; r[14] = 'Đang chạy'; r[19] = rel; r[21] = 'Follow-up';
  r[0] = 'id'; r[7] = 'T4'; r[24] = 'VNHPH|' + pod + '|' + car;   // giá trị của các ô công thức
  return r;
}

const file = process.argv[2];
const rows = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : [
  row('AUSYD', 'ANL', 'Theo lịch cụ thể', 26), row('JPTYO', 'CNC', 'Cao', 7), row('JPUKB', 'CNC', 'Thấp', 10),
  row('JPUKB', 'ONE', 'Trung bình', ''), row('KRINC', 'RCL', 'Thấp', 4), row('PHMNN', 'YML', 'Cao', '')
];
const sh = build(rows);
const sheets = { SERVICE_MASTER: sh, NHAT_KY: makeSheet('NHAT_KY', 1000, 6) };
const { ctx } = loadCodeGs(sheets, []);
ctx.console = { log: () => {} };
const before = sh.g.slice(1).filter(r => r[2] !== '').map(r => r.slice());
const lowN = before.filter(r => r[19] === 'Thấp').length;
const formulasBefore = JSON.stringify(sh.f);
ctx.removeLowConfidence();

const after = sh.g.slice(1).filter(r => r[2] !== '');
assert.strictEqual(after.length, before.length - lowN, 'còn đúng số service');
const inputCols = [...Array(25).keys()].filter(c => !FX.includes(c));
const pick = r => inputCols.map(c => String(r[c]));
assert.deepStrictEqual(after.map(pick), before.filter(r => r[19] !== 'Thấp').map(pick), 'giữ thứ tự, dữ liệu nhập đúng');
assert.ok(sh.g.slice(1 + after.length).every(r => inputCols.every(c => r[c] === '')), 'dòng thừa đã trống');
assert.strictEqual(JSON.stringify(sh.f), formulasBefore, 'không đụng công thức');
assert.ok(/Xoá \d+ service độ tin cậy Thấp/.test(sheets.NHAT_KY.g[1][3]), 'ghi NHAT_KY');
console.log(`✅ Xoá service độ tin cậy Thấp: đạt (xoá ${lowN}, còn ${after.length})`);
