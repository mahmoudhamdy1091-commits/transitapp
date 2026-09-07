-- ════════════════════════════════════════════════════════════════════
-- 2026-09-06 — بندان مستقلان قبل بدء المرحلة ب
--   أ) فحص (قراءة فقط): حالة الصفّين المهاجَرين — حاجز أمام المرحلة ب
--   ب) مسح (كتابة): بقايا اختبار ZZTEST-SUPPLIER من 2026-07-27
--
-- ⚠️ نفّذ القسم أ كاملًا واقرأ نتائجه قبل تشغيل أي شيء في القسم ب.
-- ⚠️ لا تشغّل الملف دفعة واحدة — كل استعلام على حدة.
-- ════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
-- القسم أ — فحص، قراءة فقط، لا يعدّل شيئًا
-- ════════════════════════════════════════════════════════════════════

-- أ-١) الصفوف في partner_ledger وتوأمها في partner_payouts
-- السبب: هجرة sql/partner_ledger_stage_a.sql نسخت ولم تنقل (insert بلا delete)،
-- فالصفّان التاريخيان موجودان في الجدولين معًا. لو أيٌّ منهما ليس 'posted'،
-- سيظهر نفس الصرف مرتين في طابور الاعتماد بمجرد أن تقرأ المرحلة ب
-- partner_ledger — واعتمادهما معًا يُنشئ قيدين بـref_id مختلفين
-- (فحص التكرار في _createApprovalJE يعتمد ref_table+ref_id فلن يمنعه).
--
-- المتوقَّع الآمن: كل الصفوف post_status = 'posted' في العمودين.
select
  pl.id            as ledger_id,
  pl.ref_no,
  pl.system_type,
  pl.partner,
  pl.file_no,
  pl.entry_type,
  pl.amount,
  pl.post_status   as ledger_status,
  pp.id            as payout_id,
  pp.post_status   as payout_status,
  case
    when pp.id is null                                   then 'لا توأم — سليم'
    when pl.post_status = 'posted' and pp.post_status = 'posted' then 'آمن — الاثنان معتمدان'
    else '⚠️ حاجز — أحدهما غير معتمد، سيظهر مرتين في الطابور'
  end as verdict
from partner_ledger pl
left join partner_payouts pp
       on pp.pay_id = pl.ref_no
      and pp.system_type = pl.system_type
order by pl.created_at;

-- أ-٢) عدّاد سريع: هل يوجد أي صف partner_ledger غير معتمد أصلًا؟
select post_status, count(*) as cnt
from partner_ledger
group by post_status
order by post_status;


-- ════════════════════════════════════════════════════════════════════
-- القسم ب — مسح بقايا ZZTEST-SUPPLIER (قرار المستخدم 2026-09-06: امسحها)
-- ════════════════════════════════════════════════════════════════════

-- ب-١) اكتشاف شامل — شغّل هذا أولًا ولا تفترض العدد.
-- ⚠️ الفلترة على كل الأعمدة الممكنة عمدًا، لا على file_no/contact_name وحدهما:
-- سطر النقدية (1110/1120) في قيود السحب/الإيداع العام له contact_name = null
-- وfile_no = null بالتصميم — أي أن اسم الاختبار قد يوجد في description وحده.
-- هذا بالضبط ما جعل تنظيفًا سابقًا في نفس اليوم يُبلِّغ عن صفّين والواقع ثمانية.
--
-- الإفصاح ذكر أربعة صفوف (ids 2734-2737). هذا الاستعلام يتحقق من الرقم بدل قبوله.
select
  id, entry_no, entry_date, system_type, file_no,
  account_code, account_name, contact_name,
  dr_amount, cr_amount, ref_table, ref_id, post_status, description
from journal_entries
where description  ilike '%ZZTEST%'
   or contact_name ilike '%ZZTEST%'
   or file_no      ilike '%ZZTEST%'
   or account_name ilike '%ZZTEST%'
order by id;

-- ب-٢) تحقّق التوازن قبل المسح — يجب أن يكون الصافي صفرًا لكل entry_no،
-- وإلا فالمسح سيترك اليومية غير متوازنة (توقّف وأبلغ بدل المتابعة).
select
  entry_no,
  sum(dr_amount) as total_dr,
  sum(cr_amount) as total_cr,
  sum(dr_amount) - sum(cr_amount) as diff
from journal_entries
where description  ilike '%ZZTEST%'
   or contact_name ilike '%ZZTEST%'
   or file_no      ilike '%ZZTEST%'
   or account_name ilike '%ZZTEST%'
group by entry_no
order by entry_no;

-- ب-٣) هل بقي أي صف تشغيلي مرتبط بهذه القيود؟ (يجب أن يرجع صفرًا)
-- نفحص بـref_id وحده عبر كل ref_table — راجع feedback_cleanup_verification_by_ref_id:
-- قيد العكس يحمل ref_table='reversal' بنفس ref_id، فالفلترة بـref_table تفوّته.
select ref_table, ref_id, count(*) as cnt
from journal_entries
where ref_id in (
  select distinct ref_id from journal_entries
  where (description ilike '%ZZTEST%' or contact_name ilike '%ZZTEST%'
      or file_no ilike '%ZZTEST%' or account_name ilike '%ZZTEST%')
    and ref_id is not null
)
group by ref_table, ref_id
order by ref_id, ref_table;

-- ب-٤) المسح — لا تشغّله إلا بعد مراجعة ب-١ وب-٢ وب-٣.
--
-- الحالة المتوقَّعة: ب-١ يرجع أربعة صفوف بالضبط (ids 2734, 2735, 2736, 2737).
-- عندها شغّل هذا — بالمعرّفات صراحةً، لا بنمط نصّي، حتى لا يتوسّع المسح
-- إلى صفوف ZZTEST أخرى (مثلًا بقايا تشغيل اختبار انحدار جارٍ الآن) لم تقرّرها.
-- returning تعرض لك بالضبط ما حُذف — راجعه.
delete from journal_entries
where id in (2734, 2735, 2736, 2737)
returning id, entry_no, description;

-- ⚠️ لو ب-١ أرجع صفوفًا غير هذه الأربعة: توقّف ولا تشغّل ما فوق.
-- أبلِغ بالقائمة أولًا — عدد أكبر من المتوقَّع هو نفسه اكتشاف يستحق قرارًا،
-- لا شيئًا يُمسح تلقائيًا (نفس درس ٢٠٢٦-٠٩-٠٦: بلاغ "صفّان" والواقع ثمانية).


-- ب-٥) تحقّق بعد المسح — يجب أن يرجع صفرًا.
-- select count(*) from journal_entries
--  where description ilike '%ZZTEST%' or contact_name ilike '%ZZTEST%'
--     or file_no ilike '%ZZTEST%' or account_name ilike '%ZZTEST%';

-- ب-٦) ثم افتح شاشة اليومية في التطبيق وتأكّد بعينك أنها اختفت.
-- استعلام صمّمتُ أنا معاييره لا يُثبت إلا ما افترضتُه — الشاشة الحية هي الدليل.


-- ════════════════════════════════════════════════════════════════════
-- القسم ج — «سلفة»: فجوة نمذجة + خطر أمامي (أُضيف 2026-09-07)
-- قراءة فقط.
-- ════════════════════════════════════════════════════════════════════
--
-- الخلفية (مُثبَتة من الكود وحده، بلا بيانات حية):
--   modals.js:2403 وviewer.js:613 يكتبان «سلفة» كـamount = advance_amount
--   مع capital_amount = profit_amount = 0. لكن partner_ledger لا تحتوي عمود
--   advance_amount إطلاقًا (صفر ورود لكلمة advance في ملف المرحلة أ)، والهجرة
--   تُثبِّت النوع على 'استرداد وتوزيع أرباح' وتنسخ capital/profit كما هما.
--   وchk_capital_profit_sum يشترط لهذا النوع abs(capital+profit−amount)<0.01
--   ⇒ لصف سلفة: abs(0+0−amount) = amount > 0 ⇒ انتهاك CHECK.
--   وبما أنها insert … select واحدة ⇒ ترتدّ الهجرة كلها لا الصف وحده.
--
-- ⚠️ استنتاج مهم يُغيّر الأولوية: الهجرة نجحت فعلًا في 91b8de7. نجاحها نفسه
-- يُثبت حسابيًا أنه لم يكن أي صف سلفة موجودًا وقتها — وإلا ما هاجر ولا صف.
-- فهذه ليست عطلًا قائمًا بل (أ) فجوة نمذجة: سلفة مربوطة بملف لا شكل لها في
-- الموديل الجديد — النوعان المرتبطان بملف يشترطان capital+profit=amount،
-- والنوعان اللذان يقبلان مبلغًا مجردًا ممنوعان من file_no بـchk_file_link؛
-- (ب) خطر أمامي: زر «صرف شريك» القديم ما زال قادرًا على إنشاء صف سلفة اليوم.
-- الاستعلام أدناه للتأكيد لا للاكتشاف — المتوقَّع صفر.

select
  system_type,
  count(*)                                   as advance_rows,
  coalesce(sum(advance_amount), 0)           as total_advance,
  min(pay_date)                              as first_date,
  max(pay_date)                              as last_date
from partner_payouts
where payout_type = 'سلفة'
   or coalesce(advance_amount, 0) > 0
group by system_type
order by system_type;

-- تفصيل الصفوف إن وُجدت (شغّله فقط لو الاستعلام فوق أرجع أي صف)
select id, system_type, file_no, partner, pay_id, payout_type,
       amount, capital_amount, profit_amount, advance_amount,
       post_status, pay_date
from partner_payouts
where payout_type = 'سلفة'
   or coalesce(advance_amount, 0) > 0
order by system_type, pay_date;
