-- نفّذ هذا في Supabase SQL Editor مرة واحدة. آمن يتكرر تشغيله (create or
-- replace / if not exists في كل مكان).
--
-- م٦ (سجل ترحيل الأرباح) — المرحلة الأولى فقط، بقرار مالك صريح 2026-09-22:
-- شريك دائم **مُسمَّى** (زي مازن الخلف) يرحّل ربح **ملفه هو تحديدًا** إلى
-- حسابه. ترحيل ربح "الصندوق"/"صندوق الترانزيت" نفسه وتوزيعه على الملّاك
-- الأربعة (بند ت٢ في docs/PLAN-partner-accounts-2026-09-17.md) مؤجَّل عمدًا
-- لمرحلة تانية بعد ما هذه المرحلة تشتغل وتتحقق حيًّا — الدالة تحت ترفض أي
-- محاولة ترحيل باسم الخزينة صراحة (raise exception)، لا صمت.
--
-- ════════════════════════════════════════════════════════════
-- 0) تصحيح تعليق عمود is_permanent (فجوة اكتُشفت 2026-09-22): النص الأصلي
-- ("لا مطالبة له برأس مال") هو بالحرف الصياغة اللي الخطة نفسها حذّرت من
-- تثبيتها في القاعدة بعد قرار ت١ (docs/PLAN-partner-accounts-2026-09-17.md
-- سطر 142) — صُحِّحت في النصوص/الواجهة وقتها لكن نُسي تعليق العمود الحقيقي.
-- ════════════════════════════════════════════════════════════
comment on column partner_account_links.is_permanent is
  'true = شريك دائم — المعيار: هل فلوس الشركة تمر على حسابه الجاري بلا أثر '
  '(البيع يرجّع النقد للشركة مباشرة، لا لحسابه)؟ دفعة من جيبه الشخصي فعليًا '
  'تُدان بحسابه زي أي شريك خارجي بالضبط (قرار ت١، 2026-09-20). '
  'false = شريك خارجي (يسترد رأس ماله + ربحه، رأس ماله الفعلي محسوب من '
  'مساهماته الحقيقية لا مُفترَض). '
  'NULL = لم يُصنَّف بعد — على القارئ أن يرفض لا أن يفترض. '
  'الخزينة ليس لها صف هنا أصلًا: استخدم is_permanent_partner() لا العمود مباشرة.';

-- ════════════════════════════════════════════════════════════
-- 1) جدول سجل الترحيل (من sql/profit_postings.sql القسم الثاني — مكتوب من
-- زمان، لم يُنفَّذ حتى الآن. أول تنفيذ فعلي له هنا)
-- ════════════════════════════════════════════════════════════
create table if not exists profit_postings (
  id             uuid primary key default gen_random_uuid(),
  system_type    text not null check (system_type in ('BOX','TM')),
  file_no        text null,
  partner        text not null check (partner = btrim(partner)),

  is_treasury    boolean generated always as (is_treasury_name(partner)) stored,
  partner_key    text    generated always as (
                   case when is_treasury_name(partner) then '#TREASURY#' else btrim(partner) end
                 ) stored,

  kind           text not null check (kind in ('ترحيل','تسوية','أرباح عامة')),
  share_percent  numeric null,
  file_profit    numeric null,
  amount         numeric not null,

  posting_id     uuid null references profit_postings(id),
  post_date      date not null,
  notes          text null,
  post_status    text not null default 'مُرحَّل' check (post_status in ('مُرحَّل','ملغى')),
  ref_no         text not null,
  created_by     text null,
  created_at     timestamptz not null default now(),

  constraint chk_pp_file_link check (
    (kind in ('ترحيل','تسوية') and file_no is not null)
    or (kind = 'أرباح عامة' and file_no is null)
  ),
  constraint chk_pp_posting_ref check (
    (kind = 'تسوية' and posting_id is not null)
    or (kind <> 'تسوية' and posting_id is null)
  )
);

-- منع الترحيل مرتين على نفس (النظام × الملف × الشريك) — قاعدة بيانات لا متصفح
create unique index if not exists uniq_profit_posting_once
  on profit_postings (system_type, file_no, partner_key)
  where kind = 'ترحيل' and post_status = 'مُرحَّل';

create index if not exists idx_profit_postings_file
  on profit_postings (system_type, file_no) where file_no is not null;
create index if not exists idx_profit_postings_partner
  on profit_postings (system_type, partner_key);

alter table profit_postings enable row level security;
drop policy if exists profit_postings_select on profit_postings;
create policy profit_postings_select on profit_postings
  for select to authenticated using (true);
grant select on profit_postings to authenticated;
-- ⚠️ بلا grant insert/update/delete — الكتابة حصرًا عبر post_profit_for_file
-- (security definer تحت)، زي partner_account_links بالضبط.

-- ════════════════════════════════════════════════════════════
-- 2) دالة الترحيل — المرحلة الأولى (شريك مُسمَّى، لا الخزينة)
-- ════════════════════════════════════════════════════════════
-- نمط مطابق لـpost_sale_je.sql (الدالة الموثوقة الموجودة لنفس فئة العملية:
-- كتابة صف + قيد معًا في معاملة واحدة، قفل صفّي، idempotency قبل/بعد القفل،
-- فهرس فريد كحماية إضافية).
--
-- ⚠️ قرار تصميمي صريح — ليه هنا تختلف عن partner_ledger_stage_a.sql
-- (p_gross_entitlement بييجي من المتصفح بلا إعادة حساب في SQL): الفرق في
-- الدور لا في الثقة. p_gross_entitlement هناك سقف تحقّق يُفحص كل مرة ضد رقم
-- موجود بالفعل (لو غلط: سحب يُرفض أو يُسمح بيه خطأً، قابل للتصحيح لاحقًا).
-- هنا الدالة نفسها مصدر الحقيقة الوحيد اللي بيثبّت رقم ربح دائم في 3200 —
-- رقم غلط من المتصفح هنا بيبقى تاريخ محاسبي دائم بلا أي تحقق مستقل. فالحساب
-- بيتم من القيود مباشرة على السيرفر، لا يُستقبَل كباراميتر من المستدعي.
--
-- ⚠️ خطر انحراف الصيغتين (JS/SQL) بمرور الوقت — مُقرّ به صراحة، معالَج بطبقتين:
--   ١) هذا التعليق + تعليق مقابل في computeFinancials (core.js) يحيل كل واحد للتاني.
--   ٢) الواجهة (core.js: postFileProfit) تعيد حساب نفس الملف/الشريك بـ
--      computeFinancials/computePartnerSettlement فور نجاح الترحيل وتقارن
--      بالرقم الراجع من هذه الدالة — أي فرق يُظهر تحذيرًا صارخًا فورًا،
--      لا سكريبت دوري لازم حد يفتكر يشغّله.
--
-- معادلة الربح هنا مطابقة لـcomputeFinancials.byFile[fn] بالحرف (core.js):
-- مبيعات (4xxx: دائن−مدين) − تكلفة المخزون المباع (5xxx عدا operating_expenses:
-- مدين−دائن) − مصاريف الصفقة (6xxx مدين>0 وref_table=expenses). بلا استبعاد
-- "قيد عكس خارج النافذة الزمنية" (fetchJEForPeriod فقط) لأن الاستعلام هنا
-- غير مقيَّد بتاريخ أصلًا — كل قيود الملف من البداية، زي computePartnerSettlement
-- بالضبط.
create or replace function post_profit_for_file(
  p_sys      text,
  p_file_no  text,
  p_partner  text
) returns table(
  posting_id       uuid,
  entry_no         text,
  file_profit      numeric,
  share_percent    numeric,
  amount           numeric,
  already_posted   boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role             text;
  v_partner_trimmed  text := btrim(p_partner);
  v_is_permanent     boolean;
  v_po_id            uuid;
  v_po_status        text;
  v_existing_id      uuid;
  v_existing_entry   text;
  v_existing_amount  numeric;
  v_existing_profit  numeric;
  v_existing_share   numeric;
  v_share_percent    numeric;
  v_tot_sales        numeric := 0;
  v_tot_cogs         numeric := 0;
  v_tot_deal_exp     numeric := 0;
  v_file_profit      numeric := 0;
  v_amount           numeric := 0;
  v_partner_acc      text;
  v_partner_acc_name text;
  v_entry_no         text;
  v_posting_id       uuid;
  v_now              timestamptz := now();
begin
  -- ══ 1. الصلاحية: المدير فقط، fail-closed (نفس نمط create_partner_account.sql) ══
  select role into v_role
    from public.user_roles
   where email = auth.jwt() ->> 'email'
     and systems like '%' || p_sys || '%'
   order by case role when 'admin' then 3 when 'employee' then 2 when 'readonly' then 1 else 0 end desc
   limit 1;
  if coalesce(v_role, '') <> 'admin' then
    raise exception 'ترحيل الأرباح مقصور على المدير';
  end if;

  -- ══ 2. الخزينة محجوزة للمرحلة التانية (ت٢) — رفض صريح لا صمت ══
  if is_treasury_name(v_partner_trimmed) then
    raise exception 'ترحيل ربح الصندوق/صندوق الترانزيت نفسه غير مدعوم في هذه المرحلة — يحتاج توزيعًا على الملّاك (ت٢)، قسم منفصل قادم';
  end if;

  -- ══ 3. التصنيف: دائم مُسمَّى فقط ══
  v_is_permanent := is_permanent_partner(p_sys, v_partner_trimmed);
  if v_is_permanent is null then
    raise exception 'الشريك "%" غير مصنَّف (دائم/خارجي) — لا يمكن ترحيل ربح له قبل التصنيف', v_partner_trimmed;
  end if;
  if v_is_permanent = false then
    raise exception 'الشريك "%" خارجي — ربحه يُصرف عبر "استرداد وتوزيع أرباح" لا الترحيل', v_partner_trimmed;
  end if;

  -- ══ 4. idempotency (فحص سريع قبل القفل) ══
  select id, ref_no, amount, file_profit, share_percent
    into v_existing_id, v_existing_entry, v_existing_amount, v_existing_profit, v_existing_share
    from profit_postings
   where system_type = p_sys and file_no = p_file_no and partner_key = v_partner_trimmed
     and kind = 'ترحيل' and post_status = 'مُرحَّل'
   limit 1;
  if v_existing_id is not null then
    return query select v_existing_id, v_existing_entry, v_existing_profit, v_existing_share, v_existing_amount, true;
    return;
  end if;

  -- ══ 5. قفل صفّي على سند الشراء — يسلسل أي نداء متزامن تاني لنفس الملف ══
  select id, status into v_po_id, v_po_status
    from purchase_orders
   where system_type = p_sys and file_no = p_file_no
   for update;
  if v_po_id is null then
    raise exception 'لا يوجد سند شراء لهذا الملف (%)', p_file_no;
  end if;
  if v_po_status <> 'CLOSED' then
    raise exception 'الملف % لسه مش مقفول (الحالة: %) — الترحيل يتطلب ملفًا مقفولًا', p_file_no, v_po_status;
  end if;

  -- ══ 6. إعادة فحص idempotency بعد القفل (الضمان الحقيقي) ══
  select id, ref_no, amount, file_profit, share_percent
    into v_existing_id, v_existing_entry, v_existing_amount, v_existing_profit, v_existing_share
    from profit_postings
   where system_type = p_sys and file_no = p_file_no and partner_key = v_partner_trimmed
     and kind = 'ترحيل' and post_status = 'مُرحَّل'
   limit 1;
  if v_existing_id is not null then
    return query select v_existing_id, v_existing_entry, v_existing_profit, v_existing_share, v_existing_amount, true;
    return;
  end if;

  -- ══ 7. نصيب الشريك في الملف ══
  select share_percent into v_share_percent
    from partners_master
   where system_type = p_sys and file_no = p_file_no and partner = v_partner_trimmed
   limit 1;
  if v_share_percent is null then
    raise exception 'الشريك "%" غير مسجَّل ضمن شركاء الملف %', v_partner_trimmed, p_file_no;
  end if;

  -- ══ 8. ربح الملف — من القيود مباشرة (راجع التعليق أعلى الدالة) ══
  select
    coalesce(sum(case when account_code like '4%' then cr_amount - dr_amount else 0 end), 0),
    coalesce(sum(case when account_code like '5%' and ref_table <> 'operating_expenses' then dr_amount - cr_amount else 0 end), 0),
    coalesce(sum(case when account_code like '6%' and dr_amount > 0 and ref_table = 'expenses' then dr_amount else 0 end), 0)
    into v_tot_sales, v_tot_cogs, v_tot_deal_exp
    from journal_entries
   where system_type = p_sys and file_no = p_file_no and post_status = 'posted';

  v_file_profit := v_tot_sales - v_tot_cogs - v_tot_deal_exp;
  v_amount := round(v_file_profit * v_share_percent / 100.0, 2);

  if v_amount = 0 then
    raise exception 'نصيب "%" من ربح الملف % = صفر — لا يوجد ما يُرحَّل', v_partner_trimmed, p_file_no;
  end if;

  -- ══ 9. حساب الشريك المخصَّص ══
  select account_code into v_partner_acc
    from partner_account_links
   where system_type = p_sys and partner_name = v_partner_trimmed;
  if v_partner_acc is null then
    raise exception 'الشريك "%" ليس له حساب مربوط في partner_account_links', v_partner_trimmed;
  end if;
  select account_name into v_partner_acc_name
    from chart_of_accounts
   where system_type = p_sys and account_code = v_partner_acc;

  -- ══ 10. الكتابة الذرّية: صف السجل + سطرا القيد معًا ══
  v_entry_no   := next_je_no(p_sys);
  v_posting_id := gen_random_uuid();

  insert into profit_postings
    (id, system_type, file_no, partner, kind, share_percent, file_profit, amount,
     post_date, ref_no, created_by)
  values
    (v_posting_id, p_sys, p_file_no, v_partner_trimmed, 'ترحيل', v_share_percent, v_file_profit, v_amount,
     current_date, v_entry_no, auth.jwt() ->> 'email');

  -- القيد: مدين 3200 / دائن حساب الشريك (ربح) — والعكس تلقائيًا لو خسارة
  if v_amount > 0 then
    insert into journal_entries
      (system_type, entry_no, entry_date, account_code, account_name, contact_name,
       dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
    values
      (p_sys, v_entry_no, current_date, '3200', 'الأرباح المبقاة', null,
       v_amount, 0, 'ترحيل ربح ملف ' || p_file_no || ' — ' || v_partner_trimmed, 'profit_postings', v_posting_id::text, p_file_no, 'posted', v_now),
      (p_sys, v_entry_no, current_date, v_partner_acc, v_partner_acc_name, v_partner_trimmed,
       0, v_amount, 'ترحيل ربح ملف ' || p_file_no || ' — ' || v_partner_trimmed, 'profit_postings', v_posting_id::text, p_file_no, 'posted', v_now);
  else
    insert into journal_entries
      (system_type, entry_no, entry_date, account_code, account_name, contact_name,
       dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
    values
      (p_sys, v_entry_no, current_date, v_partner_acc, v_partner_acc_name, v_partner_trimmed,
       abs(v_amount), 0, 'ترحيل خسارة ملف ' || p_file_no || ' — ' || v_partner_trimmed, 'profit_postings', v_posting_id::text, p_file_no, 'posted', v_now),
      (p_sys, v_entry_no, current_date, '3200', 'الأرباح المبقاة', null,
       0, abs(v_amount), 'ترحيل خسارة ملف ' || p_file_no || ' — ' || v_partner_trimmed, 'profit_postings', v_posting_id::text, p_file_no, 'posted', v_now);
  end if;

  return query select v_posting_id, v_entry_no, v_file_profit, v_share_percent, v_amount, false;
end;
$$;

grant execute on function post_profit_for_file(text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 3) تحقق بعد التنفيذ (قراءة فقط)
-- ════════════════════════════════════════════════════════════
-- select column_name, data_type from information_schema.columns
--   where table_name='profit_postings' order by ordinal_position;
-- select count(*) from profit_postings; -- المتوقَّع 0 قبل أي ترحيل فعلي
