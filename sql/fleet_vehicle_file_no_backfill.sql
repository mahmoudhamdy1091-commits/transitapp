-- ============================================================================
-- Backfill file_no للسيارات الموجودة مسبقًا (TIC-1, TIC-2, ... بترتيب created_at/id)
-- يُشغَّل مرة واحدة بعد sql/fleet_vehicle_file_no.sql (يحتاج العمود/الدالة موجودين).
-- آمن يتكرر تشغيله (where file_no is null بيتخطى أي سيارة اتترقّمت بالفعل).
--
-- ZZTEST% مُستبعدة عمدًا — فكسشر الريجريشن المؤرشف، مش سيارة حقيقية، بنفس
-- مبدأ استبعادها من قوائم الاختيار في Phase 6.
--
-- تحديث fleet_counters في الآخر إلزامي: لو الترقيم هنا عبر UPDATE مباشر
-- (مش عبر fleet_next_vehicle_file_no())، العداد فاضل صفر، وأول سيارة جديدة
-- بعد كده هتاخد TIC-1 تاني وتصطدم بالـunique الموجود بالفعل.
-- ============================================================================

do $$
declare
  r record;
  v_counter int := 0;
begin
  for r in
    select id from fleet.fleet_vehicles
    where file_no is null and plate_no not like 'ZZTEST%'
    order by created_at asc, id asc
  loop
    v_counter := v_counter + 1;
    update fleet.fleet_vehicles set file_no = 'TIC-' || v_counter where id = r.id;
  end loop;

  insert into fleet.fleet_counters (doc_type, year, counter)
  values ('vehicle_file', 0, v_counter)
  on conflict (doc_type) do update set counter = greatest(fleet.fleet_counters.counter, v_counter);
end $$;
