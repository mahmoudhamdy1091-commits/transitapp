-- ════════════════════════════════════════════════════════════
-- D-1 — المبالغ الأربعة من حساب مازن (2401) لفلوس الشركة (مسودة — **المالك بس يشغّلها**)
-- قرار المالك 2026-09-28: «المبالغ اللي حصل فيها أخطاء تتحذف من حساب مازن أصلًا، هي فلوس
-- شركة، متظهرش في حساب مازن». المعنى المتفق عليه: الدفعات والمصاريف ما تتمسحش (اتدفعت
-- فعلًا من فلوس الشركة)، بس اسم مازن يتشال منها. راجع docs/PLAN-partner-statements-fix-2026-09-23.md
-- (D-1 وقسم ٢-د).
--
-- السطور (اتقرت حيًّا 2026-09-28، كلها posted وreversed_by فاضي، cr على 2401 باسم مازن):
--   24881  JE-2026-01675  TM-097           دفعة PMT-TM-097-P2            4,620   (ref payments f21438b5-d553-498f-9b16-2c671c23a2e1)
--   24915  JE-2026-01688  TM-005 147قديم   دفعة PMT-TM-005 147قديم-P2    1,888   (ref payments 6dca979d-6bce-4254-925d-1a8a1c9072f0)
--   24929  JE-2026-01691  TM-003 146 قديم  مصروف EXP-TM-003146-001 (نصه)  1,427   (ref expenses f9063a08-15cd-4ce7-8c86-1b48a1a7089f)
--   24941  JE-2026-01695  TM-002 145قديم   مصروف EXP-TM-002145-001 (نصه)  1,427   (ref expenses a2b2531b-b43f-4b6a-a11b-cb3fc221a0aa)
--   الإجمالي 9,362 ⇒ 2401 من 54,227 مدين إلى 63,589 مدين (Global −63,589).
--
-- اللي بيتعمل (بنفس طريقة m4b: UPDATE للسطر نفسه، والربط بالسجل يفضل، ومن غير قيود جديدة):
--   ١) السطور الأربعة: account_code ← v_target، وaccount_name بتاعه، وcontact_name ← null
--      (عشان مايظهروش في كشف مازن الشامل ولا كشف الجهة)، وأي «مازن الخلف» في وصف القيود
--      الأربعة (كل سطورها) يتشال.
--   ٢) السجلات: payer في الدفعتين، وpaid_by في المصروفين ← «صندوق الترانزيت»، وpaid_by_split ← null.
--   ٣) نسخة احتياطية كاملة قبل أي تغيير (d1_backup_2026_09_28) + سطر audit_log لكل تغيير.
--
-- ✅ الحساب (قرار المالك 2026-09-28: «سجّلهم على البنك»): v_target = '1120' «البنك» — الاسم
--    زي كل سطور 1120 في TM (645 من 645). والطريقة في الأربعة «تحويل بنكي» ⇒ je_payment/je_expense
--    بيوجّهوا الخزينة لـ1120 أصلًا، فأي تعديل بعد كده يرجّع نفس الحساب — **من غير حارس كود**.
--    ودليل «حوالة بنكية» موجود في ملاحظات الملفات أو وصف المصروفين للأربعة.
-- ════════════════════════════════════════════════════════════

-- ── فحص قبل (قراءة بس) ─────────────────────────────────────
-- 1) السطور الأربعة (المتوقع 4 صفوف، account_code=2401، contact_name=مازن الخلف، reversed_by فاضي):
-- select id, entry_no, account_code, cr_amount, contact_name, ref_table, ref_id, file_no, post_status, reversed_by
--   from journal_entries where id in (24881,24915,24929,24941) order by id;
-- 2) السجلات:
-- select id, file_no, payer, amount, pay_method, post_status from payments
--  where id in ('f21438b5-d553-498f-9b16-2c671c23a2e1','6dca979d-6bce-4254-925d-1a8a1c9072f0');
-- select id, file_no, paid_by, paid_by_split, amount, pay_method, post_status from expenses
--  where id in ('f9063a08-15cd-4ce7-8c86-1b48a1a7089f','a2b2531b-b43f-4b6a-a11b-cb3fc221a0aa');
-- 3) رصيد 2401 (المتوقع 54227):
-- select sum(dr_amount) - sum(cr_amount) from journal_entries
--  where system_type='TM' and account_code='2401' and post_status='posted';

begin;

create table if not exists d1_backup_2026_09_28 (
  kind     text not null,          -- 'je' | 'payment' | 'expense'
  row_id   text not null,
  payload  jsonb not null,
  saved_at timestamptz not null default now()
);
alter table d1_backup_2026_09_28 enable row level security;
revoke all on table d1_backup_2026_09_28 from anon, authenticated;

do $d1$
declare
  v_target      text := '1120'; -- قرار المالك 2026-09-28: «سجّلهم على البنك»
  v_target_name text;
  v_company     text := 'صندوق الترانزيت';
  v_lines       bigint[] := array[24881,24915,24929,24941];
  v_pay_ids     uuid[]   := array['f21438b5-d553-498f-9b16-2c671c23a2e1','6dca979d-6bce-4254-925d-1a8a1c9072f0']::uuid[];
  v_exp_ids     uuid[]   := array['f9063a08-15cd-4ce7-8c86-1b48a1a7089f','a2b2531b-b43f-4b6a-a11b-cb3fc221a0aa']::uuid[];
  v_entries     text[]   := array['JE-2026-01675','JE-2026-01688','JE-2026-01691','JE-2026-01695'];
  v_n           int;
  v_sum         numeric;
  v_user        text := coalesce(auth.jwt() ->> 'email', current_user);
  r             record;
begin
  -- ٠) حماية من التشغيل مرتين
  if exists (select 1 from d1_backup_2026_09_28) then
    raise exception 'D-1 اتشغّل قبل كده (فيه نسخة احتياطية في d1_backup_2026_09_28) — ماتشغّلش تاني. للرجوع شوف آخر الملف.';
  end if;

  -- ٠) اسم الحساب (زي كل سطور 1120 في TM)
  v_target_name := case v_target when '1120' then 'البنك' else null end;
  if v_target_name is null then
    raise exception 'v_target لازم يكون ''1120'' (قرار المالك 2026-09-28)';
  end if;

  -- ٠) حالة السطور زي ما اتقاست بالظبط
  select count(*), coalesce(sum(cr_amount),0) into v_n, v_sum
    from journal_entries
   where id = any(v_lines) and system_type = 'TM' and account_code = '2401'
     and contact_name = 'مازن الخلف' and dr_amount = 0 and cr_amount > 0
     and post_status = 'posted' and reversed_by is null;
  if v_n <> 4 or v_sum <> 9362 then
    raise exception 'المتوقع 4 سطور 2401 نشطة باسم مازن بإجمالي 9,362 — لقيت % سطر بـ% . وقّف وراجع.', v_n, v_sum;
  end if;
  select count(*) into v_n from payments where id = any(v_pay_ids) and payer = 'مازن الخلف' and post_status = 'posted';
  if v_n <> 2 then raise exception 'المتوقع دفعتين الدافع فيهم مازن — لقيت %', v_n; end if;
  select count(*) into v_n from expenses where id = any(v_exp_ids) and post_status = 'posted'
     and paid_by_split::text like '%مازن الخلف%';
  if v_n <> 2 then raise exception 'المتوقع مصروفين فيهم مازن في paid_by_split — لقيت %', v_n; end if;

  -- ١) نسخة احتياطية (كل سطور القيود الأربعة + السجلات)
  insert into d1_backup_2026_09_28(kind, row_id, payload)
    select 'je', j.id::text, to_jsonb(j) from journal_entries j
     where j.system_type = 'TM' and j.entry_no = any(v_entries);
  insert into d1_backup_2026_09_28(kind, row_id, payload)
    select 'payment', p.id::text, to_jsonb(p) from payments p where p.id = any(v_pay_ids);
  insert into d1_backup_2026_09_28(kind, row_id, payload)
    select 'expense', e.id::text, to_jsonb(e) from expenses e where e.id = any(v_exp_ids);

  -- ٢) السطور الأربعة: الحساب + من غير جهة
  for r in select id, entry_no, file_no, cr_amount from journal_entries where id = any(v_lines) order by id loop
    update journal_entries
       set account_code = v_target, account_name = v_target_name, contact_name = null
     where id = r.id;
    insert into audit_log(system_type, action, table_name, file_no, old_value, new_value, notes, user_email)
    values ('TM', 'CORRECT', 'journal_entries', r.file_no,
            '2401 جاري الشريك مازن الخلف / contact=مازن الخلف',
            v_target || ' ' || v_target_name || ' / contact=null',
            'D-1 (قرار المالك 2026-09-28): سطر ' || r.id || ' في ' || r.entry_no || ' بـ' || r.cr_amount
              || ' — فلوس شركة، اتشال من حساب مازن. نسخة احتياطية في d1_backup_2026_09_28.',
            v_user);
  end loop;

  -- ٢ب) اسم مازن من وصف القيود الأربعة (كل سطورها)
  update journal_entries
     set description = replace(replace(description, ' بواسطة مازن الخلف', ''), '، مازن الخلف', '')
   where system_type = 'TM' and entry_no = any(v_entries)
     and (description like '% بواسطة مازن الخلف%' or description like '%، مازن الخلف%');

  -- ٣) السجلات: الدافع = الشركة
  update payments set payer = v_company where id = any(v_pay_ids);
  update expenses set paid_by = v_company, paid_by_split = null where id = any(v_exp_ids);
  insert into audit_log(system_type, action, table_name, file_no, old_value, new_value, notes, user_email)
    select 'TM', 'CORRECT', 'payments', p.file_no, 'payer=مازن الخلف', 'payer=' || v_company,
           'D-1: الدافع في ' || coalesce(p.ref_no, p.id::text) || ' بقى الشركة (فلوس شركة)', v_user
      from payments p where p.id = any(v_pay_ids);
  insert into audit_log(system_type, action, table_name, file_no, old_value, new_value, notes, user_email)
    select 'TM', 'CORRECT', 'expenses', e.file_no, 'paid_by_split=[صندوق الترانزيت، مازن الخلف]',
           'paid_by=' || v_company || ', paid_by_split=null',
           'D-1: الدافع في ' || coalesce(e.ref_no, e.id::text) || ' بقى الشركة (فلوس شركة)', v_user
      from expenses e where e.id = any(v_exp_ids);

  raise notice 'D-1 خلص: 4 سطور ← % (%)، و2 دفعة + 2 مصروف ← %', v_target, v_target_name, v_company;
end
$d1$;

commit;

-- ── تحقق بعد (قراءة بس) ────────────────────────────────────
-- المتوقع كله (قبل ← بعد):
--   2401 TM: 145 سطر / 54,227 مدين ← 141 / 63,589 مدين. وcomputePartnerGlobalBalance(مازن) = −63,589 = الدفتر.
--   1120 TM: 631 سطر مرحّل / −47,037.62 ← 635 / −56,399.62 (ينزل 9,362 بالظبط).
--   3200 TM: زي ما هو (916 / −394,642.72).
--   الميزان TM: نفس عدد السطور (4,055) ونفس الإجمالي (4,469,508.42)، والفرق 0.
--   كشف الجهة لمازن: 1,017 ← 1,013 سطر، والختامي 50,047.5 ← 59,409.5 مدين (63,589 − 4,179.5).
--   الكشف الشامل لمازن: 145 ← 141 حركة / 63,589 مدين.
--   ربح TM-097 وTM-005 وTM-003 وTM-002 والكناري: زي ما هو (نقل بين حسابات ميزانية).
-- 1) 2401 (المتوقع 63589 = 54227 + 9362، و141 سطر):
-- select count(*), sum(dr_amount) - sum(cr_amount) from journal_entries
--  where system_type='TM' and account_code='2401' and post_status='posted';
-- 1ب) 1120 (المتوقع 635 سطر، و−56399.62):
-- select count(*), sum(dr_amount) - sum(cr_amount) from journal_entries
--  where system_type='TM' and account_code='1120' and post_status='posted';
-- 2) السطور الأربعة على 1120 ومن غير جهة:
-- select id, entry_no, account_code, account_name, contact_name, cr_amount, description
--   from journal_entries where id in (24881,24915,24929,24941) order by id;
-- 3) مفيش سطر نشط تاني فاضل على مازن في القيود الأربعة (اتحاكى قبل التشغيل 2026-09-29: القيود الأربعة
--    فيها 10 سطور، والاسم فيها بصيغتين بس — « بواسطة مازن الخلف» (4 سطور دفعات) و«، مازن الخلف»
--    (6 سطور مصروفات) — وبعد الـreplace الـ10 من غير «مازن»، والنص مقروء، مثلًا
--    «… — موزَّع بالتساوي على صندوق الترانزيت»):
-- select count(*) from journal_entries
--  where system_type='TM' and entry_no in ('JE-2026-01675','JE-2026-01688','JE-2026-01691','JE-2026-01695')
--    and (contact_name = 'مازن الخلف' or description like '%مازن%');   -- المتوقع 0
-- 4) الميزان TM فرقه 0 (التعديل بين حسابات على نفس الجانب):
-- select sum(dr_amount) - sum(cr_amount) from journal_entries where system_type='TM' and post_status='posted';
-- 5) السجلات:
-- select id, payer from payments where id in ('f21438b5-d553-498f-9b16-2c671c23a2e1','6dca979d-6bce-4254-925d-1a8a1c9072f0');
-- select id, paid_by, paid_by_split from expenses where id in ('f9063a08-15cd-4ce7-8c86-1b48a1a7089f','a2b2531b-b43f-4b6a-a11b-cb3fc221a0aa');

-- ════════════════════════════════════════════════════════════
-- ↩️ رجوع كامل (من النسخة الاحتياطية) — لو المالك قرر يرجّع:
-- begin;
--   update journal_entries j
--      set account_code = b.payload->>'account_code', account_name = b.payload->>'account_name',
--          contact_name = b.payload->>'contact_name', description = b.payload->>'description'
--     from d1_backup_2026_09_28 b where b.kind = 'je' and b.row_id = j.id::text;
--   update payments p set payer = b.payload->>'payer'
--     from d1_backup_2026_09_28 b where b.kind = 'payment' and b.row_id = p.id::text;
--   update expenses e set paid_by = b.payload->>'paid_by', paid_by_split = b.payload->'paid_by_split'
--     from d1_backup_2026_09_28 b where b.kind = 'expense' and b.row_id = e.id::text;
--   insert into audit_log(system_type, action, table_name, file_no, old_value, new_value, notes, user_email)
--   values ('TM', 'CORRECT', 'journal_entries', null, 'D-1', 'رجوع', 'رجوع D-1 من d1_backup_2026_09_28 بقرار المالك',
--           coalesce(auth.jwt() ->> 'email', current_user));
--   -- (اختياري بعد التأكد) drop table d1_backup_2026_09_28;
-- commit;
-- ════════════════════════════════════════════════════════════
