-- نفّذ هذا في Supabase SQL Editor مرة واحدة. آمن يتكرر تشغيله (شرط is_permanent is null يمنع الكتابة فوق تصنيف موجود).
--
-- استكمال تصنيف is_permanent (sql/m_is_permanent_only.sql) — الأربعة المتروكون
-- NULL عمدًا هناك (BOX 2401/2402/2403 + عبدالله الجاحد في الاتنين) حسموا
-- دائمين بقرار صريح من المالك 2026-09-22: هما مُلّاك الشركة/الصندوق الحقيقيون
-- (راجع بند ت٢ في docs/PLAN-partner-accounts-2026-09-17.md — نصيبهم من ترحيل
-- ربح الصندوق نفسه مستقبلًا)، لا شركاء ملف عاديين.

update partner_account_links set is_permanent = true
 where system_type = 'BOX' and account_code in ('2401','2402','2403','2409')
   and is_permanent is null;   -- عبد الرحيم الجاحد · علي أسعد ديمو · سامر الخلف · عبدالله الجاحد

update partner_account_links set is_permanent = true
 where system_type = 'TM' and account_code in ('2402','2403')
   and is_permanent is null;   -- عبدالله الجاحد · عبد الرحيم الجاحد

-- ════════════════════════════════════════════════════════════
-- تحقق بعد التنفيذ (قراءة فقط) — المتوقَّع: صفر صف NULL متبقٍّ في partner_account_links
-- ════════════════════════════════════════════════════════════
-- select system_type, account_code, partner_name, is_permanent
--   from partner_account_links order by system_type, account_code;
