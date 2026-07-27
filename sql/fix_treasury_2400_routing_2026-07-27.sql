-- تصحيح توجيه دفعات الخزينة (الصندوق / صندوق الترانزيت) المقيّدة غلط على حساب
-- الشركاء (2400) بدل النقد/البنك مباشرة — 2026-07-27
--
-- السبب الجذري (موثّق في فيز 1+2 من نفس الخطة، منفّذة ومنشورة):
--   BOX: إصلاح توجيه je_payment كان بالكود من 2026-07-07 لكن public/js/engine.js
--   ما استلمهوش إلا 2026-07-24 (فجوة نشر 17 يوم). أي دفعة payer="الصندوق" في
--   الفجوة دي اتوجّهت غلط لـ2400 بدل 1110/1120.
--   TM: اسم "صندوق الترانزيت" ما كانش معروف للنظام كخزينة إطلاقًا إلا
--   2026-07-26 — فكل دفعات خزينة TM من الأول اتوجّهت لـ2400.
--
-- كل قيد هنا تصحيح واحد متوازن لكل ملف: Dr 2400 (الخزينة) / Cr 1110|1120
-- (حسب pay_method الدفعة الأصلية — نقد=1110، غير كده=1120) بنفس القيمة الصافية
-- المتراكمة المتبقية غير المصحَّحة. ref_table='correction' (مش reversal) —
-- ما فيهاش لمس لأي قيد دفعة تاريخي، ومستبعدة من عرض اليومية تلقائيًا (نفس مبدأ
-- تصحيح COGS في 2026-07-26).
--
-- ملحوظة LOT 3 NEW: من الـ3 دفعات المتأثرة (10,000 + 70,000 + 70,000 = 150,000)
-- واحدة بس (70,000 / PMT-LOT3NEW-011) اتصححت قبل كده في JE-2026-00483
-- (2026-07-26) كجزء من إصلاح منفصل. المتبقي فعليًا غير مصحَّح = 80,000
-- (10,000 + 70,000)، وهو اللي متصحح هنا.
--
-- نفّذ هذا الملف كامل مرة واحدة في Supabase SQL Editor.

do $$
declare
  v_no text;
begin
  -- 1) BOX-136 - ( 52-LOT 4 - OLD) — دفعة PMT-BOX-136-52-LOT4-OLD-001، 240,000 (أخرى → بنك)
  v_no := next_je_no('BOX');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, contact_name, description, ref_table, file_no, post_status, posted_at) values
    ('BOX', v_no, current_date, '2400', 'حسابات الشركاء', 240000.00, 0, 'الصندوق', 'تصحيح توجيه دفعة PMT-BOX-136-52-LOT4-OLD-001 — كانت مقيّدة غلط على حساب الشركاء (2400) بدل البنك مباشرة — خطأ برمجي (فجوة نشر إصلاح je_payment) لا يقابله عملية شريك حقيقية — ملف BOX-136 - ( 52-LOT 4 - OLD)', 'correction', 'BOX-136 - ( 52-LOT 4 - OLD)', 'posted', now()),
    ('BOX', v_no, current_date, '1120', 'البنك',           0, 240000.00, null,      'تصحيح توجيه دفعة PMT-BOX-136-52-LOT4-OLD-001 — كانت مقيّدة غلط على حساب الشركاء (2400) بدل البنك مباشرة — خطأ برمجي (فجوة نشر إصلاح je_payment) لا يقابله عملية شريك حقيقية — ملف BOX-136 - ( 52-LOT 4 - OLD)', 'correction', 'BOX-136 - ( 52-LOT 4 - OLD)', 'posted', now());

  -- 2) BOX-137 - ( LOT 3 OLD  2024 ) — دفعة PMT-BOX-137-LOT1OLD2024-001، 300,000 (شيك → بنك)
  v_no := next_je_no('BOX');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, contact_name, description, ref_table, file_no, post_status, posted_at) values
    ('BOX', v_no, current_date, '2400', 'حسابات الشركاء', 300000.00, 0, 'الصندوق', 'تصحيح توجيه دفعة PMT-BOX-137-LOT1OLD2024-001 — كانت مقيّدة غلط على حساب الشركاء (2400) بدل البنك مباشرة — خطأ برمجي (فجوة نشر إصلاح je_payment) لا يقابله عملية شريك حقيقية — ملف BOX-137 - ( LOT 3 OLD  2024 )', 'correction', 'BOX-137 - ( LOT 3 OLD  2024 )', 'posted', now()),
    ('BOX', v_no, current_date, '1120', 'البنك',           0, 300000.00, null,      'تصحيح توجيه دفعة PMT-BOX-137-LOT1OLD2024-001 — كانت مقيّدة غلط على حساب الشركاء (2400) بدل البنك مباشرة — خطأ برمجي (فجوة نشر إصلاح je_payment) لا يقابله عملية شريك حقيقية — ملف BOX-137 - ( LOT 3 OLD  2024 )', 'correction', 'BOX-137 - ( LOT 3 OLD  2024 )', 'posted', now());

  -- 3) BOX-138 - ( LOT 1 OLD 2024 ) — دفعة PMT-BOX-138-LOT1OLD2024-001، 308,000 (نقد → كاش)
  v_no := next_je_no('BOX');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, contact_name, description, ref_table, file_no, post_status, posted_at) values
    ('BOX', v_no, current_date, '2400', 'حسابات الشركاء', 308000.00, 0, 'الصندوق', 'تصحيح توجيه دفعة PMT-BOX-138-LOT1OLD2024-001 — كانت مقيّدة غلط على حساب الشركاء (2400) بدل النقد مباشرة — خطأ برمجي (فجوة نشر إصلاح je_payment) لا يقابله عملية شريك حقيقية — ملف BOX-138 - ( LOT 1 OLD 2024 )', 'correction', 'BOX-138 - ( LOT 1 OLD 2024 )', 'posted', now()),
    ('BOX', v_no, current_date, '1110', 'النقد',           0, 308000.00, null,      'تصحيح توجيه دفعة PMT-BOX-138-LOT1OLD2024-001 — كانت مقيّدة غلط على حساب الشركاء (2400) بدل النقد مباشرة — خطأ برمجي (فجوة نشر إصلاح je_payment) لا يقابله عملية شريك حقيقية — ملف BOX-138 - ( LOT 1 OLD 2024 )', 'correction', 'BOX-138 - ( LOT 1 OLD 2024 )', 'posted', now());

  -- 4) BOX-139 - ( LOT 2 OLD 2024 ) — دفعة PMT-BOX-139-LOT2OLD2024-001، 325,000 (نقد → كاش)
  v_no := next_je_no('BOX');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, contact_name, description, ref_table, file_no, post_status, posted_at) values
    ('BOX', v_no, current_date, '2400', 'حسابات الشركاء', 325000.00, 0, 'الصندوق', 'تصحيح توجيه دفعة PMT-BOX-139-LOT2OLD2024-001 — كانت مقيّدة غلط على حساب الشركاء (2400) بدل النقد مباشرة — خطأ برمجي (فجوة نشر إصلاح je_payment) لا يقابله عملية شريك حقيقية — ملف BOX-139 - ( LOT 2 OLD 2024 )', 'correction', 'BOX-139 - ( LOT 2 OLD 2024 )', 'posted', now()),
    ('BOX', v_no, current_date, '1110', 'النقد',           0, 325000.00, null,      'تصحيح توجيه دفعة PMT-BOX-139-LOT2OLD2024-001 — كانت مقيّدة غلط على حساب الشركاء (2400) بدل النقد مباشرة — خطأ برمجي (فجوة نشر إصلاح je_payment) لا يقابله عملية شريك حقيقية — ملف BOX-139 - ( LOT 2 OLD 2024 )', 'correction', 'BOX-139 - ( LOT 2 OLD 2024 )', 'posted', now());

  -- 5) BOX-140 - (106 OLD ) مساحه — 5 دفعات شيك (20,000+82,500+90,000+60,000+50,000)
  --    = 302,500 (شيك → بنك) — قيد تصحيح واحد مجمّع لكل الملف
  v_no := next_je_no('BOX');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, contact_name, description, ref_table, file_no, post_status, posted_at) values
    ('BOX', v_no, current_date, '2400', 'حسابات الشركاء', 302500.00, 0, 'الصندوق', 'تصحيح توجيه 5 دفعات شيك (PMT-BOX-140-106OLD-001..005) — كانت مقيّدة غلط على حساب الشركاء (2400) بدل البنك مباشرة — خطأ برمجي (فجوة نشر إصلاح je_payment) لا يقابله عملية شريك حقيقية — ملف BOX-140 - (106 OLD ) مساحه', 'correction', 'BOX-140 - (106 OLD ) مساحه', 'posted', now()),
    ('BOX', v_no, current_date, '1120', 'البنك',           0, 302500.00, null,      'تصحيح توجيه 5 دفعات شيك (PMT-BOX-140-106OLD-001..005) — كانت مقيّدة غلط على حساب الشركاء (2400) بدل البنك مباشرة — خطأ برمجي (فجوة نشر إصلاح je_payment) لا يقابله عملية شريك حقيقية — ملف BOX-140 - (106 OLD ) مساحه', 'correction', 'BOX-140 - (106 OLD ) مساحه', 'posted', now());

  -- 6) LOT 3 NEW — المتبقي غير المصحَّح من 3 دفعات نقدية: PMT-LOT3NEW-010 (10,000)
  --    + PMT-LOT3NEW-012 (70,000) = 80,000 (نقد → كاش). PMT-LOT3NEW-011 (70,000)
  --    اتصححت قبل كده في JE-2026-00483 (2026-07-26) — مش متكررة هنا.
  v_no := next_je_no('BOX');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, contact_name, description, ref_table, file_no, post_status, posted_at) values
    ('BOX', v_no, current_date, '2400', 'حسابات الشركاء', 80000.00, 0, 'الصندوق', 'تصحيح توجيه دفعتين نقدًا (PMT-LOT3NEW-010, PMT-LOT3NEW-012) — كانتا مقيّدتين غلط على حساب الشركاء (2400) بدل النقد مباشرة — خطأ برمجي (فجوة نشر إصلاح je_payment) لا يقابله عملية شريك حقيقية — ملف LOT 3 NEW', 'correction', 'LOT 3 NEW', 'posted', now()),
    ('BOX', v_no, current_date, '1110', 'النقد',           0, 80000.00, null,      'تصحيح توجيه دفعتين نقدًا (PMT-LOT3NEW-010, PMT-LOT3NEW-012) — كانتا مقيّدتين غلط على حساب الشركاء (2400) بدل النقد مباشرة — خطأ برمجي (فجوة نشر إصلاح je_payment) لا يقابله عملية شريك حقيقية — ملف LOT 3 NEW', 'correction', 'LOT 3 NEW', 'posted', now());

  -- 7) TM-002   145قديم — دفعة PMT-TM-002   145قديم-P1، 5,780 (تحويل بنكي → بنك)
  v_no := next_je_no('TM');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, contact_name, description, ref_table, file_no, post_status, posted_at) values
    ('TM', v_no, current_date, '2400', 'حسابات الشركاء', 5780.00, 0, 'صندوق الترانزيت', 'تصحيح توجيه دفعة PMT-TM-002 145قديم-P1 — كانت مقيّدة غلط على حساب الشركاء (2400) بدل البنك مباشرة — خطأ برمجي (صندوق الترانزيت لم يكن معروفًا كخزينة) لا يقابله عملية شريك حقيقية — ملف TM-002   145قديم', 'correction', 'TM-002   145قديم', 'posted', now()),
    ('TM', v_no, current_date, '1120', 'البنك',           0, 5780.00, null,        'تصحيح توجيه دفعة PMT-TM-002 145قديم-P1 — كانت مقيّدة غلط على حساب الشركاء (2400) بدل البنك مباشرة — خطأ برمجي (صندوق الترانزيت لم يكن معروفًا كخزينة) لا يقابله عملية شريك حقيقية — ملف TM-002   145قديم', 'correction', 'TM-002   145قديم', 'posted', now());

  -- 8) TM-003   146 قديم — دفعة PMT-TM-003   146 قديم-P1، 5,780 (تحويل بنكي → بنك)
  v_no := next_je_no('TM');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, contact_name, description, ref_table, file_no, post_status, posted_at) values
    ('TM', v_no, current_date, '2400', 'حسابات الشركاء', 5780.00, 0, 'صندوق الترانزيت', 'تصحيح توجيه دفعة PMT-TM-003 146 قديم-P1 — كانت مقيّدة غلط على حساب الشركاء (2400) بدل البنك مباشرة — خطأ برمجي (صندوق الترانزيت لم يكن معروفًا كخزينة) لا يقابله عملية شريك حقيقية — ملف TM-003   146 قديم', 'correction', 'TM-003   146 قديم', 'posted', now()),
    ('TM', v_no, current_date, '1120', 'البنك',           0, 5780.00, null,        'تصحيح توجيه دفعة PMT-TM-003 146 قديم-P1 — كانت مقيّدة غلط على حساب الشركاء (2400) بدل البنك مباشرة — خطأ برمجي (صندوق الترانزيت لم يكن معروفًا كخزينة) لا يقابله عملية شريك حقيقية — ملف TM-003   146 قديم', 'correction', 'TM-003   146 قديم', 'posted', now());

  -- 9) TM-004 (13 - OLD) — دفعة PMT-TM-004 (13 - OLD)-P1، 9,382 (شيك → بنك)
  v_no := next_je_no('TM');
  insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, contact_name, description, ref_table, file_no, post_status, posted_at) values
    ('TM', v_no, current_date, '2400', 'حسابات الشركاء', 9382.00, 0, 'صندوق الترانزيت', 'تصحيح توجيه دفعة PMT-TM-004 (13 - OLD)-P1 — كانت مقيّدة غلط على حساب الشركاء (2400) بدل البنك مباشرة — خطأ برمجي (صندوق الترانزيت لم يكن معروفًا كخزينة) لا يقابله عملية شريك حقيقية — ملف TM-004 (13 - OLD)', 'correction', 'TM-004 (13 - OLD)', 'posted', now()),
    ('TM', v_no, current_date, '1120', 'البنك',           0, 9382.00, null,        'تصحيح توجيه دفعة PMT-TM-004 (13 - OLD)-P1 — كانت مقيّدة غلط على حساب الشركاء (2400) بدل البنك مباشرة — خطأ برمجي (صندوق الترانزيت لم يكن معروفًا كخزينة) لا يقابله عملية شريك حقيقية — ملف TM-004 (13 - OLD)', 'correction', 'TM-004 (13 - OLD)', 'posted', now());
end $$;
