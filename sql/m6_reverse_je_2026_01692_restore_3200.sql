-- نفّذه إنت في Supabase SQL Editor. آمن يتكرر تشغيله (فحص وجود مسبق).
--
-- ════════════════════════════════════════════════════════════
-- الخلفية (2026-09-23)
-- ════════════════════════════════════════════════════════════
-- JE-2026-01692 (تاريخ 2026-09-22، sql/m6_fix_mazen_3200_misroute.sql) كان
-- قيدًا خاطئًا: عامَل دفعة TM-095 (6,500، JE-2026-01609، id=24739) كأنها
-- "باج توجيه" ونقلها من 3200 إلى 2401 (حساب مازن الشخصي).
--
-- لكن هذا القيد كان في الأصل نتيجة **قرار مالك موثَّق بتاريخ 2026-09-20**
-- (sql/m4b_mazen_excel_53rows_and_2401_final.sql، القسم 3): الدفعة اتقيدت
-- غلط وقت حدوثها على حساب مازن (2401) فنُقلت عمدًا لـ3200 باعتبارها فلوس
-- شركة لا فلوس مازن الشخصية — مطابقة رياضيًا لرصيد كشف مازن حتى الرقم
-- العشري الثالث (46,622.01).
--
-- يوم 09-22 لم أُراجع سكريبت م٤ب قبل تشخيص "باج التوجيه" فعكست قرار
-- المالك بالخطأ. المالك أكّد يوم 09-23: "زي ما قررت يوم 09-20، ارجعها
-- 3200". هذا القيد يعكس JE-2026-01692 بالكامل ويعيد الوضع لما قرره المالك.
--
-- ════════════════════════════════════════════════════════════
-- 1) القيد العكسي — يلغي JE-2026-01692 بالكامل (Dr 2401 / Cr 3200، 6,500)
-- ════════════════════════════════════════════════════════════
do $$
declare
  v_entry_no text;
  v_exists   boolean;
begin
  select exists(
    select 1 from journal_entries
     where system_type = 'TM' and file_no = 'TM-095'
       and account_code = '3200'
       and description like 'عكس تصحيح خاطئ (JE-2026-01692)%'
  ) into v_exists;

  if v_exists then
    raise notice 'القيد العكسي موجود بالفعل — لا تكرار';
  else
    v_entry_no := next_je_no('TM');
    insert into journal_entries
      (system_type, entry_no, entry_date, account_code, account_name, contact_name,
       dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
    values
      ('TM', v_entry_no, current_date, '2401', 'جاري الشريك مازن الخلف', 'مازن الخلف',
       6500, 0, 'عكس تصحيح خاطئ (JE-2026-01692) — دفعة TM-095 كانت رجعت غلط لحساب مازن، تأكيد المالك 2026-09-23 إنها فلوس شركة حسب قرار 09-20 — راجع project_review_of_audit_partner_statements_2026-09-23.md', 'manual', null, 'TM-095', 'posted', now()),
      ('TM', v_entry_no, current_date, '3200', 'الأرباح المبقاة', null,
       0, 6500, 'عكس تصحيح خاطئ (JE-2026-01692) — دفعة TM-095 كانت رجعت غلط لحساب مازن، تأكيد المالك 2026-09-23 إنها فلوس شركة حسب قرار 09-20 — راجع project_review_of_audit_partner_statements_2026-09-23.md', 'manual', null, 'TM-095', 'posted', now());

    insert into audit_log(system_type, action, table_name, file_no, old_value, new_value, notes, user_email)
    values ('TM', 'CORRECT', 'journal_entries', 'TM-095', '2401 (بالخطأ عبر JE-2026-01692)', '3200 (تأكيد قرار 09-20)',
      'عكس قيد خاطئ — JE-2026-01692 كان عكس قرار المالك 09-20 بدون قصد، قيد ' || v_entry_no || '، 6,500، تأكيد المالك 2026-09-23',
      coalesce(auth.jwt() ->> 'email', current_user));

    raise notice 'تم إنشاء القيد العكسي: %', v_entry_no;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════
-- 2) تحقق بعد التنفيذ (قراءة فقط)
-- ════════════════════════════════════════════════════════════
-- select sum(cr_amount - dr_amount) from journal_entries
--   where system_type='TM' and account_code='2401' and contact_name='مازن الخلف' and post_status='posted';
-- -- المتوقَّع: يرجع لنفس الرقم قبل JE-2026-01692 (بدون الـ6,500)
