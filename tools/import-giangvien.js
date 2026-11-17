#!/usr/bin/env node
/* Nạp "Đề của giảng viên gửi" (file .txt có dấu ✓ ở đáp án đúng) vào data/cea201.js như một MỤC RIÊNG
 * (mỗi câu có g:'gv'; câu từ source mua không có g, coi như g:'src').
 *
 *   node tools/import-giangvien.js "<đường dẫn file .txt>" [--dry]
 *
 * Chạy lại nhiều lần được: câu cũ của giảng viên bị thay bằng bản mới, nhưng BẢN DỊCH và GIẢI THÍCH đã có được giữ lại (theo số câu).
 * Lưu ý: tools/convert-quiz-js.js ghi đè data/cea201.js, nên nếu chạy lại nó thì chạy lại lệnh này sau đó.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('Cách dùng: node tools/import-giangvien.js "<file.txt>" [--dry]'); process.exit(1); }

const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r/g, '');
const lines = text.split('\n');

// ---- đọc câu hỏi ----
const OPT = /^(✓)?\s*([A-H])\.\s?(.*)$/;
const cleanOpt = s => s.trim().replace(/^\.\s+/, '');           // "A. . Always 1" -> "Always 1"
const cleanStem = s => {
  s = s.replace(/\s+/g, ' ').trim();
  if (/^[a-z]/.test(s)) s = '________ ' + s;                     // vế đầu bị mất ("refers to…") -> thêm chỗ trống cho dễ đọc
  return s;
};
const qs = [];
let cur = null, endAt = lines.findIndex(l => /^_{5,}\s*$/.test(l.trim()));
if (endAt < 0) endAt = lines.length;
for (let i = 0; i < endAt; i++) {
  const l = lines[i];
  const m = l.match(/^Question\s*#\s*(\d+)\s*$/);
  if (m) { cur = { n: +m[1], stem: [], opts: [] }; qs.push(cur); continue; }
  if (!cur) continue;
  const o = l.match(OPT);
  if (o && (cur.opts.length || cur.stem.length)) { cur.opts.push({ k: o[2], t: cleanOpt(o[3]), ok: !!o[1] }); continue; }
  if (cur.opts.length) { if (l.trim()) cur.opts[cur.opts.length - 1].t += ' ' + l.trim(); continue; } // dòng đáp án bị xuống dòng
  if (l.trim()) cur.stem.push(l.trim());
}

// ---- bảng đáp án cuối file để đối chiếu ----
const key = {};
for (const l of lines.slice(endAt)) for (const m of l.matchAll(/#(\d+)\s*:\s*([A-H]+)/g)) key[+m[1]] = m[2];

// Sửa đáp án đã được người quản lý xác nhận (đề của giảng viên đánh dấu khác). Chạy lại công cụ vẫn giữ các sửa này.
const FIX = { 20: 'D', 184: 'B' };   // 20: AB + A'B = B nên "Depends on the values of A and B"; 184: AND có bong bóng ở đầu vào = NOR
const problems = [];
const questions = qs.map(q => {
  const a = FIX[q.n] || q.opts.filter(o => o.ok).map(o => o.k).join('');
  const id = 'CEA201_GV' + String(q.n).padStart(3, '0');
  if (q.opts.length < 2) problems.push(`#${q.n}: thiếu đáp án`);
  if (!a) problems.push(`#${q.n}: không có đáp án đúng (✓)`);
  if (key[q.n] && key[q.n] !== a && !FIX[q.n]) problems.push(`#${q.n}: dấu ✓ = ${a} nhưng bảng đáp án cuối file = ${key[q.n]}`);
  if (!key[q.n]) problems.push(`#${q.n}: không có trong bảng đáp án cuối file`);
  return { id, t: cleanStem(q.stem.join(' ')), o: q.opts.map(o => [o.k, o.t, '']), a, s: -1, g: 'gv' };
});
const nums = qs.map(q => q.n);
for (let i = 1; i <= Math.max(...nums); i++) if (!nums.includes(i)) problems.push(`thiếu câu #${i}`);

console.log(`Đọc được ${questions.length} câu (số cuối ${Math.max(...nums)}), bảng đáp án có ${Object.keys(key).length} mục.`);
if (problems.length) { console.log('CẦN XEM LẠI:'); problems.forEach(p => console.log('  - ' + p)); }

// ---- ghép vào data/cea201.js ----
const out = path.join(root, 'data', 'cea201.js');
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(out, 'utf8'), ctx);
const bank = ctx.window.BANKS.CEA201;

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const old = new Map(bank.questions.filter(q => q.g === 'gv').map(q => [q.id, q]));
bank.questions = bank.questions.filter(q => q.g !== 'gv');
let tIdx = bank.topics.findIndex(t => t.name === 'Đề giảng viên gửi');
if (tIdx < 0) { bank.topics.push({ name: 'Đề giảng viên gửi' }); tIdx = bank.topics.length - 1; }
let kept = 0;
for (const q of questions) {
  q.s = tIdx;
  const o = old.get(q.id);
  if (o) { // giữ bản dịch và giải thích đã có (tools/explain-queue.js ghi q.e / q.ev)
    if (o.e) q.e = o.e;
    if (o.ev) q.ev = o.ev;
    if (o.tv && norm(o.t) === norm(q.t)) { q.tv = o.tv; kept++; }
    q.o.forEach((x, i) => { const y = (o.o || []).find(p => p[0] === x[0]); if (y && y[2] && norm(y[1]) === norm(x[1])) q.o[i][2] = y[2]; });
  }
  bank.questions.push(q);
}
bank.sets = [
  { id: 'gv', name: 'Đề của giảng viên', short: 'Giảng viên', desc: 'Bộ câu hỏi ôn tập do giảng viên gửi (đáp án đã được đánh dấu sẵn).', icon: '👨‍🏫' },
  { id: 'src', name: 'Đề cũ (source đã mua)', short: 'Source cũ', desc: 'Các câu hỏi từ nguồn đề cũ đã mua.', icon: '📚' },
];

// so sánh với đề cũ: bao nhiêu câu giống hệt
const srcKeys = new Set(bank.questions.filter(q => q.g !== 'gv').map(q => norm(q.t)));
const same = questions.filter(q => srcKeys.has(norm(q.t))).length;
const uniq = new Set(questions.map(q => norm(q.t) + '|' + q.o.map(o => norm(o[1])).sort().join('|'))).size;
console.log(`Trong ${questions.length} câu: ${questions.length - uniq} câu trùng nhau ngay trong đề giảng viên (vẫn giữ nguyên theo số câu), ${same} câu có phần đề giống một câu bên đề cũ.`);
console.log(`Giữ lại bản dịch cũ: ${kept} câu. Tổng CEA201 sau khi nạp: ${bank.questions.length} câu.`);

if (dry) { console.log('(--dry: chưa ghi gì)'); process.exit(0); }
fs.writeFileSync(out + '.tmp', `window.BANKS = window.BANKS || {};\nwindow.BANKS.CEA201 = ${JSON.stringify(bank)};\n`);
fs.renameSync(out + '.tmp', out);
console.log('Đã ghi data/cea201.js');
