-- عكس القيد التصحيحي المكرّر (JE-2026-00585) — تم تشغيل
-- correct_lot3new_cogs_drift.sql مرتين بالخطأ (مرة 2026-07-28 كـJE-2026-00579
-- الصحيح، ومرة تانية بالغلط 2026-07-29 كـJE-2026-00585)، فتكرر التصحيح وبقى
-- المخزون ناقص عن الصح بـ5,791.99 (COGS زيادة). القيد الأصلي المقصود
-- (JE-2026-00579) يبقى كما هو، من غير أي تعديل.
do $$
declare
  v_entry_no    text   := next_je_no('BOX');
  v_dup_1300_id bigint;
  v_dup_5100_id bigint;
  v_new_1300_id bigint;
  v_new_5100_id bigint;
begin
  select id into v_dup_1300_id from journal_entries
  where entry_no = 'JE-2026-00585' and account_code = '1300' limit 1;
  select id into v_dup_5100_id from journal_entries
  where entry_no = 'JE-2026-00585' and account_code = '5100' limit 1;

  if v_dup_1300_id is null or v_dup_5100_id is null then
    raise exception 'تعذّر إيجاد سطور JE-2026-00585 — لا يمكن المتابعة';
  end if;

  if exists (select 1 from journal_entries where id in (v_dup_1300_id, v_dup_5100_id) and reversed_by is not null) then
    raise exception 'JE-2026-00585 معكوس بالفعل — لا يمكن المتابعة';
  end if;

  insert into journal_entries
    (system_type, entry_no, entry_date, entry_type, account_code, account_name,
     contact_name, dr_amount, cr_amount, amount, description, ref_table, ref_id,
     file_no, post_status, posted_at, is_primary_line, reverses)
  values
    ('BOX', v_entry_no, current_date, 'journal', '1300', 'المخزون — سيارات', null,
     5791.99, 0, 0,
     'عكس تكرار غير مقصود لقيد التصحيح JE-2026-00585 (شُغِّل سكريبت التصحيح مرتين بالخطأ) — ملف LOT 3 NEW',
     'correction', null, 'LOT 3 NEW', 'posted', now(), false, v_dup_1300_id)
    returning id into v_new_1300_id;

  insert into journal_entries
    (system_type, entry_no, entry_date, entry_type, account_code, account_name,
     contact_name, dr_amount, cr_amount, amount, description, ref_table, ref_id,
     file_no, post_status, posted_at, is_primary_line, reverses)
  values
    ('BOX', v_entry_no, current_date, 'journal', '5100', 'تكلفة المخزون المباع', null,
     0, 5791.99, 0,
     'عكس تكرار غير مقصود لقيد التصحيح JE-2026-00585 (شُغِّل سكريبت التصحيح مرتين بالخطأ) — ملف LOT 3 NEW',
     'correction', null, 'LOT 3 NEW', 'posted', now(), false, v_dup_5100_id)
    returning id into v_new_5100_id;

  update journal_entries set reversed_by = v_new_1300_id where id = v_dup_1300_id;
  update journal_entries set reversed_by = v_new_5100_id where id = v_dup_5100_id;

  raise notice 'Posted reversal entry % for duplicate JE-2026-00585', v_entry_no;
end $$;
