-- نفّذه إنت في Supabase SQL Editor. آمن يتكرر تشغيله (create or replace).
--
-- ════════════════════════════════════════════════════════════
-- باج مؤكَّد من المالك (معاينة TM-084، 2026-09-22) — راجع نص المالك بالحرف:
-- "أنا ما قولتش إنه بياخد 50+50 من حصة الاخوين. أنا قلت إنه 50 والاخوين 50."
-- ════════════════════════════════════════════════════════════
-- `post_file_profit_all` (sql/m6_unified_file_profit_distribution.sql، خطوة
-- ٨) كانت بتوزّع حصة الصندوق على الملّاك الأربعة/الثلاثة (v_names) **بلا أي
-- استبعاد** لمن يكون أصلًا شريكًا مباشرًا مُسمَّى على نفس الملف. مازن في
-- TM-084 شريك مباشر 50% ⇒ كان هياخد نصيبه المباشر (478) **زائد** نصيب تاني
-- كأحد الملّاك من حصة الصندوق (239 = 50% من نصف حصة الصندوق 478) = 717 من
-- 956 — بدل الصح 478 بس. عبدالله وعبد الرحيم كانوا هياخدوا 119.5 لكل واحد
-- بدل 239 (نصف حصة الصندوق بينهم بالتساوي بعد استبعاد مازن).
--
-- **الأثر: كل ملفات TM المقفولة اللي مازن شريك مباشر عليها** (أغلبها) —
-- ومبدئيًا أي ملف BOX لو أحد الملّاك الأربعة صار شريكًا مباشرًا عليه مستقبلًا.
--
-- **القاعدة المُصحَّحة:** أي مالك (من v_names) موجود أصلًا كشريك مُسمَّى على
-- نفس الملف يُستبعَد من توزيع حصة الصندوق، وحصة الصندوق تتوزّع بس على
-- الباقين بنسبتهم **النسبية لبعض** (مش نسبتهم الأصلية من الإجمالي) — مثال
-- TM-084: عبدالله وعبد الرحيم كانا ¼+¼ من الإجمالي، بعد استبعاد مازن (½)
-- الباقي = ½ الإجمالي يتوزّع بينهم بنسبة ¼:¼ النسبية = 50%:50% لكل واحد.
--
-- ⚠️ **صفر ترحيل فعلي حصل حتى الآن** (TM-084 معاينة بس، لم يُضغَط "توزّع
-- الآن") — فهذا `create or replace` بلا أي حاجة لتصحيح بيانات موجودة.

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
  -- ✅ جديد — تتبّع الملّاك اللي أخدوا نصيبهم المباشر بالفعل كشركاء مُسمَّين
  v_direct_owners    text[] := array[]::text[];
  v_dist_names       text[];
  v_dist_ratios      numeric[];
  v_ratio_sum        numeric;
  m                  int;
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
      v_treasury_name  := r.partner;
      v_treasury_share := coalesce(v_treasury_share, 0) + r.share_percent;

    elsif is_permanent_partner(p_sys, r.partner) then
      -- شريك دائم مُسمَّى: نصيبه يُرحَّل لحسابه هو
      -- ✅ جديد: لو ده أصلًا أحد الملّاك الأربعة/الثلاثة (v_names)، سجّله
      -- عشان يُستبعَد من توزيع حصة الصندوق تحت (خطوة ٨) — مش هياخد مرتين
      if r.partner = any(v_names) then
        v_direct_owners := array_append(v_direct_owners, r.partner);
      end if;

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
      -- شريك خارجي (أو غير مُصنَّف): لا يُرحَّل له شيء
      null;
    end if;
  end loop;

  -- ══ 8. نصيب الخزينة موزَّعًا على الملّاك — بعد استبعاد اللي أخدوا نصيبهم
  -- المباشر بالفعل (v_direct_owners، خطوة ٧)، بنسبتهم النسبية لبعض ══
  if v_treasury_name is not null then
    v_treasury_amount := round(v_file_profit * v_treasury_share / 100.0, 2);
    if v_treasury_amount <> 0 then
      -- ✅ جديد — فلترة v_names/v_ratios: استبعاد أي اسم موجود في v_direct_owners
      v_dist_names  := array[]::text[];
      v_dist_ratios := array[]::numeric[];
      for i in 1..n loop
        if not (v_names[i] = any(v_direct_owners)) then
          v_dist_names  := array_append(v_dist_names, v_names[i]);
          v_dist_ratios := array_append(v_dist_ratios, v_ratios[i]);
        end if;
      end loop;
      m := array_length(v_dist_names, 1);

      -- كل الملّاك أخدوا نصيبهم المباشر بالفعل (حالة نادرة) ⇒ حصة الصندوق
      -- تفضل في 3200 بلا توزيع إضافي، زي مستحق الشريك الخارجي بالضبط
      if m is null or m = 0 then
        null;
      else
        -- إعادة توزيع النسب على الباقين ("نسبتهم النسبية لبعض" — قرار مالك صريح)
        v_ratio_sum := 0;
        for i in 1..m loop v_ratio_sum := v_ratio_sum + v_dist_ratios[i]; end loop;

        -- حسابات الملّاك الباقين لازم تكون موجودة قبل أي كتابة (fail-closed)
        v_owner_accounts := array[]::text[];
        for i in 1..m loop
          select account_code into v_acc_code
            from partner_account_links
           where system_type = p_sys and partner_name = v_dist_names[i];
          if v_acc_code is null then
            raise exception 'المالك "%" ليس له حساب مربوط في partner_account_links (النظام %)', v_dist_names[i], p_sys;
          end if;
          v_owner_accounts := array_append(v_owner_accounts, v_acc_code);
        end loop;

        v_running := 0;
        for i in 1..m loop
          -- الأخير بياخد الباقي بالضبط ⇒ يمتص فرق التقريب بلا انحراف قرش
          if i < m then
            v_amt     := round(v_treasury_amount * (v_dist_ratios[i] / v_ratio_sum), 2);
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
            (v_posting_id, p_sys, p_file_no, v_dist_names[i], 'توزيع أرباح الصندوق',
             round((v_dist_ratios[i] / v_ratio_sum) * 100, 4), v_file_profit, v_amt,
             current_date, v_entry_no, auth.jwt() ->> 'email');

          if v_amt >= 0 then
            insert into journal_entries
              (system_type, entry_no, entry_date, account_code, account_name, contact_name,
               dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
            values
              (p_sys, v_entry_no, current_date, v_acc_code, v_acc_name, v_dist_names[i],
               0, v_amt, 'توزيع ربح صندوق ملف ' || p_file_no || ' — ' || v_dist_names[i], 'profit_postings', v_entry_no, p_file_no, 'posted', v_now);
          else
            insert into journal_entries
              (system_type, entry_no, entry_date, account_code, account_name, contact_name,
               dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
            values
              (p_sys, v_entry_no, current_date, v_acc_code, v_acc_name, v_dist_names[i],
               abs(v_amt), 0, 'توزيع خسارة صندوق ملف ' || p_file_no || ' — ' || v_dist_names[i], 'profit_postings', v_entry_no, p_file_no, 'posted', v_now);
          end if;
        end loop;

        v_total      := v_total + v_treasury_amount;
        v_posted_any := true;
      end if;
    end if;
  end if;

  -- ══ 9. لا مستفيد أصلًا ⇒ رفض صريح، لا قيد نصفي ولا صمت ══
  if not v_posted_any then
    raise exception 'ملف % ليس فيه شريك دائم ولا خزينة — لا يوجد ما يُرحَّل (الشريك الخارجي مستحقّه يُسوَّى بآليته الحالية لا بالترحيل)', p_file_no;
  end if;

  -- ══ 10. الطرف المقابل: سطر واحد على 3200 بمجموع ما رُحِّل فعلًا ══
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
-- تحقق بعد التنفيذ (قراءة فقط، معاينة بلا كتابة — الدالة لسه بترفض في
-- خطوة الصلاحية لو المستخدم مش مدير، لكن كمدير هتقفل فعليًا لو الملف
-- بلا ترحيل سابق. استخدم select فقط، لا استدعاء فعلي، للتحقق من التعريف):
-- select proname, prosrc from pg_proc where proname = 'post_file_profit_all';
-- -- تأكَّد إن 'v_direct_owners' و'v_dist_names' ظاهرين في النص
