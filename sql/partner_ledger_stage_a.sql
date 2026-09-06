-- نفّذ هذا في Supabase SQL Editor مرة واحدة.
-- Phase 2 / المرحلة أ — الأساس المحاسبي لموديل معاملات الشريك الجديد بثلاثة
-- أنواع (سحب عام / إيداع عام / استرداد وتوزيع أرباح) + نوع رابع بلا حركة نقدية
-- (تأكيد استلام)، يحل محل الموديل القديم الأربعة (استرداد رأس مال / توزيع
-- أرباح / سلفة / رأس مال+أرباح) في partner_payouts.
--
-- اكتشاف Discovery حاسم قبل هذا التصميم: partner_payouts مذكورة في 14 ملف —
-- هي مكوّن كامل في طابور الاعتماد (draft/pending_edit/pending_void)، لا جدول
-- بسيط. التنفيذ مقسَّم لثلاث مراحل: أ) الأساس المحاسبي (هذا الملف) — قابلة
-- للاستخدام والاختبار بمعزل. ب) توصيل طابور الاعتماد (operations.js).
-- ج) الأسطح للقراءة فقط (journal.js/print.js/reports.js/...).
--
-- "سلفة" (النوع القديم الرابع) لا مقابل صريح لها هنا عمدًا — سحب عام يغطي
-- نفس الحاجة الاقتصادية (فلوس غير مربوطة بصفقة منتهية)، فالنموذج الجديد
-- يوحّدهما بدل تكرارهما.

-- ════════════════════════════════════════════════════════════
-- 1) الجدول
-- ════════════════════════════════════════════════════════════
create table if not exists partner_ledger (
  id              uuid primary key default gen_random_uuid(),
  system_type     text not null check (system_type in ('BOX','TM')),
  partner         text not null,
  entry_type      text not null check (entry_type in ('سحب عام','إيداع عام','استرداد وتوزيع أرباح','تأكيد استلام')),
  file_no         text null,
  amount          numeric not null check (amount > 0),
  capital_amount  numeric not null default 0,
  profit_amount   numeric not null default 0,
  pay_method      text null,
  document        text null,
  pay_date        date not null,
  notes           text null,
  ref_no          text not null,
  post_status     text not null default 'draft' check (post_status in ('draft','pending_edit','pending_void','posted','voided')),
  idempotency_key uuid null,
  created_at      timestamptz not null default now(),

  -- استرداد/تأكيد يتطلبان ملفًا؛ سحب/إيداع عام ممنوعان من الارتباط بملف —
  -- يمنع خلطًا دلاليًا (صرف مربوط بملف يُسجَّل كـ"سحب عام" فيفلت من سقف payableNow)
  constraint chk_file_link
    check (
      (entry_type in ('استرداد وتوزيع أرباح','تأكيد استلام') and file_no is not null)
      or (entry_type in ('سحب عام','إيداع عام') and file_no is null)
    ),
  -- استرداد/تأكيد: رأس مال+ربح = المبلغ بالضبط. سحب/إيداع عام: الاثنان صفر
  constraint chk_capital_profit_sum
    check (
      (entry_type in ('سحب عام','إيداع عام') and capital_amount = 0 and profit_amount = 0)
      or (entry_type in ('استرداد وتوزيع أرباح','تأكيد استلام') and abs(capital_amount + profit_amount - amount) < 0.01)
    )
);

create unique index if not exists uniq_partner_ledger_idempotency_key
  on partner_ledger (idempotency_key) where idempotency_key is not null;
create index if not exists idx_partner_ledger_file
  on partner_ledger (system_type, file_no) where file_no is not null;
create index if not exists idx_partner_ledger_partner
  on partner_ledger (system_type, partner);

alter table partner_ledger enable row level security;
drop policy if exists partner_ledger_all on partner_ledger;
create policy partner_ledger_all on partner_ledger for all to authenticated using (true) with check (true);
grant select, insert, update on partner_ledger to authenticated;

-- ════════════════════════════════════════════════════════════
-- 2) RPC واحدة: قفل + فحص السقف + الترقيم + الإدراج — كلها في نفس الـtransaction
-- ════════════════════════════════════════════════════════════
-- لماذا دالة واحدة لا دالتين منفصلتين (ترقيم ثم إدراج): PostgREST ينفّذ كل
-- نداء RPC في transaction مستقلة — أي قفل (صفّي أو استشاري) يُحرَّر لحظة رجوع
-- النداء. دالة "ترقيم" منفصلة ترجع الرقم بعد ما تحرّر قفلها، وبعدها JS يعمل
-- INSERT بنداء تاني بقفل مختلف — الفجوة بين النداءين تعيد فتح نفس السباق
-- تمامًا (دفعتان متزامنتان كل واحدة تُقرأ سليمة على حدة، تتجاوزان السقف معًا).
-- الحل الوحيد الحقيقي: عملية واحدة ذرّية تقفل وتفحص وترقّم وتُدرِج معًا.
--
-- p_gross_entitlement: الاستحقاق الإجمالي لهذا الشريك على هذا الملف، محسوب
-- في JS عبر computePartnerSettlement — لا تُعاد كتابة الحساب المعقّد هنا
-- بلغة SQL (قرار صريح: تكرار نفس الحساب بلغتين هو نمط الأخطاء اللي عولجت
-- طول هذه الجلسة — تسمية الخزينة، الحسابات الفرعية المهجورة).
--
-- ⚠️ حرج: يجب تمرير payableNow + withdrawnViaPayout (الإجمالي)، لا payableNow
-- وحدها (الصافي). payableNow أصلاً تطرح withdrawnViaPayout — تمريرها وحدها هنا
-- يعني خصمًا مزدوجًا لنفس المبلغ (اكتُشف تجريبيًا 2026-09-06: RPC رفضت 1200 من
-- مستحق حقيقي 2000 لأنها طرحت الـ1000 المسدَّدة سابقًا مرتين). js/core.js
-- createPartnerLedgerEntry تحسب هذا الجمع داخليًا من كائن التسوية مباشرة —
-- لا تستدعِ هذه الـRPC يدويًا بمعامل مفصول عن ذلك الحساب.
--
-- القفل هنا بيحمي فحص "المتراكم السابق (تحت partner_ledger، fresh عند القفل)
-- + الجديد ≤ الإجمالي" — وهو الجزء المعرَّض للسباق فعليًا، لا الحساب المحاسبي
-- نفسه. مطابق للموقف الأمني القائم في التطبيق كله (postDoubleEntry لا يعيد
-- التحقق من الأرصدة من طرف الخادم أيضًا) — لا يُدخِل هذا التصميم ثقة جديدة.
--
-- ملاحظة صريحة: نفس فئة السباق موجودة في سقف "سحب عام" (الرصيد التراكمي عبر
-- computePartnerGlobalBalance بحلقة عميل، بقرار مؤجَّل) — غير مُقفَلة هنا
-- عمدًا لأن "سحب عام" ليس مسارًا ساخنًا حاليًا (صفر استخدام فعلي)، ونفس منطق
-- تأجيل الأداء: تُعالَج بدليل حقيقي لو ظهرت كمشكلة، لا بافتراض مسبق.

-- drop قبل create or replace: تغيير اسم المعامل الأخير (p_payable_now →
-- p_gross_entitlement) توقيع مختلف — create or replace وحدها ترفضه
drop function if exists create_partner_ledger_entry(
  text, text, text, date, text, numeric, numeric, numeric, text, text, text, text, uuid, numeric
);

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
       and post_status in ('posted','draft','pending_edit');
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

grant execute on function create_partner_ledger_entry(
  text, text, text, date, text, numeric, numeric, numeric, text, text, text, text, uuid, numeric
) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 3) هجرة الصفّين الحاليين من partner_payouts
-- ════════════════════════════════════════════════════════════
-- القيود المحاسبية القائمة (journal_entries.ref_table='partner_payouts') لا
-- تُلمَس هنا عمدًا — core.js (تعديل JS منفصل) يتعرّف على 'partner_payouts'
-- و'partner_ledger' معًا، فلا حاجة لإعادة كتابة القيود التاريخية.
-- تحذير صريح للمرحلة ب: أي مسار void/edit مستقبلي يتتبّع ref_id في
-- partner_payouts (مثل updateJEInPlace) يجب أن يُحدَّث للبحث في
-- partner_ledger بدلاً منه — الصفوف لن توجد في الجدول القديم بعد هذه الهجرة.
insert into partner_ledger (system_type, partner, entry_type, file_no, amount,
  capital_amount, profit_amount, pay_method, document, pay_date, notes, ref_no,
  post_status, created_at)
select system_type, partner, 'استرداد وتوزيع أرباح', file_no, amount,
  capital_amount, profit_amount, pay_method, document, pay_date, notes, pay_id,
  post_status, created_at
from partner_payouts
where not exists (
  select 1 from partner_ledger pl where pl.ref_no = partner_payouts.pay_id
);
