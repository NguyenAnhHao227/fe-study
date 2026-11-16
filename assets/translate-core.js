/* Lõi dịch Anh → Việt dùng chung cho trình duyệt (assets/app.js) và Node (tools/translate-bank.js).
 *
 * Định dạng trao đổi với AI là văn bản có nhãn (KHÔNG dùng JSON, vì code/xuống dòng/dấu nháy rất dễ làm hỏng JSON):
 *   Đầu vào:  [Q1]            Đầu ra:  [Q1]
 *             T: câu hỏi               T: bản dịch câu hỏi
 *             A: đáp án A              A: bản dịch đáp án A
 *             B: đáp án B              B: bản dịch đáp án B
 *   Chỉ gửi những phần CÒN THIẾU (ví dụ chỉ đáp án B và D).
 */
(function (root) {
  'use strict';

  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
  /* Chỉ coi là "cần dịch" khi là lời văn tiếng Anh thật. Bỏ qua: số, mẫu bit (1110 0000), công thức/biểu thức
   * (k = ceil(log_b(N+1))), tên hàm/mã (fabsf(), printf("%d")), ký hiệu. Nhận:
   *   - có ít nhất hai từ liền nhau (mỗi từ ≥ 2 chữ cái): "Procedural paradigm", "Program Counter", "of the…"
   *   - hoặc đáp án chỉ gồm MỘT từ thường/viết hoa đầu (≥ 4 chữ cái): "Stack", "Router", "Compiler" (không phải IN HOA như NULL). */
  const VI_CHARS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
  const translatable = s => {
    s = String(s == null ? '' : s).trim();
    if (VI_CHARS.test(s)) return false; // đã là tiếng Việt thì không cần dịch
    if (/\b[A-Za-z]{2,}\b[ \t]+\b[A-Za-z]{2,}\b/.test(s)) return true;
    return /^[A-Za-z][A-Za-z'’-]{3,}[.!?]?$/.test(s) && !/^[A-Z]+[.!?]?$/.test(s);
  };
  // Bản dịch "thật" trong dữ liệu gốc: có nội dung và khác tiếng Anh.
  const real = (vi, en) => !!vi && norm(vi) !== norm(en);

  /* Phần còn thiếu của câu q, tính cả bản dịch đã lưu tr = { t, o: { A: '…' } }.
   * Bản dịch AI đã lưu (tr) luôn được tính là "đã xử lý", kể cả khi AI giữ nguyên chữ (thuật ngữ, code),
   * để không dịch đi dịch lại mãi một câu. */
  function missing(q, tr) {
    tr = tr || {};
    const out = { t: false, o: [] };
    if (translatable(q.t) && !real(q.tv, q.t) && !tr.t) out.t = true;
    for (const o of q.o) {
      if (translatable(o[1]) && !real(o[2], o[1]) && !(tr.o && tr.o[o[0]])) out.o.push(o[0]);
    }
    return out;
  }
  const isEmpty = m => !m.t && !m.o.length;
  const describe = m => [m.t ? 'câu hỏi' : '', m.o.length ? (m.t ? m.o.length + ' đáp án' : m.o.length === 1 ? '1 đáp án' : m.o.length + ' đáp án') : ''].filter(Boolean).join(' + ');

  const SYSTEM = [
    'Bạn là biên dịch viên đề thi trắc nghiệm đại học (Anh → Việt).',
    'Quy tắc:',
    '- Dịch tự nhiên, ngắn gọn, đúng thuật ngữ chuyên ngành. Thuật ngữ tiếng Anh thông dụng có thể để nguyên.',
    '- GIỮ NGUYÊN mã nguồn, biểu thức, câu lệnh, tên hàm/biến, số và ký hiệu (chỉ dịch phần lời văn xung quanh).',
    '- Không giải thích, không bình luận, không dùng markdown hay dấu ```.',
    '- Mỗi mục đầu vào bắt đầu bằng "[Qn]", sau đó là các dòng "T: …" (câu hỏi) và "A: …", "B: …" (đáp án).',
    '- Trả về ĐÚNG các mục và ĐÚNG các nhãn đã nhận, theo định dạng y hệt, ví dụ:',
    '[Q1]',
    'T: bản dịch câu hỏi',
    'A: bản dịch đáp án A',
    '[Q2]',
    'B: bản dịch đáp án B',
  ].join('\n');

  // items: [{ t?: 'câu hỏi', o?: { A: 'đáp án A', ... } }]
  function buildUser(items) {
    return items.map((it, i) => {
      const L = ['[Q' + (i + 1) + ']'];
      if (it.t != null) L.push('T: ' + it.t);
      Object.entries(it.o || {}).forEach(([k, v]) => L.push(k + ': ' + v));
      return L.join('\n');
    }).join('\n\n');
  }

  // Đọc câu trả lời của AI -> mảng { t?, o: {} } đúng thứ tự các mục đã gửi (mục thiếu thì rỗng).
  function parse(text, count) {
    const res = Array.from({ length: count }, () => ({ o: {} }));
    let cur = null, fld = null, buf = [];
    const flush = () => {
      if (cur && fld) { const v = buf.join('\n').trim(); if (v) { if (fld === 'T') cur.t = v; else cur.o[fld] = v; } }
      buf = []; fld = null;
    };
    const lines = String(text || '').replace(/\r/g, '').replace(/```[a-z]*/gi, '').split('\n');
    for (const line of lines) {
      let m;
      if ((m = line.match(/^\s*\*{0,2}\[Q(\d+)\]\*{0,2}\s*$/i))) { flush(); cur = res[+m[1] - 1] || null; continue; }
      if (!cur) continue;
      if ((m = line.match(/^\s*\*{0,2}(T|[A-H])\*{0,2}\s*[:：]\*{0,2}\s?(.*)$/))) { flush(); fld = m[1]; buf = [m[2]]; continue; }
      if (fld) buf.push(line);
    }
    flush();
    return res;
  }

  // Gộp bản dịch mới b vào bản dịch cũ a (giữ phần đã có, thêm phần mới).
  function mergeTr(a, b) {
    a = a || {}; b = b || {};
    const out = { ...a, ...b, o: { ...(a.o || {}), ...(b.o || {}) } };
    const t = b.t || a.t; if (t) out.t = t; else delete out.t;
    return out;
  }

  root.FETranslate = { norm, translatable, real, missing, isEmpty, describe, SYSTEM, buildUser, parse, mergeTr };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FETranslate;
})(typeof window !== 'undefined' ? window : globalThis);
