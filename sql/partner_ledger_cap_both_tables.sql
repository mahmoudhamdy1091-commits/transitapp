-- ════════════════════════════════════════════════════════════════════
-- 2026-09-08 — سقف الـRPC يحسب الجدولين معًا
-- نفّذ في Supabase SQL Editor. يعتمد على تشغيل partner_ledger_stage_b_prep.sql
-- أولًا (القسمان: 'cancelled' + pending_void) — وقد شُغِّل بالفعل.
-- ════════════════════════════════════════════════════════════════════
--
-- العلة: v_prior كانت تعدّ partner_ledger وحدها، بينما p_gross_entitlement
-- (المحسوب في JS من payableNow + withdrawnViaPayout) يشمل قيود الجدولين —
-- لأن core.js يعدّ ref_table='partner_payouts' و'partner_ledger' معًا.
-- ⇒ أي صرف عبر الزر القديم يُضاف إلى gross بلا أن يُطرح من prior، فيرفع
-- السقف بمقداره بالضبط ويصير المبلغ نفسه قابلًا للسحب مرتين.
--
-- في الاستخدام العادي الفحص العميل (checkPayoutCap) أضيق فيغطّي الأمر،
-- لكن الـRPC هي طبقة الأمان ضد التزامن — فكان آخر خط دفاع هو الأوسع.
--
-- ⚠️ لماذا not exists إلزامية: هجرة المرحلة أ **نسخت** الصفوف ولم تنقلها
-- (insert بلا delete)، فكل صف تاريخي موجود في الجدولين بنفس الرقم
-- (partner_ledger.ref_no = partner_payouts.pay_id). عدّ الجدولين بلا إزالة
-- تكرار يحسبه مرتين ⇒ ينخفض السقف ويُرفض صرف مشروع — وهو عكس الثغرة
-- المقصود إصلاحها، وأسوأ منها أثرًا لأنه يمنع عملية صحيحة.
--
-- بديل مرفوض: إغلاق مداخل partner_payouts الثلاثة بدل هذا. رُفض لأن
-- partner_ledger بلا مسار تعديل بعد (ب-٣)، فإغلاقها اليوم يجعل أي معاملة
-- شريك جديدة غير قابلة للتعديل — تراجع في قدرة يومية مقابل ثغرة تزامن
-- نظرية. تُغلق المداخل مع ب-٣ حين يكتمل البديل.
--
-- التوقيع لم يتغيّر ⇒ الصلاحيات محفوظة، ولا حاجة لـdrop.
-- التعريف أدناه مُولَّد آليًا من stage_b_prep — لم يتغيّر فيه إلا كتلة v_prior.

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
-- تحقق: الدالة تشير للجدولين الآن
select routine_name,
       position('partner_payouts' in routine_definition) > 0 as counts_old_table,
       position('not exists'      in routine_definition) > 0 as has_dedup
from information_schema.routines
where routine_name = 'create_partner_ledger_entry';
