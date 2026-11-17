#!/usr/bin/env node
/* Viết sẵn LỜI GIẢI THÍCH bằng gói có sẵn (ChatGPT Plus, Antigravity, Codex…) thay vì trả token API: XUẤT → AI viết → NHẬP lại.
 * Giải thích được ghi thẳng vào câu hỏi (q.e tiếng Anh, q.ev tiếng Việt) nên mọi người xem ngay, không tốn lượt AI.
 *
 *   node tools/explain-queue.js export [--size 15] [--only PRF192] [--skip CSI106] [--force]   xuất hàng chờ vào explain-queue/todo/
 *   node tools/explain-queue.js import [--check]                                                nhập kết quả từ explain-queue/done/ vào data/*.js
 *   node tools/explain-queue.js status | prompt
 *
 * Mặc định chỉ xuất ĐỀ CỦA GIẢNG VIÊN (câu có g:'gv') còn thiếu giải thích. Muốn môn khác: --only <MÃ_MÔN>.
 * Import chỉ điền câu chưa có giải thích thật (không ghi đè), chạy lại nhiều lần được.
 * Nếu AI cho rằng đáp án đề cho là sai, nó ghi dòng FLAG: … → câu đó KHÔNG được ghi, mà được liệt kê trong explain-queue/flags.txt để người xem lại.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const [cmd] = process.argv.slice(2);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const QDIR = path.resolve(root, String(arg('dir', 'explain-queue')));
const SIZE = Math.max(5, Math.min(40, parseInt(arg('size', '15'), 10) || 15));
const ONLY = arg('only') && arg('only') !== true ? String(arg('only')).toUpperCase() : null;
const SKIP = new Set((arg('skip', '') === true ? '' : String(arg('skip', ''))).toUpperCase().split(',').filter(Boolean));
const CHECK = !!arg('check', false), FORCE = !!arg('force', false);

/* ---- đọc / ghi ngân hàng ---- */
const banks = {};
for (const f of fs.readdirSync(path.join(root, 'data'))) {
  if (!/\.js$/.test(f) || f === 'explanations.js' || f === 'changelog.js') continue;
  const ctx = { window: {} }; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'data', f), 'utf8'), ctx);
  for (const [code, b] of Object.entries(ctx.window.BANKS || {})) banks[code] = { file: path.join(root, 'data', f), bank: b, byId: new Map(b.questions.map(q => [q.id, q])) };
}
function saveBank(code) {
  const { file, bank } = banks[code], tmp = file + '.tmp';
  fs.writeFileSync(tmp, `window.BANKS = window.BANKS || {};\nwindow.BANKS.${code} = ${JSON.stringify(bank)};\n`);
  fs.renameSync(tmp, file);
}

// "giải thích thật": đủ dài và không phải ghi chú nguồn kiểu "Đề thi CEA201 / CSI104 - Câu 1"
const realExpl = e => !!e && e.length >= 40 && !/^Đề (thi|giảng viên)/i.test(e);
const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function pendingJobs() {
  const jobs = [];
  for (const [code, { bank }] of Object.entries(banks)) {
    if (SKIP.has(code) || (ONLY && code !== ONLY)) continue;
    for (const q of bank.questions) {
      if (!ONLY && q.g !== 'gv') continue;       // mặc định: chỉ đề giảng viên
      if (realExpl(q.e)) continue;
      jobs.push({ code, q });
    }
  }
  return jobs;
}

const itemText = (j, n) => {
  const q = j.q, ans = q.a.split('');
  return `[Q${n}]\nQ: ${q.t}\n${q.o.map(o => `${o[0]}: ${o[1]}`).join('\n')}\nKEY: ${q.a}   (${ans.map(k => (q.o.find(o => o[0] === k) || [])[1]).join(' | ')})`;
};

/* ---- đọc kết quả của AI ---- */
function parseOut(text, n) {
  const res = Array.from({ length: n }, () => ({ e: '', v: '', flag: '' }));
  const blocks = text.replace(/\r/g, '').split(/^\s*\*{0,2}\[Q(\d+)\]\*{0,2}\s*$/m);
  for (let i = 1; i < blocks.length; i += 2) {
    const k = +blocks[i] - 1; if (k < 0 || k >= n) continue;
    let cur = null;
    for (const line of blocks[i + 1].split('\n')) {
      const m = line.match(/^\s*\*{0,2}(E|V|FLAG)\*{0,2}\s*[:：]\*{0,2}\s?(.*)$/i);
      if (m) { cur = m[1].toLowerCase(); res[k][cur] = m[2].trim(); }
      else if (cur && line.trim()) res[k][cur] += ' ' + line.trim();
    }
  }
  return res;
}

const AGENT_PROMPT = () => {
  const todo = path.join(QDIR, 'todo'), doneDir = path.join(QDIR, 'done');
  return `NHIỆM VỤ: Viết lời giải thích ngắn cho các câu hỏi thi trắc nghiệm (môn Kiến trúc & Tổ chức máy tính / lập trình...), mỗi câu gồm 1 đoạn tiếng Anh và 1 đoạn tiếng Việt. Ghi kết quả ra tệp.

ĐƯỜNG DẪN (đầy đủ):
- Tệp câu hỏi (CHỈ ĐỌC):  ${todo}   gồm batch-001.txt, batch-002.txt, ...
- Nơi ghi kết quả (GHI):    ${doneDir}   mỗi tệp kết quả CÙNG TÊN với tệp đầu vào, ví dụ  ${path.join(doneDir, 'batch-001.txt')}
- Thư mục dự án (để chạy lệnh kiểm tra ở bước 4):  ${root}

CÁCH LÀM:
1. Liệt kê todo và done. Bỏ qua những tệp batch ĐÃ có trong done (để làm tiếp nếu lần trước bị gián đoạn).
2. Với MỖI tệp còn lại, theo thứ tự batch-001, batch-002, ...: đọc -> viết giải thích theo QUY TẮC -> ghi NGAY vào done (UTF-8) cùng tên tệp. Đừng gom nhiều tệp rồi mới ghi. Thứ tự này là thứ tự ưu tiên; nếu sắp hết hạn mức thì dừng đúng sau khi ghi xong một tệp.
3. Trước khi sang tệp tiếp theo, tự kiểm tra tệp vừa ghi: có đúng cùng số mục "[Qn]" như đầu vào; mỗi mục có dòng E: và V: (hoặc FLAG:); giải thích khớp với đáp án KEY. Sai thì sửa ngay.
4. Khi xong hết (hoặc hết hạn mức), chạy đúng lệnh sau (CHỈ ĐỌC, không ghi gì):
       cd "${root}"
       node tools/explain-queue.js import --check
   Mục nào báo thiếu thì mở lại tệp batch tương ứng và bổ sung, rồi chạy lại lệnh kiểm tra.
5. Báo cáo ngắn: đã ghi bao nhiêu tệp, còn bao nhiêu chưa làm, kết quả lệnh kiểm tra, và các câu bạn đã đánh FLAG.

ĐỊNH DẠNG ĐẦU VÀO (mỗi mục):
[Q1]
Q: <đề bài>
A: <đáp án A>
B: <đáp án B>
...
KEY: B   (<nội dung đáp án đúng>)

ĐỊNH DẠNG ĐẦU RA (đúng nhãn, mỗi nhãn MỘT đoạn liền, không xuống dòng giữa đoạn, không dòng trống trong mục):
[Q1]
E: <giải thích tiếng Anh>
V: <giải thích tiếng Việt, dịch sát nghĩa phần E>

Ví dụ:
[Q1]
E: The IR (Instruction Register) holds the instruction that was most recently fetched and is being executed. The PC holds the address of the next instruction, and the MAR holds a memory address, not an instruction.
V: IR (thanh ghi lệnh) giữ lệnh vừa được nạp và đang được thực thi. PC giữ địa chỉ của lệnh kế tiếp, còn MAR giữ địa chỉ bộ nhớ chứ không phải lệnh.

QUY TẮC VIẾT GIẢI THÍCH:
- TIN vào đáp án KEY (đã được giảng viên đánh dấu). Giải thích phải dẫn tới đúng đáp án đó.
- 2 đến 4 câu: nêu lý do đáp án KEY đúng, và nói ngắn vì sao phương án gây nhầm lẫn nhất sai (nếu có).
- Câu về đại số Boolean, rút gọn, đổi SOP/POS, K-map: viết ngắn gọn các bước biến đổi chính hoặc kết quả đối chiếu; giữ nguyên ký hiệu như A', AB + C, (A + B')(C).
- Câu tính toán (cache, bit địa chỉ, Hamming, tốc độ...): nêu công thức và phép tính chính.
- Câu Đúng/Sai: nói vì sao phát biểu đúng hoặc sai.
- TRÁNH nhắc tới chữ cái đáp án (A, B, C...) vì thứ tự đáp án bị xáo khi làm bài. Hãy gọi đáp án theo nội dung. Nếu thật sự cần, viết đúng dạng "Option B" (tiếng Anh) hoặc "Đáp án B" (tiếng Việt).
- Không dùng markdown, không dùng dấu ba gạch ngược, không đánh số lại mục, không thêm hay bỏ mục.
- Phần V dịch tự nhiên, đúng thuật ngữ; thuật ngữ thông dụng có thể để nguyên tiếng Anh hoặc ghi trong ngoặc.

TRƯỜNG HỢP ĐÁP ÁN KEY RÕ RÀNG SAI (hiếm; chỉ khi bạn chắc chắn, ví dụ phép tính ra kết quả khác hẳn):
- KHÔNG viết E:/V: cho mục đó. Thay vào đó viết:
[Qn]
FLAG: <lý do ngắn gọn, kèm đáp án bạn cho là đúng>
- Người quản lý sẽ xem lại các câu bị FLAG. Đừng lạm dụng: nếu chỉ hơi nghi ngờ thì vẫn viết giải thích theo KEY.

TUYỆT ĐỐI KHÔNG:
- sửa hoặc xoá tệp trong todo;
- sửa bất kỳ tệp nào ngoài thư mục done;
- chạy lệnh "import" khi không có --check;
- chạy git (commit, push...).
`;
};
function writePrompts() { fs.writeFileSync(path.join(QDIR, 'GIAO-VIEC.txt'), AGENT_PROMPT()); }

/* ---- export ---- */
function doExport() {
  const jobs = pendingJobs();
  if (!jobs.length) return console.log('Không còn câu nào cần viết giải thích.');
  const todoDir = path.join(QDIR, 'todo'), doneDir = path.join(QDIR, 'done'), manifest = path.join(QDIR, 'manifest.json');
  fs.mkdirSync(QDIR, { recursive: true });
  if (fs.existsSync(todoDir) && fs.readdirSync(todoDir).length) {
    if (!FORCE) { console.error('Đã có hàng chờ trong ' + path.relative(root, QDIR) + '. Hãy import kết quả trước, hoặc dùng --force để tạo mới (hàng cũ được cất vào thư mục old-…).'); process.exit(1); }
    const old = path.join(QDIR, 'old-' + new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(old, { recursive: true });
    for (const n of ['todo', 'done', 'manifest.json']) if (fs.existsSync(path.join(QDIR, n))) fs.renameSync(path.join(QDIR, n), path.join(old, n));
    console.log('Đã cất hàng cũ vào ' + path.relative(root, old));
  }
  fs.mkdirSync(todoDir, { recursive: true }); fs.mkdirSync(doneDir, { recursive: true });
  const batches = [];
  for (let i = 0; i < jobs.length; i += SIZE) {
    const list = jobs.slice(i, i + SIZE), name = 'batch-' + String(batches.length + 1).padStart(3, '0');
    fs.writeFileSync(path.join(todoDir, name + '.txt'), list.map((j, k) => itemText(j, k + 1)).join('\n\n') + '\n');
    batches.push({ name, items: list.map(j => ({ code: j.code, id: j.q.id })) });
  }
  fs.writeFileSync(manifest, JSON.stringify({ created: new Date().toISOString(), size: SIZE, batches }, null, 1));
  writePrompts();
  console.log(`Đã xuất ${jobs.length} câu thành ${batches.length} lô vào ${path.relative(root, QDIR)}${path.sep}todo`);
  console.log('Tiếp theo: đưa tệp ' + path.join(QDIR, 'GIAO-VIEC.txt') + ' cho Antigravity / Codex / ChatGPT (loại truy cập được thư mục).');
}

/* ---- import ---- */
function doImport() {
  const manifest = path.join(QDIR, 'manifest.json');
  if (!fs.existsSync(manifest)) { console.error('Chưa có manifest.json: hãy chạy export trước.'); process.exit(1); }
  const M = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  let batchesIn = 0, batchesWait = 0, ok = 0, skipped = 0, empty = 0, short = 0;
  const flags = [], bad = [], dirty = new Set();
  for (const b of M.batches) {
    const f = path.join(QDIR, 'done', b.name + '.txt');
    if (!fs.existsSync(f)) { batchesWait++; continue; }
    batchesIn++;
    const out = parseOut(fs.readFileSync(f, 'utf8'), b.items.length);
    b.items.forEach((spec, i) => {
      const r = out[i], B = banks[spec.code], q = B && B.byId.get(spec.id);
      if (!q) { empty++; return; }
      if (r.flag) { flags.push(`${spec.code}|${spec.id}\n   Đề: ${q.t.replace(/\s+/g, ' ').slice(0, 160)}\n   Đáp án đề cho: ${q.a}\n   AI nghi ngờ: ${r.flag}`); return; }
      if (!r.e || !r.v) { empty++; bad.push(`${spec.code}|${spec.id} (${!r.e && !r.v ? 'không có E/V' : !r.e ? 'thiếu E' : 'thiếu V'})`); return; }
      if (r.e.length < 25 || r.v.length < 25 || r.e.length > 1200 || r.v.length > 1400) { short++; bad.push(`${spec.code}|${spec.id} (độ dài bất thường: E ${r.e.length}, V ${r.v.length} ký tự)`); return; }
      if (realExpl(q.e)) { skipped++; return; }
      if (!CHECK) { q.e = r.e; q.ev = r.v; dirty.add(spec.code); }
      ok++;
    });
  }
  console.log(`Lô đã có kết quả: ${batchesIn}/${M.batches.length}${batchesWait ? ` (còn ${batchesWait} lô chưa có trong done/)` : ''}`);
  console.log(`Giải thích ${CHECK ? 'hợp lệ (chưa ghi, --check)' : 'đã điền vào dữ liệu'}: ${ok} | bỏ qua vì đã có: ${skipped} | thiếu/không đọc được: ${empty} | độ dài lạ: ${short} | AI đánh dấu nghi sai đáp án: ${flags.length}`);
  if (bad.length) { console.log('Chưa đạt (sẽ được xuất lại ở lần export sau):'); bad.slice(0, 12).forEach(x => console.log('  - ' + x)); if (bad.length > 12) console.log(`  … và ${bad.length - 12} câu nữa`); }
  if (flags.length) {
    console.log('\nCÂU BỊ ĐÁNH DẤU (cần người xem lại, KHÔNG được ghi giải thích):');
    flags.slice(0, 10).forEach(x => console.log(' • ' + x));
    if (flags.length > 10) console.log(`  … và ${flags.length - 10} câu nữa`);
    if (!CHECK) fs.writeFileSync(path.join(QDIR, 'flags.txt'), flags.join('\n\n') + '\n');
  }
  if (CHECK) return console.log('\n(--check: chưa ghi gì. Bỏ --check để nhập thật.)');
  dirty.forEach(saveBank);
  console.log('\nĐã ghi vào data/*.js. Nhớ commit & push để mọi người dùng.' + (flags.length ? ' Danh sách câu nghi sai: ' + path.relative(root, path.join(QDIR, 'flags.txt')) : ''));
}

function doStatus() {
  const jobs = pendingJobs();
  console.log(`Còn thiếu giải thích: ${jobs.length} câu${ONLY ? ' (môn ' + ONLY + ')' : ' (đề giảng viên)'}.`);
  const manifest = path.join(QDIR, 'manifest.json');
  if (fs.existsSync(manifest)) {
    const M = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const have = M.batches.filter(b => fs.existsSync(path.join(QDIR, 'done', b.name + '.txt'))).length;
    console.log(`Hàng chờ: ${M.batches.length} lô, đã có kết quả ${have}, chưa có ${M.batches.length - have}.`);
  } else console.log('Chưa xuất hàng chờ (chạy export).');
}
function doPrompt() {
  if (!fs.existsSync(path.join(QDIR, 'manifest.json'))) { console.error('Chưa có hàng chờ: hãy chạy export trước.'); process.exit(1); }
  writePrompts(); console.log('Đã tạo lại: ' + path.join(QDIR, 'GIAO-VIEC.txt'));
}

({ export: doExport, import: doImport, status: doStatus, prompt: doPrompt }[cmd] || (() => { console.log('Dùng: export | import [--check] | status | prompt (xem hướng dẫn ở đầu tệp)'); process.exit(1); }))();
