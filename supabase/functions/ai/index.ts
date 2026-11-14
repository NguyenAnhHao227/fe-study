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
const TRANSLATE_SYSTEM =
  'Dịch đề thi trắc nghiệm sang tiếng Việt, ngắn gọn, giữ nguyên thuật ngữ chuyên ngành/mã/biểu thức. Chỉ trả về MỘT đối tượng JSON hợp lệ dạng {"t":"…","o":{"A":"…","B":"…"}}, không thêm chữ nào khác.';

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
    const bump = async () => {
      await admin.from("ai_usage").upsert([
        { scope: "dev:" + device, day, n: usedDevice + 1 },
        { scope: "global", day, n: usedGlobal + 1 },
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

    const key = str(body.key, 200);
    if (!key) return json({ error: "Thiếu key câu hỏi" }, 400);
    const author = str(body.name, 24).trim() || "ẩn danh";
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

    if (action === "translate") {
      const { data: c } = await admin.from("translations").select("data,author,ts").eq("key", key).maybeSingle();
      if (c) return json({ cached: true, data: c.data, author: c.author, ts: c.ts });
      const blocked = checkQuota(); if (blocked) return blocked;
      const o: Record<string, string> = {};
      Object.entries(q.o ?? {}).slice(0, 10).forEach(([k, v]) => { o[str(k, 2)] = str(v, 600); });
      const payload = JSON.stringify({ t: str(q.t, 2500), o });
      let out = "";
      try {
        out = await callAI(TRANSLATE_SYSTEM, payload, 1200);
      } catch (e) {
        if (!/^Dịch vụ AI trả lỗi 4\d\d.*(limit|context|token|too (long|large))/i.test(e instanceof Error ? e.message : String(e))) throw e;
        out = await callAI(TRANSLATE_SYSTEM, payload, 700);
      }
      const m = out.match(/\{[\s\S]*\}/);
      if (!m) return json({ error: "AI trả về không đúng định dạng" }, 502);
      const data = JSON.parse(m[0]);
      const row = { key, data, author, ts: Date.now() };
      await admin.from("translations").upsert(row);
      await bump();
      return json({ cached: false, data, author, ts: row.ts });
    }

    return json({ error: "Hành động không hợp lệ" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
