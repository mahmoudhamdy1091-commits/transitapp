-- ════════════════════════════════════════════════════════════════════
-- 2026-09-08 — المرحلة ب-٣: RPC تعديل معاملة الشريك
-- نفّذ في Supabase SQL Editor بعد partner_ledger_fix_error_message.sql.
-- ════════════════════════════════════════════════════════════════════
--
-- لماذا RPC شقيقة لا apiPatch عادي:
-- create_partner_ledger_entry تفرض السقف عند **الإدراج وحده**. وتعديل مبلغ
-- من 100 إلى 500 هو اقتصاديًا سحب جديد بـ400 — فـapiPatch يتخطّى السقف
-- بالكامل. الفحص من طرف العميل وحده لا يكفي: هو بتعريفنا «يمنع الخطأ
-- العادي لا السباق»، فالاكتفاء به يعيد فتح الثغرة التي أُغلقت على الخادم
-- (partner_ledger_cap_both_tables.sql) من باب آخر.
--
-- ⚠️ ثلاثة أشياء تفرّق هذه الدالة عن شقيقتها، كلٌّ منها مصدر عطل صامت
-- لو أُغفل:
--
-- (1) v_prior **تستثني الصف المُعدَّل نفسه**. الصف موجود بالفعل في الجدول،
--     فلو حُسب ضمن «المسدَّد سابقًا» طُرح مبلغه مرتين: مرة كصف قائم ومرة
--     كمبلغ جديد ⇒ ينخفض السقف ويُرفض تعديل مشروع. نفس فخّ إزالة التكرار
--     في cap_both_tables، بوجه آخر.
--
-- (2) تفحص **الحالة الحالية** لا المبلغ وحده. v_prior تعدّ
--     ('posted','draft','pending_edit','pending_void') — فصفٌّ 'voided' أو
--     'cancelled' لا يدخل السقف. تعديله يعيده فعليًا إلى الحساب بلا أن
--     يمرّ بأي فحص إنشاء ⇒ يُمنع صراحةً.
--
-- (3) لا تسمح بتغيير entry_type ولا partner ولا file_no. النوع يحدّد شكل
--     الصف كله (ارتباط الملف · تقسيم رأس المال/الربح · وجود القيد)، وتغيير
--     الشريك نقلُ مستحق من حساب إلى آخر — عمليتان لا تعديل. قرار المستخدم
--     2026-09-08: الخطأ فيهما يُعالَج بإلغاء وإعادة إنشاء.
--     (وقد أكّد أن خطأ الشريك يحدث فعلًا ⇒ مسار «نقل مستحق» بند مستقل لاحق.)
--
-- التوقيع الجديد ⇒ لا حاجة لـdrop سابق (لا تعارض مع دالة الإنشاء).

create or replace function update_partner_ledger_entry(
  p_id              uuid,
  p_pay_date        date    default null,
  p_amount          numeric default null,   -- الأنواع العامة
  p_capital         numeric default 0,      -- الأنواع المرتبطة بملف
  p_profit          numeric default 0,
  p_pay_method      text    default null,
  p_document        text    default null,
  p_notes           text    default null,
  p_gross_entitlement numeric default null  -- إلزامية للأنواع المرتبطة بملف
) returns partner_ledger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row     partner_ledger;
  v_cur     partner_ledger;
  v_amount  numeric;
  v_capital numeric;
  v_profit  numeric;
  v_prior   numeric;
  v_linked  boolean;
begin
  -- ── القفل أولًا: نقرأ الصف تحت قفل صفّي فلا يتغيّر بين الفحص والكتابة ──
  select * into v_cur from partner_ledger where id = p_id for update;
  if not found then
    raise exception 'المعاملة غير موجودة';
  end if;

  -- (2) الحالة — قبل أي حساب
  if v_cur.post_status in ('voided','cancelled') then
    raise exception 'لا يمكن تعديل معاملة % — أعد إنشاءها بدل تعديلها',
      case v_cur.post_status when 'voided' then 'ملغاة بقيد عكسي' else 'مرفوضة' end;
  end if;

  v_linked := v_cur.entry_type in ('استرداد وتوزيع أرباح','تأكيد استلام');

  if v_linked then
    v_capital := coalesce(p_capital, 0);
    v_profit  := coalesce(p_profit, 0);
    v_amount  := v_capital + v_profit;
  else
    v_capital := 0;
    v_profit  := 0;
    v_amount  := coalesce(p_amount, v_cur.amount);
  end if;
  if v_amount <= 0 then
    raise exception 'يرجى إدخال مبلغ صحيح';
  end if;

  -- ── القفل الثاني: على سند الشراء للأنواع المرتبطة بملف، بنفس نمط دالة
  --    الإنشاء — يمنع تعديلين متزامنين على نفس الملف من تجاوز السقف معًا ──
  if v_linked then
    perform 1 from purchase_orders
     where system_type = v_cur.system_type and file_no = v_cur.file_no for update;
    if not found then
      raise exception 'الملف % غير موجود في %', v_cur.file_no, v_cur.system_type;
    end if;

    if p_gross_entitlement is null then
      raise exception 'gross_entitlement مطلوبة لهذا النوع';
    end if;

    -- (1) الجدولان معًا، بإزالة تكرار الصفوف المهاجَرة، **واستثناء الصف
    --     المُعدَّل نفسه** (pl.id <> p_id) — وإلا طُرح مبلغه مرتين
    select coalesce(sum(amount), 0) into v_prior
      from (
        select pl.amount
          from partner_ledger pl
         where pl.system_type = v_cur.system_type and pl.partner = v_cur.partner
           and pl.file_no = v_cur.file_no
           and pl.id <> p_id
           and pl.entry_type in ('استرداد وتوزيع أرباح','تأكيد استلام')
           and pl.post_status in ('posted','draft','pending_edit','pending_void')
        union all
        select pp.amount
          from partner_payouts pp
         where pp.system_type = v_cur.system_type and pp.partner = v_cur.partner
           and pp.file_no = v_cur.file_no
           and pp.post_status in ('posted','draft','pending_edit','pending_void')
           and not exists (
             select 1 from partner_ledger m
              where m.ref_no = pp.pay_id and m.system_type = pp.system_type
           )
      ) t;

    if v_amount > (p_gross_entitlement - v_prior + 0.001) then
      raise exception 'المبلغ % يتجاوز المستحق المتبقي % (الاستحقاق الإجمالي=%، مسدَّد سابقًا=%)',
        to_char(v_amount,'FM999999990.00'), to_char(p_gross_entitlement - v_prior,'FM999999990.00'),
        to_char(p_gross_entitlement,'FM999999990.00'), to_char(v_prior,'FM999999990.00');
    end if;
  end if;

  -- (3) entry_type وpartner وfile_no وref_no غير مذكورة هنا إطلاقًا —
  --     غير قابلة للتغيير بالتصميم لا بالإغفال.
  update partner_ledger set
    amount         = v_amount,
    capital_amount = v_capital,
    profit_amount  = v_profit,
    pay_date       = coalesce(p_pay_date, pay_date),
    pay_method     = case when v_linked and v_cur.entry_type = 'تأكيد استلام'
                          then null                       -- لا حركة نقد لهذا النوع
                          else coalesce(p_pay_method, pay_method) end,
    document       = p_document,
    notes          = p_notes
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function update_partner_ledger_entry(
  uuid, date, numeric, numeric, numeric, text, text, text, numeric
) to authenticated;

-- تحقق
select routine_name,
       position('pl.id <> p_id'  in routine_definition) > 0 as excludes_self,
       position('voided'         in routine_definition) > 0 as blocks_voided,
       position('not exists'     in routine_definition) > 0 as dedup_present,
       position('entry_type ='   in routine_definition) = 0 as type_not_assignable
from information_schema.routines
where routine_name = 'update_partner_ledger_entry';
