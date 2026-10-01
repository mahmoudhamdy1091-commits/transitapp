-- ════════════════════════════════════════════════════════════
-- N-28 + N-26b (أمن، قرار المالك 2026-10-01: «2 أيوه، 3 زي ما اقترحت»)
-- مسودة — **المالك بس يشغّلها، بعد مراجعة «فحص قبل» والمراجع يقارن.**
--
-- N-28: user_roles فيها INSERT/UPDATE/DELETE لأي مستخدم مسجّل ⇒ أي حد يقدر يخلّي نفسه admin من
--       الـconsole، وكل فحوص الـadmin (create_partner_account، create_custody_holder،
--       post_file_profit_all، fleet void…) بتعتمد على الجدول ده.
--       ⇒ الكتابة على user_roles للـadmin بس (is_app_admin())؛ القراءة لأي مسجّل زي ما هي.
-- N-26b: دوال security definer **من غير فحص دور جوّاها** ⇒ بعد N-26 أي مستخدم مسجّل (حتى readonly)
--       يقدر يناديها من الـconsole. قرار المالك:
--         delete_deal_completely                              ⇐ admin بس
--         post_sale_je · create/update_partner_ledger_entry   ⇐ admin + employee
--       ⚠️ next_je_no **مش متغلّفة** (مراجعة 10-01): _jeNo في engine.js بيعمل catch لأي خطأ ويرجع
--       لترقيم مش ذرّي (JE-YYYY-<آخر id+1>) ⇒ رفض الـwrapper مكانش هيمنع الترحيل، كان هيخلّيه برقم
--       ممكن يتكرر بصمت = حماية صفر وضرر محتمل. (N-30: الـfallback لازم يشتغل بس لـ«الدالة مش موجودة»
--       — إصلاح JS منفصل بعدين.)
--
-- ⚠️ N-31 (إفصاح): الـRLS على الجداول نفسها بتعدّي الـwrappers — مثلًا partner_ledger_all «for all to
--   authenticated using (true) with check (true)» (partner_ledger_stage_a.sql:62) ⇒ readonly يقدر يكتب
--   partner_ledger مباشرة بـREST من غير الـRPC. يعني الملف ده **طبقة أولى** (N-28 + الـwrappers)؛ الأدوار
--   على مستوى الجداول = قرار مالك بعده. «فحص قبل ٥» بيبيّن مين يقدر يكتب في كل جدول.
--
-- ═ الطريقة: wrapper/_impl (مش تعديل الجسم) ═
--   الدالة الأصلية بتتعمل rename لـ<name>_impl **من غير ما جسمها يتلمس**، ودالة جديدة بنفس الاسم
--   والتوقيع والـdefaults ونوع الرجوع (متاخدين من الكتالوج الحي نفسه: pg_get_function_arguments /
--   pg_get_function_result) بتفحص الدور وبعدين بتنادي الـ_impl. ليه مش تعديل الجسم + md5:
--   (١) الحي ممكن يكون مختلف عن الريبو (اتثبت: fleet.is_fleet_user secdef على الحي وفي الريبو لأ)
--       ⇒ تعديل الجسم كان محتاج نسخة حية مطابقة بالحرف لكل دالة؛ الـwrapper مش محتاج يعرف الجسم.
--   (٢) مفيش خطر غلطة نقل في جسم طويل (post_sale_je/delete_deal_completely).
--   (٣) الرجوع = drop للـwrapper + rename للـ_impl، من غير إعادة كتابة أي جسم.
--   الـ_impl: execute لـservice_role بس (مش authenticated) ⇒ مفيش طريق يعدّي الفحص من الـAPI.
--   ⚠️ B-2e لازم يتعمله rebase بعد الملف ده: create/update_partner_ledger_entry بقوا wrappers،
--   والـmd5 guard والتعديل يبقوا على الـ_impl (مقبول — N-26b أمن وبيسبق).
--
-- ═ مين بيعدّي الفحص (app_assert_role) ═
--   • session_user ≠ 'authenticator' ⇒ يعدّي: ده الـSQL Editor وسكريبتات المالك (postgres) وpg_cron.
--     ⚠️ مش current_user — جوّه security definer الـcurrent_user دايمًا = صاحب الدالة (postgres)، فكان
--     هيعدّي الكل. session_user بيفضل 'authenticator' لكل طلب جاي من الـAPI (PostgREST بيعمل SET ROLE
--     بس) ⇒ الفحص بيتطبّق على كل نداء من التطبيق.
--   • auth.role() = 'service_role' ⇒ يعدّي.
--   • غير كده: الدور = app_role(النظام) بنفس منطق create_partner_account بالحرف (TM = TM أو TRANSIT،
--     والترتيب admin > employee > readonly، وcoalesce ⇒ مفيش fail-open).
--   النداءات الداخلية بالاسم جوّه plpgsql بتتحلّ وقت التشغيل ⇒ بتروح للـwrapper بنفس JWT الطلب ⇒ نفس
--   المستخدم. (next_je_no مش متغلّفة، فـpost_sale_je_impl/post_file_profit_all بينادوها زي ما هي.)
--   ⚠️ أي حاجة مربوطة بالـOID (column DEFAULT / view / policy / CHECK / trigger / index / دالة SQL-standard)
--   كانت هتفضل تشاور على الـ_impl بعد الـrename، والـ_impl اتسحب منها authenticated ⇒ permission denied.
--   ⇒ حارس جوّه الـtransaction (pg_depend) بيوقف الملف ويقول اسم التابع لو فيه أي واحد.
-- ════════════════════════════════════════════════════════════

-- ── فحص قبل (قراءة بس) — ابعت النواتج كاملة للمراجعة ──────
-- 1) الدوال الأربعة: نسخة واحدة لكل واحدة، ومفيش _impl قبل كده (المتوقع 4 صفوف، و0 _impl):
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
--        p.prosecdef, has_function_privilege('anon', p.oid, 'execute') as anon_exec,
--        has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and (p.proname in ('delete_deal_completely','post_sale_je',
--        'create_partner_ledger_entry','update_partner_ledger_entry') or p.proname like '%\_impl')
--  order by 1;
-- 2) user_roles: RLS مفعّلة ومش FORCE (المتوقع rls=true, force=false):
-- select relrowsecurity as rls, relforcerowsecurity as force from pg_class where oid = 'public.user_roles'::regclass;
-- 3) الـpolicies الحالية على user_roles (دي اللي الرجوع بيتبني منها — والملف بيحفظها في جدول backup):
-- select policyname, permissive, roles, cmd, qual, with_check from pg_policies
--  where schemaname = 'public' and tablename = 'user_roles' order by policyname;
-- 4) الـadmins، ومين ممكن يتقفل غلط (systems فاضي ⇒ app_role = '' ⇒ هيتمنع):
-- select email, role, systems, system_type from public.user_roles order by role, email;
-- select email, role from public.user_roles where role in ('admin','employee') and coalesce(systems,'') = '';
--    (لو التاني رجع صفوف ⇒ الملف بيقف لوحده — صلّحهم الأول.)
-- 5) (N-31) مين يقدر يكتب في كل جدول (الـpolicies غير SELECT في public وfleet):
-- select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies
--  where schemaname in ('public','fleet') and cmd <> 'SELECT' order by 1, 2, 3;
-- 6) التوابع المربوطة بالـOID للدوال الأربعة (المتوقع 0 صفوف — والملف بيقف لوحده لو فيه):
-- select pg_describe_object(d.classid, d.objid, d.objsubid) as dependent, d.refobjid::regprocedure as fn
--   from pg_depend d
--  where d.refclassid = 'pg_proc'::regclass and d.deptype = 'n'
--    and d.refobjid in (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--                        where n.nspname = 'public' and p.proname in ('delete_deal_completely','post_sale_je',
--                              'create_partner_ledger_entry','update_partner_ledger_entry'));

begin;

-- ⚠️ لازم المالك يكتب إيميله هنا (اللي بيدخل بيه وعليه admin) — الملف بيقف لو لسه زي ما هو
do $n28_cfg$ begin perform set_config('n28.owner_email', 'PUT-OWNER-EMAIL-HERE', true); end $n28_cfg$;

-- ── حراس قبل أي تغيير ──
do $n28_pre$
declare
  v_owner text := current_setting('n28.owner_email', true);
  v_n     int;
  v_bad   text;
begin
  if v_owner is null or v_owner = 'PUT-OWNER-EMAIL-HERE' or v_owner !~ '@' then
    raise exception 'اكتب إيميل المالك في السطر بتاع n28.owner_email قبل التشغيل';
  end if;
  if not exists (select 1 from public.user_roles where email = v_owner and role = 'admin') then
    raise exception 'الإيميل % مش admin في user_roles — وقف (عشان محدش يقفل على نفسه إدارة المستخدمين)', v_owner;
  end if;
  if (select count(*) from public.user_roles where role = 'admin') < 1 then
    raise exception 'مفيش ولا admin في user_roles — وقف';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.user_roles'::regclass) then
    raise exception 'RLS مش مفعّلة على user_roles — وقف وراجع';
  end if;
  if (select relforcerowsecurity from pg_class where oid = 'public.user_roles'::regclass) then
    raise exception 'user_roles عليها FORCE RLS ⇒ is_app_admin هتعمل recursion — وقف وراجع';
  end if;
  select string_agg(email || ' (' || role || ')', '، ') into v_bad
    from public.user_roles where role in ('admin','employee') and coalesce(systems, '') = '';
  if v_bad is not null then
    raise exception 'مستخدمين admin/employee من غير systems — هيتمنعوا من الدوال: % — صلّحهم الأول', v_bad;
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('delete_deal_completely','post_sale_je',
         'create_partner_ledger_entry','update_partner_ledger_entry');
  if v_n <> 4 then
    raise exception 'المتوقع 4 دوال (نسخة واحدة لكل اسم) ولقيت % — وقف وراجع', v_n;
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('delete_deal_completely_impl','post_sale_je_impl',
                    'create_partner_ledger_entry_impl','update_partner_ledger_entry_impl')) then
    raise exception 'فيه _impl موجودة قبل كده — الملف اتشغّل؟ وقف';
  end if;
  -- (١) التوابع المربوطة بالـOID: بعد الـrename كانت هتشاور على الـ_impl (اللي اتسحب منها authenticated)
  --     ⇒ permission denied وقت الـinsert/الـselect. النداءات بالاسم جوّه plpgsql مش مربوطة (بتتحلّ وقت التشغيل).
  select string_agg(pg_describe_object(d.classid, d.objid, d.objsubid) || ' ⇐ ' || d.refobjid::regprocedure::text, '؛ ')
    into v_bad
    from pg_depend d
   where d.refclassid = 'pg_proc'::regclass and d.deptype = 'n'
     and d.refobjid in (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname in ('delete_deal_completely','post_sale_je',
                               'create_partner_ledger_entry','update_partner_ledger_entry'));
  if v_bad is not null then
    raise exception 'فيه حاجات مربوطة بالدوال دي بالـOID (هتشاور على _impl بعد الـrename): % — وقف وراجع', v_bad;
  end if;
end
$n28_pre$;

-- ── backup للـpolicies الحالية على user_roles (الرجوع بيتبني منها) — مقفول على الـAPI ──
create table if not exists public.n28_user_roles_policies_backup as
  select policyname, permissive, roles, cmd, qual, with_check, now() as taken_at
    from pg_policies where schemaname = 'public' and tablename = 'user_roles';
revoke all on public.n28_user_roles_policies_backup from public, anon, authenticated;
alter table public.n28_user_roles_policies_backup enable row level security;

-- ── helpers ──
-- الدور في نظام معيّن — نفس منطق create_partner_account بالحرف
create or replace function public.app_role(p_sys text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select role from public.user_roles
     where email = auth.jwt() ->> 'email'
       and exists (select 1 from unnest(case when p_sys = 'TM' then array['TM','TRANSIT'] else array[p_sys] end) t
                    where systems like '%' || t || '%')
     order by case role when 'admin' then 3 when 'employee' then 2 when 'readonly' then 1 else 0 end desc
     limit 1), '');
$$;

-- admin في أي نظام — للـpolicies بتاعة user_roles (secdef وصاحبها postgres = صاحب الجدول، والجدول
-- مش FORCE RLS ⇒ القراءة جوّاها مابتمرّش بالـpolicies ⇒ مفيش recursion)
create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.user_roles where email = auth.jwt() ->> 'email' and role = 'admin');
$$;

-- الفحص اللي الـwrappers بتناديه
create or replace function public.app_assert_role(p_sys text, p_allowed text[], p_what text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  -- SQL Editor / سكريبتات المالك / pg_cron (مش من الـAPI) ⇒ يعدّي. ⚠️ session_user مش current_user.
  if session_user <> 'authenticator' then return; end if;
  if coalesce(auth.role(), '') = 'service_role' then return; end if;
  v_role := public.app_role(p_sys);
  if not (v_role = any (p_allowed)) then
    raise exception '% مقصور على % — دورك في % «%»', p_what,
      array_to_string(p_allowed, ' أو '), coalesce(p_sys, '—'), coalesce(nullif(v_role, ''), 'مش مسجّل');
  end if;
end;
$$;

revoke execute on function public.app_role(text)                       from public, anon;
revoke execute on function public.is_app_admin()                       from public, anon;
revoke execute on function public.app_assert_role(text, text[], text)  from public, anon;
grant  execute on function public.app_role(text)                       to authenticated, service_role;
grant  execute on function public.is_app_admin()                       to authenticated, service_role;
grant  execute on function public.app_assert_role(text, text[], text)  to authenticated, service_role;

-- ── N-28: policies الكتابة على user_roles ⇒ is_app_admin() ──
do $n28_pol$
declare
  r record;
begin
  -- شيل أي policy مش SELECT (insert/update/delete/all)؛ اللي SELECT بتفضل زي ما هي
  for r in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'user_roles' and cmd <> 'SELECT'
  loop
    execute format('drop policy %I on public.user_roles', r.policyname);
    raise notice 'N-28: اتشالت policy «%»', r.policyname;
  end loop;
  -- لو القراءة كانت جوّه policy «ALL» واتشالت ⇒ رجّعها لأي مسجّل (زي ما كانت)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_roles' and cmd = 'SELECT') then
    create policy n28_user_roles_select on public.user_roles for select to authenticated using (true);
    raise notice 'N-28: اتعملت n28_user_roles_select (القراءة لأي مسجّل)';
  end if;
end
$n28_pol$;

create policy n28_user_roles_insert_admin on public.user_roles for insert to authenticated
  with check (public.is_app_admin());
create policy n28_user_roles_update_admin on public.user_roles for update to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());
create policy n28_user_roles_delete_admin on public.user_roles for delete to authenticated
  using (public.is_app_admin());

-- ── N-26b: الـwrappers ──
do $n26b$
declare
  t        record;
  v_oid    oid;
  v_args   text;     -- بالـdefaults (للـcreate)
  v_idargs text;     -- من غير defaults (للـalter/grant)
  v_res    text;
  v_names  text[];
  v_modes  "char"[];
  v_call   text;
  v_sys    text;
  v_ret    text;
  v_body   text;
  i        int;
begin
  for t in
    select * from (values
      ('delete_deal_completely',      array['admin'],             'حذف صفقة كاملة',     'param'),
      ('post_sale_je',                array['admin','employee'],  'ترحيل قيد البيع',     'param'),
      ('create_partner_ledger_entry', array['admin','employee'],  'تسجيل معاملة شريك',   'param'),
      ('update_partner_ledger_entry', array['admin','employee'],  'تعديل معاملة شريك',   'ledger_row')
    ) as x(fname, allowed, what, sys_mode)
  loop
    select p.oid, pg_get_function_arguments(p.oid), pg_get_function_identity_arguments(p.oid),
           pg_get_function_result(p.oid), p.proargnames, p.proargmodes
      into v_oid, v_args, v_idargs, v_res, v_names, v_modes
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = t.fname;

    -- النداء للـ_impl بالأسامي (IN بس — أعمدة RETURNS TABLE مش بارامترات)
    v_call := '';
    for i in 1 .. coalesce(array_length(v_names, 1), 0) loop
      if v_modes is null or v_modes[i] in ('i', 'b') then
        v_call := v_call || case when v_call = '' then '' else ', ' end || format('%1$I => %1$I', v_names[i]);
      end if;
    end loop;

    v_sys := case t.sys_mode
               when 'param' then 'p_sys'
               else '(select pl.system_type from public.partner_ledger pl where pl.id = p_id)' end;

    v_ret := case
               when v_res = 'void' then format('perform public.%I(%s); return;', t.fname || '_impl', v_call)
               when v_res ilike 'TABLE(%' or v_res ilike 'SETOF %' then
                 format('return query select * from public.%I(%s); return;', t.fname || '_impl', v_call)
               else format('return public.%I(%s);', t.fname || '_impl', v_call) end;

    v_body := format($b$
declare
  n26b_sys text;
begin
  -- N-26b (2026-10-01): فحص الدور قبل الدالة الأصلية (%1$s_impl، جسمها مااتلمسش)
  n26b_sys := %2$s;
  %3$s
  perform public.app_assert_role(n26b_sys, %4$L::text[], %5$L);
  %6$s
end;
$b$, t.fname, v_sys,
         case when t.sys_mode = 'ledger_row' then 'if n26b_sys is null then raise exception ''المعاملة غير موجودة''; end if;' else '' end,
         t.allowed, t.what, v_ret);

    execute format('alter function public.%I(%s) rename to %I', t.fname, v_idargs, t.fname || '_impl');
    execute format('revoke execute on function public.%I(%s) from public, anon, authenticated', t.fname || '_impl', v_idargs);
    execute format('grant  execute on function public.%I(%s) to service_role', t.fname || '_impl', v_idargs);

    execute format('create function public.%I(%s) returns %s language plpgsql security definer set search_path = public, pg_temp as %L',
                   t.fname, v_args, v_res, v_body);
    execute format('revoke execute on function public.%I(%s) from public, anon', t.fname, v_idargs);
    execute format('grant  execute on function public.%I(%s) to authenticated, service_role', t.fname, v_idargs);

    raise notice 'N-26b: % ⇒ wrapper (%) + %_impl', t.fname, array_to_string(t.allowed, '+'), t.fname;
  end loop;
end
$n26b$;

commit;

notify pgrst, 'reload schema';

-- ── تحقق بعد (قراءة بس) ────────────────────────────────────
-- 1) كل دالة: wrapper (auth_exec=true، anon=false) + _impl (auth_exec=false، anon=false، svc=true):
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef,
--        has_function_privilege('anon', p.oid, 'execute') as anon_exec,
--        has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
--        has_function_privilege('service_role', p.oid, 'execute') as svc_exec,
--        position('app_assert_role' in p.prosrc) > 0 as guarded
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and (p.proname in ('delete_deal_completely','post_sale_je',
--        'create_partner_ledger_entry','update_partner_ledger_entry','app_role','is_app_admin','app_assert_role')
--        or p.proname like '%\_impl')
--  order by 1;
-- 2) الـpolicies على user_roles (المتوقع: SELECT زي ما كانت + الـ3 n28_*_admin):
-- select policyname, roles, cmd, qual, with_check from pg_policies
--  where schemaname = 'public' and tablename = 'user_roles' order by policyname;
-- 3) محاكاة الدور من الـSQL Editor (من غير كتابة — rollback في الآخر). auth.jwt() بيقرا request.jwt.claims:
-- begin;
--   select set_config('request.jwt.claims', '{"email":"<إيميل admin>","role":"authenticated"}', true);
--   select public.app_role('BOX') as box, public.app_role('TM') as tm, public.is_app_admin() as admin;  -- admin/admin/true
--   select set_config('request.jwt.claims', '{"email":"<إيميل employee لو موجود>","role":"authenticated"}', true);
--   select public.app_role('BOX'), public.app_role('TM'), public.is_app_admin();                       -- employee/…/false
-- rollback;
--   (app_assert_role نفسها بتعدّي من الـSQL Editor لأن session_user = postgres — ده مقصود؛ فحصها الحقيقي
--    من التطبيق: المنفّذ بيعمل فحص حي بحساب admin، ولو فيه employee/readonly حقيقي يتنسّق.)
-- 4) **شرط الـprobes:** جسم الـ_impl = الريبو بالحرف (الـrename مابيلمسش الجسم) — المتوقع:
-- select p.proname, md5(replace(p.prosrc, E'\r', '')) as md5_lf from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname like '%\_impl' order by 1;
--      create_partner_ledger_entry_impl  7b9ff32b8ddce810307084321275c01c
--      delete_deal_completely_impl       7eb7b89a3d00b56f7ce073fd720f6473
--      post_sale_je_impl                 f0106cdeffc20fa793cf97f4fac6b6fe
--      update_partner_ledger_entry_impl  d4f424b7ee41ed66740eb0b88ba70d0b
--    أي دالة الـmd5 بتاعها مختلف ⇒ **الـprobe بتاعها مايتعملش** لحد ما pg_get_functiondef يتراجع.
-- 5) **probes حية من غير كتابة** (المنفّذ، من التطبيق بحساب admin — session_user = authenticator ⇒ الفحص
--    بيتطبّق): مدخل بيعدّي فحص الدور، والـ_impl نفسه بيرفضه في **أول سطوره قبل أي كتابة** ⇒ الرسالة
--    اللي بترجع = رسالة الـ_impl ⇒ السلسلة كلها (wrapper ← role ← _impl) شغّالة. حاجز التطبيق بيسمح بالـ4
--    نداءات دول بس، وأي كتابة تانية مرفوضة:
--    • create_partner_ledger_entry(p_sys 'TM', p_partner 'ZZ-N26B', p_entry_type 'ZZ-N26B-PROBE', p_pay_date اليوم)
--        ⇒ «نوع حركة غير معروف: ZZ-N26B-PROBE» (تاني فحص، قبل أي قراءة/قفل/كتابة)
--    • post_sale_je(p_sys 'TM', …, p_sold_vins '{}', p_sale_amount 0)
--        ⇒ «قيمة فاتورة بيع غير صالحة (0)» (أول سطر)
--    • delete_deal_completely(p_sys 'BOX', p_file_no 'ZZ-N26B-PROBE-NOFILE')
--        ⇒ «لا يوجد ملف بهذا الرقم …» (select … for update على ملف مش موجود ⇒ صفر صفوف، قبل أي delete)
--    • update_partner_ledger_entry(p_id = PAY-BOX-127-001 «voided»، cef5fb7c-7b73-446b-91d4-92f0de76b2d4)
--        ⇒ «لا يمكن تعديل معاملة ملغاة بقيد عكسي …» (قفل الصف for update لحظيًا ثم رفض قبل أي update)
--    والعكس: لو فيه حساب readonly حقيقي (فحص قبل ٤) ⇒ نفس النداءات ⇒ «… مقصور على …» من الـwrapper.

-- ════════════════════════════════════════════════════════════
-- ↩️ رجوع:
-- begin;
-- do $r$ declare t text; v_id text; r record; begin
--   foreach t in array array['delete_deal_completely','post_sale_je',
--                            'create_partner_ledger_entry','update_partner_ledger_entry'] loop
--     select pg_get_function_identity_arguments(p.oid) into v_id from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = t || '_impl';
--     if v_id is null then continue; end if;
--     execute format('drop function if exists public.%I(%s)', t, v_id);
--     execute format('alter function public.%I(%s) rename to %I', t || '_impl', v_id, t);
--     execute format('revoke execute on function public.%I(%s) from public, anon', t, v_id);
--     execute format('grant execute on function public.%I(%s) to authenticated, service_role', t, v_id);
--   end loop;
--   drop policy if exists n28_user_roles_insert_admin on public.user_roles;
--   drop policy if exists n28_user_roles_update_admin on public.user_roles;
--   drop policy if exists n28_user_roles_delete_admin on public.user_roles;
--   drop policy if exists n28_user_roles_select on public.user_roles;
--   -- كل policy كانت موجودة قبل الملف ومش موجودة دلوقتي ⇒ ترجع بتعريفها المحفوظ بالحرف
--   for r in select b.* from public.n28_user_roles_policies_backup b
--             where not exists (select 1 from pg_policies p where p.schemaname = 'public'
--                                 and p.tablename = 'user_roles' and p.policyname = b.policyname)
--   loop
--     execute format('create policy %I on public.user_roles as %s for %s to %s %s %s', r.policyname, r.permissive, r.cmd,
--       (select string_agg(quote_ident(x), ', ') from unnest(r.roles) x),
--       case when r.qual is not null then 'using (' || r.qual || ')' else '' end,
--       case when r.with_check is not null then 'with check (' || r.with_check || ')' else '' end);
--   end loop;
-- end $r$;
-- drop function if exists public.app_assert_role(text, text[], text);
-- drop function if exists public.is_app_admin();
-- drop function if exists public.app_role(text);
-- commit;
-- notify pgrst, 'reload schema';
-- (جدول n28_user_roles_policies_backup يتساب أو يتشال بعد التأكد.)
-- ════════════════════════════════════════════════════════════
