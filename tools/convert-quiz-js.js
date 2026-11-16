#!/usr/bin/env node
/* Chuyển 3 file dữ liệu cũ (questions_data.js, csi104_data.js, suoc_data.js) sang định dạng của FE Study.
 * Ghi ra data/csi106.js, cea201.js, prf192.js, ssa101.js (ghi đè hoàn toàn).
 *
 *   node tools/convert-quiz-js.js [thư-mục-nguồn]
 *   (mặc định: Nguon_de_thi_on_tap_5_mon_FE/Computer_Systems_Quiz_App_Public)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = path.resolve(process.argv[2] || path.join(root, 'Nguon_de_thi_on_tap_5_mon_FE', 'Computer_Systems_Quiz_App_Public'));

function load(file, name) {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(src, file), 'utf8') + ';this.__d=' + name, ctx);
  return ctx.__d;
}
const CS = load('questions_data.js', 'questionsData');     // CSI106, 600 câu, 12 chương
const CEA = load('csi104_data.js', 'CSI104_QUESTIONS');    // CEA201, 318 câu (chia 7 phần)
const SUOC = load('suoc_data.js', 'SUOC_QUESTIONS');       // kho tổng hợp: CSI106 / PRF192 / SSA101 / CEA201

// Dữ liệu nguồn có chỗ bị mã hoá HTML (&lt; &gt; &amp; …): giải mã để hiển thị đúng << , > , <= …
const unescapeHtml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const clean = s => unescapeHtml(String(s == null ? '' : s)).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
const norm = s => clean(s).toLowerCase().replace(/\s+/g, ' ');
const letters = c => [...new Set(String(c).toUpperCase().match(/[A-H]/g) || [])].sort().join('');

function optionsOf(x) {
  return Object.keys(x.options || {}).sort().map(k => [k, clean(x.options[k]), clean((x.options_vn || {})[k])]);
}
function explFromRich(ex) { // giải thích dài của bộ questions_data
  if (!ex) return '';
  const p = [];
  if (ex.rationale) p.push(clean(ex.rationale));
  if (ex.theory) p.push('📘 Lý thuyết: ' + clean(ex.theory));
  if (Array.isArray(ex.distractors) && ex.distractors.length) p.push('✗ Các đáp án còn lại:\n' + ex.distractors.map(d => '• ' + clean(d)).join('\n'));
  if (ex.trap) p.push('⚠ Bẫy thường gặp: ' + clean(ex.trap));
  if (ex.takeaway) p.push('💡 Ghi nhớ: ' + clean(ex.takeaway));
  return p.join('\n\n');
}

function makeBank() { return { topics: [], questions: [], mocks: [], _seen: new Map(), dropped: [] }; }
function topicIdx(b, name) {
  let i = b.topics.findIndex(t => t.name === name);
  if (i < 0) { b.topics.push({ name }); i = b.topics.length - 1; }
  return i;
}
function add(b, { id, t, tv, o, a, e, topic }) {
  t = clean(t);
  if (!t || o.length < 2 || !a || o.some(x => !x[1])) { b.dropped.push([id, 'thiếu nội dung/đáp án']); return; }
  const key = norm(t) + '|' + o.map(x => norm(x[1])).sort().join('|');
  if (b._seen.has(key)) { b.dropped.push([id, 'trùng với ' + b._seen.get(key).id + (b._seen.get(key).a !== a ? ' (KHÁC đáp án!)' : '')]); return; }
  const q = { id, t, o, a, s: topicIdx(b, topic) };
  if (tv && norm(tv) !== norm(t)) q.tv = clean(tv);
  if (e) q.e = clean(e);
  b._seen.set(key, q); b.questions.push(q);
}

const banks = { CSI106: makeBank(), CEA201: makeBank(), PRF192: makeBank(), SSA101: makeBank() };

// ---- CSI106: 600 câu theo chương ----
for (const x of CS) {
  const ch = clean(x.chapter_name).replace(/^Chapter\s*\d+\s*:\s*/i, '');
  add(banks.CSI106, { id: x.id, t: x.question, tv: x.question_vn, o: optionsOf(x), a: letters(x.correct), e: explFromRich(x.explanation), topic: `Ch${String(x.chapter).padStart(2, '0')} · ${ch}` });
}
// ---- CEA201: lấy câu từ kho tổng hợp, phân phần theo file csi104 ----
const ceaPart = new Map(CEA.map(x => [norm(x.question), clean(x.topic).replace(/:.*$/, '')]));
// ---- kho tổng hợp ----
for (const x of SUOC) {
  const b = banks[x.course]; if (!b) continue;
  let topic = 'Kho đề ôn thi (tổng hợp)';
  if (x.course === 'CEA201') topic = ceaPart.get(norm(x.question)) || 'Khác';
  if (x.course === 'PRF192' || x.course === 'SSA101') topic = 'Tổng hợp';
  add(b, { id: x.id, t: x.question, tv: x.question_vn, o: optionsOf(x), a: letters(x.correct), e: x.note, topic });
}

// ---- ghi file ----
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
let total = 0;
for (const [code, b] of Object.entries(banks)) {
  const out = { topics: b.topics, questions: b.questions, mocks: [] };
  const file = path.join(root, 'data', code.toLowerCase() + '.js');
  fs.writeFileSync(file, `window.BANKS = window.BANKS || {};\nwindow.BANKS.${code} = ${JSON.stringify(out)};\n`);
  total += b.questions.length;
  const multi = b.questions.filter(q => q.a.length > 1).length;
  console.log(`${code}: ${b.questions.length} câu, ${b.topics.length} chủ đề, ${multi} câu nhiều đáp án, bỏ ${b.dropped.length} → ${path.relative(root, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
  b.dropped.forEach(([id, why]) => console.log(`   - bỏ ${id}: ${why}`));
}
console.log('Tổng:', total, 'câu');
