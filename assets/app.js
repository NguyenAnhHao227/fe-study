/* FE Study — ôn thi trắc nghiệm. Thuần HTML/CSS/JS, không cần server, chạy được trên GitHub Pages. */
(() => {
'use strict';
const P = window.FEParser;
const LETTERS = 'ABCDEFGH';
const PASS = 4; // điểm đạt (thang 10)
const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6'];
const SUBJECTS = [
  { code: 'CSI106', name: 'Introduction to Computer Science', n: 60, min: 60, color: '#6366f1', icon: '💻' },
  { code: 'CEA201', name: 'Computer Organization & Architecture', n: 50, min: 60, color: '#0ea5e9', icon: '🧠' },
  { code: 'MAE101', name: 'Mathematics for Engineering', n: 50, min: 60, color: '#f59e0b', icon: '∑' },
  { code: 'PRF192', name: 'Programming Fundamentals (C)', n: 50, min: 60, color: '#10b981', icon: '{ }' },
  { code: 'SSA101', name: 'Study Skills for Academic Success', n: 50, min: 60, color: '#ec4899', icon: '🎓' },
];
const SUBJ = Object.fromEntries(SUBJECTS.map(s => [s.code, s]));

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmt = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };
const fdate = ts => new Date(ts).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const initial = n =>(n.trim()[0] || '?').toUpperCase();
const colorFor = n => COLORS[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

/* ============ lưu trữ (IndexedDB, dự phòng localStorage) ============ */
const DB = {
  mem: new Map(), idb: null, dirty: new Map(), timer: null,
  async init() {
    try {
      this.idb = await new Promise((res, rej) => {
        const r = indexedDB.open('fe-study', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      await new Promise((res, rej) => {
        const rq = this.idb.transaction('kv').objectStore('kv').openCursor();
        rq.onsuccess = () => { const c = rq.result; if (c) { this.mem.set(c.key, c.value); c.continue(); } else res(); };
        rq.onerror = () => rej(rq.error);
      });
    } catch (e) {
      this.idb = null;
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('fe:')) this.mem.set(k.slice(3), JSON.parse(localStorage.getItem(k))); } } catch (_) {}
    }
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {}
  },
  get(k, d) { return this.mem.has(k) ? this.mem.get(k) : d; },
  set(k, v) { this.mem.set(k, v); this.dirty.set(k, v); this.sched(); },
  del(k) { this.mem.delete(k); this.dirty.set(k, undefined); this.sched(); },
  sched() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 200); },
  flush() {
    if (!this.dirty.size) return;
    const d = this.dirty; this.dirty = new Map();
    if (this.idb) {
      try { const st = this.idb.transaction('kv', 'readwrite').objectStore('kv'); d.forEach((v, k) => v === undefined ? st.delete(k) : st.put(v, k)); }
      catch (e) { console.warn(e); }
    } else {
      try { d.forEach((v, k) => v === undefined ? localStorage.removeItem('fe:' + k) : localStorage.setItem('fe:' + k, JSON.stringify(v))); }
      catch (e) { toast('Không lưu được dữ liệu (bộ nhớ trình duyệt đầy hoặc bị chặn)'); }
    }
  },
};
addEventListener('pagehide', () => DB.flush());
document.addEventListener('visibilitychange', () => { if (document.hidden) DB.flush(); });

/* ============ hồ sơ ============ */
let PROFILE = null;
const ui = { manage: false, rf: 'all', aiShown: new Set(), aiBusy: {}, aiErr: {}, trBusy: {} };
const listProfiles = () => DB.get('profiles', []).map(id => DB.get('p:' + id)).filter(Boolean);
const save = () => { if (PROFILE) DB.set('p:' + PROFILE.id, PROFILE); };
function createProfile(name) {
  const p = { id: uid(), name, color: colorFor(name), settings: { vi: true }, subj: {}, sessions: [], active: null, created: Date.now() };
  DB.set('p:' + p.id, p); DB.set('profiles', [...DB.get('profiles', []), p.id]);
  return p;
}
function subjData(code) { return PROFILE.subj[code] || (PROFILE.subj[code] = { done: {}, star: {}, cfg: null }); }

/* ============ máy chủ dùng chung (Supabase) — tuỳ chọn ============
 * Khi assets/config.js có URL + anon key: AI chạy qua máy chủ (API key AI nằm ở máy chủ, không ai thấy)
 * và giải thích/bản dịch AI được dùng chung cho mọi người. Hồ sơ & tiến độ vẫn nằm trong trình duyệt từng máy. */
async function fetchT(url, opt, ms = 90000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opt, signal: ctl.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'Máy chủ phản hồi quá lâu (hết thời gian chờ)' : e.message); }
  finally { clearTimeout(t); }
}
const CFG = window.FE_CONFIG || {};
const CLOUD = { on: !!(CFG.supabaseUrl && CFG.supabaseAnonKey), expl: {}, tr: {} };
const SB = (CFG.supabaseUrl || '').replace(/\/$/, '');
const sbHeaders = () => ({ apikey: CFG.supabaseAnonKey, authorization: 'Bearer ' + CFG.supabaseAnonKey });
async function loadShared() { // tải toàn bộ giải thích/bản dịch dùng chung (ai cũng đọc được, không cần mã)
  if (!CLOUD.on) return;
  try {
    const grab = async (table, cols, fn) => {
      for (let off = 0; ; off += 1000) {
        const r = await fetchT(`${SB}/rest/v1/${table}?select=${cols}&order=key&limit=1000&offset=${off}`, { headers: sbHeaders() }, 30000);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const rows = await r.json(); rows.forEach(fn); if (rows.length < 1000) break;
      }
    };
    await grab('explanations', 'key,text,author,model,ts', r => { CLOUD.expl[r.key] = { t: r.text, by: r.author, m: r.model, ts: r.ts }; });
    await grab('translations', 'key,data,author,ts', r => { CLOUD.tr[r.key] = { ...r.data, by: r.author, ts: r.ts }; });
  } catch (e) { console.warn('shared', e); }
}
const deviceId = () => { let d = DB.get('device'); if (!d) { d = uid() + uid(); DB.set('device', d); } return d; };
async function cloudAI(body) { // nhờ máy chủ gọi AI giùm (kèm mã truy cập đã lưu trên trình duyệt này)
  const r = await fetchT(SB + '/functions/v1/' + (CFG.aiFunction || 'ai'), { method: 'POST', headers: { ...sbHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ ...body, code: DB.get('code', ''), device: deviceId(), name: PROFILE ? PROFILE.name : '' }) }, 100000);
  const j = await r.json().catch(() => ({}));
  if (r.status === 403) { DB.del('code'); throw new Error('CODE'); }
  if (!r.ok) throw new Error(j.error || j.message || 'Lỗi máy chủ AI ' + r.status);
  return j;
}
async function ensureCode() { // chưa có mã truy cập -> hỏi một lần rồi nhớ
  if (DB.get('code')) return true;
  const r = await modal(`<h3>Mã truy cập AI</h3><div>Nhập mã do người quản lý trang cung cấp để dùng AI giải thích. Chỉ cần nhập một lần trên trình duyệt này.</div>
    <label>Mã truy cập</label><input type="password" autocomplete="off" autofocus>
    <div class="acts"><button class="btn" data-m="no">Huỷ</button><button class="btn pri" data-m="ok">Lưu</button></div>`);
  const c = r.v === 'ok' ? r.el.querySelector('input').value.trim() : '';
  if (!c) return false;
  DB.set('code', c); return true;
}

/* ============ ngân hàng câu hỏi ============ */
const bankCache = {};
function getBank(code) {
  if (bankCache[code]) return bankCache[code];
  const raw = DB.get('bank:' + code) || (window.BANKS && window.BANKS[code]);
  if (!raw) return bankCache[code] = { questions: [], topics: [], mocks: [], idx: new Map(), order: new Map(), empty: true };
  return bankCache[code] = { ...raw, mocks: raw.mocks || [], idx: new Map(raw.questions.map(q => [q.id, q])), order: new Map(raw.questions.map((q, i) => [q.id, i])), empty: false };
}
const qkey = (code, id) => code + '|' + id;
const splitKey = k => { const i = k.indexOf('|'); return [k.slice(0, i), k.slice(i + 1)]; };
function stats(code) {
  const b = getBank(code), d = subjData(code);
  let done = 0, ok = 0, wrong = 0;
  for (const q of b.questions) { const r = d.done[q.id]; if (r) { done++; r.ok ? ok++ : wrong++; } }
  return { total: b.questions.length, done, ok, wrong, star: b.questions.filter(q => d.star[q.id]).length };
}
const defCfg = code => ({ n: SUBJ[code].n, min: SUBJ[code].min, src: 'new', topics: [], shuffleQ: true, shuffleO: true, instant: true });
const getCfg = code => Object.assign(defCfg(code), subjData(code).cfg || {});
function setCfg(code, patch) { subjData(code).cfg = Object.assign(getCfg(code), patch); save(); }
function inSrc(src, d, q) {
  const r = d.done[q.id];
  switch (src) {
    case 'new': return !r;
    case 'newwrong': return !r || !r.ok;
    case 'wrong': return !!r && !r.ok;
    case 'star': return !!d.star[q.id];
    default: return true;
  }
}
const poolFor = (code, cfg) => { const b = getBank(code), d = subjData(code); return b.questions.filter(q => (!cfg.topics.length || cfg.topics.includes(q.s)) && inSrc(cfg.src, d, q)); };
const SRC_LABEL = { new: 'Chỉ câu mới (chưa làm)', newwrong: 'Câu mới + câu sai', wrong: 'Chỉ câu sai', star: 'Câu đã đánh dấu', all: 'Tất cả (làm lại)' };
const canShuffle = q => !q.o.some(o => /\b(all|none|both|neither) of (the )?(above|these|them)/i.test(o[1]) || /\b[A-E] (and|&|or) [A-E]\b/.test(o[1]) || /\babove\b/i.test(o[1]));

/* ============ AI (giải thích + dịch) ============ */
const AI = {
  cfg() { return Object.assign({ provider: 'anthropic', key: '', model: 'claude-haiku-5-5', base: 'https://api.openai.com/v1' }, DB.get('api', {})); },
  async call(system, user, maxTokens = 900) {
    const c = this.cfg();
    if (!c.key) throw new Error('NOKEY');
    let r, j;
    if (c.provider === 'anthropic') {
      r = await fetchT('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: c.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }) });
      j = await r.json(); if (!r.ok) throw new Error(j.error && j.error.message || r.status);
      return j.content.map(b => b.text || '').join('').trim();
    }
    if (c.provider === 'gemini') {
      r = await fetchT(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': c.key }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }] }) });
      j = await r.json(); if (!r.ok) throw new Error(j.error && j.error.message || r.status);
      return ((j.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    }
    r = await fetchT(c.base.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + c.key }, body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
    j = await r.json(); if (!r.ok) throw new Error(j.error && j.error.message || r.status);
    return (j.choices[0].message.content || '').trim();
  },
  explain(q) {
    const right = q.a.split('').map(k => q.o.find(o => o[0] === k)[1]);
    const system = 'Bạn là gia sư ôn thi trắc nghiệm đại học. Trả lời bằng tiếng Việt, giữ nguyên thuật ngữ tiếng Anh. KHÔNG dùng chữ cái A/B/C/D để chỉ đáp án (thứ tự đáp án bị xáo trộn) — hãy nêu nội dung đáp án. Định dạng gọn: "**Đáp án đúng:** …", "**Vì sao đúng:** …" (1–3 câu), "**Các đáp án còn lại sai ở đâu:**" (gạch đầu dòng, mỗi ý một dòng ngắn), "**Mẹo nhớ:** …" (1 câu). Tối đa khoảng 200 từ.';
    const user = `Câu hỏi: ${q.t}\n\nCác đáp án:\n${q.o.map(o => '- ' + o[1]).join('\n')}\n\nĐáp án đúng: ${right.join(' | ')}\n${q.e ? 'Gợi ý có sẵn: ' + q.e : ''}`;
    return this.call(system, user, 900);
  },
  async translate(q) {
    const system = 'Dịch đề thi trắc nghiệm sang tiếng Việt, ngắn gọn, giữ nguyên thuật ngữ chuyên ngành/mã/biểu thức. Chỉ trả về MỘT đối tượng JSON hợp lệ dạng {"t":"…","o":{"A":"…","B":"…"}}, không thêm chữ nào khác.';
    const user = JSON.stringify({ t: q.t, o: Object.fromEntries(q.o.map(o => [o[0], o[1]])) });
    const out = await this.call(system, user, 1200);
    const m = out.match(/\{[\s\S]*\}/); if (!m) throw new Error('AI trả về không đúng định dạng');
    return JSON.parse(m[0]);
  },
};
const explCache = () => Object.assign({}, window.SEED_EXPL || {}, DB.get('expl', {}), CLOUD.expl);
const trCache = () => Object.assign({}, DB.get('tr', {}), CLOUD.tr);

function md(s) {
  const lines = esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').split('\n');
  let out = '', ul = false;
  for (const l of lines) {
    const m = l.match(/^\s*[-*•]\s+(.*)/);
    if (m) { if (!ul) { out += '<ul>'; ul = true; } out += '<li>' + m[1] + '</li>'; }
    else { if (ul) { out += '</ul>'; ul = false; } if (l.trim()) out += '<p>' + l + '</p>'; }
  }
  return out + (ul ? '</ul>' : '');
}

/* ============ tiện ích giao diện ============ */
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 3200);
}
function modal(html, { dismiss = true, onMount } = {}) {
  return new Promise(res => {
    const ov = document.createElement('div'); ov.className = 'ov';
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    const el = $('.modal', ov);
    const close = v => { ov.remove(); res({ v, el }); };
    ov.addEventListener('click', e => { if (e.target === ov && dismiss) return close(null); const b = e.target.closest('[data-m]'); if (b) close(b.dataset.m); });
    ov.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) { const b = $('[data-m="ok"]', ov); if (b) b.click(); } if (e.key === 'Escape' && dismiss) close(null); });
    document.body.appendChild(ov);
    (el.querySelector('[autofocus]') || el.querySelector('input,button')).focus();
    onMount && onMount(el, close);
  });
}
async function confirmBox(title, text, ok = 'Đồng ý', danger = false) {
  const r = await modal(`<h3>${esc(title)}</h3><div>${text}</div><div class="acts"><button class="btn" data-m="no">Huỷ</button><button class="btn ${danger ? 'danger' : 'pri'}" data-m="ok" autofocus>${esc(ok)}</button></div>`);
  return r.v === 'ok';
}
const alertBox = (title, text) => modal(`<h3>${esc(title)}</h3><div>${text}</div><div class="acts"><button class="btn pri" data-m="ok" autofocus>Đóng</button></div>`);
async function askName(title, value = '') {
  const r = await modal(`<h3>${esc(title)}</h3><input type="text" maxlength="24" value="${esc(value)}" placeholder="Ví dụ: Mozart" autofocus><div class="acts"><button class="btn" data-m="no">Huỷ</button><button class="btn pri" data-m="ok">Lưu</button></div>`);
  return r.v === 'ok' ? r.el.querySelector('input').value.trim() : null;
}
function download(name, text, type = 'application/json') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function pickFile(accept) {
  return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files[0] || null); i.click(); });
}
const go = h => { if (location.hash === h) render(); else location.hash = h; };

/* ============ khung trang ============ */
function topbar() {
  return `<header class="topbar"><div class="wrap">
    <button class="brand" data-act="home"><i>FE</i><span class="bt">FE Study</span></button><span class="grow"></span>
    <button class="chip-user" data-act="who" title="Đổi người dùng"><span class="av" style="background:${PROFILE.color}">${esc(initial(PROFILE.name))}</span>${esc(PROFILE.name)}</button>
    <button class="icon-btn" data-act="theme" title="Sáng / tối">◐</button>
    <button class="icon-btn" data-act="settings" title="Cài đặt AI & sao lưu">⚙</button>
  </div></header>`;
}

function viewWho() {
  const ps = listProfiles();
  return `<section class="who"><h1>Ai đang ôn thi?</h1>
    <p class="muted">Chọn hồ sơ của bạn. Tiến độ, câu sai và lịch sử làm bài được lưu riêng cho từng người.</p>
    <div class="tiles">
      ${ps.map(p => `<div class="tile" role="button" tabindex="0" data-act="pick-profile" data-id="${p.id}">
        <div class="face" style="background:${p.color}">${esc(initial(p.name))}</div><div class="nm">${esc(p.name)}</div>
        ${ui.manage ? `<div class="tools"><span data-act="rename-profile" data-id="${p.id}" title="Đổi tên">✎</span><span data-act="del-profile" data-id="${p.id}" title="Xoá">✕</span></div>` : ''}</div>`).join('')}
      <div class="tile add" role="button" tabindex="0" data-act="new-profile"><div class="face">+</div><div class="nm">Thêm người</div></div>
    </div>
    <div class="row"><button class="link" data-act="manage">${ui.manage ? 'Xong' : 'Quản lý hồ sơ'}</button><span class="muted">·</span><button class="link" data-act="settings">⚙ Cài đặt AI & sao lưu</button></div>
    <p class="foot">Dữ liệu lưu ngay trong trình duyệt này. Muốn chuyển máy: Cài đặt → Sao lưu.</p></section>`;
}

function viewHome() {
  const all = SUBJECTS.map(s => ({ s, st: stats(s.code) }));
  const T = all.reduce((a, x) => a + x.st.total, 0), D = all.reduce((a, x) => a + x.st.done, 0), W = all.reduce((a, x) => a + x.st.wrong, 0);
  const A = PROFILE.active;
  return `${topbar()}<main class="wrap">
    <div class="hero"><h1>Chào ${esc(PROFILE.name)} 👋</h1><p class="muted">Chọn một môn để tạo đề ôn thi.</p>
    <div class="totals">
      <div class="stat main"><b>${T}</b><span>Tổng số câu của 5 môn</span></div>
      <div class="stat"><b>${D}</b><span>Đã làm</span></div>
      <div class="stat"><b style="color:var(--bad)">${W}</b><span>Đang sai (cần ôn lại)</span></div>
      <div class="stat"><b>${PROFILE.sessions.length}</b><span>Phiên đã nộp</span></div>
    </div></div>
    ${A ? `<div class="banner"><span>⏱ Bạn đang làm dở <b>${esc(A.title)}</b> (${SUBJ[A.subj].code}, ${A.items.filter(i => i.pick != null).length}/${A.items.length} câu).</span><span class="grow"></span><button class="btn pri sm" data-act="resume">Làm tiếp</button></div>` : ''}
    <div class="subjects">${all.map(({ s, st }) => `
      <button class="scard" style="--c:${s.color}" data-act="open-subject" data-code="${s.code}">
        <div class="ic">${s.icon}</div><h3>${s.code}</h3><div class="nm">${esc(s.name)}</div>
        <div class="cnt">${st.total}<small> câu</small></div>
        <div class="bar"><i style="width:${st.total ? st.done / st.total * 100 : 0}%"></i></div>
        <div class="sm muted">${st.total ? `Đã làm ${st.done}/${st.total} · sai ${st.wrong}` : 'Chưa có câu hỏi — bấm để nhập'}</div>
      </button>`).join('')}</div></main>`;
}

function sumHTML(code) {
  const cfg = getCfg(code), pool = poolFor(code, cfg).length, n = Math.min(cfg.n, pool);
  if (!pool) {
    const msg = cfg.src === 'new' ? 'Bạn đã làm hết câu mới trong phạm vi này 🎉 Hãy chuyển sang “Câu mới + câu sai”, “Chỉ câu sai” hoặc “Tất cả”.' : 'Không có câu nào phù hợp với lựa chọn hiện tại.';
    return `<div class="summary warn">${msg}</div>`;
  }
  return `<div class="summary">Sẽ tạo đề <b>${n}</b> câu · ${cfg.min ? `<b>${cfg.min}</b> phút` : 'không giới hạn thời gian'}${n < cfg.n ? ` · <span style="color:var(--warn)">chỉ còn ${pool} câu phù hợp</span>` : ` · còn ${pool - n} câu trong kho`}</div>`;
}
function refreshSummary(code) {
  const s = $('#sum'); if (s) s.innerHTML = sumHTML(code);
  const b = $('#startBtn'); if (b) b.disabled = !poolFor(code, getCfg(code)).length;
}

function viewSubject(code) {
  const S = SUBJ[code], b = getBank(code), st = stats(code), cfg = getCfg(code), d = subjData(code);
  const sess = PROFILE.sessions.filter(s => s.subj === code);
  const head = `${topbar()}<main class="wrap" style="--c:${S.color}">
    <div class="crumb"><button class="link" data-act="home">← Tất cả môn</button></div>
    <div class="shead"><div class="ic">${S.icon}</div><div><h1>${S.code}</h1><div class="muted">${esc(S.name)}</div></div></div>`;
  if (b.empty) return head + `<div class="panel empty"><h2>Chưa có câu hỏi cho ${S.code}</h2>
    <p>Nhập file ngân hàng câu hỏi (<code>.docx</code>, <code>.txt</code> hoặc <code>.json</code>) theo cùng định dạng với file CSI106 mẫu.</p>
    <button class="btn pri big" data-act="import-bank" data-code="${code}">＋ Nhập ngân hàng câu hỏi</button></div></main>`;
  const A = PROFILE.active;
  return head + `
    ${A && A.subj === code ? `<div class="banner"><span>⏱ Đang làm dở <b>${esc(A.title)}</b> (${A.items.filter(i => i.pick != null).length}/${A.items.length} câu).</span><span class="grow"></span><button class="btn pri sm" data-act="resume">Làm tiếp</button></div><br>` : ''}
    <div class="cols"><div>
      <section class="panel"><h2>Tạo đề mới</h2>
        <div class="seg"><button data-act="preset" data-p="def">Mặc định ${S.n} câu / ${S.min}'</button><button data-act="preset" data-p="mini">Mini 20 câu / 20'</button><button data-act="preset" data-p="quick">10 câu · không giờ</button></div>
        <div class="fld row"><div><label>Số câu</label><input type="number" min="1" max="500" data-cfg="n" value="${cfg.n}"></div>
          <div><label>Thời gian (phút, 0 = không giới hạn)</label><input type="number" min="0" max="600" data-cfg="min" value="${cfg.min}"></div></div>
        <div class="fld"><span class="lb">Lấy câu hỏi từ</span><div class="seg">${Object.entries(SRC_LABEL).map(([k, v]) => `<button class="${cfg.src === k ? 'on' : ''}" data-act="cfg-src" data-v="${k}">${v}</button>`).join('')}</div></div>
        <div class="fld"><span class="lb">Chủ đề <span class="muted sm">(số câu phù hợp / tổng)</span></span><div class="chips">
          <button class="${cfg.topics.length ? '' : 'on'}" data-act="cfg-topic" data-i="all">Tất cả</button>
          ${b.topics.map((t, i) => `<button class="${cfg.topics.includes(i) ? 'on' : ''}" data-act="cfg-topic" data-i="${i}">${esc(t.name)}<small>${b.questions.filter(q => q.s === i && inSrc(cfg.src, d, q)).length}/${b.questions.filter(q => q.s === i).length}</small></button>`).join('')}</div></div>
        <label class="sw"><input type="checkbox" data-cfg="instant" ${cfg.instant ? 'checked' : ''}> Hiện đáp án + giải thích ngay sau khi chọn</label>
        <label class="sw"><input type="checkbox" data-cfg="shuffleQ" ${cfg.shuffleQ ? 'checked' : ''}> Trộn thứ tự câu hỏi</label>
        <label class="sw"><input type="checkbox" data-cfg="shuffleO" ${cfg.shuffleO ? 'checked' : ''}> Trộn thứ tự đáp án A/B/C… <span class="muted sm">(tránh nhớ vị trí đáp án)</span></label>
        <div id="sum">${sumHTML(code)}</div>
        <button id="startBtn" class="btn pri big" data-act="start" ${poolFor(code, cfg).length ? '' : 'disabled'}>▶ Bắt đầu làm bài</button>
      </section>
      ${b.mocks.length ? `<section class="panel"><h2>Đề mô phỏng có sẵn</h2><div class="list">${b.mocks.map((m, i) => {
        const best = sess.filter(s => s.mode === 'mock:' + m.name).reduce((a, s) => Math.max(a, s.score), -1);
        return `<button class="item" data-act="start-mock" data-i="${i}"><b>${esc(m.name)}</b><span class="muted sm">${m.ids.length} câu</span><span class="grow"></span>${best >= 0 ? `<span class="pill ${best >= PASS ? 'ok' : 'bad'}">tốt nhất ${best.toFixed(1)}</span>` : '<span class="pill gray">chưa làm</span>'}</button>`; }).join('')}</div></section>` : ''}
    </div><div>
      <section class="panel"><h2>Tiến độ của ${esc(PROFILE.name)}</h2>
        <div class="bar"><i style="width:${st.total ? st.done / st.total * 100 : 0}%"></i></div>
        <div class="sm muted">Đã làm ${st.done}/${st.total} câu · tỉ lệ đúng ${st.done ? Math.round(st.ok / st.done * 100) : 0}%</div><br>
        <div class="boxes">
          <div class="mini">Câu mới<b>${st.total - st.done}</b></div>
          <div class="mini ok">Đang đúng<b>${st.ok}</b></div>
          <button class="mini bad act" data-act="start-src" data-src="wrong" ${st.wrong ? '' : 'disabled'}>❌ Câu sai — ôn ngay<b>${st.wrong}</b></button>
          <button class="mini act" data-act="start-src" data-src="star" ${st.star ? '' : 'disabled'}>⭐ Đã đánh dấu — ôn ngay<b>${st.star}</b></button>
        </div></section>
      <section class="panel"><h2>Lịch sử các phiên</h2>${sess.length ? `<div class="list">${sess.slice(0, 15).map(s => `
        <button class="item" data-act="open-result" data-id="${s.id}"><span class="score-s" style="color:var(--${s.score >= PASS ? 'ok' : 'bad'})">${s.score.toFixed(1)}</span>
        <span><b>${esc(s.title)}</b><br><span class="muted sm">${fdate(s.ts)} · ${s.items.filter(i => i.ok).length}/${s.items.length} đúng · ${fmt(s.used)}</span></span></button>`).join('')}</div>` : '<div class="empty">Chưa có phiên nào. Làm đề đầu tiên nào!</div>'}</section>
      <section class="panel"><h2>Quản lý</h2><div class="row">
        <button class="btn sm" data-act="import-bank" data-code="${code}">＋ Nhập thêm câu hỏi</button>
        ${DB.get('bank:' + code) && window.BANKS && window.BANKS[code] ? `<button class="btn sm" data-act="reset-bank" data-code="${code}">Về ngân hàng gốc</button>` : ''}
        <button class="btn sm danger" data-act="reset-progress" data-code="${code}">Xoá tiến độ môn này</button></div></section>
    </div></div></main>`;
}

/* ---- thẻ câu hỏi (dùng cho làm bài và xem lại) ---- */
function qCard(code, q, it, o) {
  const vi = PROFILE.settings.vi, key = qkey(code, q.id), tr = trCache()[key] || {};
  const tvRaw = q.tv || tr.t || '', tv = same(tvRaw, q.t) ? '' : tvRaw, multi = q.a.length > 1, d = subjData(code), b = getBank(code);
  const sel = new Set([...(it.pick || '').split(''), ...(o.reveal ? [] : it.sel || [])]);
  const opts = it.ord.map((k, pos) => {
    const op = q.o.find(x => x[0] === k); if (!op) return '';
    const right = q.a.includes(k), picked = (it.pick || '').includes(k);
    let cls = '', mk = '';
    if (o.reveal) { if (right) { cls = 'ok'; mk = '✓'; } else if (picked) { cls = 'bad'; mk = '✗'; } else cls = 'dim'; }
    else if (sel.has(k)) cls = 'sel';
    const ovRaw = op[2] || (tr.o && tr.o[k]) || '', ov = same(ovRaw, op[1]) ? '' : ovRaw;
    return `<li><button class="opt ${cls}" data-act="pick" data-k="${k}" ${o.reveal || !o.interactive ? 'disabled' : ''}>
      <span class="ltr">${LETTERS[pos]}</span><span class="otxt"><span class="o-en">${esc(op[1])}</span>${vi && ov ? `<div class="o-vi">${esc(ov)}</div>` : ''}</span><span class="mk">${mk}</span></button></li>`;
  }).join('');
  let fb = '';
  if (o.reveal) {
    const rl = it.ord.map((k, i) => q.a.includes(k) ? LETTERS[i] : '').filter(Boolean).join(', ');
    fb = it.pick == null ? `<div class="fb skip">Chưa trả lời · Đáp án đúng: ${rl}</div>` : it.ok ? `<div class="fb ok">✓ Chính xác!</div>` : `<div class="fb bad">✗ Chưa đúng · Đáp án đúng: ${rl}</div>`;
  }
  const star = !!d.star[q.id];
  return `<article class="qcard">
    <div class="qmeta"><span class="num">Câu ${o.num}/${o.total}</span><span class="tag">${esc((b.topics[q.s] || {}).name || '')}</span><span class="tag">${esc(q.id)}</span>
      <span class="tools">${o.interactive ? `<button class="tg ${it.flag ? 'on' : ''}" data-act="flag" title="Đánh dấu xem lại (M)">⚑ Xem lại</button>` : ''}<button class="tg ${star ? 'on' : ''}" data-act="star" data-key="${esc(key)}" title="Lưu vào hộp đánh dấu">${star ? '★' : '☆'} Lưu</button></span></div>
    <div class="q-en">${esc(q.t)}</div>
    ${vi && tv ? `<div class="q-vi">${esc(tv)}</div>` : ''}
    ${vi && !tvRaw ? `<div class="sm" style="margin-top:8px">${ui.trBusy[key] ? '<span class="spin"></span>Đang dịch…' : `<button class="link" data-act="translate" data-key="${esc(key)}">🌐 Dịch câu này bằng AI</button>`}</div>` : ''}
    ${multi ? `<div class="sm muted" style="margin-top:10px">Câu này chọn <b>nhiều</b> đáp án.</div>` : ''}
    <ul class="opts">${opts}</ul>
    ${multi && o.interactive && o.instant && !o.reveal ? `<div class="nav"><button class="btn pri" data-act="confirm-multi" ${(it.sel || []).length ? '' : 'disabled'}>Xác nhận đáp án</button></div>` : ''}
    ${fb}${o.reveal ? explBlock(code, q, it.ord) : ''}</article>`;
}
/* Lời giải gốc ghi "Đáp án B…", "Option C…" theo thứ tự gốc; khi đáp án bị trộn thì đổi sang chữ cái đang hiển thị. */
function remapLetters(text, ord) {
  if (!text || !ord) return text;
  const disp = k => { const i = ord.indexOf(k); return i < 0 ? k : LETTERS[i]; };
  return text.replace(/((?:Đáp án|đáp án|Phương án|phương án|Lựa chọn|lựa chọn|Option|option|Answer|answer)s?\s+)([A-H](?:\s*(?:,|và|hoặc|and|or|\/)\s*[A-H]\b)*)\b/g,
    (m, pre, list) => pre + list.replace(/[A-H]/g, disp));
}
function explBlock(code, q, ord) {
  const vi = PROFILE.settings.vi, key = qkey(code, q.id);
  return `<section class="expl"><h4>Giải thích</h4>
    ${q.e ? `<div class="e-en">${esc(remapLetters(q.e, ord))}</div>` : '<div class="muted sm">Câu này chưa có giải thích sẵn.</div>'}
    ${vi && q.ev && !same(q.ev, q.e) ? `<div class="e-vi">${esc(q.ev)}</div>` : ''}
    <div class="aibox" data-aibox="${esc(key)}">${aiInner(key)}</div></section>`;
}
function aiInner(key) {
  const c = explCache()[key];
  if (ui.aiBusy[key]) return '<span class="spin"></span>AI đang giải thích…';
  let h = '';
  if (c && ui.aiShown.has(key)) {
    h += `<div class="ai-out">${md(c.t)}</div><div class="ai-src">✨ ${esc(c.m || 'AI')} · do <b>${esc(c.by)}</b> tạo ${fdate(c.ts)}${c.by === PROFILE.name ? '' : ' · dùng lại, không tốn lượt gọi AI'} · <button class="link" data-act="ai-regen" data-key="${esc(key)}">Tạo lại</button></div>`;
  } else {
    h += `<button class="btn sm" data-act="ai" data-key="${esc(key)}">✨ ${c ? `Xem giải thích AI (đã có từ ${esc(c.by)})` : 'Giải thích chi tiết bằng AI'}</button>`;
  }
  if (ui.aiErr[key]) h += `<div class="ai-err">${esc(ui.aiErr[key])}</div>`;
  return h;
}
const refreshAI = key => $$('[data-aibox]').filter(e => e.dataset.aibox === key).forEach(e => { e.innerHTML = aiInner(key); });

async function aiExplain(key, force) {
  const [code, id] = splitKey(key), q = getBank(code).idx.get(id);
  if (!force && explCache()[key]) { ui.aiShown.add(key); return refreshAI(key); }
  if (CLOUD.on && !await ensureCode()) return;
  ui.aiErr[key] = ''; ui.aiBusy[key] = 1; refreshAI(key);
  try {
    if (CLOUD.on) {
      const j = await cloudAI({ action: 'explain', key, force: !!force, q: { t: q.t, o: q.o.map(o => o[1]), correct: q.a.split('').map(k => q.o.find(o => o[0] === k)[1]), e: q.e || '' } });
      CLOUD.expl[key] = { t: j.text, by: j.author, m: j.model, ts: j.ts };
    } else {
      const text = await AI.explain(q), cache = DB.get('expl', {});
      cache[key] = { t: text, by: PROFILE.name, m: AI.cfg().model, ts: Date.now() }; DB.set('expl', cache);
    }
    ui.aiShown.add(key);
  } catch (e) { ui.aiErr[key] = e.message === 'NOKEY' ? 'Chưa cài API key — bấm ⚙ ở góc trên để cài đặt.' : e.message === 'CODE' ? 'Mã truy cập không đúng — bấm lại để nhập mã.' : 'Lỗi AI: ' + e.message; }
  delete ui.aiBusy[key]; refreshAI(key);
}
async function aiTranslate(key) {
  const [code, id] = splitKey(key), q = getBank(code).idx.get(id);
  if (CLOUD.on && !await ensureCode()) return;
  ui.trBusy[key] = 1; render(true);
  try {
    if (CLOUD.on) {
      const j = await cloudAI({ action: 'translate', key, q: { t: q.t, o: Object.fromEntries(q.o.map(o => [o[0], o[1]])) } });
      CLOUD.tr[key] = { ...j.data, by: j.author, ts: j.ts };
    } else { const r = await AI.translate(q); const tr = DB.get('tr', {}); tr[key] = { t: r.t || '', o: r.o || {}, by: PROFILE.name, ts: Date.now() }; DB.set('tr', tr); }
  }
  catch (e) { toast(e.message === 'NOKEY' ? 'Chưa cài API key — bấm ⚙ để cài đặt.' : e.message === 'CODE' ? 'Mã truy cập không đúng' : 'Lỗi dịch: ' + e.message); }
  delete ui.trBusy[key]; render(true);
}

/* ---- màn hình làm bài ---- */
function viewExam() {
  const S = PROFILE.active, b = getBank(S.subj), it = S.items[S.i], q = b.idx.get(it.id);
  const answered = S.items.filter(i => i.pick != null).length;
  const okc = S.items.filter(i => i.ok === true).length, badc = S.items.filter(i => i.ok === false).length;
  const reveal = S.instant && it.pick != null;
  const last = S.i === S.items.length - 1;
  return `<header class="xbar"><div class="wrap">
      <button class="brand" data-act="leave-exam" title="Thoát (bài vẫn được lưu)"><i>←</i></button>
      <div><b>${S.subj}</b> <span class="muted sm">· ${esc(S.title)}</span></div><span class="grow"></span>
      <span class="prog">${answered}/${S.items.length} câu${S.instant ? ` · <b class="ok">${okc} đúng</b> · <b class="bad">${badc} sai</b>` : ''}</span>
      <button class="vi-btn ${PROFILE.settings.vi ? 'on' : ''}" data-act="toggle-vi" title="Hiện/ẩn bản dịch tiếng Việt (V)">VI<span class="hide-sm"> · Dịch</span></button>
      <span class="timer" id="timer">--:--</span>
      <button class="btn pri sm" data-act="submit">Nộp bài</button></div></header>
    <main class="wrap"><div class="xbody"><div>
      ${qCard(S.subj, q, it, { num: S.i + 1, total: S.items.length, reveal, interactive: true, instant: S.instant })}
      <div class="nav"><button class="btn" data-act="prev" ${S.i === 0 ? 'disabled' : ''}>← Câu trước</button>
        ${last ? `<button class="btn pri" data-act="submit">Nộp bài ✓</button>` : `<button class="btn pri" data-act="next">Câu tiếp →</button>`}
        <span class="grow"></span><span class="muted sm"><span class="kbd">1</span>–<span class="kbd">${Math.min(8, it.ord.length)}</span> chọn · <span class="kbd">←</span><span class="kbd">→</span> chuyển câu · <span class="kbd">V</span> dịch · <span class="kbd">M</span> đánh dấu</span></div>
    </div><aside class="palette-wrap"><div class="panel"><h2 style="font-size:1rem">Danh sách câu</h2><div class="palette">
      ${S.items.map((x, i) => { const c = i === S.i ? 'cur ' : ''; const st = x.pick == null ? '' : S.instant ? (x.ok ? 'ok' : 'bad') : 'ans'; return `<button class="pn ${c}${st} ${x.flag ? 'flag' : ''}" data-act="jump" data-i="${i}">${i + 1}</button>`; }).join('')}</div>
      <div class="legend">${S.instant ? '<span><i style="background:var(--ok)"></i>Đúng</span><span><i style="background:var(--bad)"></i>Sai</span>' : '<span><i style="background:var(--accent)"></i>Đã chọn</span>'}<span><i style="background:var(--warn)"></i>Xem lại</span></div></div></aside></div></main>`;
}

let tick = null, tickSid = null, lastTick = 0, saveCnt = 0;
function startTimer() {
  const S = PROFILE.active; if (!S || (tick && tickSid === S.id)) { updTimer(); return; }
  stopTimer(); tickSid = S.id; lastTick = Date.now();
  tick = setInterval(() => {
    const A = PROFILE && PROFILE.active; if (!A) return stopTimer();
    const now = Date.now(); A.used += Math.min(5, (now - lastTick) / 1000); lastTick = now; updTimer();
    if (++saveCnt % 5 === 0) save();
    if (A.limit && A.used >= A.limit) { toast('Hết giờ! Đã tự động nộp bài.'); finish(); }
  }, 1000);
  updTimer();
}
function stopTimer() { if (tick) { clearInterval(tick); tick = null; tickSid = null; save(); } }
function updTimer() {
  const el = $('#timer'), S = PROFILE && PROFILE.active; if (!el || !S) return;
  el.textContent = fmt(S.limit ? S.limit - S.used : S.used); el.classList.toggle('low', !!S.limit && S.limit - S.used < 300);
}

/* ---- logic làm bài ---- */
const curItem = () => { const S = PROFILE.active; return [S, S.items[S.i], getBank(S.subj).idx.get(S.items[S.i].id)]; };
function commitDone(S, it) {
  const d = subjData(S.subj), r = d.done[it.id] || (d.done[it.id] = { att: 0, wr: 0 });
  r.ok = !!it.ok; r.ts = Date.now(); r.att++; if (!it.ok) r.wr++; it.c = 1;
}
function pick(k) {
  const [S, it, q] = curItem(), multi = q.a.length > 1;
  if (S.instant) {
    if (it.pick != null) return;
    if (multi) { it.sel = it.sel || []; const i = it.sel.indexOf(k); i < 0 ? it.sel.push(k) : it.sel.splice(i, 1); }
    else { it.pick = k; it.ok = k === q.a; commitDone(S, it); }
  } else if (multi) {
    it.sel = it.sel || []; const i = it.sel.indexOf(k); i < 0 ? it.sel.push(k) : it.sel.splice(i, 1);
    it.pick = it.sel.length ? it.sel.slice().sort().join('') : null;
  } else it.pick = it.pick === k ? null : k;
  save(); render(true);
}
function confirmMulti() {
  const [S, it, q] = curItem(); if (!(it.sel || []).length || it.pick != null) return;
  it.pick = it.sel.slice().sort().join(''); it.ok = it.pick === q.a; commitDone(S, it); save(); render(true);
}
function nav(i) { const S = PROFILE.active; S.i = Math.max(0, Math.min(S.items.length - 1, i)); save(); render(); }
function finish() {
  const S = PROFILE.active; if (!S) return;
  const b = getBank(S.subj);
  S.items.forEach(it => {
    const q = b.idx.get(it.id);
    if (it.pick == null) { it.ok = null; return; }
    it.ok = it.pick === q.a;
    if (!S.instant && !it.c) commitDone(S, it);
  });
  const correct = S.items.filter(i => i.ok === true).length;
  S.score = +(correct / S.items.length * 10).toFixed(2); S.used = Math.round(S.used); S.end = Date.now(); S.submitted = true;
  PROFILE.sessions.unshift(S); PROFILE.active = null; stopTimer(); save();
  go('#/result/' + S.id);
}
async function submitExam() {
  const S = PROFILE.active, un = S.items.filter(i => i.pick == null).length;
  const ok = await confirmBox('Nộp bài?', un ? `Còn <b>${un}</b> câu chưa trả lời (tính là sai nhưng <b>không</b> bị ghi vào “đã làm”, sẽ xuất hiện lại ở đề mới).` : 'Bạn đã trả lời hết các câu.', 'Nộp bài');
  if (ok) finish();
}
async function startSession(code, title, mode, qs, cfg) {
  if (PROFILE.active) {
    const ok = await confirmBox('Bỏ bài đang làm dở?', `Bạn đang làm dở <b>${esc(PROFILE.active.title)}</b>. Tạo đề mới sẽ bỏ bài đó (các câu đã trả lời vẫn được lưu).`, 'Bỏ & tạo đề mới', true);
    if (!ok) return;
  }
  const items = qs.map(q => ({ id: q.id, pick: null, ok: null, flag: 0, sel: [], ord: cfg.shuffleO && canShuffle(q) ? shuffle(q.o.map(o => o[0])) : q.o.map(o => o[0]) }));
  const n = PROFILE.sessions.filter(s => s.subj === code).length + 1;
  PROFILE.active = { id: uid(), subj: code, title: title.replace('{n}', n), mode, ts: Date.now(), limit: cfg.min * 60, used: 0, instant: cfg.instant, i: 0, items };
  save(); go('#/exam');
}
function startFromCfg(code, srcOverride) {
  const cfg = getCfg(code), b = getBank(code);
  if (srcOverride) { cfg.src = srcOverride; cfg.topics = []; }
  let pool = poolFor(code, cfg); if (!pool.length) return toast('Không có câu nào phù hợp.');
  pool = cfg.shuffleQ ? shuffle(pool) : pool; let qs = pool.slice(0, cfg.n);
  if (!cfg.shuffleQ) qs.sort((a, c) => b.order.get(a.id) - b.order.get(c.id));
  const label = { wrong: 'Ôn câu sai', star: 'Ôn câu đánh dấu' }[srcOverride] || 'Đề #{n}';
  startSession(code, label, 'custom', qs, { ...cfg, min: cfg.min });
}

/* ---- kết quả ---- */
function viewResult(id) {
  const S = PROFILE.sessions.find(s => s.id === id); if (!S) return null;
  const b = getBank(S.subj), items = S.items;
  const ok = items.filter(i => i.ok === true).length, bad = items.filter(i => i.ok === false).length, skip = items.length - ok - bad;
  const byT = {}; items.forEach(i => { const q = b.idx.get(i.id); const t = (b.topics[q.s] || {}).name || 'Khác'; (byT[t] = byT[t] || { n: 0, ok: 0 }).n++; if (i.ok) byT[t].ok++; });
  const pass = S.score >= PASS, col = pass ? 'var(--ok)' : 'var(--bad)';
  const rf = ui.rf, list = items.map((it, i) => ({ it, i })).filter(({ it }) => rf === 'all' || (rf === 'wrong' && it.ok === false) || (rf === 'skip' && it.ok === null) || (rf === 'ok' && it.ok === true));
  return `${topbar()}<main class="wrap" style="--c:${SUBJ[S.subj].color}">
    <div class="crumb"><button class="link" data-act="open-subject" data-code="${S.subj}">← ${S.subj}</button></div>
    <section class="panel"><div class="rhero">
      <div class="ring" style="--p:${S.score * 10};--c:${col}"><div><span><b style="color:${col}">${S.score.toFixed(1)}</b><span>/ 10</span></span></div></div>
      <div class="grow"><h1>${pass ? 'Đạt 🎉' : 'Chưa đạt'} <span class="muted sm" style="font-weight:400">(đạt ≥ ${PASS.toFixed(1)}/10)</span></h1>
        <div class="muted">${esc(S.title)} · ${S.subj} · ${fdate(S.ts)}</div>
        <div class="row" style="margin-top:12px"><span class="pill ok">✓ ${ok} đúng</span><span class="pill bad">✗ ${bad} sai</span><span class="pill warn">○ ${skip} bỏ trống</span><span class="pill gray">⏱ ${fmt(S.used)}${S.limit ? ' / ' + fmt(S.limit) : ''}</span></div>
        <div class="row" style="margin-top:16px"><button class="btn pri" data-act="open-subject" data-code="${S.subj}">Tạo đề mới</button>
          ${bad + skip ? `<button class="btn" data-act="redo-wrong" data-id="${S.id}">Làm lại ${bad + skip} câu sai/bỏ trống</button>` : ''}</div></div></div></section>
    <section class="panel"><h2>Theo chủ đề</h2>${Object.entries(byT).map(([t, v]) => `<div class="trow"><span>${esc(t)}</span><div class="bar" style="margin:0"><i style="width:${v.ok / v.n * 100}%;background:${v.ok / v.n >= .5 ? 'var(--ok)' : 'var(--bad)'}"></i></div><b>${v.ok}/${v.n}</b></div>`).join('')}</section>
    <section class="review"><h2 style="margin-top:22px">Xem lại từng câu</h2>
      <div class="tabs seg">${[['all', 'Tất cả', items.length], ['wrong', 'Sai', bad], ['skip', 'Bỏ trống', skip], ['ok', 'Đúng', ok]].map(([k, l, n]) => `<button class="${rf === k ? 'on' : ''}" data-act="rf" data-v="${k}">${l} (${n})</button>`).join('')}</div>
      ${list.length ? list.map(({ it, i }) => qCard(S.subj, b.idx.get(it.id), it, { num: i + 1, total: items.length, reveal: true, interactive: false })).join('') : '<div class="empty">Không có câu nào ở mục này.</div>'}</section></main>`;
}

/* ============ điều hướng / render ============ */
const route = () => { const [a, b] = location.hash.replace(/^#\/?/, '').split('/'); return { name: a || 'who', arg: b }; };
function render(keep) {
  const y = keep ? window.scrollY : 0, r = route(), app = $('#app');
  if (r.name !== 'who' && !PROFILE) { location.hash = '#/'; return; }
  let html = '';
  if (r.name === 'who') { html = viewWho(); }
  else if (r.name === 'home') html = viewHome();
  else if (r.name === 's' && SUBJ[r.arg]) html = viewSubject(r.arg);
  else if (r.name === 'exam') { if (!PROFILE.active) { location.hash = '#/home'; return; } html = viewExam(); }
  else if (r.name === 'result') { html = viewResult(r.arg); if (!html) { location.hash = '#/home'; return; } }
  else { location.hash = '#/'; return; }
  if (r.name !== 'exam') stopTimer();
  app.innerHTML = html;
  window.scrollTo(0, y);
  if (r.name === 'exam') startTimer();
  document.title = (r.name === 'exam' ? PROFILE.active.subj + ' · ' : '') + 'FE Study';
}

/* ---- nhập ngân hàng ---- */
async function importBank(code) {
  const f = await pickFile('.docx,.txt,.md,.json'); if (!f) return;
  let parsed;
  try {
    const ext = f.name.split('.').pop().toLowerCase(), opt = { idPrefix: code };
    parsed = ext === 'docx' ? P.parseLines(await P.docxToLines(await f.arrayBuffer()), opt) : ext === 'json' ? P.parseJson(await f.text(), opt) : P.parseText(await f.text(), opt);
  } catch (e) { return alertBox('Không đọc được file', esc(e.message)); }
  if (!parsed.questions.length) return alertBox('Không tìm thấy câu hỏi', 'File cần có dạng: <code>Question 1: …</code>, các dòng <code>A. …</code>, <code>Answer: B</code>, <code>Explanation: …</code>.');
  const base = getBank(code);
  const ok = await confirmBox('Nhập câu hỏi', `Tìm thấy <b>${parsed.questions.length}</b> câu, ${parsed.topics.length} chủ đề${parsed.mocks.length ? `, ${parsed.mocks.length} đề mô phỏng` : ''}.${base.empty ? '' : '<br>Sẽ <b>gộp</b> vào ngân hàng hiện có (bỏ qua câu trùng mã).'}`, 'Nhập');
  if (!ok) return;
  const m = { topics: base.topics.map(t => ({ ...t })), questions: base.questions.slice(), mocks: base.mocks.map(x => ({ ...x, ids: x.ids.slice() })) };
  const have = new Set(m.questions.map(q => q.id));
  parsed.questions.forEach(q => {
    if (have.has(q.id)) return;
    const tn = (parsed.topics[q.s] || { name: 'Chung' }).name; let s = m.topics.findIndex(t => t.name === tn);
    if (s < 0) { m.topics.push({ name: tn }); s = m.topics.length - 1; }
    m.questions.push({ ...q, s }); have.add(q.id);
  });
  parsed.mocks.forEach(x => { if (!m.mocks.some(y => y.name === x.name)) m.mocks.push(x); });
  DB.set('bank:' + code, m); delete bankCache[code]; toast('Đã nhập xong'); render();
}

/* ---- cài đặt + sao lưu ---- */
async function openSettingsShared() { // cài đặt khi đã bật máy chủ dùng chung
  await modal(`<h3>⚙ Cài đặt</h3>
    <div class="sm muted">AI do máy chủ cấp nên <b>không cần API key</b>. Giải thích AI được lưu chung: ai bấm trước thì mọi người sau dùng lại, không tốn lượt. Chỉ khi tạo giải thích <b>mới</b> mới cần mã truy cập.</div>
    <label>Mã truy cập AI</label><input type="password" id="s-code" value="${esc(DB.get('code', ''))}" placeholder="do người quản lý trang cấp" autocomplete="off">
    <div class="row" style="margin-top:12px"><button class="btn sm" id="s-test">Kiểm tra AI</button><span class="sm" id="s-res"></span></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <b>Sao lưu</b>
    <div class="sm muted" style="margin:4px 0 10px">Đã có <b>${Object.keys(explCache()).length}</b> giải thích AI dùng chung. Hồ sơ và tiến độ nằm trong trình duyệt này; dùng sao lưu để chuyển sang máy khác.</div>
    <div class="row"><button class="btn sm" id="s-exp">⬇ Xuất sao lưu</button><button class="btn sm" id="s-imp">⬆ Nhập sao lưu</button></div>
    <div class="acts"><button class="btn" data-m="no">Đóng</button><button class="btn pri" data-m="ok">Lưu</button></div>`, {
    onMount(el) {
      $('#s-exp', el).onclick = exportAll; $('#s-imp', el).onclick = importAll;
      const res = $('#s-res', el), show = (ok, msg) => { res.innerHTML = `<span style="color:var(--${ok ? 'ok' : 'bad'})">${ok ? '✓' : '✗'} ${esc(msg)}</span>`; };
      $('#s-test', el).onclick = async () => {
        const c = $('#s-code', el).value.trim(); if (!c) return show(false, 'Hãy nhập mã truy cập');
        DB.set('code', c); res.innerHTML = '<span class="spin"></span>Đang thử…';
        try {
          const j = await cloudAI({ action: 'ping', deep: true }), sec = j.aiMs != null ? (j.aiMs / 1000).toFixed(1) + ' giây' : '';
          if (j.aiError) show(false, `Mã đúng nhưng AI lỗi sau ${sec}: ${j.aiError}`);
          else show(true, `Mã đúng${sec ? ` · AI trả lời trong ${sec}` : ''} · hôm nay thiết bị này ${j.usedDevice}/${j.limitDevice} lượt, toàn hệ thống ${j.usedGlobal}/${j.limitGlobal}`);
        } catch (e) { show(false, e.message === 'CODE' ? 'Mã truy cập không đúng' : e.message); }
      };
    },
  }).then(r => { if (r.v === 'ok') { const c = $('#s-code', r.el).value.trim(); c ? DB.set('code', c) : DB.del('code'); toast('Đã lưu cài đặt'); } });
}
async function openSettings() {
  if (CLOUD.on) return openSettingsShared();
  const c = AI.cfg();
  await modal(`<h3>⚙ Cài đặt</h3>
    <div class="sm muted">Khoá API chỉ lưu trong trình duyệt này, <b>không</b> nằm trong mã nguồn và không được sao lưu/xuất ra file.</div>
    <label>Nhà cung cấp AI</label><select id="s-prov"><option value="anthropic">Anthropic (Claude)</option><option value="openai">OpenAI hoặc tương thích (OpenRouter, Groq…)</option><option value="gemini">Google Gemini</option></select>
    <label>API key</label><input type="password" id="s-key" value="${esc(c.key)}" placeholder="dán khoá vào đây" autocomplete="off">
    <label>Model</label><input type="text" id="s-model" value="${esc(c.model)}">
    <div id="s-base-w"><label>Base URL (OpenAI-compatible)</label><input type="text" id="s-base" value="${esc(c.base)}"></div>
    <div class="row" style="margin-top:12px"><button class="btn sm" id="s-test">Kiểm tra kết nối</button><span class="sm" id="s-res"></span></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <b>Sao lưu & chia sẻ</b>
    <div class="sm muted" style="margin:4px 0 10px">Đã lưu <b>${Object.keys(DB.get('expl', {})).length}</b> giải thích AI. Dữ liệu nằm trong trình duyệt; dùng nút dưới để chuyển máy hoặc chia sẻ.</div>
    <div class="row"><button class="btn sm" id="s-exp">⬇ Xuất sao lưu</button><button class="btn sm" id="s-imp">⬆ Nhập sao lưu</button><button class="btn sm" id="s-seed">⬇ Xuất giải thích AI cho GitHub</button></div>
    <div class="acts"><button class="btn" data-m="no">Đóng</button><button class="btn pri" data-m="ok">Lưu</button></div>`, {
    onMount(el) {
      const prov = $('#s-prov', el), sync = () => { $('#s-base-w', el).style.display = prov.value === 'openai' ? '' : 'none'; };
      prov.value = c.provider; sync();
      prov.onchange = () => { sync(); const m = { anthropic: 'claude-haiku-5-5', openai: 'gpt-4o-mini', gemini: 'gemini-2.5-flash' }[prov.value]; $('#s-model', el).value = m; };
      const read = () => ({ provider: prov.value, key: $('#s-key', el).value.trim(), model: $('#s-model', el).value.trim(), base: $('#s-base', el).value.trim() });
      $('#s-test', el).onclick = async () => {
        DB.set('api', read()); const r = $('#s-res', el); r.innerHTML = '<span class="spin"></span>Đang thử…';
        try { const t = await AI.call('Trả lời đúng một từ.', 'Nói "ok".', 20); r.innerHTML = `<span style="color:var(--ok)">✓ Kết nối được (${esc(t.slice(0, 20))})</span>`; }
        catch (e) { r.innerHTML = `<span style="color:var(--bad)">✗ ${esc(e.message === 'NOKEY' ? 'Chưa nhập API key' : e.message)}</span>`; }
      };
      $('#s-exp', el).onclick = exportAll; $('#s-imp', el).onclick = importAll; $('#s-seed', el).onclick = exportSeed;
      el._read = read;
    },
  }).then(r => { if (r.v === 'ok') { DB.set('api', r.el._read()); toast('Đã lưu cài đặt'); } });
}
const stamp = () => new Date().toISOString().slice(0, 10);
function exportAll() {
  const out = { app: 'fe-study', v: 1, ts: Date.now(), data: {} };
  DB.mem.forEach((v, k) => { if (!['api', 'cur', 'code', 'device'].includes(k)) out.data[k] = v; });
  download(`fe-study-backup-${stamp()}.json`, JSON.stringify(out)); toast('Đã xuất file sao lưu');
}
function exportSeed() {
  const e = DB.get('expl', {});
  download('explanations.js', `/* Giải thích AI dùng chung — commit file này vào thư mục data/ để mọi người cùng dùng. */\nwindow.SEED_EXPL = ${JSON.stringify(e)};\n`, 'text/javascript');
  toast(`Đã xuất ${Object.keys(e).length} giải thích — thay vào data/explanations.js`);
}
async function importAll() {
  const f = await pickFile('.json'); if (!f) return;
  try {
    const j = JSON.parse(await f.text()); if (j.app !== 'fe-study') throw new Error('Không phải file sao lưu của FE Study');
    const D = j.data;
    ['expl', 'tr'].forEach(k => { if (D[k]) { const cur = DB.get(k, {}); Object.entries(D[k]).forEach(([id, v]) => { if (!cur[id] || (v.ts || 0) > (cur[id].ts || 0)) cur[id] = v; }); DB.set(k, cur); } });
    Object.keys(D).filter(k => k.startsWith('bank:')).forEach(k => { if (!DB.get(k)) DB.set(k, D[k]); });
    (D.profiles || []).forEach(id => {
      const inc = D['p:' + id], cur = DB.get('p:' + id); if (!inc) return;
      if (!cur) { DB.set('p:' + id, inc); DB.set('profiles', [...new Set([...DB.get('profiles', []), id])]); return; }
      Object.entries(inc.subj || {}).forEach(([code, sd]) => {
        const t = cur.subj[code] || (cur.subj[code] = { done: {}, star: {}, cfg: null });
        Object.entries(sd.done || {}).forEach(([qid, r]) => { if (!t.done[qid] || (r.ts || 0) > (t.done[qid].ts || 0)) t.done[qid] = r; });
        Object.assign(t.star, sd.star || {});
      });
      const ids = new Set(cur.sessions.map(s => s.id)); (inc.sessions || []).forEach(s => { if (!ids.has(s.id)) cur.sessions.push(s); });
      cur.sessions.sort((a, b) => b.ts - a.ts); DB.set('p:' + id, cur);
    });
    PROFILE = DB.get('cur') ? DB.get('p:' + DB.get('cur')) : null; Object.keys(bankCache).forEach(k => delete bankCache[k]);
    toast('Đã nhập sao lưu'); render();
  } catch (e) { alertBox('Không nhập được', esc(e.message)); }
}

/* ============ sự kiện ============ */
const A = {
  home: () => go('#/home'),
  who: () => { ui.manage = false; go('#/'); },
  theme: () => {
    const de = document.documentElement, eff = de.dataset.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'), nt = eff === 'dark' ? 'light' : 'dark';
    de.dataset.theme = nt; try { localStorage.setItem('fe-theme', nt); } catch (_) {}
  },
  settings: () => openSettings(),
  manage: () => { ui.manage = !ui.manage; render(); },
  'pick-profile': el => { if (ui.manage) return; PROFILE = DB.get('p:' + el.dataset.id); DB.set('cur', PROFILE.id); PROFILE.settings = PROFILE.settings || { vi: true }; go('#/home'); },
  'new-profile': async () => {
    const n = await askName('Tên của bạn là gì?'); if (!n) return;
    if (listProfiles().some(p => p.name.toLowerCase() === n.toLowerCase())) return toast('Tên này đã có rồi');
    createProfile(n); render();
  },
  'rename-profile': async el => {
    const p = DB.get('p:' + el.dataset.id), n = await askName('Đổi tên', p.name); if (!n) return;
    p.name = n; DB.set('p:' + p.id, p); render();
  },
  'del-profile': async el => {
    const p = DB.get('p:' + el.dataset.id);
    if (!await confirmBox('Xoá hồ sơ?', `Xoá <b>${esc(p.name)}</b> cùng toàn bộ tiến độ và lịch sử? Không thể hoàn tác.`, 'Xoá', true)) return;
    DB.del('p:' + p.id); DB.set('profiles', DB.get('profiles', []).filter(i => i !== p.id)); if (DB.get('cur') === p.id) { DB.del('cur'); PROFILE = null; } render();
  },
  'open-subject': el => go('#/s/' + el.dataset.code),
  'import-bank': el => importBank(el.dataset.code),
  'reset-bank': async el => { if (await confirmBox('Về ngân hàng gốc?', 'Xoá các câu đã nhập thêm, chỉ giữ ngân hàng có sẵn.', 'Đồng ý', true)) { DB.del('bank:' + el.dataset.code); delete bankCache[el.dataset.code]; render(); } },
  'reset-progress': async el => {
    if (!await confirmBox('Xoá tiến độ?', `Xoá toàn bộ câu đã làm, câu sai, đánh dấu của <b>${el.dataset.code}</b> cho ${esc(PROFILE.name)}? (Lịch sử phiên được giữ lại.)`, 'Xoá', true)) return;
    PROFILE.subj[el.dataset.code] = { done: {}, star: {}, cfg: null }; save(); render();
  },
  preset: el => {
    const c = el.dataset.code || route().arg, S = SUBJ[c], p = { def: { n: S.n, min: S.min }, mini: { n: 20, min: 20 }, quick: { n: 10, min: 0 } }[el.dataset.p];
    setCfg(c, p); render(true);
  },
  'cfg-src': el => { setCfg(route().arg, { src: el.dataset.v }); render(true); },
  'cfg-topic': el => {
    const c = route().arg, cur = getCfg(c).topics.slice();
    if (el.dataset.i === 'all') cur.length = 0; else { const i = +el.dataset.i, k = cur.indexOf(i); k < 0 ? cur.push(i) : cur.splice(k, 1); }
    setCfg(c, { topics: cur }); render(true);
  },
  start: () => startFromCfg(route().arg),
  'start-src': el => startFromCfg(route().arg, el.dataset.src),
  'start-mock': el => {
    const code = route().arg, b = getBank(code), m = b.mocks[+el.dataset.i], cfg = getCfg(code);
    startSession(code, m.name, 'mock:' + m.name, m.ids.map(id => b.idx.get(id)).filter(Boolean), { ...cfg, min: SUBJ[code].min });
  },
  resume: () => go('#/exam'),
  'open-result': el => go('#/result/' + el.dataset.id),
  rf: el => { ui.rf = el.dataset.v; render(true); },
  'redo-wrong': el => {
    const S = PROFILE.sessions.find(s => s.id === el.dataset.id), b = getBank(S.subj), cfg = getCfg(S.subj);
    startSession(S.subj, 'Làm lại câu sai · Đề #{n}', 'custom', S.items.filter(i => i.ok !== true).map(i => b.idx.get(i.id)), { ...cfg, min: 0 });
  },
  pick: el => pick(el.dataset.k),
  'confirm-multi': confirmMulti,
  next: () => nav(PROFILE.active.i + 1),
  prev: () => nav(PROFILE.active.i - 1),
  jump: el => nav(+el.dataset.i),
  flag: () => { const [, it] = curItem(); it.flag = it.flag ? 0 : 1; save(); render(true); },
  star: el => {
    const [code, id] = el.dataset.key ? splitKey(el.dataset.key) : [PROFILE.active.subj, curItem()[1].id], d = subjData(code);
    d.star[id] ? delete d.star[id] : d.star[id] = 1; save(); render(true);
  },
  'toggle-vi': () => { PROFILE.settings.vi = !PROFILE.settings.vi; save(); render(true); },
  submit: submitExam,
  'leave-exam': () => { save(); go('#/s/' + PROFILE.active.subj); },
  ai: el => aiExplain(el.dataset.key, false),
  'ai-regen': async el => { if (await confirmBox('Tạo lại giải thích?', 'Giải thích mới sẽ <b>thay thế</b> bản đã lưu cho tất cả mọi người dùng chung.', 'Tạo lại')) aiExplain(el.dataset.key, true); },
  translate: el => aiTranslate(el.dataset.key),
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const f = A[el.dataset.act]; if (f) { e.preventDefault(); f(el, e); }
});
document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.cfg; if (!k || !PROFILE) return;
  const code = route().arg, t = e.target;
  if (t.type === 'checkbox') setCfg(code, { [k]: t.checked });
  else { const v = Math.max(k === 'n' ? 1 : 0, Math.min(k === 'n' ? 500 : 600, parseInt(t.value, 10) || 0)); t.value = v; setCfg(code, { [k]: v }); }
  refreshSummary(code);
});
document.addEventListener('keydown', e => {
  if (e.target.matches && e.target.matches('[role=button]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); return e.target.click(); }
  if (e.target.matches('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (route().name !== 'exam' || !PROFILE || !PROFILE.active || $('.ov')) return;
  const k = e.key.toLowerCase(), [, it] = curItem();
  if (/^[1-8]$/.test(k)) { const kk = it.ord[+k - 1]; if (kk) pick(kk); }
  else if (k === 'arrowright' || k === 'n') nav(PROFILE.active.i + 1);
  else if (k === 'arrowleft' || k === 'p') nav(PROFILE.active.i - 1);
  else if (k === 'v') A['toggle-vi']();
  else if (k === 'm') A.flag();
});
addEventListener('hashchange', () => render());
addEventListener('beforeunload', () => { if (PROFILE && PROFILE.active) save(); DB.flush(); });

/* ============ khởi động ============ */
(async () => {
  await DB.init();
  const cur = DB.get('cur'); PROFILE = cur ? DB.get('p:' + cur) || null : null;
  loadShared().then(() => { if (route().name !== 'who') render(true); }); // giải thích dùng chung (chạy nền)
  if (PROFILE) PROFILE.settings = PROFILE.settings || { vi: true };
  if (!location.hash || location.hash === '#') location.hash = '#/'; // luôn mở màn chọn người trước
  render();
})();
})();
