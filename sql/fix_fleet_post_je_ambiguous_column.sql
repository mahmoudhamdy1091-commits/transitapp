-- ============================================================================
-- إصلاح: column reference "v_line" is ambiguous في fleet_post_je
-- اكتُشف عبر scripts/regression-fleet.js (مش بالمراجعة الثابتة للكود) —
-- v_line كان اسم متغيّر PL/pgSQL (حلقة FOR) وكمان alias لجدول في نفس الدالة.
-- CREATE OR REPLACE FUNCTION آمن يتشغّل بمفرده — مش محتاج تشغيل sql/fleet_schema.sql
-- كامل تاني (فيه create policy مش idempotent هيفشل لو اتكرر).
-- ============================================================================

create or replace function fleet.fleet_post_je(
  p_entry_date        date,
  p_lines              jsonb,
  p_ref_table          text,
  p_ref_id             bigint,
  p_vehicle_id         bigint,
  p_driver_id          bigint,
  p_reverses_entry_no  text default null
) returns text
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_entry_no  text;
  v_dr_sum    numeric(14,3) := 0;
  v_cr_sum    numeric(14,3) := 0;
  v_line      jsonb;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'fleet_post_je: لا يوجد سطور للقيد';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_dr_sum := v_dr_sum + coalesce((v_line->>'dr_amount')::numeric, 0);
    v_cr_sum := v_cr_sum + coalesce((v_line->>'cr_amount')::numeric, 0);
  end loop;

  if round(v_dr_sum, 3) <> round(v_cr_sum, 3) then
    raise exception 'fleet_post_je: قيد غير متوازن (مدين=%، دائن=%)', v_dr_sum, v_cr_sum;
  end if;

  v_entry_no := fleet.fleet_next_seq('je');

  insert into fleet.fleet_journal_entries
    (entry_no, entry_date, account_code, dr_amount, cr_amount,
     description_ar, description_en, ref_table, ref_id,
     vehicle_id, driver_id, post_status, reverses_entry_no)
  select
    v_entry_no, p_entry_date, ln->>'account_code',
    coalesce((ln->>'dr_amount')::numeric, 0),
    coalesce((ln->>'cr_amount')::numeric, 0),
    ln->>'description_ar', ln->>'description_en',
    p_ref_table, p_ref_id, p_vehicle_id, p_driver_id, 'posted', p_reverses_entry_no
  from jsonb_array_elements(p_lines) as ln;

  return v_entry_no;
end;
$$;
