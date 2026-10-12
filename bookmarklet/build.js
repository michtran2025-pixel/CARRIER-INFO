// Tạo dòng "javascript:…" để dán vào ô URL của bookmark.
// Chạy: node bookmarklet/build.js  → ghi bookmarklet/evergreen.bookmarklet.txt
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
  console.log('OK – ' + out.length + ' ký tự → bookmarklet/evergreen.bookmarklet.txt');
}
module.exports = { build };
