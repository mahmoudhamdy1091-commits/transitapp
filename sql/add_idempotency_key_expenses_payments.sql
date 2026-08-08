-- نفّذ هذا في Supabase SQL Editor مرة واحدة.
-- استبدال uniq_expense_active/uniq_payment_active (قيد صلب على الحقول التجارية:
-- مبلغ+وصف/دافع+تاريخ+ملف) بمفتاح idempotency تقني — القيد القديم كان يرفض أي
-- تكرار حتى لو شرعي (مصروفين حقيقيين بنفس المبلغ والوصف في نفس اليوم لنفس الملف).
--
-- المفتاح الجديد يُولَّد من العميل (crypto.randomUUID()) وقت فتح النموذج/إضافة
-- البند، لا وقت الإرسال — فإعادة محاولة الإرسال نفسه (بعد رسالة خطأ شبكي غامضة)
-- تبعت بنفس المفتاح فيُرفض التكرار الفعلي، بينما فتح جديد للنموذج = محاولة
-- مختلفة فعلاً = مفتاح جديد. التكرار "الشرعي" (نفس البيانات، محاولتين مختلفتين
-- فعلاً) يمر الآن، مع تحذير ناعم في الواجهة قبل الإرسال (js/utils.js
-- warnIfSimilarActive) بدل الرفض الصلب في قاعدة البيانات.
--
-- فهرس فريد جزئي (WHERE idempotency_key IS NOT NULL) — الصفوف القديمة تبقى
-- null بلا أي backfill، آمن تمامًا، ولا يشارك في الفريدة.

alter table expenses add column if not exists idempotency_key uuid null;
alter table payments add column if not exists idempotency_key uuid null;

create unique index if not exists uniq_expenses_idempotency_key
  on expenses (idempotency_key) where idempotency_key is not null;
create unique index if not exists uniq_payments_idempotency_key
  on payments (idempotency_key) where idempotency_key is not null;

-- حذف القيد القديم — قد يكون CONSTRAINT (ADD CONSTRAINT) أو INDEX (CREATE UNIQUE
-- INDEX) حسب كيفية إنشائه الأصلي؛ الكتلة دي بتتحقق من النوع الفعلي وتحذفه بأمان
-- بدل التخمين (ممكن يكون DROP CONSTRAINT يفشل لو الأصل كان INDEX أو العكس).
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'uniq_expense_active') then
    alter table expenses drop constraint uniq_expense_active;
  elsif exists (select 1 from pg_indexes where indexname = 'uniq_expense_active') then
    drop index uniq_expense_active;
  end if;

  if exists (select 1 from pg_constraint where conname = 'uniq_payment_active') then
    alter table payments drop constraint uniq_payment_active;
  elsif exists (select 1 from pg_indexes where indexname = 'uniq_payment_active') then
    drop index uniq_payment_active;
  end if;
end $$;
