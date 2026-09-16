-- نفّذ هذا في Supabase SQL Editor مرة واحدة. صفر تنفيذ حتى الآن — مسودة للمراجعة.
--
-- الهدف: المرحلة ٢ من مشروع "الحساب الجاري للشريك" (راجع الذاكرة:
-- project_partner_current_account_model.md، قسم "🔖 نقطة استئناف") تحتاج
-- ربطًا صريحًا شريك→كود حساب بدل مطابقة الاسم على 2400. فحصنا الجداول
-- الموجودة (partners_master، partner_accounts، contacts) ولا واحد منها
-- دليل شركاء عام صالح لهذا الغرض — راجع تبادل المنفّذ/المراجع 2026-09-16
-- في نفس ملف الذاكرة للتفاصيل الكاملة. هذا الملف ينشئ الدليل الناقص.
--
-- ⚠️ قرار متعمَّد، وليس سهوًا: الـunique أدناه على (system_type, partner_name)
-- فقط، وليس على account_code. حساب واحد قد يرتبط بأكثر من اسم مخزَّن فعليًا
-- (حالة "شريك سوريا" مقابل "شريك سوريا " بمسافة زائدة، موثّقة في
-- sql/rename_partner.sql) — منع ذلك يمنع تسجيل الاسم البديل لنفس الشريك.
--
-- partner_name يُخزَّن هنا بالشكل المطبَّع (trim) دائمًا. أي كود يبحث في هذا
-- الجدول لازم يعمل trim() على الاسم القادم من القيد/الإدخال قبل المقارنة —
-- وإلا يتكرر فخ المسافة الزائدة نفسه من جهة العميل هذه المرة.

-- ══ 1. الجدول ══
create table if not exists partner_account_links (
  id           bigint generated always as identity primary key,
  system_type  text        not null check (system_type in ('BOX','TM')),
  partner_name text        not null check (partner_name = btrim(partner_name)),
  account_code text        not null,
  created_at   timestamptz not null default now(),
  unique (system_type, partner_name)
);

-- ══ 2. ضمان أن chart_of_accounts عليها unique تقدر الـFK يعتمد عليه ══
-- تحقق حي قبل هذا السطر (2026-09-16، قراءة فقط، صفر صف مكرر):
--   select system_type, account_code, count(*) from chart_of_accounts
--   group by 1,2 having count(*)>1;   -- رجعت 0 صف على 70 صف إجمالي
-- exception when duplicate_object بدل فحص pg_constraint اليدوي — يحمي من
-- إعادة تشغيل الملف بالاسم نفسه (السيناريو الفعلي)، بلا افتراض عن ترتيب
-- أعمدة أي unique قديم قد يكون موجودًا بصيغة مختلفة
do $$
begin
  alter table chart_of_accounts
    add constraint chart_of_accounts_system_code_uq unique (system_type, account_code);
exception when duplicate_object then null;
end $$;

-- ══ 3. الـFK — بعد ضمان الـunique أعلاه، نفس حماية إعادة التشغيل ══
do $$
begin
  alter table partner_account_links
    add constraint partner_account_links_account_fk
    foreign key (system_type, account_code)
    references chart_of_accounts (system_type, account_code);
exception when duplicate_object then null;
end $$;

-- ══ 4. حسابات BOX الجديدة (2404-2408) — الثلاثة 2401/2402/2403 موجودون فعلًا ══
insert into chart_of_accounts (system_type, account_code, account_name, account_type, parent_code, is_active)
values
  ('BOX','2404','جاري الشريك ماجد الجبالي','liability','2400',true),
  ('BOX','2405','جاري الشريك قتيبه',        'liability','2400',true),
  ('BOX','2406','جاري الشريك سعد العنزي',   'liability','2400',true),
  ('BOX','2407','جاري الشريك أبو سليم',     'liability','2400',true),
  ('BOX','2408','جاري الشريك شريك سوريا',   'liability','2400',true)
on conflict (system_type, account_code) do nothing;

-- ══ 5. حساب TM الجديد (2401 مازن) ══
insert into chart_of_accounts (system_type, account_code, account_name, account_type, parent_code, is_active)
values
  ('TM','2401','جاري الشريك مازن الخلف','liability','2400',true)
on conflict (system_type, account_code) do nothing;

-- ══ 6. الربط — الأسماء بالشكل المطبَّع بالحرف كما تظهر فعليًا في القيود ══
-- (مقاس حيًّا 2026-09-16 من journal_entries.contact_name على account_code=2400،
--  ومن أسماء حسابات 2401/2402/2403 الموجودة لـabu أسعد/سامر الخلف —
--  الاثنان الأخيران بلا صفوف 2400 لكن لهما حساب فعلي يحتاج ربطًا)
insert into partner_account_links (system_type, partner_name, account_code) values
  ('BOX', 'ابو هادي',        '2401'),  -- بلا همزة — هكذا مخزَّن فعليًا، ليس خطأ إملائي
  ('BOX', 'أبو أسعد',        '2402'),  -- بلا صفوف 2400 بعد؛ الحساب موجود بـ+48,600 يدوي
  ('BOX', 'سامر الخلف',      '2403'),  -- حساب فاضٍ حاليًا، يُربط استباقيًا
  ('BOX', 'ماجد الجبالي',    '2404'),
  ('BOX', 'قتيبه',           '2405'),
  ('BOX', 'سعد العنزي',      '2406'),
  ('BOX', 'أبو سليم',        '2407'),
  ('BOX', 'شريك سوريا',      '2408'),  -- مخزَّن بمسافة زائدة في القيود، هنا مطبَّع
  ('TM',  'مازن الخلف',      '2401')
on conflict (system_type, partner_name) do nothing;

-- ══ 7. الصندوق/الخزينة عمدًا بلا ربط ══
-- «الصندوق» (BOX) و«صندوق الترانزيت» (TM) هما الشركة نفسها، ليسا شريكًا —
-- قرار موثّق في project_partner_current_account_model.md: «مفيش قيود جديدة
-- على 2400» للخزينة، والـ28 سطر التاريخية تفضل مكانها بلا ربط.

-- ══ 8. تحقق بعد التنفيذ (شغّلها يدويًا، مش جزء من الـtransaction) ══
-- select system_type, partner_name, account_code from partner_account_links order by 1,3;
-- -- المتوقع: 9 صفوف بالظبط، بلا الصندوق ولا صندوق الترانزيت.

-- ══ 9. RLS — اتنفذت فعليًا بعد التنفيذ الأول، موثَّقة هنا لسلامة السجل ══
-- الخطوات 1-8 نُفِّذت 2026-09-16 ونجحت (chart_of_accounts السبعة صفوف اتأكدت
-- فورًا)، لكن partner_account_links رجعت صفر صف عبر PostgREST رغم عدم وجود
-- أي خطأ (200 + []). التشخيص: CREATE TABLE عبر Supabase SQL Editor بيفعّل
-- RLS تلقائيًا (مُتحقَّق: relrowsecurity=true, relforcerowsecurity=false)،
-- وبصفر policy القاعدة الافتراضية "امنع الكل" — حتى لـauthenticated.
-- ❌ رُفض حل "تعطيل RLS بالكامل": كان هيفتح الجدول لكتابة مباشرة (INSERT/
--   UPDATE/DELETE) عبر الـAPI لأي authenticated، وهو جدول بيوجّه فلوس شريك.
-- ✅ المُنفَّذ فعليًا: RLS تفضل مفعّلة + policy قراءة فقط، بلا أي policy كتابة
--   (الكتابة الوحيدة المتاحة: SQL Editor بصلاحية الأدمن/service role):
alter table partner_account_links enable row level security;

create policy partner_account_links_select_authenticated
  on partner_account_links
  for select
  to authenticated
  using (true);

-- تحقق نهائي بعد الـpolicy (نُفِّذ 2026-09-16 عبر جلسة test.verify، PostgREST،
-- قراءة فقط) — رجع 9 صفوف بالظبط مطابقة للمتوقع في القسم ٦، بلا الصندوق
-- ولا صندوق الترانزيت. مُتحقَّق مستقلًا من جلسة المراجع أيضًا.
