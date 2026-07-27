-- نفّذ هذا في Supabase SQL Editor مرة واحدة.
-- Tier 0 بند 4 — الخطوة الأولى (DDL بس، بدون أي كود JS مرتبط بعد — الكود
-- اللي بيضبط هذا العمود لسه قيد التصميم/التنفيذ في نفس الجلسة).
--
-- discovery سابق (read-only، بلا DDL) أكّد: صفر تكرار حالي في
-- (system_type, file_no, ref_id) عبر payments/expenses/collections/
-- partner_payouts/purchase_orders/sales في BOX وTM — لا خطر فشل إنشاء
-- الـindex من بيانات موجودة.
--
-- بدون backfill عمدًا: كل الصفوف الحالية هتفضل is_primary_line=false افتراضيًا
-- بغض النظر عن قيمة ref_id (حتى لو null) — آمن تمامًا لأن الـindex الجزئي
-- (where is_primary_line) بيتجاهلها بالكامل، ومنطق التسليم الجديد في
-- postDoubleEntry/updateJEInPlace هيضبط القيمة الصح تلقائيًا لأي قيد جديد
-- أو مُعدَّل من دلوقتي فصاعدًا.

alter table journal_entries add column is_primary_line boolean not null default false;

create unique index uq_je_ref_primary_posted
  on journal_entries (system_type, file_no, ref_id, ref_table)
  where is_primary_line and post_status = 'posted';
