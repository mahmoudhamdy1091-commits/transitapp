-- أداة تشخيص دائمة — قراءة فقط، صفر كتابة، آمنة تُشغَّل في أي وقت. شغّلها
-- بعد أي جلسة SQL يدوية على partner_account_links، أو دوريًا (شهريًا مثلًا)،
-- عشان تكتشف أي قيد شريك اتوجّه لحساب غلط بسرعة بدل ما يتراكم أسابيع —
-- نفس النمط اللي كشف باج مازن/3200 (2026-09-22، راجع
-- project_mazen_partner_link_misroute_2026-09-22.md).
--
-- المنطق: أي قيد `contact_name` بتاعه اسم شريك معروف (من partner_account_links)،
-- في نوع حركة شريك حقيقي (دفعة/مصروف/تحصيل/صرف/عكس — مش بيع، لأن نفس
-- الشخص ممكن يكون عميلًا كمان في سياق تاني، مش باج)، لكن الحساب اللي القيد
-- عليه **مش** 2400 (القديم) ولا الحساب المربوط له فعليًا — ده انحراف يستحق
-- مراجعة.
--
-- ⚠️ هيفضل يطلّع الـ871 صف التاريخية المعروفة لمازن (3200، مقفولة بقرار مالك
-- 2026-09-20) في كل تشغيل ما لم تحدد تاريخًا — ده متوقَّع وليس تكرارًا للباج.
-- لو عايز نتيجة نضيفة (بس الجديد)، غيّر '2026-09-21' تحت لتاريخ آخر مراجعة.

select
  je.system_type,
  je.contact_name             as partner_name,
  je.account_code             as posted_to,
  pal.account_code            as should_be,
  je.ref_table,
  je.file_no,
  je.entry_no,
  je.entry_date,
  je.created_at,
  (je.cr_amount - je.dr_amount) as net_amount,
  je.description
from journal_entries je
join partner_account_links pal
  on pal.system_type = je.system_type
 and pal.partner_name = btrim(je.contact_name)
where je.post_status = 'posted'
  and je.ref_table in ('payments','expenses','collections','partner_payouts','partner_ledger','reversal')
  and je.account_code <> '2400'
  and je.account_code <> pal.account_code
  -- بلا هذا الفلتر: كل تشغيل هيطلّع الـ871 صف التاريخية المعروفة لمازن كمان
  -- (كلها created_at <= 2026-09-13، آخر يوم اشتغل فيه m4_mazen_historical_
  -- reclassification.sql). 2026-09-16 = يوم إنشاء صف partner_account_links
  -- الصحيح لمازن — أي حاجة بعده لازم تتراجع. عدّل التاريخ لآخر مرة راجعت
  -- فيها النتيجة يدويًا لو عايز نتيجة أضيق مستقبلًا.
  and je.created_at >= '2026-09-16T00:00:00Z'
order by je.system_type, je.contact_name, je.created_at;

-- تفسير كل صف: posted_to = الحساب اللي القيد فعليًا عليه، should_be = حساب
-- الشريك المربوط الصحيح. لو مختلفين، القيد محتاج مراجعة (زي TM-095/TM-096
-- سابقًا) — لا تصلحه تلقائيًا بلا فهم السياق، كل حالة لها قصة مختلفة محتملة.
