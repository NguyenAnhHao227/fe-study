#!/usr/bin/env node
/* Nhập bản dịch + giải thích SSA101 từ ssa-vi/done/*.json vào data/ssa101.js (chỉ ĐIỀN chỗ trống, không ghi đè).
 *   node tools/ssa-vi-import.js --check     kiểm tra, không ghi
 *   node tools/ssa-vi-import.js             nhập thật (tự sao lưu vào backups/)
 * Mỗi tệp done/*.json là mảng các dòng: [id, tv, [dịch A, B, C, D…], e, ev]  ("" = bỏ qua phần đó)
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..'), file = path.join(root, 'data', 'ssa101.js');
const CHECK = process.argv.includes('--check');
const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
const bank = ctx.window.BANKS.SSA101, byId = new Map(bank.questions.map(q => [q.id, q]));
const dir = path.join(root, 'ssa-vi', 'done');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.json$/.test(f)).sort() : [];
let st = { tv: 0, opt: 0, e: 0, ev: 0, rows: 0 }; const errs = [];
for (const f of files) {
  let rows; try { rows = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { errs.push(f + ': JSON lỗi — ' + e.message); continue; }
  for (const r of rows) {
    const [id, tv, os, e, ev] = r, q = byId.get(id);
    if (!q) { errs.push(f + ': không có câu ' + id); continue; }
    st.rows++;
    if (os && os.length && os.length !== q.o.length) { errs.push(`${f}: ${id} có ${q.o.length} đáp án nhưng bản dịch có ${os.length}`); continue; }
    if (tv && !q.tv) { q.tv = tv; st.tv++; }
    if (os && os.length) q.o.forEach((o, k) => { if (!o[2] && os[k]) { o[2] = os[k]; st.opt++; } });
    if (e && !q.e) { q.e = e; st.e++; }
    if (ev && !q.ev) { q.ev = ev; st.ev++; }
  }
}
const Q = bank.questions;
console.log(`Tệp: ${files.length} | dòng: ${st.rows} | điền mới: câu ${st.tv}, đáp án ${st.opt}, giải thích EN ${st.e}, VI ${st.ev}`);
console.log(`Còn thiếu: dịch câu ${Q.filter(q => !q.tv).length}, dịch đáp án ${Q.filter(q => q.o.some(o => !o[2])).length} câu, giải thích ${Q.filter(q => !(q.e && q.ev)).length} câu`);
if (errs.length) { console.log('LỖI:\n' + errs.join('\n')); }
if (CHECK || errs.length && !process.argv.includes('--force')) { console.log(CHECK ? '(--check: chưa ghi gì)' : 'Có lỗi nên chưa ghi. Sửa rồi chạy lại (hoặc --force).'); process.exit(errs.length ? 1 : 0); }
const bk = path.join(root, 'backups'); fs.mkdirSync(bk, { recursive: true });
fs.copyFileSync(file, path.join(bk, 'ssa101-vi-' + new Date().toISOString().replace(/[:.]/g, '-') + '.js'));
fs.writeFileSync(file + '.tmp', `window.BANKS = window.BANKS || {};\nwindow.BANKS.SSA101 = ${JSON.stringify(bank)};\n`);
fs.renameSync(file + '.tmp', file);
console.log('Đã ghi data/ssa101.js');
