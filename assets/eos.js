/* EOS — giao diện phòng thi EOS để làm quen (hiện chỉ có phần Reading).
 * Dùng như một "chế độ" của FE Study: nút EOS ở thanh trên cùng -> chọn kỳ, môn -> vào màn thi.
 *
 *   #/eos               : màn chọn kỳ + môn
 *   #/eos/<MÃ MÔN>      : môn CÓ ngân hàng câu hỏi -> màn thiết lập (chọn nguồn, số câu, thời gian)
 *                         môn chưa có ngân hàng     -> vào thẳng màn thi với đề mẫu ngắn (DEMO)
 *   #/eos/<MÃ MÔN>/exam : màn thi EOS (câu hỏi thật, lấy ngẫu nhiên từ ngân hàng theo thiết lập)
 *
 * Mặc định không chỉnh gì: 50 câu ngẫu nhiên / 60 phút (lấy từ SUBJECTS[code].n / .min), thang điểm 10.
 * Môn chưa có ngân hàng dùng đề mẫu (DEMO) để quen giao diện.
 */
(() => {
'use strict';
const L = 'ABCDEFGH';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TABS = [['reading', 'Question']]; // hiện chỉ có phần Reading (mc/mistake/matching/fill đã bỏ khỏi giao diện)
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

/* đề từ ngân hàng câu hỏi: lấy ngẫu nhiên n câu trong các nguồn đã chọn, thang điểm 10 */
function newBankSession(code, ctx, srcs, n, mins) {
  const b = ctx.bank(code);
  const pool = b.questions.filter(q => srcs.includes(ctx.gOf(q)) || srcs.includes(''));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const pick = pool.slice(0, n), mark = 10 / Math.max(1, pick.length);
  const ex = { duration: mins, bank: true, reading: pick.map(q => ({ passage: '', qs: [{ q: q.t, opts: q.o.map(x => x[1]), a: [...q.a].sort().join(''), mark }] })) };
  S = { code, exam: ex, bank: true, tab: 'reading', pos: {}, qi: 0, ans: {}, font: FONTS[0], size: 10, chk: false, submit: '', hide: false, done: false, dur: mins, endAt: Date.now() + mins * 60000, student: ctx.student || '1', total: 0 };
  eachQ((t, q) => { S.total += q.mark || 0; });
}

const isChoice = tab => tab === 'reading' || tab === 'mc' || tab === 'mistake';
const answered = (tab, q, a) => (tab === 'matching' ? Array.isArray(a) && q.left.every((_, j) => a[j]) : tab === 'fill' ? !!(a && String(a).trim()) : !!a);
const correct = (tab, q, a) => (tab === 'matching' ? Array.isArray(a) && q.a.every((x, j) => a[j] === x) : tab === 'fill' ? norm(a) === norm(q.a) : String(a).split('').sort().join('') === String(q.a).split('').sort().join(''));

/* ---- hiển thị ---- */
function textOf(c) {
  const { tab, item } = c;
  if (!item) return '(Không có câu hỏi trong phần này)';
  const opts = o => o.map((x, k) => `${L[k]}. ${x}`).join('\n');
  if (tab === 'reading' && !item.passage && item.qs.length === 1) return item.qs[0].q + '\n\n' + opts(item.qs[0].opts);
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
  return q.opts.map((o, x) => `<label class="eos-chk"><input type="checkbox" data-e="opt" data-v="${L[x]}"${(a || '').includes(L[x]) ? ' checked' : ''}><span>${L[x]}</span></label>`).join('');
}
function textStyle() { return `font-family:'${S.font}',Tahoma,Arial,sans-serif;font-size:${(S.size * 1.45).toFixed(1)}px`; }
/* số thứ tự câu hiện tại / tổng số câu (đếm xuyên suốt các bài đọc) */
function qCount(c) {
  if (c.tab !== 'reading') return [c.i + 1, c.list.length];
  const total = c.list.reduce((a, it) => a + it.qs.length, 0);
  const before = c.list.slice(0, c.i).reduce((a, it) => a + it.qs.length, 0);
  return [before + S.qi + 1, total];
}
function panelHTML() {
  const c = cur(), reading = c.tab === 'reading';
  const [no, total] = qCount(c);
  const head = c.item ? `Question ${no}/${total}:` : 'Question:';
  return `<div class="eos-left">
      <div class="eos-ah">Answer</div>
      <div class="eos-ans" id="eosAns">${ansHTML(c)}</div>
      <button class="eos-btn eos-nq" data-e="nextq"${no >= total ? ' disabled' : ''}>Next Question</button>
      <button class="eos-btn eos-pq" data-e="prevq"${no <= 1 ? ' disabled' : ''}>Previous Question</button>
      ${S.bank ? '' : `<button class="eos-btn eos-nr" data-e="nextr"${reading && c.i < c.list.length - 1 ? '' : ' disabled'}>Next Reading</button>`}
    </div>
    <div class="eos-right"><div class="eos-rh">${esc(head)}</div>
      <div class="eos-text" id="eosText" style="${textStyle()}">${S.hide ? '' : esc(textOf(c))}</div></div>`;
}
/* thanh tiến độ (xanh): mỗi câu đã chọn đáp án thì thanh dài thêm một vạch, chọn đủ thì đầy */
function progCount() { let n = 0, got = 0; eachQ((tab, q, key) => { n++; if (answered(tab, q, S.ans[key])) got++; }); return [got, n]; }
const progHTML = () => { const [got, n] = progCount(); return `<div class="eos-prog" id="eosProg" title="${got}/${n}"><i style="width:${n ? (got / n * 100).toFixed(2) : 0}%"></i></div>`; };
function updProg() { const p = document.getElementById('eosProg'); if (!p || !S) return; const [got, n] = progCount(); p.title = got + '/' + n; p.firstChild.style.width = (n ? got / n * 100 : 0).toFixed(2) + '%'; }
const tabsHTML = () => TABS.map(([k, l]) => `<button class="eos-tab${S.tab === k ? ' on' : ''}" data-e="tab" data-t="${k}">${l}</button>`).join('') + progHTML();
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
  return `<div class="eos eos-pickwrap" data-mode="pick"><div class="eos-pick">
    <div class="eos-pt">EOS · Làm quen giao diện thi</div>
    <div class="eos-pb">
      <p>Chọn <b>kỳ</b> và <b>môn</b> để vào giao diện thi EOS.</p>
      <label>Kỳ<select id="eosTerm">${ctx.TERMS.map(k => `<option value="${k}">Kỳ ${k}</option>`).join('')}</select></label>
      <label>Môn<select id="eosSubj">${subjOpts(ctx, t0)}</select></label>
      <p class="eos-note">Môn có ngân hàng câu hỏi (vd. SSA101) sẽ được chọn nguồn / số câu / thời gian rồi thi bằng câu hỏi thật. Môn chưa có thì dùng đề mẫu ngắn chỉ để quen giao diện.</p>
      <div class="eos-pf"><button class="eos-btn" id="eosBack">← Quay lại FE Study</button><button class="eos-btn eos-go" id="eosStart">Start</button></div>
    </div></div></div>`;
}
function setupHTML(code, ctx) {
  const s = ctx.SUBJ[code], b = ctx.bank(code);
  const sets = b.sets && b.sets.length > 1 ? b.sets : [{ id: '', name: 'Tất cả câu hỏi' }];
  const cnt = id => b.questions.filter(q => !id || ctx.gOf(q) === id).length;
  const pool = b.questions.length;
  return `<div class="eos eos-pickwrap" data-mode="setup" data-code="${esc(code)}"><div class="eos-pick">
    <div class="eos-pt">EOS · ${esc(code)} — ${esc(s.name)}</div>
    <div class="eos-pb">
      <p>Chọn <b>nguồn câu hỏi</b> để vào thi:</p>
      <div class="eos-srcs">${sets.map(x => `<label class="eos-srcrow"><input type="checkbox" class="eos-src" value="${esc(x.id)}" data-n="${cnt(x.id)}" checked><span>${esc(x.name)} <i>(${cnt(x.id)} câu)</i></span></label>`).join('')}</div>
      <div class="eos-row2">
        <label>Số câu<input type="number" id="eosN" min="1" value="${s.n || 50}"></label>
        <label>Thời gian (phút)<input type="number" id="eosM" min="1" max="600" value="${s.min || 60}"></label>
      </div>
      <p class="eos-note" id="eosPool">Có <b>${pool}</b> câu trong nguồn đã chọn. Mặc định: ${s.n || 50} câu ngẫu nhiên / ${s.min || 60} phút.</p>
      <div class="eos-pf"><span class="eos-pfl"><button class="eos-btn" id="eosExit">← Thoát</button><button class="eos-btn" id="eosBack">Chọn môn khác</button></span><button class="eos-btn eos-go" id="eosStart">Start</button></div>
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
  const bank = S.bank, code = S.code;
  let ok = 0; if (bank) eachQ((tab, q, key) => { if (answered(tab, q, S.ans[key]) && correct(tab, q, S.ans[key])) ok++; });
  const body = bank ? `Đã trả lời <b>${got}/${n}</b> câu — đúng <b>${ok}</b> câu.<br>Điểm: <b>${fm(right)}</b> / ${fm(S.total)}` : `Đã trả lời <b>${got}/${n}</b> câu.<br>Điểm đề mẫu: <b>${fm(right)}</b> / ${fm(S.total)}<div class="eos-note">Đây là đề mẫu để làm quen giao diện, chưa phải đề thật.</div>`;
  box(timeUp ? 'Hết giờ' : 'Đã nộp bài', `${timeUp ? '<b>Hết giờ làm bài.</b> Bài của bạn đã được nộp tự động.<br><br>' : ''}${body}`, ['OK']).then(() => CTX.go('#/eos/' + code));
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
    case 'nextq': { if (c.tab === 'reading') { if (S.qi < c.item.qs.length - 1) S.qi++; else if (c.i < c.list.length - 1) { S.pos.reading = c.i + 1; S.qi = 0; } } else S.pos[c.tab] = Math.min(c.i + 1, c.list.length - 1); paint(); break; }
    case 'prevq': { if (c.tab === 'reading') { if (S.qi > 0) S.qi--; else if (c.i > 0) { S.pos.reading = c.i - 1; S.qi = c.list[c.i - 1].qs.length - 1; } } else S.pos[c.tab] = Math.max(c.i - 1, 0); paint(); break; }
    case 'nextr': S.pos.reading = Math.min(c.i + 1, c.list.length - 1); S.qi = 0; paint(); break;
    case 'show': S.hide = !S.hide; { const x = document.getElementById('eosText'); if (x) x.textContent = S.hide ? '' : textOf(c); } break;
    case 'fin': tryFinish(); break;
    case 'exit': box('Exit', S.done ? 'Thoát khỏi EOS?' : 'Thoát khỏi bài thi? Bài làm hiện tại sẽ <b>không được lưu</b>.', ['Yes', 'No']).then(b => { if (b === 'Yes') CTX.exit(S && S.code); }); break;
  }
}
function onChange(e) {
  if (!S) return;
  const t = e.target, d = t.dataset && t.dataset.e; if (!d) return;
  const c = cur();
  if (d === 'opt') {
    const k = keyOf(c), q = curQ(c), v = t.dataset.v;
    if (q && String(q.a).length > 1) { const set = new Set((S.ans[k] || '').split('').filter(Boolean)); if (t.checked) set.add(v); else set.delete(v); const str = [...set].sort().join(''); if (str) S.ans[k] = str; else delete S.ans[k]; }
    else if (t.checked) S.ans[k] = v; else delete S.ans[k];
    updProg();
    const a = document.getElementById('eosAns'); if (a) a.innerHTML = ansHTML(c); }
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

/* toàn màn hình (như F11) — chỉ gọi được từ một cú bấm của người dùng */
function fullscreen() { try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); } catch (e) {} }
function unfullscreen() { try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (e) {} }

/* ---- giao tiếp với app.js ---- */
function view(arg, ctx, arg2) {
  CTX = ctx;
  if (!arg) { stop(); return pickerHTML(ctx); }
  if (!ctx.SUBJ[arg]) return null;
  const b = ctx.bank(arg), hasBank = (ctx.eosBanks || []).includes(arg) && !b.empty && b.questions.length > 0;
  if (hasBank) {
    if (arg2 === 'exam' && S && S.code === arg && S.bank) return examHTML(ctx);
    stop(); return arg2 === 'exam' ? '#/eos/' + arg : setupHTML(arg, ctx);
  }
  if (arg2 === 'exam') return '#/eos/' + arg;
  if (!S || S.code !== arg || S.bank) newSession(arg, ctx);
  return examHTML(ctx);
}
let onFit = null;
function mount(root, ctx) {
  CTX = ctx;
  const el = root.querySelector('.eos'); if (!el) return;
  removeEventListener('resize', onFit);
  /* thu nhỏ phần đầu theo cả chiều rộng lẫn chiều cao để cả màn thi vừa khít khung nhìn, không phải cuộn */
  onFit = () => { const e = document.querySelector('.eos-stage'); const w = document.querySelector('.eos'); if (!e || !w) return; const byH = innerWidth > 900 ? Math.max(0.45, (innerHeight - 428) / 212) : 1; w.style.setProperty('--fit', Math.min(1, w.clientWidth / 1100, byH).toFixed(3)); };
  onFit(); addEventListener('resize', onFit);
  if (el.dataset.mode === 'setup') {
    const code = el.dataset.code, srcs = [...el.querySelectorAll('.eos-src')], N = el.querySelector('#eosN'), M = el.querySelector('#eosM'), go = el.querySelector('#eosStart'), note = el.querySelector('#eosPool');
    const pool = () => srcs.filter(x => x.checked).reduce((a, x) => a + (+x.dataset.n), 0);
    const upd = () => { const p = pool(); N.max = p; go.disabled = p === 0; note.innerHTML = p ? `Có <b>${p}</b> câu trong nguồn đã chọn${(+N.value || 0) > p ? ` — sẽ thi <b>${p}</b> câu` : ''}.` : 'Hãy chọn ít nhất một nguồn câu hỏi.'; };
    srcs.forEach(x => x.addEventListener('change', upd)); N.addEventListener('input', upd); upd();
    el.querySelector('#eosBack').addEventListener('click', () => ctx.go('#/eos'));
    el.querySelector('#eosExit').addEventListener('click', () => ctx.exit(code));
    go.addEventListener('click', () => {
      const ids = srcs.filter(x => x.checked).map(x => x.value), p = pool(); if (!p) return;
      const n = Math.max(1, Math.min(p, parseInt(N.value, 10) || 50)), mins = Math.max(1, Math.min(600, parseInt(M.value, 10) || 60));
      newBankSession(code, ctx, ids, n, mins); fullscreen(); ctx.go('#/eos/' + code + '/exam');
    });
    return;
  }
  if (el.classList.contains('eos-pickwrap')) {
    const term = el.querySelector('#eosTerm'), subj = el.querySelector('#eosSubj');
    term.addEventListener('change', () => { subj.innerHTML = subjOpts(ctx, +term.value); });
    el.querySelector('#eosStart').addEventListener('click', () => { if (subj.value) { fullscreen(); ctx.go('#/eos/' + subj.value); } });
    el.querySelector('#eosBack').addEventListener('click', () => ctx.exit());
    return;
  }
  el.addEventListener('click', onClick); el.addEventListener('change', onChange); el.addEventListener('input', onInput);
  startTimer();
}
function stop() { clearInterval(tick); tick = null; S = null; if (onFit) { removeEventListener('resize', onFit); onFit = null; } }

window.EOS = { view, mount, stop, fullscreen, unfullscreen };
})();
