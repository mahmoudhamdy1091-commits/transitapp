-- نفّذ هذا في Supabase SQL Editor مرة واحدة. آمن يتكرر تشغيله (create or replace / drop if exists).
--
-- المرحلة ٥ من docs/PLAN-partner-accounts-2026-09-17.md — "قفل الحسابات الأب":
-- أي حساب له أولاد (حساب تاني في نفس النظام قيمة parent_code بتاعته = كوده)
-- لا يقبل قيدًا مباشرًا. هذا هو الحارس الثاني ("الأضمن") في قاعدة البيانات —
-- الحارس الأول (شاشة القيد اليدوي، js/operations.js submitJE) اتنفّذ ومنشور بالفعل.
--
-- ⚠️ فحص حي قبل الكتابة (2026-09-21): 15 من 16 حساب أب (8 لكل نظام:
-- 1000/1100/2000/2400/3000/4000/5000/6000) صفر قيد عليهم إطلاقًا. الحساب
-- السادس عشر ("2400") فيه 44 قيد قديم (35 BOX + 9 TM) — كلها بتاريخ قبل
-- 2026-09-16 (قبل ما partner_account_links بقت إلزامية لكل شريك). صفر قيد
-- جديد على 2400 في الاتنين من 2026-09-16 لحد اليوم — القفل هنا لا يمس أي
-- قيد قائم (يمنع الجديد بس) ولا يكسر أي مسار كتابة حالي (كتّاب engine.js
-- بيرفضوا شريكًا بلا حساب مربوط أصلًا قبل ما يوصلوا لـ2400).

create or replace function reject_je_on_parent_account()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from chart_of_accounts child
     where child.system_type = new.system_type
       and child.parent_code = new.account_code
  ) then
    raise exception 'الحساب % حساب أب وله حسابات فرعية — لا يقبل قيدًا مباشرًا. اختر الحساب الفرعي المحدَّد بدلاً منه.', new.account_code;
  end if;
  return new;
end;
$$;

comment on function reject_je_on_parent_account() is
  'م٥ — حارس قاعدة البيانات: يرفض أي INSERT/UPDATE على journal_entries بحساب له أولاد في نفس النظام (chart_of_accounts.parent_code).';

drop trigger if exists trg_reject_je_on_parent on journal_entries;
create trigger trg_reject_je_on_parent
  before insert or update on journal_entries
  for each row execute function reject_je_on_parent_account();

-- ════════════════════════════════════════════════════════════
-- تحقق بعد التنفيذ (شغّلها يدويًا — الأولى قراءة، الثانية والثالثة تجربة
-- كتابة حقيقية داخل معاملة تُلغى فورًا بـROLLBACK فلا تترك أي أثر)
-- ════════════════════════════════════════════════════════════
-- (أ) صفر قيد جديد بعد اليوم على أي حساب أب (يجب أن يبقى صفر دائمًا من الآن):
-- select system_type, account_code, count(*) from journal_entries
--   where account_code in ('1000','1100','2000','2400','3000','4000','5000','6000')
--     and entry_date > current_date
--   group by 1,2;
--
-- (ب) محاولة إدراج مرفوضة (تتوقع خطأ "حساب أب وله حسابات فرعية")، بلا أي أثر دائم:
-- begin;
--   insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, description, ref_table, post_status)
--   values ('BOX', 'TEST-M5-REJECT', current_date, '2400', 'حسابات شركاء', 100, 0, 'اختبار م٥ — متوقَّع رفض', 'manual', 'posted');
-- rollback;
--
-- (ج) محاولة إدراج مقبولة على حساب فرعي حقيقي (يتوقع نجاح)، بلا أي أثر دائم:
-- begin;
--   insert into journal_entries (system_type, entry_no, entry_date, account_code, account_name, dr_amount, cr_amount, description, ref_table, post_status)
--   values ('BOX', 'TEST-M5-ACCEPT', current_date, '2404', 'جاري الشريك ماجد الجبالي', 100, 0, 'اختبار م٥ — متوقَّع قبول', 'manual', 'posted');
-- rollback;
