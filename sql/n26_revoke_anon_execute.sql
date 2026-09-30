-- ════════════════════════════════════════════════════════════
-- N-26 (أمان، 2026-09-30) — شيل صلاحية التنفيذ من anon/PUBLIC على دوال security definer
-- مسودة — **المالك بس يشغّلها، وبعد ما المراجع يقارنها بنتيجة «فحص قبل ١».**
--
-- المشكلة: الدوال دي بتتنفّذ بصلاحيات صاحبها (security definer)، وكتير منها من غير أي فحص صلاحية
-- جوّاها. PostgreSQL بيدي EXECUTE لـPUBLIC افتراضيًا على أي دالة جديدة، وanon عضو في PUBLIC،
-- وملفات الإنشاء عملت grant لـauthenticated بس من غير revoke. يعني المفتاح العام اللي في الموقع (anon)
-- ممكن يقدر ينادي مثلًا delete_deal_completely أو post_sale_je أو create_partner_ledger_entry مباشرة.
-- (وrevoke fleet القديم — fleet_schema.sql:724 — كان «from anon» بس، فـanon ممكن لسه واخدها عن طريق PUBLIC.)
--
-- الأخطر (من غير فحص صلاحية جوّا — جرد sql/):
--   public.delete_deal_completely · public.post_sale_je · public.create_partner_ledger_entry
--   public.update_partner_ledger_entry · public.next_je_no
--   fleet.fleet_next_vehicle_file_no · fleet._assign_vehicle_file_no (trigger) · fleet.fleet_user_role
--   (+ دوال fleet الـ11 بتاعة fleet_schema.sql لو لسه anon واخدها عن طريق PUBLIC)
-- اللي فيها فحص admin جوّاها (مش مكشوفة فعليًا بس بتتقفل برضه — دفاع إضافي):
--   create_partner_account · rename_partner · post_profit_for_file · post_treasury_profit_for_file
--   post_file_profit_all · create_custody_holder (دي أصلًا اتقفلت في B-2a)
--
-- اللي بيتعمل:
--  (١) لكل دالة security definer **بتاعتنا** في public وfleet (مش جزء من extension):
--        revoke execute from public, anon   ← لازم الاتنين: anon عضو في PUBLIC
--        grant  execute to service_role
--        grant  execute to authenticated **لو كان معاه قبل كده بس** (نفس الصلاحية الحالية بالظبط —
--        مانديش authenticated حاجة ماكانتش معاه، ولا ناخد منه حاجة كانت معاه).
--  (٢) default privileges للدوال **الجاية**: شيل PUBLIC عالميًا + anon في public وfleet، وخلّي
--      authenticated وservice_role بياخدوا افتراضي. ⚠️ الـdefault بيغطّي الدوال اللي بيعملها postgres
--      بس (SQL Editor)؛ لو دالة اتعملت بدور تاني (supabase_admin) — اعملها grant/revoke صريح.
--  (٣) الدوال الـinvoker (من غير security definer) ماتلمستش: بتتنفّذ بصلاحيات المستدعي نفسه، فanon
--      مايقدرش يعمل بيها أكتر من اللي يقدر يعمله أصلًا. والدالة الوحيدة جوّا RLS policy هي
--      fleet.is_fleet_user() والـpolicies كلها «to authenticated» ⇒ مش متأثرة.
--
-- ⚠️ تحذير لأي حد بيكتب SQL بعد كده: **أي دالة security definer جديدة لازم يكون فيها فحص صلاحية
-- جوّاها، وrevoke execute from public, anon + grant لـauthenticated صريح في نفس الملف** (زي B-2a).
--
-- التطبيق مابيحتاجش anon: كل نداءات RPC في js/ وpublic/fleet/js/ بتحصل بعد تسجيل الدخول (Bearer token)؛
-- قبل الدخول/بعد انتهاء الجلسة الطلب بيروح بالمفتاح العام ⇒ بعد الملف ده بيترفض بدل ما يتنفّذ.
-- ════════════════════════════════════════════════════════════

-- ── فحص قبل ١ (قراءة بس) — ابعت الناتج كامل للمراجعة ──────────
-- select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as secdef,
--        pg_get_userbyid(p.proowner) as owner,
--        exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') as ext_member,
--        has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
--        has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
--        has_function_privilege('service_role', p.oid, 'execute')  as svc_exec
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname in ('public','fleet') and p.prokind = 'f'
--  order by p.prosecdef desc, anon_exec desc, 1, 2;
-- ── فحص قبل ٢: الـdefault privileges الحالية ──
-- select pg_get_userbyid(defaclrole) as role, defaclnamespace::regnamespace as schema, defaclobjtype, defaclacl
--   from pg_default_acl order by 1, 2;
-- ── فحص قبل ٣: الـpolicies **الحية** اللي anon/public بيقيّموها (الريبو مش كفاية — فيه policies
--    ممكن تكون اتعملت من الـdashboard مباشرة، زي lockdown 08-18). لو واحدة فيها بتنادي دالة secdef
--    من قايمة «قبل ١»، anon هياخد «permission denied for function» بدل صفر صفوف ⇒ **الدالة دي
--    تتستثنى بالاسم من اللوب** (and p.proname <> '…') قبل التشغيل:
-- select schemaname, tablename, policyname, roles, cmd, qual, with_check
--   from pg_policies
--  where schemaname in ('public','fleet') and ('anon' = any(roles) or 'public' = any(roles))
--  order by 1, 2, 3;

begin;

do $n26$
declare
  r        record;
  v_n      int := 0;
  v_auth   boolean;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','fleet') and p.prokind = 'f' and p.prosecdef
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     order by 2
  loop
    v_auth := has_function_privilege('authenticated', r.oid, 'execute');   -- قبل الـrevoke
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    if v_auth then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    v_n := v_n + 1;
    raise notice 'N-26: %  (anon/public ✗، authenticated %)', r.sig, case when v_auth then '✓' else '✗ (ماكانش معاه)' end;
  end loop;
  raise notice 'N-26: اتقفلت % دالة security definer', v_n;
end
$n26$;

-- (٢) الدوال الجاية
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema fleet  revoke execute on functions from anon;
alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;
alter default privileges for role postgres in schema fleet  grant execute on functions to authenticated, service_role;

commit;

notify pgrst, 'reload schema';

-- ── تحقق بعد (قراءة بس) ────────────────────────────────────
-- 1) نفس «فحص قبل ١» — المتوقع: **anon_exec = false لكل secdef** (ext_member = false) في public وfleet،
--    وauth_exec = نفس قيمته قبل بالظبط، وsvc_exec = true.
-- 2) مفيش secdef لسه مكشوفة (المتوقع 0):
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname in ('public','fleet') and p.prokind = 'f' and p.prosecdef
--    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
--    and has_function_privilege('anon', p.oid, 'execute');
-- 3) الـdefault privileges (نفس «فحص قبل ٢») — المتوقع: مفيش «=X/» (PUBLIC) ولا anon على الدوال لـpostgres،
--    وauthenticated وservice_role موجودين في public وfleet.
-- 4) تجربة من التطبيق (المالك، عادي): تسجيل دخول، وفتح ملف، وقايمة الاعتمادات، وFleet — كله شغّال.
--    ومن المنفّذ: نداء قراءة بس بالمفتاح العام لدالة آمنة (مثلًا next_je_no؟ لأ — دي بتزوّد عدّاد) ⇒
--    **مفيش تجربة نداء بالمفتاح العام** (كل الدوال دي بتكتب)؛ الإثبات = الاستعلام ١ و٢.

-- ════════════════════════════════════════════════════════════
-- ↩️ رجوع (بيرجّع الافتراضي القديم: PUBLIC بياخد execute تاني ⇒ anon كمان):
-- begin;
-- do $r$ declare r record; begin
--   for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--             where n.nspname in ('public','fleet') and p.prokind = 'f' and p.prosecdef
--               and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
--   loop execute format('grant execute on function %s to public', r.sig); end loop;
-- end $r$;
-- alter default privileges for role postgres grant execute on functions to public;
-- alter default privileges for role postgres in schema public grant execute on functions to anon;
-- alter default privileges for role postgres in schema fleet  grant execute on functions to anon;
-- commit;
-- notify pgrst, 'reload schema';
-- (ملحوظة: B-2a وB-2e فيهم revoke صريح لدوالهم — الرجوع ده بيفتحهم برضه؛ لو عايز تسيبهم مقفولين،
--  استثني create_custody_holder وcreate/update_partner_ledger_entry من اللوب.)
-- ════════════════════════════════════════════════════════════
