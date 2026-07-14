-- ============================================================================
-- ترحيل بيانات تاريخية: ترسملة مصاريف الملفات في المخزون 1300
-- (قرار 2026-07-14 — إصلاح ازدواج خصم المصاريف في تقارير الأرباح)
--
-- الفكرة: calcCOGS بيحسب تكلفة البيع من جدول expenses مباشرة (بيجمع كل
-- المصاريف المرحّلة على الملف)، بغض النظر عن الحساب اللي اتقيدت عليه.
-- فأي مصروف ملف واصل فعلاً لقيد تكلفة البيع (5100) — سواء اتقيد الأصل بتاعه
-- على 52xx/6xxx أو 1300. المشكلة إنه كان بيفضل قيد مستقل على 52xx/6xxx
-- *كمان*، فتقرير الأرباح كان بيخصمه مرتين.
--
-- الحل: نعيد تصنيف حساب القيد الأصلي (وأي قيد عكسي له) من 52xx/6xxx إلى
-- 1300 — بدون أي تغيير في المبالغ. ده بيخلي 1300 يمثل صح "شراء + مصاريف
-- لسه ما اتحمّلتش على تكلفة بيع"، ولملف مُباع بالكامل الرصيد يتصفّى لصفر
-- تلقائيًا (لأن 5100 عند البيع أصلاً بلع نفس المبلغ عبر calcCOGS).
--
-- النطاق المتأثر (تم التحقق قبل الكتابة): 63 قيد مدين، إجمالي 190,132.50
-- لا قيود عكسية (reversal) موجودة على مصاريف ملفات حتى الآن.
-- ============================================================================

BEGIN;

-- ── 1) نسخة احتياطية من الصفوف اللي هتتغير ──
CREATE TABLE IF NOT EXISTS journal_entries_backup_20260714 (LIKE journal_entries INCLUDING ALL);

INSERT INTO journal_entries_backup_20260714
SELECT * FROM journal_entries
WHERE file_no IS NOT NULL
  AND ref_table IN ('expenses','reversal')
  AND account_code IN ('5200','5210','5220','5300','5310','5320','5400','5410','5420','5430','6510','6610','6700');

-- ── 2) معاينة قبل التنفيذ (لازم يطابق العدد اللي فحصناه: 63 صف) ──
SELECT 'قبل الترحيل' AS marker, account_code, COUNT(*) AS line_count,
       SUM(dr_amount) AS total_dr, SUM(cr_amount) AS total_cr
FROM journal_entries_backup_20260714
GROUP BY account_code
ORDER BY account_code;

-- ── 3) إعادة التصنيف الفعلي ──
UPDATE journal_entries
SET account_code = '1300',
    account_name = 'المخزون — سيارات'
WHERE file_no IS NOT NULL
  AND ref_table IN ('expenses','reversal')
  AND account_code IN ('5200','5210','5220','5300','5310','5320','5400','5410','5420','5430','6510','6610','6700');

-- ── 4) تحقق بعد التنفيذ ──
-- 4-أ) عدد الصفوف المُعدّلة والمجموع المنقول — لازم يطابق المعاينة في (2)
SELECT 'بعد الترحيل — إجمالي منقول' AS marker,
       COUNT(*) AS rows_migrated,
       SUM(dr_amount) AS total_dr_moved,
       SUM(cr_amount) AS total_cr_moved
FROM journal_entries_backup_20260714;

-- 4-ب) ميزان المراجعة الكلي لازم يفضل متوازن (مجرد إعادة تصنيف، مفيش مبالغ اتغيرت)
SELECT 'ميزان عام بعد الترحيل' AS marker,
       SUM(dr_amount) AS total_dr_all, SUM(cr_amount) AS total_cr_all,
       SUM(dr_amount) - SUM(cr_amount) AS diff
FROM journal_entries
WHERE COALESCE(post_status,'posted') NOT IN ('voided','cancelled');

-- 4-ج) الملفات "المُقفلة" (كل سياراتها متسجلة كمبيعة) لازم رصيد 1300 عندها يصفّر
--      (أو يكون قريب من صفر جدًا بسبب فروق تقريب صغيرة)
WITH file_veh AS (
  SELECT file_no, COUNT(*) AS veh_count
  FROM vehicles WHERE vin NOT LIKE 'PART-%' GROUP BY file_no
),
file_sold AS (
  SELECT file_no, COUNT(*) AS sold_count
  FROM sales WHERE vin NOT LIKE 'PART-%' AND post_status = 'posted' GROUP BY file_no
),
file_1300 AS (
  SELECT file_no, SUM(dr_amount) - SUM(cr_amount) AS bal_1300
  FROM journal_entries
  WHERE account_code = '1300' AND COALESCE(post_status,'posted') = 'posted'
  GROUP BY file_no
)
SELECT '1300 لكل ملف مُقفل' AS marker, fv.file_no, fv.veh_count, fs.sold_count, f13.bal_1300
FROM file_veh fv
JOIN file_sold fs ON fs.file_no = fv.file_no AND fs.sold_count >= fv.veh_count
LEFT JOIN file_1300 f13 ON f13.file_no = fv.file_no
ORDER BY ABS(COALESCE(f13.bal_1300,0)) DESC;

COMMIT;

-- ⚠️ لو أي نتيجة في (4-ج) طلعت رصيدها بعيد عن الصفر بشكل ملحوظ، ابعتلي الملف
-- ده وهنراجعه سوا قبل ما نعتبر الترحيل مكتمل ونمسح نسخة الاحتياط.
