-- تصحيح تكلفة مخزون مبالغ فيها على ملف BOX-138 — فاتورة INV-...-70701
-- السبب: قبل إصلاح NULL في post_sale_je (2026-07-27)، استُبعدت كل سطور COGS
-- القديمة (ref_id=NULL) خطأً من "المُرحَّل مسبقًا"، فامتص متوسط التكلفة الشاحنة
-- الأخيرة كل الرصيد الوهمي المتبقي (314,929.95) بدل قيمتها الصحيحة (5,369.23).
-- تم التحقق: 349,000 (تكلفة الشاحنات) − 343,630.77 (COGS محقق فعليًا، بعد
-- تصفية فاتورة 70700 المعكوسة) = 5,369.23. الفرق المطلوب تصحيحه = 309,560.72.
do $$
declare
  v_entry_no text := next_je_no('BOX');
begin
  insert into journal_entries
    (system_type, entry_no, entry_date, entry_type, account_code, account_name,
     contact_name, dr_amount, cr_amount, amount, description, ref_table, ref_id,
     file_no, post_status, posted_at, is_primary_line)
  values
    ('BOX', v_entry_no, current_date, 'journal', '1300', 'المخزون — سيارات', null,
     309560.72, 0, 0,
     'تصحيح تكلفة مخزون مبالغ فيها — فاتورة INV-BOX-138 - ( LOT 1 OLD 2024 )-70701 — انحراف ناتج عن استبعاد سطور COGS القديمة (ref_id=NULL) خطأً قبل إصلاح 2026-07-27 — ملف BOX-138 - ( LOT 1 OLD 2024 )',
     'correction', null, 'BOX-138 - ( LOT 1 OLD 2024 )', 'posted', now(), false),
    ('BOX', v_entry_no, current_date, 'journal', '5100', 'تكلفة المخزون المباع', null,
     0, 309560.72, 0,
     'تصحيح تكلفة مخزون مبالغ فيها — فاتورة INV-BOX-138 - ( LOT 1 OLD 2024 )-70701 — انحراف ناتج عن استبعاد سطور COGS القديمة (ref_id=NULL) خطأً قبل إصلاح 2026-07-27 — ملف BOX-138 - ( LOT 1 OLD 2024 )',
     'correction', null, 'BOX-138 - ( LOT 1 OLD 2024 )', 'posted', now(), false);

  raise notice 'Posted correction entry %', v_entry_no;
end $$;
