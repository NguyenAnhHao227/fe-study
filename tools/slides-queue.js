#!/usr/bin/env node
/* Trích câu hỏi từ ẢNH CHỤP SLIDE (Google Slides: câu hỏi nằm trong ảnh, đáp án + bản dịch + giải thích nằm trong khung ghi chú)
 * bằng AI có sẵn (ChatGPT / Gemini / Antigravity… loại truy cập được thư mục), rồi NHẬP vào ngân hàng câu hỏi của môn.
 *
 *   node tools/slides-queue.js prepare --images "<thư mục ảnh>" [--code SSA101] [--size 10] [--force]   chia ảnh thành lô, tạo slides-extract/
 *   node tools/slides-queue.js import [--check]                                                         nhập kết quả (slides-extract/done/) vào data/<môn>.js
 *   node tools/slides-queue.js status | prompt [--from N --to M]   (prompt có --from/--to: tạo tệp giao việc riêng cho khoảng lô N..M)
 *
 * Quy tắc nhập (an toàn, chạy lại nhiều lần được):
 *  - Câu đã có trong ngân hàng (so khớp theo nội dung câu hỏi): CHỈ điền phần còn trống (bản dịch tv, giải thích e/ev). KHÔNG đổi đáp án.
 *    Nếu đáp án trong slide khác đáp án trong ngân hàng -> không điền gì, ghi vào slides-extract/flags.txt cho người xem lại.
 *  - Câu chưa có trong ngân hàng: thêm mới (mã nối tiếp), đáp án lấy từ slide.
 *  - Câu có chữ "[?]" (AI không đọc rõ) hoặc thiếu đáp án: KHÔNG nhập, liệt kê để làm lại.
 *  - Trước khi ghi thật, tự sao lưu data/<môn>.js vào backups/.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const [cmd] = process.argv.slice(2);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const QDIR = path.resolve(root, String(arg('dir', 'slides-extract')));
const CODE = String(arg('code', 'SSA101')).toUpperCase();
const SIZE = Math.max(3, Math.min(25, parseInt(arg('size', '10'), 10) || 10));
const CHECK = !!arg('check', false), FORCE = !!arg('force', false);
const L = 'ABCDEFGH';

const norm = s => String(s || '').toLowerCase().replace(/[‘’´`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').replace(/[\s.:?!;,]+$/, '').trim();
const manifestPath = () => path.join(QDIR, 'manifest.json');
const loadManifest = () => { if (!fs.existsSync(manifestPath())) { console.error('Chưa có manifest.json: hãy chạy prepare trước.'); process.exit(1); } return JSON.parse(fs.readFileSync(manifestPath(), 'utf8')); };

/* ---- đọc kết quả của AI ---- */
function parseOut(text) {
  const items = new Map();
  const parts = text.replace(/\r/g, '').split(/^\s*\*{0,2}\[(slide_\d+\.\w+)\]\*{0,2}\s*$/mi);
  for (let i = 1; i < parts.length; i += 2) {
    const it = { file: parts[i].toLowerCase(), q: '', opts: [], key: '', vi: '', e: '', v: '', skip: '' };
    let cur = null;
    for (const line of parts[i + 1].split('\n')) {
      // đáp án chỉ xuất hiện giữa dòng Q: và dòng KEY:, và phải đúng thứ tự A, B, C… (để dòng "E:" giải thích không bị nhầm là đáp án E)
      let o = (cur === 'q' || cur === 'opt') && line.match(/^\s*\*{0,2}([A-H])\*{0,2}\s*[:.)]\*{0,2}\s?(.*)$/);
      if (o && o[1] !== L[it.opts.length]) o = null;
      const m = !o && line.match(/^\s*\*{0,2}(Q|KEY|VI|E|V|SKIP)\*{0,2}\s*[:：]\*{0,2}\s?(.*)$/i);
      if (o) { it.opts.push([o[1], o[2].trim()]); cur = 'opt'; }
      else if (m) { cur = m[1].toLowerCase(); if (cur === 'key') it.key = m[2].trim(); else it[cur] = m[2].trim(); }
      else if (line.trim() && cur) { if (cur === 'opt') it.opts[it.opts.length - 1][1] += ' ' + line.trim(); else if (cur !== 'key') it[cur] += ' ' + line.trim(); }
    }
    items.set(it.file, it);
  }
  return items;
}
function keyLetters(k) { const m = String(k).match(/^\s*([A-H](?:\s*(?:,|&|and|và)?\s*[A-H])*)\b/i); return m ? [...new Set(m[1].toUpperCase().match(/[A-H]/g))].sort() : []; }

/* ---- đọc / ghi ngân hàng ---- */
function loadBank() {
  const file = fs.readdirSync(path.join(root, 'data')).map(f => path.join(root, 'data', f)).find(f => /\.js$/.test(f) && new RegExp('window\\.BANKS\\.' + CODE + '\\s*=').test(fs.readFileSync(f, 'utf8')));
  if (!file) { console.error('Không tìm thấy ngân hàng ' + CODE + ' trong data/'); process.exit(1); }
  const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  return { file, bank: ctx.window.BANKS[CODE] };
}
function saveBank({ file, bank }) {
  const bk = path.join(root, 'backups', 'slides-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(bk, { recursive: true }); fs.copyFileSync(file, path.join(bk, path.basename(file)));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, `window.BANKS = window.BANKS || {};\nwindow.BANKS.${CODE} = ${JSON.stringify(bank)};\n`);
  fs.renameSync(tmp, file);
  console.log('Đã sao lưu bản cũ vào ' + path.relative(root, bk));
}
const realExpl = e => !!e && e.length >= 20 && !/^Đề (thi|giảng viên)/i.test(e);
const correctTexts = q => q.a.split('').map(k => norm((q.o.find(o => o[0] === k) || [])[1])).filter(Boolean).sort();

/* ---- prepare ---- */
const AGENT_PROMPT = (M, range) => {
  const todo = path.join(QDIR, 'todo'), doneDir = path.join(QDIR, 'done');
  return `BẠN ĐƯỢC GIAO TOÀN QUYỀN HOÀN THÀNH VIỆC DƯỚI ĐÂY TRONG MỘT LẦN CHẠY, KHÔNG HỎI LẠI NGƯỜI DÙNG.${range ? `
PHẠM VI CỦA BẠN: CHỈ làm các lô từ batch-${String(range[0]).padStart(3, '0')} đến batch-${String(range[1]).padStart(3, '0')}. Tuyệt đối KHÔNG đụng tới lô ngoài khoảng này (có AI khác đang làm các lô còn lại cùng lúc).` : ''}
Làm liên tục cho đến khi XONG HẾT các lô của bạn. Chỉ dừng sớm nếu thật sự hết hạn mức/ngữ cảnh; khi đó vẫn làm bước kiểm tra cuối cho phần đã xong.

NHIỆM VỤ: Có ${M.total} ảnh chụp màn hình Google Slides (mỗi ảnh một slide). Mỗi ảnh gồm:
 (1) Khung slide: một câu hỏi TIẾNG ANH và các đáp án A, B, C, D (nằm trong ảnh).
 (2) Khung GHI CHÚ ở dưới slide, thường có dạng:
        C
        <bản dịch tiếng Việt của câu hỏi>
        Đáp án đúng: C. Verifying sources
        Giải thích: <giải thích bằng tiếng Việt>
     Chữ cái ở dòng đầu (hoặc sau "Đáp án đúng:") là ĐÁP ÁN ĐÚNG.
Hãy ĐỌC từng ảnh (dùng khả năng xem ảnh) và chép nội dung thành văn bản theo định dạng bên dưới.

ĐƯỜNG DẪN (đầy đủ):
- Thư mục ảnh (CHỈ ĐỌC):    ${M.images}
- Danh sách ảnh từng lô (CHỈ ĐỌC):  ${todo}   gồm batch-001.txt, batch-002.txt, ... (mỗi tệp liệt kê tên các ảnh của lô)
- Nơi ghi kết quả (GHI):     ${doneDir}   mỗi tệp kết quả CÙNG TÊN với tệp danh sách, ví dụ  ${path.join(doneDir, 'batch-001.txt')}
- Thư mục dự án (để chạy lệnh kiểm tra):  ${root}

CÁCH LÀM:
1. Liệt kê todo và done. Bỏ qua những tệp batch ĐÃ có trong done (để làm tiếp nếu lần trước bị gián đoạn).
2. Với MỖI tệp còn lại, theo thứ tự batch-001, batch-002, ...: mở tệp danh sách -> xem từng ảnh trong lô -> ghi kết quả NGAY vào done (UTF-8) cùng tên tệp. Đừng gom nhiều lô rồi mới ghi.
3. Trước khi sang lô tiếp theo, tự kiểm tra tệp vừa ghi: MỌI ảnh trong lô đều có một mục (hoặc là câu hỏi, hoặc là SKIP); đáp án KEY phải lấy từ ghi chú. Sai thì sửa ngay.
4. Khi xong hết (hoặc hết hạn mức), chạy đúng lệnh sau (CHỈ ĐỌC, không ghi gì):
       cd "${root}"
       node tools/slides-queue.js import --check
   Lô nào báo thiếu ảnh/thiếu đáp án thì mở lại lô đó, xem lại ảnh, bổ sung rồi chạy lại lệnh kiểm tra.
5. Báo cáo ngắn (tiếng Việt): đã làm bao nhiêu lô, còn bao nhiêu, kết quả lệnh kiểm tra.

ĐỊNH DẠNG ĐẦU RA (mỗi ảnh MỘT mục, các mục cách nhau một dòng trống; nhãn giữ nguyên; mỗi nhãn MỘT đoạn liền):

[slide_007.jpg]
Q: <câu hỏi tiếng Anh, chép nguyên văn từ slide>
A: <đáp án A>
B: <đáp án B>
C: <đáp án C>
D: <đáp án D>
KEY: C
VI: <bản dịch tiếng Việt của câu hỏi, chép nguyên văn từ ghi chú>
E: <giải thích bằng TIẾNG ANH, 1-2 câu, dịch từ phần "Giải thích" trong ghi chú>
V: <phần "Giải thích" tiếng Việt, chép nguyên văn từ ghi chú>

Ví dụ thật:
[slide_001.jpg]
Q: Which is a characteristic of analytical thinking?
A: Guessing outcomes
B: Ignoring evidence
C: Verifying sources
D: Avoiding comparison
KEY: C
VI: Đặc điểm nào là một phần của tư duy phân tích?
E: Analytical thinking requires checking and verifying information sources before drawing conclusions.
V: Tư duy phân tích yêu cầu kiểm tra và xác minh nguồn thông tin trước khi đưa ra kết luận.

Slide KHÔNG phải câu hỏi (quảng cáo, thông báo, tiêu đề, "Update đáp án slide"...) thì ghi:
[slide_005.jpg]
SKIP: <lý do ngắn>

QUY TẮC:
- Chép NGUYÊN VĂN câu hỏi và đáp án tiếng Anh trong slide. Không sửa chính tả, không diễn đạt lại, không bỏ chữ.
- ĐÁP ÁN lấy từ ghi chú. TUYỆT ĐỐI không tự giải bài. Nhiều đáp án thì ghi "KEY: A, C". Nếu ghi chú trống/không đọc được: ghi "KEY: ?".
- Bỏ qua logo/hình mờ (FORU, "Hoàng Hoàng Buôn Source"), thanh công cụ, danh sách slide bên trái.
- Chữ nào quá mờ, không chắc chắn: ghi [?] ngay tại chỗ đó. Đừng đoán.
- Nếu ghi chú không có bản dịch câu hỏi thì bỏ dòng VI; nếu không có giải thích thì bỏ hai dòng E và V.
- Không dùng markdown, không dùng dấu ba gạch ngược, không thêm bớt mục, không đổi tên ảnh.

TUYỆT ĐỐI KHÔNG:
- sửa hoặc xoá bất kỳ ảnh nào, hay tệp trong todo;
- sửa bất kỳ tệp nào ngoài thư mục done;
- chạy lệnh "import" khi không có --check (người quản lý sẽ tự nhập sau khi xem lại);
- chạy git (commit, push...).
`;
};
function writePrompt() { const M = loadManifest(); fs.writeFileSync(path.join(root, 'GIAO-VIEC-SLIDES.txt'), AGENT_PROMPT(M)); fs.writeFileSync(path.join(QDIR, 'GIAO-VIEC.txt'), AGENT_PROMPT(M)); }
function writeRangePrompt(a, b) { const M = loadManifest(), f = path.join(root, `GIAO-VIEC-SLIDES-${a}-${b}.txt`); fs.writeFileSync(f, AGENT_PROMPT(M, [a, b])); return f; }

function doPrepare() {
  const dir = arg('images');
  if (!dir || dir === true) { console.error('Cần --images "<thư mục ảnh>"'); process.exit(1); }
  const imgDir = path.resolve(String(dir));
  const files = fs.readdirSync(imgDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  if (!files.length) { console.error('Không thấy ảnh trong ' + imgDir); process.exit(1); }
  fs.mkdirSync(QDIR, { recursive: true });
  const todoDir = path.join(QDIR, 'todo'), doneDir = path.join(QDIR, 'done');
  if (fs.existsSync(todoDir) && fs.readdirSync(todoDir).length) {
    if (!FORCE) { console.error('Đã có hàng chờ trong ' + path.relative(root, QDIR) + '. Dùng --force để tạo mới (hàng cũ được cất vào old-…).'); process.exit(1); }
    const old = path.join(QDIR, 'old-' + new Date().toISOString().replace(/[:.]/g, '-')); fs.mkdirSync(old, { recursive: true });
    for (const n of ['todo', 'done', 'manifest.json']) if (fs.existsSync(path.join(QDIR, n))) fs.renameSync(path.join(QDIR, n), path.join(old, n));
  }
  fs.mkdirSync(todoDir, { recursive: true }); fs.mkdirSync(doneDir, { recursive: true });
  const batches = [];
  for (let i = 0; i < files.length; i += SIZE) {
    const list = files.slice(i, i + SIZE), name = 'batch-' + String(batches.length + 1).padStart(3, '0');
    fs.writeFileSync(path.join(todoDir, name + '.txt'), list.join('\n') + '\n');
    batches.push({ name, files: list.map(f => f.toLowerCase()) });
  }
  fs.writeFileSync(manifestPath(), JSON.stringify({ created: new Date().toISOString(), code: CODE, images: imgDir, size: SIZE, total: files.length, batches }, null, 1));
  writePrompt();
  console.log(`Đã chia ${files.length} ảnh thành ${batches.length} lô (mỗi lô ${SIZE} ảnh) vào ${path.relative(root, todoDir)}`);
  console.log('Tiếp theo: đưa AI (loại truy cập được thư mục) câu lệnh:\n  Đọc và làm theo đúng tệp ' + path.join(root, 'GIAO-VIEC-SLIDES.txt'));
}

/* ---- import ---- */
function doImport() {
  const M = loadManifest(), B = loadBank(), bank = B.bank;
  const byNorm = new Map(); for (const q of bank.questions) { const k = norm(q.t); (byNorm.get(k) || byNorm.set(k, []).get(k)).push(q); }
  let nextNo = Math.max(0, ...bank.questions.map(q => +(String(q.id).match(/(\d+)$/) || [0, 0])[1])) + 1;
  const st = { batchesIn: 0, wait: 0, files: 0, skip: 0, missing: [], bad: [], unread: [], filledE: 0, filledTv: 0, same: 0, added: 0, conflicts: [] };
  const added = [];
  for (const b of M.batches) {
    const f = path.join(QDIR, 'done', b.name + '.txt');
    if (!fs.existsSync(f)) { st.wait++; continue; }
    st.batchesIn++;
    const out = parseOut(fs.readFileSync(f, 'utf8'));
    for (const file of b.files) {
      const it = out.get(file);
      if (!it) { st.missing.push(file); continue; }
      st.files++;
      if (it.skip) { st.skip++; continue; }
      const letters = it.opts.map(o => o[0]), keys = keyLetters(it.key);
      const tag = `${file}`;
      if (!it.q || it.opts.length < 2) { st.bad.push(`${tag} (thiếu câu hỏi hoặc đáp án)`); continue; }
      if (JSON.stringify(letters) !== JSON.stringify([...L].slice(0, letters.length))) { st.bad.push(`${tag} (nhãn đáp án không liền A, B, C…)`); continue; }
      if (!keys.length || keys.some(k => !letters.includes(k))) { st.bad.push(`${tag} (không có đáp án KEY hợp lệ: "${it.key}")`); continue; }
      if (/\[\?\]/.test([it.q, ...it.opts.map(o => o[1])].join(' '))) { st.unread.push(`${tag} (có chữ [?] không đọc rõ)`); continue; }
      if ((it.e && !it.v) || (!it.e && it.v)) { st.bad.push(`${tag} (chỉ có một trong E/V)`); continue; }
      const slideKeyTexts = keys.map(k => norm(it.opts[L.indexOf(k)][1])).sort();
      let q = null;
      const cands = byNorm.get(norm(it.q));
      if (cands) q = cands.length === 1 ? cands[0] : (cands.find(c => JSON.stringify(c.o.map(o => norm(o[1])).sort()) === JSON.stringify(it.opts.map(o => norm(o[1])).sort())) || cands[0]);
      if (!q) { // câu mới
        const nq = { id: `${CODE}_Q${String(nextNo++).padStart(3, '0')}`, t: it.q, o: it.opts.map(o => [o[0], o[1], '']), a: keys.join(''), s: 0 };
        if (it.vi) nq.tv = it.vi; if (it.e && it.v) { nq.e = it.e; nq.ev = it.v; }
        if (!CHECK) { bank.questions.push(nq); byNorm.set(norm(nq.t), [nq]); }
        added.push(`${tag} -> ${nq.id}`); st.added++; continue;
      }
      if (JSON.stringify(correctTexts(q)) !== JSON.stringify(slideKeyTexts)) {
        st.conflicts.push(`${q.id} (${tag})\n   Đề: ${q.t.replace(/\s+/g, ' ').slice(0, 140)}\n   Ngân hàng đang để: ${q.a} = ${correctTexts(q).join(' | ')}\n   Slide ghi: ${keys.join('')} = ${slideKeyTexts.join(' | ')}`);
        continue;
      }
      let did = false;
      if (it.vi && !q.tv) { if (!CHECK) q.tv = it.vi; st.filledTv++; did = true; }
      if (it.e && it.v && !realExpl(q.e)) { if (!CHECK) { q.e = it.e; q.ev = it.v; } st.filledE++; did = true; }
      if (!did) st.same++;
    }
  }
  console.log(`Lô đã có kết quả: ${st.batchesIn}/${M.batches.length}${st.wait ? ` (còn ${st.wait} lô chưa có trong done/)` : ''} | ảnh đã xử lý: ${st.files} (trong đó bỏ qua vì không phải câu hỏi: ${st.skip})`);
  console.log(`${CHECK ? 'Sẽ' : 'Đã'} điền: bản dịch ${st.filledTv}, giải thích ${st.filledE} | câu mới thêm: ${st.added} | đã đủ sẵn: ${st.same}`);
  console.log(`Chưa đạt: thiếu ảnh ${st.missing.length}, lỗi định dạng ${st.bad.length}, chữ không rõ ${st.unread.length} | đáp án lệch với ngân hàng: ${st.conflicts.length}`);
  const show = (t, a) => { if (a.length) { console.log('\n' + t); a.slice(0, 10).forEach(x => console.log('  - ' + x)); if (a.length > 10) console.log(`  … và ${a.length - 10} mục nữa`); } };
  show('ẢNH CHƯA CÓ MỤC TRONG KẾT QUẢ (các lô đã làm):', st.missing); show('LỖI ĐỊNH DẠNG / THIẾU ĐÁP ÁN:', st.bad); show('CHỮ KHÔNG ĐỌC RÕ ([?]):', st.unread);
  if (added.length) show('CÂU MỚI (chưa có trong ngân hàng):', added);
  if (st.conflicts.length) { console.log('\nĐÁP ÁN SLIDE KHÁC NGÂN HÀNG (không ghi gì, cần người xem lại):'); st.conflicts.slice(0, 8).forEach(x => console.log(' • ' + x)); if (st.conflicts.length > 8) console.log(`  … và ${st.conflicts.length - 8} câu nữa`); }
  const report = [...st.conflicts.map(x => 'LỆCH ĐÁP ÁN: ' + x), ...st.bad.map(x => 'LỖI: ' + x), ...st.unread.map(x => 'KHÔNG RÕ: ' + x), ...added.map(x => 'CÂU MỚI: ' + x)];
  if (CHECK) return console.log('\n(--check: chưa ghi gì. Bỏ --check để nhập thật.)');
  fs.writeFileSync(path.join(QDIR, 'flags.txt'), report.join('\n\n') + '\n');
  saveBank(B);
  console.log('Đã ghi vào ' + path.relative(root, B.file) + '. Danh sách cần xem lại: ' + path.relative(root, path.join(QDIR, 'flags.txt')));
}

function doStatus() {
  if (!fs.existsSync(manifestPath())) return console.log('Chưa chuẩn bị hàng chờ (chạy prepare).');
  const M = loadManifest(), have = M.batches.filter(b => fs.existsSync(path.join(QDIR, 'done', b.name + '.txt'))).length;
  console.log(`Hàng chờ: ${M.batches.length} lô (${M.total} ảnh), đã có kết quả ${have}, chưa có ${M.batches.length - have}.`);
}
function doPrompt() {
  const a = parseInt(arg('from', ''), 10), b = parseInt(arg('to', ''), 10);
  if (a && b) return console.log('Đã tạo: ' + writeRangePrompt(a, b));
  writePrompt(); console.log('Đã tạo lại: ' + path.join(root, 'GIAO-VIEC-SLIDES.txt'));
}

({ prepare: doPrepare, import: doImport, status: doStatus, prompt: doPrompt }[cmd] || (() => { console.log('Dùng: prepare --images "<thư mục>" | import [--check] | status | prompt (xem hướng dẫn ở đầu tệp)'); process.exit(1); }))();
