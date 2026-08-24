-- ============================================================================
-- خطة الصلاحيات — المرحلة 3أ: جدول عضوية حقيقي (email × system → role)
-- بدل عمود systems النصي المفصول بفواصل. أسلوب انتقالي آمن — إضافة بس،
-- صفر إزالة أو تعديل على user_roles الأصلي أو أي مسار قراءة موجود
-- (is_fleet_user, fleet_user_role, loadUserRoleFromDB, شاشات الإعدادات
-- كلهم يفضلوا يقروا من user_roles القديم بالظبط زي ما هم دلوقتي).
--
-- الجدول ده لسه مش مستخدَم في أي منطق فعلي — بس موجود ومتزامن بالبيانات
-- (سكريبت الهجرة sql/user_system_roles_migrate.sql منفصل، يتشغّل بعد
-- الملف ده). نقل القراءة الفعلية له مرحلة تانية منفصلة، بعد التأكد إن
-- البيانات متطابقة 100% مع user_roles.
--
-- RLS مفعّلة بلا أي policy عمدًا (default-deny) — مفيش شكل قراءة فعلي
-- اتحدد لسه، فالأكثر أمانًا نمنع كل حاجة لحد ما نصمم الـpolicy الصح في
-- المرحلة اللي هتستخدم الجدول ده فعليًا.
--
-- هذا الملف يُراجَع ويُشغَّل يدويًا من المستخدم عبر Supabase SQL Editor.
-- آمن يتكرر تشغيله (create table if not exists).
-- ============================================================================

create table if not exists public.user_system_roles (
  email      text not null,
  system     text not null check (system in ('BOX','TM','FLEET')),
  role       text not null check (role in ('admin','employee','readonly')),
  created_at timestamptz not null default now(),
  primary key (email, system)
);

alter table public.user_system_roles enable row level security;
