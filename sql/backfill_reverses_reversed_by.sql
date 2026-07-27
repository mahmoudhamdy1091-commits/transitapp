-- نفّذه في Supabase SQL Editor عند الرغبة — اختياري، بند 1 (Dual-JE Case 1) شغّال
-- بدونه للقيود الجديدة. هذا السكربت يربط القيود العكسية *التاريخية* (قبل هذا
-- الإصلاح) بأصولها عبر reverses/reversed_by الفعليين (عمودان integer يشيران
-- لـjournal_entries.id)، بدل ما تفضل معتمدة فقط على مطابقة نصية وقت العرض
-- (journal.js _excludeReversalPairs). راجع project_dual_je_audit Case 1.
--
-- ✅ آمن لإعادة التشغيل أكتر من مرة: كل تحديث مقيّد بشرط "... is null" على
--    العمود المستهدف، فلن يلمس أي صف مربوط بالفعل (لا من تشغيل سابق لهذا
--    السكربت ولا من القيود الجديدة اللي الكود بقى يربطها تلقائياً).
-- ✅ لا يغيّر dr_amount/cr_amount/post_status/أي رصيد — تحديث على عمودي
--    reverses/reversed_by فقط، بيانات وصفية إضافية لا تؤثر على أي تقرير حالي.
-- ✅ كل قيد (JE) له أكتر من سطر يشتركوا في نفس entry_no — بما إن العمودين من
--    نوع integer (يشيرا لصف واحد بعينه، لا لـentry_no النصي)، نختار id تمثيلي
--    واحد (أصغر id في كل مجموعة) ونكتبه على *كل* أسطر الطرف الآخر، بنفس منطق
--    postDoubleEntry (engine.js) المطبَّق على القيود الجديدة.
-- ✅ حماية من تضارب entry_no (لا يوجد UNIQUE constraint عليه، وله تاريخ تضارب
--    فعلي قبل next_je_no الذري — نفس الفجوة اللي كانت في postDoubleEntry قبل
--    مراجعة مستقلة اكتشفتها): جدول مؤقت safe_je_groups أدناه يحصر فقط
--    مجموعات entry_no اللي *كل* سطورها تشترك في نفس ref_table/ref_id — أي
--    entry_no متضارب (سطور من سجلات مختلفة تمامًا اتصادف نفس النص) يُستبعد
--    تلقائيًا من الربط بدل ما يُربط غلط.
-- ⚠️ Tier 2b وTier 3 مطابقة نصية أفضل مجهود (نفس منطق journal.js بالحرف) —
--    ممكن يفوتها عدد قليل من القيود القديمة جداً لو الوصف مش مطابق تماماً؛
--    مفيش أي ضرر في تركها بلا ربط (تفضل تشتغل بالمطابقة النصية القديمة
--    في العرض زي ما هي).

begin;

-- ── تقرير قبل التنفيذ: عدد قيود reversal اللي لسه بلا reverses ──
select
  ref_table,
  count(*) filter (where reverses is null)      as unlinked_reverses,
  count(*)                                       as total
from journal_entries
where ref_table = 'reversal'
group by ref_table;

-- ── مجموعات entry_no "الآمنة" — كل سطورها تشترك في نفس ref_table/ref_id بالضبط ──
create temporary table safe_je_groups on commit drop as
select
  system_type,
  entry_no,
  min(id)                          as rep_id,
  min(ref_table)                   as ref_table,
  min(ref_id)                      as ref_id
from journal_entries
group by system_type, entry_no
having count(distinct coalesce(ref_table,'')) = 1
   and count(distinct coalesce(ref_id,''))    = 1;

create index on safe_je_groups (system_type, entry_no);
create index on safe_je_groups (system_type, ref_table, ref_id);

-- ══════════════════════════════════════════════════════════════
-- Tier 1: عكس عبر voidTransaction/voidPurchaseOrder — ref_id حقيقي يربط
--   ref_table='reversal' بصف ref_table IN (payments/expenses/collections/
--   partner_payouts/purchase_orders) لنفس ref_id
-- ══════════════════════════════════════════════════════════════
with pairs as (
  select distinct
    rev.entry_no as rev_entry_no, rev.system_type,
    orig.entry_no as orig_entry_no
  from journal_entries rev
  join safe_je_groups orig
    on orig.system_type = rev.system_type
   and orig.ref_id      = rev.ref_id
   and orig.ref_table in ('payments','expenses','collections','partner_payouts','purchase_orders')
  where rev.ref_table = 'reversal' and rev.ref_id is not null
),
ids as (
  select p.*, o.rep_id as orig_id, r.rep_id as rev_id
  from pairs p
  join safe_je_groups o on o.system_type = p.system_type and o.entry_no = p.orig_entry_no
  join safe_je_groups r on r.system_type = p.system_type and r.entry_no = p.rev_entry_no
)
update journal_entries je set reverses = ids.orig_id
from ids
where je.entry_no = ids.rev_entry_no and je.system_type = ids.system_type and je.reverses is null;

with pairs as (
  select distinct
    rev.entry_no as rev_entry_no, rev.system_type, orig.entry_no as orig_entry_no
  from journal_entries rev
  join safe_je_groups orig
    on orig.system_type = rev.system_type
   and orig.ref_id      = rev.ref_id
   and orig.ref_table in ('payments','expenses','collections','partner_payouts','purchase_orders')
  where rev.ref_table = 'reversal' and rev.ref_id is not null
),
ids as (
  select p.*, o.rep_id as orig_id, r.rep_id as rev_id
  from pairs p
  join safe_je_groups o on o.system_type = p.system_type and o.entry_no = p.orig_entry_no
  join safe_je_groups r on r.system_type = p.system_type and r.entry_no = p.rev_entry_no
)
update journal_entries je set reversed_by = ids.rev_id
from ids
where je.entry_no = ids.orig_entry_no and je.system_type = ids.system_type and je.reversed_by is null;

-- ══════════════════════════════════════════════════════════════
-- Tier 0: عكس تعديل (تصحيح قيمة بعد الترحيل، لا إلغاء) — updateJEInPlace
--   الوصف: "عكس تعديل {ref_table} ... تصحيح قيد {entry_no}" — القيد المذكور
--   صراحة بعينه فقط يُربط. القيد الجديد الصحيح بعدها لا يُذكر في أي وصف عكس
--   فلا reversed_by يتحدّث له هنا (نفس مبدأ journal.js._excludeReversalPairs)
-- ══════════════════════════════════════════════════════════════
with pairs as (
  select distinct
    rev.entry_no as rev_entry_no, rev.system_type,
    substring(rev.description from 'تصحيح قيد (\S+)\s*$') as orig_entry_no
  from journal_entries rev
  where rev.ref_table = 'reversal' and rev.description ~ 'تصحيح قيد \S+\s*$'
),
ids as (
  select p.*, o.rep_id as orig_id, r.rep_id as rev_id
  from pairs p
  join safe_je_groups o on o.system_type = p.system_type and o.entry_no = p.orig_entry_no
  join safe_je_groups r on r.system_type = p.system_type and r.entry_no = p.rev_entry_no
  where p.orig_entry_no is not null
)
update journal_entries je set reverses = ids.orig_id
from ids
where je.entry_no = ids.rev_entry_no and je.system_type = ids.system_type and je.reverses is null;

with pairs as (
  select distinct
    rev.entry_no as rev_entry_no, rev.system_type,
    substring(rev.description from 'تصحيح قيد (\S+)\s*$') as orig_entry_no
  from journal_entries rev
  where rev.ref_table = 'reversal' and rev.description ~ 'تصحيح قيد \S+\s*$'
),
ids as (
  select p.*, o.rep_id as orig_id, r.rep_id as rev_id
  from pairs p
  join safe_je_groups o on o.system_type = p.system_type and o.entry_no = p.orig_entry_no
  join safe_je_groups r on r.system_type = p.system_type and r.entry_no = p.rev_entry_no
  where p.orig_entry_no is not null
)
update journal_entries je set reversed_by = ids.rev_id
from ids
where je.entry_no = ids.orig_entry_no and je.system_type = ids.system_type and je.reversed_by is null;

-- ══════════════════════════════════════════════════════════════
-- Tier 2a: بيع — ref_id حقيقي (قيود ما بعد post_sale_je RPC، ref_id=رقم الفاتورة)
-- ══════════════════════════════════════════════════════════════
with pairs as (
  select distinct
    rev.entry_no as rev_entry_no, rev.system_type, orig.entry_no as orig_entry_no
  from journal_entries rev
  join safe_je_groups orig
    on orig.system_type = rev.system_type
   and orig.ref_table = 'sales'
   and orig.ref_id    = rev.ref_id
  where rev.ref_table = 'reversal' and rev.ref_id is not null
),
ids as (
  select p.*, o.rep_id as orig_id, r.rep_id as rev_id
  from pairs p
  join safe_je_groups o on o.system_type = p.system_type and o.entry_no = p.orig_entry_no
  join safe_je_groups r on r.system_type = p.system_type and r.entry_no = p.rev_entry_no
)
update journal_entries je set reverses = ids.orig_id
from ids
where je.entry_no = ids.rev_entry_no and je.system_type = ids.system_type and je.reverses is null;

with pairs as (
  select distinct
    rev.entry_no as rev_entry_no, rev.system_type, orig.entry_no as orig_entry_no
  from journal_entries rev
  join safe_je_groups orig
    on orig.system_type = rev.system_type
   and orig.ref_table = 'sales'
   and orig.ref_id    = rev.ref_id
  where rev.ref_table = 'reversal' and rev.ref_id is not null
),
ids as (
  select p.*, o.rep_id as orig_id, r.rep_id as rev_id
  from pairs p
  join safe_je_groups o on o.system_type = p.system_type and o.entry_no = p.orig_entry_no
  join safe_je_groups r on r.system_type = p.system_type and r.entry_no = p.rev_entry_no
)
update journal_entries je set reversed_by = ids.rev_id
from ids
where je.entry_no = ids.orig_entry_no and je.system_type = ids.system_type and je.reversed_by is null;

-- ══════════════════════════════════════════════════════════════
-- Tier 2b: بيع (نصي — للقيود القديمة جداً اللي ref_id فيها لسه null على الطرفين)
--   نفس منطق journal.js: استخراج رقم الفاتورة من "عكس بيع فاتورة {invNo}..."
--   أو "عكس + حذف فاتورة {invNo}..."، مطابقة بنفس file_no + احتواء الوصف الأصلي
-- ══════════════════════════════════════════════════════════════
with pairs as (
  select distinct
    rev.entry_no as rev_entry_no, rev.system_type, orig.entry_no as orig_entry_no
  from journal_entries rev
  join journal_entries orig
    on orig.system_type = rev.system_type
   and orig.ref_table = 'sales'
   and orig.ref_id is null
   and orig.file_no = rev.file_no
   and orig.description like '%' || substring(rev.description from 'فاتورة (\S+)') || '%'
  where rev.ref_table = 'reversal' and rev.ref_id is null
    and rev.description ~ '^عكس (بيع فاتورة|\+ حذف فاتورة)'
),
ids as (
  select p.*, o.rep_id as orig_id, r.rep_id as rev_id
  from pairs p
  join safe_je_groups o on o.system_type = p.system_type and o.entry_no = p.orig_entry_no
  join safe_je_groups r on r.system_type = p.system_type and r.entry_no = p.rev_entry_no
)
update journal_entries je set reverses = ids.orig_id
from ids
where je.entry_no = ids.rev_entry_no and je.system_type = ids.system_type and je.reverses is null;

with pairs as (
  select distinct
    rev.entry_no as rev_entry_no, rev.system_type, orig.entry_no as orig_entry_no
  from journal_entries rev
  join journal_entries orig
    on orig.system_type = rev.system_type
   and orig.ref_table = 'sales'
   and orig.ref_id is null
   and orig.file_no = rev.file_no
   and orig.description like '%' || substring(rev.description from 'فاتورة (\S+)') || '%'
  where rev.ref_table = 'reversal' and rev.ref_id is null
    and rev.description ~ '^عكس (بيع فاتورة|\+ حذف فاتورة)'
),
ids as (
  select p.*, o.rep_id as orig_id, r.rep_id as rev_id
  from pairs p
  join safe_je_groups o on o.system_type = p.system_type and o.entry_no = p.orig_entry_no
  join safe_je_groups r on r.system_type = p.system_type and r.entry_no = p.rev_entry_no
)
update journal_entries je set reversed_by = ids.rev_id
from ids
where je.entry_no = ids.orig_entry_no and je.system_type = ids.system_type and je.reversed_by is null;

-- ══════════════════════════════════════════════════════════════
-- Tier 3: قيد يدوي مُعكوس عبر reverseManualJE — الوصف "عكس قيد {entry_no}"
-- ══════════════════════════════════════════════════════════════
with pairs as (
  select distinct
    rev.entry_no as rev_entry_no, rev.system_type,
    substring(rev.description from 'عكس قيد (\S+)\s*$') as orig_entry_no
  from journal_entries rev
  where rev.ref_table = 'reversal' and rev.description ~ '^عكس قيد \S+\s*$'
),
ids as (
  select p.*, o.rep_id as orig_id, r.rep_id as rev_id
  from pairs p
  join safe_je_groups o on o.system_type = p.system_type and o.entry_no = p.orig_entry_no
  join safe_je_groups r on r.system_type = p.system_type and r.entry_no = p.rev_entry_no
  where p.orig_entry_no is not null
)
update journal_entries je set reverses = ids.orig_id
from ids
where je.entry_no = ids.rev_entry_no and je.system_type = ids.system_type and je.reverses is null;

with pairs as (
  select distinct
    rev.entry_no as rev_entry_no, rev.system_type,
    substring(rev.description from 'عكس قيد (\S+)\s*$') as orig_entry_no
  from journal_entries rev
  where rev.ref_table = 'reversal' and rev.description ~ '^عكس قيد \S+\s*$'
),
ids as (
  select p.*, o.rep_id as orig_id, r.rep_id as rev_id
  from pairs p
  join safe_je_groups o on o.system_type = p.system_type and o.entry_no = p.orig_entry_no
  join safe_je_groups r on r.system_type = p.system_type and r.entry_no = p.rev_entry_no
  where p.orig_entry_no is not null
)
update journal_entries je set reversed_by = ids.rev_id
from ids
where je.entry_no = ids.orig_entry_no and je.system_type = ids.system_type and je.reversed_by is null;

-- ── تقرير بعد التنفيذ: قد إيه اتربط دلوقتي ──
select
  ref_table,
  count(*) filter (where reverses is null)      as still_unlinked_reverses,
  count(*)                                       as total
from journal_entries
where ref_table = 'reversal'
group by ref_table;

-- راجع نتيجة التقريرين فوق قبل commit. لو الأرقام منطقية (انخفاض واضح في
-- still_unlinked_reverses) نفّذ commit؛ لو حابب تراجع أكتر بدّل commit بـ rollback.
commit;
