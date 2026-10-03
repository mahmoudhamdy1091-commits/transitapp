-- ════════════════════════════════════════════════════════════
-- N-31 — صلاحيات الجداول على مستوى القاعدة (RLS حسب الدور والنظام) — المرحلة الأولى
-- مسودة — **المالك بس يشغّلها، بعد «فحص قبل» والمراجع يقارن.** التصميم: docs/DESIGN-N31-table-roles-rls.md.
-- الترتيب: N-32 ✅ ← N-28/N-26b ✅ ← N-31 (الملف ده). محتاج app_role من N-28.
--
-- المشكلة: الجداول دي عليها policy «ALL to authenticated using (true) with check (true)» ⇒ أي جلسة
--   authenticated (حتى readonly، أو أدمن FLEET بس، أو حساب مش في user_roles) تقرا وتكتب وتمسح أي صف في
--   BOX وTM مباشرة بـREST. الأدوار (permissions.js) كانت في الشاشات بس.
--
-- اللي الملف بيعمله:
--   ١) public.app_systems(p_min_role) ⇒ text[] بالأنظمة (BOX/TM) اللي المستخدم الحالي ليه فيها دور ≥ المطلوب.
--      **مبنية على app_role بتاع N-28 نفسه** (مفيش parser تاني لـuser_roles.systems) ⇒ نفس النتيجة بالظبط:
--      TM = TM أو TRANSIT، والترتيب admin > employee > readonly، وأي دور تاني/فاضي = ولا حاجة (fail-closed).
--   ٢) 22 جدول (الـ17 + sale_charges + audit_log + 3 للقراءة بس): نسخة احتياطية لكل الـpolicies الحالية + حالة الـRLS، وبعدين
--      **شيل كل الـpolicies** (مش بالاسم — permissive بتتجمع بـOR) وعمل الجديدة:
--      | الجدول | SELECT | INSERT | UPDATE | DELETE |
--      |---|---|---|---|---|
--      | الـ16 العادية | أي دور في النظام | admin/employee | admin/employee | admin/employee |
--      | contacts | أي دور | admin/employee | admin/employee | **admin** |
--      | chart_of_accounts (قرار المالك 10-03) | أي دور | **admin** | **admin** | **admin** |
--      | audit_log | أي دور | **أي دور** (الـlog بيتكتب من كل الأدوار) | **ممنوع** | **admin** |
--      | partner_account_links، custody_holders، profit_postings | أي دور | — | — | — |
--      (التلاتة الأخيرين: الكتابة بـRPC secdef بس زي ما هي — مفيش policies كتابة؛ القراءة كانت true لأي authenticated
--       ⇒ بقت بالنظام (مراجعة 10-03: «كل واحد يشوف شركته»؛ profit_postings فيها أرباح كل شريك). كل قرّاء js/ بيفلتروا
--       بالنظام الحالي أصلًا: loadPayerClassLinks/resolveMoneySource/loadCustodyHolders/_postedProfitForPartner …)
--      «في النظام» = system_type من أنظمة المستخدم؛ و`with check` بيمنع كمان نقل صف لنظام مش بتاعه.
--      الـ16: account_ledger، collections، expenses، journal_attachments، journal_entries، operating_expenses،
--      partner_accounts، partner_ledger، partner_payouts، partners_master، payments، purchase_orders،
--      sale_charges، sales، stock_locations، vehicles.
--      ⚠️ sale_charges مش من الـ17 الأصليين، بس الشاشات بتكتب فيه (modals.js:1969، system_type: state.system) ومالوش
--      policy في الريبو ⇒ داخل عشان مايفضلش مفتوح/مقفول بالغلط. (فاضي النهارده.)
--   ٣) audit_log.system_type ⇒ NOT NULL (الوحيد اللي كان nullable — جرد ٣؛ صفر null متقاس).
--   ٤) viewين fleet (v_invoice_balances، v_bill_balances) ⇒ security_invoker = true ⇒ policies الـfleet
--      (is_fleet_user) بتتطبّق عليهم (قبل كده أي authenticated كان بيقراهم — جرد ٢، PGlite).
--   ٥) **بلوك منفصل (قرار مالك — توصية):** شيل default 'BOX' من system_type في 8 جداول ⇒ لو أي إدراج نسي
--      system_type يقع بصوت بـNOT NULL بدل ما يتسجّل BOX بصمت. لو المالك رفض: امسح البلوك قبل التشغيل.
--
-- مين مش متأثر: الـRPCs والـtriggers الـsecurity definer (صاحبها postgres = صاحب الجداول ⇒ بتعدّي الـRLS)،
--   وFleet (جداول fleet بـis_fleet_user)، وuser_roles (N-28)، والـ4 جداول اللي
--   RLS عليها من غير policies (je_counters، journal_entries_backup_20260714، ledger_entries، partner_deal_summary).
-- الأثر النهارده: صفر — كل المستخدمين admin على BOX,TM (ماعدا أدمن FLEET بس: هيخسر BOX/TM خالص — §٤-٥ في التصميم).
--
-- ⚠️ لازم يتعرف: RLS على UPDATE/DELETE **مابترفضش بصوت** — الصف اللي مش مسموح بيتشال من الـWHERE ⇒ «0 صفوف»
--   من غير خطأ (والشاشة ممكن تقول «✅ تم» — N-34 اتشال). الـINSERT والـUPDATE اللي بيحاول ينقل صف لنظام مش
--   بتاعه بيترفضوا بخطأ «new row violates row-level security policy». (PGlite بيثبت الحالتين.)
-- ════════════════════════════════════════════════════════════

-- ── فحص قبل (قراءة بس) — ابعت النواتج كاملة للمراجعة ──────
-- 1) كل الـpolicies الحالية على الـ22 جدول (دي اللي هتتشال وتتحفظ في n31_backup):
-- select tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies
--  where schemaname = 'public' and tablename in ('account_ledger','audit_log','chart_of_accounts','collections','contacts',
--        'expenses','journal_attachments','journal_entries','operating_expenses','partner_accounts','partner_ledger',
--        'partner_payouts','partners_master','payments','purchase_orders','sale_charges','sales','stock_locations','vehicles',
--        'partner_account_links','custody_holders','profit_postings')
--  order by 1, 2;
-- 2) الـRLS على الـ22 (المتوقع rls=true وforce=false للكل — وsale_charges بالذات: إيه حالتها؟):
-- select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force from pg_class c
--  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
--    and c.relname in ('account_ledger','audit_log','chart_of_accounts','collections','contacts','expenses',
--        'journal_attachments','journal_entries','operating_expenses','partner_accounts','partner_ledger','partner_payouts',
--        'partners_master','payments','purchase_orders','sale_charges','sales','stock_locations','vehicles',
--        'partner_account_links','custody_holders','profit_postings') order by 1;
-- 3) الأدوار (المتوقع: مفيش admin/employee/readonly على BOX/TM من غير systems):
-- select email, role, systems, system_type from public.user_roles order by role, email;
-- 4) app_role موجودة (N-28) وapp_systems لسه مش موجودة (المتوقع app_role بس):
-- select p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef from pg_proc p
--  where p.pronamespace = 'public'::regnamespace and p.proname in ('app_role','app_systems','is_app_admin');
-- 5) الـdefaults على system_type (المتوقع 'BOX'::text على الـ8 بالظبط — جرد ٣):
-- select c.table_name, c.column_default, c.is_nullable from information_schema.columns c
--  where c.table_schema = 'public' and c.column_name = 'system_type' and c.column_default is not null order by 1;

begin;

-- ⚠️ لازم المالك يكتب إيميله هنا (اللي بيدخل بيه وعليه admin على BOX وTM) — الملف بيقف لو لسه زي ما هو
do $n31_cfg$ begin perform set_config('n31.owner_email', 'PUT-OWNER-EMAIL-HERE', true); end $n31_cfg$;

-- ── حراس قبل أي تغيير ──
do $n31_pre$
declare
  v_owner  text := current_setting('n31.owner_email', true);
  v_tables text[] := array['account_ledger','audit_log','chart_of_accounts','collections','contacts','expenses',
                           'journal_attachments','journal_entries','operating_expenses','partner_accounts','partner_ledger',
                           'partner_payouts','partners_master','payments','purchase_orders','sale_charges','sales',
                           'stock_locations','vehicles',
                       'partner_account_links','custody_holders','profit_postings'];
  t        text;
  v_n      bigint;
  v_bad    text;
begin
  if v_owner is null or v_owner = 'PUT-OWNER-EMAIL-HERE' or v_owner !~ '@' then
    raise exception 'اكتب إيميل المالك في السطر بتاع n31.owner_email قبل التشغيل';
  end if;
  -- المالك admin على BOX **و**TM (بنفس منطق app_role) ⇒ مايقفلش على نفسه
  if not exists (select 1 from public.user_roles where email = v_owner and role = 'admin' and systems like '%BOX%')
     or not exists (select 1 from public.user_roles where email = v_owner and role = 'admin'
                     and (systems like '%TM%' or systems like '%TRANSIT%')) then
    raise exception 'الإيميل % مش admin على BOX وTM الاتنين في user_roles — وقف (عشان محدش يتقفل برّه)', v_owner;
  end if;
  select string_agg(email || ' (' || role || ')', '، ') into v_bad
    from public.user_roles where role in ('admin','employee','readonly') and coalesce(systems, '') = '';
  if v_bad is not null then
    raise exception 'مستخدمين من غير systems — هيتقفلوا برّه كل الجداول: % — صلّحهم الأول', v_bad;
  end if;
  if to_regprocedure('public.app_role(text)') is null then
    raise exception 'public.app_role(text) مش موجودة — N-28 لازم يتشغّل الأول';
  end if;
  if to_regclass('public.n31_backup') is not null then
    raise exception 'n31_backup موجود — الملف اتشغّل قبل كده؟ وقف (للرجوع شوف آخر الملف)';
  end if;
  foreach t in array v_tables loop
    if to_regclass('public.' || quote_ident(t)) is null then
      raise exception 'الجدول % مش موجود — وقف وراجع', t;
    end if;
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t and column_name = 'system_type') then
      raise exception 'الجدول % مافيهوش system_type — وقف وراجع', t;
    end if;
    -- أي صف بـnull هيختفي عن الكل بعد الـpolicy (جرد 10-01: صفر في الكل)
    execute format('select count(*) from public.%I where system_type is null', t) into v_n;
    if v_n > 0 then
      raise exception 'الجدول % فيه % صف system_type = null — هيختفوا بعد N-31. وقف وراجع', t, v_n;
    end if;
    -- أي قيمة غير BOX/TM هتختفي كمان
    execute format('select count(*) from public.%I where system_type not in (''BOX'',''TM'')', t) into v_n;
    if v_n > 0 then
      raise exception 'الجدول % فيه % صف بنظام غير BOX/TM — هيختفوا بعد N-31. وقف وراجع', t, v_n;
    end if;
  end loop;
  if to_regclass('fleet.v_invoice_balances') is null or to_regclass('fleet.v_bill_balances') is null then
    raise exception 'viewين fleet مش موجودين — وقف وراجع';
  end if;
end
$n31_pre$;

-- ── نسخة احتياطية (الرجوع بيتبني منها بالحرف) — مقفولة على الـAPI ──
create table public.n31_backup (
  kind     text not null,   -- 'policy' | 'rls' | 'default' | 'view' | 'notnull'
  tbl      text not null,
  payload  jsonb not null,
  saved_at timestamptz not null default now()
);
alter table public.n31_backup enable row level security;
revoke all on public.n31_backup from public, anon, authenticated;

insert into public.n31_backup(kind, tbl, payload)
  select 'policy', p.tablename,
         jsonb_build_object('policyname', p.policyname, 'permissive', p.permissive, 'roles', to_jsonb(p.roles),
                            'cmd', p.cmd, 'qual', p.qual, 'with_check', p.with_check)
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('account_ledger','audit_log','chart_of_accounts','collections','contacts','expenses',
                         'journal_attachments','journal_entries','operating_expenses','partner_accounts','partner_ledger',
                         'partner_payouts','partners_master','payments','purchase_orders','sale_charges','sales',
                         'stock_locations','vehicles',
                       'partner_account_links','custody_holders','profit_postings');
insert into public.n31_backup(kind, tbl, payload)
  select 'rls', c.relname, jsonb_build_object('rls', c.relrowsecurity, 'force', c.relforcerowsecurity)
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and c.relname in ('account_ledger','audit_log','chart_of_accounts','collections','contacts','expenses',
                       'journal_attachments','journal_entries','operating_expenses','partner_accounts','partner_ledger',
                       'partner_payouts','partners_master','payments','purchase_orders','sale_charges','sales',
                       'stock_locations','vehicles',
                       'partner_account_links','custody_holders','profit_postings');
insert into public.n31_backup(kind, tbl, payload)
  select 'view', n.nspname || '.' || c.relname, jsonb_build_object('reloptions', to_jsonb(c.reloptions))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'fleet' and c.relname in ('v_invoice_balances','v_bill_balances');
insert into public.n31_backup(kind, tbl, payload)
  select 'notnull', 'audit_log', jsonb_build_object('nullable', (c.is_nullable = 'YES'))
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'audit_log' and c.column_name = 'system_type';

-- ── ١) app_systems — مبنية على app_role (N-28) ⇒ parser واحد لـuser_roles.systems ──
create or replace function public.app_systems(p_min_role text)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(s.sys order by s.sys), '{}')
    from unnest(array['BOX','TM']) as s(sys)
   where (case public.app_role(s.sys) when 'admin' then 3 when 'employee' then 2 when 'readonly' then 1 else 0 end)
      >= (case p_min_role when 'admin' then 3 when 'employee' then 2 when 'readonly' then 1 else 99 end);
$$;
comment on function public.app_systems(text) is
  'N-31: الأنظمة (BOX/TM) اللي المستخدم الحالي ليه فيها دور ≥ p_min_role — مبنية على app_role (N-28). للـpolicies: system_type = any ((select app_systems(...))::text[])';
revoke execute on function public.app_systems(text) from public, anon;
grant  execute on function public.app_systems(text) to authenticated, service_role;

-- ── ٢) الـpolicies ──
do $n31_pol$
declare
  v_std  text[] := array['account_ledger','collections','expenses','journal_attachments','journal_entries',
                         'operating_expenses','partner_accounts','partner_ledger','partner_payouts','partners_master',
                         'payments','purchase_orders','sale_charges','sales','stock_locations','vehicles'];
  v_all  text[];
  t      text;
  r      record;
  v_sel  text := 'system_type = any ((select public.app_systems(''readonly''))::text[])';
  v_emp  text := 'system_type = any ((select public.app_systems(''employee''))::text[])';
  v_adm  text := 'system_type = any ((select public.app_systems(''admin''))::text[])';
begin
  v_all := v_std || array['contacts','chart_of_accounts','audit_log',
                          'partner_account_links','custody_holders','profit_postings'];
  foreach t in array v_all loop
    execute format('alter table public.%I enable row level security', t);
    for r in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', r.policyname, t);
    end loop;
    execute format('create policy n31_select on public.%I for select to authenticated using (%s)', t, v_sel);
  end loop;

  foreach t in array v_std loop
    execute format('create policy n31_insert on public.%I for insert to authenticated with check (%s)', t, v_emp);
    execute format('create policy n31_update on public.%I for update to authenticated using (%s) with check (%s)', t, v_emp, v_emp);
    execute format('create policy n31_delete on public.%I for delete to authenticated using (%s)', t, v_emp);
  end loop;

  -- contacts: الموظف بيضيف/يعدّل من سير الإدخال (ensureContact)؛ المسح admin (زي protectedTables في الشاشة)
  create policy n31_insert on public.contacts for insert to authenticated
    with check (system_type = any ((select public.app_systems('employee'))::text[]));
  create policy n31_update on public.contacts for update to authenticated
    using (system_type = any ((select public.app_systems('employee'))::text[]))
    with check (system_type = any ((select public.app_systems('employee'))::text[]));
  create policy n31_delete on public.contacts for delete to authenticated
    using (system_type = any ((select public.app_systems('admin'))::text[]));

  -- chart_of_accounts: الكتابة admin بس (قرار المالك 2026-10-03: «موافق، الشجرة للمدير بس»)
  create policy n31_insert on public.chart_of_accounts for insert to authenticated
    with check (system_type = any ((select public.app_systems('admin'))::text[]));
  create policy n31_update on public.chart_of_accounts for update to authenticated
    using (system_type = any ((select public.app_systems('admin'))::text[]))
    with check (system_type = any ((select public.app_systems('admin'))::text[]));
  create policy n31_delete on public.chart_of_accounts for delete to authenticated
    using (system_type = any ((select public.app_systems('admin'))::text[]));

  -- audit_log: الإدخال لأي دور في النظام؛ مفيش UPDATE؛ المسح admin (تنضيف operations.js)
  create policy n31_insert on public.audit_log for insert to authenticated
    with check (system_type = any ((select public.app_systems('readonly'))::text[]));
  create policy n31_delete on public.audit_log for delete to authenticated
    using (system_type = any ((select public.app_systems('admin'))::text[]));

  raise notice 'N-31: policies اتعملت على % جدول', array_length(v_all, 1);
end
$n31_pol$;

-- ── ٣) audit_log.system_type ⇒ NOT NULL (الحراس فوق اتأكدوا إن مفيش null) ──
alter table public.audit_log alter column system_type set not null;

-- ── ٤) viewين fleet ⇒ بصلاحية اللي بيقرا (فبتطبّق is_fleet_user) ──
alter view fleet.v_invoice_balances set (security_invoker = true);
alter view fleet.v_bill_balances    set (security_invoker = true);

-- ═══════════ بلوك منفصل — قرار مالك (توصية): شيل default 'BOX' من system_type ═══════════
-- لو المالك رفض: امسح من السطر ده لحد «نهاية البلوك». (أثره على المسارات الحالية صفر: 45/45 إدراج في js/
-- وكل إدراجات الـRPCs بيبعتوا system_type — §٣ في التصميم.)
do $n31_dd$
declare
  t     text;
  v_def text;
begin
  foreach t in array array['collections','expenses','partner_payouts','partners_master','payments',
                           'purchase_orders','sales','vehicles'] loop
    select pg_get_expr(d.adbin, d.adrelid) into v_def
      from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
     where d.adrelid = ('public.' || quote_ident(t))::regclass and a.attname = 'system_type';
    if v_def is null then
      raise notice 'N-31: % مالوش default على system_type — اتخطّى', t;
      continue;
    end if;
    if v_def <> '''BOX''::text' then
      raise exception 'الـdefault على %.system_type = «%» مش ''BOX'' زي جرد ٣ — وقف وراجع', t, v_def;
    end if;
    insert into public.n31_backup(kind, tbl, payload) values ('default', t, jsonb_build_object('default', v_def));
    execute format('alter table public.%I alter column system_type drop default', t);
  end loop;
end
$n31_dd$;
-- ═══════════ نهاية البلوك ═══════════

-- ── حراس بعد (جوّه نفس الـtransaction — أي غلطة ⇒ كله يرجع) ──
do $n31_post$
declare
  v_bad text;
begin
  -- (١) مفيش policy «true» فاضلة على أي جدول من الـ22
  select string_agg(tablename || '.' || policyname, '، ') into v_bad from pg_policies
   where schemaname = 'public'
     and tablename in ('account_ledger','audit_log','chart_of_accounts','collections','contacts','expenses',
                       'journal_attachments','journal_entries','operating_expenses','partner_accounts','partner_ledger',
                       'partner_payouts','partners_master','payments','purchase_orders','sale_charges','sales',
                       'stock_locations','vehicles',
                       'partner_account_links','custody_holders','profit_postings')
     and (policyname not like 'n31\_%' or coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true');
  if v_bad is not null then raise exception 'فاضل policies قديمة أو true: %', v_bad; end if;
  -- (٢) عدد الـpolicies: 4 لكل جدول من الـ18، وaudit_log 3 (مفيش update)، والتلاتة select بس ⇒ 18×4 + 3 + 3 = 78
  if (select count(*) from pg_policies where schemaname = 'public' and policyname like 'n31\_%') <> 78 then
    raise exception 'عدد policies الـN-31 مش 78 — وقف وراجع';
  end if;
  -- (٣) الـRLS مفعّلة على الـ22
  select string_agg(c.relname, '، ') into v_bad from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity
     and c.relname in ('account_ledger','audit_log','chart_of_accounts','collections','contacts','expenses',
                       'journal_attachments','journal_entries','operating_expenses','partner_accounts','partner_ledger',
                       'partner_payouts','partners_master','payments','purchase_orders','sale_charges','sales',
                       'stock_locations','vehicles',
                       'partner_account_links','custody_holders','profit_postings');
  if v_bad is not null then raise exception 'RLS مش مفعّلة على: %', v_bad; end if;
  -- (٤) الـviews كلها في public/fleet security_invoker (قاعدة N-31: أي view = security_invoker + من غير anon)
  select string_agg(n.nspname || '.' || c.relname, '، ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public','fleet') and c.relkind = 'v'
     and (not coalesce((select o.option_value::boolean from pg_options_to_table(c.reloptions) o
                         where o.option_name = 'security_invoker'), false)
          or has_table_privilege('anon', c.oid, 'SELECT'));
  if v_bad is not null then raise exception 'views من غير security_invoker أو anon بيقراها: %', v_bad; end if;
end
$n31_post$;

commit;

-- ── تحقق بعد (قراءة بس) ────────────────────────────────────
-- 1) الـpolicies (المتوقع 78: n31_select/insert/update/delete × 18 + audit_log من غير update + n31_select بس على التلاتة):
-- select tablename, string_agg(policyname || '=' || cmd, ', ' order by policyname) from pg_policies
--  where schemaname = 'public' and policyname like 'n31\_%' group by 1 order by 1;
-- 2) جرد ٢ تاني (docs/DESIGN-N31 §٧-٢) ⇒ الـ3 views: security_invoker = true وanon_select = false.
-- 3) audit_log.system_type is_nullable = NO؛ والـdefaults (لو البلوك اتشغّل) ⇒ مفيش 'BOX' على الـ8.
-- 4) من التطبيق (المنفّذ، حساب admin، قراءة بس): البرنامج في TM وBOX (الاعتمادات، المعاملات، التشغيلي، تبويبات ملف،
--    المعاينة، العهد، الشجرة، جهات الاتصال، سجل النشاط) ⇒ نفس الأعداد زي قبل، وصفر 401/403؛ وFleet ⇒ الشاشات الست.
-- 5) أول عملية حقيقية بعد التشغيل ⇒ سطر audit_log جديد اتكتب (logAudit بيبلع الأخطاء — لازم نشوفه بعيننا).

-- ════════════════════════════════════════════════════════════
-- ↩️ رجوع كامل (من n31_backup بالحرف):
-- begin;
-- do $r$
-- declare r record; t text;
-- begin
--   for t in select distinct tbl from public.n31_backup where kind = 'rls' loop
--     for r in select policyname from pg_policies where schemaname = 'public' and tablename = t and policyname like 'n31\_%' loop
--       execute format('drop policy %I on public.%I', r.policyname, t);
--     end loop;
--   end loop;
--   for r in select tbl, payload from public.n31_backup where kind = 'policy' loop
--     execute format('create policy %I on public.%I as %s for %s to %s %s %s',
--       r.payload->>'policyname', r.tbl, r.payload->>'permissive', r.payload->>'cmd',
--       (select string_agg(quote_ident(x), ', ') from jsonb_array_elements_text(r.payload->'roles') x),
--       case when r.payload->>'qual' is not null then 'using (' || (r.payload->>'qual') || ')' else '' end,
--       case when r.payload->>'with_check' is not null then 'with check (' || (r.payload->>'with_check') || ')' else '' end);
--   end loop;
--   for r in select tbl from public.n31_backup where kind = 'rls' and not (payload->>'rls')::boolean loop
--     execute format('alter table public.%I disable row level security', r.tbl);
--   end loop;
--   for r in select tbl, payload from public.n31_backup where kind = 'default' loop
--     execute format('alter table public.%I alter column system_type set default %s', r.tbl, r.payload->>'default');
--   end loop;
--   for r in select tbl, payload from public.n31_backup where kind = 'view' loop
--     if r.payload->'reloptions' = 'null'::jsonb then
--       execute format('alter view %s reset (security_invoker)', r.tbl);
--     end if;
--   end loop;
--   if exists (select 1 from public.n31_backup where kind = 'notnull' and (payload->>'nullable')::boolean) then
--     alter table public.audit_log alter column system_type drop not null;
--   end if;
-- end $r$;
-- drop function if exists public.app_systems(text);
-- commit;
-- (جدول n31_backup يتساب أو يتشال بعد التأكد.)
-- ════════════════════════════════════════════════════════════
