-- نفّذ هذا في Supabase SQL Editor مرة واحدة.
-- يحل مشكلتين في احتساب/ترحيل تكلفة البيع (COGS) اللي كانتا سبب انحراف حقيقي
-- على 8 ملفات في BOX (اكتُشف عبر checkCOGSInvariant/auditAllFilesCOGS, js/engine.js):
--   1. الحساب كان بيتعمل على العميل (calcCOGS, js/engine.js) باستعلامات حيّة
--      منفصلة — لو فاتورتين لنفس الملف اتعتمدوا قريب من بعض (ثوانٍ) كل واحدة
--      ممكن تشوف صورة غير مكتملة عن "قد إيه اتباع فعلاً لحد دلوقتي".
--   2. القيد مفيهوش ref_id حقيقي (كان دايمًا null) — فأي عملية عكس/إلغاء بعدين
--      كانت بتدور على سطوره بمطابقة نص في description، مش معرّف مضمون.
-- الدالة دي بتاخد قفل صفّي على purchase_orders بتاع الملف طول الـ transaction
-- (كل ملف عنده صف واحد بالفعل) — فأي نداءين متزامنين لنفس الملف يتسلسلوا
-- تلقائيًا بدل ما يتسابقوا، وبترحّل ref_id=رقم الفاتورة على سطور القيد.
--
-- المعادلة الحسابية مطابقة لـ calcCOGS (js/engine.js) سطر بسطر: نفس فصل
-- قطع الغيار (VIN يبدأ بـ PART-) عن متوسط الشاحنات، نفس Math.max(...,0)،
-- نفس التقريب لمنزلتين عشريتين — الفرق الوحيد: alreadySold/alreadyCOGS هنا
-- بيُستثنى منهم صراحةً سطر الفاتورة الحالية (p_inv_no)، فمفيش فرق سواء
-- الاستدعاء حصل قبل أو بعد ما حالة الفاتورة اتقلبت 'posted'.

create or replace function post_sale_je(
  p_sys          text,
  p_file_no      text,
  p_inv_no       text,
  p_customer     text,
  p_date         date,
  p_sold_vins    text[],
  p_sale_amount  numeric
) returns table(entry_no text, cogs_amount numeric, already_posted boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_po_id            uuid;
  v_total_purchase   numeric := 0;
  v_total_exp        numeric := 0;
  v_full_cost        numeric := 0;
  v_parts_cost       numeric := 0;
  v_truck_count      int     := 0;
  v_truck_cost       numeric := 0;
  v_sold_part_vins   text[];
  v_sold_truck_count int     := 0;
  v_part_cogs        numeric := 0;
  v_already_sold     int     := 0;
  v_already_cogs_raw numeric := 0;
  v_already_part_cogs numeric := 0;
  v_already_cogs     numeric := 0;
  v_remaining_trucks int;
  v_remaining_cost   numeric;
  v_cost_per_truck   numeric;
  v_truck_cogs       numeric := 0;
  v_cogs             numeric := 0;
  v_entry_no         text;
  v_existing_entry   text;
  v_now              timestamptz := now();
begin
  if p_sale_amount is null or p_sale_amount <= 0 then
    raise exception 'قيمة فاتورة بيع غير صالحة (%) — لن يُسجَّل القيد', p_sale_amount;
  end if;

  -- ── idempotency (فحص سريع قبل القفل — توفير، مش الضمان الحقيقي) ──
  -- ✅ مقيّد بـfile_no كمان (مش ref_id لوحده) — يمنع تصادم لو نفس النص
  -- استُخدم كـref_id في ملفين مختلفين بالخطأ
  select je.entry_no into v_existing_entry
  from journal_entries je
  where je.system_type = p_sys and je.file_no = p_file_no
    and je.ref_table = 'sales' and je.ref_id = p_inv_no
    and je.post_status = 'posted'
  limit 1;

  if v_existing_entry is not null then
    -- ⚠️ entry_no لازم يتأهّل باسم الجدول (journal_entries.entry_no) — عمود returns
    -- table(entry_no ...) بيعمل متغيّر PL/pgSQL بنفس الاسم في نطاق الدالة، فالعمود
    -- المجرّد كان يطلع "column reference entry_no is ambiguous" (اتأكد حيًّا 2026-07-27)
    select coalesce(sum(dr_amount), 0) into v_already_cogs_raw
    from journal_entries
    where system_type = p_sys and journal_entries.entry_no = v_existing_entry and account_code = '5100';
    return query select v_existing_entry, v_already_cogs_raw, true;
    return;
  end if;

  -- ── قفل صفّي على سند الشراء بتاع الملف — يسلسل أي نداء متزامن تاني لنفس الملف ──
  select id, coalesce(total_purchase, 0) into v_po_id, v_total_purchase
  from purchase_orders
  where system_type = p_sys and file_no = p_file_no
  for update;

  if v_po_id is null then
    raise exception 'لا يوجد سند شراء لهذا الملف (%) — لا يمكن احتساب التكلفة', p_file_no;
  end if;

  -- ✅ إعادة فحص idempotency بعد أخذ القفل — الفحص الأول قبل القفل ممكن يفوت
  -- نداءين متزامنين لنفس الفاتورة الجديدة (الاتنين يعدّوا "لسه معمولة")؛
  -- هذا هو الضمان الحقيقي: بمجرد أخذ القفل، أي نداء تاني وصل هنا بعد ما
  -- الأول خلّص وعمل commit هيلاقي القيد موجود فعلاً ويرجع من غير تكرار
  select je.entry_no into v_existing_entry
  from journal_entries je
  where je.system_type = p_sys and je.file_no = p_file_no
    and je.ref_table = 'sales' and je.ref_id = p_inv_no
    and je.post_status = 'posted'
  limit 1;

  if v_existing_entry is not null then
    -- ⚠️ نفس تأهيل journal_entries.entry_no أعلاه — هذا هو الفحص الثاني بعد القفل
    select coalesce(sum(dr_amount), 0) into v_already_cogs_raw
    from journal_entries
    where system_type = p_sys and journal_entries.entry_no = v_existing_entry and account_code = '5100';
    return query select v_existing_entry, v_already_cogs_raw, true;
    return;
  end if;

  select coalesce(sum(amount), 0) into v_total_exp
  from expenses
  where system_type = p_sys and file_no = p_file_no and post_status = 'posted';

  v_full_cost := v_total_purchase + v_total_exp;

  select coalesce(sum(purchase_price), 0) into v_parts_cost
  from vehicles
  where system_type = p_sys and file_no = p_file_no and vin like 'PART-%';

  select count(*) into v_truck_count
  from vehicles
  where system_type = p_sys and file_no = p_file_no and vin not like 'PART-%';

  v_truck_cost := greatest(v_full_cost - v_parts_cost, 0);

  -- ── تصنيف بنود هذه الفاتورة: قطع vs شاحنات ──
  select array_agg(v) into v_sold_part_vins
  from unnest(coalesce(p_sold_vins, array[]::text[])) as v
  where v like 'PART-%';

  select count(*) into v_sold_truck_count
  from unnest(coalesce(p_sold_vins, array[]::text[])) as v
  where v not like 'PART-%';

  select coalesce(sum(vh.purchase_price), 0) into v_part_cogs
  from vehicles vh
  where vh.system_type = p_sys and vh.file_no = p_file_no
    and vh.vin = any(coalesce(v_sold_part_vins, array[]::text[]));

  if v_sold_truck_count > 0 then
    -- ✅ استثناء صريح لسطور هذه الفاتورة نفسها (p_inv_no) — بغض النظر هل
    -- حالتها اتقلبت 'posted' قبل النداء ده ولا لسه 'draft'
    select count(*) into v_already_sold
    from sales
    where system_type = p_sys and file_no = p_file_no and post_status = 'posted'
      and inv_no is distinct from p_inv_no
      and vin not like 'PART-%';

    select coalesce(sum(dr_amount), 0) into v_already_cogs_raw
    from journal_entries
    where system_type = p_sys and file_no = p_file_no and account_code = '5100'
      and post_status = 'posted'
      and not (ref_table = 'sales' and ref_id = p_inv_no);

    -- ✅ نطرح حصة القطع (PART-) المباعة سابقًا من الرصيد الخام — نفس
    -- engine.js:611-616 بالظبط. من غير الطرح ده، رصيد "الباقي" بتاع الشاحنات
    -- بيتضخّم غلط بأي ملف فيه قطع، فيقل متوسط تكلفة الشاحنة تحت الحقيقي
    -- (نفس فئة انحراف BOX-138 — صامت بلا خطأ ظاهر)
    select coalesce(sum(vh2.purchase_price), 0) into v_already_part_cogs
    from sales s2
    join vehicles vh2
      on vh2.system_type = p_sys and vh2.file_no = p_file_no and vh2.vin = s2.vin
    where s2.system_type = p_sys and s2.file_no = p_file_no and s2.post_status = 'posted'
      and s2.inv_no is distinct from p_inv_no
      and s2.vin like 'PART-%';

    v_already_cogs := greatest(v_already_cogs_raw - v_already_part_cogs, 0);

    v_remaining_trucks := greatest(v_truck_count - v_already_sold, v_sold_truck_count);
    v_remaining_cost   := greatest(v_truck_cost - v_already_cogs, 0);
    v_cost_per_truck   := case when v_remaining_trucks > 0 then v_remaining_cost / v_remaining_trucks else 0 end;
    v_truck_cogs       := v_cost_per_truck * v_sold_truck_count;
  end if;

  v_cogs := round((v_part_cogs + v_truck_cogs)::numeric, 2);

  -- ── ترحيل القيد (نفس رقم next_je_no الذري الموجود، داخل نفس الـtransaction) ──
  v_entry_no := next_je_no(p_sys);

  insert into journal_entries
    (system_type, entry_no, entry_date, account_code, account_name, contact_name,
     dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
  values
    (p_sys, v_entry_no, p_date, '1200', 'ذمم العملاء', p_customer,
     p_sale_amount, 0, 'فاتورة ' || p_inv_no, 'sales', p_inv_no, p_file_no, 'posted', v_now),
    (p_sys, v_entry_no, p_date, '4100', 'إيرادات المبيعات', null,
     0, p_sale_amount, 'فاتورة ' || p_inv_no, 'sales', p_inv_no, p_file_no, 'posted', v_now);

  if v_cogs > 0 then
    insert into journal_entries
      (system_type, entry_no, entry_date, account_code, account_name, contact_name,
       dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
    values
      (p_sys, v_entry_no, p_date, '5100', 'تكلفة المخزون المباع', null,
       v_cogs, 0, 'بيع فاتورة ' || p_inv_no || ' — ' || coalesce(p_customer, '') || ' — ملف ' || p_file_no,
       'sales', p_inv_no, p_file_no, 'posted', v_now),
      (p_sys, v_entry_no, p_date, '1300', 'المخزون — سيارات', null,
       0, v_cogs, 'بيع فاتورة ' || p_inv_no || ' — ' || coalesce(p_customer, '') || ' — ملف ' || p_file_no,
       'sales', p_inv_no, p_file_no, 'posted', v_now);
  end if;

  return query select v_entry_no, v_cogs, false;
end;
$$;

-- السماح للمستخدمين الموثّقين باستدعاء الدالة (RLS على journal_entries تبقى كما هي للحماية الفعلية)
grant execute on function post_sale_je(text, text, text, text, date, text[], numeric) to authenticated;

-- ✅ حماية إضافية على مستوى القاعدة (defense-in-depth): الفحص أعلاه بعد القفل
-- كافٍ نظريًا تحت READ COMMITTED، لكن index فريد بيمنع الازدواج فعليًا حتى لو
-- مسار كود مستقبلي (تصحيح يدوي، أداة صيانة) دخل بيانات مباشرة من غير المرور
-- بهذه الدالة. مقيّد بـaccount_code='4100' لأن كل قيد بيع له سطر 4100 واحد
-- بالظبط (باقي السطور بتتكرر ref_id بينها داخل نفس القيد، فـindex عام كان
-- هيكسر الترحيل الطبيعي لأي قيد بيع من أول سطر تاني).
create unique index if not exists uq_je_sales_ref_id_posted
  on journal_entries (system_type, file_no, ref_id)
  where post_status = 'posted' and ref_table = 'sales' and account_code = '4100';
