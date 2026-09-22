-- نفّذ هذا في Supabase SQL Editor مرة واحدة. آمن يتكرر تشغيله (create or
-- replace / drop-if-exists في كل مكان). يعتمد على sql/m6_profit_postings_phase1.sql
-- (لازم يكون شغّال بالفعل قبل هذا الملف — جدول profit_postings وis_treasury_name
-- وis_permanent_partner وnext_je_no كلهم مُستخدَمون هنا).
--
-- ت٢ (توزيع ربح الصندوق على الملّاك) — بقرار مالك صريح 2026-09-22، بعد م٦
-- المرحلة الأولى (ترحيل ربح شريك دائم مُسمَّى لملفه هو). الفرق الجوهري هنا:
-- المستفيد مش شخص واحد — نصيب "الصندوق"/"صندوق الترانزيت" من ربح الملف
-- يتوزّع في **قيد واحد** على عدة مستفيدين معًا: عمولات اختيارية (مبلغ يُدخَل
-- وقت الترحيل، مش نسبة مبرمجة — أي حساب موجود بالفعل في شجرة 2400، زي مشاري
-- العميري BOX-2410 أو طلال العميري TM-2404) ثم الباقي على الملّاك الأربعة/
-- الثلاثة بنسب ثابتة (قرار مالك 2026-09-22، مبني على docs/PLAN-partner-accounts-2026-09-17.md
-- قسم ت٢ + إجابتي السؤالين المفتوحين س١/س٢):
--   BOX: علي أسعد ديمو ⅓ · سامر الخلف ⅓ · عبدالله الجاحد ⅙ · عبد الرحيم الجاحد ⅙
--   TM:  مازن الخلف ½ · عبدالله الجاحد ¼ · عبد الرحيم الجاحد ¼
-- (الأخوان عبدالله وعبد الرحيم: حسابان منفصلان، الثلث/النصف بينهما بالتساوي —
-- س١. العمولات تُخصَم من نصيب الصندوق قبل ما الباقي يتوزّع على الأربعة — س٢.)
--
-- ════════════════════════════════════════════════════════════
-- 0) تمديد جدول profit_postings — نوع "ترحيل" جديد لا يصطدم مع ترحيل الشريك
-- الفردي (م٦ فيز١): مازن مثلاً ممكن يستحق قيدين منفصلين على نفس الملف —
-- نصيبه الشخصي (kind='ترحيل') ونصيبه كأحد الأربعة من توزيع الصندوق
-- (kind='توزيع أرباح الصندوق') — لازم الفهرس الفريد يفرّق بينهما بالنوع لا
-- يرفض التاني باعتباره تكرارًا.
-- ════════════════════════════════════════════════════════════
alter table profit_postings drop constraint if exists profit_postings_kind_check;
alter table profit_postings add constraint profit_postings_kind_check
  check (kind in ('ترحيل','تسوية','أرباح عامة','توزيع أرباح الصندوق'));

alter table profit_postings drop constraint if exists chk_pp_file_link;
alter table profit_postings add constraint chk_pp_file_link check (
  (kind in ('ترحيل','تسوية','توزيع أرباح الصندوق') and file_no is not null)
  or (kind = 'أرباح عامة' and file_no is null)
);

drop index if exists uniq_profit_posting_once;
create unique index uniq_profit_posting_once
  on profit_postings (system_type, file_no, partner_key, kind)
  where kind in ('ترحيل','توزيع أرباح الصندوق') and post_status = 'مُرحَّل';
-- ⚠️ التغيير الوحيد عن فيز١: partner_key بقى مربوطًا بالـkind كمان، مش بس
-- بالملف/الشريك. صف "ترحيل" (مازن نصيبه الشخصي) وصف "توزيع أرباح الصندوق"
-- (مازن نصيبه من الصندوق) على *نفس* الملف الآن مسموحان معًا — وده المطلوب
-- بالضبط. لسه ممنوع تكرار نفس الـ(ملف×شريك×نوع) مرتين.

-- ════════════════════════════════════════════════════════════
-- 1) دالة التوزيع
-- ════════════════════════════════════════════════════════════
-- نمط مطابق لـpost_profit_for_file (فيز١): صف/صفوف السجل + سطور القيد معًا
-- في معاملة واحدة، قفل صفّي على سند الشراء، idempotency قبل/بعد القفل،
-- الحساب من القيود مباشرة على السيرفر (نفس التبرير المذكور في فيز١: رقم غلط
-- هنا يبقى تاريخ محاسبي دائم بلا تحقق مستقل، فمينفعش يُستقبَل من المتصفح).
--
-- p_commissions: jsonb array، كل عنصر {"account_code":"2410","amount":500}.
-- []  أو null = بلا عمولات، كل نصيب الصندوق يتوزّع على الملّاك مباشرة.
create or replace function post_treasury_profit_for_file(
  p_sys          text,
  p_file_no      text,
  p_partner      text,
  p_commissions  jsonb default '[]'::jsonb
) returns table(
  posting_id       uuid,
  entry_no         text,
  recipient        text,
  recipient_kind   text,  -- 'مالك' أو 'عمولة'
  file_profit      numeric,
  share_percent    numeric,
  amount           numeric,
  already_posted   boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role             text;
  v_partner_trimmed  text := btrim(p_partner);
  v_po_id            uuid;
  v_po_status        text;
  v_share_percent    numeric;
  v_tot_sales        numeric := 0;
  v_tot_cogs         numeric := 0;
  v_tot_deal_exp     numeric := 0;
  v_file_profit      numeric := 0;
  v_treasury_amount  numeric := 0;
  v_commission_sum   numeric := 0;
  v_remaining        numeric := 0;
  v_entry_no         text;
  v_now              timestamptz := now();
  v_names            text[];
  v_ratios           numeric[];
  v_owner_accounts   text[] := array[]::text[];
  v_running          numeric := 0;
  v_amt              numeric;
  v_acc_code         text;
  v_acc_name         text;
  v_comm             jsonb;
  v_comm_acc         text;
  v_comm_amt         numeric;
  v_comm_partner     text;
  v_comm_acc_name    text;
  v_used_comm_accs   text[] := array[]::text[];
  i                  int;
  n                  int;
begin
  -- ══ 1. الصلاحية: المدير فقط، fail-closed ══
  select role into v_role
    from public.user_roles
   where email = auth.jwt() ->> 'email'
     and systems like '%' || p_sys || '%'
   order by case role when 'admin' then 3 when 'employee' then 2 when 'readonly' then 1 else 0 end desc
   limit 1;
  if coalesce(v_role, '') <> 'admin' then
    raise exception 'توزيع ربح الصندوق مقصور على المدير';
  end if;

  -- ══ 2. الدالة دي حصرًا للخزينة — عكس post_profit_for_file بالضبط ══
  if not is_treasury_name(v_partner_trimmed) then
    raise exception 'هذه الدالة مخصّصة لتوزيع ربح الصندوق/صندوق الترانزيت فقط — الشريك "%" ليس الخزينة، استخدم post_profit_for_file', v_partner_trimmed;
  end if;

  -- ══ 3. جدول النسب الثابتة (قرار مالك 2026-09-22) ══
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

  -- ══ 4. idempotency (فحص سريع قبل القفل) — أي صف "توزيع أرباح الصندوق" سابق على نفس الملف ══
  if exists (
    select 1 from profit_postings
     where system_type = p_sys and file_no = p_file_no
       and kind = 'توزيع أرباح الصندوق' and post_status = 'مُرحَّل'
  ) then
    return query
      select pp.id, pp.ref_no, pp.partner,
             case when pp.partner = any(v_names) then 'مالك' else 'عمولة' end,
             pp.file_profit, pp.share_percent, pp.amount, true
        from profit_postings pp
       where pp.system_type = p_sys and pp.file_no = p_file_no
         and pp.kind = 'توزيع أرباح الصندوق' and pp.post_status = 'مُرحَّل';
    return;
  end if;

  -- ══ 5. قفل صفّي على سند الشراء ══
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

  -- ══ 6. إعادة فحص idempotency بعد القفل (الضمان الحقيقي) ══
  if exists (
    select 1 from profit_postings
     where system_type = p_sys and file_no = p_file_no
       and kind = 'توزيع أرباح الصندوق' and post_status = 'مُرحَّل'
  ) then
    return query
      select pp.id, pp.ref_no, pp.partner,
             case when pp.partner = any(v_names) then 'مالك' else 'عمولة' end,
             pp.file_profit, pp.share_percent, pp.amount, true
        from profit_postings pp
       where pp.system_type = p_sys and pp.file_no = p_file_no
         and pp.kind = 'توزيع أرباح الصندوق' and pp.post_status = 'مُرحَّل';
    return;
  end if;

  -- ══ 7. نصيب الصندوق في الملف ══
  select share_percent into v_share_percent
    from partners_master
   where system_type = p_sys and file_no = p_file_no and partner = v_partner_trimmed
   limit 1;
  if v_share_percent is null then
    raise exception 'الخزينة "%" غير مسجَّلة ضمن شركاء الملف %', v_partner_trimmed, p_file_no;
  end if;

  -- ══ 8. ربح الملف — من القيود مباشرة (نفس صيغة post_profit_for_file بالحرف) ══
  select
    coalesce(sum(case when account_code like '4%' then cr_amount - dr_amount else 0 end), 0),
    coalesce(sum(case when account_code like '5%' and ref_table <> 'operating_expenses' then dr_amount - cr_amount else 0 end), 0),
    coalesce(sum(case when account_code like '6%' and dr_amount > 0 and ref_table = 'expenses' then dr_amount else 0 end), 0)
    into v_tot_sales, v_tot_cogs, v_tot_deal_exp
    from journal_entries
   where system_type = p_sys and file_no = p_file_no and post_status = 'posted';

  v_file_profit     := v_tot_sales - v_tot_cogs - v_tot_deal_exp;
  v_treasury_amount := round(v_file_profit * v_share_percent / 100.0, 2);

  if v_treasury_amount = 0 then
    raise exception 'نصيب الصندوق من ربح الملف % = صفر — لا يوجد ما يُوزَّع', p_file_no;
  end if;

  -- ══ 9. العمولات — تُقبل فقط لو نصيب الصندوق ربح موجب ══
  if p_commissions is not null and jsonb_array_length(p_commissions) > 0 then
    if v_treasury_amount <= 0 then
      raise exception 'لا يمكن خصم عمولات من ملف خسر فيه الصندوق أو ربحه صفر';
    end if;
    for v_comm in select * from jsonb_array_elements(p_commissions)
    loop
      v_comm_acc := btrim(v_comm ->> 'account_code');
      v_comm_amt := round((v_comm ->> 'amount')::numeric, 2);
      if v_comm_acc is null or v_comm_acc = '' then
        raise exception 'عمولة بلا رقم حساب';
      end if;
      if v_comm_amt is null or v_comm_amt <= 0 then
        raise exception 'مبلغ عمولة غير صالح لحساب %', v_comm_acc;
      end if;
      if v_comm_acc = any(v_used_comm_accs) then
        raise exception 'الحساب % مكرَّر في قائمة العمولات', v_comm_acc;
      end if;
      select partner_name into v_comm_partner
        from partner_account_links
       where system_type = p_sys and account_code = v_comm_acc;
      if v_comm_partner is null then
        raise exception 'الحساب % غير موجود في partner_account_links (النظام %)', v_comm_acc, p_sys;
      end if;
      if is_treasury_name(v_comm_partner) then
        raise exception 'حساب العمولة % يخص الخزينة نفسها (حساب تاريخي) — غير مسموح كمستفيد عمولة', v_comm_acc;
      end if;
      v_used_comm_accs := array_append(v_used_comm_accs, v_comm_acc);
      v_commission_sum := v_commission_sum + v_comm_amt;
    end loop;
    if v_commission_sum > v_treasury_amount then
      raise exception 'إجمالي العمولات (%) أكبر من نصيب الصندوق (%)', v_commission_sum, v_treasury_amount;
    end if;
  end if;

  v_remaining := v_treasury_amount - v_commission_sum;

  -- ══ 10. حسابات الملّاك الأربعة/الثلاثة — لازم تكون موجودة بالفعل ══
  for i in 1..n loop
    select account_code into v_acc_code
      from partner_account_links
     where system_type = p_sys and partner_name = v_names[i];
    if v_acc_code is null then
      raise exception 'المالك "%" ليس له حساب مربوط في partner_account_links (النظام %)', v_names[i], p_sys;
    end if;
    v_owner_accounts := array_append(v_owner_accounts, v_acc_code);
  end loop;

  -- ══ 11. رفض تصادم: حساب عمولة يطابق حساب أحد الملّاك الأربعة ══
  if v_commission_sum > 0 then
    for i in 1..array_length(v_used_comm_accs, 1) loop
      if v_used_comm_accs[i] = any(v_owner_accounts) then
        raise exception 'حساب العمولة % هو نفسه حساب أحد الملّاك — غير مسموح', v_used_comm_accs[i];
      end if;
    end loop;
  end if;

  -- ══ 12. الكتابة الذرّية ══
  v_entry_no := next_je_no(p_sys);

  -- 3200 (مدين لو ربح، دائن لو خسارة) — بكامل نصيب الصندوق
  if v_treasury_amount > 0 then
    insert into journal_entries
      (system_type, entry_no, entry_date, account_code, account_name, contact_name,
       dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
    values
      (p_sys, v_entry_no, current_date, '3200', 'الأرباح المبقاة', null,
       v_treasury_amount, 0, 'توزيع ربح صندوق ملف ' || p_file_no, 'profit_postings', v_entry_no, p_file_no, 'posted', v_now);
  else
    insert into journal_entries
      (system_type, entry_no, entry_date, account_code, account_name, contact_name,
       dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
    values
      (p_sys, v_entry_no, current_date, '3200', 'الأرباح المبقاة', null,
       0, abs(v_treasury_amount), 'توزيع خسارة صندوق ملف ' || p_file_no, 'profit_postings', v_entry_no, p_file_no, 'posted', v_now);
  end if;

  -- سطر لكل عمولة (تُخصَم فقط لو ربح موجب — مُتحقَّق فوق)
  if v_commission_sum > 0 then
    for v_comm in select * from jsonb_array_elements(p_commissions)
    loop
      v_comm_acc := btrim(v_comm ->> 'account_code');
      v_comm_amt := round((v_comm ->> 'amount')::numeric, 2);
      select partner_name into v_comm_partner
        from partner_account_links
       where system_type = p_sys and account_code = v_comm_acc;
      if v_comm_partner is null then
        raise exception 'الحساب % غير موجود في partner_account_links (النظام %)', v_comm_acc, p_sys;
      end if;
      select account_name into v_comm_acc_name
        from chart_of_accounts
       where system_type = p_sys and account_code = v_comm_acc;

      insert into journal_entries
        (system_type, entry_no, entry_date, account_code, account_name, contact_name,
         dr_amount, cr_amount, description, ref_table, ref_id, file_no, post_status, posted_at)
      values
        (p_sys, v_entry_no, current_date, v_comm_acc, v_comm_acc_name, v_comm_partner,
         0, v_comm_amt, 'عمولة (' || v_comm_partner || ') من ربح صندوق ملف ' || p_file_no, 'profit_postings', v_entry_no, p_file_no, 'posted', v_now);

      insert into profit_postings
        (id, system_type, file_no, partner, kind, share_percent, file_profit, amount,
         post_date, ref_no, created_by)
      values
        (gen_random_uuid(), p_sys, p_file_no, v_comm_partner, 'توزيع أرباح الصندوق', null, v_file_profit, v_comm_amt,
         current_date, v_entry_no, auth.jwt() ->> 'email');
    end loop;
  end if;

  -- سطر لكل مالك — الأخير بياخد الباقي بالضبط (يمتص فروق التقريب، بلا انحراف قرش)
  v_running := 0;
  for i in 1..n loop
    if i < n then
      v_amt := round(v_remaining * v_ratios[i], 2);
      v_running := v_running + v_amt;
    else
      v_amt := v_remaining - v_running;
    end if;

    v_acc_code := v_owner_accounts[i];
    select account_name into v_acc_name
      from chart_of_accounts
     where system_type = p_sys and account_code = v_acc_code;

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

    insert into profit_postings
      (id, system_type, file_no, partner, kind, share_percent, file_profit, amount,
       post_date, ref_no, created_by)
    values
      (gen_random_uuid(), p_sys, p_file_no, v_names[i], 'توزيع أرباح الصندوق', round(v_ratios[i]*100, 4), v_file_profit, v_amt,
       current_date, v_entry_no, auth.jwt() ->> 'email');
  end loop;

  return query
    select pp.id, pp.ref_no, pp.partner,
           case when pp.partner = any(v_names) then 'مالك' else 'عمولة' end,
           pp.file_profit, pp.share_percent, pp.amount, false
      from profit_postings pp
     where pp.system_type = p_sys and pp.file_no = p_file_no
       and pp.kind = 'توزيع أرباح الصندوق' and pp.ref_no = v_entry_no;
end;
$$;

grant execute on function post_treasury_profit_for_file(text, text, text, jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 2) تحقق بعد التنفيذ (قراءة فقط)
-- ════════════════════════════════════════════════════════════
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'profit_postings'::regclass;
-- select indexname, indexdef from pg_indexes where tablename='profit_postings';
-- select count(*) from profit_postings where kind='توزيع أرباح الصندوق'; -- المتوقَّع 0 قبل أي توزيع فعلي
