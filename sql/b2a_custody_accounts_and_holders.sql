-- ════════════════════════════════════════════════════════════
-- B-2a — حسابات العهد + جدول أصحاب العهد + دالة فتح عهدة (مسودة — **المالك بس يشغّلها**)
-- التصميم: docs/DESIGN-B2-custody-money-source.md (§٢ و§٤)، على docs/DESIGN-banks-and-custody.md المعتمد.
--
-- اللي بيتعمل (من غير لمس أي قيد ولا أي سجل موجود — أثره على الأرقام صفر):
--   ١) حساب أب جديد 1150 «العهد النقدية» تحت 1100، في BOX وTM.
--   ٢) اسم 1110 في الشجرة بس ← «العهدة الأساسية» (§٣-أ في الوثيقة المعتمدة). القيود القديمة
--      مكتوب فيها «النقد» وهتفضل زي ما هي (C4)؛ والشاشات بتعرض اسم الشجرة (getAccountName).
--   ٣) جدول custody_holders (RLS: قراءة للمسجّلين، ومفيش كتابة غير من الدالة).
--   ٤) صفّين «العهدة الأساسية» (BOX وTM) ← 1110.
--   ٥) دالة create_custody_holder: المدير بس، وأول كود فاضي 1151-1199 تحت 1150، وعهدة واحدة
--      لكل شخص في كل نظام، والحساب + الصف في transaction واحدة.
--
-- حارس م٥ (trg_reject_je_on_parent): بعد أول عهدة، 1150 يبقى أب ⇒ مفيش قيد عليه مباشرة (وده
-- المطلوب). و1110/1120 مالهمش أولاد ⇒ عكس القيود القديمة سليم.
--
-- آمن يتكرر تشغيله (if not exists / on conflict / create or replace)، وفيه فحص إن مفيش تعارض.
-- ════════════════════════════════════════════════════════════

-- ── فحص قبل (قراءة بس) ─────────────────────────────────────
-- 1) 1150 ومداه 1151-1199 مش مستخدمين (المتوقع صفر صفوف، أو 1150 بس لو اتشغّل قبل كده):
-- select system_type, account_code, account_name, parent_code from chart_of_accounts
--  where account_code between '1150' and '1199' order by 1,2;
-- 2) 1110 و1100 (المتوقع: 1100 «النقد والبنك» و1110 «النقد» ← 1100، في النظامين):
-- select system_type, account_code, account_name, account_type, parent_code from chart_of_accounts
--  where account_code in ('1100','1110') order by 1,2;
-- 3) مفيش أي قيد على 1150-1199 (المتوقع 0):
-- select count(*) from journal_entries where account_code between '1150' and '1199';
-- 4) الـunique اللي الـFK بيعتمد عليه موجود (المتوقع صف):
-- select conname from pg_constraint where conname = 'chart_of_accounts_system_code_uq';
-- 5) أرقام القيود قبل (احفظ النتيجة وقارنها بتحقق بعد ٤ — المتوقع مطابقة بالحرف):
-- select system_type, count(*), sum(dr_amount) - sum(cr_amount) from journal_entries
--  where post_status = 'posted' group by 1;
--    ⚠️ واحفظ اسم 1110 اللي طلع في فحص ٢ (المتوقع «النقد») — الرجوع بيستخدمه.

begin;

-- ٠) حراسة: 1150 لو موجود لازم يكون تحت 1100، ومفيش قيود على المدى
do $b2a$
begin
  if exists (select 1 from chart_of_accounts
              where account_code = '1150' and coalesce(parent_code,'') <> '1100') then
    raise exception '1150 موجود بأب غير 1100 — وقّف وراجع';
  end if;
  if exists (select 1 from journal_entries where account_code between '1150' and '1199') then
    raise exception 'فيه قيود على المدى 1150-1199 — وقّف وراجع قبل ما يتحوّل لحسابات عهد';
  end if;
end
$b2a$;

-- ١) الحساب الأب 1150
insert into chart_of_accounts (system_type, account_code, account_name, account_type, parent_code, is_active)
values ('BOX', '1150', 'العهد النقدية', 'asset', '1100', true),
       ('TM',  '1150', 'العهد النقدية', 'asset', '1100', true)
on conflict (system_type, account_code) do nothing;

-- ٢) اسم 1110
update chart_of_accounts
   set account_name = 'العهدة الأساسية'
 where account_code = '1110' and system_type in ('BOX','TM') and account_name <> 'العهدة الأساسية';

-- ٣) جدول أصحاب العهد
create table if not exists custody_holders (
  id              bigint generated always as identity primary key,
  system_type     text        not null check (system_type in ('BOX','TM')),
  name            text        not null check (name = btrim(name) and name <> ''),
  kind            text        not null check (kind in ('أساسية','شريك دائم','موظف','أخرى')),
  linked_partner  text        null,
  account_code    text        not null,
  status          text        not null default 'active' check (status in ('active','closed')),
  created_at      timestamptz not null default now(),
  created_by      text        null,
  unique (system_type, name),
  unique (system_type, account_code),
  foreign key (system_type, account_code) references chart_of_accounts (system_type, account_code)
);
-- عهدة واحدة لكل شريك دائم في كل نظام (حتى لو اتفتحت باسمين مختلفين)
create unique index if not exists custody_holders_one_per_partner
  on custody_holders (system_type, linked_partner) where linked_partner is not null;
alter table custody_holders enable row level security;
do $b2a$
begin
  create policy custody_holders_select_authenticated on custody_holders
    for select to authenticated using (true);
exception when duplicate_object then null;
end
$b2a$;
revoke insert, update, delete on table custody_holders from anon, authenticated;

-- ٤) العهدة الأساسية
insert into custody_holders (system_type, name, kind, linked_partner, account_code, created_by)
values ('BOX', 'العهدة الأساسية', 'أساسية', null, '1110', 'b2a-sql'),
       ('TM',  'العهدة الأساسية', 'أساسية', null, '1110', 'b2a-sql')
on conflict (system_type, name) do nothing;

-- ٥) فتح عهدة لشخص (المدير بس)
create or replace function create_custody_holder(p_sys text, p_name text, p_kind text, p_linked_partner text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_kind   text := btrim(coalesce(p_kind, ''));
  v_link   text := nullif(btrim(coalesce(p_linked_partner, '')), '');
  v_role   text;
  v_code   text;
  v_next   int;
  v_sys_tokens text[] := case when p_sys = 'TM' then array['TM','TRANSIT'] else array[p_sys] end;
begin
  -- ١) المدخلات (قبل الصلاحية عمدًا، زي create_partner_account)
  if p_sys not in ('BOX','TM') then raise exception 'نظام غير معروف: %', p_sys; end if;
  if v_name = '' then raise exception 'اسم صاحب العهدة فارغ'; end if;
  -- أي اسم بيبدأ بـ«عهدة» (مش «عهدة:» بس) ← مرفوض، عشان مايطلعش حساب «عهدة عهدة …»
  if v_name like 'عهدة%' then raise exception 'اكتب اسم الشخص بس (من غير كلمة «عهدة»)'; end if;
  if is_treasury_name(v_name) or v_name = 'العهدة الأساسية' then
    raise exception 'العهدة الأساسية موجودة أصلًا (1110)';
  end if;
  if v_kind not in ('شريك دائم','موظف','أخرى') then
    raise exception 'نوع العهدة لازم يكون: شريك دائم، أو موظف، أو أخرى';
  end if;
  if v_kind = 'شريك دائم' then
    if v_link is null then raise exception 'عهدة الشريك الدائم لازم تتربط باسمه في الشركاء'; end if;
    -- الخزينة مش شريك دائم لعهدة (is_permanent_partner بترجّع true لأسماء الخزينة)
    if is_treasury_name(v_link) then raise exception 'الخزينة مش شريك — عهدتها هي العهدة الأساسية (1110)'; end if;
    -- ⚠️ is not true مش not: is_permanent_partner بترجّع NULL لأي اسم مش مصنَّف أو ملوش صف ربط،
    -- و«not NULL» = NULL ⇒ الـIF ما يشتغلش والفحص يعدّي (fail-open). نفس درس coalesce فوق.
    if is_permanent_partner(p_sys, v_link) is not true then
      raise exception '«%» مش شريك دائم مصنَّف في %', v_link, p_sys;
    end if;
    -- عهدة واحدة لكل شريك دائم: اسم العهدة = اسم الشريك بالحرف (والـindex الجزئي custody_holders_one_per_partner على الجدول بيحمي كمان)
    if v_name <> v_link then
      raise exception 'عهدة الشريك الدائم لازم اسمها يبقى اسمه بالحرف: «%»', v_link;
    end if;
  else
    -- الشريك (خارجي أو دائم) مايتفتحلوش عهدة كموظف/أخرى: الخارجي بيتعامل على جاريه (§٣)،
    -- والدائم عهدته بالنوع «شريك دائم»
    if exists (select 1 from partner_account_links where system_type = p_sys and partner_name = v_name) then
      raise exception '«%» شريك مسجَّل — الخارجي بيتعامل على جاريه، والدائم عهدته بالنوع «شريك دائم»', v_name;
    end if;
    v_link := null;
  end if;

  -- ٢) الصلاحية: المدير بس، fail-closed
  select role into v_role
    from public.user_roles
   where email = auth.jwt() ->> 'email'
     and exists (select 1 from unnest(v_sys_tokens) t where systems like '%' || t || '%')
   order by case role when 'admin' then 3 when 'employee' then 2 when 'readonly' then 1 else 0 end desc
   limit 1;
  if coalesce(v_role, '') <> 'admin' then
    raise exception 'فتح عهدة مقصور على المدير';
  end if;

  -- ٣) قفل يسلسل النداءات على نفس النظام
  perform pg_advisory_xact_lock(hashtext('create_custody_holder:' || p_sys));

  -- ٤) موجودة؟ ارجع كودها (idempotent). ولو مقفولة، قول كده.
  select account_code into v_code from custody_holders where system_type = p_sys and name = v_name;
  if v_code is not null then
    if exists (select 1 from custody_holders where system_type = p_sys and name = v_name and status = 'closed') then
      raise exception 'عهدة «%» موجودة ومقفولة (%) — مش هتتفتح تاني تلقائي', v_name, v_code;
    end if;
    return v_code;
  end if;

  -- ٥) أول كود فاضي 1151-1199
  select min(g) into v_next from generate_series(1151, 1199) g
   where not exists (select 1 from chart_of_accounts c where c.system_type = p_sys and c.account_code = g::text);
  if v_next is null then raise exception 'مفيش أكواد فاضية في 1151-1199 لنظام %', p_sys; end if;
  v_code := v_next::text;

  -- ٦) الحساب + الصف في نفس المعاملة
  begin
    insert into chart_of_accounts (system_type, account_code, account_name, account_type, parent_code, is_active)
    values (p_sys, v_code, 'عهدة ' || v_name, 'asset', '1150', true);
  exception when unique_violation then
    raise exception 'الكود % اتفتح للتوّ من مكان تاني — أعد المحاولة', v_code;
  end;
  insert into custody_holders (system_type, name, kind, linked_partner, account_code, created_by)
  values (p_sys, v_name, v_kind, v_link, v_code, auth.jwt() ->> 'email');

  return v_code;
end
$fn$;

revoke execute on function create_custody_holder(text, text, text, text) from public, anon;
grant  execute on function create_custody_holder(text, text, text, text) to authenticated;

commit;

-- ── تحقق بعد (قراءة بس) ────────────────────────────────────
-- 1) 1150 في النظامين تحت 1100، و1110 اسمه «العهدة الأساسية»:
-- select system_type, account_code, account_name, parent_code from chart_of_accounts
--  where account_code in ('1110','1150') order by 1,2;
-- 2) صفّين العهدة الأساسية:
-- select system_type, name, kind, account_code, status from custody_holders order by 1;
-- 3) الدالة موجودة وsecurity definer:
-- select proname, prosecdef from pg_proc where proname = 'create_custody_holder';
-- 4) مفيش أي تغيير في القيود (المتوقع = نتيجة فحص قبل ٥ بالحرف):
-- select system_type, count(*), sum(dr_amount) - sum(cr_amount) from journal_entries
--  where post_status = 'posted' group by 1;
-- (اختبار الرفض من غير إنشاء أي حاجة):
-- select create_custody_holder('XX','اسم','موظف');          -- المتوقع: «نظام غير معروف»
-- select create_custody_holder('TM','الصندوق','موظف');      -- المتوقع: «العهدة الأساسية موجودة أصلًا»
-- ⚠️ ماتفتحش عهدة حقيقية دلوقتي: فتح العهد وأول استخدام في B-2d بتجربة ZZTEST بإذن المالك.

-- ════════════════════════════════════════════════════════════
-- ↩️ رجوع (لو لسه مفيش ولا عهدة اتفتحت ولا قيد على 115x):
-- begin;
--   drop function if exists create_custody_holder(text, text, text, text);
--   drop table if exists custody_holders;
--   delete from chart_of_accounts where account_code = '1150' and system_type in ('BOX','TM')
--     and not exists (select 1 from chart_of_accounts c where c.parent_code = '1150');
--   -- الاسم = اللي طلع في «فحص قبل ٢» لكل نظام (المتوقع «النقد»؛ لو كان غيره اكتبه هنا):
--   update chart_of_accounts set account_name = 'النقد' where account_code = '1110' and system_type in ('BOX','TM');
-- commit;
-- ════════════════════════════════════════════════════════════
