-- نفّذ هذا في Supabase SQL Editor مرة واحدة. آمن يتكرر تشغيله
-- (create or replace / drop if exists في كل مكان).
--
-- يعتمد على sql/m6_profit_postings_phase1.sql و
-- sql/m6_treasury_profit_distribution_phase2.sql (لازم يكونا شُغِّلا قبله —
-- جدول profit_postings وقيوده وis_treasury_name وis_permanent_partner
-- وnext_je_no كلهم مُستخدَمون هنا).
--
-- ════════════════════════════════════════════════════════════
-- م٦ — توزيع موحَّد لأرباح الملف (قرار مالك صريح 2026-09-22)
-- ════════════════════════════════════════════════════════════
-- يحل محل الدالتين المنفصلتين post_profit_for_file (نصيب شريك دائم مُسمَّى)
-- وpost_treasury_profit_for_file (نصيب الخزينة موزَّعًا على الملّاك).
--
-- ⚠️ التغييران الجوهريان عن التصميم السابق — كلاهما بقرار مالك صريح:
--
-- ١) **العمولات أُلغيت من هنا بالكامل** (p_commissions اختفت). العمولة بقت
--    مصروفًا عاديًا على الصفقة باسم مستفيدها (راجع
--    sql/m6_expenses_is_commission.sql) ⇒ بتنزل في تكلفة الملف (5100/1300)
--    فبتقلّل v_file_profit المحسوب تحت **تلقائيًا**، قبل أي توزيع.
--    الأثر: كل شريك — دائم وخارجي — بيتحمّل نصيبه من العمولة بنسبته.
--    التصميم القديم كان بيخصمها من نصيب الخزينة **وحده**، فمازن كشريك في
--    الملف ما كانش بيتحمّل منها حاجة والخارجي كمان. رصدها المالك بنفسه.
--
-- ٢) **عملية واحدة للملف كله بدل زرَّين منفصلين.** السبب مش تجميلي: بزرَّين،
--    لو اتضغط زر الشريك الدائم الأول اتحسب نصيبه على ربح قبل ما تتسجّل
--    العمولة ⇒ رقم مُرحَّل غلط بلا مسار تصحيح غير قيد تسوية يدوي. العملية
--    الواحدة بتقفل خطر الترتيب ده نهائيًا: إما الكل أو لا شيء.
--
-- ⚠️ قاعدة معمارية مقصودة — **الشريك الخارجي لا يُرحَّل له شيء إطلاقًا**:
-- مستحقّه محسوب أصلًا في computePartnerSettlement (js/core.js) من ربح الملف
-- × نسبته؛ ترحيله هنا كمان = احتسابه **مرتين** (مرة محسوبًا ومرة رصيدًا
-- دائنًا في حسابه). نصيبه بيفضل في 3200 لحد ما يتسوّى بآليته الحالية،
-- وبينزل تلقائيًا بمقدار حصته من العمولة لأن ربح الملف نفسه نزل.
-- (توحيد المصدرين هو موضوع م٨ في docs/PLAN-partner-accounts-2026-09-17.md،
-- ولسه ما بدأش — لا تبنِ ترحيلًا للخارجي قبله.)
--
-- ⚠️ خطر انحراف الصيغتين (JS/SQL): معادلة الربح تحت مطابقة بالحرف لـ
-- computeFinancials.byFile[fn] (js/core.js)، والغلاف postFileProfitAll
-- بيعيد الحساب محليًا بعد كل نجاح ويقارن — أي فرق بيظهر تحذيرًا فوريًا.

-- ════════════════════════════════════════════════════════════
-- 1) الدالة الموحَّدة
-- ════════════════════════════════════════════════════════════
create or replace function post_file_profit_all(
  p_sys      text,
  p_file_no  text
) returns table(
  posting_id      uuid,
  entry_no        text,
  recipient       text,
  recipient_kind  text,   -- 'شريك دائم' أو 'مالك'
  file_profit     numeric,
  share_percent   numeric,
  amount          numeric,
  already_posted  boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_role             text;
  v_po_id            uuid;
  v_po_status        text;
  v_tot_sales        numeric := 0;
  v_tot_cogs         numeric := 0;
  v_tot_deal_exp     numeric := 0;
  v_file_profit      numeric := 0;
  v_entry_no         text;
  v_now              timestamptz := now();
  v_names            text[];
  v_ratios           numeric[];
  v_owner_accounts   text[] := array[]::text[];
  v_treasury_name    text    := null;
  v_treasury_share   numeric := null;
  v_treasury_amount  numeric := 0;
  v_total            numeric := 0;
  v_running          numeric := 0;
  v_amt              numeric;
  v_acc_code         text;
  v_acc_name         text;
  v_posting_id       uuid;
  v_posted_any       boolean := false;
  i                  int;
  n                  int;
  r                  record;
begin
  -- ══ 1. الصلاحية: المدير فقط، fail-closed ══
  select role into v_role
    from public.user_roles
   where email = auth.jwt() ->> 'email'
     and systems like '%' || p_sys || '%'
   order by case role when 'admin' then 3 when 'employee' then 2 when 'readonly' then 1 else 0 end desc
   limit 1;
  if coalesce(v_role, '') <> 'admin' then
    raise exception 'توزيع أرباح الملف مقصور على المدير';
  end if;

  -- ══ 2. نسب الملّاك الثابتة (قرار مالك 2026-09-22) ══
  -- ⚠️ مطابقة حرفيًا لـTREASURY_OWNER_SPLIT في js/dashboard.js — أي تعديل
  -- هنا يلزمه تعديل مطابق هناك، وإلا المعاينة في الواجهة تكذب على الرقم الحقيقي.
  if p_sys = 'BOX' then
    v_names  := array['علي أسعد ديمو', 'سامر الخلف', 'عبدالله الجاحد', 'عبد الرحيم الجاحد'];
    v_ratios := array[1.0/3, 1.0/3, 1.0/6, 1.0/6];
  elsif p_sys = 'TM' then
    v_names  := array['مازن الخلف', 'عبدالله الجاحد', 'عبد الرحيم الجاحد'];
    v_ratios := array[0.5, 0.25, 0.25];
  else
    raise exception 'نظام غير معروف: %', p_sys;
  end if;
  n := array_length(v_names, 1);

  -- ══ 3. idempotency (فحص سريع قبل القفل) ══
  if exists (
    select 1 from profit_postings
     where system_type = p_sys and file_no = p_file_no
       and kind in ('ترحيل','توزيع أرباح الصندوق') and post_status = 'مُرحَّل'
  ) then
    return query
      select pp.id, pp.ref_no, pp.partner,
             case when pp.kind = 'ترحيل' then 'شريك دائم' else 'مالك' end,
             pp.file_profit, pp.share_percent, pp.amount, true
        from profit_postings pp
       where pp.system_type = p_sys and pp.file_no = p_file_no
         and pp.kind in ('ترحيل','توزيع أرباح الصندوق') and pp.post_status = 'مُرحَّل';
    return;
  end if;

  -- ══ 4. قفل صفّي على سند الشراء ══
  select id, status into v_po_id, v_po_status
    from purchase_orders
   where system_type = p_sys and file_no = p_file_no
   for update;
  if v_po_id is null then
    raise exception 'لا يوجد سند شراء لهذا الملف (%)', p_file_no;
  end if;
  if v_po_status <> 'CLOSED' then
    raise exception 'الملف % لسه مش مقفول (الحالة: %) — التوزيع يتطلب ملفًا مقفولًا', p_file_no, v_po_status;
  end if;

  -- ══ 5. إعادة فحص idempotency بعد القفل (الضمان الحقيقي) ══
  if exists (
    select 1 from profit_postings
     where system_type = p_sys and file_no = p_file_no
       and kind in ('ترحيل','توزيع أرباح الصندوق') and post_status = 'مُرحَّل'
  ) then
    return query
      select pp.id, pp.ref_no, pp.partner,
             case when pp.kind = 'ترحيل' then 'شريك دائم' else 'مالك' end,
             pp.file_profit, pp.share_percent, pp.amount, true
        from profit_postings pp
       where pp.system_type = p_sys and pp.file_no = p_file_no
         and pp.kind in ('ترحيل','توزيع أرباح الصندوق') and pp.post_status = 'مُرحَّل';
    return;
  end if;

  -- ══ 6. ربح الملف — من القيود مباشرة، لا من المتصفح ══
  -- مطابق بالحرف لـcomputeFinancials.byFile[fn] (js/core.js): مبيعات (4xxx:
  -- دائن−مدين) − تكلفة المخزون المباع (5xxx عدا operating_expenses: مدين−دائن)
  -- − مصاريف الصفقة (6xxx مدين>0 وref_table='expenses').
  -- ✅ مصروف العمولة (5100/1300) داخل في الشق التاني تلقائيًا ⇒ الربح هنا
  -- صافٍ بعد العمولة قبل أي توزيع، بلا أي حساب إضافي.
  select
    coalesce(sum(case when account_code like '4%' then cr_amount - dr_amount else 0 end), 0),
    coalesce(sum(case when account_code like '5%' and ref_table <> 'operating_expenses' then dr_amount - cr_amount else 0 end), 0),
    coalesce(sum(case when account_code like '6%' and dr_amount > 0 and ref_table = 'expenses' then dr_amount else 0 end), 0)
    into v_tot_sales, v_tot_cogs, v_tot_deal_exp
    from journal_entries
   where system_type = p_sys and file_no = p_file_no and post_status = 'posted';

  v_file_profit := v_tot_sales - v_tot_cogs - v_tot_deal_exp;

  if v_file_profit = 0 then
    raise exception 'ربح الملف % = صفر — لا يوجد ما يُوزَّع', p_file_no;
  end if;

  v_entry_no := next_je_no(p_sys);

  -- ══ 7. المرور على شركاء الملف ══
  for r in
    select btrim(partner) as partner, share_percent
      from partners_master
     where system_type = p_sys and file_no = p_file_no
     order by partner
  loop
    if is_treasury_name(r.partner) then
      -- الخزينة: تُحجَز للتوزيع على الملّاك في الخطوة 8 (قد تتكرر نظريًا؟ لا —
      -- الخزينة صف واحد لكل ملف؛ لو اتكررت نجمع حصصها بدل ما نتجاهل الزيادة)
      v_treasury_name  := r.partner;
      v_treasury_share := coalesce(v_treasury_share, 0) + r.share_percent;

    elsif is_permanent_partner(p_sys, r.partner) then
      -- شريك دائم مُسمَّى: نصيبه يُرحَّل لحسابه هو
      v_amt := round(v_file_profit * r.share_percent / 100.0, 2);
      if v_amt <> 0 then
        select account_code into v_acc_code
          from partner_account_links
         where system_type = p_sys and partner_name = r.partner;
        if v_acc_code is null then
          raise exception 'الشريك الدائم "%" ليس له حساب مربوط في partner_account_links', r.partner;
        end if;
        select account_name into v_acc_name
          from chart_of_accounts
         where system_type = p_sys and account_code = v_acc_code;

        v_posting_id := gen_random_uuid();
        insert into profit_postings
          (id, system_type, file_no, partner, kind, share_percent, file_profit, amount,
           post_date, ref_no, created_by)
        values
          (v_posting_id, p_sys, p_file_no, r.partner, 'ترحيل', r.share_percent, v_file_profit, v_amt,
           current_date, v_entry_no, auth.jwt() ->> 'email');

        if v_amt > 0 then
          insert into journal_entries
            (system_type, entry_no, entry_date, account_code, account_name, contact_name,
             dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
          values
            (p_sys, v_entry_no, current_date, v_acc_code, v_acc_name, r.partner,
             0, v_amt, 'ترحيل ربح ملف ' || p_file_no || ' — ' || r.partner, 'profit_postings', v_entry_no, p_file_no, 'posted', v_now);
        else
          insert into journal_entries
            (system_type, entry_no, entry_date, account_code, account_name, contact_name,
             dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
          values
            (p_sys, v_entry_no, current_date, v_acc_code, v_acc_name, r.partner,
             abs(v_amt), 0, 'ترحيل خسارة ملف ' || p_file_no || ' — ' || r.partner, 'profit_postings', v_entry_no, p_file_no, 'posted', v_now);
        end if;

        v_total      := v_total + v_amt;
        v_posted_any := true;
      end if;

    else
      -- شريك خارجي (أو غير مُصنَّف): **لا يُرحَّل له شيء** — راجع التعليق
      -- أعلى الملف. نصيبه يفضل في 3200 ويُسوَّى بآليته الحالية.
      null;
    end if;
  end loop;

  -- ══ 8. نصيب الخزينة موزَّعًا على الملّاك ══
  if v_treasury_name is not null then
    v_treasury_amount := round(v_file_profit * v_treasury_share / 100.0, 2);
    if v_treasury_amount <> 0 then
      -- حسابات الملّاك لازم تكون موجودة قبل أي كتابة (fail-closed)
      v_owner_accounts := array[]::text[];
      for i in 1..n loop
        select account_code into v_acc_code
          from partner_account_links
         where system_type = p_sys and partner_name = v_names[i];
        if v_acc_code is null then
          raise exception 'المالك "%" ليس له حساب مربوط في partner_account_links (النظام %)', v_names[i], p_sys;
        end if;
        v_owner_accounts := array_append(v_owner_accounts, v_acc_code);
      end loop;

      v_running := 0;
      for i in 1..n loop
        -- الأخير بياخد الباقي بالضبط ⇒ يمتص فرق التقريب بلا انحراف قرش
        if i < n then
          v_amt     := round(v_treasury_amount * v_ratios[i], 2);
          v_running := v_running + v_amt;
        else
          v_amt := v_treasury_amount - v_running;
        end if;

        v_acc_code := v_owner_accounts[i];
        select account_name into v_acc_name
          from chart_of_accounts
         where system_type = p_sys and account_code = v_acc_code;

        v_posting_id := gen_random_uuid();
        insert into profit_postings
          (id, system_type, file_no, partner, kind, share_percent, file_profit, amount,
           post_date, ref_no, created_by)
        values
          (v_posting_id, p_sys, p_file_no, v_names[i], 'توزيع أرباح الصندوق',
           round(v_ratios[i] * 100, 4), v_file_profit, v_amt,
           current_date, v_entry_no, auth.jwt() ->> 'email');

        if v_amt >= 0 then
          insert into journal_entries
            (system_type, entry_no, entry_date, account_code, account_name, contact_name,
             dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
          values
            (p_sys, v_entry_no, current_date, v_acc_code, v_acc_name, v_names[i],
             0, v_amt, 'توزيع ربح صندوق ملف ' || p_file_no || ' — ' || v_names[i], 'profit_postings', v_entry_no, p_file_no, 'posted', v_now);
        else
          insert into journal_entries
            (system_type, entry_no, entry_date, account_code, account_name, contact_name,
             dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
          values
            (p_sys, v_entry_no, current_date, v_acc_code, v_acc_name, v_names[i],
             abs(v_amt), 0, 'توزيع خسارة صندوق ملف ' || p_file_no || ' — ' || v_names[i], 'profit_postings', v_entry_no, p_file_no, 'posted', v_now);
        end if;
      end loop;

      v_total      := v_total + v_treasury_amount;
      v_posted_any := true;
    end if;
  end if;

  -- ══ 9. لا مستفيد أصلًا ⇒ رفض صريح، لا قيد نصفي ولا صمت ══
  if not v_posted_any then
    raise exception 'ملف % ليس فيه شريك دائم ولا خزينة — لا يوجد ما يُرحَّل (الشريك الخارجي مستحقّه يُسوَّى بآليته الحالية لا بالترحيل)', p_file_no;
  end if;

  -- ══ 10. الطرف المقابل: سطر واحد على 3200 بمجموع ما رُحِّل فعلًا ══
  -- ⚠️ **مش بكامل ربح الملف**: نصيب الشريك الخارجي لم يُرحَّل، فيفضل في 3200.
  -- المجموع هنا = مجموع السطور المقابلة بالضبط ⇒ القيد متوازن حتميًّا.
  if v_total > 0 then
    insert into journal_entries
      (system_type, entry_no, entry_date, account_code, account_name, contact_name,
       dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
    values
      (p_sys, v_entry_no, current_date, '3200', 'الأرباح المبقاة', null,
       v_total, 0, 'توزيع أرباح ملف ' || p_file_no, 'profit_postings', v_entry_no, p_file_no, 'posted', v_now);
  else
    insert into journal_entries
      (system_type, entry_no, entry_date, account_code, account_name, contact_name,
       dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
    values
      (p_sys, v_entry_no, current_date, '3200', 'الأرباح المبقاة', null,
       0, abs(v_total), 'توزيع خسائر ملف ' || p_file_no, 'profit_postings', v_entry_no, p_file_no, 'posted', v_now);
  end if;

  return query
    select pp.id, pp.ref_no, pp.partner,
           case when pp.kind = 'ترحيل' then 'شريك دائم' else 'مالك' end,
           pp.file_profit, pp.share_percent, pp.amount, false
      from profit_postings pp
     where pp.system_type = p_sys and pp.file_no = p_file_no and pp.ref_no = v_entry_no;
end;
$fn$;

grant execute on function post_file_profit_all(text, text) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 2) حذف الدالتين القديمتين — مصدر حقيقة واحد لا ثلاثة
-- ════════════════════════════════════════════════════════════
-- الاتنان ما اتنادوش ولا مرة بنجاح (صفر صف في profit_postings)، ومحدش في
-- الواجهة بينده عليهم بعد هذا التعديل. تركهم = بابان خلفيان: الأول بيرحّل
-- نصيب شريك واحد بلا الباقي (يكسر ذرّية العملية)، والتاني لسه شايل منطق
-- العمولة الملغى. الحذف مقصود وصريح.
drop function if exists post_profit_for_file(text, text, text);
drop function if exists post_treasury_profit_for_file(text, text, text, jsonb);

-- ════════════════════════════════════════════════════════════
-- 3) تحقق بعد التنفيذ (قراءة فقط)
-- ════════════════════════════════════════════════════════════
-- الدالة الجديدة موجودة والقديمتان اختفتا:
-- select proname, pg_get_function_identity_arguments(oid) from pg_proc
--  where proname in ('post_file_profit_all','post_profit_for_file','post_treasury_profit_for_file');
-- المتوقَّع: صف واحد فقط — post_file_profit_all(text, text)
--
-- لا شيء رُحِّل بعد:
-- select kind, count(*) from profit_postings group by kind;   -- المتوقَّع صفر صفوف
