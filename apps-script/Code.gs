/**
 * SỔ TAY LỊCH TÀU – Apps Script tự nhập lịch tàu (K+N Hải Phòng)
 * Dán toàn bộ file này vào Extensions → Apps Script (thay nội dung Code.gs).
 * Cần bật dịch vụ "Drive API" (Services → + → Drive API → Add) để đọc file Excel.
 * Dán dữ liệu (17 cột, từ ô A2) vào sheet MAU_NHAP → tự nhập luôn (onEdit), không cần bấm menu.
 * Email lịch Evergreen (file .txt đính kèm) gửi về Gmail → mỗi giờ tự lấy vào Inbox rồi nhập.
 */

const CFG = {
  INBOX_ID: '13vrfYKmay8tTryUyLblcC9ttyQrrQ3m2',   // Lich tau HPH/Inbox
  DONE_ID: '1E_ux26FSoNJdt8NjUHocWtJHmTS83fOy',    // Lich tau HPH/Da xu ly
  FAIL_ID: '1QPfJKhaGhzlHGvXiSH90L762FXA0qqBg',    // Lich tau HPH/Can bo doc (file chưa đọc được)
  SHEET: 'LICH_CU_THE',
  LOG: 'NHAT_KY',
  PASTE: 'MAU_NHAP',
  FIRST_ROW: 2,
  CAPACITY: 1500,         // số dòng tối đa của LICH_CU_THE (script tự mở rộng ở lần chạy đầu)
  LAST_ROW: 1501,
  KEEP_DAYS: 30,          // Dọn dẹp: xoá chuyến có ETD cũ hơn 30 ngày
  // Gmail: email lịch Evergreen có file .txt đính kèm trong 7 ngày gần nhất; chỉ lấy file có nội dung lịch ShipmentLink
  GMAIL_QUERY: 'from:schedules@shipmentlink.com has:attachment newer_than:7d',
  GMAIL_LABEL: 'Lich tau'  // nhãn gắn vào email đã lấy lịch (để dễ tìm lại)
};

// Cột nhập liệu của LICH_CU_THE (các cột còn lại là công thức – không ghi đè)
// A Ngày nhận | C..O Hãng → ETD | Q ETA | T..W Direct/TS, Cảng T/S, Nguồn, Ghi chú
const SEG = [
  { col: 1, keys: ['received'] },
  { col: 3, keys: ['car', 'svc', 'ves', 'voy', 'pol', 'tpol', 'pod', 'tpod', 'bk', 'si', 'vgm', 'port', 'etd'] },
  { col: 17, keys: ['eta'] },
  { col: 20, keys: ['ts', 'tsp', 'src', 'note'] }
];
const DATE_KEYS = ['received', 'bk', 'si', 'vgm', 'port', 'etd', 'eta'];

const PORTS = {
  'HAIPHONG': 'VNHPH', 'HAI PHONG': 'VNHPH', 'HO CHI MINH': 'VNSGN', 'CAI MEP': 'VNCMT',
  'TOKYO': 'JPTYO', 'KOBE': 'JPUKB', 'YOKOHAMA': 'JPYOK', 'OSAKA': 'JPOSA', 'INCHEON': 'KRINC', 'BUSAN': 'KRPUS',
  'MANILA': 'PHMNL', 'DAVAO': 'PHDVO', 'JAKARTA': 'IDJKT', 'SURABAYA': 'IDSUB', 'LAEM CHABANG': 'THLCH',
  'BANGKOK': 'THBKK', 'PORT KLANG': 'MYPKG', 'PENANG': 'MYPEN', 'SINGAPORE': 'SGSIN', 'SHANGHAI': 'CNSHA',
  'NINGBO': 'CNNGB', 'SHEKOU': 'CNSHK', 'HONG KONG': 'HKHKG', 'KAOHSIUNG': 'TWKHH', 'NHAVA SHEVA': 'INNSA',
  'SYDNEY': 'AUSYD', 'MELBOURNE': 'AUMEL', 'BRISBANE': 'AUBNE', 'LOS ANGELES': 'USLAX', 'LONG BEACH': 'USLGB',
  'ROTTERDAM': 'NLRTM', 'HAMBURG': 'DEHAM',
  // mã viết tắt / mã cũ hay gặp trong lịch hãng
  'HPH': 'VNHPH', 'SHK': 'CNSHK', 'LCH': 'THLCH', 'BKK': 'THBKK', 'HKG': 'HKHKG', 'NSA': 'INNSA', 'PAV': 'INPAV',
  'KRICH': 'KRINC', 'SIN': 'SGSIN', 'PKG': 'MYPKG', 'JKT': 'IDJKT', 'SUB': 'IDSUB', 'MNL': 'PHMNL', 'INC': 'KRINC', 'PUS': 'KRPUS',
  // tên cảng trong file text lịch Evergreen (ShipmentLink, tên bị cắt còn 15 ký tự)
  'DA NANG': 'VNDAD', 'QUI NHON': 'VNUIH', 'PUSAN': 'KRPUS', 'GWANG YANG': 'KRKAN', 'HAKATA': 'JPHKT', 'SHIMIZU': 'JPSMZ',
  'NAGOYA': 'JPNGO', 'TAIPEI': 'TWTPE', 'KEELUNG': 'TWKEL', 'TAICHUNG': 'TWTXG', 'XIAMEN': 'CNXMN', 'QINGDAO': 'CNTAO',
  'YANTIAN': 'CNYTN', 'NANSHA': 'CNNSA', 'QINZHOU': 'CNQZH', 'ZHANJIANG': 'CNZHA', 'XINGANG': 'CNXGG', 'DALIAN': 'CNDLC',
  'PORT KLANG WEST': 'MYPKG', 'PORT KLANG NORT': 'MYPKG', 'TANJUNG PELEPAS': 'MYTPP', 'PASIR GUDANG': 'MYPGU',
  'KUANTAN': 'MYKUA', 'SEMARANG': 'IDSRG', 'MANILA (NORTH P': 'PHMNN', 'CEBU': 'PHCEB'
};
// POL được lấy từ file lịch dạng bảng tuyến của hãng (file text Evergreen): chỉ nhập chuyến đi từ các cảng này
const HOME_POLS = ['VNHPH'];
const TERM_CODES = { VNDVN: 'Nam Dinh Vu', VNTVU: 'Tan Vu', THTIP: 'TIPS (Laem Chabang)', THTST: 'TST (Bangkok)', TST: 'TST (Bangkok)' };
function terminalCode_(v) { const s = norm_(v); return TERM_CODES[s] || String(v || '').trim(); }
const TERMINALS = {
  'DP WORLD SYDNEY PORT BOTANY TERMINL': 'DP World Botany',
  'DP WORLD SYDNEY PORT BOTANY TERMINAL': 'DP World Botany',
  'PATRICK TERMINAL PORT BOTANY': 'Patrick Botany'
};
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

// ------------------------------------------------------------------ MENU
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🚢 Lịch tàu')
    .addItem('📥 Nhập lịch (Gmail + Inbox Drive)', 'importInbox')
    .addItem('📋 Nhập từ sheet MAU_NHAP', 'importPasteSheet')
    .addSeparator()
    .addItem('🧹 Xoá lịch đã chạy quá 30 ngày', 'purgeOld')
    .addItem('🧽 Xoá service độ tin cậy "Thấp" (SERVICE_MASTER)', 'removeLowConfidence')
    .addItem('📈 Mở rộng Sổ tay (1.500 dòng)', 'upgradeNow')
    .addSeparator()
    .addItem('⏰ Bật tự nhập mỗi giờ', 'enableHourly')
    .addItem('⛔ Tắt tự nhập', 'disableHourly')
    .addToUi();
}

// ------------------------------------------------------------------ IMPORT FROM DRIVE INBOX
function importInbox() {
  const ss = SpreadsheetApp.getActive();
  ensureCapacity_(ss);
  const inbox = DriveApp.getFolderById(CFG.INBOX_ID);
  const done = DriveApp.getFolderById(CFG.DONE_ID);
  const fail = DriveApp.getFolderById(CFG.FAIL_ID);
  const summary = [];
  try {
    const got = pullGmail_(inbox, ss.getSpreadsheetTimeZone());
    if (got.length) summary.push(`📧 Gmail: lấy ${got.length} file lịch → ${got.join(', ')}`);
  } catch (e) {
    summary.push('⚠️ Chưa đọc được Gmail (' + (e.message || e) + '). Chạy menu 📥 một lần để cấp quyền Gmail.');
  }
  const files = inbox.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    try {
      const sheets = readSheets_(f);
      const all = parseFile_(sheets, f.getName());
      const flt = filterTracked_(ss, all);
      const newPorts = learnPorts_(ss, flt.keep, all.legend || {});
      const res = flt.keep.length ? upsert_(ss, flt.keep) : { added: 0, updated: 0, same: 0 };
      res.skipped = flt.skipped;
      log_(ss, f.getName(), res);
      f.moveTo(done);
      summary.push(`✅ ${f.getName()}: thêm ${res.added}, cập nhật ${res.updated}, không đổi ${res.same}` +
                   (flt.skipped ? `, bỏ qua ${flt.skipped} (${flt.why})` : '') +
                   (newPorts.length ? `\n   ➕ Cảng mới tự thêm vào PORTS: ${newPorts.join(', ')}` : ''));
    } catch (e) {
      log_(ss, f.getName(), null, String(e.message || e));
      try { f.moveTo(fail); } catch (e2) {}            // tránh thử lại mỗi giờ
      summary.push(`❌ ${f.getName()}: ${e.message || e} → đã chuyển sang thư mục "Can bo doc"`);
    }
  }
  if (!summary.length && !isManual_()) return;         // chạy theo giờ & không có gì mới: im lặng
  notify_(summary.length ? summary.join('\n') : 'Gmail và Inbox đều không có lịch mới.');
}

// ------------------------------------------------------------------ GMAIL → INBOX
// Email có file .txt lịch ShipmentLink (Evergreen) đính kèm → lưu file vào Inbox (tên có ngày email để biết năm).
// Mỗi email chỉ lấy 1 lần (nhớ mã email trong DocumentProperties) và được gắn nhãn "Lich tau".
function pullGmail_(inbox, tz) {
  const props = PropertiesService.getDocumentProperties();
  const seen = JSON.parse(props.getProperty('GMAIL_SEEN') || '[]');
  const got = [];
  let label = null;
  GmailApp.search(CFG.GMAIL_QUERY, 0, 30).forEach(th => {
    let used = false;
    th.getMessages().forEach(msg => {
      const id = msg.getId();
      if (seen.indexOf(id) >= 0) return;
      seen.push(id);
      const ymd = new Date((serialFromDate_(msg.getDate(), tz, true) - 25569) * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
      msg.getAttachments().forEach(att => {
        if (!/\.txt$/i.test(att.getName()) && !/^text\/plain/i.test(att.getContentType())) return;
        if (!/ShipmentLink Sailing Schedules/.test(att.getDataAsString('UTF-8'))) return;
        const name = `EMC_${ymd}_${att.getName()}`;
        inbox.createFile(att.copyBlob().setName(name));
        got.push(name);
        used = true;
      });
    });
    if (used) { label = label || GmailApp.getUserLabelByName(CFG.GMAIL_LABEL) || GmailApp.createLabel(CFG.GMAIL_LABEL); th.addLabel(label); }
  });
  props.setProperty('GMAIL_SEEN', JSON.stringify(seen.slice(-300)));
  return got;
}

// ------------------------------------------------------------------ IMPORT FROM PASTE SHEET
// Dán vào MAU_NHAP (khối từ cột A, dòng ≥ 2, ≥ 13 cột – vd. từ bookmarklet "Copy lịch EMC") → tự nhập.
// Gõ tay từng ô thì không tự nhập (dùng menu 📋 khi gõ xong).
function onEdit(e) {
  if (!e || !e.range) return;
  const r = e.range;
  if (r.getSheet().getName() !== CFG.PASTE || r.getRow() < 2 || r.getColumn() !== 1 || r.getNumColumns() < 13) return;
  try { importPasteSheet(true); }
  catch (err) { e.source.toast(String(err.message || err), '❌ MAU_NHAP – chưa nhập', 15); }
}

function importPasteSheet(auto) {
  auto = auto === true;
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(CFG.PASTE);
  if (!sh) throw new Error('Không tìm thấy sheet ' + CFG.PASTE);
  const say = msg => auto ? ss.toast(msg, '🚢 Lịch tàu', 10) : notify_(msg);
  const last = sh.getLastRow();
  if (last < 2) { say('Sheet MAU_NHAP chưa có dữ liệu (dán từ dòng 2).'); return; }
  const grid = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  ensureCapacity_(ss);
  const recs = parseGrid_(grid, 'MAU_NHAP');
  learnPorts_(ss, recs, {});
  const res = upsert_(ss, recs);
  log_(ss, 'Sheet MAU_NHAP', res);
  sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
  say(`✅ MAU_NHAP: thêm ${res.added}, cập nhật ${res.updated}, không đổi ${res.same}. Đã xoá vùng dán.`);
}

// ------------------------------------------------------------------ READ FILE → [{name, values}] (mọi sheet)
function readSheets_(file) {
  const mt = file.getMimeType();
  const fromSs = id => SpreadsheetApp.openById(id).getSheets().map(sh => ({ name: sh.getName(), values: sh.getDataRange().getValues() }));
  if (mt === MimeType.GOOGLE_SHEETS) return fromSs(file.getId());
  if (mt === MimeType.PLAIN_TEXT || /\.txt$/i.test(file.getName())) {
    const text = file.getBlob().getDataAsString('UTF-8').replace(/\r/g, '');
    return [{ name: 'txt', text, values: text.split('\n').map(l => [l]) }];
  }
  if (mt === MimeType.CSV || /\.csv$/i.test(file.getName())) {
    return [{ name: 'csv', values: Utilities.parseCsv(file.getBlob().getDataAsString('UTF-8')) }];
  }
  if (/sheet|excel/i.test(mt) || /\.xlsx?$/i.test(file.getName())) {
    // Chuyển tạm sang Google Sheets để đọc (cần bật Drive API trong Services)
    const tmp = Drive.Files.create({ name: 'tmp_' + file.getName(), mimeType: MimeType.GOOGLE_SHEETS }, file.getBlob());
    try { return fromSs(tmp.id); } finally { DriveApp.getFileById(tmp.id).setTrashed(true); }
  }
  throw new Error('Định dạng chưa hỗ trợ (' + mt + '). Dùng Excel/CSV/TXT, hoặc dán vào sheet MAU_NHAP.');
}

// ------------------------------------------------------------------ PARSE WHOLE FILE (thử mọi sheet, mọi bộ đọc)
function parseFile_(sheets, fileName) {
  let recs = [];
  let found = false;
  const deps = {};
  const legend = {};
  const emc = sheets.filter(s => s.text && /ShipmentLink Sailing Schedules/.test(s.text));
  if (emc.length) {                                   // file text lịch Evergreen tải từ ShipmentLink
    emc.forEach(s => { recs = recs.concat(parseEmcText_(s.text, fileName)); });
    if (!recs.length) throw new Error('File lịch Evergreen không có chuyến nào đi từ ' + HOME_POLS.join(', ') + '.');
    const out = dedupeBest_(recs);
    out.legend = legend;
    return out;
  }
  if (sheets.some(s => s.text)) throw new Error('Chưa có bộ đọc cho file text này. Gửi 1 file mẫu cho Claude để thêm.');
  sheets.forEach(s => { collectDepartures_(s.values, deps); collectLegend_(s.values, legend); });
  sheets.forEach(s => {
    try { recs = recs.concat(parseGrid_(s.values, fileName)); found = true; return; } catch (e) { /* thử bộ đọc bảng tuyến */ }
    const r = parseRouteTables_(s.values, fileName);
    if (r.length) { recs = recs.concat(r); found = true; }
  });
  if (!found) throw new Error('Chưa có bộ đọc cho định dạng này. Gửi file cho Claude để thêm, hoặc chuyển sang mẫu MAU_NHAP.');
  if (!recs.length) throw new Error('Đọc được định dạng nhưng không có dòng lịch hợp lệ (thiếu ngày/tàu).');
  // Bổ sung cut-off thực tế, terminal, thông báo delay từ bảng Departures (nếu có)
  recs.forEach(r => {
    const d = deps[norm_(r.ves) + '|' + norm_(r.voy)];
    if (!d || r.pol !== 'VNHPH') return;
    if (d.terminal) r.tpol = d.terminal;
    if (d.cy) r.port = d.cy;
    if (d.si) r.si = d.si;
    if (d.notice) r.note = [r.note, d.notice].filter(Boolean).join('; ');
  });
  const out = dedupeBest_(recs);
  out.legend = legend;
  return out;
}

// Bảng chú thích "PortCode | Port Name" trong file hãng → tên cảng cho PORTS
function collectLegend_(g, legend) {
  for (let i = 0; i < g.length; i++) {
    const H = g[i].map(v => norm_(v));
    const a = H.indexOf('PORTCODE') >= 0 ? H.indexOf('PORTCODE') : H.indexOf('PORT CODE');
    const b = H.indexOf('PORT NAME');
    if (a < 0 || b < 0) continue;
    for (let r = i + 1; r < g.length; r++) {
      const code = norm_(g[r][a]);
      if (!/^[A-Z]{5}$/.test(code)) break;
      legend[portCode_(code)] = String(g[r][b]).trim();
    }
  }
}

// Cùng chuyến + cùng POD xuất hiện ở nhiều bảng → giữ phương án có ETA sớm nhất
function dedupeBest_(recs) {
  const best = {};
  recs.forEach(r => {
    const k = key_(r.car, r.voy, r.pod, r.tpod) + '|' + norm_(r.pol);
    if (!best[k] || (r.eta && (!best[k].eta || r.eta < best[k].eta))) best[k] = r;
  });
  return Object.keys(best).map(k => best[k]);
}

// Bỏ qua chuyến đã chạy quá 14 ngày (giữ Sổ tay gọn). Mọi cảng đều được nhập.
function filterTracked_(ss, recs) {
  const minEtd = serialFromDate_(new Date(), ss.getSpreadsheetTimeZone(), true) - 14;
  let old = 0;
  const keep = recs.filter(r => { if (r.etd < minEtd) { old++; return false; } return true; });
  return { keep, skipped: old, why: old ? `${old} chuyến đã chạy` : '' };
}

// Cảng chưa có trong PORTS → tự thêm (tên lấy từ chú thích trong file, hoặc từ chữ "Sydney, AU")
function learnPorts_(ss, recs, legend) {
  const sh = ss.getSheetByName('PORTS');
  if (!sh) return [];
  const last = Math.max(sh.getLastRow(), 3);
  const have = new Set(sh.getRange(3, 1, last - 2, 1).getValues().map(r => norm_(r[0])).filter(Boolean));
  const add = {};
  recs.forEach(r => {
    [[r.pol, r.polName], [r.pod, r.podName]].forEach(([code, raw]) => {
      const c = norm_(code);
      if (!/^[A-Z]{5}$/.test(c) || have.has(c) || add[c]) return;
      const txt = legend[c] || raw || '';
      const parts = String(txt).split(',').map(x => x.trim());
      add[c] = [c, parts[0] || '', parts[1] || ''];
    });
  });
  const rows = Object.keys(add).sort().map(k => add[k]);
  if (rows.length) {
    const col = sh.getRange(3, 1, Math.max(sh.getMaxRows() - 2, 1), 1).getValues();
    let r = col.findIndex(v => v[0] === '') + 3;
    if (r < 3) r = sh.getMaxRows() + 1;
    if (r + rows.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), r + rows.length - sh.getMaxRows());
    sh.getRange(r, 1, rows.length, 3).setValues(rows);
  }
  return rows.map(x => x[0]);
}

// ------------------------------------------------------------------ MỞ RỘNG SỨC CHỨA (chạy 1 lần, tự động)
// LICH_CU_THE 300 → CFG.CAPACITY dòng; kéo công thức CALC/CALC2 theo; sửa tham chiếu trong LICH_THANG,
// CHON_LICH, PHAN_TICH; ô chọn cảng đọc toàn bộ cột PORTS.
function ensureCapacity_(ss) {
  const props = PropertiesService.getDocumentProperties();
  if (props.getProperty('CAP') === String(CFG.CAPACITY)) return;
  const N = CFG.CAPACITY;
  const grow = (sh, rows) => { if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows()); };
  const P = SpreadsheetApp.CopyPasteType;
  // 1) LICH_CU_THE: công thức các cột tính toán + định dạng
  const lc = ss.getSheetByName(CFG.SHEET);
  grow(lc, N + 1);
  [2, 16, 18, 19, 24, 25, 26, 27].forEach(c => lc.getRange(2, c).copyTo(lc.getRange(3, c, N - 1, 1), P.PASTE_FORMULA, false));
  lc.getRange(301, 1, 1, 27).copyTo(lc.getRange(302, 1, N - 300, 27), P.PASTE_FORMAT, false);
  // 2) CALC: khối "Thực tế" bắt đầu dòng 502
  const calc = ss.getSheetByName('CALC');
  grow(calc, 501 + N);
  calc.getRange(502, 1, 1, 23).copyTo(calc.getRange(503, 1, N - 1, 23), P.PASTE_NORMAL, false);
  // 3) CALC2
  const c2 = ss.getSheetByName('CALC2');
  grow(c2, N + 1);
  c2.getRange(2, 1, 1, 11).copyTo(c2.getRange(3, 1, N - 1, 11), P.PASTE_NORMAL, false);
  // 4) Sửa tham chiếu vùng
  const fix = (name, a1) => {
    const sh = ss.getSheetByName(name); if (!sh) return;
    const rg = a1 ? sh.getRange(a1) : sh.getDataRange();
    const f = rg.getFormulas(), v = rg.getValues();
    let changed = false;
    const out = f.map((row, i) => row.map((x, j) => {
      if (!x) return v[i][j];
      const y = x.replace(/(LICH_CU_THE!\$[A-Z]+\$2:\$[A-Z]+\$)\d+/g, '$1' + (N + 1))
                 .replace(/(CALC2!\$[A-Z]+\$2:\$[A-Z]+\$)\d+/g, '$1' + (N + 1))
                 .replace(/(CALC!\$[A-Z]+\$2:\$[A-Z]+\$)\d+/g, '$1' + (501 + N));
      if (y !== x) changed = true;
      return y;
    }));
    if (changed) rg.setValues(out);
  };
  fix('LICH_THANG', 'A1:T90'); fix('CHON_LICH', 'A1:O32'); fix('PHAN_TICH_HPH_SYD', 'A1:N60'); fix('CALC', 'K2:K501');
  // 5) Ô chọn cảng đọc cả cột PORTS (cảng tự học sẽ xuất hiện trong danh sách)
  const ports = ss.getSheetByName('PORTS');
  const rule = from => SpreadsheetApp.newDataValidation().requireValueInRange(ports.getRange(from), true).setAllowInvalid(true).build();
  [['LICH_THANG', 'D4:D5'], ['CHON_LICH', 'D3:D4']].forEach(([n, a]) => { const sh = ss.getSheetByName(n); if (sh) sh.getRange(a).setDataValidation(rule('A2:A1000')); });
  const sm = ss.getSheetByName('SERVICE_MASTER'); if (sm) sm.getRange('C2:C101').setDataValidation(rule('A3:A1000'));
  SpreadsheetApp.flush();
  props.setProperty('CAP', String(N));
}

// ------------------------------------------------------------------ DETECT FORMAT
function parseGrid_(grid, fileName) {
  const hi = grid.findIndex(r => r.some(v => String(v).trim() !== ''));
  if (hi < 0) throw new Error('File trống.');
  const H = grid[hi].map(v => norm_(v));
  const rows = grid.slice(hi + 1).filter(r => r.some(v => String(v).trim() !== ''));
  if (H.includes('DEPARTURE DATE') && H.includes('VESSEL NAME') && H.includes('VOYAGE REF.')) {
    return parseCMA_(H, rows, fileName);           // ANL / CNC / CMA CGM / APL export
  }
  if (H.includes('HÃNG') && H.includes('ETD') && H.includes('VOYAGE')) {
    return parseStandard_(H, rows, fileName);      // mẫu chuẩn MAU_NHAP
  }
  throw new Error('Chưa có bộ đọc cho định dạng này. Gửi 1 file mẫu cho Claude để thêm, hoặc chuyển sang mẫu MAU_NHAP.');
}

// ------------------------------------------------------------------ PARSER: BẢNG TUYẾN DẠNG "SVC CODE | VESSEL NAME / VOY. | ETD … | ETA …" (RCL)
function parseRouteTables_(g, fileName) {
  const out = [];
  const txt = g.map(r => r.map(v => String(v)).join(' ')).join('\n');
  const rules = closingRules_(txt);
  for (let i = 0; i < g.length; i++) {
    const H = g[i].map(v => norm_(v));
    const iSvc = H.findIndex(h => h === 'SVC CODE');
    const iVes = H.findIndex(h => /^VESSEL NAME/.test(h));
    if (iSvc < 0 || iVes < 0 || !H.some(h => /^ETD /.test(h))) continue;
    const car = carrierOf_(fileName, txt);
    if (!car) throw new Error('Không xác định được hãng tàu. Đổi tên file bắt đầu bằng tên hãng (vd. RCL_' + fileName + ').');
    // Cấu trúc cột
    const cols = [];
    let conn = 0, tsp = [];
    H.forEach((h, j) => {
      let m;
      if (/^CONNECTING VESSEL/.test(h)) { conn++; cols.push({ j, type: 'CONN' }); return; }
      if ((m = h.match(/^(ETD|ETA)\s+([A-Z]{3,5})\s*(?:\((.*)\))?/))) {
        cols.push({ j, type: m[1], port: portCode_(m[2]), term: m[3] || '', leg: conn });
      }
    });
    const pols = cols.filter(c => c.type === 'ETD' && c.leg === 0);
    if (!pols.length) continue;
    // Dòng phụ ngay dưới tiêu đề có thể ghi mã terminal: (VNDVN), (THTIP)
    const sub = g[i + 1] || [];
    cols.forEach(c => { const v = String(sub[c.j] || '').trim(); if (/^\(.*\)/.test(v)) c.term = c.term || v.replace(/[()]/g, '').split(/[ ,]/)[0]; });
    const nextHdr = H.findIndex((h, j) => j > iVes && h !== '');
    const vesEnd = nextHdr < 0 ? iVes + 1 : nextHdr;
    for (let r = i + 1; r < g.length; r++) {
      const row = g[r];
      const first = norm_(row[iSvc]) + ' ' + norm_(row[iVes]);
      if (/^\s*$/.test(first) && row.every(v => String(v).trim() === '')) {
        if (r > i + 2) break; else continue;
      }
      if (norm_(row[iSvc]) === 'SVC CODE' || /SCHEDULE IS SUBJECT|CLOSING TIME|^\*/.test(norm_(row[0]) + norm_(row[iSvc]))) break;
      const parts = [];
      for (let j = iVes; j < vesEnd; j++) { const v = String(row[j]).trim(); if (v && v !== 'V.') parts.push(v); }
      let raw = parts.join(' ').replace(/#REF!/g, '').trim();
      if (!raw) continue;
      let ves = raw, voy = '';
      let m = raw.match(/^(.*?)\s+V\.\s*(\S+)$/i) || raw.match(/^(.*?)\s+(\d{2,5}[A-Z]?)(?:\s+([NSEW]))?$/i);
      if (m) { ves = m[1].trim(); voy = (m[2] + (m[3] || '')).toUpperCase(); }
      if (!voy) continue;
      const connNames = cols.filter(c => c.type === 'CONN').map(c => String(row[c.j]).trim()).filter(Boolean);
      pols.forEach(p => {
        const etd = parseDate_(row[p.j]);
        if (!etd) return;
        let lastConnPort = '';
        let tsPorts = [];
        cols.forEach((c, idx) => {
          if (c.type === 'CONN') { const prev = cols.slice(0, idx).reverse().find(x => x.type === 'ETA'); if (prev) tsPorts.push(prev.port); return; }
          if (c.type !== 'ETA' || c.j < p.j || c.port === p.port) return;
          const eta = parseDate_(row[c.j], etd);
          if (!eta) return;
          const isTs = c.leg > 0;
          if (isTs && !connNames[c.leg - 1]) return;                    // chưa có tàu nối
          const rec = {
            car, svc: String(row[iSvc]).trim(), ves, voy, pol: p.port, tpol: terminalCode_(p.term), pod: c.port, tpod: terminalCode_(c.term),
            bk: '', si: rules.si ? roundMin_(etd - rules.si.days + rules.si.time) : '', vgm: '', port: rules.cy ? roundMin_(etd - rules.cy.days + rules.cy.time) : '',
            etd, eta: eta < etd ? eta + 365 : eta, ts: isTs ? 'T/S' : 'Direct', tsp: isTs ? tsPorts.slice(0, c.leg).join(', ') : '',
            src: fileName, note: isTs ? 'Nối tàu ' + connNames.slice(0, c.leg).join(' → ') : ''
          };
          out.push(rec);
        });
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ PARSER: FILE TEXT LỊCH EVERGREEN (ShipmentLink "Schedules_yyyymmdd.txt")
// Mỗi service là 1 bảng cột cố định: 30 ký tự tên tàu + voyage, mỗi cảng 16 ký tự "ARR   DEP" (mm/dd, không có năm).
// Dấu * sau ngày = hàng cho cảng đó được chuyển tải (T/T) sang tàu khác → ngày không tin được, bỏ qua.
// Năm: chọn năm để ngày nằm trong khoảng 300 ngày trước → 150 ngày sau ngày xuất file (lấy từ tên file).
function parseEmcText_(text, fileName) {
  const L = String(text).replace(/\r/g, '').split('\n');
  const m = String(fileName).match(/(20\d{2})(\d{2})(\d{2})/);
  const base = m ? serial_(+m[1], +m[2], +m[3], 0, 0) : serialFromDate_(new Date(), SpreadsheetApp.getActive().getSpreadsheetTimeZone(), true);
  const md = (cell, ref) => {                          // "10/30" → serial; ref = ngày ETD (ETA phải sau ETD)
    const x = String(cell).match(/^(\d{2})\/(\d{2})(\*?)$/);
    if (!x) return null;
    const mo = +x[1], d = +x[2];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const y = new Date((base - 25569) * 86400000).getUTCFullYear();
    const cands = [y - 1, y, y + 1].map(yy => serial_(yy, mo, d, 0, 0));
    const near = cands.filter(c => c >= base - 300 && c <= base + 150);
    const pool = near.length ? near : cands;
    const v = ref ? cands.find(c => c >= ref) : pool.reduce((a, c) => Math.abs(c - base) < Math.abs(a - base) ? c : a);
    return v === undefined ? null : { v, star: x[3] === '*' };
  };
  const out = [];
  let svc = '', ports = [];
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (/^ShipmentLink Sailing Schedules/.test(l)) { const s = (L[i + 1] || '').match(/\(([A-Z0-9]+)\)\s*$/); svc = s ? s[1] : ''; ports = []; continue; }
    if (/^\s{20,}ARR\s+DEP/.test(l)) {
      const h = L[i - 2] || '';
      ports = [];
      for (let o = 30; o < h.length; o += 16) ports.push({ name: h.substr(o, 15).trim(), o });
      continue;
    }
    if (!ports.length || !/^\S.{29}(\d{2}\/\d{2}|---)/.test(l)) continue;
    const vv = l.substr(0, 30).trim().match(/^(.*\S)\s+(\S+)$/);
    if (!vv) continue;
    const cell = p => {                                 // "10/10 10/11*" → dấu * thuộc cả ô (cảng đó)
      const raw = l.substr(p.o, 12);
      const star = raw.indexOf('*') >= 0;
      const t = v => v.replace('*', '') + (star ? '*' : '');
      return { arr: t(raw.substr(0, 5).trim()), dep: t(raw.substr(6).trim()) };
    };
    ports.forEach((p, k) => {
      const pol = portCode_(p.name);
      if (HOME_POLS.indexOf(pol) < 0) return;
      const c = cell(p);
      const d = md(c.dep) || md(c.arr);
      if (!d || d.star) return;                          // tàu không ghé / chuyển tải
      const seen = {};
      let prev = d.v;                                    // ngày ở cảng trước – ngày lùi lại = số liệu lỗi của hãng, bỏ qua
      ports.slice(k + 1).forEach(q => {
        const pod = portCode_(q.name);
        if (pod === pol || seen[pod]) return;
        const cq = cell(q);
        const a = md(cq.arr, d.v) || md(cq.dep, d.v);
        if (!a || a.v < prev) return;
        prev = a.v;
        seen[pod] = true;
        if (a.star) return;
        out.push({
          car: 'EVERGREEN', svc, ves: vv[1], voy: vv[2], pol, tpol: '', pod, tpod: '', podName: q.name,
          bk: '', si: '', vgm: '', port: '', etd: d.v, eta: a.v, ts: 'Direct', tsp: '', src: fileName,
          note: /^[A-Z]{5}$/.test(pod) ? '' : 'kiểm tra mã cảng ' + q.name
        });
      });
    });
  }
  return out;
}

// Bảng "Departures" của RCL: cut-off CY/SI thực tế, terminal, thông báo (Delay ETD, Port Omission)
function collectDepartures_(g, deps) {
  for (let i = 0; i < g.length; i++) {
    const H = g[i].map(v => norm_(v));
    const iV = H.indexOf('VESSEL NAME'), iY = H.indexOf('VOYAGE');
    const iCy = H.findIndex(h => /CLOSING TIME FOR CY/.test(h)), iSi = H.findIndex(h => /CLOSING TIME FOR SI/.test(h));
    if (iV < 0 || iY < 0 || (iCy < 0 && iSi < 0)) continue;
    const iT = H.indexOf('TERMINAL'), iN = H.findIndex(h => /NOTICE STATUS/.test(h));
    for (let r = i + 1; r < g.length; r++) {
      const row = g[r];
      const v = String(row[iV]).trim(), y = String(row[iY]).trim();
      if (!v || !y) continue;
      const notice = iN >= 0 ? String(row[iN]).trim().replace(/\.$/, '') : '';
      const term = iT >= 0 ? String(row[iT]).trim() : '';
      deps[norm_(v) + '|' + norm_(y)] = {
        cy: iCy >= 0 ? parseDate_(row[iCy]) : '', si: iSi >= 0 ? parseDate_(row[iSi]) : '',
        terminal: /^SCHEDULE$/i.test(term) ? '' : term,
        notice: /DELAY|OMISSION|SKIP|BLANK|CANCEL/i.test(notice) ? 'RCL báo: ' + notice : ''
      };
    }
  }
}

// "CY Closing … 23:00 on the 2 day before ETD", "SI … 09:00 on the 2 day before ETD", "9:00 am 2 days before ETD"
function closingRules_(txt) {
  const rule = re => { const m = txt.match(re); return m ? { time: (+m[1] + (+m[2] || 0) / 60) / 24, days: +m[3] } : null; };
  return {
    cy: rule(/\bCY\b[^\n]*?(\d{1,2}):(\d{2})[^\n]*?(\d)\s*days?\s+before ETD/i),
    si: rule(/\bSI\b[^\n]*?(\d{1,2}):(\d{2})[^\n]*?(\d)\s*days?\s+before ETD/i) || rule(/Closing time[^\n]*?(\d{1,2}):(\d{2})[^\n]*?(\d)\s*days?\s+before ETD/i)
  };
}

// ------------------------------------------------------------------ PARSER: CMA CGM GROUP (ANL, CNC, CMA, APL)
function parseCMA_(H, rows, fileName) {
  const c = name => { const i = H.indexOf(name); if (i < 0) throw new Error('Thiếu cột ' + name); return i; };
  const opt = name => H.indexOf(name);
  const car = carrierFromName_(fileName);
  const iBk = opt('STANDARD BOOKING CUT-OFF') >= 0 ? opt('STANDARD BOOKING CUT-OFF') : opt('SPECIAL BOOKING CUT-OFF');
  return rows.map(r => {
    const g = i => (i >= 0 ? r[i] : '');
    const etd = parseDate_(g(c('DEPARTURE DATE'))), eta = parseDate_(g(c('ARRIVAL DATE')));
    const ts = String(g(opt('TRANSHIPMENT'))).trim();
    const tt = Number(g(opt('TRANSIT TIME')));
    const note = (tt && etd && eta && tt !== Math.round(eta - etd)) ? `Hãng ghi TT ${tt} ngày, tính theo ETD→ETA = ${Math.round(eta - etd)}` : '';
    return {
      car, svc: String(g(opt('SERVICE NAME'))).trim(), ves: String(g(c('VESSEL NAME'))).trim(), voy: String(g(c('VOYAGE REF.'))).trim(),
      pol: portCode_(g(c('ORIGIN'))), tpol: String(g(opt('ORIGIN TERMINAL'))).trim(), polName: String(g(c('ORIGIN'))).trim(),
      pod: portCode_(g(c('DESTINATION'))), tpod: terminal_(g(opt('DESTINATION TERMINAL'))), podName: String(g(c('DESTINATION'))).trim(),
      bk: parseDate_(g(iBk)), si: parseDate_(g(opt('SI CUT-OFF'))), vgm: parseDate_(g(opt('VGM CUT-OFF'))), port: parseDate_(g(opt('PORT CUT-OFF'))),
      etd, eta, ts: (ts === '' || ts === '0') ? 'Direct' : 'T/S', tsp: '', src: fileName, note
    };
  }).filter(x => x.etd && x.voy);
}

// ------------------------------------------------------------------ PARSER: STANDARD TEMPLATE (MAU_NHAP)
function parseStandard_(H, rows, src) {
  const m = {
    car: 'HÃNG', svc: 'SERVICE', ves: 'VESSEL', voy: 'VOYAGE', pol: 'POL', tpol: 'TERMINAL POL', pod: 'POD', tpod: 'TERMINAL POD',
    bk: 'BOOKING CUT-OFF', si: 'SI CUT-OFF', vgm: 'VGM CUT-OFF', port: 'PORT (CY) CUT-OFF', etd: 'ETD', eta: 'ETA',
    ts: 'DIRECT / T/S', tsp: 'CẢNG T/S', note: 'GHI CHÚ'
  };
  return rows.map(r => {
    const o = { src };
    Object.keys(m).forEach(k => {
      const i = H.indexOf(m[k]);
      const v = i >= 0 ? r[i] : '';
      o[k] = DATE_KEYS.includes(k) ? parseDate_(v) : String(v).trim();
    });
    o.pol = o.pol.toUpperCase(); o.pod = o.pod.toUpperCase();
    return o;
  }).filter(x => x.etd && x.voy && x.car);
}

// ------------------------------------------------------------------ UPSERT INTO LICH_CU_THE
function upsert_(ss, recs) {
  if (!recs.length) throw new Error('Không đọc được dòng lịch nào.');
  const sh = ss.getSheetByName(CFG.SHEET);
  const tz = ss.getSpreadsheetTimeZone();
  const n = CFG.LAST_ROW - CFG.FIRST_ROW + 1;
  const data = sh.getRange(CFG.FIRST_ROW, 1, n, 23).getValues();     // A..W
  const today = serialFromDate_(new Date(), tz, true);
  const index = {};
  const free = [];
  data.forEach((r, i) => {
    if (String(r[2]).trim() === '' && r[14] === '') { free.push(i); return; }
    index[key_(r[2], r[5], r[8], r[9])] = i;
  });
  let added = 0, updated = 0, same = 0;
  recs.forEach(rec => {
    rec.received = today;
    const k = key_(rec.car, rec.voy, rec.pod, rec.tpod);
    if (k in index) {
      const i = index[k];
      const old = data[i];
      const changes = [];
      [['etd', 14, 'ETD'], ['eta', 16, 'ETA'], ['si', 11, 'SI cut-off'], ['vgm', 12, 'VGM cut-off'], ['port', 13, 'Port cut-off']].forEach(([key, col, label]) => {
        const o = cellSerial_(old[col], tz);
        if (rec[key] && Math.abs((o || 0) - rec[key]) > 1e-6) changes.push(`${label} ${o ? fmt_(o) : '(trống)'} → ${fmt_(rec[key])}`);
      });
      if (!changes.length) { same++; return; }
      const COLS = { svc: 3, ves: 4, pol: 6, tpol: 7, bk: 10, si: 11, vgm: 12, port: 13, ts: 19, tsp: 20 };
      Object.keys(COLS).forEach(k => { if (rec[k] === '' || rec[k] === undefined || rec[k] === null) rec[k] = old[COLS[k]]; });
      rec.note = [String(old[22] || ''), `Cập nhật ${fmt_(today)}: ${changes.join('; ')}`].filter(Boolean).join(' | ');
      writeRow_(sh, CFG.FIRST_ROW + i, rec);
      updated++;
    } else {
      if (!free.length) throw new Error('LICH_CU_THE đã đầy ' + CFG.CAPACITY + ' dòng. Chạy 🧹 Xoá lịch cũ rồi nhập lại.');
      const i = free.shift();
      writeRow_(sh, CFG.FIRST_ROW + i, rec);
      index[k] = i;
      added++;
    }
  });
  return { added, updated, same };
}

function writeRow_(sh, row, rec) {
  SEG.forEach(s => {
    const vals = s.keys.map(k => (rec[k] === undefined || rec[k] === null) ? '' : rec[k]);
    sh.getRange(row, s.col, 1, vals.length).setValues([vals]);
  });
}

// ------------------------------------------------------------------ PURGE OLD SAILINGS
function purgeOld() {
  const ss = SpreadsheetApp.getActive();
  ensureCapacity_(ss);
  const sh = ss.getSheetByName(CFG.SHEET);
  const tz = ss.getSpreadsheetTimeZone();
  const n = CFG.LAST_ROW - CFG.FIRST_ROW + 1;
  const limit = serialFromDate_(new Date(), tz, true) - CFG.KEEP_DAYS;
  const segs = SEG.map(s => sh.getRange(CFG.FIRST_ROW, s.col, n, s.keys.length).getValues());
  const keep = [];
  let removed = 0;
  for (let i = 0; i < n; i++) {
    const etd = cellSerial_(segs[1][i][12], tz);       // cột O nằm ở vị trí 12 trong đoạn C..O
    const empty = String(segs[1][i][0]).trim() === '' && segs[1][i][12] === '';
    if (empty) continue;
    if (etd && etd < limit) { removed++; continue; }
    keep.push(i);
  }
  SEG.forEach((s, j) => {
    const rows = keep.map(i => segs[j][i]);
    const blank = Array(s.keys.length).fill('');
    while (rows.length < n) rows.push(blank);
    sh.getRange(CFG.FIRST_ROW, s.col, n, s.keys.length).setValues(rows);
  });
  log_(ss, 'Dọn dẹp', null, null, `Xoá ${removed} chuyến có ETD trước ${fmt_(limit)}; còn ${keep.length} dòng.`);
  notify_(`🧹 Đã xoá ${removed} chuyến cũ, còn ${keep.length} dòng.`);
}

// ------------------------------------------------------------------ XOÁ SERVICE ĐỘ TIN CẬY THẤP (SERVICE_MASTER)
// Bỏ các service có cột "Độ tin cậy" = Thấp (ước tính từ quá ít lô follow-up). Chỉ dồn các ô nhập liệu,
// giữ nguyên công thức (ID, Thứ ETD, Thứ cut-off, Số lô, Tỷ lệ, Độ tin cậy, ETD gần nhất, KEY).
function removeLowConfidence() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('SERVICE_MASTER');
  if (!sh) throw new Error('Không tìm thấy sheet SERVICE_MASTER');
  const N = 100, W = 25;                                   // dòng 2–101, cột A–Y
  const H = sh.getRange(1, 1, 1, W).getValues()[0].map(v => norm_(v));
  const iRel = H.indexOf('ĐỘ TIN CẬY');
  if (iRel < 0) throw new Error('SERVICE_MASTER không có cột "Độ tin cậy"');
  const rg = sh.getRange(2, 1, N, W);
  const vals = rg.getValues(), fx = rg.getFormulas();
  const input = [];                                        // cột nhập liệu = không có công thức ở dòng 2
  for (let c = 0; c < W; c++) if (!fx[0][c]) input.push(c);
  const used = r => input.some(c => String(vals[r][c]).trim() !== '');
  const low = [], keep = [];
  for (let r = 0; r < N; r++) {
    if (!used(r)) continue;
    if (norm_(vals[r][iRel]) === 'THẤP') low.push(r); else keep.push(r);
  }
  if (!low.length) { notify_('Không có service nào độ tin cậy "Thấp".'); return; }
  const iPod = H.indexOf('POD'), iCar = H.indexOf('HÃNG');
  const list = low.map(r => `${vals[r][iPod]} – ${vals[r][iCar]}`).join(', ');
  if (isManual_()) {
    const ui = SpreadsheetApp.getUi();
    const ok = ui.alert('Xoá ' + low.length + ' service độ tin cậy "Thấp"?', list + '\n\nCòn lại ' + keep.length + ' service. (Có thể khôi phục qua File → Version history.)', ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;
  }
  // Ghi lại theo từng đoạn cột nhập liệu liền nhau (không đè lên cột công thức)
  const segs = [];
  input.forEach(c => { const last = segs[segs.length - 1]; if (last && last[1] === c - 1) last[1] = c; else segs.push([c, c]); });
  segs.forEach(([a, b]) => {
    const rows = keep.map(r => vals[r].slice(a, b + 1));
    while (rows.length < N) rows.push(Array(b - a + 1).fill(''));
    sh.getRange(2, a + 1, N, b - a + 1).setValues(rows);
  });
  log_(ss, 'SERVICE_MASTER', null, null, `Xoá ${low.length} service độ tin cậy Thấp: ${list}. Còn ${keep.length} service.`);
  notify_(`🧽 Đã xoá ${low.length} service độ tin cậy "Thấp". Còn ${keep.length} service.`);
}

function upgradeNow() {
  const ss = SpreadsheetApp.getActive();
  ensureCapacity_(ss);
  notify_(`📈 Sổ tay đã sẵn sàng cho ${CFG.CAPACITY} dòng lịch thực tế.`);
}

// ------------------------------------------------------------------ TRIGGERS
function enableHourly() {
  disableHourly(true);
  ScriptApp.newTrigger('importInbox').timeBased().everyHours(1).create();
  notify_('⏰ Đã bật: mỗi giờ tự lấy lịch từ Gmail và nhập file mới trong thư mục Inbox.');
}
function disableHourly(silent) {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'importInbox').forEach(t => ScriptApp.deleteTrigger(t));
  if (silent !== true) notify_('⛔ Đã tắt tự nhập.');
}

// ------------------------------------------------------------------ LOG
function log_(ss, source, res, err, text) {
  const sh = ss.getSheetByName(CFG.LOG);
  if (!sh) return;
  const col = sh.getRange('A2:A1000').getValues();
  let r = col.findIndex(v => v[0] === '') + 2;
  if (r < 2) r = sh.getLastRow() + 1;
  const content = text || (err ? 'LỖI: ' + err : `Thêm ${res.added}, cập nhật ${res.updated}, không đổi ${res.same}` + (res.skipped ? `, bỏ qua ${res.skipped}` : ''));
  const today = serialFromDate_(new Date(), ss.getSpreadsheetTimeZone(), true);
  sh.getRange(r, 1, 1, 6).setValues([[today, `=IF(A${r}="","",ISOWEEKNUM(A${r}))`, source, content, res ? res.added + res.updated : '', 'Apps Script']]);
  sh.getRange(r, 1).setNumberFormat('dd/mm/yyyy');
}

// ------------------------------------------------------------------ HELPERS
function norm_(v) { return String(v).replace(/\s+/g, ' ').trim().toUpperCase(); }
function key_(car, voy, pod, tpod) { return [car, voy, pod, tpod].map(x => norm_(x)).join('|'); }

const CARRIERS = { ANL: 'ANL', CNC: 'CNC', CMA: 'CMA CGM', CMACGM: 'CMA CGM', APL: 'APL', RCL: 'RCL', ONE: 'ONE', COSCO: 'COSCO',
  YML: 'YML', YANGMING: 'YML', SITC: 'SITC', WHL: 'WHL', WANHAI: 'WHL', EMC: 'EVERGREEN', EVERGREEN: 'EVERGREEN', MAERSK: 'MAERSK',
  MSC: 'MSC', HAPAG: 'HAPAG-LLOYD', HPL: 'HAPAG-LLOYD', OOCL: 'OOCL', PIL: 'PIL', KMTC: 'KMTC', SINOKOR: 'SINOKOR', TSL: 'TSL',
  HAIAN: 'HAIAN', PANOCEAN: 'PAN OCEAN', ZIM: 'ZIM', HMM: 'HMM', VASI: 'VASI' };
function carrierFromName_(name) {
  const t = String(name).split(/[-_ .]/)[0].toUpperCase();
  return CARRIERS[t] || t;
}
// Tìm tên hãng ở bất kỳ vị trí nào trong tên file; nếu không có thì tìm trong nội dung file
function carrierOf_(fileName, text) {
  const toks = String(fileName).toUpperCase().split(/[^A-Z]+/);
  for (const t of toks) if (CARRIERS[t]) return CARRIERS[t];
  if (/REGIONAL CONTAINER LINES|RCLGROUP/i.test(text || '')) return 'RCL';
  return '';
}
function portCode_(v) {
  const s = norm_(v).split(',')[0].trim();
  return PORTS[s] || s;
}
function terminal_(v) {
  const s = norm_(v);
  return TERMINALS[s] || String(v).trim();
}

// Ngày → số serial (không phụ thuộc múi giờ). Hỗ trợ: "Tuesday, 03-NOV-2026", "02-NOV 2026, 10:00 AM",
// "dd/mm/yyyy [hh:mm]", "yyyy-mm-dd [hh:mm]", và ô ngày của Google Sheets.
function parseDate_(v, ref) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return serialFromDate_(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), false);
  }
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  let m = s.match(/(\d{1,2})-([A-Za-z]{3})[- ](\d{4})(?:,?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
  if (m) {
    let h = m[4] ? +m[4] : 0;
    if (m[6]) { const pm = m[6].toUpperCase() === 'PM'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    return serial_(+m[3], MON[m[2].toUpperCase()], +m[1], h, m[5] ? +m[5] : 0);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return serial_(+m[3], +m[2], +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/);               // 12/10/26 23:00
  if (m) return serial_(2000 + +m[3], +m[2], +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  m = s.match(/^(\d{1,2})-([A-Za-z]{3})$/);                                                   // 1-Oct (không có năm)
  if (m && MON[m[2].toUpperCase()]) return nearYear_(MON[m[2].toUpperCase()], +m[1], ref);
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);                                                      // 08/10 (dd/mm)
  if (m) return nearYear_(+m[2], +m[1], ref);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return serial_(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  return '';
}
// Ngày không có năm → chọn năm gần ngày tham chiếu nhất (ETD của chuyến, hoặc hôm nay)
function nearYear_(mo, d, ref) {
  const base = ref || serialFromDate_(new Date(), SpreadsheetApp.getActive().getSpreadsheetTimeZone(), true);
  const y = new Date((base - 25569) * 86400000).getUTCFullYear();
  let best = '', diff = 1e9;
  [y - 1, y, y + 1].forEach(yy => { const v = serial_(yy, mo, d, 0, 0); const df = ref ? (v >= ref ? v - ref : 1e6) : Math.abs(v - base); if (df < diff) { diff = df; best = v; } });
  return best;
}
function serial_(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h || 0, mi || 0) / 86400000 + 25569; }
function roundMin_(x) { return x === '' ? '' : Math.round(x * 1440) / 1440; }
function serialFromDate_(date, tz, dateOnly) {
  const p = Utilities.formatDate(date, tz, 'yyyy-M-d-H-m').split('-').map(Number);
  return dateOnly ? serial_(p[0], p[1], p[2], 0, 0) : serial_(p[0], p[1], p[2], p[3], p[4]);
}
function cellSerial_(v, tz) {
  if (v === '' || v === null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return serialFromDate_(v, tz, false);
  return typeof v === 'number' ? v : parseDate_(v);
}
function fmt_(serial) {
  const d = new Date(Math.round((serial - 25569) * 1440) * 60000);
  const p = n => String(n).padStart(2, '0');
  const t = (d.getUTCHours() || d.getUTCMinutes()) ? ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : '';
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}${t}`;
}
function isManual_() { try { SpreadsheetApp.getUi(); return true; } catch (e) { return false; } }
function notify_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }   // chạy theo giờ: không có UI → ghi log
}

