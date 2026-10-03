-- ════════════════════════════════════════════════════════════
-- بيانات N-22م + N-27 (مسودة — **المالك بس يشغّلها**)
-- قرارات المالك 2026-10-03 (في شات المراجع، بالنص): «مشاري خارجي / تصحيح اسم المورد اوك».
-- راجع docs/PLAN-partner-statements-fix-2026-09-23.md (N-22، N-27).
--
-- ١) N-22م — مشاري العميري (BOX 2410) = شريك **خارجي**: is_permanent من NULL ⇒ false.
--    - الأثر: NULL = «مش مصنَّف» ⇒ الكود بيقفل (fail-closed: PAYER_CLASS_UNVERIFIED_MSG، core.js:688/734)
--      أي دفع من جاريه. بعد false: بيتعامل زي أي شريك خارجي.
--    - «الصندوق — تاريخي» (BOX 2411) **يفضل NULL** (مش شريك حقيقي — fail-closed مقصود).
--    - برّه القرار ده (للتسجيل): TM 2404 «طلال العميري» لسه NULL. وقرار N-22 العام (النوع وقت فتح أي شريك
--      جديد) لسه ما اتاخدش.
--
-- ٢) N-27 — اسم المورد (contact_name) على سطور 2100 في الدفعات = اسم المورد في سند الشراء بتاع الملف.
--    - je_payment بياخد اسم المورد من purchase_orders.supplier (engine.js:1491-1497، لأن جدول payments
--      مافيهوش عمود مورد أصلًا) ⇒ **التصحيح = نفس اللي القيد كان هيتكتب بيه لو اترحّل النهارده.**
--    - مفيش تغيير في أي مبلغ ولا حساب ولا وصف ولا سجل payments — contact_name بس، على 3 سطور بالـid.
--
--    قياس حي (قراءة، 2026-10-03، جلسة admin):
--    BOX-141 - ( 99  OLD ) — سند الشراء ea9420de… supplier = «الجبالي»:
--      2452  JE-2026-00397  2100  dr 7,107  «مورد غير معروف»   دفعة 59ebbc34… (PMT-…-P2، الدافع ماجد الجبالي)  ⇒ «الجبالي»
--      (2451 JE-00396 cr 7,107 و2961 JE-00584 dr 7,107 بنفس الاسم = قيد شراء قديم وعكسه، صافي 0 — تاريخ، مايتلمسوش.)
--      الأرصدة على 2100 في الملف (cr − dr): «الجبالي» +7,107 (مستحق له رغم إنه اتدفع) / «مورد غير معروف» −7,107.
--      بعد: الاتنين 0.
--    TM-004 (13 - OLD) — سند الشراء c1a056f8… supplier = «شركة جوهرة البشير» (بالتاء المربوطة):
--      **سطرين مش سطر واحد** (N-27 الأصلي ذكر JE-00042 بس):
--      2966  JE-2026-00038  2100  dr 4,691  «شركه جوهره البشير»  دفعة 7212b2da… (P1، الدافع صندوق الترانزيت)  ⇒ «شركة جوهرة البشير»
--      2974  JE-2026-00042  2100  dr 4,691  «شركه جوهره البشير»  دفعة 62425f55… (P2، الدافع مازن الخلف)       ⇒ «شركة جوهرة البشير»
--      سند الشراء اترحّل تاني (JE-2026-00189، سطر 7540 cr 9,382) بالاسم الجديد، والدفعتين فضلوا بالقديم.
--      (التلات أزواج التانيين بالاسم القديم — 2633/2973، 2971/8132، 2634/2968 — قيود اتعكست، صافي كل زوج 0 — مايتلمسوش.)
--      الأرصدة في الملف: «شركة جوهرة البشير» +9,382 / «شركه جوهره البشير» −9,382. بعد: الاتنين 0 (4,691 × 2 = 9,382).
--
--    ⚠️ برّه N-27 (للتسجيل، قرار مالك لوحده): المورد ده متسجّل بـ4 صيغ في TM (في سندات الشراء نفسها وفي القيود)
--      — «شركه جوهره البشير» (TM-009/014/016/017/018/019/021)، «شركة جوهرة البشير» (TM-002/003/004/093/094/096)،
--      «شركة جوهرة البشي» (TM-005/006)، «شركة جوهرة البشير  عادل البشير» (TM-097) — وفي BOX «جوهره البشير للتجاره»
--      (BOX-129). جوّه كل ملف السند والقيود متطابقين (بعد التصحيح ده)، بس كشف المورد بيطلع 4 موردين.
--
--    ⚠️ الوصف (description) فيه الاسم القديم («دفعة للمورد مورد غير معروف بواسطة …») — **مش متلمس عمدًا**:
--      وصف القيد واحد لكل سطوره، وسطر 2453 في نفس القيد على 2400 (حساب أب) — لو حارس م٥ شغّال على الحي،
--      أي UPDATE على السطر ده هيترفض والـtransaction كلها هترجع.
-- ════════════════════════════════════════════════════════════

-- ── فحص قبل (قراءة بس) ─────────────────────────────────────
-- 1) مشاري (المتوقع صف واحد، is_permanent = null):
-- select id, system_type, partner_name, account_code, is_permanent from partner_account_links
--  where system_type = 'BOX' and account_code in ('2410','2411') order by account_code;
-- 2) السطور التلاتة (المتوقع 3 صفوف، 2100، dr، reversed_by فاضي، posted):
-- select id, system_type, entry_no, account_code, dr_amount, cr_amount, contact_name, ref_table, ref_id, reversed_by, post_status
--   from journal_entries where id in (2452, 2966, 2974) order by id;
-- 3) أسماء الموردين في سندات الشراء (المتوقع «الجبالي» و«شركة جوهرة البشير»):
-- select system_type, file_no, supplier from purchase_orders
--  where (system_type, file_no) in (('BOX','BOX-141 - ( 99  OLD )'), ('TM','TM-004 (13 - OLD)'));
-- 4) أرصدة 2100 في الملفين بالاسم (المتوقع: الجبالي 7107، مورد غير معروف −7107، شركة… 9382، شركه… −9382):
-- select system_type, file_no, contact_name, sum(cr_amount) - sum(dr_amount) as bal from journal_entries
--  where account_code = '2100' and post_status = 'posted'
--    and (system_type, file_no) in (('BOX','BOX-141 - ( 99  OLD )'), ('TM','TM-004 (13 - OLD)'))
--  group by 1, 2, 3 order by 1, 2, 3;

begin;

create table if not exists n27_backup_2026_10_03 (
  kind     text not null,          -- 'link' | 'je'
  row_id   text not null,
  payload  jsonb not null,
  saved_at timestamptz not null default now()
);
alter table n27_backup_2026_10_03 enable row level security;
revoke all on table n27_backup_2026_10_03 from anon, authenticated;

do $n27$
declare
  v_box_file text := 'BOX-141 - ( 99  OLD )';
  v_tm_file  text := 'TM-004 (13 - OLD)';
  v_box_sup  text;
  v_tm_sup   text;
  v_n        int;
  v_user     text := coalesce(auth.jwt() ->> 'email', current_user);
  r          record;
begin
  -- ٠) حماية من التشغيل مرتين
  if exists (select 1 from n27_backup_2026_10_03) then
    raise exception 'الملف ده اتشغّل قبل كده (فيه نسخة احتياطية في n27_backup_2026_10_03) — ماتشغّلش تاني. للرجوع شوف آخر الملف.';
  end if;

  -- ٠) الاسم الصح = سند الشراء (بالحرف)، ومتطابق مع اللي اتقاس
  select supplier into v_box_sup from purchase_orders where system_type = 'BOX' and file_no = v_box_file;
  select supplier into v_tm_sup  from purchase_orders where system_type = 'TM'  and file_no = v_tm_file;
  if v_box_sup is distinct from 'الجبالي' or v_tm_sup is distinct from 'شركة جوهرة البشير' then
    raise exception 'اسم المورد في سند الشراء مش زي ما اتقاس (BOX-141=«%»، TM-004=«%») — وقّف وراجع.', v_box_sup, v_tm_sup;
  end if;

  -- ٠) مشاري: صف واحد بالظبط ولسه NULL
  select count(*) into v_n from partner_account_links
   where id = 20 and system_type = 'BOX' and account_code = '2410'
     and partner_name = 'مشاري العميري' and is_permanent is null;
  if v_n <> 1 then
    raise exception 'المتوقع صف ربط واحد لمشاري العميري (BOX 2410) لسه NULL — لقيت %', v_n;
  end if;

  -- ٠) السطور التلاتة زي ما اتقاست بالظبط
  select count(*) into v_n from journal_entries
   where post_status = 'posted' and reversed_by is null and account_code = '2100' and cr_amount = 0
     and (   (id = 2452 and system_type = 'BOX' and entry_no = 'JE-2026-00397' and file_no = v_box_file
              and dr_amount = 7107 and contact_name = 'مورد غير معروف'
              and ref_table = 'payments' and ref_id::text = '59ebbc34-5f50-47d3-b454-629646a2ade5')
          or (id = 2966 and system_type = 'TM' and entry_no = 'JE-2026-00038' and file_no = v_tm_file
              and dr_amount = 4691 and contact_name = 'شركه جوهره البشير'
              and ref_table = 'payments' and ref_id::text = '7212b2da-45e7-4969-a2b9-a0e5ff2655d9')
          or (id = 2974 and system_type = 'TM' and entry_no = 'JE-2026-00042' and file_no = v_tm_file
              and dr_amount = 4691 and contact_name = 'شركه جوهره البشير'
              and ref_table = 'payments' and ref_id::text = '62425f55-32dd-4d46-8b5c-352b81512c83'));
  if v_n <> 3 then
    raise exception 'المتوقع 3 سطور 2100 نشطة زي القياس (2452، 2966، 2974) — لقيت %. وقّف وراجع.', v_n;
  end if;

  -- ١) نسخة احتياطية
  insert into n27_backup_2026_10_03(kind, row_id, payload)
    select 'link', l.id::text, to_jsonb(l) from partner_account_links l where l.id = 20;
  insert into n27_backup_2026_10_03(kind, row_id, payload)
    select 'je', j.id::text, to_jsonb(j) from journal_entries j where j.id in (2452, 2966, 2974);

  -- ٢) N-22م: مشاري خارجي
  update partner_account_links set is_permanent = false where id = 20;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'تحديث مشاري لمس % صف بدل 1', v_n; end if;
  insert into audit_log(system_type, action, table_name, file_no, old_value, new_value, notes, user_email)
  values ('BOX', 'CORRECT', 'partner_account_links', null, 'مشاري العميري 2410 is_permanent=null',
          'is_permanent=false',
          'N-22م (قرار المالك 2026-10-03: «مشاري خارجي»). نسخة احتياطية في n27_backup_2026_10_03.', v_user);

  -- ٣) N-27: اسم المورد على سطور الدفعات = سند الشراء
  for r in select id, system_type, entry_no, file_no, dr_amount, contact_name
             from journal_entries where id in (2452, 2966, 2974) order by id loop
    update journal_entries
       set contact_name = case when r.system_type = 'BOX' then v_box_sup else v_tm_sup end
     where id = r.id;
    insert into audit_log(system_type, action, table_name, file_no, old_value, new_value, notes, user_email)
    values (r.system_type, 'CORRECT', 'journal_entries', r.file_no,
            'contact_name=' || r.contact_name,
            'contact_name=' || case when r.system_type = 'BOX' then v_box_sup else v_tm_sup end,
            'N-27 (قرار المالك 2026-10-03: «تصحيح اسم المورد اوك»): سطر ' || r.id || ' في ' || r.entry_no
              || ' بـ' || r.dr_amount || ' — اسم المورد = سند الشراء. المبلغ والحساب زي ما هم. '
              || 'نسخة احتياطية في n27_backup_2026_10_03.', v_user);
  end loop;

  raise notice 'N-22م + N-27 خلص: مشاري ⇒ خارجي، و3 سطور 2100 ⇒ اسم المورد من سند الشراء';
end
$n27$;

commit;

-- ── تحقق بعد (قراءة بس) ────────────────────────────────────
-- 1) مشاري = false، و«الصندوق — تاريخي» لسه null:
-- select account_code, partner_name, is_permanent from partner_account_links
--  where system_type = 'BOX' and account_code in ('2410','2411') order by account_code;
-- 2) أرصدة 2100 في الملفين (نفس استعلام «فحص قبل ٤») ⇒ المتوقع كل الأسماء 0 (الجبالي 0، مورد غير معروف 0،
--    شركة جوهرة البشير 0، شركه جوهره البشير 0).
-- 3) المبالغ والحسابات ماتغيّرتش + الميزان فرقه 0 في النظامين:
-- select id, account_code, dr_amount, cr_amount, contact_name from journal_entries where id in (2452, 2966, 2974);
-- select system_type, sum(dr_amount) - sum(cr_amount) from journal_entries where post_status = 'posted' group by 1;
-- 4) audit_log: 4 سطور CORRECT جديدة (1 partner_account_links + 3 journal_entries).
-- 5) في الشاشة: كشف المورد «الجبالي» (BOX) — الدفعة 7,107 ظاهرة والرصيد على BOX-141 صفر؛
--    وكشف «شركة جوهرة البشير» (TM) — الدفعتين على TM-004 ظاهرين والرصيد على الملف صفر.

-- ════════════════════════════════════════════════════════════
-- ↩️ رجوع كامل (من النسخة الاحتياطية) — لو المالك قرر يرجّع:
-- begin;
--   update partner_account_links l set is_permanent = (b.payload->>'is_permanent')::boolean
--     from n27_backup_2026_10_03 b where b.kind = 'link' and b.row_id = l.id::text;
--   update journal_entries j set contact_name = b.payload->>'contact_name'
--     from n27_backup_2026_10_03 b where b.kind = 'je' and b.row_id = j.id::text;
--   insert into audit_log(system_type, action, table_name, file_no, old_value, new_value, notes, user_email)
--   values ('BOX', 'CORRECT', 'journal_entries', null, 'N-22م + N-27', 'رجوع',
--           'رجوع N-22م + N-27 من n27_backup_2026_10_03 بقرار المالك', coalesce(auth.jwt() ->> 'email', current_user));
--   -- (اختياري بعد التأكد) drop table n27_backup_2026_10_03;
-- commit;
-- ════════════════════════════════════════════════════════════
