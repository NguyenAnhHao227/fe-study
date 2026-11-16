#!/usr/bin/env node
/* Dịch bằng gói có sẵn (ChatGPT Plus, Antigravity, Codex…) thay vì trả token API: XUẤT → dịch bên ngoài → NHẬP lại.
 *
 *   node tools/translate-queue.js export [--size 30] [--only CEA201] [--skip CSI106,MAE101] [--force]   xuất các lô cần dịch vào translate-queue/todo/
 *   node tools/translate-queue.js import [--check]                               nhập kết quả từ translate-queue/done/ vào data/*.js
 *   node tools/translate-queue.js status                                         xem còn bao nhiêu việc
 *
 * Quy trình: export → đưa translate-queue/ cho agent (Antigravity/Codex) hoặc dán từng lô vào ChatGPT
 *            (xem translate-queue/PROMPT.txt) → kết quả lưu vào translate-queue/done/ cùng tên tệp → import.
 * Chỉ dịch phần còn thiếu; import chỉ ĐIỀN chỗ trống, không ghi đè bản dịch đã có. Chạy lại bao nhiêu lần cũng được.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const TR = require('../assets/translate-core.js');

const root = path.join(__dirname, '..');
const [cmd] = process.argv.slice(2);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const QDIR = path.resolve(root, String(arg('dir', 'translate-queue')));
const SIZE = Math.max(5, Math.min(60, parseInt(arg('size', '30'), 10) || 30));
const ONLY = arg('only') ? String(arg('only')).toUpperCase() : null;
const SKIP = new Set(String(arg('skip', '') === true ? '' : arg('skip', '')).toUpperCase().split(',').filter(Boolean));
const CHECK = !!arg('check', false), FORCE = !!arg('force', false);
const doneFile = path.join(__dirname, '.translate-done.json'); // dùng chung với translate-bank.js
const done = new Set(fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, 'utf8')) : []);
const saveDone = () => fs.writeFileSync(doneFile, JSON.stringify([...done]));

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
function pendingJobs() {
  const jobs = [];
  for (const [code, { bank }] of Object.entries(banks)) {
    if ((ONLY && code !== ONLY) || SKIP.has(code)) continue;
    for (const q of bank.questions) {
      const m = TR.missing(q, {});
      const miss = { t: m.t && !done.has(`${code}|${q.id}|T`), o: m.o.filter(k => !done.has(`${code}|${q.id}|${k}`)) };
      if (!TR.isEmpty(miss)) jobs.push({ code, q, miss });
    }
  }
  // Ưu tiên: đề của giảng viên trước (g:'gv'), rồi các câu còn lại theo môn
  const rank = j => (j.q.g === 'gv' ? 0 : 1);
  return jobs.map((j, i) => [j, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
}
const partsOf = j => (j.miss.t ? 1 : 0) + j.miss.o.length;
const itemOf = j => ({ t: j.miss.t ? j.q.t : undefined, o: Object.fromEntries(j.miss.o.map(k => [k, j.q.o.find(o => o[0] === k)[1]])) });

const PROMPT = () => `=== CÁCH 1 (khuyên dùng): để AGENT trong IDE tự đọc và ghi tệp — Antigravity, Codex… — không cần copy/paste ===
Mở thư mục này (translate-queue) bằng IDE rồi dán đoạn sau cho agent (chọn model dịch tốt, ví dụ Gemini Pro hoặc GPT):

----------------------------------------------------------------
Trong thư mục todo/ có các tệp batch-001.txt, batch-002.txt, ... Mỗi tệp gồm các mục đề thi trắc nghiệm tiếng Anh cần dịch sang tiếng Việt.
Với MỖI tệp trong todo/: đọc tệp, dịch theo QUY TẮC bên dưới, rồi ghi kết quả vào tệp CÙNG TÊN trong thư mục done/ (ví dụ done/batch-001.txt).
Làm lần lượt từng tệp, không bỏ sót tệp nào, không sửa bất kỳ tệp nào khác. Nếu hết hạn mức giữa chừng thì dừng, lần sau làm tiếp các tệp chưa có trong done/.

QUY TẮC:
${TR.SYSTEM}
----------------------------------------------------------------

=== CÁCH 2: dùng chat (ChatGPT Plus…) ===
Mỗi lần: dán đoạn QUY TẮC ở trên rồi dán nội dung MỘT tệp todo/batch-XXX.txt (hoặc tải tệp lên). AI sẽ trả về đúng định dạng.
Chép kết quả vào tệp done/batch-XXX.txt (đúng tên) — chỉ cần các dòng "[Qn]", "T:", "A:", "B:"…; lời dẫn thừa không sao.

Khi xong (hoặc xong một phần): chạy  node tools/translate-queue.js import --check  để kiểm tra, rồi bỏ --check để nhập thật.
`;

/* Tệp lệnh GIAO VIỆC cho agent có quyền truy cập thư mục (Antigravity, Codex, ChatGPT…): đủ đường dẫn, quy tắc, tự kiểm tra. */
const AGENT_PROMPT = () => {
  const todo = path.join(QDIR, 'todo'), doneDir = path.join(QDIR, 'done');
  return `NHIỆM VỤ: Dịch các đề thi trắc nghiệm tiếng Anh sang tiếng Việt, theo từng tệp, và ghi kết quả ra tệp.

ĐƯỜNG DẪN (đầy đủ):
- Tệp cần dịch (CHỈ ĐỌC):  ${todo}   gồm batch-001.txt, batch-002.txt, ...
- Nơi ghi kết quả (GHI):    ${doneDir}   mỗi tệp kết quả CÙNG TÊN với tệp đầu vào, ví dụ  ${path.join(doneDir, 'batch-001.txt')}
- Thư mục dự án (để chạy lệnh kiểm tra ở bước 4):  ${root}

CÁCH LÀM:
1. Liệt kê todo và done. Bỏ qua những tệp batch ĐÃ có trong done (để làm tiếp nếu lần trước bị gián đoạn).
2. Với MỖI tệp còn lại, theo thứ tự batch-001, batch-002, ...: đọc tệp -> dịch theo QUY TẮC bên dưới -> ghi NGAY vào done (UTF-8) cùng tên tệp. Đừng gom nhiều tệp rồi mới ghi.
   Thứ tự này là thứ tự ưu tiên (các lô đầu là đề quan trọng nhất), nên đừng nhảy cóc; nếu sắp hết hạn mức thì dừng đúng sau khi ghi xong một tệp.
3. Trước khi sang tệp tiếp theo, tự kiểm tra tệp vừa ghi:
   a) có đúng cùng số mục "[Qn]" như tệp đầu vào;
   b) mỗi mục có đủ các nhãn (T:, A:, B:, C:, D:, ...) giống hệt tệp đầu vào, không thừa, không thiếu;
   c) không còn câu tiếng Anh chưa dịch (trừ mã nguồn, biểu thức, thuật ngữ giữ nguyên).
   Nếu sai, sửa lại ngay rồi mới đi tiếp.
4. Khi xong hết (hoặc khi hết hạn mức), chạy đúng lệnh sau để kiểm tra tổng thể (lệnh này CHỈ ĐỌC, không ghi gì):
       cd "${root}"
       node tools/translate-queue.js import --check
   Nếu có mục báo "không đọc được" hoặc "thiếu một phần", mở lại tệp batch tương ứng và dịch bổ sung cho đủ, rồi chạy lại lệnh kiểm tra.
5. Báo cáo ngắn: đã ghi bao nhiêu tệp, còn bao nhiêu tệp chưa làm, và kết quả lệnh kiểm tra.

ĐỊNH DẠNG (giữ y hệt, đầu ra phải có đúng các mục và đúng các nhãn của đầu vào):
Ví dụ đầu vào (một tệp batch):
[Q1]
T: Which register holds the address of the next instruction?
A: Program Counter
B: Accumulator

[Q2]
B: Both statements are false.
Ví dụ đầu ra tương ứng:
[Q1]
T: Thanh ghi nào lưu địa chỉ của lệnh kế tiếp?
A: Bộ đếm chương trình (Program Counter)
B: Thanh ghi tích lũy (Accumulator)

[Q2]
B: Cả hai phát biểu đều sai.

QUY TẮC DỊCH:
- Dịch tự nhiên, ngắn gọn, đúng thuật ngữ chuyên ngành. Thuật ngữ tiếng Anh thông dụng có thể để nguyên hoặc ghi trong ngoặc.
- GIỮ NGUYÊN mã nguồn, biểu thức, câu lệnh, tên hàm/biến, số và ký hiệu (<<, >>, &&, <=, ...). Chỉ dịch phần lời văn xung quanh.
- Đáp án chỉ gồm số, mẫu bit hoặc công thức thì giữ nguyên.
- Đáp án True/False dịch thành "Đúng"/"Sai".
- Mục nào chỉ có nhãn A:/B:... (không có T:) thì chỉ dịch các nhãn đó. Không thêm nhãn T: nếu đầu vào không có.
- Câu có nhiều dòng (ví dụ có đoạn code): giữ nguyên các dòng xuống dòng; bản dịch viết ngay sau nhãn, các dòng tiếp theo nối liền bên dưới.
- Không giải thích, không bình luận, không đánh số lại, không dùng markdown hay dấu ba gạch ngược.
- Không thêm mục, không bỏ mục, không đổi thứ tự mục.

TUYỆT ĐỐI KHÔNG:
- sửa hoặc xoá tệp trong todo;
- sửa bất kỳ tệp nào ngoài thư mục done;
- chạy lệnh "import" khi không có --check;
- chạy git (commit, push...).
`;
};
function writePrompts() {
  fs.writeFileSync(path.join(QDIR, 'GIAO-VIEC.txt'), AGENT_PROMPT());
  fs.writeFileSync(path.join(QDIR, 'PROMPT.txt'), PROMPT());
}

/* ---- export ---- */
function doExport() {
  const jobs = pendingJobs();
  if (!jobs.length) return console.log('Không còn gì cần dịch.');
  const todoDir = path.join(QDIR, 'todo'), doneDir = path.join(QDIR, 'done'), manifest = path.join(QDIR, 'manifest.json');
  if (fs.existsSync(todoDir) && fs.readdirSync(todoDir).length) {
    if (!FORCE) { console.error('Đã có hàng chờ trong ' + path.relative(root, QDIR) + '. Hãy import kết quả trước, hoặc dùng --force để tạo mới (hàng cũ được cất vào thư mục old-…).'); process.exit(1); }
    const old = path.join(QDIR, 'old-' + new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(old, { recursive: true });
    for (const n of ['todo', 'done', 'manifest.json']) if (fs.existsSync(path.join(QDIR, n))) fs.renameSync(path.join(QDIR, n), path.join(old, n));
    console.log('Đã cất hàng cũ vào ' + path.relative(root, old));
  }
  fs.mkdirSync(todoDir, { recursive: true }); fs.mkdirSync(doneDir, { recursive: true });
  const batches = []; let chars = 0;
  for (let i = 0; i < jobs.length; i += SIZE) {
    const list = jobs.slice(i, i + SIZE), name = 'batch-' + String(batches.length + 1).padStart(3, '0');
    const text = TR.buildUser(list.map(itemOf));
    fs.writeFileSync(path.join(todoDir, name + '.txt'), text + '\n');
    chars += text.length;
    batches.push({ name, items: list.map(j => ({ code: j.code, id: j.q.id, t: j.miss.t, o: j.miss.o })) });
  }
  fs.writeFileSync(manifest, JSON.stringify({ created: new Date().toISOString(), size: SIZE, batches }, null, 1));
  writePrompts();
  console.log(`Đã xuất ${jobs.length} câu (${jobs.reduce((n, j) => n + partsOf(j), 0)} phần) thành ${batches.length} lô, ~${Math.round(chars / 1000)}k ký tự, vào ${path.relative(root, QDIR)}${path.sep}todo`);
  console.log('Tiếp theo: đưa tệp ' + path.join(QDIR, 'GIAO-VIEC.txt') + ' cho Antigravity / Codex / ChatGPT (loại truy cập được thư mục).');
}

/* ---- import ---- */
function doImport() {
  const manifest = path.join(QDIR, 'manifest.json');
  if (!fs.existsSync(manifest)) { console.error('Chưa có manifest.json: hãy chạy export trước.'); process.exit(1); }
  const M = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  let batchesIn = 0, batchesWait = 0, itemsOk = 0, itemsPartial = 0, itemsEmpty = 0, partsSet = 0, partsSkipped = 0;
  const dirty = new Set(), bad = [];
  for (const b of M.batches) {
    const f = path.join(QDIR, 'done', b.name + '.txt');
    if (!fs.existsSync(f)) { batchesWait++; continue; }
    batchesIn++;
    const out = TR.parse(fs.readFileSync(f, 'utf8'), b.items.length);
    b.items.forEach((spec, i) => {
      const r = out[i], B = banks[spec.code], q = B && B.byId.get(spec.id);
      if (!q) { itemsEmpty++; return; }
      let want = 0, got = 0;
      if (spec.t) {
        want++;
        if (r.t) { got++; if (TR.real(q.tv, q.t)) partsSkipped++; else { if (TR.norm(r.t) !== TR.norm(q.t)) q.tv = r.t; if (!CHECK) done.add(`${spec.code}|${q.id}|T`); partsSet++; dirty.add(spec.code); } }
      }
      for (const k of spec.o) {
        want++;
        const op = q.o.find(o => o[0] === k);
        if (r.o[k] && op) { got++; if (TR.real(op[2], op[1])) partsSkipped++; else { if (TR.norm(r.o[k]) !== TR.norm(op[1])) op[2] = r.o[k]; if (!CHECK) done.add(`${spec.code}|${q.id}|${k}`); partsSet++; dirty.add(spec.code); } }
      }
      if (got === want) itemsOk++; else if (got) { itemsPartial++; bad.push(`${spec.code}|${spec.id} (có ${got}/${want} phần)`); } else { itemsEmpty++; bad.push(`${spec.code}|${spec.id} (không có phần nào)`); }
    });
  }
  console.log(`Lô đã có kết quả: ${batchesIn}/${M.batches.length}${batchesWait ? ` (còn ${batchesWait} lô chưa có trong done/)` : ''}`);
  console.log(`Câu dịch đủ: ${itemsOk} | thiếu một phần: ${itemsPartial} | không đọc được: ${itemsEmpty}`);
  console.log(`Phần được ${CHECK ? 'điền (chưa ghi, chế độ --check)' : 'điền vào dữ liệu'}: ${partsSet}${partsSkipped ? ` | bỏ qua vì đã có bản dịch: ${partsSkipped}` : ''}`);
  if (bad.length) { console.log('Chưa đủ (sẽ được xuất lại ở lần export sau):'); bad.slice(0, 12).forEach(x => console.log('  - ' + x)); if (bad.length > 12) console.log(`  … và ${bad.length - 12} câu nữa`); }
  if (CHECK) return console.log('\n(--check: chưa ghi gì. Bỏ --check để nhập thật.)');
  dirty.forEach(saveBank); saveDone();
  console.log('\nĐã ghi vào data/*.js. Nhớ commit & push để mọi người dùng.');
}

/* ---- status ---- */
function doStatus() {
  const jobs = pendingJobs();
  console.log(`Còn thiếu bản dịch: ${jobs.length} câu (${jobs.reduce((n, j) => n + partsOf(j), 0)} phần).`);
  const manifest = path.join(QDIR, 'manifest.json');
  if (fs.existsSync(manifest)) {
    const M = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const have = M.batches.filter(b => fs.existsSync(path.join(QDIR, 'done', b.name + '.txt'))).length;
    console.log(`Hàng chờ: ${M.batches.length} lô, đã có kết quả ${have}, chưa có ${M.batches.length - have}.`);
  } else console.log('Chưa xuất hàng chờ (chạy export).');
}

function doPrompt() { // tạo lại các tệp lệnh mà không đụng tới todo/ và done/
  if (!fs.existsSync(path.join(QDIR, 'manifest.json'))) { console.error('Chưa có hàng chờ: hãy chạy export trước.'); process.exit(1); }
  writePrompts();
  console.log('Đã tạo lại: ' + path.join(QDIR, 'GIAO-VIEC.txt'));
}

({ export: doExport, import: doImport, status: doStatus, prompt: doPrompt }[cmd] || (() => { console.log('Dùng: export | import [--check] | status | prompt (xem hướng dẫn ở đầu tệp)'); process.exit(1); }))();
