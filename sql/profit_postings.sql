-- نفّذ هذا في Supabase SQL Editor مرة واحدة. آمن يتكرر تشغيله (كل شيء if not exists / or replace).
--
-- المرحلة ٣ — الخطوة (أ): **البنية فقط، بلا أي تغيير سلوك.**
-- الجدول والعمود ينشآن الآن، ولا سطر كود واحد يقرأ منهما بعد هذا الملف. دالة
-- الترحيل والإلغاء (security definer، الصف + القيد معًا) هي الخطوة (ب)،
-- والشاشات هي الخطوة (ج). الفصل متعمَّد: هذا الملف وحده لا يمكن أن يحرّك
-- رقمًا في أي شاشة، فمراجعته وتنفيذه لا يحتاجان لقطة كناري.
--
-- المرجع: مسودة ٧ من وثيقة التصميم (قسم «سجل الترحيل» وقسم «نوعا الشريك»)،
-- والذاكرة project_partner_current_account_model.md.

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
-- 2) سجل الترحيل
-- ════════════════════════════════════════════════════════════
-- ⚠️ لماذا جدول مستقل لا نوع خامس داخل partner_ledger:
--   (أ) قيد النوع هناك يقبل أربعة أنواع فقط، وهو قيد في قاعدة البيانات
--       (partner_ledger_stage_a.sql:24) ومعه قيدان يربطان الملف ورأس المال/الربح بالنوع.
--   (ب) وأخطر: حساب التسوية يعتبر **كل** صف قادم من ذلك الجدول «سحبًا»
--       (core.js:693 و716). ترحيل ربح (دائن 2400) كان سيدخل هناك كسحب بالسالب
--       فيغيّر رقم «المسحوب» في كل شاشة بلا أن يلاحظ أحد.
create table if not exists profit_postings (
  id             uuid primary key default gen_random_uuid(),
  system_type    text not null check (system_type in ('BOX','TM')),
  file_no        text null,
  partner        text not null check (partner = btrim(partner)),

  -- ⚠️ محسوبتان في قاعدة البيانات لا تُرسلان من المتصفح: «هل هذا الشريك هو
  -- الخزينة؟» سؤال لا يصح أن تكون إجابته إدخالًا، وإلا أمكن ترحيل الخزينة مرتين
  -- على نفس الملف بمجرد إرسال is_treasury=false. is_treasury_name هي نفس المصدر
  -- الوحيد المستخدم في create_partner_account.
  -- (القيم مخزَّنة وقت الإدراج: تغيير قائمة أسماء الخزينة لاحقًا لا يعيد حسابها
  --  للصفوف القديمة — وهذا مقصود، السجل يوثّق ما كان صحيحًا وقت الترحيل.)
  is_treasury    boolean generated always as (is_treasury_name(partner)) stored,
  partner_key    text    generated always as (
                   case when is_treasury_name(partner) then '#TREASURY#' else btrim(partner) end
                 ) stored,

  kind           text not null check (kind in ('ترحيل','تسوية','أرباح عامة')),
  share_percent  numeric null,
  file_profit    numeric null,

  -- ⚠️ بلا check (amount > 0) بعكس partner_ledger: الخسارة ترحيل بالسالب في نفس
  -- القناة (الشرط الثالث من شروط المالك) لا قيد يدوي على الجنب.
  amount         numeric not null,

  posting_id     uuid null references profit_postings(id),
  post_date      date not null,
  notes          text null,
  post_status    text not null default 'مُرحَّل' check (post_status in ('مُرحَّل','ملغى')),
  ref_no         text not null,
  created_by     text null,
  created_at     timestamptz not null default now(),

  -- «ترحيل» و«تسوية» على ملف، و«أرباح عامة» بلا ملف — نفس منطق chk_file_link
  -- في partner_ledger: يمنع الخلط الدلالي الذي يُفلت صفًّا من سقف الملف.
  constraint chk_pp_file_link check (
    (kind in ('ترحيل','تسوية') and file_no is not null)
    or (kind = 'أرباح عامة' and file_no is null)
  ),
  -- التسوية تصلح ترحيلًا بعينه، وغيرها لا يشير إلى شيء
  constraint chk_pp_posting_ref check (
    (kind = 'تسوية' and posting_id is not null)
    or (kind <> 'تسوية' and posting_id is null)
  )
);

-- ── منع الترحيل مرتين على نفس (النظام × الملف × الشريك) ──
-- في قاعدة البيانات لا في المتصفح: الفحص في الكود يسقط مع أول نداءين متزامنين.
-- partner_key لا partner: وإلا أمكن ترحيل الخزينة مرتين باسمين مختلفين.
-- جزئي على «ترحيل» و«مُرحَّل» فقط: التسوية متعددة بطبيعتها، والملغى يجب أن
-- يسمح بإعادة الترحيل.
create unique index if not exists uniq_profit_posting_once
  on profit_postings (system_type, file_no, partner_key)
  where kind = 'ترحيل' and post_status = 'مُرحَّل';

create index if not exists idx_profit_postings_file
  on profit_postings (system_type, file_no) where file_no is not null;
create index if not exists idx_profit_postings_partner
  on profit_postings (system_type, partner_key);

-- ════════════════════════════════════════════════════════════
-- 3) الصلاحيات: قراءة فقط — لا إدراج ولا تعديل من البرنامج
-- ════════════════════════════════════════════════════════════
-- بعكس partner_ledger المفتوح للكتابة للجميع (stage_a.sql:60-63): الكتابة هنا
-- تمر حصرًا عبر دالة security definer في الخطوة (ب)، تمامًا كما في
-- partner_account_links. هكذا يستحيل إنشاء صف يتخطّى فحص الصلاحية أو يُكتب بلا
-- قيده المقابل.
alter table profit_postings enable row level security;
drop policy if exists profit_postings_select on profit_postings;
create policy profit_postings_select on profit_postings
  for select to authenticated using (true);
grant select on profit_postings to authenticated;

-- ════════════════════════════════════════════════════════════
-- 4) تحقق بعد التنفيذ (شغّلها يدويًا — كلها قراءة فقط)
-- ════════════════════════════════════════════════════════════
-- (أ) التصنيف: المتوقع 1 دائم (TM 2401) · 5 خارجي (BOX 2404-2408) · 3 NULL
-- select system_type, account_code, partner_name, is_permanent
--   from partner_account_links order by system_type, account_code;
--
-- (ب) الخزينة تُقرأ دائمة رغم أن لا صف لها: المتوقع t · t · NULL
-- select is_permanent_partner('BOX','الصندوق'),
--        is_permanent_partner('TM','صندوق الترانزيت'),
--        is_permanent_partner('BOX','أبو أسعد');
--
-- (ج) الجدول فاضي والـRLS مفعّلة بسياسة قراءة واحدة: المتوقع 0 · t · 1
-- select (select count(*) from profit_postings),
--        (select relrowsecurity from pg_class where relname = 'profit_postings'),
--        (select count(*) from pg_policies where tablename = 'profit_postings');
--
-- (د) الأعمدة المحسوبة تعمل، بلا كتابة أي صف:
-- select is_treasury_name('الصندوق'), is_treasury_name('مازن الخلف');
--   -- المتوقع: t · f
