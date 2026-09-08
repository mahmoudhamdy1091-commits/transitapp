-- ════════════════════════════════════════════════════════════════════
-- 2026-09-08 — تصحيح نصّ رسالة رفض السقف (مشوَّه للمستخدم)
-- نفّذ في Supabase SQL Editor بعد partner_ledger_cap_both_tables.sql.
-- ════════════════════════════════════════════════════════════════════
--
-- العلة: '%.2f' ليست صيغة صالحة في raise بـplpgsql — الأخيرة تدعم '%'
-- كعنصر نائب واحد فقط، وما بعده يُطبع حرفيًا. فالرسالة التي يراها
-- المستخدم عند رفض صرف كانت:
--
--   المبلغ 1.2f يتجاوز المستحق المتبقي 0.00.2f
--   (الاستحقاق الإجمالي=8626.5.2f، مسدَّد سابقًا=8626.50.2f)
--
-- أرقام ملتصق بها ".2f" — تبدو كخطأ في النظام لا كرسالة مفهومة.
-- رُصد حيًّا 2026-09-08 أثناء التحقق من إزالة تكرار v_prior: المسبار
-- الذي أثبت صحة الحساب هو نفسه الذي كشف تشوّه العرض.
--
-- عيب أصلي في sql/partner_ledger_stage_a.sql، غير متعلق بأي تغيير لاحق.
-- التصحيح: to_char(…, 'FM999999990.00') — رقمان عشريان دائمًا، بلا
-- مسافات بادئة (FM)، وبلا فاصلة آلاف حتى لا تختلط بفاصلة النص العربي.
--
-- التوقيع لم يتغيّر ⇒ الصلاحيات محفوظة. التعريف مُولَّد آليًا من
-- partner_ledger_cap_both_tables — لم يتغيّر فيه إلا سطرا raise.

create or replace function create_partner_ledger_entry(
  p_sys             text,
  p_partner         text,
  p_entry_type      text,
  p_pay_date        date,
  p_file_no         text default null,
  p_amount          numeric default null,   -- سحب/إيداع عام فقط
  p_capital         numeric default 0,      -- استرداد/تأكيد فقط
  p_profit          numeric default 0,      -- استرداد/تأكيد فقط
  p_pay_method      text default null,
  p_document        text default null,
  p_notes           text default null,
  p_post_status     text default 'draft',
  p_idempotency_key uuid default null,
  p_gross_entitlement numeric default null  -- إلزامية لأنواع الملف فقط — راجع التعليق أعلى الدالة
) returns partner_ledger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_amount  numeric;
  v_capital numeric;
  v_profit  numeric;
  v_ref_no  text;
  v_next    int;
  v_prior   numeric;
  v_row     partner_ledger;
  v_linked  boolean;
begin
  if p_sys is null or p_sys not in ('BOX','TM') then
    raise exception 'نظام غير صالح: %', coalesce(p_sys,'NULL');
  end if;
  if p_entry_type not in ('سحب عام','إيداع عام','استرداد وتوزيع أرباح','تأكيد استلام') then
    raise exception 'نوع حركة غير معروف: %', p_entry_type;
  end if;
  if coalesce(p_partner,'') = '' then
    raise exception 'اسم الشريك مطلوب';
  end if;

  v_linked := p_entry_type in ('استرداد وتوزيع أرباح','تأكيد استلام');

  if v_linked and p_file_no is null then
    raise exception '"%" يتطلب رقم ملف', p_entry_type;
  end if;
  if not v_linked and p_file_no is not null then
    raise exception '"%" يجب ألا يكون مرتبطًا بملف', p_entry_type;
  end if;

  if v_linked then
    v_capital := coalesce(p_capital, 0);
    v_profit  := coalesce(p_profit, 0);
    v_amount  := v_capital + v_profit;
  else
    v_capital := 0;
    v_profit  := 0;
    v_amount  := coalesce(p_amount, 0);
  end if;
  if v_amount <= 0 then
    raise exception 'يرجى إدخال مبلغ صحيح';
  end if;

  -- ── القفل — على سند الشراء للأنواع المرتبطة بملف (كل ملف له صف واحد،
  --    نفس نمط post_sale_je)، أو قفل استشاري على (نظام+شريك) للأنواع العامة ──
  if v_linked then
    perform 1 from purchase_orders
     where system_type = p_sys and file_no = p_file_no for update;
    if not found then
      raise exception 'الملف % غير موجود في %', p_file_no, p_sys;
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('partner_ledger:' || p_sys || ':' || p_partner));
  end if;

  -- ── فحص السقف تحت القفل — يمنع دفعتين متزامنتين من تجاوز payableNow معًا.
  --    "استرداد وتوزيع أرباح" و"تأكيد استلام" يتقاسمان نفس السقف (الاثنان
  --    توزيع فعلي لرأس المال/الربح، سواء تحرّك نقد أو لا) ──
  if v_linked then
    if p_gross_entitlement is null then
      raise exception 'gross_entitlement مطلوبة لهذا النوع';
    end if;
    -- ⚠️ الجدولان معًا، مع إزالة التكرار. الصرف عبر الزر القديم يكتب في
    -- partner_payouts وحدها، وقيده يدخل withdrawnViaPayout ⇒ يُضاف إلى
    -- p_gross_entitlement. فلو لم يُطرح هنا، ارتفع السقف بمقداره بالضبط
    -- وصار المبلغ نفسه قابلًا للسحب مرتين تحت التزامن.
    -- والـnot exists إلزامية: هجرة المرحلة أ **نسخت** الصفوف ولم تنقلها
    -- (insert بلا delete)، فالصف التاريخي موجود في الجدولين بنفس الرقم
    -- (partner_ledger.ref_no = partner_payouts.pay_id). بدونها يُحسب مرتين
    -- فينخفض السقف ويُرفض صرف مشروع — عكس الثغرة تمامًا.
    select coalesce(sum(amount), 0) into v_prior
      from (
        select pl.amount
          from partner_ledger pl
         where pl.system_type = p_sys and pl.partner = p_partner and pl.file_no = p_file_no
           and pl.entry_type in ('استرداد وتوزيع أرباح','تأكيد استلام')
           and pl.post_status in ('posted','draft','pending_edit','pending_void')
        union all
        select pp.amount
          from partner_payouts pp
         where pp.system_type = p_sys and pp.partner = p_partner and pp.file_no = p_file_no
           and pp.post_status in ('posted','draft','pending_edit','pending_void')
           and not exists (
             select 1 from partner_ledger m
              where m.ref_no = pp.pay_id and m.system_type = pp.system_type
           )
      ) t;
    if v_amount > (p_gross_entitlement - v_prior + 0.001) then
      raise exception 'المبلغ % يتجاوز المستحق المتبقي % (الاستحقاق الإجمالي=%، مسدَّد سابقًا=%)',
        to_char(v_amount,'FM999999990.00'), to_char(p_gross_entitlement - v_prior,'FM999999990.00'),
        to_char(p_gross_entitlement,'FM999999990.00'), to_char(v_prior,'FM999999990.00');
    end if;
  end if;

  -- ── ترقيم ذرّي — تحت نفس القفل، فلا يتصادم نداءان متزامنان ──
  if v_linked then
    select coalesce(max((regexp_match(ref_no, '(\d+)$'))[1]::int), 0) + 1 into v_next
      from partner_ledger where system_type = p_sys and file_no = p_file_no;
    v_ref_no := 'PL-' || p_file_no || '-' || lpad(v_next::text, 3, '0');
  else
    select coalesce(max((regexp_match(ref_no, '(\d+)$'))[1]::int), 0) + 1 into v_next
      from partner_ledger where system_type = p_sys and file_no is null and partner = p_partner;
    v_ref_no := 'PL-' || p_sys || '-GEN-' || lpad(v_next::text, 3, '0');
  end if;

  insert into partner_ledger (system_type, partner, entry_type, file_no, amount,
    capital_amount, profit_amount, pay_method, document, pay_date, notes, ref_no,
    post_status, idempotency_key)
  values (p_sys, p_partner, p_entry_type, p_file_no, v_amount,
    v_capital, v_profit, p_pay_method, p_document, p_pay_date, p_notes, v_ref_no,
    p_post_status, p_idempotency_key)
  returning * into v_row;

  return v_row;
end;
$$;
-- تحقق: لم تعد الصيغة المكسورة موجودة، وto_char حاضرة
select routine_name,
       position('%.2f'   in routine_definition) = 0 as broken_format_gone,
       position('to_char' in routine_definition) > 0 as uses_to_char,
       position('not exists' in routine_definition) > 0 as dedup_still_there
from information_schema.routines
where routine_name = 'create_partner_ledger_entry';
