-- FE Study — cấu trúc dữ liệu cho Supabase (giải thích AI dùng chung + đếm lượt AI).
-- Cách dùng: Supabase → SQL Editor → New query → dán TOÀN BỘ file này → Run.
-- Chạy lại nhiều lần vẫn an toàn.

-- 1) Cấu hình riêng của máy chủ (giới hạn lượt AI). Không có policy => trình duyệt KHÔNG đọc được.
create table if not exists public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;
insert into public.app_config (key, value) values
  ('ai_device_limit', '50'),    -- số lượt gọi AI tối đa / thiết bị / ngày
  ('ai_global_limit', '300')    -- trần toàn hệ thống / ngày (chốt chặn cuối cùng)
on conflict (key) do nothing;

-- 2) Giải thích AI + bản dịch dùng chung.
--    Ai mở trang cũng ĐỌC được (không cần mã). Chỉ máy chủ (Edge Function "ai") mới ghi được.
create table if not exists public.explanations (
  key    text primary key,
  text   text   not null,
  author text   not null,
  model  text,
  ts     bigint not null
);
create table if not exists public.translations (
  key    text primary key,
  data   jsonb  not null,
  author text   not null,
  ts     bigint not null
);
alter table public.explanations enable row level security;
alter table public.translations enable row level security;
drop policy if exists explanations_read on public.explanations;
drop policy if exists translations_read on public.translations;
create policy explanations_read on public.explanations for select to anon, authenticated using (true);
create policy translations_read on public.translations for select to anon, authenticated using (true);

-- 3) Đếm lượt gọi AI mỗi ngày (chỉ máy chủ dùng). scope = 'global' hoặc 'dev:<mã thiết bị>'
create table if not exists public.ai_usage (
  scope text not null,
  day   date not null,
  n     int  not null default 0,
  primary key (scope, day)
);
alter table public.ai_usage enable row level security;
