-- ════════════════════════════════════════════════════════════
-- B-2c1 — عمودين «مصدر الفلوس» في جداول الحركات (مسودة — **المالك بس يشغّلها**)
-- التصميم: docs/DESIGN-B2-custody-money-source.md §٥ و§٥ب.
--
-- اللي بيتعمل: عمودين فاضيين (من غير default ولا backfill — C4) في 6 جداول:
--   payments · expenses · collections · operating_expenses · partner_ledger · partner_payouts
--   source_sys      text null  — النظام صاحب مصدر الفلوس ('BOX' / 'TM')
--   source_account  text null  — حساب المصدر (4 أرقام: 1110، 1121-1149، 1151-1199، أو جاري شريك 24xx)
-- + check: الشكل (source_sys ∈ BOX/TM، وsource_account 4 أرقام)، والاتنين **يا فاضيين يا مليانين**.
--
-- الكود (B-2c) «نايم»: بيقرا record.source_account لو موجود، ولو العمود مش موجود أو فاضي بيمشي
-- المسار القديم بالحرف. يعني الملف ده ممكن يتشغّل في أي وقت قبل B-2d، وأثره على الأرقام صفر.
-- آمن يتكرر تشغيله (add column if not exists + drop/add constraint).
-- ════════════════════════════════════════════════════════════

-- ── فحص قبل (قراءة بس) ─────────────────────────────────────
-- 1) الأعمدة مش موجودة (المتوقع صفر صفوف، أو 12 لو اتشغّل قبل كده):
-- select table_name, column_name from information_schema.columns
--  where table_schema = 'public' and column_name in ('source_sys','source_account')
--    and table_name in ('payments','expenses','collections','operating_expenses','partner_ledger','partner_payouts')
--  order by 1, 2;
-- 2) الجداول الستة موجودة (المتوقع 6):
-- select count(*) from information_schema.tables where table_schema = 'public'
--    and table_name in ('payments','expenses','collections','operating_expenses','partner_ledger','partner_payouts');

begin;

do $b2c1$
declare
  t text;
begin
  foreach t in array array['payments','expenses','collections','operating_expenses','partner_ledger','partner_payouts'] loop
    if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      raise exception 'الجدول % مش موجود — وقّف وراجع', t;
    end if;
    execute format('alter table %I add column if not exists source_sys text null', t);
    execute format('alter table %I add column if not exists source_account text null', t);
    execute format('alter table %I drop constraint if exists %I', t, t || '_money_source_chk');
    execute format(
      'alter table %I add constraint %I check ('
      || '(source_sys is null) = (source_account is null) '
      || 'and (source_sys is null or source_sys in (''BOX'',''TM'')) '
      || 'and (source_account is null or source_account ~ ''^[0-9]{4}$'')'
      || ')', t, t || '_money_source_chk');
  end loop;
end
$b2c1$;

commit;

-- ── تحقق بعد (قراءة بس) ────────────────────────────────────
-- 1) 12 عمود (6 جداول × 2):
-- select table_name, column_name, data_type, is_nullable from information_schema.columns
--  where table_schema = 'public' and column_name in ('source_sys','source_account')
--    and table_name in ('payments','expenses','collections','operating_expenses','partner_ledger','partner_payouts')
--  order by 1, 2;
-- 2) 6 قيود check:
-- select conrelid::regclass, conname from pg_constraint where conname like '%_money_source_chk' order by 1;
-- 3) مفيش ولا صف فيه قيمة (المتوقع 0 في الستة):
-- select 'payments' t, count(*) from payments where source_account is not null
-- union all select 'expenses', count(*) from expenses where source_account is not null
-- union all select 'collections', count(*) from collections where source_account is not null
-- union all select 'operating_expenses', count(*) from operating_expenses where source_account is not null
-- union all select 'partner_ledger', count(*) from partner_ledger where source_account is not null
-- union all select 'partner_payouts', count(*) from partner_payouts where source_account is not null;

-- ════════════════════════════════════════════════════════════
-- ↩️ رجوع (لو لسه مفيش ولا صف استخدم العمودين):
-- begin;
--   do $r$ declare t text; begin
--     foreach t in array array['payments','expenses','collections','operating_expenses','partner_ledger','partner_payouts'] loop
--       execute format('alter table %I drop constraint if exists %I', t, t || '_money_source_chk');
--       execute format('alter table %I drop column if exists source_account', t);
--       execute format('alter table %I drop column if exists source_sys', t);
--     end loop; end $r$;
-- commit;
-- ════════════════════════════════════════════════════════════
