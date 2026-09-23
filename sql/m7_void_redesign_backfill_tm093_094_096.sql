-- نفّذه إنت في Supabase SQL Editor. آمن يتكرر تشغيله (كل UPDATE بشرط
-- post_status <> 'voided'، فما فيش أثر إضافي لو اتنفّذ مرتين).
--
-- ════════════════════════════════════════════════════════════
-- الخلفية (2026-09-23) — إعادة تصميم "الفويد"
-- ════════════════════════════════════════════════════════════
-- voidPurchaseOrder اتغيّرت بالكامل: الفويد دلوقتي = إعادة تصنيف
-- post_status='voided' على كل صف مرتبط بالملف (بلا حذف وبلا أي قيد عكسي
-- جديد) — قرار المالك: "ممكن متحذفش الداتا بس تكون كأنها مش موجودة".
--
-- التلات ملفات دول (TM-093/094/096) اتفويدوا قبل الإعادة التصميم دي بالآلية
-- القديمة (عكس قيد الشراء بس). نتيجة الفحص الحي 2026-09-23:
--   TM-093: 18 قيد يومية لسه posted + مصروف واحد (2,854) لسه posted
--   TM-094: نفس الشيء بالظبط (18 قيد + مصروف 2,854)
--   TM-096: 20 قيد يومية لسه posted، صفر مصاريف/دفعات/غيره posted
-- (التلاتة أصلاً ملفات مكرَّرة — نسخ لاحقة من TM-002/003/005 بنفس الرقم
-- القديم 145/146/147 — راجع مذكرة الجلسة التانية 2026-09-23)
--
-- هذا السكريبت يطبّق نفس منطق voidPurchaseOrder الجديد بأثر رجعي على
-- التلاتة: كل صف غير مُلغى في كل جدول تشغيلي + journal_entries → 'voided'،
-- وتسجيل void_reason على purchase_orders.
--
-- ════════════════════════════════════════════════════════════
-- 0) عمود void_reason الجديد (لو لسه مش موجود)
-- ════════════════════════════════════════════════════════════
alter table purchase_orders add column if not exists void_reason text;

-- ════════════════════════════════════════════════════════════
-- 1) إعادة تصنيف الجداول التشغيلية + journal_entries للتلات ملفات
-- ════════════════════════════════════════════════════════════
do $$
declare
  v_files text[] := array['TM-093  145 قديم', 'TM-094   146 OLD', 'TM-096  147 قديم'];
  v_fn text;
begin
  foreach v_fn in array v_files loop
    update expenses        set post_status='voided' where system_type='TM' and file_no=v_fn and post_status <> 'voided';
    update payments         set post_status='voided' where system_type='TM' and file_no=v_fn and post_status <> 'voided';
    update collections      set post_status='voided' where system_type='TM' and file_no=v_fn and post_status <> 'voided';
    update sales            set post_status='voided' where system_type='TM' and file_no=v_fn and post_status <> 'voided';
    update partner_payouts  set post_status='voided' where system_type='TM' and file_no=v_fn and post_status <> 'voided';
    update partner_ledger   set post_status='voided' where system_type='TM' and file_no=v_fn and post_status <> 'voided';
    update journal_entries  set post_status='voided' where system_type='TM' and file_no=v_fn and post_status <> 'voided';
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════
-- 2) سبب الإلغاء على الملفات التلاتة
-- ════════════════════════════════════════════════════════════
update purchase_orders
set void_reason = 'ملف مكرَّر — نسخة لاحقة من ' || (
  case file_no
    when 'TM-093  145 قديم'  then 'TM-002 (نفس الرقم القديم 145)'
    when 'TM-094   146 OLD'  then 'TM-003 (نفس الرقم القديم 146)'
    when 'TM-096  147 قديم'  then 'TM-005 (نفس الرقم القديم 147)'
  end
) || ' — اكتُشف التكرار 2026-09-23 بعد مصروفين حقيقيين (5,708) اتسجّلوا غلط على النسخة الملغاة بدل الأصلية'
where system_type = 'TM'
  and file_no in ('TM-093  145 قديم', 'TM-094   146 OLD', 'TM-096  147 قديم')
  and void_reason is null;

-- ════════════════════════════════════════════════════════════
-- 3) تحقق بعد التنفيذ (قراءة فقط)
-- ════════════════════════════════════════════════════════════
-- select file_no, post_status, status, void_reason from purchase_orders
--   where system_type='TM' and file_no in ('TM-093  145 قديم','TM-094   146 OLD','TM-096  147 قديم');
--
-- select file_no, count(*) filter (where post_status <> 'voided') as still_active
--   from journal_entries where system_type='TM'
--   and file_no in ('TM-093  145 قديم','TM-094   146 OLD','TM-096  147 قديم')
--   group by file_no;
-- -- المتوقَّع: still_active = 0 للتلاتة
