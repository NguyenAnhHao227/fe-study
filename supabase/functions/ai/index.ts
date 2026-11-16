// Supabase Edge Function "ai" — giữ API key AI ở máy chủ, trình duyệt không bao giờ thấy key.
// Secrets cần đặt (Edge Functions → Secrets): AI_BASE, AI_KEY, AI_MODEL, ACCESS_CODE
//   ví dụ: AI_BASE = https://api.xah.io/v1   AI_MODEL = deepseek-4.1-flash-ckey   ACCESS_CODE = <mã bạn tự đặt>
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);

const EXPLAIN_SYSTEM =
  'Bạn là gia sư ôn thi trắc nghiệm đại học. Trả lời bằng tiếng Việt, giữ nguyên thuật ngữ tiếng Anh. KHÔNG dùng chữ cái A/B/C/D để chỉ đáp án (thứ tự đáp án bị xáo trộn) — hãy nêu nội dung đáp án. Định dạng gọn: "**Đáp án đúng:** …", "**Vì sao đúng:** …" (1–3 câu), "**Các đáp án còn lại sai ở đâu:**" (gạch đầu dòng, mỗi ý một dòng ngắn), "**Mẹo nhớ:** …" (1 câu). Tối đa khoảng 200 từ.';
// ---- Dịch Anh → Việt theo lô. Định dạng văn bản có nhãn (giống assets/translate-core.js), KHÔNG dùng JSON. ----
const TRANSLATE_SYSTEM = [
  "Bạn là biên dịch viên đề thi trắc nghiệm đại học (Anh → Việt).",
  "Quy tắc:",
  "- Dịch tự nhiên, ngắn gọn, đúng thuật ngữ chuyên ngành. Thuật ngữ tiếng Anh thông dụng có thể để nguyên.",
  "- GIỮ NGUYÊN mã nguồn, biểu thức, câu lệnh, tên hàm/biến, số và ký hiệu (chỉ dịch phần lời văn xung quanh).",
  "- Không giải thích, không bình luận, không dùng markdown hay dấu ```.",
  '- Mỗi mục đầu vào bắt đầu bằng "[Qn]", sau đó là các dòng "T: …" (câu hỏi) và "A: …", "B: …" (đáp án).',
  "- Trả về ĐÚNG các mục và ĐÚNG các nhãn đã nhận, theo định dạng y hệt, ví dụ:",
  "[Q1]",
  "T: bản dịch câu hỏi",
  "A: bản dịch đáp án A",
  "[Q2]",
  "B: bản dịch đáp án B",
].join("\n");

type TrData = { t?: string; o?: Record<string, string> };
type TrAsk = { key: string; t?: string; o: Record<string, string> };

function buildTrUser(items: TrAsk[]): string {
  return items.map((it, i) => {
    const L = ["[Q" + (i + 1) + "]"];
    if (it.t !== undefined) L.push("T: " + it.t);
    Object.entries(it.o).forEach(([k, v]) => L.push(k + ": " + v));
    return L.join("\n");
  }).join("\n\n");
}

// Đọc câu trả lời của AI -> mảng { t?, o } đúng thứ tự các mục đã gửi (mục thiếu thì rỗng).
function parseTr(text: string, count: number): Array<{ t?: string; o: Record<string, string> }> {
  const res: Array<{ t?: string; o: Record<string, string> }> = Array.from({ length: count }, () => ({ o: {} }));
  let cur: { t?: string; o: Record<string, string> } | null = null;
  let fld: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur && fld) {
      const v = buf.join("\n").trim();
      if (v) { if (fld === "T") cur.t = v; else cur.o[fld] = v; }
    }
    buf = []; fld = null;
  };
  for (const line of String(text ?? "").replace(/\r/g, "").replace(/```[a-z]*/gi, "").split("\n")) {
    let m = line.match(/^\s*\*{0,2}\[Q(\d+)\]\*{0,2}\s*$/i);
    if (m) { flush(); cur = res[+m[1] - 1] ?? null; continue; }
    if (!cur) continue;
    m = line.match(/^\s*\*{0,2}(T|[A-H])\*{0,2}\s*[:：]\*{0,2}\s?(.*)$/);
    if (m) { flush(); fld = m[1]; buf = [m[2]]; continue; }
    if (fld) buf.push(line);
  }
  flush();
  return res;
}

async function callAI(system: string, user: string, maxTokens = 700, timeoutMs = 60_000): Promise<string> {
  const base = (Deno.env.get("AI_BASE") ?? "").replace(/\/$/, "");
  const key = Deno.env.get("AI_KEY");
  const model = Deno.env.get("AI_MODEL");
  const missing = [!base && "AI_BASE", !key && "AI_KEY", !model && "AI_MODEL"].filter(Boolean);
  if (missing.length) throw new Error("Máy chủ chưa cấu hình AI, đang thiếu secret: " + missing.join(", "));
  const run = async (mt: number) => {
    const t0 = Date.now();
    let r: Response;
    try {
      r = await fetch(base + "/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "content-type": "application/json", authorization: "Bearer " + key },
        body: JSON.stringify({ model, max_tokens: mt, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      });
    } catch (e) {
      console.error(`AI lỗi mạng/timeout sau ${Date.now() - t0}ms:`, e);
      throw new Error(`Dịch vụ AI không trả lời trong ${Math.round(timeoutMs / 1000)} giây (quá chậm hoặc không phản hồi)`);
    }
    const j = await r.json().catch(() => ({}));
    console.log(`AI ${model} status ${r.status} sau ${Date.now() - t0}ms (max_tokens ${mt})`);
    if (!r.ok) {
      console.error("AI trả lỗi:", r.status, JSON.stringify(j).slice(0, 500));
      throw new Error(`Dịch vụ AI trả lỗi ${r.status}: ${j?.error?.message ?? j?.message ?? "không rõ"}`);
    }
    const choice = j?.choices?.[0];
    const msg = choice?.message ?? {};
    // nội dung có thể là chuỗi hoặc mảng các đoạn {type:"text", text:"..."}
    const raw = Array.isArray(msg.content) ? msg.content.map((p: { text?: string }) => p?.text ?? "").join("") : msg.content;
    const text = String(raw ?? "").trim();
    const info = {
      text,
      finish: String(choice?.finish_reason ?? "?"),
      reasoning: !!(msg.reasoning_content || msg.reasoning),
      tokens: j?.usage?.completion_tokens ?? "?",
    };
    if (!text) console.error("AI trả về nội dung rỗng:", JSON.stringify(j).slice(0, 600));
    return info;
  };

  let res = await run(maxTokens);
  // Model "suy nghĩ" có thể dùng hết giới hạn token cho phần suy nghĩ ẩn -> thử lại với giới hạn lớn hơn.
  if (!res.text && res.finish === "length") res = await run(Math.min(maxTokens * 5, 4000));
  if (!res.text) {
    throw new Error(
      `AI trả về nội dung rỗng (finish_reason=${res.finish}, ${res.tokens} token` +
        (res.reasoning ? ", model đang 'suy nghĩ' nhưng không ra câu trả lời — nên đổi sang model không 'thinking'" : "") + ")",
    );
  }
  return res.text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const access = Deno.env.get("ACCESS_CODE") ?? "";
    if (!access) return json({ error: "Máy chủ chưa đặt secret ACCESS_CODE" }, 500);

    const body = await req.json().catch(() => ({}));
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ---- thống kê ẩn danh: không cần mã truy cập; chỉ đếm thiết bị (mã ngẫu nhiên), không lưu tên/IP ----
    if (body.action === "hit") {
      const dev = str(body.device, 80);
      if (!/^[\w-]{8,80}$/.test(dev)) return json({ ok: false }, 400);
      const sj = str(body.subject, 12).toUpperCase();
      const subject = /^[A-Z]{2,6}\d{2,4}$/.test(sj) ? sj : null;
      const clamp = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
      const { error } = await admin.rpc("fe_track", { p_device: dev, p_subject: subject, p_sessions: clamp(body.sessions, 1), p_answers: clamp(body.answers, 500) });
      if (error) console.error("fe_track:", error.message);
      return json({ ok: !error }, error ? 500 : 200);
    }

    // ---- trang quản trị: cần mật khẩu riêng ADMIN_CODE ----
    if (body.action === "stats") {
      const adminCode = Deno.env.get("ADMIN_CODE") ?? "";
      if (!adminCode) return json({ error: "Máy chủ chưa đặt secret ADMIN_CODE" }, 500);
      if (str(body.admin, 200) !== adminCode) {
        await sleep(800);
        return json({ error: "Mật khẩu quản trị không đúng" }, 403);
      }
      const { data, error } = await admin.rpc("fe_stats");
      if (error) return json({ error: "Không đọc được thống kê: " + error.message }, 500);
      return json({ ok: true, stats: data });
    }

    if (str(body.code, 200) !== access) {
      await sleep(800); // làm chậm việc dò mã
      return json({ error: "Mã truy cập không đúng" }, 403);
    }
    const device = str(body.device, 80);
    if (!/^[\w-]{8,80}$/.test(device)) return json({ error: "Thiếu mã thiết bị" }, 400);

    const day = new Date().toISOString().slice(0, 10);

    // ---- hạn mức: mỗi thiết bị / ngày và toàn hệ thống / ngày ----
    const { data: cfgRows } = await admin.from("app_config").select("key,value").in("key", ["ai_device_limit", "ai_global_limit"]);
    const cfg = Object.fromEntries((cfgRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const limitDevice = parseInt(cfg.ai_device_limit ?? "50") || 50;
    const limitGlobal = parseInt(cfg.ai_global_limit ?? "300") || 300;
    const { data: urows } = await admin.from("ai_usage").select("scope,n").eq("day", day).in("scope", ["global", "dev:" + device]);
    const usedOf = (s: string) => (urows ?? []).find((r: { scope: string; n: number }) => r.scope === s)?.n ?? 0;
    const usedDevice = usedOf("dev:" + device), usedGlobal = usedOf("global");
    const bump = async (n = 1) => {
      await admin.from("ai_usage").upsert([
        { scope: "dev:" + device, day, n: usedDevice + n },
        { scope: "global", day, n: usedGlobal + n },
      ]);
    };
    const checkQuota = (): Response | null => {
      if (usedDevice >= limitDevice) return json({ error: `Hết lượt AI hôm nay trên thiết bị này (${limitDevice} lượt/ngày)` }, 429);
      if (usedGlobal >= limitGlobal) return json({ error: "Hôm nay hệ thống đã hết lượt AI, hãy quay lại ngày mai" }, 429);
      return null;
    };

    const action = body.action as string;
    if (action === "ping") {
      const out: Record<string, unknown> = { ok: true, usedDevice, limitDevice, usedGlobal, limitGlobal };
      if (body.deep) { // thử gọi AI thật một câu ngắn để đo tốc độ / bắt lỗi (không tính vào hạn mức)
        const t0 = Date.now();
        try {
          // hỏi một câu giải thích ngắn thật (không chỉ "ok") để phát hiện model trả về rỗng hoặc quá chậm
          const sample = await callAI("Bạn là gia sư. Trả lời tiếng Việt, tối đa 2 câu.", "Giải thích ngắn gọn vì sao 2 + 2 = 4.", 200, 40_000);
          out.aiSample = sample.slice(0, 80);
        } catch (e) { out.aiError = e instanceof Error ? e.message : String(e); }
        out.aiMs = Date.now() - t0;
      }
      return json(out);
    }

    const author = str(body.name, 24).trim() || "ẩn danh";

    // ---- dịch theo lô (tối đa 5 câu/lần), chỉ những phần còn thiếu; gộp vào bản dịch đã lưu ----
    if (action === "translate") {
      const items: TrAsk[] = (Array.isArray(body.items) ? body.items : []).slice(0, 5).map((x: Record<string, unknown>) => {
        const o: Record<string, string> = {};
        Object.entries((x.o ?? {}) as Record<string, unknown>).slice(0, 8).forEach(([k, v]) => { if (/^[A-H]$/.test(k)) o[k] = str(v, 700); });
        return { key: str(x.key, 200), t: x.t == null ? undefined : str(x.t, 2500), o };
      }).filter((it: TrAsk) => it.key && (it.t !== undefined || Object.keys(it.o).length));
      if (!items.length) return json({ error: "Thiếu nội dung cần dịch" }, 400);

      const { data: rows } = await admin.from("translations").select("key,data,author,ts").in("key", items.map((i) => i.key));
      const have = new Map<string, { data: TrData; author: string; ts: number }>((rows ?? []).map((r: { key: string; data: TrData; author: string; ts: number }) => [r.key, r]));
      const results: Record<string, unknown> = {};
      const todo: { it: TrAsk; ex: TrData; ask: TrAsk }[] = [];
      for (const it of items) {
        const old = have.get(it.key);
        const ex: TrData = old?.data ?? {};
        const ask: TrAsk = {
          key: it.key,
          t: it.t !== undefined && !ex.t ? it.t : undefined,
          o: Object.fromEntries(Object.entries(it.o).filter(([k]) => !(ex.o && ex.o[k]))),
        };
        if (ask.t === undefined && !Object.keys(ask.o).length) { if (old) results[it.key] = { data: old.data, author: old.author, ts: old.ts }; }
        else todo.push({ it, ex, ask });
      }

      const failed: string[] = [];
      if (todo.length) {
        const blocked = checkQuota(); if (blocked) return blocked;
        let calls = 0;
        const isLimit = (e: unknown) => /^Dịch vụ AI trả lỗi 4\d\d.*(limit|context|token|too (long|large))/i.test(e instanceof Error ? e.message : String(e));
        // Nếu dịch vụ AI từ chối vì quá dài thì chia đôi lô rồi thử lại.
        const translateMany = async (list: typeof todo): Promise<Array<{ t?: string; o: Record<string, string> }>> => {
          const total = list.reduce((n, x) => n + (x.ask.t?.length ?? 0) + Object.values(x.ask.o).join("").length, 0);
          try {
            calls++;
            const text = await callAI(TRANSLATE_SYSTEM, buildTrUser(list.map((x) => x.ask)), Math.min(4000, Math.max(600, Math.ceil(total * 0.9))), 60_000);
            return parseTr(text, list.length);
          } catch (e) {
            if (list.length > 1 && isLimit(e)) {
              const mid = Math.ceil(list.length / 2);
              return [...(await translateMany(list.slice(0, mid))), ...(await translateMany(list.slice(mid)))];
            }
            throw e;
          }
        };
        const out = await translateMany(todo);
        for (let i = 0; i < todo.length; i++) {
          const { it, ex, ask } = todo[i];
          const r = out[i];
          const add: { t?: string; o: Record<string, string> } = { o: {} };
          if (ask.t !== undefined && r.t) add.t = r.t;
          for (const k of Object.keys(ask.o)) if (r.o[k]) add.o[k] = r.o[k];
          if (add.t === undefined && !Object.keys(add.o).length) {
            failed.push(it.key);
            const old = have.get(it.key);
            if (old) results[it.key] = { data: old.data, author: old.author, ts: old.ts };
            continue;
          }
          const data: TrData = { o: { ...(ex.o ?? {}), ...add.o } };
          const t = add.t ?? ex.t;
          if (t) data.t = t;
          const row = { key: it.key, data, author, ts: Date.now() };
          await admin.from("translations").upsert(row);
          results[it.key] = { data, author, ts: row.ts };
        }
        await bump(calls);
      }
      return json({ results, failed });
    }

    const key = str(body.key, 200);
    if (!key) return json({ error: "Thiếu key câu hỏi" }, 400);
    const q = body.q ?? {};

    if (action === "explain") {
      if (!body.force) {
        const { data: c } = await admin.from("explanations").select("text,author,model,ts").eq("key", key).maybeSingle();
        if (c) return json({ cached: true, text: c.text, author: c.author, model: c.model, ts: c.ts });
      }
      const blocked = checkQuota(); if (blocked) return blocked;
      const opts = (Array.isArray(q.o) ? q.o : []).slice(0, 10).map((x: unknown) => str(x, 600));
      const correct = (Array.isArray(q.correct) ? q.correct : []).slice(0, 10).map((x: unknown) => str(x, 600));
      const build = (hint: boolean) =>
        `Câu hỏi: ${str(q.t, 2500)}\n\nCác đáp án:\n${opts.map((o: string) => "- " + o).join("\n")}\n\nĐáp án đúng: ${correct.join(" | ")}\n${hint && q.e ? "Gợi ý có sẵn: " + str(q.e, 400) : ""}`;
      // Nếu dịch vụ AI từ chối vì quá dài (ngữ cảnh/token) thì tự thử lại với yêu cầu gọn hơn.
      const isLimit = (e: unknown) => /^Dịch vụ AI trả lỗi 4\d\d.*(limit|context|token|too (long|large))/i.test(e instanceof Error ? e.message : String(e));
      let text = "";
      try {
        text = await callAI(EXPLAIN_SYSTEM, build(true), 700);
      } catch (e) {
        if (!isLimit(e)) throw e;
        try {
          text = await callAI(EXPLAIN_SYSTEM, build(false), 450);
        } catch (e2) {
          if (!isLimit(e2)) throw e2;
          text = await callAI(EXPLAIN_SYSTEM, build(false), 250);
        }
      }
      if (!text) return json({ error: "AI không trả về nội dung" }, 502);
      const row = { key, text, author, model: Deno.env.get("AI_MODEL") ?? "", ts: Date.now() };
      await admin.from("explanations").upsert(row);
      await bump();
      return json({ cached: false, text, author, model: row.model, ts: row.ts });
    }

    return json({ error: "Hành động không hợp lệ" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
