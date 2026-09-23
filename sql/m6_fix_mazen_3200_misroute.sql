-- نفّذه إنت في Supabase SQL Editor. آمن يتكرر تشغيله (القسم 1 محمي بفحص
-- وجود مسبق، القسم 2 بـexception when duplicate_object).
--
-- ════════════════════════════════════════════════════════════
-- الخلفية (2026-09-22) — راجع project_mazen_partner_link_misroute_2026-09-22.md
-- ════════════════════════════════════════════════════════════
-- فحص شامل حي (كل شركاء TM وBOX) أثبت: 874 قيد على حساب 3200 باسم مازن
-- الخلف — **871 منهم مقصودون ومقفولون** (sql/m4_mazen_historical_reclassification.sql،
-- قرار مالك 2026-09-20، مُتحقَّق رياضيًا لآخر رقم عشري — لا تُلمَس)، **و3 بس
-- باج حي حقيقي**: دفعتان (09-19) اتوجّهتا لـ3200 بدل حساب مازن (2401) رغم
-- إن الربط الصحيح كان موجودًا فعلًا وقتها. TM-096 (1,888) اتعكست بعدها
-- فصافيها صفر — لا تحتاج تصحيحًا. **TM-095 (6,500) لسه قابعة غلط، بلا عكس.**
--
-- السبب الجذري: فحصت كل كود JS وكل ملف SQL يلمس partner_account_links —
-- مفيش أي مسار (لا je_payment ولا create_partner_account ولا أي سكريبت)
-- يقدر يكتب قيمة خارج مدى 2401-2499 لصف موجود. الاستنتاج الوحيد المتبقي:
-- UPDATE يدوي مباشر (Supabase SQL Editor) غيّر صف مازن مؤقتًا بين 09-16
-- و09-19 ثم رجّعه — audit_log فاضٍ لهذا الجدول (غير متتبَّع) فالسبب الدقيق
-- غير مؤكَّد. القسم 2 تحت تحصين وقائي يمنع تكرار **هذا النوع بالذات** من
-- الغلط مستقبلًا (توجيه لحساب خارج مدى الشركاء) بغض النظر عن مصدره.

-- ════════════════════════════════════════════════════════════
-- 1) القيد التصحيحي — Dr 3200 / Cr 2401، 6,500، ملف TM-095
-- ════════════════════════════════════════════════════════════
do $$
declare
  v_entry_no text;
  v_exists   boolean;
begin
  select exists(
    select 1 from journal_entries
     where system_type = 'TM' and file_no = 'TM-095'
       and account_code = '2401' and contact_name = 'مازن الخلف'
       and description like 'تصحيح توجيه خاطئ%'
  ) into v_exists;

  if v_exists then
    raise notice 'القيد التصحيحي موجود بالفعل — لا تكرار';
  else
    v_entry_no := next_je_no('TM');
    insert into journal_entries
      (system_type, entry_no, entry_date, account_code, account_name, contact_name,
       dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
    values
      ('TM', v_entry_no, current_date, '3200', 'الأرباح المبقاة', null,
       6500, 0, 'تصحيح توجيه خاطئ — دفعة مورد TM-095 (JE-2026-01609) كانت اتقيدت غلط على 3200 بدل حساب مازن — راجع project_mazen_partner_link_misroute_2026-09-22.md', 'manual', null, 'TM-095', 'posted', now()),
      ('TM', v_entry_no, current_date, '2401', 'جاري الشريك مازن الخلف', 'مازن الخلف',
       0, 6500, 'تصحيح توجيه خاطئ — دفعة مورد TM-095 (JE-2026-01609) كانت اتقيدت غلط على 3200 بدل حساب مازن — راجع project_mazen_partner_link_misroute_2026-09-22.md', 'manual', null, 'TM-095', 'posted', now());

    insert into audit_log(system_type, action, table_name, file_no, old_value, new_value, notes, user_email)
    values ('TM', 'CORRECT', 'journal_entries', 'TM-095', '3200 (اتقيدت غلط)', '2401 (مازن الخلف)',
      'تصحيح باج توجيه — دفعة TM-095 كانت على 3200 بدل 2401، قيد ' || v_entry_no || '، 6,500',
      coalesce(auth.jwt() ->> 'email', current_user));

    raise notice 'تم إنشاء القيد التصحيحي: %', v_entry_no;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════
-- 2) تحصين وقائي — account_code لازم يكون داخل مدى حسابات الشركاء المحجوز
-- ════════════════════════════════════════════════════════════
-- نفس المدى المستخدم في create_partner_account.sql (2401-2499) — أي UPDATE
-- (يدوي أو عبر كود) يحاول يحط قيمة خارج المدى ده هيترفض برسالة واضحة بدل
-- فساد صامت. لا يمنع كل أنواع الأخطاء (لو حد غيّر لحساب تاني *داخل* المدى
-- بالغلط، ده مش هيتكشف) لكنه يمنع بالضبط النوع اللي حصل هنا (توجيه لحساب
-- خارج مدى الشركاء تمامًا، زي 3200).
do $$
begin
  alter table partner_account_links
    add constraint partner_account_links_account_range_chk
    check (account_code between '2401' and '2499');
exception when duplicate_object then null;
end $$;

-- ════════════════════════════════════════════════════════════
-- 3) تحقق بعد التنفيذ (قراءة فقط)
-- ════════════════════════════════════════════════════════════
-- select sum(cr_amount - dr_amount) from journal_entries
--   where system_type='TM' and account_code='2401' and contact_name='مازن الخلف' and post_status='posted';
-- -- المتوقَّع: -50,581.00 (الرقم الحالي -57,081 + 6,500 المُرجَّعة)
--
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'partner_account_links'::regclass and conname like '%range%';
-- -- المتوقَّع: صف واحد، القيد الجديد ظاهر
--
-- اختبار الرفض (اختياري، بلا كتابة فعلية — يفشل بتصميم):
-- update partner_account_links set account_code='3200' where partner_name='مازن الخلف';
-- -- المتوقَّع: خطأ "violates check constraint"
