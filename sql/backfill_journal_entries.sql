-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  BACKFILL JOURNAL ENTRIES — ترحيل البيانات القديمة              ║
-- ║  ينشئ قيوداً محاسبية مزدوجة لكل سجل ليس له قيد بعد            ║
-- ║  آمن تماماً: يتجاهل السجلات التي لها قيد موجود مسبقاً          ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════
-- خطوة 0: إنشاء دالة مساعدة لتوليد entry_no تسلسلي
-- (تشغّل مرة واحدة فقط — تجاهلها لو موجودة)
-- ════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────
-- 1. PAYMENTS — دفعات الموردين
--    DR 2100 ذمم الموردين / CR 1110|1120 نقد|بنك
--    لو الدافع شريك: DR 2100 / CR 2400 حسابات الشركاء
-- ──────────────────────────────────────────────────────
INSERT INTO journal_entries (
  system_type, entry_no, entry_date,
  account_code, account_name,
  dr_amount, cr_amount,
  contact_name, description,
  ref_table, ref_id, file_no,
  post_status, posted_at
)
SELECT
  p.system_type,
  'BF-PAY-' || p.id::text AS entry_no,
  COALESCE(p.pay_date, p.created_at::date, CURRENT_DATE) AS entry_date,
  -- سطر مدين: ذمم الموردين
  '2100' AS account_code,
  'ذمم الموردين' AS account_name,
  p.amount AS dr_amount,
  0 AS cr_amount,
  COALESCE(p.supplier, p.payer, 'مورد') AS contact_name,
  'دفعة للمورد ' || COALESCE(p.supplier,'') || ' — ملف ' || COALESCE(p.file_no,'') AS description,
  'payments' AS ref_table,
  p.id AS ref_id,
  p.file_no,
  'posted' AS post_status,
  NOW() AS posted_at
FROM payments p
WHERE p.post_status IN ('posted','pending_edit')
  AND p.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'payments'
      AND je.ref_id = p.id
      AND je.account_code = '2100'
  )

UNION ALL

-- سطر دائن: نقد أو بنك أو حساب الشريك
SELECT
  p.system_type,
  'BF-PAY-' || p.id::text AS entry_no,
  COALESCE(p.pay_date, p.created_at::date, CURRENT_DATE),
  CASE
    -- الدافع شريك (ليس المورد نفسه)
    WHEN p.payer IS NOT NULL AND p.payer <> COALESCE(p.supplier,'') AND p.payer <> '' THEN '2400'
    -- دفع من البنك
    WHEN COALESCE(p.pay_method,'') = 'بنك' THEN '1120'
    -- افتراضي: نقد
    ELSE '1110'
  END AS account_code,
  CASE
    WHEN p.payer IS NOT NULL AND p.payer <> COALESCE(p.supplier,'') AND p.payer <> '' THEN 'حسابات الشركاء'
    WHEN COALESCE(p.pay_method,'') = 'بنك' THEN 'البنك'
    ELSE 'النقد'
  END AS account_name,
  0 AS dr_amount,
  p.amount AS cr_amount,
  CASE
    WHEN p.payer IS NOT NULL AND p.payer <> COALESCE(p.supplier,'') AND p.payer <> '' THEN p.payer
    ELSE NULL
  END AS contact_name,
  'دفعة للمورد ' || COALESCE(p.supplier,'') || ' — ملف ' || COALESCE(p.file_no,'') AS description,
  'payments' AS ref_table,
  p.id AS ref_id,
  p.file_no,
  'posted',
  NOW()
FROM payments p
WHERE p.post_status IN ('posted','pending_edit')
  AND p.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'payments'
      AND je.ref_id = p.id
      AND je.account_code = '2100'
  );


-- ──────────────────────────────────────────────────────
-- 2. EXPENSES — المصاريف
--    DR 6xxx/5xxx مصروف / CR 1110|1120 نقد|بنك
-- ──────────────────────────────────────────────────────
INSERT INTO journal_entries (
  system_type, entry_no, entry_date,
  account_code, account_name,
  dr_amount, cr_amount,
  contact_name, description,
  ref_table, ref_id, file_no,
  post_status, posted_at
)
SELECT
  e.system_type,
  'BF-EXP-' || e.id::text,
  COALESCE(e.exp_date, e.expense_date, e.created_at::date, CURRENT_DATE),
  -- كود حساب المصروف حسب النوع
  CASE e.exp_type
    WHEN 'شحن'   THEN '5200'
    WHEN 'جمارك' THEN '6600'
    WHEN 'تأمين' THEN '6600'
    WHEN 'إيجار' THEN '6100'
    WHEN 'رواتب' THEN '6200'
    WHEN 'نقل'   THEN '5200'
    WHEN 'صيانة' THEN '6700'
    WHEN 'تسويق' THEN '6500'
    ELSE '6500'
  END,
  COALESCE(e.exp_type, e.category, 'مصروف'),
  e.amount, 0,
  NULL,
  COALESCE(e.description, e.exp_type, 'مصروف') || ' — ملف ' || COALESCE(e.file_no,'عام'),
  'expenses', e.id, e.file_no,
  'posted', NOW()
FROM expenses e
WHERE e.post_status IN ('posted','pending_edit')
  AND e.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'expenses' AND je.ref_id = e.id
      AND je.dr_amount > 0
  )

UNION ALL

SELECT
  e.system_type,
  'BF-EXP-' || e.id::text,
  COALESCE(e.exp_date, e.expense_date, e.created_at::date, CURRENT_DATE),
  CASE COALESCE(e.pay_method,'') WHEN 'بنك' THEN '1120' ELSE '1110' END,
  CASE COALESCE(e.pay_method,'') WHEN 'بنك' THEN 'البنك' ELSE 'النقد' END,
  0, e.amount,
  NULL,
  COALESCE(e.description, e.exp_type, 'مصروف') || ' — ملف ' || COALESCE(e.file_no,'عام'),
  'expenses', e.id, e.file_no,
  'posted', NOW()
FROM expenses e
WHERE e.post_status IN ('posted','pending_edit')
  AND e.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'expenses' AND je.ref_id = e.id
      AND je.dr_amount > 0
  );


-- ──────────────────────────────────────────────────────
-- 3. SALES — المبيعات
--    DR 1200 ذمم العملاء / CR 4100 إيراد المبيعات
-- ──────────────────────────────────────────────────────
INSERT INTO journal_entries (
  system_type, entry_no, entry_date,
  account_code, account_name,
  dr_amount, cr_amount,
  contact_name, description,
  ref_table, ref_id, file_no,
  post_status, posted_at
)
SELECT
  s.system_type,
  'BF-SAL-' || s.id::text,
  COALESCE(s.sale_date, s.created_at::date, CURRENT_DATE),
  '1200', 'ذمم العملاء',
  s.sale_price, 0,
  s.customer,
  'فاتورة مبيعات ' || COALESCE(s.inv_no,'') || ' — ' || COALESCE(s.customer,'') || ' — ملف ' || COALESCE(s.file_no,''),
  'sales', s.id, s.file_no,
  'posted', NOW()
FROM sales s
WHERE s.post_status IN ('posted','pending_edit')
  AND s.sale_price > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'sales' AND je.ref_id = s.id
      AND je.account_code = '1200'
  )

UNION ALL

-- إيراد
SELECT
  s.system_type,
  'BF-SAL-' || s.id::text,
  COALESCE(s.sale_date, s.created_at::date, CURRENT_DATE),
  '4100', 'إيراد المبيعات',
  0, s.sale_price,
  NULL,
  'فاتورة مبيعات ' || COALESCE(s.inv_no,'') || ' — ' || COALESCE(s.customer,'') || ' — ملف ' || COALESCE(s.file_no,''),
  'sales', s.id, s.file_no,
  'posted', NOW()
FROM sales s
WHERE s.post_status IN ('posted','pending_edit')
  AND s.sale_price > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'sales' AND je.ref_id = s.id
      AND je.account_code = '1200'
  )

UNION ALL

-- تكلفة البضاعة المباعة (COGS): DR 5100 / CR 1300 مخزون
SELECT
  s.system_type,
  'BF-COGS-' || s.id::text,
  COALESCE(s.sale_date, s.created_at::date, CURRENT_DATE),
  '5100', 'تكلفة البضاعة المباعة',
  COALESCE(s.cost_price, s.purchase_price, 0), 0,
  NULL,
  'تكلفة مبيعات — ملف ' || COALESCE(s.file_no,''),
  'sales', s.id, s.file_no,
  'posted', NOW()
FROM sales s
WHERE s.post_status IN ('posted','pending_edit')
  AND COALESCE(s.cost_price, s.purchase_price, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'sales' AND je.ref_id = s.id
      AND je.account_code = '5100'
  )

UNION ALL

SELECT
  s.system_type,
  'BF-COGS-' || s.id::text,
  COALESCE(s.sale_date, s.created_at::date, CURRENT_DATE),
  '1300', 'المخزون',
  0, COALESCE(s.cost_price, s.purchase_price, 0),
  NULL,
  'تكلفة مبيعات — ملف ' || COALESCE(s.file_no,''),
  'sales', s.id, s.file_no,
  'posted', NOW()
FROM sales s
WHERE s.post_status IN ('posted','pending_edit')
  AND COALESCE(s.cost_price, s.purchase_price, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'sales' AND je.ref_id = s.id
      AND je.account_code = '5100'
  );


-- ──────────────────────────────────────────────────────
-- 4. COLLECTIONS — التحصيلات
--    DR 1110|1120 نقد / CR 1200 ذمم العملاء
-- ──────────────────────────────────────────────────────
INSERT INTO journal_entries (
  system_type, entry_no, entry_date,
  account_code, account_name,
  dr_amount, cr_amount,
  contact_name, description,
  ref_table, ref_id, file_no,
  post_status, posted_at
)
SELECT
  c.system_type,
  'BF-COL-' || c.id::text,
  COALESCE(c.paid_date, c.created_at::date, CURRENT_DATE),
  CASE COALESCE(c.pay_method,'') WHEN 'بنك' THEN '1120' ELSE '1110' END,
  CASE COALESCE(c.pay_method,'') WHEN 'بنك' THEN 'البنك' ELSE 'النقد' END,
  c.amount, 0,
  c.customer,
  'تحصيل من ' || COALESCE(c.customer,'') || ' — فاتورة ' || COALESCE(c.inv_no,'') || ' — ملف ' || COALESCE(c.file_no,''),
  'collections', c.id, c.file_no,
  'posted', NOW()
FROM collections c
WHERE c.post_status IN ('posted','pending_edit')
  AND c.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'collections' AND je.ref_id = c.id
      AND je.cr_amount > 0
  )

UNION ALL

SELECT
  c.system_type,
  'BF-COL-' || c.id::text,
  COALESCE(c.paid_date, c.created_at::date, CURRENT_DATE),
  '1200', 'ذمم العملاء',
  0, c.amount,
  c.customer,
  'تحصيل من ' || COALESCE(c.customer,'') || ' — فاتورة ' || COALESCE(c.inv_no,'') || ' — ملف ' || COALESCE(c.file_no,''),
  'collections', c.id, c.file_no,
  'posted', NOW()
FROM collections c
WHERE c.post_status IN ('posted','pending_edit')
  AND c.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'collections' AND je.ref_id = c.id
      AND je.cr_amount > 0
  );


-- ──────────────────────────────────────────────────────
-- 5. PARTNER_PAYOUTS — صرف شركاء
--    DR 2400 حسابات الشركاء / CR 1110|1120 نقد|بنك
-- ──────────────────────────────────────────────────────
INSERT INTO journal_entries (
  system_type, entry_no, entry_date,
  account_code, account_name,
  dr_amount, cr_amount,
  contact_name, description,
  ref_table, ref_id, file_no,
  post_status, posted_at
)
SELECT
  pp.system_type,
  'BF-POUT-' || pp.id::text,
  COALESCE(pp.pay_date, pp.created_at::date, CURRENT_DATE),
  '2400', 'حسابات الشركاء',
  pp.amount, 0,
  pp.partner,
  'صرف شريك ' || COALESCE(pp.partner,'') || ' — ' || COALESCE(pp.payout_type,'صرف') || ' — ملف ' || COALESCE(pp.file_no,''),
  'partner_payouts', pp.id, pp.file_no,
  'posted', NOW()
FROM partner_payouts pp
WHERE pp.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'partner_payouts' AND je.ref_id = pp.id
      AND je.account_code = '2400'
  )

UNION ALL

SELECT
  pp.system_type,
  'BF-POUT-' || pp.id::text,
  COALESCE(pp.pay_date, pp.created_at::date, CURRENT_DATE),
  CASE COALESCE(pp.pay_method,'') WHEN 'بنك' THEN '1120' ELSE '1110' END,
  CASE COALESCE(pp.pay_method,'') WHEN 'بنك' THEN 'البنك' ELSE 'النقد' END,
  0, pp.amount,
  NULL,
  'صرف شريك ' || COALESCE(pp.partner,'') || ' — ' || COALESCE(pp.payout_type,'صرف') || ' — ملف ' || COALESCE(pp.file_no,''),
  'partner_payouts', pp.id, pp.file_no,
  'posted', NOW()
FROM partner_payouts pp
WHERE pp.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.ref_table = 'partner_payouts' AND je.ref_id = pp.id
      AND je.account_code = '2400'
  );


-- ──────────────────────────────────────────────────────
-- 6. تحقق: كم قيد أُنشئ؟
-- ──────────────────────────────────────────────────────
SELECT
  LEFT(entry_no, 6) AS source,
  COUNT(*) AS rows_inserted,
  SUM(dr_amount) AS total_dr,
  SUM(cr_amount) AS total_cr,
  ROUND((SUM(dr_amount) - SUM(cr_amount))::numeric, 2) AS balance_check
FROM journal_entries
WHERE entry_no LIKE 'BF-%'
GROUP BY LEFT(entry_no, 6)
ORDER BY source;
