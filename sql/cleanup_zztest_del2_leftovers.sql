-- تنظيف بيانات تجريبية متبقية من اختبار delete_deal_completely بتاريخ 2026-07-27
-- (ملف ZZTEST-DEL2-CLEAN) — اكتُشفت بالصدفة 2026-07-29 أثناء اختبار ملاحظات
-- تحويل المخزون: صفّان مكرران في stock_locations لسه موجودين رغم إن الاختبار
-- كان مفروض يتنضف بعد ما اتأكد نجاح delete_deal_completely.
--
-- فحص حي بمفتاح anon قبل هذا السكريبت أظهر صفر صفوف لهذا الملف في:
-- purchase_orders, vehicles, sales, expenses, payments, collections,
-- partner_payouts, partners_master, journal_entries — يعني الصفقة والقيود
-- نظيفة فعلاً؛ الباقي فقط stock_locations (وaudit_log، غير مؤكَّد لأن anon
-- key ما قدرش يقرأ الجدولين دول — على الأرجح RLS مقصورة على المستخدمين
-- المسجَّلين). هذا السكريبت يمسح أي أثر متبقٍ من كل الجداول احتياطًا حتى لو
-- كانت فارغة بالفعل.

do $$
declare
  v_file text := 'ZZTEST-DEL2-CLEAN';
  v_n int;
begin
  delete from stock_locations where file_no = v_file;
  get diagnostics v_n = row_count; raise notice 'stock_locations: % صف', v_n;

  delete from audit_log where file_no = v_file;
  get diagnostics v_n = row_count; raise notice 'audit_log: % صف', v_n;

  delete from journal_entries where file_no = v_file;
  get diagnostics v_n = row_count; raise notice 'journal_entries: % صف', v_n;

  delete from collections where file_no = v_file;
  get diagnostics v_n = row_count; raise notice 'collections: % صف', v_n;

  delete from payments where file_no = v_file;
  get diagnostics v_n = row_count; raise notice 'payments: % صف', v_n;

  delete from expenses where file_no = v_file;
  get diagnostics v_n = row_count; raise notice 'expenses: % صف', v_n;

  delete from partner_payouts where file_no = v_file;
  get diagnostics v_n = row_count; raise notice 'partner_payouts: % صف', v_n;

  delete from partners_master where file_no = v_file;
  get diagnostics v_n = row_count; raise notice 'partners_master: % صف', v_n;

  delete from sales where file_no = v_file;
  get diagnostics v_n = row_count; raise notice 'sales: % صف', v_n;

  delete from vehicles where file_no = v_file;
  get diagnostics v_n = row_count; raise notice 'vehicles: % صف', v_n;

  delete from purchase_orders where file_no = v_file;
  get diagnostics v_n = row_count; raise notice 'purchase_orders: % صف', v_n;
end $$;
