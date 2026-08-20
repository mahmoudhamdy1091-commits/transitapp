-- ============================================================================
-- fleet.fleet_vehicle_notes — تاب "الملاحظات" في ملف السيارة (Phase 7 Stage 3)
-- جدول جديد ومعزول بالكامل داخل schema الفليت — مش استخدام لـpublic.audit_log
-- (اللي BOX/TM بيستخدمه لملاحظات الصفقة) عشان كده هيكسر عزل الـschema.
-- ليست وثيقة مالية: بدون client_uuid/RPC مركزية — كتابة مباشرة عبر REST
-- زي fleet_vehicles/fleet_drivers بالظبط (نفس الحد الفاصل المعتمد في المشروع:
-- RPC للمستندات المالية فقط، REST مباشر لباقي الكيانات).
-- آمن يتشغّل أكتر من مرة (create table if not exists + drop policy if exists).
-- ربط الملاحظات بشاشة اليومية (فليت وBOX/TM) مؤجّل عمدًا لمرحلة منفصلة —
-- الملف ده بيغطي تاب ملف السيارة بس.
-- ============================================================================

create table if not exists fleet.fleet_vehicle_notes (
  id           bigint generated always as identity primary key,
  vehicle_id   bigint not null references fleet.fleet_vehicles(id),
  note_text    text not null,
  author_email text not null default (auth.jwt() ->> 'email'),
  created_at   timestamptz not null default now()
);

create index if not exists idx_fleet_vehicle_notes_vehicle on fleet.fleet_vehicle_notes(vehicle_id);

alter table fleet.fleet_vehicle_notes enable row level security;

drop policy if exists fleet_select_authenticated on fleet.fleet_vehicle_notes;
drop policy if exists fleet_insert_authenticated on fleet.fleet_vehicle_notes;
drop policy if exists fleet_update_authenticated on fleet.fleet_vehicle_notes;

create policy fleet_select_authenticated on fleet.fleet_vehicle_notes
  for select to authenticated using (fleet.is_fleet_user());
create policy fleet_insert_authenticated on fleet.fleet_vehicle_notes
  for insert to authenticated with check (fleet.is_fleet_user());
create policy fleet_update_authenticated on fleet.fleet_vehicle_notes
  for update to authenticated using (fleet.is_fleet_user()) with check (fleet.is_fleet_user());

-- استثناء متعمّد من قاعدة "لا حذف" المتبعة في باقي جداول الفليت (§3 بند 9):
-- الملاحظة مجرد نص مذكرة، مش مستند مالي/سجل تدقيقي زي الفواتير والسندات —
-- القرار ده خاص بـfleet_vehicle_notes فقط، باقي جداول الفليت تفضل من غير DELETE.
drop policy if exists fleet_delete_authenticated on fleet.fleet_vehicle_notes;
create policy fleet_delete_authenticated on fleet.fleet_vehicle_notes
  for delete to authenticated using (fleet.is_fleet_user());

grant select, insert, update, delete on fleet.fleet_vehicle_notes to authenticated;
grant usage, select on all sequences in schema fleet to authenticated;
