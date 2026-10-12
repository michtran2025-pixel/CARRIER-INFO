/**
 * Bookmarklet "Copy lịch EMC" – ShipmentLink (Evergreen) → 17 cột MAU_NHAP
 * Trang dùng: ShipmentLink → Sailing Schedules → Search by Point → trang kết quả.
 * Bấm bookmark → dữ liệu được copy (TAB, không tiêu đề) → dán vào MAU_NHAP!A2 → menu 📋 Nhập.
 * Bản rút gọn để dán vào bookmark: chạy `node bookmarklet/build.js`.
 */
(function () {
  var PORTS = {
    'HAIPHONG': 'VNHPH', 'HAI PHONG': 'VNHPH', 'HO CHI MINH': 'VNSGN', 'CAI MEP': 'VNCMT',
    'TOKYO': 'JPTYO', 'KOBE': 'JPUKB', 'YOKOHAMA': 'JPYOK', 'OSAKA': 'JPOSA', 'NAGOYA': 'JPNGO',
    'INCHEON': 'KRINC', 'BUSAN': 'KRPUS', 'MANILA': 'PHMNL', 'DAVAO': 'PHDVO', 'JAKARTA': 'IDJKT',
    'SURABAYA': 'IDSUB', 'LAEM CHABANG': 'THLCH', 'BANGKOK': 'THBKK', 'PORT KLANG': 'MYPKG',
    'PENANG': 'MYPEN', 'TANJUNG PELEPAS': 'MYTPP', 'SINGAPORE': 'SGSIN', 'SHANGHAI': 'CNSHA',
    'NINGBO': 'CNNGB', 'SHEKOU': 'CNSHK', 'XIAMEN': 'CNXMN', 'QINGDAO': 'CNTAO', 'HONG KONG': 'HKHKG',
    'KAOHSIUNG': 'TWKHH', 'TAIPEI': 'TWTPE', 'KEELUNG': 'TWKEL', 'TAICHUNG': 'TWTXG',
    'NHAVA SHEVA': 'INNSA', 'COLOMBO': 'LKCMB', 'SYDNEY': 'AUSYD', 'MELBOURNE': 'AUMEL',
    'BRISBANE': 'AUBNE', 'LOS ANGELES': 'USLAX', 'LONG BEACH': 'USLGB', 'ROTTERDAM': 'NLRTM',
    'HAMBURG': 'DEHAM'
  };
  var MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

  function txt(el) { return el ? el.textContent.replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : ''; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // "OCT-30-2026 17:00" → "2026-10-30 17:00"; "----" → ""
  function date(s) {
    var m = String(s).match(/([A-Z]{3})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i);
    if (!m || !MON[m[1].toUpperCase()]) return '';
    return m[3] + '-' + pad(MON[m[1].toUpperCase()]) + '-' + pad(+m[2]) + (m[4] ? ' ' + pad(+m[4]) + ':' + m[5] : '');
  }
  function param(span, name) {
    var m = (span.getAttribute('params') || '').match(new RegExp('(?:^|&)' + name + '=([^&]*)'));
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() : '';
  }

  // Mã cảng của điểm đi / điểm đến ghi ở dòng "The schedules from HAIPHONG, VIETNAM (VNHPH) … to SINGAPORE (SGSIN)"
  var known = {};
  Array.prototype.forEach.call(document.querySelectorAll('span'), function (s) {
    var m = txt(s).match(/^(.+?)\s*\(([A-Z]{5})\)/);
    if (m) known[m[1].toUpperCase()] = m[2];
  });
  function port(name) {
    var n = String(name).toUpperCase().trim();
    if (!n || n === '----') return { code: '', ok: true };
    if (known[n]) return { code: known[n], ok: true };
    var head = n.split(',')[0].trim();
    if (PORTS[head]) return { code: PORTS[head], ok: true };
    return { code: n, ok: false };
  }

  var rows = [], warn = [];
  var vessels = document.querySelectorAll('span[title="Vessel Schedule"]');
  Array.prototype.forEach.call(vessels, function (vs) {
    var grp = vs.closest('thead, tbody');
    if (!grp || grp.closest('[id^="detailSeq"]')) return;
    var tr = grp.querySelectorAll(':scope > tr');
    if (tr.length < 2) return;
    var a = tr[0].querySelectorAll(':scope > td'), b = tr[1].querySelectorAll(':scope > td');
    var c = tr[2] ? tr[2].querySelectorAll(':scope > td') : [];
    // a: No | Receipt | POL | Port cut-off | Service | POD | Delivery | Transit | Details | Remark
    // b: Receipt dep | POL dep (ETD) | VGM giấy | Vessel Voyage | POD arr (ETA) | Delivery arr
    // c: VGM EDI/WEB/APP
    var no = txt(a[0]);
    var pol = port(txt(a[2])), pod = port(txt(a[5]));
    var svc = txt(a[4]);
    var ves = param(vs, 'vslName'), voy = param(vs, 'voyage');
    if (!ves || !voy) { var vv = txt(vs).match(/^(.*)\s+(\S+)$/); if (vv) { ves = ves || vv[1]; voy = voy || vv[2]; } }
    var etd = date(txt(b[1])), eta = date(txt(b[4]));
    var cy = date(txt(a[3])), vgmPaper = date(txt(b[2])), vgm = date(txt(c[0])) || vgmPaper;
    if (!etd || !voy) { warn.push('Dòng ' + no + ': thiếu ETD hoặc voyage – bỏ qua'); return; }

    // Routing details (bảng ẩn #detailSeqNN): nhiều chặng = T/S
    var ts = 'Direct', tsp = [], notes = [];
    var det = a[8] && a[8].querySelector('[params*="seq="]');
    var seq = det ? param(det, 'seq') : '';
    var legs = seq ? document.querySelectorAll('#detailSeq' + seq + ' tr') : [];
    legs = Array.prototype.filter.call(legs, function (r) { return r.querySelectorAll(':scope > td').length >= 8; });
    if (legs.length > 1) {
      ts = 'T/S';
      var conn = [];
      legs.forEach(function (r, i) {
        var d = r.querySelectorAll(':scope > td');
        if (i < legs.length - 1) { var p = port(txt(d[2])); tsp.push(p.code); if (!p.ok) notes.push('kiểm tra mã cảng ' + p.code); }
        if (i > 0) conn.push(txt(d[6]) + (txt(d[5]) ? ' (' + txt(d[5]) + ')' : ''));
      });
      notes.unshift('Nối tàu ' + conn.join(' → '));
    } else if (!legs.length) {
      notes.push('chưa có Routing Details – kiểm tra Direct/T/S');
    }
    if (!pol.ok) notes.push('kiểm tra mã cảng ' + pol.code);
    if (!pod.ok) notes.push('kiểm tra mã cảng ' + pod.code);
    if (vgmPaper && vgm !== vgmPaper) notes.push('VGM giấy ' + vgmPaper);
    var remark = txt(a[9]);
    if (remark) notes.push('EMC: ' + remark);

    rows.push({ etd: etd, cells: [
      'EVERGREEN', svc, ves, voy, pol.code, '', pod.code, '',
      '', '', vgm, cy, etd, eta, ts, tsp.join(', '), notes.join('; ')
    ] });
  });

  window.__emcRows = rows;   // dùng cho kiểm thử
  if (window.__emcTest) return;

  if (!rows.length) {
    alert('Không thấy lịch tàu trên trang này.\nHãy mở trang KẾT QUẢ của ShipmentLink → Sailing Schedules (Search by Point) rồi bấm lại.');
    return;
  }
  rows.sort(function (x, y) { return x.etd < y.etd ? -1 : x.etd > y.etd ? 1 : 0; });
  var tsv = rows.map(function (r) { return r.cells.map(function (v) { return String(v).replace(/[\t\r\n]+/g, ' '); }).join('\t'); }).join('\n');
  var msg = '✅ Đã copy ' + rows.length + ' chuyến Evergreen.\nMở sheet MAU_NHAP → bấm ô A2 → Ctrl + V → menu 🚢 Lịch tàu → 📋 Nhập.' +
            (warn.length ? '\n\n⚠️ ' + warn.join('\n⚠️ ') : '');
  function fallback() {
    var t = document.createElement('textarea');
    t.value = tsv; t.style.position = 'fixed'; t.style.top = '-1000px';
    document.body.appendChild(t); t.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(t);
    if (ok) alert(msg); else prompt('Không copy tự động được. Bấm Ctrl + C để copy:', tsv);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(tsv).then(function () { alert(msg); }, fallback);
  } else fallback();
})();
