/* EOS — giao diện phòng thi EOS để làm quen (Reading / Multiple Choices / Indicate Mistake / Matching / Fill Blank).
 * Dùng như một "chế độ" của FE Study: nút EOS ở thanh trên cùng -> chọn kỳ, môn -> vào màn thi.
 *
 *   #/eos          : màn chọn kỳ + môn
 *   #/eos/<MÃ MÔN> : màn thi EOS
 *
 * Hiện CHƯA có đề thật: mọi môn dùng chung một đề mẫu ngắn (DEMO) chỉ để làm quen giao diện.
 * Khi có đề thật cho một môn, gán  window.EOS_EXAMS['CEA201'] = { duration: 60, reading: [...], mc: [...], mistake: [...], matching: [...], fill: [...] }
 * (cùng dạng dữ liệu với DEMO bên dưới) là màn thi tự dùng đề đó.
 */
(() => {
'use strict';
const L = 'ABCDEFGH';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TABS = [['reading', 'Reading'], ['mc', 'Multiple Choices'], ['mistake', 'Indicate Mistake'], ['matching', 'Matching'], ['fill', 'Fill Blank']];
const FONTS = ['Microsoft Sans Serif', 'Arial', 'Tahoma', 'Segoe UI', 'Verdana', 'Times New Roman', 'Courier New'];

/* ---- đề mẫu (tự viết, chỉ để thử giao diện) ---- */
const DEMO = {
  duration: 20,
  reading: [
    { passage: 'Ôn thi hiệu quả\nPhương pháp ôn thi hiệu quả nhất là làm đề thử trong điều kiện giống thi thật. Khi làm đề, bạn nên đặt đồng hồ, không tra cứu tài liệu và chỉ xem đáp án sau khi nộp bài. Sau đó hãy ghi lại những câu sai để ôn lại vào ngày hôm sau.\nGiao diện này giúp bạn làm quen với phần mềm thi EOS trước ngày thi chính thức.',
      qs: [
        { q: 'Khi làm đề thử, bạn nên làm gì?', opts: ['Đặt đồng hồ và không tra cứu tài liệu', 'Vừa làm vừa xem đáp án', 'Bỏ qua các câu khó'], a: 'A', mark: 1 },
        { q: 'Sau khi nộp bài, nên làm gì với những câu sai?', opts: ['Xoá đi', 'Ghi lại để ôn vào hôm sau', 'Không cần quan tâm'], a: 'B', mark: 1 },
      ] },
    { passage: 'A computer consists of a processor, memory and input/output devices. The processor executes instructions stored in memory, while input/output devices let the computer communicate with users.',
      qs: [
        { q: 'What executes the instructions stored in memory?', opts: ['The processor', 'The keyboard', 'The monitor'], a: 'A', mark: 1 },
        { q: 'What do input/output devices do?', opts: ['Store the instructions', 'Let the computer communicate with users', 'Cool the processor'], a: 'B', mark: 1 },
      ] },
  ],
  mc: [
    { q: 'Which component is known as the "brain" of the computer?', opts: ['CPU', 'RAM', 'Hard disk', 'Monitor'], a: 'A', mark: 0.5 },
    { q: '1 byte equals how many bits?', opts: ['4', '8', '16', '32'], a: 'B', mark: 0.5 },
    { q: 'Which of the following memories is volatile?', opts: ['ROM', 'SSD', 'RAM', 'Hard disk'], a: 'C', mark: 0.5 },
  ],
  mistake: [
    { q: 'Choose the part of the sentence that is incorrect.\n\nShe (A) don\'t like (B) coffee, but she (C) drinks tea (D) every day.', opts: ['(A)', '(B)', '(C)', '(D)'], a: 'A', mark: 1 },
  ],
  matching: [
    { q: 'Match each term with its description.', left: ['CPU', 'RAM', 'ROM'], right: ['Read-only memory', 'Executes instructions', 'Temporary working memory'], a: ['B', 'C', 'A'], mark: 3 },
  ],
  fill: [
    { q: 'The binary number system uses only the digits 0 and ______.', a: '1', mark: 1 },
    { q: 'The exam software used at FPT University is called ______.', a: 'EOS', mark: 1 },
  ],
};

let S = null, tick = null, CTX = null;
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const fm = n => String(Math.round(n * 100) / 100).replace('.', ',');
const items = tab => S.exam[tab] || [];

function eachQ(fn) {
  for (const [tab] of TABS) items(tab).forEach((it, i) => {
    if (tab === 'reading') it.qs.forEach((q, j) => fn(tab, q, `reading:${i}:${j}`));
    else fn(tab, it, `${tab}:${i}`);
  });
}
const cur = () => { const tab = S.tab, list = items(tab), i = Math.min(S.pos[tab] || 0, Math.max(0, list.length - 1)); return { tab, list, i, item: list[i] }; };
const curQ = c => (!c.item ? null : c.tab === 'reading' ? c.item.qs[S.qi] : c.item);
const keyOf = c => (c.tab === 'reading' ? `reading:${c.i}:${S.qi}` : `${c.tab}:${c.i}`);

/* ---- đề / phiên thi ---- */
function newSession(code, ctx) {
  const ex = (window.EOS_EXAMS && window.EOS_EXAMS[code]) || DEMO;
  const dur = ex.duration || 20;
  S = { code, exam: ex, tab: 'reading', pos: {}, qi: 0, ans: {}, font: FONTS[0], size: 10, chk: false, submit: '', hide: false, done: false, dur, endAt: Date.now() + dur * 60000, student: ctx.student || '1', total: 0 };
  eachQ((t, q) => { S.total += q.mark || 0; });
}

const isChoice = tab => tab === 'reading' || tab === 'mc' || tab === 'mistake';
const answered = (tab, q, a) => (tab === 'matching' ? Array.isArray(a) && q.left.every((_, j) => a[j]) : tab === 'fill' ? !!(a && String(a).trim()) : !!a);
const correct = (tab, q, a) => (tab === 'matching' ? Array.isArray(a) && q.a.every((x, j) => a[j] === x) : tab === 'fill' ? norm(a) === norm(q.a) : a === q.a);

/* ---- hiển thị ---- */
function textOf(c) {
  const { tab, item } = c;
  if (!item) return '(Không có câu hỏi trong phần này)';
  const opts = o => o.map((x, k) => `${L[k]}. ${x}`).join('\n');
  if (tab === 'reading') return item.passage + '\n\n' + item.qs.map((q, j) => `${j + 1}) ${q.q}\n${opts(q.opts)}`).join('\n\n');
  if (tab === 'matching') return item.q + '\n\n' + item.left.map((l, j) => `${j + 1}. ${l}`).join('\n') + '\n\n' + opts(item.right);
  if (tab === 'fill') return item.q;
  return item.q + '\n\n' + opts(item.opts);
}
function ansHTML(c) {
  const q = curQ(c); if (!q) return '';
  const a = S.ans[keyOf(c)];
  if (c.tab === 'matching') return q.left.map((l, j) => `<div class="eos-mrow"><b>${j + 1}</b><select data-e="match" data-j="${j}">${['', ...q.right.map((_, x) => L[x])].map(o => `<option value="${o}"${a && a[j] === o ? ' selected' : ''}>${o}</option>`).join('')}</select></div>`).join('');
  if (c.tab === 'fill') return `<input class="eos-fill" data-e="fill" value="${esc(a || '')}" autocomplete="off" spellcheck="false">`;
  return q.opts.map((o, x) => `<label class="eos-chk"><input type="checkbox" data-e="opt" data-v="${L[x]}"${a === L[x] ? ' checked' : ''}><span>${L[x]}</span></label>`).join('');
}
function textStyle() { return `font-family:'${S.font}',Tahoma,Arial,sans-serif;font-size:${(S.size * 1.45).toFixed(1)}px`; }
function panelHTML() {
  const c = cur(), reading = c.tab === 'reading';
  const n = reading ? (c.item ? c.item.qs.length : 0) : c.list.length, sel = reading ? S.qi : c.i;
  const label = TABS.find(t => t[0] === c.tab)[1];
  const head = c.item ? `${label} ${c.i + 1}/${c.list.length}:` : `${label}:`;
  const lastQ = sel >= n - 1;
  return `<div class="eos-left">
      <div class="eos-qh">Questions</div>
      <div class="eos-qlist" role="listbox">${Array.from({ length: n }, (_, i) => `<div class="eos-qi${i === sel ? ' on' : ''}" role="option" data-e="q" data-i="${i}">${i + 1}</div>`).join('')}</div>
      <div class="eos-ah">Answer</div>
      <div class="eos-ans" id="eosAns">${ansHTML(c)}</div>
      <button class="eos-btn eos-nq" data-e="nextq"${lastQ ? ' disabled' : ''}>Next Question</button>
      <button class="eos-btn eos-nr" data-e="nextr"${reading && c.i < c.list.length - 1 ? '' : ' disabled'}>Next Reading</button>
    </div>
    <div class="eos-right"><div class="eos-rh">${esc(head)}</div>
      <div class="eos-text" id="eosText" style="${textStyle()}">${S.hide ? '' : esc(textOf(c))}</div></div>`;
}
const tabsHTML = () => TABS.map(([k, l]) => `<button class="eos-tab${S.tab === k ? ' on' : ''}" data-e="tab" data-t="${k}">${l}</button>`).join('');
function qmark() { const q = curQ(cur()); return q ? fm(q.mark || 0) : ''; }
function paint() {
  const $ = id => document.getElementById(id); if (!$('eosPanel')) return;
  $('eosTabs').innerHTML = tabsHTML(); $('eosPanel').innerHTML = panelHTML(); $('eosQmark').textContent = qmark();
}

const AVATAR = `<svg viewBox="0 0 80 90" width="80" height="90" aria-hidden="true"><circle cx="40" cy="30" r="22" fill="#f6f6f6" stroke="#c9c9c9" stroke-width="3"/><path d="M6 88c0-24 14-34 34-34s34 10 34 34z" fill="#f6f6f6" stroke="#c9c9c9" stroke-width="3" stroke-linejoin="round"/></svg>`;
const RABBIT = `<svg viewBox="0 0 90 140" width="86" height="140" aria-hidden="true">
  <g fill="#b3123f"><ellipse cx="38" cy="16" rx="8" ry="22" transform="rotate(-14 38 16)"/><ellipse cx="58" cy="14" rx="8" ry="21" transform="rotate(12 58 14)"/>
  <circle cx="49" cy="52" r="23"/><ellipse cx="48" cy="100" rx="25" ry="31"/><ellipse cx="30" cy="132" rx="14" ry="6"/><ellipse cx="66" cy="132" rx="14" ry="6"/>
  <path d="M26 86C14 78 10 62 4 52c-2-4 3-7 6-4 6 8 9 17 20 25z"/><path d="M71 88c10-8 13-18 18-30 2-4-3-7-6-3-5 9-9 17-18 24z"/></g>
  <ellipse cx="38" cy="18" rx="3.5" ry="14" fill="#e8809f" transform="rotate(-14 38 18)"/><ellipse cx="58" cy="16" rx="3.5" ry="13" fill="#e8809f" transform="rotate(12 58 16)"/>
  <ellipse cx="48" cy="104" rx="14" ry="20" fill="#e8809f"/><circle cx="41" cy="48" r="3.2" fill="#fff"/><circle cx="57" cy="48" r="3.2" fill="#fff"/><circle cx="41.5" cy="48.5" r="1.5" fill="#222"/><circle cx="57.5" cy="48.5" r="1.5" fill="#222"/>
  <ellipse cx="49" cy="57" rx="3" ry="2.2" fill="#f3b2c5"/></svg>`;

function examHTML(ctx) {
  const s = S, mins = s.dur;
  return `<div class="eos">
  <div class="eos-stagewrap"><div class="eos-stage">
    <span class="a r" style="left:0;top:40px;width:108px">Server:</span><b class="a" style="left:121px;top:40px">Server1</b>
    <span class="a r" style="left:0;top:71px;width:108px">Duration:</span><b class="a" style="left:121px;top:71px">${mins} minutes</b>
    <span class="a r" style="left:0;top:102px;width:112px">Submit Code:</span><input class="eos-in a" data-e="submit" style="left:118px;top:99px;width:122px;height:27px" value="${esc(s.submit)}" autocomplete="off">
    <span class="a r" style="left:0;top:133px;width:108px">Q mark:</span><b class="a" style="left:121px;top:133px" id="eosQmark">${qmark()}</b>

    <label class="a eos-cb" style="left:258px;top:11px"><input type="checkbox" data-e="chk"${s.chk ? ' checked' : ''}> I want to finish the exam.</label>
    <span class="a r" style="left:236px;top:40px;width:117px">Exam Code:</span><b class="a" style="left:370px;top:40px">${esc(s.code)}</b>
    <span class="a r" style="left:236px;top:71px;width:117px">Student:</span><b class="a" style="left:370px;top:71px">${esc(s.student)}</b>
    <span class="a r" style="left:236px;top:102px;width:118px">Open Code:</span><input class="eos-in a" disabled style="left:367px;top:100px;width:142px;height:26px">
    <button class="eos-btn a" data-e="show" style="left:517px;top:100px;width:128px;height:26px">Show Question</button>
    <span class="a r" style="left:236px;top:133px;width:117px">Total Marks:</span><b class="a" style="left:368px;top:133px">${fm(s.total)}</b>
    <span class="a r dim" style="left:452px;top:133px;width:34px">Vol:</span><input class="eos-in a" type="number" value="8" disabled style="left:493px;top:131px;width:50px;height:26px">
    <span class="a r" style="left:236px;top:167px;width:41px">Font:</span>
    <select class="eos-in a" data-e="font" style="left:285px;top:165px;width:150px;height:25px">${FONTS.map(f => `<option${f === s.font ? ' selected' : ''}>${f}</option>`).join('')}</select>
    <span class="a r" style="left:447px;top:167px;width:40px">Size:</span><input class="eos-in a" type="number" min="6" max="30" data-e="size" value="${s.size}" style="left:495px;top:165px;width:50px;height:25px">

    <button class="eos-fin a" id="eosFinTop" data-e="fin" style="left:520px;top:6px;width:122px;height:56px"${s.chk ? '' : ' disabled'}>Finish<br>(Submit)</button>
    <div class="a" style="left:712px;top:28px">${AVATAR}</div>
    <div class="a eos-num" style="left:945px;top:10px;width:128px">37888</div>
    <div class="a" style="left:968px;top:62px">${RABBIT}</div>
    <span class="a" style="left:570px;top:166px;font-size:16px">Time Left:</span>
    <div class="a eos-time" id="eosTime" style="left:680px;top:134px">${String(mins).padStart(2, '0')}:00</div>
  </div></div>
  <div class="eos-tabs" id="eosTabs">${tabsHTML()}</div>
  <div class="eos-panel" id="eosPanel">${panelHTML()}</div>
  <div class="eos-foot">
    <div class="eos-fl"><label class="eos-cb"><input type="checkbox" data-e="chk"${s.chk ? ' checked' : ''}> I want to finish the exam.</label>
      <button class="eos-ok" data-e="fin">Finish</button></div>
    <button class="eos-btn eos-exit" data-e="exit">Exit</button>
  </div></div>`;
}

function pickerHTML(ctx) {
  const t0 = ctx.TERMS[0];
  return `<div class="eos eos-pickwrap"><div class="eos-pick">
    <div class="eos-pt">EOS · Làm quen giao diện thi</div>
    <div class="eos-pb">
      <p>Chọn <b>kỳ</b> và <b>môn</b> để vào giao diện thi EOS.</p>
      <label>Kỳ<select id="eosTerm">${ctx.TERMS.map(k => `<option value="${k}">Kỳ ${k}</option>`).join('')}</select></label>
      <label>Môn<select id="eosSubj">${subjOpts(ctx, t0)}</select></label>
      <p class="eos-note">Hiện chưa có đề của trường, nên màn thi dùng đề mẫu ngắn (đủ 5 phần: Reading, Multiple Choices, Indicate Mistake, Matching, Fill Blank) chỉ để quen giao diện.</p>
      <div class="eos-pf"><button class="eos-btn" id="eosBack">← Quay lại FE Study</button><button class="eos-btn eos-go" id="eosStart">Start</button></div>
    </div></div></div>`;
}
const subjOpts = (ctx, k) => ctx.subjectsOf(k).map(s => `<option value="${esc(s.code)}">${esc(s.code)} — ${esc(s.name)}</option>`).join('');

/* ---- hộp thoại kiểu Windows ---- */
function box(title, body, btns) {
  return new Promise(res => {
    const root = document.querySelector('.eos'); if (!root) return res(null);
    const ov = document.createElement('div'); ov.className = 'eos-ov';
    ov.innerHTML = `<div class="eos-mb" role="dialog"><div class="eos-mbt">${esc(title)}</div><div class="eos-mbb">${body}</div><div class="eos-mbf">${btns.map(b => `<button class="eos-btn" data-b="${esc(b)}">${esc(b)}</button>`).join('')}</div></div>`;
    ov.addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (b) { ov.remove(); res(b.dataset.b); } });
    root.appendChild(ov); const f = ov.querySelector('button'); if (f) f.focus();
  });
}

/* ---- nộp bài ---- */
function finish(timeUp) {
  if (S.done) return; S.done = true; clearInterval(tick);
  let n = 0, got = 0, right = 0; eachQ((tab, q, key) => { n++; const a = S.ans[key]; if (answered(tab, q, a)) { got++; if (correct(tab, q, a)) right += q.mark || 0; } });
  box(timeUp ? 'Hết giờ' : 'Đã nộp bài', `${timeUp ? '<b>Hết giờ làm bài.</b> Bài của bạn đã được nộp tự động.<br><br>' : ''}Đã trả lời <b>${got}/${n}</b> câu.<br>Điểm đề mẫu: <b>${fm(right)}</b> / ${fm(S.total)}<div class="eos-note">Đây là đề mẫu để làm quen giao diện, chưa phải đề thật.</div>`, ['OK']).then(() => CTX.go('#/eos'));
}
async function tryFinish() {
  if (S.done) return;
  if (!S.chk) return void box('EOS', 'Hãy đánh dấu vào ô <b>"I want to finish the exam."</b> trước khi nộp bài.', ['OK']);
  let n = 0, got = 0; eachQ((tab, q, key) => { n++; if (answered(tab, q, S.ans[key])) got++; });
  const b = await box('Finish', `Bạn đã trả lời <b>${got}/${n}</b> câu.<br>Bạn có chắc muốn nộp bài không?`, ['Yes', 'No']);
  if (b === 'Yes') finish(false);
}

/* ---- sự kiện ---- */
function onClick(e) {
  if (!S) return;
  const t = e.target.closest('[data-e]'); if (!t || t.disabled) return;
  const c = cur();
  switch (t.dataset.e) {
    case 'tab': S.tab = t.dataset.t; S.qi = 0; paint(); break;
    case 'q': { const i = +t.dataset.i; if (c.tab === 'reading') S.qi = i; else S.pos[c.tab] = i; paint(); break; }
    case 'nextq': { if (c.tab === 'reading') S.qi = Math.min(S.qi + 1, c.item.qs.length - 1); else S.pos[c.tab] = Math.min(c.i + 1, c.list.length - 1); paint(); break; }
    case 'nextr': S.pos.reading = Math.min(c.i + 1, c.list.length - 1); S.qi = 0; paint(); break;
    case 'show': S.hide = !S.hide; { const x = document.getElementById('eosText'); if (x) x.textContent = S.hide ? '' : textOf(c); } break;
    case 'fin': tryFinish(); break;
    case 'exit': box('Exit', S.done ? 'Thoát khỏi EOS?' : 'Thoát khỏi bài thi? Bài làm hiện tại sẽ <b>không được lưu</b>.', ['Yes', 'No']).then(b => { if (b === 'Yes') CTX.exit(); }); break;
  }
}
function onChange(e) {
  if (!S) return;
  const t = e.target, d = t.dataset && t.dataset.e; if (!d) return;
  const c = cur();
  if (d === 'opt') { const k = keyOf(c); if (t.checked) S.ans[k] = t.dataset.v; else delete S.ans[k]; const a = document.getElementById('eosAns'); if (a) a.innerHTML = ansHTML(c); }
  else if (d === 'chk') { S.chk = t.checked; document.querySelectorAll('.eos [data-e=chk]').forEach(x => { x.checked = S.chk; }); const b = document.getElementById('eosFinTop'); if (b) b.disabled = !S.chk; }
  else if (d === 'font') { S.font = t.value; const x = document.getElementById('eosText'); if (x) x.setAttribute('style', textStyle()); }
  else if (d === 'match') { const k = keyOf(c), q = curQ(c); const a = S.ans[k] || (S.ans[k] = q.left.map(() => '')); a[+t.dataset.j] = t.value; }
}
function onInput(e) {
  if (!S) return;
  const t = e.target, d = t.dataset && t.dataset.e;
  if (d === 'fill') S.ans[keyOf(cur())] = t.value;
  else if (d === 'submit') S.submit = t.value;
  else if (d === 'size') { const v = Math.max(6, Math.min(30, parseInt(t.value, 10) || 10)); S.size = v; const x = document.getElementById('eosText'); if (x) x.setAttribute('style', textStyle()); }
}

const fmtT = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
function startTimer() {
  clearInterval(tick); if (!S || S.done) return;
  const upd = () => { const el = document.getElementById('eosTime'), left = S.endAt - Date.now(); if (el) el.textContent = fmtT(left); if (left <= 0) { clearInterval(tick); finish(true); } };
  upd(); if (!S.done) tick = setInterval(upd, 250);
}

/* ---- giao tiếp với app.js ---- */
function view(arg, ctx) {
  CTX = ctx;
  if (!arg) { stop(); return pickerHTML(ctx); }
  if (!ctx.SUBJ[arg]) return null;
  if (!S || S.code !== arg) newSession(arg, ctx);
  return examHTML(ctx);
}
function mount(root, ctx) {
  CTX = ctx;
  const el = root.querySelector('.eos'); if (!el) return;
  if (el.classList.contains('eos-pickwrap')) {
    const term = el.querySelector('#eosTerm'), subj = el.querySelector('#eosSubj');
    term.addEventListener('change', () => { subj.innerHTML = subjOpts(ctx, +term.value); });
    el.querySelector('#eosStart').addEventListener('click', () => { if (subj.value) ctx.go('#/eos/' + subj.value); });
    el.querySelector('#eosBack').addEventListener('click', () => ctx.exit());
    return;
  }
  el.addEventListener('click', onClick); el.addEventListener('change', onChange); el.addEventListener('input', onInput);
  startTimer();
}
function stop() { clearInterval(tick); tick = null; S = null; }

window.EOS = { view, mount, stop };
})();
