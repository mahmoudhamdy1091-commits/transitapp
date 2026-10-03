-- N-35 (أمن، تسريب حي — اكتُشف 2026-10-03 في جرد N-31 رقم ٢): public.v_trial_balance
-- كان بيتقري بالمفتاح العام (anon) من غير أي دخول.
--
-- السبب:
--   - الـview اتعمل من الـdashboard (مش موجود في sql/، ومش مستخدم في js/ ولا public/ ولا index.html).
--   - صاحبه postgres، ومن غير security_invoker ⇒ بيتنفّذ بصلاحية صاحبه، فبيعدّي الـRLS اللي اتقفلت
--     على anon في 2026-08-18 (journal_entries).
--   - وanon عنده SELECT عليه (الصلاحيات الافتراضية لأي جدول/view جديد في public على Supabase).
--   ⇒ أي حد بيفتح الموقع كان يقدر يقرا ميزان المراجعة كله (account_code/account_name/total_dr/total_cr/
--     balance لـBOX وTM — 37 صف).
--
-- الإصلاح (كتبه المراجع للاستعجال، و**المالك شغّله 2026-10-03** ⇒ «Success. No rows returned»):
--   (١) شيل كل صلاحيات anon وPUBLIC على الـview.
--   (٢) security_invoker = true ⇒ الـview بيتنفّذ بصلاحية اللي بيقرا، فبتطبّق عليه الـRLS بتاعة journal_entries
--       (authenticated النهارده using(true) ⇒ مفيش تغيير للمستخدمين؛ وبعد N-31 هيتفلتر حسب النظام).
--   - مفيش تغيير على authenticated أو service_role.
--   - الـview تجميعي (group by) ⇒ مش قابل للتعديل أصلًا، فالـSELECT هو كل اللي يهم.
--
-- شغّله في Supabase SQL Editor. آمن يتكرر (revoke وset idempotent).

-- ════════════════════════════════════════════════════════════
-- فحص قبل (قراءة بس) — سجّل النتيجة
-- ════════════════════════════════════════════════════════════
-- select c.relname, pg_get_userbyid(c.relowner) as owner, c.reloptions, c.relacl,
--        has_table_privilege('anon', c.oid, 'SELECT')          as anon_select,
--        has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select
--   from pg_class c where c.oid = 'public.v_trial_balance'::regclass;
-- المتوقع قبل: reloptions = null، anon_select = true.

-- ════════════════════════════════════════════════════════════
-- الإصلاح
-- ════════════════════════════════════════════════════════════
begin;
revoke all on public.v_trial_balance from anon, public;
alter view public.v_trial_balance set (security_invoker = true);
commit;

-- ════════════════════════════════════════════════════════════
-- تحقق بعد
-- ════════════════════════════════════════════════════════════
-- (١) نفس استعلام «فحص قبل» ⇒ المتوقع: reloptions = {security_invoker=true}، anon_select = false،
--     authenticated_select = true.
-- (٢) من برّه (المفتاح العام، من غير دخول):
--     GET /rest/v1/v_trial_balance?limit=2 ⇒ المتوقع 401 و{"code":"42501","message":"permission denied for view v_trial_balance"}
--     (مش 200 ولا 206).
-- (٣) بجلسة مستخدم (authenticated) ⇒ نفس عدد الصفوف زي قبل (37 النهارده).
--
-- الدليل الحي (2026-10-03):
--   قبل (المراجع، المفتاح العام): 206 و`0-1/37` — صفوف account_code/account_name/total_dr/total_cr/balance لـBOX وTM.
--   بعد (٢): المنفّذ 19:01:49Z ⇒ 401 / 42501 «permission denied for view v_trial_balance» بالمفتاح العام
--            (sb_publishable…)؛ والمراجع 3 محاولات 19:02Z ⇒ 401 نفس الرسالة ✅.
--   بعد (٣): test.verify (authenticated) ⇒ 206، `0-0/37` ✅ (security_invoker + RLS journal_entries الحالية true).
--   (١): اختياري — has_table_privilege('anon', 'public.v_trial_balance', 'select') = false، وreloptions فيها
--        security_invoker=true. (٢) لوحده بيثبت إن anon اتشال.

-- ════════════════════════════════════════════════════════════
-- رجوع (لو حاجة اتكسرت — مستبعد: الـview مش مستخدم في التطبيق)
-- ════════════════════════════════════════════════════════════
-- alter view public.v_trial_balance reset (security_invoker);
-- ⚠️ ماترجّعش صلاحية anon أبدًا — ده بيرجّع التسريب. لو التطبيق احتاج الـview، يتقرا بجلسة مستخدم بس.
