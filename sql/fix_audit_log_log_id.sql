-- نفّذ هذا في Supabase SQL Editor مرة واحدة.
-- المشكلة: عمود audit_log.log_id من نوع text وعليه قيد NOT NULL بدون قيمة افتراضية،
-- بينما دالة logAudit() في core.js لا ترسل قيمة لهذا العمود إطلاقاً.
-- النتيجة: كل محاولة تسجيل في audit_log تفشل بصمت (يُلتقط الخطأ في try/catch)
-- برسالة: null value in column "log_id" of relation "audit_log" violates not-null constraint
-- وبالتالي "سجل النشاط" يظهر دائماً فارغاً (0 سجل).
--
-- العمود log_id غير مستخدم في أي مكان بالكود (الجدول يعتمد على عمود id من نوع uuid
-- كمعرّف أساسي تلقائي)، لذا الحل الآمن هو إزالة قيد NOT NULL عنه.

alter table audit_log alter column log_id drop not null;
