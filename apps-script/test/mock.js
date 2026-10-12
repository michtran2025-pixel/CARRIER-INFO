// Giả lập Google Sheets / Apps Script tối thiểu để chạy Code.gs bằng Node.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const TZ = 'Asia/Ho_Chi_Minh';

// ---- Google Sheets giả lập (chỉ những hàm Code.gs dùng khi nhập từ MAU_NHAP)
function makeSheet(name, rows, cols) {
  const g = Array.from({ length: rows }, () => Array(cols).fill(''));
  const sh = {
    g, getName: () => name, getMaxRows: () => g.length,
    getLastRow: () => { for (let i = g.length - 1; i >= 0; i--) if (g[i].some(v => v !== '')) return i + 1; return 0; },
    getLastColumn: () => cols,
    insertRowsAfter: (_, n) => { for (let i = 0; i < n; i++) g.push(Array(cols).fill('')); },
    getRange: (r, c, nr = 1, nc = 1) => {
      if (typeof r === 'string') { const m = r.match(/^([A-Z])(\d+):[A-Z](\d+)$/); r = +m[2]; c = m[1].charCodeAt(0) - 64; nr = +m[3] - r + 1; nc = 1; }
      return {
        getRow: () => r, getColumn: () => c, getNumColumns: () => nc, getSheet: () => sh,
        getValues: () => Array.from({ length: nr }, (_, i) => g[r - 1 + i].slice(c - 1, c - 1 + nc)),
        setValues: v => v.forEach((row, i) => row.forEach((x, j) => { g[r - 1 + i][c - 1 + j] = x; })),
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) g[r - 1 + i][c - 1 + j] = ''; },
        setNumberFormat: () => {}
      };
    }
  };
  return sh;
}

function loadCodeGs(sheets, toasts, extra) {
  const ss = { getSheetByName: n => sheets[n] || null, getSpreadsheetTimeZone: () => TZ, toast: (m, t) => toasts.push(t + ': ' + m) };
  const ctx = {
    console, Date, Math, String, Number, Object, Array, Set, RegExp, JSON,
    SpreadsheetApp: { getActive: () => ss, getUi: () => { throw new Error('không có UI trong onEdit'); }, flush: () => {} },
    PropertiesService: { getDocumentProperties: () => ({ getProperty: () => '1500', setProperty: () => {} }) },
    Utilities: {
      formatDate: (d, tz, f) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
          .formatToParts(d).map(x => [x.type, x.value]));
        assert.strictEqual(f, 'yyyy-M-d-H-m');
        return [p.year, p.month, p.day, p.hour, p.minute].map(Number).join('-');
      }
    }
  };
  Object.assign(ctx, extra || {});
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx);
  return { ctx, ss };
}


module.exports = { makeSheet, loadCodeGs, TZ };
