-- نفّذ هذا في Supabase SQL Editor مرة واحدة (بعد fix_audit_log_log_id.sql).
-- المشكلة: عمود audit_log.file_no عليه قيد foreign key (fk_audit_file_no)
-- يربطه بـ purchase_orders.file_no. أي محاولة logAudit بقيمة file_no غير
-- موجودة في purchase_orders تفشل برمز 23503 (foreign key violation) بصمت.
--
-- هذا يكسر تحديداً تسجيل العمليات على "دفتر القيود" (journal_entries) للقيود
-- اليدوية، حيث يكتب المستخدم رقم ملف حر في حقل "رقم الملف" قد لا يطابق أي
-- ملف في purchase_orders — وكذلك أي جدول آخر لا يرتبط بصفقة شراء فعلية.
--
-- audit_log سجل تاريخي مستقل، ولا ينبغي أن يعتمد على وجود السجل المرجعي في
-- جدول آخر، لذا الحل هو إزالة هذا القيد.

alter table audit_log drop constraint if exists fk_audit_file_no;
