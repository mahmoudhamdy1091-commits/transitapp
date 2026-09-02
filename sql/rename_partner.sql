-- نفّذ هذا في Supabase SQL Editor مرة واحدة.
-- أداة عامة لإعادة تسمية/توحيد اسم شريك عبر كل الجداول المرتبطة في معاملة
-- واحدة ذرّية.
--
-- السبب: هوية الشريك في هذا النظام نصّية بالكامل — لا يوجد معرّف رقمي يربطها
-- (journal_entries.contact_id فارغ في كل الصفوف بلا استثناء، تم التحقق)، فأي
-- اختلاف في الكتابة (مسافة زائدة، أ/ا، ة/ه) يخلق شريكًا ثانيًا وهميًا.
--
-- اكتُشف فعليًا 2026-09-01 عبر فحص الجداول الستة بتطبيع عربي كامل:
--   • BOX — "أبو سليم" / "أبو سليم "  → ملفان (BOX-143 / BOX-142)، 6 صفوف
--   • TM  — "مازن الخلف" / "مازن الخلف " → 999 صف، منها 750 عنصر داخل
--     expenses.paid_by_split (85 ملف). كل سجلات partners_master الـ92
--     بالصيغة ذات المسافة، بينما 771 من القيود بالصيغة النظيفة.
--
-- ⚠️ مهم للفهم: computePartnerSettlement (js/core.js) سليمة تمامًا — تعمل
-- .trim() على الطرفين (سطر 685 على contact_name، وسطر 724 على partner)،
-- فالأرقام المالية لا تتغير بهذه العملية إطلاقًا. الخلل الفعلي في
-- showPartnerStatement (js/accounting.js) التي تقارن الاسم خامًا في 4 مواضع:
--   1687 — الكشف الشامل يرجع نصف ملفات الشريك فقط (eq. على الاسم الخام)
--   1839 — grandTransferable = صفر بصمت (فيه حارس !ps2 فلا ينهار، رقم غلط فقط)
--   1763 — myPayouts فارغة → capitalRet/profitTaken/advances أصفار
--   1999 — إطار التمييز لا يظهر (تجميلي)
-- أي أن هذه العملية تصحيح عرض بأثر مالي صفر — وهذا ما يجب أن يثبته الاختبار
-- الحي بمقارنة مخرجات computePartnerSettlement قبل وبعد (يجب أن تتطابق).
--
-- لماذا RPC لا تسلسل من المتصفح: PostgREST لا يوفّر معاملة عبر 8 أهداف، وفشل
-- جزئي في المنتصف (بعد partners_master وقبل journal_entries مثلًا) يترك
-- البيانات في حالة أسوأ من التكرار الحالي — تناقض جديد أصعب اكتشافًا.
--
-- ── الصلاحيات: قرار موثّق ──
-- الدالة مفتوحة لـauthenticated بلا فحص دور، عن قصد وليس سهوًا:
--   • لا توجد أي دالة صلاحية في سكيما public إطلاقًا. الثلاث RPCs الموجودة
--     (delete_deal_completely / post_sale_je / next_je_no) كلها بلا أي فحص.
--   • fleet.fleet_user_role() تخص سكيما fleet وتفلتر systems like '%FLEET%'.
--   • user_system_roles فارغ وRLS عليه default-deny بلا policy عمدًا، وملفه
--     ينص صراحة أنه "لسه مش مستخدَم في أي منطق فعلي".
--   • user_roles (الحيّ) يحمل تضاربًا يمنع helper بسيطًا: نفس الإيميل بصفّين
--     بقيم systems مختلفة، وقيمة "BOX,TRANSIT" تسمّي TM باسم ثالث.
--   • delete_deal_completely أخطر بكثير (تمسح 9 جداول) وهي مفتوحة — تقييد
--     هذه وحدها يعطي إحساس أمان زائف بينما الثغرة الحقيقية باقية.
-- عند نزول helper الأدوار في سكيما public، تُقيَّد هذه الدالة مع الثلاث
-- الأخريات دفعة واحدة، لا منفردة.

drop function if exists rename_partner(text, text, text, boolean);

create or replace function rename_partner(
  p_sys      text,
  p_old_name text,
  p_new_name text,
  p_dry_run  boolean default true
) returns table(target text, matched_rows int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n         int;
  v_total     int := 0;
  v_collision int;
  v_treasury  text[] := array['الصندوق', 'صندوق الترانزيت'];
  v_match     jsonb  := jsonb_build_array(jsonb_build_object('partner', p_old_name));
begin
  -- ── قفل استشاري: يسلسل أي نداءين متزامنين على نفس النظام، ويتحرر تلقائيًا
  --    مع نهاية الـtransaction. لا يوجد صف واحد نقفل عليه لأن العملية عابرة
  --    للملفات، بخلاف post_sale_je/delete_deal_completely ──
  perform pg_advisory_xact_lock(hashtext('rename_partner:' || coalesce(p_sys, '')));

  -- ══ حراس المدخلات ══
  if p_sys is null or p_sys not in ('BOX', 'TM') then
    raise exception 'نظام غير صالح: %', coalesce(p_sys, 'NULL');
  end if;

  if coalesce(p_old_name, '') = '' or coalesce(p_new_name, '') = '' then
    raise exception 'الاسم القديم والجديد لا يجوز أن يكون أيّهما فارغًا';
  end if;

  if p_old_name = p_new_name then
    raise exception 'الاسمان متطابقان — لا شيء لتنفيذه';
  end if;

  -- الاسم الجديد لا يجوز أن يحمل مسافات طرفية: الأداة يجب ألا تنتج نفس فئة
  -- المشكلة التي وُجدت لإصلاحها. تحقق مدخل بحت (btrim فقط، لا تطبيع عربي
  -- كامل) — لا يتفاعل مع أي حارس آخر ولا يكلّف شيئًا على استدعاء صحيح
  if p_new_name <> btrim(p_new_name) then
    raise exception 'الاسم الجديد % يحتوي مسافات طرفية — الأداة لا يجوز أن تنتج نفس المشكلة التي تصلحها',
      quote_literal(p_new_name);
  end if;

  -- أسماء الخزينة ممنوعة: تغييرها يقلب توجيه القيود عبر _isPartnerPocket
  -- (engine.js) من نقد/بنك إلى حساب الشركاء 2400 على كل ملفات النظام
  if p_old_name = any(v_treasury) or p_new_name = any(v_treasury) then
    raise exception
      'ممنوع استخدام هذه الأداة على أسماء الخزينة (%). تغيير اسم الخزينة يغيّر توجيه القيود عبر _isPartnerPocket ويستوجب قرارًا وهجرة منفصلة',
      array_to_string(v_treasury, ' / ');
  end if;

  -- حارس التصادم: وجود الاسمين معًا في نفس الملف يعني دمج حصتَي شريكين في
  -- صف واحد — عملية مختلفة ذات أثر محاسبي، ليست إعادة تسمية
  select count(distinct a.file_no) into v_collision
  from partners_master a
  join partners_master b
    on b.system_type = a.system_type
   and b.file_no     = a.file_no
   and b.partner     = p_new_name
  where a.system_type = p_sys
    and a.partner     = p_old_name;

  if v_collision > 0 then
    raise exception
      'تصادم: % ملف يحتوي الاسمين معًا. إعادة التسمية هنا تعني دمج حصتَي شريكين في صف واحد — عملية مختلفة ذات أثر محاسبي، غير مدعومة في هذه الأداة',
      v_collision;
  end if;

  -- ══ 1. partners_master.partner ══
  if p_dry_run then
    select count(*) into v_n from partners_master
     where system_type = p_sys and partner = p_old_name;
  else
    update partners_master set partner = p_new_name
     where system_type = p_sys and partner = p_old_name;
    get diagnostics v_n = row_count;
  end if;
  target := 'partners_master'; matched_rows := v_n; v_total := v_total + v_n; return next;

  -- ══ 2. payments.payer ══
  if p_dry_run then
    select count(*) into v_n from payments
     where system_type = p_sys and payer = p_old_name;
  else
    update payments set payer = p_new_name
     where system_type = p_sys and payer = p_old_name;
    get diagnostics v_n = row_count;
  end if;
  target := 'payments.payer'; matched_rows := v_n; v_total := v_total + v_n; return next;

  -- ══ 3. expenses.paid_by (نصّي) ══
  if p_dry_run then
    select count(*) into v_n from expenses
     where system_type = p_sys and paid_by = p_old_name;
  else
    update expenses set paid_by = p_new_name
     where system_type = p_sys and paid_by = p_old_name;
    get diagnostics v_n = row_count;
  end if;
  target := 'expenses.paid_by'; matched_rows := v_n; v_total := v_total + v_n; return next;

  -- ══ 4. expenses.paid_by_split (jsonb) ══
  --    إعادة بناء المصفوفة عنصرًا عنصرًا مع حفظ الترتيب الأصلي (with ordinality)
  --    وتعديل مفتاح partner فقط دون المساس بـamount. المطابقة بـ@> (احتواء)
  --    لا بمسح نصّي — دقيقة وتستفيد من فهرس GIN لو أُضيف مستقبلًا. الصفوف
  --    ذات paid_by_split = NULL تُستبعد تلقائيًا وهو المطلوب.
  if p_dry_run then
    select count(*) into v_n from expenses
     where system_type = p_sys and paid_by_split @> v_match;
  else
    update expenses e
       set paid_by_split = (
         select jsonb_agg(
                  case when elem->>'partner' = p_old_name
                       then jsonb_set(elem, '{partner}', to_jsonb(p_new_name))
                       else elem
                  end
                  order by ord
                )
         from jsonb_array_elements(e.paid_by_split) with ordinality as t(elem, ord)
       )
     where e.system_type = p_sys
       and e.paid_by_split @> v_match;
    get diagnostics v_n = row_count;
  end if;
  target := 'expenses.paid_by_split'; matched_rows := v_n; v_total := v_total + v_n; return next;

  -- ══ 5. collections.received_by ══
  if p_dry_run then
    select count(*) into v_n from collections
     where system_type = p_sys and received_by = p_old_name;
  else
    update collections set received_by = p_new_name
     where system_type = p_sys and received_by = p_old_name;
    get diagnostics v_n = row_count;
  end if;
  target := 'collections.received_by'; matched_rows := v_n; v_total := v_total + v_n; return next;

  -- ══ 6. partner_payouts.partner ══
  if p_dry_run then
    select count(*) into v_n from partner_payouts
     where system_type = p_sys and partner = p_old_name;
  else
    update partner_payouts set partner = p_new_name
     where system_type = p_sys and partner = p_old_name;
    get diagnostics v_n = row_count;
  end if;
  target := 'partner_payouts.partner'; matched_rows := v_n; v_total := v_total + v_n; return next;

  -- ══ 7. journal_entries.contact_name ══
  --    يعيد تسمية التسمية الظاهرة على قيود مرحّلة. الأرقام لا تتأثر إطلاقًا
  --    لأن core.js تعمل trim على الطرفين — تصحيح عرض لا أكثر
  if p_dry_run then
    select count(*) into v_n from journal_entries
     where system_type = p_sys and contact_name = p_old_name;
  else
    update journal_entries set contact_name = p_new_name
     where system_type = p_sys and contact_name = p_old_name;
    get diagnostics v_n = row_count;
  end if;
  target := 'journal_entries.contact_name'; matched_rows := v_n; v_total := v_total + v_n; return next;

  -- ══ 8. contacts.name ══
  --    مقيّد بـtype='partner' حتى لا يُعاد تسمية مورّد أو عميل يصادف حمله
  --    نفس الاسم. لاحظ أن contacts هو الهدف الثامن المكتشف متأخرًا: القيود
  --    لا تربط جهة الاتصال بمعرّف (contact_id فارغ دائمًا) بل بالاسم فقط
  if p_dry_run then
    select count(*) into v_n from contacts
     where system_type = p_sys and name = p_old_name and type = 'partner';
  else
    update contacts set name = p_new_name
     where system_type = p_sys and name = p_old_name and type = 'partner';
    get diagnostics v_n = row_count;
  end if;
  target := 'contacts.name'; matched_rows := v_n; v_total := v_total + v_n; return next;

  -- ── الاسم القديم غير موجود إطلاقًا: خطأ صريح لا نجاح صامت. يلتقط أخطاء
  --    المسافات والكتابة قبل أن تُفسَّر الأصفار على أنها "تم بنجاح" ──
  if v_total = 0 then
    raise exception 'لا يوجد أي صف بالاسم % في النظام % — تحقق من المسافات والكتابة',
      quote_literal(p_old_name), p_sys;
  end if;

  -- ── سجل التدقيق (للتنفيذ الحقيقي فقط) ──
  --    file_no = null لأن العملية عابرة للملفات؛ القيد الأجنبي عليه أُزيل في
  --    sql/fix_audit_log_fk_file_no.sql
  if not p_dry_run then
    insert into audit_log(system_type, action, table_name, file_no,
                          old_value, new_value, notes, user_email)
    values (p_sys, 'RENAME', 'partners_master', null,
            p_old_name, p_new_name,
            format('إعادة تسمية شريك عبر rename_partner — إجمالي %s صف', v_total),
            coalesce(auth.jwt() ->> 'email', current_user));
  end if;

  target := '__TOTAL__'; matched_rows := v_total; return next;
end;
$$;

revoke all on function rename_partner(text, text, text, boolean) from public, anon;
grant execute on function rename_partner(text, text, text, boolean) to authenticated;
