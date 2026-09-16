-- نفّذ هذا في Supabase SQL Editor مرة واحدة. آمن يتكرر تشغيله (create or replace).
--
-- الغرض: فتح حساب شريك جديد + ربطه، في عملية واحدة ذرّية بصلاحية المدير.
--
-- الخلفية: المرحلة ٢ (partner_account_links) ربطت كل شريك بحساب مخصَّص تحت
-- 2400، وحرّاس الكتّاب الخمسة (engine.js) ترفض أي حركة لشريك بلا حساب مربوط.
-- وتوضيح المالك 2026-09-16: في BOX **كل ملف تقريبًا له شريك ثانٍ مختلف** يُضاف
-- من سند الشراء (مقاس حيًّا: ابو هادي BOX-127 · قتيبه BOX-128 · سعد BOX-130 ·
-- شريك سوريا BOX-124 · ماجد BOX-141 · أبو سليم BOX-142/143) — أي أن إضافة
-- شريك جديد مسار عمل عادي لا حالة نادرة. بدون هذه الدالة، أول مصروف/دفعة/
-- تحصيل على أي ملف جديد يُرفض حتى يتدخّل مبرمج بـSQL يدوي.
--
-- ⚠️ لماذا في السيرفر لا في المتصفح: تخصيص "أول كود فاضي" في العميل سباق
-- تزامن حقيقي — مستخدمان يفتحان ملفًا في اللحظة نفسها يحصلان على الكود نفسه،
-- فيفشل أحدهما بخرق unique (أو أسوأ: يُربط شريكان بحساب واحد لو غاب القيد).
-- القفل الاستشاري أدناه يسلسل النداءات على مستوى النظام، ونفس المعاملة تنفّذ
-- التخصيص والإنشاء والربط معًا — نفس نمط create_partner_ledger_entry.
--
-- ⚠️ الجدول partner_account_links يبقى **بلا policy كتابة** (راجع
-- sql/partner_account_links.sql القسم 9): security definer هنا هو المسار
-- الوحيد للكتابة، فيستحيل إنشاء ربط يتخطّى فحص الصلاحية أدناه.

-- ══ 0. مصدر واحد لأسماء الخزينة في SQL ══
-- كانت الأسماء متكررة في engine.js (TREASURY_ALIASES) وsql/rename_partner.sql
-- (v_treasury). هذه الدالة تمنع نسخة ثالثة داخل الدالة الرئيسية أدناه، وهي
-- المكان الذي يُفترض أن يستدعيه أي SQL لاحق (rename_partner.sql يُحوَّل إليها
-- عند أول تعديل عليه — لم يُلمس الآن لأنه ملف مُختبَر ونُفِّذ فعلًا).
create or replace function is_treasury_name(p_name text)
returns boolean
language sql
immutable
as $$
  select btrim(coalesce(p_name, '')) in ('الصندوق', 'صندوق الترانزيت');
$$;

create or replace function create_partner_account(p_sys text, p_partner_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_partner_name, ''));
  v_role text;
  v_code text;
  v_next int;
  -- ⚠️ user_roles بتستخدم تسميتين لنفس النظام: بعض الصفوف "TRANSIT" وبعضها
  -- "TM" (مقاس حيًّا 2026-09-16: BOX,TRANSIT · BOX,TM,FLEET · FLEET).
  -- الواجهة بتتعامل مع الاتنين أصلًا (settings.js:564، transactions.js:662)،
  -- فلو فحصنا p_sys وحده كان أدمن TRANSIT هيترفض في ترانزيت — اتمسك بقياس حي
  -- قبل النشر: نداء TM لأدمن صفّه "BOX,TRANSIT" رجع "مقصور على المدير".
  v_sys_tokens text[] := case when p_sys = 'TM' then array['TM','TRANSIT'] else array[p_sys] end;
begin
  -- ══ 1. حراس المدخلات أولًا ══
  -- قبل فحص الصلاحية عمدًا: مدخل غلط يجب أن يقول ما هو الغلط. لو جاء فحص
  -- الصلاحية أولًا، فإن create_partner_account('XX','اسم') من غير مدير ترجع
  -- "مقصور على المدير" فيظن المستدعي أن المشكلة صلاحية لا نظام غير معروف.
  -- وهذه الفحوص لا تلمس أي بيانات، فتقديمها لا يسرّب شيئًا.
  if p_sys not in ('BOX','TM') then
    raise exception 'نظام غير معروف: %', p_sys;
  end if;
  if v_name = '' then
    raise exception 'اسم الشريك فارغ';
  end if;
  -- الخزينة ليست شريكًا: مصاريفها تذهب للنقد/البنك مباشرة، ولا حساب 24xx لها
  -- (قرار موثّق في project_partner_current_account_model.md)
  if is_treasury_name(v_name) then
    raise exception 'الخزينة ليست شريكًا ولا تحتاج حسابًا مخصَّصًا';
  end if;

  -- ══ 2. الصلاحية: المدير فقط، fail-closed ══
  -- coalesce إلزامية: 'NULL <> admin' في SQL ترجع NULL لا TRUE، فتتعامل IF
  -- معها كـFALSE ويصير الفحص fail-open. نفس درس fleet_void_admin_only.sql.
  select role into v_role
    from public.user_roles
   where email = auth.jwt() ->> 'email'
     and exists (select 1 from unnest(v_sys_tokens) t where systems like '%' || t || '%')
   order by case role when 'admin' then 3 when 'employee' then 2 when 'readonly' then 1 else 0 end desc
   limit 1;
  if coalesce(v_role, '') <> 'admin' then
    raise exception 'فتح حساب شريك مقصور على المدير';
  end if;

  -- ══ 3. قفل يسلسل النداءات المتزامنة على نفس النظام ══
  perform pg_advisory_xact_lock(hashtext('create_partner_account:' || p_sys));

  -- ══ 4. موجود بالفعل؟ ارجع كوده (idempotent — النداء المكرر لا يُنشئ شيئًا) ══
  select account_code into v_code
    from partner_account_links
   where system_type = p_sys and partner_name = v_name;
  if v_code is not null then
    return v_code;
  end if;

  -- ══ 5. أول كود فاضٍ في المدى 2401..2499 ══
  -- المدى محجوز لحسابات الشركاء بقرار موثّق (js/accounting.js فوق 2400):
  -- core.js isPartnerPocketAcc تعتبر أي حساب يبدأ بـ24 "جيب شريك".
  select min(g) into v_next
    from generate_series(2401, 2499) g
   where not exists (
     select 1 from chart_of_accounts c
      where c.system_type = p_sys and c.account_code = g::text
   );
  if v_next is null then
    raise exception 'لا توجد أكواد متاحة في المدى 2401-2499 لنظام %', p_sys;
  end if;
  v_code := v_next::text;

  -- ══ 6. الحساب + الربط في نفس المعاملة ══
  -- القفل الاستشاري يسلسل نداءات هذه الدالة، لكنه لا يمنع إنشاء حساب 24xx
  -- يدويًا من شاشة شجرة الحسابات في اللحظة نفسها. النتيجة وقتها خطأ نظيف بلا
  -- فساد بيانات (المعاملة كلها تتراجع)، ونترجمه لرسالة مفهومة بدل نص القيد.
  begin
    insert into chart_of_accounts (system_type, account_code, account_name, account_type, parent_code, is_active)
    values (p_sys, v_code, 'جاري الشريك ' || v_name, 'liability', '2400', true);
  exception when unique_violation then
    raise exception 'الكود % اتفتح للتوّ من مكان تاني — أعد المحاولة وهياخد الكود اللي بعده', v_code;
  end;

  insert into partner_account_links (system_type, partner_name, account_code)
  values (p_sys, v_name, v_code);

  return v_code;
end $$;

grant execute on function create_partner_account(text, text) to authenticated;

-- ══ تحقق بعد التنفيذ (شغّلها يدويًا) ══
-- select proname, prosecdef from pg_proc where proname = 'create_partner_account';
-- -- المتوقع: صف واحد، prosecdef = true
--
-- ولاختبار سلوك الرفض بلا إنشاء أي شيء:
-- select create_partner_account('BOX','الصندوق');   -- المتوقع: خطأ "الخزينة ليست شريكًا"
-- select create_partner_account('XX','اسم');        -- المتوقع: خطأ "نظام غير معروف"
