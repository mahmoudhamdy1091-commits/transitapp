-- ============================================================================
-- fleet_vehicles.file_no — كود ملف يونيك لكل سيارة (TIC-1, TIC-2, ...)
-- Phase 7 "الداشبورد = جدول السيارات" — زي BOX-141/TM-004 بالظبط.
--
-- ليست fleet_next_seq() مباشرة: تلك مبنية لمستندات مالية سنوية (تحط السنة
-- في النص وتصفّر العداد كل سنة — INVOICE-2026-00005). رقم ملف السيارة لازم
-- يكون دائم بلا سنة بلا padding، فدالة جديدة بنفس آلية fleet_next_seq الذرّية
-- (INSERT...ON CONFLICT...RETURNING على نفس جدول fleet_counters) بصياغة
-- إخراج مختلفة فقط.
--
-- هذا الملف يُراجَع ويُشغَّل يدويًا من المستخدم عبر Supabase SQL Editor.
-- الـbackfill لسيارات موجودة مسبقًا في ملف منفصل (fleet_vehicle_file_no_backfill.sql)
-- — لازم يتشغّل بعد الملف ده مباشرة.
-- ============================================================================

alter table fleet.fleet_vehicles add column if not exists file_no text unique;

create or replace function fleet.fleet_next_vehicle_file_no()
returns text
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_counter int;
begin
  insert into fleet.fleet_counters (doc_type, year, counter)
  values ('vehicle_file', 0, 1)
  on conflict (doc_type) do update
    set counter = fleet.fleet_counters.counter + 1
  returning counter into v_counter;
  return 'TIC-' || v_counter;
end;
$$;

-- إسناد تلقائي عند أي إدراج جديد — يشتغل بغضّ النظر عن مسار الكتابة (الواجهة،
-- استيراد مستقبلي...)، بدل الاعتماد على كل نداء INSERT يفتكر يبعت file_no.
create or replace function fleet._assign_vehicle_file_no() returns trigger
language plpgsql security definer set search_path = fleet, pg_temp as $$
begin
  if new.file_no is null then
    new.file_no := fleet.fleet_next_vehicle_file_no();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_vehicle_file_no on fleet.fleet_vehicles;
create trigger trg_assign_vehicle_file_no
  before insert on fleet.fleet_vehicles
  for each row execute function fleet._assign_vehicle_file_no();
