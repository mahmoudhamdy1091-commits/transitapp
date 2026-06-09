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
    WHERE j.ref_table = 'payments' AND j.dr_amount > 0
      AND (
        j.ref_id = p.id::text
        OR (j.ref_id IS NULL AND j.entry_no NOT LIKE 'BF-%'
            AND j.file_no    = p.file_no
            AND j.entry_date = COALESCE(p.pay_date, p.created_at::date, CURRENT_DATE)
            AND j.dr_amount  = p.amount)
      )
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
    WHERE j.ref_table = 'payments' AND j.cr_amount > 0
      AND (
        j.ref_id = p.id::text
        OR (j.ref_id IS NULL AND j.entry_no NOT LIKE 'BF-%'
            AND j.file_no    = p.file_no
            AND j.entry_date = COALESCE(p.pay_date, p.created_at::date, CURRENT_DATE)
            AND j.cr_amount  = p.amount)
      )
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
    WHEN 'شحن بحري'     THEN '5200'
    WHEN 'شحن داخلي'    THEN '5210'
    WHEN 'نقل'          THEN '5210'
    WHEN 'تأمين الشحنة' THEN '5220'
    WHEN 'تأمين'        THEN '5220'
    WHEN 'جمارك'        THEN '5300'
    WHEN 'رسوم ميناء'   THEN '5310'
    WHEN 'تخليص جمركي'  THEN '5320'
    WHEN 'فحص وتقييم'   THEN '5400'
    WHEN 'صيانة وإصلاح' THEN '5410'
    WHEN 'صيانة'        THEN '5410'
    WHEN 'دهان وتشطيب'  THEN '5420'
    WHEN 'تسجيل ولوحات' THEN '5430'
    WHEN 'عمولة وسيط'   THEN '6510'
    WHEN 'رسوم حكومية'  THEN '6610'
    WHEN 'شحن'          THEN '5200'
    ELSE '6700'
  END,
  COALESCE(e.exp_type, e.category, 'مصروف'),
  e.amount, 0, NULL,
  COALESCE(e.description, e.exp_type, e.category, 'مصروف') || ' - ملف ' || COALESCE(e.file_no,'عام'),
  'expenses', e.id::text, e.file_no, 'posted', NOW()
FROM expenses e
WHERE e.post_status IN ('posted','pending_edit') AND e.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.ref_table = 'expenses' AND j.ref_id = e.id::text AND j.dr_amount > 0
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
    WHERE j.ref_table = 'expenses' AND j.ref_id = e.id::text AND j.cr_amount > 0
  );

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. SALES  DR 1200 / CR 4100
-- مجمّع بـ inv_no تماماً كالنظام (فاتورة واحدة = قيد واحد)
-- يتجاهل أي فاتورة عندها قيد حقيقي موجود (غير BF)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSERT INTO journal_entries
  (system_type, entry_no, entry_date, entry_type,
   account_code, account_name, dr_amount, cr_amount,
   contact_name, description, ref_table, ref_id, file_no,
   post_status, posted_at)
SELECT
  s.system_type,
  'BF-SAL-' || s.system_type || '-' || s.file_no || '-' || COALESCE(s.inv_no, s.file_no),
  MIN(COALESCE(s.sale_date, s.created_at::date, CURRENT_DATE)),
  'journal',
  '1200', 'ذمم العملاء',
  SUM(s.sale_price), 0,
  MAX(s.customer),
  'فاتورة ' || COALESCE(s.inv_no,'') || ' - ' || MAX(s.customer) || ' - ملف ' || s.file_no,
  'sales', NULL, s.file_no, 'posted', NOW()
FROM sales s
WHERE s.post_status IN ('posted','pending_edit') AND s.sale_price > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.system_type  = s.system_type
      AND j.file_no      = s.file_no
      AND j.account_code = '1200'
      AND j.dr_amount    > 0
      AND j.entry_no NOT LIKE 'BF-%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.entry_no = 'BF-SAL-' || s.system_type || '-' || s.file_no || '-' || COALESCE(s.inv_no, s.file_no)
      AND j.dr_amount > 0
  )
GROUP BY s.system_type, s.file_no, s.inv_no;

INSERT INTO journal_entries
  (system_type, entry_no, entry_date, entry_type,
   account_code, account_name, dr_amount, cr_amount,
   contact_name, description, ref_table, ref_id, file_no,
   post_status, posted_at)
SELECT
  s.system_type,
  'BF-SAL-' || s.system_type || '-' || s.file_no || '-' || COALESCE(s.inv_no, s.file_no),
  MIN(COALESCE(s.sale_date, s.created_at::date, CURRENT_DATE)),
  'journal',
  '4100', 'ايراد المبيعات',
  0, SUM(s.sale_price), NULL,
  'فاتورة ' || COALESCE(s.inv_no,'') || ' - ' || MAX(s.customer) || ' - ملف ' || s.file_no,
  'sales', NULL, s.file_no, 'posted', NOW()
FROM sales s
WHERE s.post_status IN ('posted','pending_edit') AND s.sale_price > 0
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.system_type  = s.system_type
      AND j.file_no      = s.file_no
      AND j.account_code = '1200'
      AND j.dr_amount    > 0
      AND j.entry_no NOT LIKE 'BF-%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.entry_no = 'BF-SAL-' || s.system_type || '-' || s.file_no || '-' || COALESCE(s.inv_no, s.file_no)
      AND j.cr_amount > 0
  )
GROUP BY s.system_type, s.file_no, s.inv_no;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. COLLECTIONS  DR 1120/1110 / CR 1200
-- يتجاهل أي ملف عنده قيد تحصيل حقيقي (غير BF)
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
    -- لو في قيد تحصيل حقيقي لهذا الملف → تجاهل
    SELECT 1 FROM journal_entries j
    WHERE j.system_type  = c.system_type
      AND j.file_no      = c.file_no
      AND j.account_code = '1200'
      AND j.cr_amount    > 0
      AND j.entry_no NOT LIKE 'BF-%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.ref_table = 'collections' AND j.ref_id = c.id::text AND j.dr_amount > 0
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
    WHERE j.system_type  = c.system_type
      AND j.file_no      = c.file_no
      AND j.account_code = '1200'
      AND j.cr_amount    > 0
      AND j.entry_no NOT LIKE 'BF-%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries j
    WHERE j.ref_table = 'collections' AND j.ref_id = c.id::text AND j.cr_amount > 0
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
    WHERE j.ref_table = 'partner_payouts' AND j.ref_id = pp.id::text AND j.dr_amount > 0
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
    WHERE j.ref_table = 'partner_payouts' AND j.ref_id = pp.id::text AND j.cr_amount > 0
  );

END $$;
