-- ============================================================================
-- خطة الصلاحيات — المرحلة 2: تفعيل فرق الأدوار داخل قاعدة الفليت.
-- نبدأ بعمليات الإلغاء (الأخطر ماليًا) بس — باقي دوال الفليت (الإصدار/
-- التحصيل/السداد/CRUD السيارات والسائقين) بلا تغيير عمدًا في المرحلة دي.
--
-- fleet.fleet_user_role(): نفس نمط fleet.is_fleet_user() بالحرف (security
-- definer، بيقرا user_roles بالإيميل من auth.jwt())، لكن بترجع role الفعلي
-- بدل boolean. لو أكتر من صف مطابق (نادر، لكن ممكن) بياخد أعلى صلاحية —
-- نفس منطق ROLE_RANK في mergeUserRows (js/settings.js) بالضبط، مش صف عشوائي.
--
-- هذا الملف يُراجَع ويُشغَّل يدويًا من المستخدم عبر Supabase SQL Editor.
-- آمن يتكرر تشغيله (create or replace function).
-- ============================================================================

create or replace function fleet.fleet_user_role() returns text
language sql security definer set search_path = public, pg_temp as $$
  select role from public.user_roles
  where email = auth.jwt() ->> 'email'
    and systems like '%FLEET%'
  order by case role when 'admin' then 3 when 'employee' then 2 when 'readonly' then 1 else 0 end desc
  limit 1;
$$;

-- coalesce(...,'') إلزامي: لو fleet_user_role() رجّعت NULL (لا صف مطابق)،
-- 'NULL <> admin' بترجع NULL مش TRUE في SQL، وIF بتتعامل معاها كـFALSE —
-- يعني الشرط كان هيفشل يفتح (fail-open) بدل يرفض (fail-closed) في أي حالة
-- غير متوقعة. coalesce بيضمن رفض صريح دايمًا إلا لو role='admin' بالظبط.

create or replace function fleet.fleet_void_receipt(p_receipt_id bigint) returns void
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_receipt         fleet.fleet_receipts;
  v_invoice         fleet.fleet_rent_invoices;
  v_orig_entry_no   text;
begin
  if coalesce(fleet.fleet_user_role(), '') <> 'admin' then
    raise exception 'الإلغاء مقصور على المدير فقط';
  end if;

  select * into v_receipt from fleet.fleet_receipts where id = p_receipt_id for update;
  if not found then raise exception 'السند غير موجود'; end if;
  if v_receipt.post_status <> 'posted' then raise exception 'السند ملغى بالفعل'; end if;

  select * into v_invoice from fleet.fleet_rent_invoices where id = v_receipt.invoice_id;

  select entry_no into v_orig_entry_no from fleet.fleet_journal_entries
    where ref_table = 'fleet_receipts' and ref_id = v_receipt.id and post_status = 'posted' limit 1;

  perform fleet.fleet_post_je(
    current_date,
    jsonb_build_array(
      jsonb_build_object('account_code','1200','dr_amount',v_receipt.amount,'cr_amount',0,
                          'description_ar','عكس سند قبض '||v_receipt.receipt_no,'description_en','Reversal of receipt '||v_receipt.receipt_no),
      jsonb_build_object('account_code','1110','dr_amount',0,'cr_amount',v_receipt.amount,
                          'description_ar','عكس سند قبض '||v_receipt.receipt_no,'description_en','Reversal of receipt '||v_receipt.receipt_no)
    ),
    'fleet_receipts', v_receipt.id, v_invoice.vehicle_id, v_invoice.driver_id, v_orig_entry_no
  );

  update fleet.fleet_receipts set post_status = 'voided' where id = p_receipt_id;
end;
$$;

create or replace function fleet.fleet_void_invoice(p_invoice_id bigint) returns void
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_invoice           fleet.fleet_rent_invoices;
  v_orig_entry_no     text;
  v_active_receipts   int;
begin
  if coalesce(fleet.fleet_user_role(), '') <> 'admin' then
    raise exception 'الإلغاء مقصور على المدير فقط';
  end if;

  select * into v_invoice from fleet.fleet_rent_invoices where id = p_invoice_id for update;
  if not found then raise exception 'الفاتورة غير موجودة'; end if;
  if v_invoice.post_status <> 'posted' then raise exception 'الفاتورة ملغاة بالفعل'; end if;

  select count(*) into v_active_receipts from fleet.fleet_receipts
    where invoice_id = p_invoice_id and post_status = 'posted';
  if v_active_receipts > 0 then
    raise exception 'لا يمكن إلغاء الفاتورة — يوجد % سند قبض مُرحَّل عليها، يجب إلغاؤه أولًا', v_active_receipts;
  end if;

  select entry_no into v_orig_entry_no from fleet.fleet_journal_entries
    where ref_table = 'fleet_rent_invoices' and ref_id = v_invoice.id and post_status = 'posted' limit 1;

  perform fleet.fleet_post_je(
    current_date,
    jsonb_build_array(
      jsonb_build_object('account_code','4100','dr_amount',v_invoice.amount,'cr_amount',0,
                          'description_ar','عكس فاتورة '||v_invoice.invoice_no,'description_en','Reversal of invoice '||v_invoice.invoice_no),
      jsonb_build_object('account_code','1200','dr_amount',0,'cr_amount',v_invoice.amount,
                          'description_ar','عكس فاتورة '||v_invoice.invoice_no,'description_en','Reversal of invoice '||v_invoice.invoice_no)
    ),
    'fleet_rent_invoices', v_invoice.id, v_invoice.vehicle_id, v_invoice.driver_id, v_orig_entry_no
  );

  update fleet.fleet_rent_invoices set post_status = 'voided' where id = p_invoice_id;
end;
$$;

create or replace function fleet.fleet_void_payment(p_payment_id bigint) returns void
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_payment        fleet.fleet_payments;
  v_bill           fleet.fleet_expense_bills;
  v_orig_entry_no  text;
begin
  if coalesce(fleet.fleet_user_role(), '') <> 'admin' then
    raise exception 'الإلغاء مقصور على المدير فقط';
  end if;

  select * into v_payment from fleet.fleet_payments where id = p_payment_id for update;
  if not found then raise exception 'السند غير موجود'; end if;
  if v_payment.post_status <> 'posted' then raise exception 'السند ملغى بالفعل'; end if;

  select * into v_bill from fleet.fleet_expense_bills where id = v_payment.bill_id;

  select entry_no into v_orig_entry_no from fleet.fleet_journal_entries
    where ref_table = 'fleet_payments' and ref_id = v_payment.id and post_status = 'posted' limit 1;

  perform fleet.fleet_post_je(
    current_date,
    jsonb_build_array(
      jsonb_build_object('account_code','1110','dr_amount',v_payment.amount,'cr_amount',0,
                          'description_ar','عكس سند صرف '||v_payment.payment_no,'description_en','Reversal of payment '||v_payment.payment_no),
      jsonb_build_object('account_code','2100','dr_amount',0,'cr_amount',v_payment.amount,
                          'description_ar','عكس سند صرف '||v_payment.payment_no,'description_en','Reversal of payment '||v_payment.payment_no)
    ),
    'fleet_payments', v_payment.id, v_bill.vehicle_id, null, v_orig_entry_no
  );

  update fleet.fleet_payments set post_status = 'voided' where id = p_payment_id;
end;
$$;

create or replace function fleet.fleet_void_bill(p_bill_id bigint) returns void
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_bill              fleet.fleet_expense_bills;
  v_orig_entry_no     text;
  v_active_payments   int;
begin
  if coalesce(fleet.fleet_user_role(), '') <> 'admin' then
    raise exception 'الإلغاء مقصور على المدير فقط';
  end if;

  select * into v_bill from fleet.fleet_expense_bills where id = p_bill_id for update;
  if not found then raise exception 'الالتزام غير موجود'; end if;
  if v_bill.post_status <> 'posted' then raise exception 'الالتزام ملغى بالفعل'; end if;

  select count(*) into v_active_payments from fleet.fleet_payments
    where bill_id = p_bill_id and post_status = 'posted';
  if v_active_payments > 0 then
    raise exception 'لا يمكن إلغاء الالتزام — يوجد % سند صرف مُرحَّل عليه، يجب إلغاؤه أولًا', v_active_payments;
  end if;

  select entry_no into v_orig_entry_no from fleet.fleet_journal_entries
    where ref_table = 'fleet_expense_bills' and ref_id = v_bill.id and post_status = 'posted' limit 1;

  perform fleet.fleet_post_je(
    current_date,
    jsonb_build_array(
      jsonb_build_object('account_code','2100','dr_amount',v_bill.amount,'cr_amount',0,
                          'description_ar','عكس التزام '||v_bill.bill_no,'description_en','Reversal of bill '||v_bill.bill_no),
      jsonb_build_object('account_code',v_bill.account_code,'dr_amount',0,'cr_amount',v_bill.amount,
                          'description_ar','عكس التزام '||v_bill.bill_no,'description_en','Reversal of bill '||v_bill.bill_no)
    ),
    'fleet_expense_bills', v_bill.id, v_bill.vehicle_id, null, v_orig_entry_no
  );

  update fleet.fleet_expense_bills set post_status = 'voided' where id = p_bill_id;
end;
$$;
