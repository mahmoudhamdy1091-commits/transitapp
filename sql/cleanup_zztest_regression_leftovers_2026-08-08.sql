-- نفّذ هذا في Supabase SQL Editor بعد المراجعة. بيانات تجريبية (ZZTEST-*) متراكمة
-- من تشغيلات سويت الانحدار (scripts/regression-track-a.js) عبر أسابيع، خصوصًا من
-- تشغيلات اتقطعت في النص قبل ما تنظّف وراها. تحقّقنا: كل صف مطابق يبدأ حرفيًا
-- بـ"ZZTEST-" (قارنّا ILIKE '%ZZTEST%' مقابل ILIKE 'ZZTEST%' على كل جدول/نظام —
-- نفس العدد بالظبط في كل حالة، صفر تطابق عرضي).
--
-- ترتيب الحذف يحترم الاعتمادية: القيود المحاسبية وسجل التدقيق أولاً (بلا مرجعية
-- عكسية)، بعدين الجداول التفصيلية، بعدين السيارات/الشركاء/المبيعات، وأخيرًا
-- purchase_orders نفسها (الأب اللي باقي الجداول عندها FK على file_no بتاعه).
--
-- الأعداد المتوقَّعة (تحقَّق منها 2026-08-08 عبر Content-Range/count=exact):
--   journal_entries: BOX 3336 + TM 64 = 3400
--   audit_log:       BOX 2071 + TM 48 = 2119
--   expenses:        BOX 317  + TM 24 = 341
--   payments:        BOX 104  + TM 0  = 104
--   collections:      BOX 104  + TM 0  = 104
--   partner_payouts: BOX 104  + TM 0  = 104
--   sales:           BOX 16   + TM 8  = 24
--   vehicles:        BOX 16   + TM 8  = 24
--   partners_master: BOX 224  + TM 0  = 224
--   purchase_orders: BOX 246  + TM 24 = 270

delete from journal_entries   where file_no like 'ZZTEST-%';
delete from audit_log         where file_no like 'ZZTEST-%';
delete from expenses          where file_no like 'ZZTEST-%';
delete from payments          where file_no like 'ZZTEST-%';
delete from collections       where file_no like 'ZZTEST-%';
delete from partner_payouts   where file_no like 'ZZTEST-%';
delete from sales             where file_no like 'ZZTEST-%';
delete from vehicles          where file_no like 'ZZTEST-%';
delete from partners_master   where file_no like 'ZZTEST-%';
delete from purchase_orders   where file_no like 'ZZTEST-%';

-- تحقق نهائي — لازم يرجع 0 لكل جدول
select 'journal_entries' t, count(*) from journal_entries where file_no like 'ZZTEST-%'
union all select 'audit_log', count(*) from audit_log where file_no like 'ZZTEST-%'
union all select 'expenses', count(*) from expenses where file_no like 'ZZTEST-%'
union all select 'payments', count(*) from payments where file_no like 'ZZTEST-%'
union all select 'collections', count(*) from collections where file_no like 'ZZTEST-%'
union all select 'partner_payouts', count(*) from partner_payouts where file_no like 'ZZTEST-%'
union all select 'sales', count(*) from sales where file_no like 'ZZTEST-%'
union all select 'vehicles', count(*) from vehicles where file_no like 'ZZTEST-%'
union all select 'partners_master', count(*) from partners_master where file_no like 'ZZTEST-%'
union all select 'purchase_orders', count(*) from purchase_orders where file_no like 'ZZTEST-%';
