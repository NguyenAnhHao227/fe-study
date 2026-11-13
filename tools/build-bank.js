#!/usr/bin/env node
/* Tạo file data/<môn>.js từ file .docx ngân hàng câu hỏi.
 *
 * Cách dùng (chạy trong thư mục On_Thi_FE):
 *   node tools/build-bank.js "<file.docx>" CSI106                 -> toàn bộ câu hỏi
 *   node tools/build-bank.js "<file.docx>" CSI106 --per-topic 8   -> chỉ lấy 8 câu/chủ đề (bản test nhỏ)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const P = require('../assets/parser.js');

(async () => {
  const args = process.argv.slice(2);
  const [file, code] = args;
  if (!file || !code) { console.error('Thiếu tham số: <file.docx> <MÃ_MÔN> [--per-topic N]'); process.exit(1); }
  const pt = args.indexOf('--per-topic');
  const perTopic = pt >= 0 ? parseInt(args[pt + 1], 10) : 0;

  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const lines = await P.docxToLines(ab, async d => new Uint8Array(zlib.inflateRawSync(d)));
  const bank = P.parseLines(lines, { idPrefix: code });

  if (perTopic > 0) {
    const count = {};
    bank.questions = bank.questions.filter(q => (count[q.s] = (count[q.s] || 0) + 1) <= perTopic);
    bank.mocks = []; // bản rút gọn: bỏ đề mô phỏng cố định (thiếu câu)
  }
  delete bank.stats;

  const out = path.join(__dirname, '..', 'data', code.toLowerCase() + '.js');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, 'window.BANKS = window.BANKS || {};\nwindow.BANKS.' + code + ' = ' + JSON.stringify(bank) + ';\n');
  console.log(`${code}: ${bank.questions.length} câu, ${bank.topics.length} chủ đề, ${bank.mocks.length} đề mô phỏng -> ${out}`);
})().catch(e => { console.error(e); process.exit(1); });
