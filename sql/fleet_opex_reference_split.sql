-- ============================================================================
-- فصل وظيفي لـ"المصروفات التشغيلية العمومية" عن "مصروفات المركبات" —
-- زي opex في BOX/TM (مراجعة حية لـjs/operations.js + js/core.js
-- computeFinancials قبل التصميم ده)، لكن جوه نفس الجدول/RPC الموجودين
-- (fleet_expense_bills/fleet_issue_bill) بدل تكرار بنية تحتية مُختبَرة كاملة —
-- قرار معتمد: vehicle_id nullable من الأصل (Phase 5) يحقق نفس الفصل
-- المحاسبي (مصروف عمومي مستبعد من صافي أي سيارة أصلاً)، فمفيش داعي لجدول
-- منفصل زي ما BOX/TM اضطرت له (لأن expenses.file_no عندهم إجباري، غير nullable).
--
-- التعديل الوحيد هنا: مرجع مميَّز — OPEX-YYYY-NNNNN للمصروف العمومي
-- (vehicle_id فارغ) بدل BILL-YYYY-NNNNN، بنفس آلية fleet_next_seq الذرّية
-- الموجودة (doc_type جديد 'opex' على نفس جدول fleet_counters).
--
-- آمن يتشغّل أكتر من مرة (create or replace function).
-- ============================================================================

create or replace function fleet.fleet_issue_bill(
  p_client_uuid  uuid,
  p_vehicle_id   bigint,
  p_account_code text,
  p_for_month    date,
  p_amount       numeric,
  p_issue_date   date default current_date
) returns fleet.fleet_expense_bills
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_bill              fleet.fleet_expense_bills;
  v_bill_no           text;
  v_constraint_name   text;
begin
  select * into v_bill from fleet.fleet_expense_bills where client_uuid = p_client_uuid;
  if found then
    return v_bill;
  end if;

  v_bill_no := fleet.fleet_next_seq(case when p_vehicle_id is null then 'opex' else 'bill' end);

  insert into fleet.fleet_expense_bills
    (client_uuid, bill_no, vehicle_id, account_code, for_month, amount, issue_date, post_status)
  values (p_client_uuid, v_bill_no, p_vehicle_id, p_account_code, p_for_month, p_amount, p_issue_date, 'posted')
  returning * into v_bill;

  perform fleet.fleet_post_je(
    p_issue_date,
    jsonb_build_array(
      jsonb_build_object('account_code',p_account_code,'dr_amount',p_amount,'cr_amount',0,
                          'description_ar','التزام مصروف '||v_bill_no,'description_en','Expense bill '||v_bill_no),
      jsonb_build_object('account_code','2100','dr_amount',0,'cr_amount',p_amount,
                          'description_ar','التزام مصروف '||v_bill_no,'description_en','Expense bill '||v_bill_no)
    ),
    'fleet_expense_bills', v_bill.id, p_vehicle_id, null, null
  );

  return v_bill;
exception when unique_violation then
  get stacked diagnostics v_constraint_name = constraint_name;
  if v_constraint_name = 'uq_fleet_expense_bills_active_month' then
    raise exception 'يوجد بالفعل التزام مرحّل لنفس السيارة/التصنيف/الشهر';
  else
    raise;
  end if;
end;
$$;
