-- اختبار انحدار (regression) حي على post_sale_je بعد إصلاحي 2026-07-27 (NULL fix + reversal netting).
-- بيانات ZZTEST معزولة بالكامل (file_no فريد)، بتتنضف تلقائيًا آخر السكريبت.
-- يحاكي شكل BOX-138 بالظبط: ملف فيه 3 شاحنات —
--   A: اتباعت قديم بقيد COGS بلا ref_id (null) — يفحص إصلاح NULL.
--   B: اتباعت قديم بقيد COGS بلا ref_id، وبعدين اتعكست بقيد عكسي — يفحص إصلاح صافي العكس.
--   C: لسه ما اتباعتش — هنبيعها دلوقتي عبر post_sale_je ونتأكد من التكلفة الناتجة.
--
-- الحساب المتوقع يدويًا:
--   fullCost = 30000 (شراء فقط، بلا مصاريف) لـ3 شاحنات.
--   already_cogs الصحيح = 8000 (A) + 7000 (B الأصلي) − 7000 (عكس B) = 8000.
--   already_sold = 1 (A بس، B مش 'posted' لأنها 'voided').
--   remaining_trucks = max(3−1, 1) = 2.  remaining_cost = max(30000−8000,0) = 22000.
--   cost_per_truck = 22000/2 = 11000.  COGS المتوقع لفاتورة C = 11000.00.
-- لو الإصلاح القديم (قبل اليوم) كان لسه شغّال، already_cogs كانت هتطلع 0 (تستبعد A وB
-- الأصلي غلط بسبب NULL، وتتجاهل عكس B لأنه بيجمع dr فقط) فتطلع COGS مبالغ فيها (30000/2=15000).

do $$
declare
  v_file_no   text := 'ZZTEST-NULLFIX-' || floor(random()*1000000)::text;
  v_entry_no  text;
  v_cogs      numeric;
  v_already   boolean;
  v_expected  numeric := 11000.00;
begin
  -- ── إعداد البيانات ──
  insert into purchase_orders (system_type, file_no, supplier, total_purchase, vehicle_count, status, post_status)
  values ('BOX', v_file_no, 'ZZTEST-SUPPLIER', 30000, 3, 'OPEN', 'posted');

  insert into vehicles (system_type, file_no, vin, vehicle_type, purchase_price)
  values
    ('BOX', v_file_no, 'ZZT-A', 'TRUCK', 10000),
    ('BOX', v_file_no, 'ZZT-B', 'TRUCK', 10000),
    ('BOX', v_file_no, 'ZZT-C', 'TRUCK', 10000);

  -- الشاحنة A: قيد COGS قديم بلا ref_id (يحاكي مبيعات ما قبل 2026-07-26)
  insert into journal_entries
    (system_type, entry_no, entry_date, entry_type, account_code, account_name,
     dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
  values
    ('BOX', next_je_no('BOX'), current_date, 'journal', '5100', 'تكلفة المخزون المباع',
     8000, 0, 'ZZTEST بيع قديم A', 'sales', null, v_file_no, 'posted', now());

  -- الشاحنة B: قيد COGS قديم بلا ref_id، ثم عكسه (يحاكي فاتورة أُلغيت لاحقًا)
  insert into journal_entries
    (system_type, entry_no, entry_date, entry_type, account_code, account_name,
     dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
  values
    ('BOX', next_je_no('BOX'), current_date, 'journal', '5100', 'تكلفة المخزون المباع',
     7000, 0, 'ZZTEST بيع قديم B', 'sales', null, v_file_no, 'posted', now());
  insert into journal_entries
    (system_type, entry_no, entry_date, entry_type, account_code, account_name,
     dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
  values
    ('BOX', next_je_no('BOX'), current_date, 'journal', '5100', 'تكلفة المخزون المباع',
     0, 7000, 'ZZTEST عكس بيع قديم B', 'reversal', null, v_file_no, 'posted', now());

  insert into sales (system_type, file_no, vin, inv_no, customer, sale_price, sale_date, post_status)
  values
    ('BOX', v_file_no, 'ZZT-A', 'ZZTEST-OLD-A', 'ZZTEST Customer A', 12000, current_date, 'posted'),
    ('BOX', v_file_no, 'ZZT-B', 'ZZTEST-OLD-B', 'ZZTEST Customer B', 11000, current_date, 'voided');

  -- ── التنفيذ: بيع الشاحنة C عبر post_sale_je ──
  select entry_no, cogs_amount, already_posted
    into v_entry_no, v_cogs, v_already
  from post_sale_je('BOX', v_file_no, 'ZZTEST-INV-NEW-C', 'ZZTEST Customer', current_date, array['ZZT-C'], 15000);

  raise notice 'entry_no=% cogs_amount=% already_posted=% (متوقع=%)', v_entry_no, v_cogs, v_already, v_expected;

  if v_already then
    raise exception 'فشل: already_posted=true رغم إنها أول مرة';
  end if;

  if abs(v_cogs - v_expected) > 0.01 then
    raise exception 'فشل الاختبار: COGS الفعلي % لا يطابق المتوقع %', v_cogs, v_expected;
  end if;

  raise notice '✅ نجح الاختبار: COGS = % يطابق المتوقع تمامًا', v_cogs;

  -- ── تنظيف كامل لبيانات ZZTEST ──
  delete from journal_entries where file_no = v_file_no and system_type = 'BOX';
  delete from sales where file_no = v_file_no and system_type = 'BOX';
  delete from vehicles where file_no = v_file_no and system_type = 'BOX';
  delete from purchase_orders where file_no = v_file_no and system_type = 'BOX';

  raise notice '🧹 تم تنظيف كل بيانات % بنجاح', v_file_no;
end $$;
