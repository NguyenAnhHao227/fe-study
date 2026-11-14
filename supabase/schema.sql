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

-- 4) Thống kê ẩn danh (chỉ đếm thiết bị bằng mã ngẫu nhiên; không lưu tên, không lưu IP).
--    Trình duyệt KHÔNG đọc/ghi trực tiếp các bảng này; chỉ máy chủ (Edge Function) mới dùng.
create table if not exists public.visit_days (
  device text not null,
  day    date not null,
  primary key (device, day)
);
create table if not exists public.subject_days (
  device   text not null,
  day      date not null,
  subject  text not null,
  sessions int  not null default 0,   -- số bài đã nộp
  answers  int  not null default 0,   -- số câu đã trả lời
  primary key (device, day, subject)
);
alter table public.visit_days   enable row level security;
alter table public.subject_days enable row level security;

-- Ghi nhận một lượt dùng (gọi từ Edge Function bằng service_role)
create or replace function public.fe_track(p_device text, p_subject text, p_sessions int, p_answers int)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- chống tràn dữ liệu rác: mỗi ngày tối đa 5000 thiết bị mới
  if not exists (select 1 from visit_days where device = p_device and day = current_date)
     and (select count(*) from visit_days where day = current_date) >= 5000 then
    return;
  end if;
  insert into visit_days (device, day) values (p_device, current_date) on conflict do nothing;
  if p_subject is not null then
    insert into subject_days (device, day, subject, sessions, answers)
    values (p_device, current_date, p_subject, coalesce(p_sessions, 0), coalesce(p_answers, 0))
    on conflict (device, day, subject) do update
      set sessions = subject_days.sessions + excluded.sessions,
          answers  = subject_days.answers  + excluded.answers;
  end if;
end $$;

-- Tổng hợp số liệu cho trang quản trị
create or replace function public.fe_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'today',          current_date,
    'devices_total',  (select count(distinct device) from visit_days),
    'active_today',   (select count(*) from visit_days where day = current_date),
    'active_7d',      (select count(distinct device) from visit_days where day >= current_date - 6),
    'new_7d',         (select count(*) from (select device, min(day) as d from visit_days group by device) t where d >= current_date - 6),
    'returning_7d',   (select count(*) from (select device from visit_days where day >= current_date - 6 group by device having count(*) >= 2) t),
    'daily',          (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'n', n) order by day), '[]'::jsonb)
                       from (select day, count(*) as n from visit_days where day >= current_date - 13 group by day) t),
    'explanations',   (select count(*) from explanations),
    'translations',   (select count(*) from translations),
    'ai_today',       coalesce((select n from ai_usage where scope = 'global' and day = current_date), 0),
    'ai_total',       coalesce((select sum(n) from ai_usage where scope = 'global'), 0),
    'ai_devices',     (select count(distinct scope) from ai_usage where scope like 'dev:%'),
    'ai_daily',       (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'n', n) order by day), '[]'::jsonb)
                       from (select day, n from ai_usage where scope = 'global' and day >= current_date - 13) t),
    'subjects',       (select coalesce(jsonb_agg(jsonb_build_object('subject', subject, 'devices', devices, 'devices_7d', devices_7d, 'sessions', sessions, 'answers', answers) order by devices desc, answers desc), '[]'::jsonb)
                       from (select subject,
                                    count(distinct device) as devices,
                                    count(distinct device) filter (where day >= current_date - 6) as devices_7d,
                                    sum(sessions)::int as sessions,
                                    sum(answers)::int  as answers
                             from subject_days group by subject) t)
  )
$$;

-- Chỉ service_role (Edge Function) được gọi hai hàm này; trình duyệt thì không.
revoke all on function public.fe_track(text, text, int, int) from public, anon, authenticated;
revoke all on function public.fe_stats() from public, anon, authenticated;
grant execute on function public.fe_track(text, text, int, int) to service_role;
grant execute on function public.fe_stats() to service_role;
