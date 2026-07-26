-- تصحيح انحراف تكلفة المخزون المباع (COGS) لـ8 ملفات في BOX — 2026-07-26
-- كل الأرقام من فحص checkCOGSInvariant/auditAllFilesCOGS (engine.js)، بعد ما فيز
-- 1-3 من خطة تثبيت COGS اتنفذوا (post_sale_je RPC + تنضيف ref_id + طابور الملف).
-- هذه القيود تصحيح لخطأ برمجي قديم (calcCOGS كان بيتصرف بحساب حي عرضة لسباق
-- عمليات متزامنة) — مش عكس عملية بيع حقيقية، فـref_table='correction' مميّزة
-- عن 'reversal'، ومفيش لمس لأي قيد بيع تاريخي (نفس مبدأ إصلاح BOX-135).
--
-- نفّذ هذا الملف كامل مرة واحدة في Supabase SQL Editor.

do $$
declare
  v_no text;
begin
  -- 1) BOX-138 - ( LOT 1 OLD 2024 ) — مخزون زيادة 34,070.05 (COGS ناقص)
  v_no := next_je_no('BOX');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, description, ref_table, file_no, post_status, posted_at) values
    ('BOX', v_no, current_date, '5100', 'تكلفة المخزون المباع', 34070.05, 0, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-138 - ( LOT 1 OLD 2024 )', 'correction', 'BOX-138 - ( LOT 1 OLD 2024 )', 'posted', now()),
    ('BOX', v_no, current_date, '1300', 'المخزون — سيارات',     0, 34070.05, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-138 - ( LOT 1 OLD 2024 )', 'correction', 'BOX-138 - ( LOT 1 OLD 2024 )', 'posted', now());

  -- 2) BOX-132 -  ( LOT 1 NEW  - OLD) — مخزون ناقص 55,663.34 (COGS زيادة)
  v_no := next_je_no('BOX');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, description, ref_table, file_no, post_status, posted_at) values
    ('BOX', v_no, current_date, '1300', 'المخزون — سيارات',     55663.34, 0, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-132 -  ( LOT 1 NEW  - OLD)', 'correction', 'BOX-132 -  ( LOT 1 NEW  - OLD)', 'posted', now()),
    ('BOX', v_no, current_date, '5100', 'تكلفة المخزون المباع', 0, 55663.34, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-132 -  ( LOT 1 NEW  - OLD)', 'correction', 'BOX-132 -  ( LOT 1 NEW  - OLD)', 'posted', now());

  -- 3) BOX-131 -( LOT 2 NEW - OLD ) — مخزون ناقص 65,040.41 (COGS زيادة)
  v_no := next_je_no('BOX');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, description, ref_table, file_no, post_status, posted_at) values
    ('BOX', v_no, current_date, '1300', 'المخزون — سيارات',     65040.41, 0, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-131 -( LOT 2 NEW - OLD )', 'correction', 'BOX-131 -( LOT 2 NEW - OLD )', 'posted', now()),
    ('BOX', v_no, current_date, '5100', 'تكلفة المخزون المباع', 0, 65040.41, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-131 -( LOT 2 NEW - OLD )', 'correction', 'BOX-131 -( LOT 2 NEW - OLD )', 'posted', now());

  -- 4) BOX-134 - SALALA - 60 — مخزون ناقص 71,447.40 (COGS زيادة). تحقق يدوي: فاتورة
  --    بيع واحدة (19 سيارة) استهلكت التكلفة الكاملة (297,697.5) رغم إضافة 6 سيارات
  --    للملف بعد ترحيل القيد — نصيبها العادل (71,447.40) رجع للمخزون هنا
  v_no := next_je_no('BOX');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, description, ref_table, file_no, post_status, posted_at) values
    ('BOX', v_no, current_date, '1300', 'المخزون — سيارات',     71447.40, 0, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-134 - SALALA - 60', 'correction', 'BOX-134 - SALALA - 60', 'posted', now()),
    ('BOX', v_no, current_date, '5100', 'تكلفة المخزون المباع', 0, 71447.40, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-134 - SALALA - 60', 'correction', 'BOX-134 - SALALA - 60', 'posted', now());

  -- 5) BOX-133 - SALALA 88 — مخزون زيادة 9,703.95 (COGS ناقص)
  v_no := next_je_no('BOX');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, description, ref_table, file_no, post_status, posted_at) values
    ('BOX', v_no, current_date, '5100', 'تكلفة المخزون المباع', 9703.95, 0, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-133 - SALALA 88', 'correction', 'BOX-133 - SALALA 88', 'posted', now()),
    ('BOX', v_no, current_date, '1300', 'المخزون — سيارات',     0, 9703.95, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-133 - SALALA 88', 'correction', 'BOX-133 - SALALA 88', 'posted', now());

  -- 6) BOX-130 - (114 old) — مخزون زيادة 1,103.58 (COGS ناقص)
  v_no := next_je_no('BOX');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, description, ref_table, file_no, post_status, posted_at) values
    ('BOX', v_no, current_date, '5100', 'تكلفة المخزون المباع', 1103.58, 0, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-130 - (114 old)', 'correction', 'BOX-130 - (114 old)', 'posted', now()),
    ('BOX', v_no, current_date, '1300', 'المخزون — سيارات',     0, 1103.58, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-130 - (114 old)', 'correction', 'BOX-130 - (114 old)', 'posted', now());

  -- 7) BOX-126 - Lot 4  new — مخزون زيادة 3,620.32 (COGS ناقص)
  v_no := next_je_no('BOX');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, description, ref_table, file_no, post_status, posted_at) values
    ('BOX', v_no, current_date, '5100', 'تكلفة المخزون المباع', 3620.32, 0, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-126 - Lot 4  new', 'correction', 'BOX-126 - Lot 4  new', 'posted', now()),
    ('BOX', v_no, current_date, '1300', 'المخزون — سيارات',     0, 3620.32, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-126 - Lot 4  new', 'correction', 'BOX-126 - Lot 4  new', 'posted', now());

  -- 8) BOX-136 - ( 52-LOT 4 - OLD) — مخزون ناقص 3,285.20 (COGS زيادة)
  v_no := next_je_no('BOX');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, description, ref_table, file_no, post_status, posted_at) values
    ('BOX', v_no, current_date, '1300', 'المخزون — سيارات',     3285.20, 0, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-136 - ( 52-LOT 4 - OLD)', 'correction', 'BOX-136 - ( 52-LOT 4 - OLD)', 'posted', now()),
    ('BOX', v_no, current_date, '5100', 'تكلفة المخزون المباع', 0, 3285.20, 'تصحيح ترحيل تكلفة مخزون — خطأ برمجي في calcCOGS القديم — لا يقابله بيع أو إلغاء فعلي — ملف BOX-136 - ( 52-LOT 4 - OLD)', 'correction', 'BOX-136 - ( 52-LOT 4 - OLD)', 'posted', now());
end $$;
