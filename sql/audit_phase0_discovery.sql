-- ============================================================================
-- المرحلة 0: فحص قرائي شامل لحالة البيانات الحية (SELECT فقط — آمن تمامًا)
-- يُنفَّذ في Supabase SQL Editor. لا يعدّل أي بيانات.
-- شغّل كل استعلام على حدة وراجع نتيجته (أو شغّل الملف كاملًا لو المحرر يدعم نتائج متعددة).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- (1) الحسابات الفرعية المفتوحة تحت جاري الشركاء 2400
-- ────────────────────────────────────────────────────────────────────────────
SELECT '1_partner_subaccounts' AS audit_query,
       account_code, account_name, account_type, system_type, is_active
FROM chart_of_accounts
WHERE parent_code = '2400'
ORDER BY account_code;

-- ────────────────────────────────────────────────────────────────────────────
-- (2) القيود المسجلة على الحسابات الفرعية دي (عدد + مجاميع + مدى تواريخ +
--     هل contact_name متسجل ولا فاضي — متوقع فاضي من القيود اليدوية)
-- ────────────────────────────────────────────────────────────────────────────
SELECT '2_entries_on_subaccounts' AS audit_query,
       je.account_code,
       coa.account_name,
       COUNT(*)                                    AS line_count,
       SUM(je.dr_amount)                           AS total_dr,
       SUM(je.cr_amount)                           AS total_cr,
       MIN(je.entry_date)                          AS first_date,
       MAX(je.entry_date)                          AS last_date,
       COUNT(*) FILTER (WHERE je.contact_name IS NOT NULL AND je.contact_name <> '') AS with_contact,
       COUNT(*) FILTER (WHERE je.contact_name IS NULL OR je.contact_name = '')       AS without_contact,
       array_agg(DISTINCT je.ref_table)            AS ref_tables,
       array_agg(DISTINCT je.post_status)          AS post_statuses
FROM journal_entries je
JOIN chart_of_accounts coa
  ON coa.account_code = je.account_code AND coa.parent_code = '2400'
GROUP BY je.account_code, coa.account_name
ORDER BY je.account_code;

-- ────────────────────────────────────────────────────────────────────────────
-- (3) قيود مسجلة مباشرة على حسابات رئيسية (أي حساب هو parent_code لحساب آخر)
--     — أهمها 2400 نفسه
-- ────────────────────────────────────────────────────────────────────────────
WITH parents AS (
  SELECT DISTINCT parent_code AS account_code
  FROM chart_of_accounts
  WHERE parent_code IS NOT NULL AND parent_code <> ''
)
SELECT '3_postings_on_parent_accounts' AS audit_query,
       je.account_code,
       MAX(coa.account_name)              AS account_name,
       COUNT(*)                           AS line_count,
       SUM(je.dr_amount)                  AS total_dr,
       SUM(je.cr_amount)                  AS total_cr,
       MIN(je.entry_date)                 AS first_date,
       MAX(je.entry_date)                 AS last_date,
       array_agg(DISTINCT je.ref_table)   AS ref_tables
FROM journal_entries je
JOIN parents p ON p.account_code = je.account_code
LEFT JOIN chart_of_accounts coa ON coa.account_code = je.account_code
GROUP BY je.account_code
ORDER BY line_count DESC;

-- ────────────────────────────────────────────────────────────────────────────
-- (4) أكواد يتيمة: قيود على أكواد غير موجودة في شجرة الحسابات + أكواد فارغة
-- ────────────────────────────────────────────────────────────────────────────
SELECT '4_orphan_codes' AS audit_query,
       COALESCE(NULLIF(je.account_code,''),'(فارغ/NULL)') AS account_code,
       MAX(je.account_name)               AS sample_name_on_je,
       COUNT(*)                           AS line_count,
       SUM(je.dr_amount)                  AS total_dr,
       SUM(je.cr_amount)                  AS total_cr,
       array_agg(DISTINCT je.ref_table)   AS ref_tables
FROM journal_entries je
WHERE je.account_code IS NULL
   OR je.account_code = ''
   OR NOT EXISTS (
        SELECT 1 FROM chart_of_accounts c
        WHERE c.account_code = je.account_code
      )
GROUP BY COALESCE(NULLIF(je.account_code,''),'(فارغ/NULL)')
ORDER BY line_count DESC;

-- ────────────────────────────────────────────────────────────────────────────
-- (5) قيود غير متوازنة (مجموع مدين ≠ مجموع دائن داخل نفس entry_no)
--     دليل مباشر على فشل الحفظ غير الذري في القيد اليدوي
-- ────────────────────────────────────────────────────────────────────────────
SELECT '5_unbalanced_entries' AS audit_query,
       entry_no,
       MIN(entry_date)              AS entry_date,
       MAX(description)             AS description,
       COUNT(*)                     AS line_count,
       SUM(dr_amount)               AS total_dr,
       SUM(cr_amount)               AS total_cr,
       SUM(dr_amount) - SUM(cr_amount) AS diff,
       array_agg(DISTINCT post_status) AS post_statuses
FROM journal_entries
WHERE COALESCE(post_status,'posted') NOT IN ('voided','cancelled')
GROUP BY entry_no
HAVING ABS(SUM(dr_amount) - SUM(cr_amount)) > 0.01
ORDER BY ABS(SUM(dr_amount) - SUM(cr_amount)) DESC;

-- ────────────────────────────────────────────────────────────────────────────
-- (6-أ) قيود مكررة: نفس (ref_table, ref_id) موجود تحت أكثر من entry_no
-- ────────────────────────────────────────────────────────────────────────────
SELECT '6a_duplicate_ref_jes' AS audit_query,
       ref_table, ref_id,
       COUNT(DISTINCT entry_no)     AS entry_count,
       array_agg(DISTINCT entry_no) AS entry_nos,
       SUM(dr_amount)               AS total_dr,
       SUM(cr_amount)               AS total_cr
FROM journal_entries
WHERE ref_id IS NOT NULL
  AND ref_table IS NOT NULL
  AND ref_table NOT IN ('manual','reversal')
  AND COALESCE(post_status,'posted') NOT IN ('voided','cancelled')
GROUP BY ref_table, ref_id
HAVING COUNT(DISTINCT entry_no) > 1
ORDER BY entry_count DESC, ref_table;

-- (6-ب) نسبة قيود المبيعات بدون ref_id (متوقع: كلها تقريبًا — الباج المعروف)
SELECT '6b_sale_jes_missing_ref_id' AS audit_query,
       COUNT(*)                                        AS total_sale_je_lines,
       COUNT(*) FILTER (WHERE ref_id IS NULL)          AS lines_without_ref_id,
       ROUND(100.0 * COUNT(*) FILTER (WHERE ref_id IS NULL) / NULLIF(COUNT(*),0), 1) AS pct_missing
FROM journal_entries
WHERE ref_table = 'sales';

-- ────────────────────────────────────────────────────────────────────────────
-- (7) عمليات مرحّلة (posted) بدون قيد محاسبي مقابل
-- ────────────────────────────────────────────────────────────────────────────
-- (7-أ) مدفوعات
SELECT '7a_payments_without_je' AS audit_query, p.id, p.file_no, p.amount, p.post_status
FROM payments p
WHERE COALESCE(p.post_status,'posted') = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'payments' AND je.ref_id = p.id::text
      AND COALESCE(je.post_status,'posted') <> 'voided'
  )
ORDER BY p.id;

-- (7-ب) مصروفات
SELECT '7b_expenses_without_je' AS audit_query, e.id, e.file_no, e.amount, e.post_status
FROM expenses e
WHERE COALESCE(e.post_status,'posted') = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'expenses' AND je.ref_id = e.id::text
      AND COALESCE(je.post_status,'posted') <> 'voided'
  )
ORDER BY e.id;

-- (7-ج) تحصيلات
SELECT '7c_collections_without_je' AS audit_query, c.id, c.file_no, c.amount, c.post_status
FROM collections c
WHERE COALESCE(c.post_status,'posted') = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'collections' AND je.ref_id = c.id::text
      AND COALESCE(je.post_status,'posted') <> 'voided'
  )
ORDER BY c.id;

-- (7-د) مسحوبات شركاء
SELECT '7d_payouts_without_je' AS audit_query, po.id, po.file_no, po.amount, po.post_status
FROM partner_payouts po
WHERE COALESCE(po.post_status,'posted') = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'partner_payouts' AND je.ref_id = po.id::text
      AND COALESCE(je.post_status,'posted') <> 'voided'
  )
ORDER BY po.id;

-- (7-هـ) مبيعات — بالوصف لأن ref_id مش متسجل (fallback بالفاتورة)
SELECT '7e_sales_without_je' AS audit_query, s.id, s.file_no, s.inv_no, s.sale_price, s.post_status
FROM sales s
WHERE COALESCE(s.post_status,'posted') = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE COALESCE(je.post_status,'posted') <> 'voided'
      AND (
        (je.ref_table = 'sales' AND je.ref_id = s.id::text)
        OR (je.ref_table = 'sales' AND s.inv_no IS NOT NULL AND s.inv_no <> ''
            AND je.description ILIKE '%' || s.inv_no || '%')
      )
  )
ORDER BY s.id;

-- (7-و) أوامر شراء
SELECT '7f_purchases_without_je' AS audit_query, po.id, po.file_no, po.total_purchase, po.post_status
FROM purchase_orders po
WHERE COALESCE(po.post_status,'posted') = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE COALESCE(je.post_status,'posted') <> 'voided'
      AND (
        (je.ref_table = 'purchase_orders' AND je.ref_id = po.id::text)
        OR (je.ref_table = 'purchase_orders' AND je.file_no = po.file_no)
      )
  )
ORDER BY po.id;

-- ────────────────────────────────────────────────────────────────────────────
-- (8) القيود القديمة بدون system_type (سبب اختلاف كشف الحساب عن ميزان المراجعة)
-- ────────────────────────────────────────────────────────────────────────────
SELECT '8_legacy_null_system_type' AS audit_query,
       account_code,
       MAX(account_name)  AS account_name,
       COUNT(*)           AS line_count,
       SUM(dr_amount)     AS total_dr,
       SUM(cr_amount)     AS total_cr
FROM journal_entries
WHERE system_type IS NULL
GROUP BY account_code
ORDER BY line_count DESC;

-- ────────────────────────────────────────────────────────────────────────────
-- (9) خط الأساس: مجاميع كل حساب — مرجع المطابقة لكل المراحل الجاية
--     ⚠️ احتفظ بنسخة من نتيجة الاستعلام ده (Export CSV) قبل أي تعديل
-- ────────────────────────────────────────────────────────────────────────────
SELECT '9_baseline_per_account' AS audit_query,
       system_type,
       account_code,
       MAX(account_name)  AS account_name,
       COUNT(*)           AS line_count,
       SUM(dr_amount)     AS total_dr,
       SUM(cr_amount)     AS total_cr,
       SUM(dr_amount) - SUM(cr_amount) AS net_balance
FROM journal_entries
WHERE COALESCE(post_status,'posted') = 'posted'
GROUP BY system_type, account_code
ORDER BY system_type, account_code;

-- ────────────────────────────────────────────────────────────────────────────
-- (10) خريطة ترحيل الشركاء: أسماء الشركاء على قيود 2400 مقابل
--      الحسابات الفرعية المفتوحة — أساس مرحلة نقل الأرصدة
-- ────────────────────────────────────────────────────────────────────────────
-- (10-أ) الشركاء الظاهرون في قيود 2400
SELECT '10a_contact_names_on_2400' AS audit_query,
       COALESCE(NULLIF(contact_name,''),'(بدون اسم)') AS contact_name,
       COUNT(*)        AS line_count,
       SUM(dr_amount)  AS total_dr,
       SUM(cr_amount)  AS total_cr
FROM journal_entries
WHERE account_code = '2400'
  AND COALESCE(post_status,'posted') NOT IN ('voided','cancelled')
GROUP BY COALESCE(NULLIF(contact_name,''),'(بدون اسم)')
ORDER BY line_count DESC;

-- (10-ب) الشركاء في جدول partners_master مقابل الحسابات الفرعية تحت 2400
--        (مطابقة تقريبية بالاسم — للمراجعة اليدوية)
SELECT '10b_partner_to_subaccount_map' AS audit_query,
       pm.partner,
       sub.account_code AS matched_subaccount_code,
       sub.account_name AS matched_subaccount_name
FROM (SELECT DISTINCT partner FROM partners_master WHERE partner IS NOT NULL AND partner <> '') pm
LEFT JOIN chart_of_accounts sub
  ON sub.parent_code = '2400'
 AND (sub.account_name ILIKE '%' || pm.partner || '%'
      OR pm.partner ILIKE '%' || sub.account_name || '%')
ORDER BY pm.partner;
