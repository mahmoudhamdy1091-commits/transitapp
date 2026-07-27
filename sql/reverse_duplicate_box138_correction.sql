-- عكس القيد التصحيحي المكرّر (JE-2026-00562) — تم تشغيل correct_box138_invoice_70701_cogs.sql
-- مرتين بالخطأ، فتكرر التصحيح وبقى المخزون زيادة عن الصح بـ309,560.72.
-- القيد الأصلي المقصود (JE-2026-00561) يبقى كما هو، من غير أي تعديل.
do $$
declare
  v_entry_no    text   := next_je_no('BOX');
  v_dup_1300_id bigint;
  v_dup_5100_id bigint;
  v_new_1300_id bigint;
  v_new_5100_id bigint;
begin
  select id into v_dup_1300_id from journal_entries
  where entry_no = 'JE-2026-00562' and account_code = '1300' limit 1;
  select id into v_dup_5100_id from journal_entries
  where entry_no = 'JE-2026-00562' and account_code = '5100' limit 1;

  if v_dup_1300_id is null or v_dup_5100_id is null then
    raise exception 'تعذّر إيجاد سطور JE-2026-00562 — لا يمكن المتابعة';
  end if;

  insert into journal_entries
    (system_type, entry_no, entry_date, entry_type, account_code, account_name,
     contact_name, dr_amount, cr_amount, amount, description, ref_table, ref_id,
     file_no, post_status, posted_at, is_primary_line, reverses)
  values
    ('BOX', v_entry_no, current_date, 'journal', '5100', 'تكلفة المخزون المباع', null,
     309560.72, 0, 0,
     'عكس تكرار غير مقصود لقيد التصحيح JE-2026-00562 (شُغِّل سكريبت التصحيح مرتين بالخطأ) — ملف BOX-138 - ( LOT 1 OLD 2024 )',
     'correction', null, 'BOX-138 - ( LOT 1 OLD 2024 )', 'posted', now(), false, v_dup_5100_id)
    returning id into v_new_5100_id;

  insert into journal_entries
    (system_type, entry_no, entry_date, entry_type, account_code, account_name,
     contact_name, dr_amount, cr_amount, amount, description, ref_table, ref_id,
     file_no, post_status, posted_at, is_primary_line, reverses)
  values
    ('BOX', v_entry_no, current_date, 'journal', '1300', 'المخزون — سيارات', null,
     0, 309560.72, 0,
     'عكس تكرار غير مقصود لقيد التصحيح JE-2026-00562 (شُغِّل سكريبت التصحيح مرتين بالخطأ) — ملف BOX-138 - ( LOT 1 OLD 2024 )',
     'correction', null, 'BOX-138 - ( LOT 1 OLD 2024 )', 'posted', now(), false, v_dup_1300_id)
    returning id into v_new_1300_id;

  update journal_entries set reversed_by = v_new_5100_id where id = v_dup_5100_id;
  update journal_entries set reversed_by = v_new_1300_id where id = v_dup_1300_id;

  raise notice 'Posted reversal entry % for duplicate JE-2026-00562', v_entry_no;
end $$;
