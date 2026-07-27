-- نفّذ هذا في Supabase SQL Editor مرة واحدة.
-- Tier 0 بند 2 — يوحّد ويصلح مسارين مختلفين لحذف صفقة/ملف كامل كانا يعملان
-- بشكل منفصل وخطير:
--   1. confirmDeleteDealFromModal (reports.js): كان يحذف 11 جدول في حلقة
--      متتالية، كل جدول بمحاولة منفصلة (try/catch يبتلع الخطأ ويكمل) — غير
--      ذرّي إطلاقًا (فشل جدول واحد يسيب البيانات في حالة نص محذوفة)، بلا أي
--      قيد يمنع حذف صفقة فيها نشاط مالي حقيقي مرحّل، وبلا عكس محاسبي.
--   2. deleteOrphanDeal (accounting.js): كان يحذف صف purchase_orders فقط،
--      بلا أي تنظيف للجداول المرتبطة — يسيب كل بيانات الصفقة (سيارات، مبيعات،
--      دفعات، قيود) أيتام دائمين في القاعدة، غير مرئيين لكن موجودين.
--
-- الحل: دالة Postgres واحدة، ذرّية بالكامل (كل الدالة transaction واحدة —
-- أي خطأ في أي خطوة يلغي كل الخطوات السابقة تلقائيًا)، بحارس صريح: تمنع
-- الحذف بالكامل لو فيه أي نشاط غير draft/cancelled في أي جدول تشغيلي، أو أي
-- قيد محاسبي (journal_entries) مرحّل لهذا الملف — نفس فلسفة voidPurchaseOrder
-- (منع بدل حذف بصمت) لكن أصرم: حتى الأرصدة "الملغاة/المعكوسة" (voided) تمنع
-- الحذف هنا، لأن حذفها بالكامل يمحو دليل إن العملية حصلت أصلاً وعُكست — ده
-- تاريخ حقيقي يستحق البقاء، مش مجرد بيانات مسودة.
--
-- نتيجة عملية: الدالة دي بتنجح فقط على صفقات لسه مسودة بالكامل (لسه ما
-- اتُرحّلت لحد دلوقتي) أو فاضية تمامًا — أي صفقة فيها نشاط حقيقي (حتى لو
-- اتعكس بعدين) لازم تُعكس/تُلغى بندًا ببند عبر المسارات الموجودة (voidTransaction/
-- voidSaleInvoice/voidPurchaseOrder) قبل ما يُسمح بحذف السند نفسه.

-- ✅ drop قبل create or replace: بدّلنا RETURNS TABLE (عمود deleted_stock_locations
-- جديد) — بوستجرس بيرفض CREATE OR REPLACE لو نوع الإرجاع اتغيّر، لازم drop الأول
drop function if exists delete_deal_completely(text, text);

create or replace function delete_deal_completely(
  p_sys     text,
  p_file_no text
) returns table(
  deleted_vehicles       int,
  deleted_payments       int,
  deleted_expenses       int,
  deleted_sales          int,
  deleted_collections    int,
  deleted_payouts        int,
  deleted_partners       int,
  deleted_sale_charges   int,
  deleted_stock_locations int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_po_id     uuid;
  v_po_status text;
  v_blocking  int;
  v_n_vehicles int; v_n_payments int; v_n_expenses int; v_n_sales int;
  v_n_collections int; v_n_payouts int; v_n_partners int; v_n_charges int; v_n_stock int;
begin
  -- ── قفل صفّي على سند الشراء — يمنع محاولتين متزامنتين لحذف نفس الملف ──
  select id, post_status into v_po_id, v_po_status
  from purchase_orders
  where system_type = p_sys and file_no = p_file_no
  for update;

  if v_po_id is null then
    raise exception 'لا يوجد ملف بهذا الرقم (%) في هذا النظام — لا شيء لحذفه', p_file_no;
  end if;

  if v_po_status is not null and v_po_status <> 'draft' then
    raise exception 'لا يمكن حذف الصفقة — سند الشراء نفسه بحالة "%"، وليس مسودة. اعكسه أولاً عبر إلغاء سند الشراء إن لزم', v_po_status;
  end if;

  -- ── الحارس: أي صف بحالة غير draft/cancelled في أي جدول تشغيلي يمنع الحذف
  --    بالكامل — يشمل posted/pending_edit/pending_void/voided. cancelled مسموح
  --    في الخمس جداول كلها (لا المبيعات فقط) — سيناريو حقيقي وشائع: رفض سند
  --    شراء لسه draft من قائمة المراجعة (rejectFromDetail، operations.js) بيحوّل
  --    كل صفوفه التشغيلية اللي كانت draft إلى cancelled تلقائيًا، وده لسه بالضبط
  --    "صفقة ما حصلش فيها نشاط حقيقي" اللي الدالة دي المفروض تسمح بحذفها ──
  select count(*) into v_blocking from payments
    where system_type = p_sys and file_no = p_file_no and coalesce(post_status,'draft') not in ('draft','cancelled');
  if v_blocking > 0 then
    raise exception 'لا يمكن حذف الصفقة — يوجد % دفعة مرحّلة/تحت المراجعة على هذا الملف. اعكسها فرديًا أولاً', v_blocking;
  end if;

  select count(*) into v_blocking from expenses
    where system_type = p_sys and file_no = p_file_no and coalesce(post_status,'draft') not in ('draft','cancelled');
  if v_blocking > 0 then
    raise exception 'لا يمكن حذف الصفقة — يوجد % مصروف مرحّل/تحت المراجعة على هذا الملف. اعكسه فرديًا أولاً', v_blocking;
  end if;

  select count(*) into v_blocking from sales
    where system_type = p_sys and file_no = p_file_no and coalesce(post_status,'draft') not in ('draft','cancelled');
  if v_blocking > 0 then
    raise exception 'لا يمكن حذف الصفقة — يوجد % فاتورة بيع مرحّلة/تحت المراجعة على هذا الملف. اعكسها فرديًا أولاً', v_blocking;
  end if;

  select count(*) into v_blocking from collections
    where system_type = p_sys and file_no = p_file_no and coalesce(post_status,'draft') not in ('draft','cancelled');
  if v_blocking > 0 then
    raise exception 'لا يمكن حذف الصفقة — يوجد % تحصيل مرحّل/تحت المراجعة على هذا الملف. اعكسه فرديًا أولاً', v_blocking;
  end if;

  select count(*) into v_blocking from partner_payouts
    where system_type = p_sys and file_no = p_file_no and coalesce(post_status,'draft') not in ('draft','cancelled');
  if v_blocking > 0 then
    raise exception 'لا يمكن حذف الصفقة — يوجد % صرف شريك مرحّل/تحت المراجعة على هذا الملف. اعكسه فرديًا أولاً', v_blocking;
  end if;

  -- ── شبكة أمان أخيرة: أي قيد محاسبي على الإطلاق لهذا الملف يمنع الحذف —
  --    كل ترحيل حقيقي بيُنشئ سطر journal_entries دائمًا (post_status فيها
  --    'posted' دومًا، لا حالة "مسودة" لها)، فوجود أي سطر يعني نشاطًا حقيقيًا
  --    حصل، حتى لو الجداول التشغيلية فوق سلمت لسبب ما (بيانات غير متسقة/قديمة) ──
  select count(*) into v_blocking from journal_entries
    where system_type = p_sys and file_no = p_file_no;
  if v_blocking > 0 then
    raise exception 'لا يمكن حذف الصفقة — يوجد % قيد محاسبي مرحّل مرتبط بهذا الملف. راجعي اليومية أولاً', v_blocking;
  end if;

  -- ══════════════════════════════════════════════════════════
  -- تجاوزت كل الحراسات: كل البيانات مسودة/ملغاة قبل الترحيل/فاضية بالكامل.
  -- الحذف آمن ولا يمحو أي نشاط مالي حقيقي حصل فعلاً.
  -- ══════════════════════════════════════════════════════════
  delete from vehicles        where system_type = p_sys and file_no = p_file_no; get diagnostics v_n_vehicles    = row_count;
  delete from payments        where system_type = p_sys and file_no = p_file_no; get diagnostics v_n_payments    = row_count;
  delete from expenses        where system_type = p_sys and file_no = p_file_no; get diagnostics v_n_expenses    = row_count;
  delete from sales           where system_type = p_sys and file_no = p_file_no; get diagnostics v_n_sales       = row_count;
  delete from collections     where system_type = p_sys and file_no = p_file_no; get diagnostics v_n_collections = row_count;
  delete from partner_payouts where system_type = p_sys and file_no = p_file_no; get diagnostics v_n_payouts     = row_count;
  delete from partners_master where system_type = p_sys and file_no = p_file_no; get diagnostics v_n_partners    = row_count;
  delete from sale_charges    where system_type = p_sys and file_no = p_file_no; get diagnostics v_n_charges     = row_count;
  -- ✅ كل سيارة بتتسجّل تلقائيًا هنا وقت إضافتها (modals.js) بغض النظر عن حالة
  -- الملف — كانت ناقصة، اكتشفتها مراجعة مستقلة: بدونها كل حذف "ناجح" كان
  -- بيسيب صفوف يتيمة هنا بالظبط زي الباج اللي الدالة دي أصلاً بتحل محله
  delete from stock_locations where system_type = p_sys and file_no = p_file_no; get diagnostics v_n_stock       = row_count;

  -- بلا فعل عمليًا (الحارس فوق ضمن عدم وجود أي صف) — موجودة للدفاع في العمق فقط
  -- ✅ system_type على الحذف الخارجي نفسه لا على الاستعلام الفرعي فقط — entry_no
  -- غير فريد عالميًا (next_je_no.sql: العدّاد مفتاحه system_type)، فبدونه حذف
  -- BOX ممكن يمسح مرفقات TM لو تصادف نفس entry_no (باج كامن، مش نشط دلوقتي
  -- بفضل الحارس فوق، لكن يستحق الإصلاح مباشرة)
  delete from journal_attachments where system_type = p_sys and entry_no in (
    select entry_no from journal_entries where system_type = p_sys and file_no = p_file_no
  );
  delete from journal_entries where system_type = p_sys and file_no = p_file_no;

  delete from purchase_orders where id = v_po_id;

  return query select
    v_n_vehicles, v_n_payments, v_n_expenses, v_n_sales,
    v_n_collections, v_n_payouts, v_n_partners, v_n_charges, v_n_stock;
end;
$$;

-- السماح للمستخدمين الموثّقين باستدعاء الدالة (RLS/صلاحية "حذف" في الواجهة تبقى كما هي للحماية الأولى)
grant execute on function delete_deal_completely(text, text) to authenticated;
