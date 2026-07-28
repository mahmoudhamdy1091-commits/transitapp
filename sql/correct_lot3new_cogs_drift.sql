-- تصحيح انحراف COGS تاريخي على ملف LOT 3 NEW
-- السبب: فواتير 001-004 اتباعت في مايو ويونيو قبل ما يتضاف معظم مصاريف الملف
-- (كل المصاريف تقريبًا من 9 يونيو فصاعدًا، بعضها بعد فاتورة 004 نفسها). كل فاتورة
-- اتحسبت تكلفتها وقتها على "التكلفة الكاملة" اللحظية (شراء+مصاريف الموجودة وقتها
-- بس)، مش النهائية — فمجموع COGS المُرحَّل فعليًا أقل من المفروض. علة تاريخية في
-- calcCOGS القديم (الفواتير الأربعة كلها ref_id=null — قبل إصلاح 2026-07-26).
-- تحقق حي في وقت كتابة هذا السكريبت (2026-07-28): متوقع 270,840.71، فعلي
-- 276,632.71، الفرق 5,791.99. ⚠️ لو أضفت مصاريف/مبيعات جديدة للملف بعد هذا
-- الوقت، الرقم هيتغيّر — أعد التحقق قبل التشغيل لو فيه تأخير.
do $$
declare
  v_entry_no text := next_je_no('BOX');
begin
  insert into journal_entries
    (system_type, entry_no, entry_date, entry_type, account_code, account_name,
     contact_name, dr_amount, cr_amount, amount, description, ref_table, ref_id,
     file_no, post_status, posted_at, is_primary_line)
  values
    ('BOX', v_entry_no, current_date, 'journal', '5100', 'تكلفة المخزون المباع', null,
     5791.99, 0, 0,
     'تصحيح انحراف COGS تاريخي — فواتير سابقة على معظم مصاريف الملف — ملف LOT 3 NEW',
     'correction', null, 'LOT 3 NEW', 'posted', now(), false),
    ('BOX', v_entry_no, current_date, 'journal', '1300', 'المخزون — سيارات', null,
     0, 5791.99, 0,
     'تصحيح انحراف COGS تاريخي — فواتير سابقة على معظم مصاريف الملف — ملف LOT 3 NEW',
     'correction', null, 'LOT 3 NEW', 'posted', now(), false);

  raise notice 'Posted correction entry %', v_entry_no;
end $$;
