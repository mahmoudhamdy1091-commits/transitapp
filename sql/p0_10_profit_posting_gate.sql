-- ════════════════════════════════════════════════════════════
-- ⛔ P0-10 — حارس ترحيل الأرباح على السيرفر (مسودة — **المالك بس يقرر يشغّلها**)
-- قرار المالك 2026-09-28: «امنع الترحيل لحد ما الشروط تتحقق».
--
-- الحارس في الشاشة (js/core.js: PROFIT_POSTING_GATE_OPEN = false) بيقفل الزرار
-- وpostFileProfitAll. لكن أي حد عنده session ممكن ينادي الـRPC من الـconsole
-- مباشرة (apiRpc('post_file_profit_all', …)). الملف ده بيقفل الباب ده كمان.
--
-- الطريقة: **من غير ما نلمس جسم الدالة** (عشان مانخاطرش بنسخة مختلفة عن اللي
-- على السيرفر): الدالة الأصلية تتسمّى post_file_profit_all_impl ويتشال تنفيذها
-- من authenticated/anon، وبنفس الاسم القديم والتوقيع يتعمل غلاف بيبص على جدول
-- بوابات صغير، ولو مقفولة بيرفض قبل أي كتابة.
--
-- نفّذه إنت في Supabase SQL Editor، مرة واحدة. لو اتشغّل تاني، الخطوة ٠ بتوقفه
-- برسالة قبل أي تغيير. قبل التشغيل شغّل الفحصين («فحص قبل» و«فحص نوع الرجوع») تحت.
-- ════════════════════════════════════════════════════════════

-- ── فحص قبل (قراءة بس) — لازم يطلع صف واحد اسمه post_file_profit_all ومفيش _impl
-- select proname, pg_get_function_identity_arguments(oid) args, prosecdef
--   from pg_proc where proname in ('post_file_profit_all','post_file_profit_all_impl');
--
-- ── فحص نوع الرجوع (قراءة بس) — ⚠️ لازم يطابق returns table بتاع الغلاف تحت
-- (خطوة ٣) **بالحرف**. لو مختلف ماتشغّلش الملف: return query هيقع أول ما البوابة تتفتح.
-- select pg_get_function_result(oid) from pg_proc where proname = 'post_file_profit_all';
-- المتوقع:
-- TABLE(posting_id uuid, entry_no text, recipient text, recipient_kind text, file_profit numeric, share_percent numeric, amount numeric, already_posted boolean)

begin;

-- ٠) حماية من التشغيل مرتين: لو الحارس متركّب قبل كده (الـ_impl موجودة) وقّف هنا
do $guard$
begin
  if exists (select 1 from pg_proc where proname = 'post_file_profit_all_impl') then
    raise exception 'الحارس متركّب قبل كده (post_file_profit_all_impl موجودة) — ماتشغّلش الملف تاني. للفتح استخدم update app_gates تحت.';
  end if;
end
$guard$;

-- ١) جدول البوابات (صف لكل بوابة). RLS شغّال ومن غير أي policy، يعني
--    anon/authenticated ما يقدروش يقروه ولا يكتبوه من الـAPI. الغلاف
--    security definer فبيقراه عادي.
create table if not exists app_gates (
  gate_key   text primary key,
  is_open    boolean not null default false,
  changed_by text,
  changed_at timestamptz not null default now(),
  note       text
);
alter table app_gates enable row level security;
revoke all on table app_gates from anon, authenticated;

insert into app_gates (gate_key, is_open, changed_by, note)
values ('profit_posting', false, 'owner',
        'P0-10: ممنوع ترحيل الأرباح لحد ما الخمس شروط يتحققوا (D-1، D-7، قاعدة القفل مرحلة ق، P4-4، مراجعة ملف ملف مع المالك)')
on conflict (gate_key) do nothing;

-- ٢) الدالة الأصلية تتسمّى _impl ومحدش من الـAPI يقدر ينفّذها مباشرة
alter function post_file_profit_all(text, text) rename to post_file_profit_all_impl;
revoke execute on function post_file_profit_all_impl(text, text) from public, anon, authenticated;

-- ٣) الغلاف بنفس الاسم والتوقيع ونوع الرجوع بالظبط
create function post_file_profit_all(
  p_sys      text,
  p_file_no  text
) returns table(
  posting_id      uuid,
  entry_no        text,
  recipient       text,
  recipient_kind  text,
  file_profit     numeric,
  share_percent   numeric,
  amount          numeric,
  already_posted  boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not coalesce((select g.is_open from app_gates g where g.gate_key = 'profit_posting'), false) then
    raise exception 'ترحيل الأرباح مقفول لحد ما الشروط تتحقق (P0-10) — القرار عند المالك'
      using errcode = 'P0001';
  end if;
  return query select * from post_file_profit_all_impl(p_sys, p_file_no);
end;
$fn$;

revoke execute on function post_file_profit_all(text, text) from public, anon;
grant  execute on function post_file_profit_all(text, text) to authenticated;

commit;

-- ── تحقق بعد (قراءة بس)
-- 1) الاتنين موجودين، والغلاف security definer:
-- select proname, pg_get_function_identity_arguments(oid) args, prosecdef
--   from pg_proc where proname in ('post_file_profit_all','post_file_profit_all_impl');
-- 2) authenticated يقدر ينفّذ الغلاف بس، مش الـ_impl:
-- select has_function_privilege('authenticated', 'post_file_profit_all(text,text)', 'execute')      as wrapper_ok,   -- true
--        has_function_privilege('authenticated', 'post_file_profit_all_impl(text,text)', 'execute') as impl_blocked; -- false
-- 3) البوابة مقفولة:
-- select * from app_gates where gate_key = 'profit_posting';   -- is_open = false
-- (مفيش نداء فعلي للدالة هنا: التحقق من الرفض بيتعمل من الشاشة/الـconsole بحاجز.)

-- ════════════════════════════════════════════════════════════
-- 🔓 فتح البوابة بعدين (بقرار المالك بس، بعد ما الخمس شروط يتحققوا) — خطوتين:
--   (أ) SQL:  update app_gates set is_open = true, changed_by = 'owner', changed_at = now(),
--                note = 'فتح بقرار المالك بتاريخ …' where gate_key = 'profit_posting';
--   (ب) JS:   PROFIT_POSTING_GATE_OPEN = true في js/core.js + نشر.
-- وللقفل تاني: نفس الـupdate بـis_open = false.
-- ════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════
-- ↩️ رجوع كامل (لو المالك قرر يشيل الحارس خالص — مش فتح، شيل):
-- begin;
--   drop function post_file_profit_all(text, text);
--   alter function post_file_profit_all_impl(text, text) rename to post_file_profit_all;
--   grant execute on function post_file_profit_all(text, text) to authenticated;
-- commit;
-- (جدول app_gates ممكن يفضل، مش مؤذي.)
-- ════════════════════════════════════════════════════════════
