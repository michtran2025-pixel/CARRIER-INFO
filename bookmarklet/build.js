// Tạo dòng "javascript:…" để dán vào ô URL của bookmark.
// Chạy: node bookmarklet/build.js  → ghi evergreen.bookmarklet.txt và trang cài đặt Cai_dat_bookmarklet.html
const fs = require('fs');
const path = require('path');

function build(src) {
  const body = src
    .replace(/\/\*[\s\S]*?\*\//g, '')          // khối chú thích /* … */
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//'))       // dòng chú thích
    .join('\n');
  return 'javascript:' + encodeURIComponent(body);
}

if (require.main === module) {
  const src = fs.readFileSync(path.join(__dirname, 'evergreen.js'), 'utf8');
  const out = build(src);
  fs.writeFileSync(path.join(__dirname, 'evergreen.bookmarklet.txt'), out + '\n');
  const page = fs.readFileSync(path.join(__dirname, 'cai-dat.template.html'), 'utf8')
    .replace('__EMC__', out.replace(/&/g, '&amp;').replace(/"/g, '&quot;'));
  fs.writeFileSync(path.join(__dirname, 'Cai_dat_bookmarklet.html'), page);
  console.log('OK – ' + out.length + ' ký tự → evergreen.bookmarklet.txt, Cai_dat_bookmarklet.html');
}
module.exports = { build };
