-- نفّذ هذا في Supabase SQL Editor مرة واحدة. آمن يتكرر تشغيله (كل شيء if not exists / or replace).
--
-- مستخرج بالحرف من sql/profit_postings.sql (القسم الأول فقط، أسطر 1-68) —
-- بقرار المالك 2026-09-21: القسم الأول وحده الآن، بلا جدول profit_postings
-- (سيُستخرج لاحقًا في ملف منفصل وقت الحاجة الفعلية له في مرحلة الترحيل).
--
-- المرجع: docs/PLAN-partner-statement-restructure-2026-09-20.md قسم ٥،
-- ومسودة ٧ من وثيقة التصميم، والذاكرة project_partner_current_account_model.md.

-- ════════════════════════════════════════════════════════════
-- 1) صفة الشريك: دائم أم خارجي (الشرط الأول من شروط المالك الأربعة)
-- ════════════════════════════════════════════════════════════
-- القاعدة كما اعتمدها المالك 2026-09-17:
--   • الشريك **الدائم** رأس ماله مدوَّر داخل الشركة فلا مطالبة له برأس مال —
--     البيع يعيد نقد الشركة إلى البنك تلقائيًا بلا قيد. سقفه = المُرحَّل − المسحوب.
--   • الشريك **الخارجي** يدفع من ماله لملف بعينه بنسبة، ويسترد رأس ماله + ربحه.
--     سقفه = رأس ماله + المُرحَّل − المسحوب − التحصيلات الممسوكة.
--
-- ⚠️ الصفة **تُخزَّن ولا تُستنتج**: لا من الاسم ولا من رقم الحساب ولا من النظام.
-- أي اشتقاق يعني نسخة من القاعدة في كل شاشة، وواحدة منها ستنحرف — نفس فئة
-- الخطأ التي أنتجت صيغتَي الاستحقاق المتباينتين (project_entitlement_formula_copies).
--
-- ⚠️ ولماذا nullable بلا default رغم أنها صفة إلزامية: القيمة الخاطئة هنا مال.
-- الافتراضي الصامت (false) كان سيجعل «مازن» خارجيًا حتى يلاحظ أحد، والـnot null
-- كان سيجبرنا على تخمين الثلاثة الملتبسين أدناه. NULL هنا تعني **«لم يُصنَّف بعد»**
-- وهي حالة صريحة يجب أن يتعامل معها كل قارئ بالرفض لا بالافتراض.
alter table partner_account_links
  add column if not exists is_permanent boolean;

comment on column partner_account_links.is_permanent is
  'true = شريك دائم (رأس ماله مدوَّر، لا مطالبة له برأس مال، سقفه المُرحَّل فقط). '
  'false = شريك خارجي (يسترد رأس ماله + ربحه). '
  'NULL = لم يُصنَّف بعد — على القارئ أن يرفض لا أن يفترض. '
  'الخزينة ليس لها صف هنا أصلًا: استخدم is_permanent_partner() لا العمود مباشرة.';

-- ── التصنيف المحسوم (كل شرط يُحدِّد صفًّا واحدًا بالكود لا بالاسم، تفاديًا لفخ
--    اختلاف الإملاء/المسافات الذي أوقعنا فيه «شريك سوريا» من قبل) ──
-- شغّل هذا أولًا لترى الصفوف التسعة كما هي قبل أي تعديل:
--   select system_type, account_code, partner_name, is_permanent
--     from partner_account_links order by system_type, account_code;

update partner_account_links set is_permanent = true
 where system_type = 'TM' and account_code = '2401' and is_permanent is null;   -- مازن الخلف

update partner_account_links set is_permanent = false
 where system_type = 'BOX' and account_code in ('2404','2405','2406','2407','2408')
   and is_permanent is null;   -- ماجد الجبالي · قتيبه · سعد العنزي · أبو سليم · شريك سوريا

-- ⚠️ 2401 و2402 و2403 في BOX (ابو هادي · أبو أسعد · سامر الخلف) **تُترك NULL عمدًا**:
-- شكلها ليس شركاء ملف (رصيد افتتاحي من 2022، مسحوبات شخصية، إيجار، وحساب بلا
-- قيود) — والمالك لم يصنّفها بعد. تُملأ بسطر update واحد حين يجيب.

-- ── الدالة التي يقرأ منها كل شيء لاحقًا ──
-- الخزينة («الصندوق» و«صندوق الترانزيت») شريك دائم بحكم التعريف ولا صف ربط لها
-- إطلاقًا (create_partner_account ترفض فتح حساب لها) — لذلك لا يجوز لأي قارئ أن
-- يقرأ العمود مباشرة، وإلا صارت الخزينة «غير مصنَّفة» في كل شاشة.
create or replace function is_permanent_partner(p_sys text, p_partner_name text)
returns boolean
language sql
stable
as 'select case when is_treasury_name($2) then true
            else (select l.is_permanent from partner_account_links l
                   where l.system_type = $1 and l.partner_name = btrim(coalesce($2, ''''))) end';

comment on function is_permanent_partner(text, text) is
  'true دائم · false خارجي · NULL غير مصنَّف (أو شريك بلا صف ربط). الخزينة دائمًا true.';

-- ════════════════════════════════════════════════════════════
-- 2) تحقق بعد التنفيذ (شغّلها يدويًا — كلها قراءة فقط)
-- ════════════════════════════════════════════════════════════
-- (أ) التصنيف: المتوقع 1 دائم (TM 2401) · 5 خارجي (BOX 2404-2408) · 3 NULL
-- select system_type, account_code, partner_name, is_permanent
--   from partner_account_links order by system_type, account_code;
--
-- (ب) الخزينة تُقرأ دائمة رغم أن لا صف لها: المتوقع t · t · NULL
-- select is_permanent_partner('BOX','الصندوق'),
--        is_permanent_partner('TM','صندوق الترانزيت'),
--        is_permanent_partner('BOX','أبو أسعد');
