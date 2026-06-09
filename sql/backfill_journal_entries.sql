DO $$
BEGIN

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. PAYMENTS  DR 2100 / CR 2400 or 1120 or 1110
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSERT INTO journal_entries
  (system_type, entry_no, entry_date, entry_type,
   account_code, account_name, dr_amount, cr_amount,
   contact_name, description, ref_table, ref_id, file_no,
   post_status, posted_at)
SELECT
  p.system_type, 'BF-PAY-' || p.id::text,
  COALESCE(p.pay_date, p.created_at::date, CURRENT_DATE), 'journal',
  '2100', 'ذمم الموردين', p.amount, 0,
  COALESCE(po.supplier, p.payer, 'مورد'),
  'دفعة - ملف ' || COALESCE(p.file_no,'') || ' - ' || COALESCE(p.payer,''),
  'payments', p.id::text, p.file_no, 'posted', NOW()
FROM payments p
LEFT JOIN LATERAL (
  SELECT supplier FROM purchase_orders
  WHERE system_type = p.system_type AND file_no = p.file_no LIMIT 1
) po ON true
WHERE p.post_status IN ('posted','pending_edit') AND p.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.entry_no = 'BF-PAY-' || p.id::text AND j.dr_amount > 0
  );

INSERT INTO journal_entries
  (system_type, entry_no, entry_date, entry_type,
   account_code, account_name, dr_amount, cr_amount,
   contact_name, description, ref_table, ref_id, file_no,
   post_status, posted_at)
SELECT
  p.system_type, 'BF-PAY-' || p.id::text,
  COALESCE(p.pay_date, p.created_at::date, CURRENT_DATE), 'journal',
  CASE
    WHEN p.payer IS NOT NULL AND p.payer <> '' AND p.payer <> COALESCE(po.supplier,'')
    THEN '2400'
    WHEN COALESCE(p.pay_method,'') IN ('بنك','تحويل بنكي') THEN '1120'
    ELSE '1110'
  END,
  CASE
    WHEN p.payer IS NOT NULL AND p.payer <> '' AND p.payer <> COALESCE(po.supplier,'')
    THEN 'حسابات الشركاء'
    WHEN COALESCE(p.pay_method,'') IN ('بنك','تحويل بنكي') THEN 'البنك'
    ELSE 'النقد'
  END,
  0, p.amount,
  CASE
    WHEN p.payer IS NOT NULL AND p.payer <> '' AND p.payer <> COALESCE(po.supplier,'')
    THEN p.payer ELSE NULL
  END,
  'دفعة - ملف ' || COALESCE(p.file_no,'') || ' - ' || COALESCE(p.payer,''),
  'payments', p.id::text, p.file_no, 'posted', NOW()
FROM payments p
LEFT JOIN LATERAL (
  SELECT supplier FROM purchase_orders
  WHERE system_type = p.system_type AND file_no = p.file_no LIMIT 1
) po ON true
WHERE p.post_status IN ('posted','pending_edit') AND p.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.entry_no = 'BF-PAY-' || p.id::text AND j.cr_amount > 0
  );

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. EXPENSES  DR 6xxx/5xxx / CR 1120 or 1110
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSERT INTO journal_entries
  (system_type, entry_no, entry_date, entry_type,
   account_code, account_name, dr_amount, cr_amount,
   contact_name, description, ref_table, ref_id, file_no,
   post_status, posted_at)
SELECT
  e.system_type, 'BF-EXP-' || e.id::text,
  COALESCE(e.exp_date, e.expense_date, e.created_at::date, CURRENT_DATE), 'journal',
  CASE COALESCE(e.exp_type, e.category,'')
    WHEN 'شحن' THEN '5200' WHEN 'جمارك' THEN '6600' WHEN 'تأمين' THEN '6600'
    WHEN 'إيجار' THEN '6100' WHEN 'رواتب' THEN '6200' WHEN 'نقل' THEN '5200'
    WHEN 'صيانة' THEN '6700' WHEN 'تسويق' THEN '6500' ELSE '6500'
  END,
  COALESCE(e.exp_type, e.category, 'مصروف'),
  e.amount, 0, NULL,
  COALESCE(e.description, e.exp_type, e.category, 'مصروف') || ' - ملف ' || COALESCE(e.file_no,'عام'),
  'expenses', e.id::text, e.file_no, 'posted', NOW()
FROM expenses e
WHERE e.post_status IN ('posted','pending_edit') AND e.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.entry_no = 'BF-EXP-' || e.id::text AND j.dr_amount > 0
  );

INSERT INTO journal_entries
  (system_type, entry_no, entry_date, entry_type,
   account_code, account_name, dr_amount, cr_amount,
   contact_name, description, ref_table, ref_id, file_no,
   post_status, posted_at)
SELECT
  e.system_type, 'BF-EXP-' || e.id::text,
  COALESCE(e.exp_date, e.expense_date, e.created_at::date, CURRENT_DATE), 'journal',
  CASE COALESCE(e.pay_method,'') WHEN 'بنك' THEN '1120' WHEN 'تحويل بنكي' THEN '1120' ELSE '1110' END,
  CASE COALESCE(e.pay_method,'') WHEN 'بنك' THEN 'البنك' WHEN 'تحويل بنكي' THEN 'البنك' ELSE 'النقد' END,
  0, e.amount, NULL,
  COALESCE(e.description, e.exp_type, e.category, 'مصروف') || ' - ملف ' || COALESCE(e.file_no,'عام'),
  'expenses', e.id::text, e.file_no, 'posted', NOW()
FROM expenses e
WHERE e.post_status IN ('posted','pending_edit') AND e.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.entry_no = 'BF-EXP-' || e.id::text AND j.cr_amount > 0
  );

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. SALES  DR 1200 / CR 4100
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSERT INTO journal_entries
  (system_type, entry_no, entry_date, entry_type,
   account_code, account_name, dr_amount, cr_amount,
   contact_name, description, ref_table, ref_id, file_no,
   post_status, posted_at)
SELECT
  s.system_type, 'BF-SAL-' || s.id::text,
  COALESCE(s.sale_date, s.created_at::date, CURRENT_DATE), 'journal',
  '1200', 'ذمم العملاء', s.sale_price, 0, s.customer,
  'فاتورة ' || COALESCE(s.inv_no,'') || ' - ' || COALESCE(s.customer,'') || ' - ملف ' || COALESCE(s.file_no,''),
  'sales', s.id::text, s.file_no, 'posted', NOW()
FROM sales s
WHERE s.post_status IN ('posted','pending_edit') AND s.sale_price > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.entry_no = 'BF-SAL-' || s.id::text AND j.dr_amount > 0
  );

INSERT INTO journal_entries
  (system_type, entry_no, entry_date, entry_type,
   account_code, account_name, dr_amount, cr_amount,
   contact_name, description, ref_table, ref_id, file_no,
   post_status, posted_at)
SELECT
  s.system_type, 'BF-SAL-' || s.id::text,
  COALESCE(s.sale_date, s.created_at::date, CURRENT_DATE), 'journal',
  '4100', 'ايراد المبيعات', 0, s.sale_price, NULL,
  'فاتورة ' || COALESCE(s.inv_no,'') || ' - ' || COALESCE(s.customer,'') || ' - ملف ' || COALESCE(s.file_no,''),
  'sales', s.id::text, s.file_no, 'posted', NOW()
FROM sales s
WHERE s.post_status IN ('posted','pending_edit') AND s.sale_price > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.entry_no = 'BF-SAL-' || s.id::text AND j.cr_amount > 0
  );

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. COLLECTIONS  DR 1120/1110 / CR 1200
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSERT INTO journal_entries
  (system_type, entry_no, entry_date, entry_type,
   account_code, account_name, dr_amount, cr_amount,
   contact_name, description, ref_table, ref_id, file_no,
   post_status, posted_at)
SELECT
  c.system_type, 'BF-COL-' || c.id::text,
  COALESCE(c.paid_date, c.created_at::date, CURRENT_DATE), 'journal',
  CASE COALESCE(c.pay_method,'') WHEN 'بنك' THEN '1120' WHEN 'تحويل بنكي' THEN '1120' ELSE '1110' END,
  CASE COALESCE(c.pay_method,'') WHEN 'بنك' THEN 'البنك' WHEN 'تحويل بنكي' THEN 'البنك' ELSE 'النقد' END,
  c.amount, 0, c.customer,
  'تحصيل ' || COALESCE(c.inv_no,'') || ' - ' || COALESCE(c.customer,'') || ' - ملف ' || COALESCE(c.file_no,''),
  'collections', c.id::text, c.file_no, 'posted', NOW()
FROM collections c
WHERE c.post_status IN ('posted','pending_edit') AND c.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.entry_no = 'BF-COL-' || c.id::text AND j.dr_amount > 0
  );

INSERT INTO journal_entries
  (system_type, entry_no, entry_date, entry_type,
   account_code, account_name, dr_amount, cr_amount,
   contact_name, description, ref_table, ref_id, file_no,
   post_status, posted_at)
SELECT
  c.system_type, 'BF-COL-' || c.id::text,
  COALESCE(c.paid_date, c.created_at::date, CURRENT_DATE), 'journal',
  '1200', 'ذمم العملاء', 0, c.amount, c.customer,
  'تحصيل ' || COALESCE(c.inv_no,'') || ' - ' || COALESCE(c.customer,'') || ' - ملف ' || COALESCE(c.file_no,''),
  'collections', c.id::text, c.file_no, 'posted', NOW()
FROM collections c
WHERE c.post_status IN ('posted','pending_edit') AND c.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.entry_no = 'BF-COL-' || c.id::text AND j.cr_amount > 0
  );

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. PARTNER_PAYOUTS  DR 2400 / CR 1120 or 1110
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSERT INTO journal_entries
  (system_type, entry_no, entry_date, entry_type,
   account_code, account_name, dr_amount, cr_amount,
   contact_name, description, ref_table, ref_id, file_no,
   post_status, posted_at)
SELECT
  pp.system_type, 'BF-POUT-' || pp.id::text,
  COALESCE(pp.pay_date, pp.created_at::date, CURRENT_DATE), 'journal',
  '2400', 'حسابات الشركاء', pp.amount, 0, pp.partner,
  'صرف شريك ' || COALESCE(pp.partner,'') || ' - ' || COALESCE(pp.payout_type,'صرف') || ' - ملف ' || COALESCE(pp.file_no,''),
  'partner_payouts', pp.id::text, pp.file_no, 'posted', NOW()
FROM partner_payouts pp
WHERE pp.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.entry_no = 'BF-POUT-' || pp.id::text AND j.dr_amount > 0
  );

INSERT INTO journal_entries
  (system_type, entry_no, entry_date, entry_type,
   account_code, account_name, dr_amount, cr_amount,
   contact_name, description, ref_table, ref_id, file_no,
   post_status, posted_at)
SELECT
  pp.system_type, 'BF-POUT-' || pp.id::text,
  COALESCE(pp.pay_date, pp.created_at::date, CURRENT_DATE), 'journal',
  CASE COALESCE(pp.pay_method,'') WHEN 'بنك' THEN '1120' WHEN 'تحويل بنكي' THEN '1120' ELSE '1110' END,
  CASE COALESCE(pp.pay_method,'') WHEN 'بنك' THEN 'البنك' WHEN 'تحويل بنكي' THEN 'البنك' ELSE 'النقد' END,
  0, pp.amount, NULL,
  'صرف شريك ' || COALESCE(pp.partner,'') || ' - ' || COALESCE(pp.payout_type,'صرف') || ' - ملف ' || COALESCE(pp.file_no,''),
  'partner_payouts', pp.id::text, pp.file_no, 'posted', NOW()
FROM partner_payouts pp
WHERE pp.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.entry_no = 'BF-POUT-' || pp.id::text AND j.cr_amount > 0
  );

END $$;
