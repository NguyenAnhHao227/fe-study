#!/usr/bin/env node
/* Dịch HÀNG LOẠT phần còn thiếu (câu hỏi và/hoặc từng đáp án) và GHI THẲNG bản dịch vào data/*.js.
 * Làm một lần là mọi người có bản dịch sẵn, không tốn lượt AI lúc dùng, hiển thị tức thì.
 *
 * Dùng API key của bạn qua biến môi trường (KHÔNG ghi vào file/repo). PowerShell:
 *   $env:AI_BASE  = "https://api.xah.io/v1"
 *   $env:AI_KEY   = "sk-..."
 *   $env:AI_MODEL = "vantoanbk57/deepseek-v4.1-flash-1017"
 *   node tools/translate-bank.js --dry                 # chỉ đếm, không gọi AI
 *   node tools/translate-bank.js --only CSI106 --limit 20   # thử 20 câu trước
 *   node tools/translate-bank.js                       # dịch toàn bộ phần còn thiếu
 *
 * Tuỳ chọn: --only MÃ_MÔN  --limit N (số câu)  --batch 4 (số câu mỗi lần gọi)  --parallel 3 (số lần gọi song song)
 * Chạy lại được nhiều lần và ngắt (Ctrl+C) lúc nào cũng được: tiến độ đã lưu, lần sau chỉ dịch phần còn thiếu.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const TR = require('../assets/translate-core.js');

const root = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const ONLY = arg('only') ? String(arg('only')).toUpperCase() : null;
const LIMIT = parseInt(arg('limit', '0'), 10) || 0;
const BATCH = Math.max(1, Math.min(6, parseInt(arg('batch', '4'), 10) || 4));
const PARALLEL = Math.max(1, Math.min(6, parseInt(arg('parallel', '3'), 10) || 3));
const DRY = !!arg('dry', false);
const { AI_BASE, AI_KEY, AI_MODEL } = process.env;
const doneFile = path.join(__dirname, '.translate-done.json'); // các phần đã xử lý (kể cả khi AI giữ nguyên chữ) để lần sau không gửi lại
const done = new Set(fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, 'utf8')) : []);
const saveDone = () => fs.writeFileSync(doneFile, JSON.stringify([...done]));

/* ---- đọc các ngân hàng ---- */
const banks = {};
for (const f of fs.readdirSync(path.join(root, 'data'))) {
  if (!/\.js$/.test(f) || f === 'explanations.js') continue;
  const ctx = { window: {} }; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'data', f), 'utf8'), ctx);
  for (const [code, b] of Object.entries(ctx.window.BANKS || {})) banks[code] = { file: path.join(root, 'data', f), bank: b };
}
function saveBank(code) {
  const { file, bank } = banks[code];
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, `window.BANKS = window.BANKS || {};\nwindow.BANKS.${code} = ${JSON.stringify(bank)};\n`);
  fs.renameSync(tmp, file);
}

/* ---- lập danh sách việc ---- */
const jobs = [];
for (const [code, { bank }] of Object.entries(banks)) {
  if (ONLY && code !== ONLY) continue;
  for (const q of bank.questions) {
    const m = TR.missing(q, {});
    const miss = { t: m.t && !done.has(`${code}|${q.id}|T`), o: m.o.filter(k => !done.has(`${code}|${q.id}|${k}`)) };
    if (!TR.isEmpty(miss)) jobs.push({ code, q, miss });
  }
}
const todo = LIMIT ? jobs.slice(0, LIMIT) : jobs;
const parts = todo.reduce((n, j) => n + (j.miss.t ? 1 : 0) + j.miss.o.length, 0);
const byCode = todo.reduce((m, j) => (m[j.code] = (m[j.code] || 0) + 1, m), {});
console.log(`Cần dịch: ${todo.length} câu (${parts} phần) — ${Object.entries(byCode).map(([c, n]) => c + ' ' + n).join(', ') || 'không có'}`);
console.log(`Ước tính: ~${Math.ceil(todo.length / BATCH)} lần gọi AI (mỗi lần ${BATCH} câu, song song ${PARALLEL}).`);
if (DRY || !todo.length) process.exit(0);
if (!AI_BASE || !AI_KEY || !AI_MODEL) { console.error('Thiếu biến môi trường AI_BASE / AI_KEY / AI_MODEL (xem hướng dẫn ở đầu file).'); process.exit(1); }

/* ---- gọi AI ---- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0;
async function ask(system, user, maxTokens) {
  for (let attempt = 0; ; attempt++) {
    let res, j;
    try {
      calls++;
      res = await fetch(AI_BASE.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(90000),
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + AI_KEY },
        body: JSON.stringify({ model: AI_MODEL, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      j = await res.json().catch(() => ({}));
    } catch (e) { if (attempt < 3) { await sleep(2000 * 2 ** attempt); continue; } throw new Error('Lỗi mạng/timeout: ' + e.message); }
    if (res.status === 429 || res.status >= 500) { if (attempt < 4) { await sleep(3000 * 2 ** attempt); continue; } throw new Error(`Dịch vụ AI trả lỗi ${res.status}`); }
    if (!res.ok) { const e = new Error(`Dịch vụ AI trả lỗi ${res.status}: ${(j.error && j.error.message) || j.message || ''}`); e.status = res.status; throw e; }
    const ch = j.choices && j.choices[0], msg = (ch && ch.message) || {};
    const text = (Array.isArray(msg.content) ? msg.content.map(p => p.text || '').join('') : msg.content || '').trim();
    if (!text && ch && ch.finish_reason === 'length' && maxTokens < 4000) { maxTokens = Math.min(4000, maxTokens * 3); continue; } // model "suy nghĩ" ăn hết token
    return text;
  }
}
const isLimit = e => e.status >= 400 && e.status < 500 && /limit|context|token|too (long|large)/i.test(e.message);
async function translateMany(list) { // trả về mảng kết quả { t?, o } song song với list
  const items = list.map(x => ({ t: x.miss.t ? x.q.t : undefined, o: Object.fromEntries(x.miss.o.map(k => [k, x.q.o.find(o => o[0] === k)[1]])) }));
  const total = items.reduce((n, it) => n + (it.t || '').length + Object.values(it.o).join('').length, 0);
  try { return TR.parse(await ask(TR.SYSTEM, TR.buildUser(items), Math.min(4000, Math.max(600, Math.ceil(total * 0.9)))), list.length); }
  catch (e) {
    if (list.length > 1 && isLimit(e)) { const mid = Math.ceil(list.length / 2); return [...await translateMany(list.slice(0, mid)), ...await translateMany(list.slice(mid))]; }
    throw e;
  }
}

/* ---- chạy ---- */
const batches = []; for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
let applied = 0, failedQ = 0, finished = 0;
const dirty = new Set();
async function worker(list, n) {
  try {
    const out = await translateMany(list);
    list.forEach((job, i) => {
      const r = out[i]; let got = 0;
      if (job.miss.t && r.t) { if (TR.norm(r.t) !== TR.norm(job.q.t)) job.q.tv = r.t; done.add(`${job.code}|${job.q.id}|T`); got++; }
      for (const k of job.miss.o) {
        if (!r.o[k]) continue;
        const op = job.q.o.find(o => o[0] === k);
        if (TR.norm(r.o[k]) !== TR.norm(op[1])) op[2] = r.o[k];
        done.add(`${job.code}|${job.q.id}|${k}`); got++;
      }
      if (got) { applied++; dirty.add(job.code); } else failedQ++;
    });
  } catch (e) { failedQ += list.length; console.error(`  ! lô ${n}/${batches.length} lỗi: ${e.message}`); }
  finished++;
}
(async () => {
  const t0 = Date.now();
  for (let i = 0; i < batches.length; i += PARALLEL) {
    await Promise.all(batches.slice(i, i + PARALLEL).map((b, k) => worker(b, i + k + 1)));
    dirty.forEach(saveBank); dirty.clear(); saveDone();
    console.log(`  [${finished}/${batches.length}] đã dịch ${applied} câu, chưa được ${failedQ}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  console.log(`\nXong: dịch ${applied}/${todo.length} câu, ${failedQ} câu chưa dịch được (chạy lại lệnh để thử tiếp), ${calls} lần gọi AI.`);
  console.log('Bản dịch đã được ghi vào data/*.js — nhớ commit & push để mọi người dùng.');
})();
process.on('SIGINT', () => { try { saveDone(); } catch (_) {} console.log('\nĐã dừng. Tiến độ đã lưu — chạy lại để dịch tiếp.'); process.exit(0); });
