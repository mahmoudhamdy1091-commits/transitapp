-- ════════════════════════════════════════════════════════════════════
-- 2026-09-08 — تجهيز المرحلة ب: إصلاحان في partner_ledger
-- نفّذ في Supabase SQL Editor. القسمان مستقلان — شغّل كلًّا على حدة.
--
--   القسم ١) حالة 'cancelled' مفقودة من القيد  ← حاجب فعلي
--   القسم ٢) v_prior تتجاهل 'pending_void'      ← ثغرة سقف
-- ════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
-- القسم ١ — إضافة 'cancelled' إلى حالات post_status المسموحة
-- ════════════════════════════════════════════════════════════════════
-- العلة: القيد الحالي يسمح بخمس حالات فقط:
--   ('draft','pending_edit','pending_void','posted','voided')
-- بينما التطبيق يكتب 'cancelled' في ٦ مواضع — rejectItem وتتاليه في
-- operations.js. النتيجة: أول "رفض" لمعاملة شريك من طابور الاعتماد بعد
-- توصيل المرحلة ب سيرمي انتهاك CHECK ويفشل الرفض بالكامل.
--
-- 'cancelled' و'voided' ليستا مترادفتين — وهذا أهم تمييز في التطبيق كله:
--   cancelled = لم يحدث شيء محاسبيًا (كان مسودة ورُفض) — لا قيد ولا عكس
--   voided    = حدث فعلًا ثم عُكس بقيد عكسي حقيقي
-- خلطهما يفسد كل دالة تفرّق بين "ملغى" و"معكوس" (isActive/isVisible/isOccupying).

-- ١-أ) تحقق أولًا: ما اسم القيد الفعلي؟ (المتوقَّع partner_ledger_post_status_check)
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'partner_ledger'::regclass
  and contype = 'c'
order by conname;

-- ١-ب) الاستبدال — الاسم أدناه هو تسمية postgres التلقائية لقيد عمودي مضمَّن.
-- لو أظهر ١-أ اسمًا مختلفًا، بدّله هنا قبل التشغيل.
alter table partner_ledger
  drop constraint if exists partner_ledger_post_status_check;

alter table partner_ledger
  add constraint partner_ledger_post_status_check
  check (post_status in ('draft','pending_edit','pending_void','posted','voided','cancelled'));

-- ١-ج) تأكيد
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'partner_ledger'::regclass and conname = 'partner_ledger_post_status_check';


-- ════════════════════════════════════════════════════════════════════
-- القسم ٢ — v_prior تحسب 'pending_void' ضمن المسدَّد سابقًا
-- ════════════════════════════════════════════════════════════════════
-- العلة: v_prior كانت تعدّ ('posted','draft','pending_edit') فقط.
-- الصف بحالة 'pending_void' هو صرف **حدث فعلًا وقيده قائم** — طلب الإلغاء
-- مقدَّم لكنه لم يُعتمد بعد، فلم يُعكس شيء. استثناؤه من "المسدَّد سابقًا"
-- يرفع السقف بمقدار ذلك الصرف: يكفي أن يطلب المستخدم إلغاء صرف سابق
-- (بلا اعتماد) ليصير المبلغ نفسه قابلًا للسحب مرة ثانية.
--
-- 'voided' و'cancelled' تبقيان مستثنيتين وهذا صحيح: الأولى عُكست بقيد،
-- والثانية لم تحدث أصلًا.
--
-- ⚠️ التعريف أدناه منسوخ حرفيًا من sql/partner_ledger_stage_a.sql،
-- ولم يتغيّر فيه إلا سطر v_prior الواحد. أُنتج بنسخ آلي لا بإعادة كتابة.
-- التوقيع لم يتغيّر، فلا حاجة لـdrop قبل create or replace.

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
    select coalesce(sum(amount), 0) into v_prior
      from partner_ledger
     where system_type = p_sys and partner = p_partner and file_no = p_file_no
       and entry_type in ('استرداد وتوزيع أرباح','تأكيد استلام')
       and post_status in ('posted','draft','pending_edit','pending_void');
    if v_amount > (p_gross_entitlement - v_prior + 0.001) then
      raise exception 'المبلغ %.2f يتجاوز المستحق المتبقي %.2f (الاستحقاق الإجمالي=%.2f، مسدَّد سابقًا=%.2f)',
        v_amount, (p_gross_entitlement - v_prior), p_gross_entitlement, v_prior;
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
-- ٢-ب) تأكيد أن السطر الجديد داخل الدالة فعلًا
select routine_name,
       position('pending_void' in routine_definition) > 0 as has_pending_void
from information_schema.routines
where routine_name = 'create_partner_ledger_entry';
