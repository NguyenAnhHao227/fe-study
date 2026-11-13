/* Parser ngân hàng câu hỏi (dùng chung cho trình duyệt và Node).
 * Định dạng nhận vào (docx / txt):
 *   Question 1: [ID: CSI106-0001] Nội dung câu hỏi
 *   Vietnamese: Bản dịch (tuỳ chọn)
 *   A. Đáp án A
 *   Vietnamese: Bản dịch đáp án A (tuỳ chọn)
 *   ...
 *   Answer: B            (nhiều đáp án: "A, C")
 *   Explanation: Giải thích
 *   Vietnamese: Bản dịch giải thích (tuỳ chọn)
 * Dòng tiêu đề đứng giữa các câu = tên chủ đề. Tiêu đề có chữ "Mock NN" = đề mô phỏng.
 */
(function (root) {
  'use strict';

  function unescapeXml(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n))
      .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&amp;/g, '&');
  }

  /* ---------- đọc file .docx (zip) ---------- */
  async function unzipEntry(buf, name, inflateRaw) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Không phải file .docx hợp lệ');
    const cnt = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    for (let n = 0; n < cnt; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const fname = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      if (fname === name) {
        const ln = dv.getUint16(off + 26, true), le = dv.getUint16(off + 28, true);
        const data = u8.subarray(off + 30 + ln + le, off + 30 + ln + le + csize);
        return method === 0 ? data : await inflateRaw(data);
      }
      p += 46 + nlen + elen + clen;
    }
    throw new Error('Không tìm thấy ' + name + ' trong file');
  }

  async function browserInflate(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function xmlToLines(xml) {
    const out = [], re = /<w:p[ >][\s\S]*?<\/w:p>/g;
    let m;
    while ((m = re.exec(xml))) {
      let t = '', k;
      const re2 = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g;
      while ((k = re2.exec(m[0]))) t += k[1] !== undefined ? k[1] : ' ';
      out.push(unescapeXml(t).replace(/\s+/g, ' ').trim());
    }
    return out;
  }

  async function docxToLines(buf, inflateRaw) {
    const data = await unzipEntry(buf, 'word/document.xml', inflateRaw || browserInflate);
    return xmlToLines(new TextDecoder('utf-8').decode(data));
  }

  /* ---------- phân tích dòng chữ thành câu hỏi ---------- */
  const RE_Q = /^(?:Question|Câu(?: hỏi)?|Q)\s*(\d+)\s*[:.)]\s*(?:\[\s*ID\s*:\s*([^\]]+?)\s*\]\s*)?(.*)$/i;
  const RE_OPT = /^\(?([A-H])[.)]\s+(.*)$/;
  const RE_VI = /^(?:Vietnamese|Tiếng Việt|VI)\s*:\s*(.*)$/i;
  const RE_ANS = /^(?:Answer|Đáp án|Ans)\s*:\s*(.*)$/i;
  const RE_EXP = /^(?:Explanation|Giải thích)\s*:\s*(.*)$/i;
  const RE_MOCK = /mock\D{0,8}(\d+)|đề\s*(?:thi\s*)?(?:thử|mô phỏng)\D{0,4}(\d+)/i;
  const LETTERS = 'ABCDEFGH';

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function cleanTopic(name) {
    let n = name.replace(/^[A-Z]{3}\d{3}\s+/, '');
    let m = n.match(/^(Core|App)\s+Batch\s+(\d+)\s+(.*)$/i);
    if (m) return (m[1].toLowerCase() === 'core' ? 'Core' : 'Applied') + ' ' + m[2] + ' · ' + m[3];
    n = n.replace(/\s*-\s*Copy$/i, '').replace(/\s*\d+Q\b/i, '');
    return n || name;
  }

  function looksHeading(line) {
    return line.length < 110 && !/[.?!:;,)]$/.test(line);
  }

  function parseLines(lines, opt) {
    opt = opt || {};
    const prefix = opt.idPrefix || 'Q';
    const topics = [], mocks = [], questions = [], seen = new Map();
    let sec = null, cur = null, skipped = 0, dup = 0;

    function topicIndex(name) {
      let i = topics.findIndex(t => t.name === name);
      if (i < 0) { topics.push({ name }); i = topics.length - 1; }
      return i;
    }
    function finish() {
      if (!cur) return;
      const c = cur; cur = null;
      if (c.o.length < 2 || !c.a) { skipped++; return; }
      if (!c.id) c.id = prefix + '-' + hash(c.t + c.o.map(o => o[1]).join('|'));
      if (sec && sec.mock) {
        let mk = mocks.find(m => m.name === sec.name);
        if (!mk) { mk = { name: sec.name, ids: [] }; mocks.push(mk); }
        if (!mk.ids.includes(c.id)) mk.ids.push(c.id);
      }
      if (seen.has(c.id)) { dup++; return; }
      const sname = sec && !sec.mock ? sec.name : 'Chung';
      const q = { id: c.id, t: c.t, o: c.o, a: c.a, s: sec && sec.mock ? -1 : topicIndex(sname) };
      if (c.tv) q.tv = c.tv;
      if (c.e) q.e = c.e;
      if (c.ev) q.ev = c.ev;
      seen.set(c.id, q); questions.push(q);
    }
    function addTo(field, text) {
      cur[field] = cur[field] ? cur[field] + ' ' + text : text;
    }

    for (const raw of lines) {
      const line = (raw || '').trim();
      if (!line) continue;
      let m;
      if ((m = line.match(RE_Q))) {
        finish();
        cur = { id: (m[2] || '').trim(), t: m[3].trim(), tv: '', o: [], a: '', e: '', ev: '', st: 'stem' };
        continue;
      }
      if (cur) {
        if ((m = line.match(RE_VI))) {
          const v = m[1].trim();
          if (cur.st === 'stem') addTo('tv', v);
          else if (cur.st === 'opt') { const o = cur.o[cur.o.length - 1]; o[2] = o[2] ? o[2] + ' ' + v : v; }
          else if (cur.st === 'exp') { addTo('ev', v); cur.st = 'done'; }
          continue;
        }
        if ((m = line.match(RE_ANS))) {
          cur.a = [...new Set((m[1].toUpperCase().match(/[A-H]/g) || []))].sort().join('');
          cur.st = 'ans'; continue;
        }
        if ((m = line.match(RE_EXP))) { cur.e = m[1].trim(); cur.st = 'exp'; continue; }
        if ((cur.st === 'stem' || cur.st === 'opt') && (m = line.match(RE_OPT)) && m[1] === LETTERS[cur.o.length]) {
          cur.o.push([m[1], m[2].trim(), '']); cur.st = 'opt'; continue;
        }
        if (cur.st === 'stem') { addTo('t', line); continue; }
        if (cur.st === 'opt') { const o = cur.o[cur.o.length - 1]; o[1] += ' ' + line; continue; }
        if ((cur.st === 'exp' || cur.st === 'ans') && !looksHeading(line)) {
          if (cur.st === 'exp') addTo('e', line);
          continue;
        }
        finish(); // gặp tiêu đề -> kết thúc câu hiện tại
      }
      // tiêu đề chủ đề / đề thi
      const mk = line.match(RE_MOCK);
      if (mk) {
        const num = String(mk[1] || mk[2]).padStart(2, '0');
        const name = 'Đề mô phỏng ' + num;
        if (!(sec && sec.mock && sec.name === name)) sec = { mock: true, name };
      } else if (!(sec && sec.mock)) {
        if (looksHeading(line)) sec = { mock: false, name: cleanTopic(line) };
      }
    }
    finish();

    // bỏ chủ đề rỗng, đánh lại chỉ số
    const used = [...new Set(questions.map(q => q.s))].filter(i => i >= 0).sort((a, b) => a - b);
    const remap = new Map(used.map((old, n) => [old, n]));
    const outTopics = used.map(i => topics[i]);
    let fallback = -1;
    questions.forEach(q => {
      if (q.s >= 0) q.s = remap.get(q.s);
      else { // câu chỉ xuất hiện trong đề mô phỏng
        if (fallback < 0) { outTopics.push({ name: 'Chỉ có trong đề mô phỏng' }); fallback = outTopics.length - 1; }
        q.s = fallback;
      }
    });
    return { topics: outTopics, questions, mocks: mocks.filter(m => m.ids.length), stats: { skipped, dup } };
  }

  function parseText(text, opt) { return parseLines(String(text).split(/\r?\n/), opt); }

  function parseJson(text, opt) {
    const j = JSON.parse(text);
    if (j && j.questions && j.topics) return { ...j, stats: { skipped: 0, dup: 0 } };
    const arr = Array.isArray(j) ? j : j.questions;
    if (!Array.isArray(arr)) throw new Error('JSON không đúng định dạng');
    const topics = [], questions = [];
    arr.forEach((x, i) => {
      const optsRaw = x.options || x.o || [];
      const o = optsRaw.map((v, n) => Array.isArray(v) ? v : [LETTERS[n], typeof v === 'string' ? v : (v.text || v.t), (v && v.vi) || '']);
      const a = String(x.answer || x.a || '').toUpperCase().replace(/[^A-H]/g, '');
      const t = x.question || x.t || '';
      if (!t || o.length < 2 || !a) return;
      const tn = x.topic || 'Chung';
      let s = topics.findIndex(z => z.name === tn);
      if (s < 0) { topics.push({ name: tn }); s = topics.length - 1; }
      questions.push({ id: x.id || (opt && opt.idPrefix || 'Q') + '-' + hash(t), t, tv: x.vi || x.tv || '', o, a, e: x.explanation || x.e || '', ev: x.explanation_vi || x.ev || '', s });
    });
    return { topics, questions, mocks: [], stats: { skipped: arr.length - questions.length, dup: 0 } };
  }

  root.FEParser = { parseLines, parseText, parseJson, docxToLines, browserInflate, hash };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FEParser;
})(typeof window !== 'undefined' ? window : globalThis);
