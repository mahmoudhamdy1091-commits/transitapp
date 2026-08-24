-- ============================================================================
-- خطة الصلاحيات — المرحلة 3أ: هجرة بيانات user_roles → user_system_roles.
-- يُشغَّل بعد sql/user_system_roles_table.sql (يحتاج الجدول موجود).
--
-- تفكيك: كل صف من user_roles (عمود systems نصي مفصول بفواصل + role واحد
-- للصف كله) بيتفكّك لصف مستقل لكل (email × system) في الجدول الجديد.
-- TRANSIT بتترحّل لـTM (نفس توحيد التوكن من المرحلة 1) — بغضّ النظر هل
-- الصف المصدر اتعدّل بعد المرحلة 1 ولا لسه TRANSIT قديمة.
--
-- تعارض البيانات: لو نفس (email × system) ظاهر أكتر من مرة (فحصنا حيًا في
-- المرحلة 2 ولقينا حسابات فعلية بصفوف متكررة في user_roles) بأدوار مختلفة،
-- ياخد أعلى صلاحية — نفس منطق ROLE_RANK في mergeUserRows (js/settings.js)
-- وfleet_user_role() بالظبط، مش صف عشوائي. row_number() بيضمن صف واحد بس
-- لكل مفتاح قبل الإدراج (تفادي قيد Postgres: ON CONFLICT مش قادر يعالج
-- نفس المفتاح مرتين جوه نفس عبارة INSERT واحدة).
--
-- أدوار غير قياسية (زي 'user' اللي اتكشفت حيًا في المرحلة 2) تُستبعد صراحة
-- من الهجرة — مفيش تفسير آمن لها، وأفضل نستبعدها بدل ما ندخّلها بتخمين.
--
-- هذا سكريبت مزامنة لقطة (snapshot) وقت التشغيل، مش مزامنة حية مستمرة —
-- أي تعديل لاحق على user_roles (عبر شاشة الإعدادات مثلاً) محتاج إعادة
-- تشغيل الملف ده يدويًا لو عايز الجدول الجديد يفضل متزامن. مزامنة حية
-- (trigger) برّه نطاق المرحلة دي عمدًا.
--
-- آمن يتكرر تشغيله (on conflict do update بنفس منطق أعلى صلاحية).
-- ============================================================================

insert into public.user_system_roles (email, system, role)
select email, system, role
from (
  select
    ur.email,
    case trim(sys) when 'TRANSIT' then 'TM' else trim(sys) end as system,
    ur.role,
    row_number() over (
      partition by ur.email, case trim(sys) when 'TRANSIT' then 'TM' else trim(sys) end
      order by case ur.role when 'admin' then 3 when 'employee' then 2 when 'readonly' then 1 else 0 end desc
    ) as rn
  from public.user_roles ur,
       unnest(string_to_array(ur.systems, ',')) as sys
  where trim(sys) <> ''
    and case trim(sys) when 'TRANSIT' then 'TM' else trim(sys) end in ('BOX','TM','FLEET')
    and ur.role in ('admin','employee','readonly')
) ranked
where rn = 1
on conflict (email, system) do update set role = excluded.role;
