-- تصحيح تواريخ مصاريف ملف BOX-141 - ( 99  OLD ) إلى 2026-03-05
-- (كانت مسجلة كلها بتاريخ الإدخال 2026-07-14 بدل تاريخ الحدوث الفعلي)

BEGIN;

-- 1) تاريخ المصروف في جدول expenses (7 صفوف)
UPDATE expenses
SET exp_date = '2026-03-05'
WHERE id IN (
  'd60a28a2-7289-4b14-a71f-80d0976cf1f9',  -- تسجيل ولوحات 225
  '1126942b-94fd-41c1-be00-c50d81db75f9',  -- تخليص جمركي 709
  '16d9f96f-b3b0-46bd-aab2-07071bc96665',  -- مصاريف متنوعة 140
  'ec781d0a-94e8-4c85-9362-5c7786f49f02',  -- دهان وتشطيب 50
  '55be6069-d7fc-4295-90a8-c57f1227d094',  -- مصاريف متنوعة 56
  'bd8c5a80-42a1-4e1a-93b5-a8aa60b629b4',  -- مصاريف متنوعة 24
  'bf7270ed-18bd-40e9-9fd0-e9ed2f805a3c'   -- شحن بحري 1650
);

-- 2) تاريخ القيود المطابقة (مطابقة بـ ref_id — كل مصروف له سطرين قيد)
UPDATE journal_entries
SET entry_date = '2026-03-05'
WHERE ref_table = 'expenses'
  AND ref_id IN (
    'd60a28a2-7289-4b14-a71f-80d0976cf1f9',
    '1126942b-94fd-41c1-be00-c50d81db75f9',
    '16d9f96f-b3b0-46bd-aab2-07071bc96665',
    'ec781d0a-94e8-4c85-9362-5c7786f49f02',
    '55be6069-d7fc-4295-90a8-c57f1227d094',
    'bd8c5a80-42a1-4e1a-93b5-a8aa60b629b4',
    'bf7270ed-18bd-40e9-9fd0-e9ed2f805a3c'
  );

-- تحقق: لازم يطلع 7 صفوف كلها 2026-03-05 في expenses، و14 صف (7×2) في journal_entries
SELECT 'expenses' AS tbl, exp_date::text AS entry_date, COUNT(*) FROM expenses
WHERE id IN ('d60a28a2-7289-4b14-a71f-80d0976cf1f9','1126942b-94fd-41c1-be00-c50d81db75f9',
             '16d9f96f-b3b0-46bd-aab2-07071bc96665','ec781d0a-94e8-4c85-9362-5c7786f49f02',
             '55be6069-d7fc-4295-90a8-c57f1227d094','bd8c5a80-42a1-4e1a-93b5-a8aa60b629b4',
             'bf7270ed-18bd-40e9-9fd0-e9ed2f805a3c')
GROUP BY exp_date
UNION ALL
SELECT 'journal_entries', entry_date::text, COUNT(*) FROM journal_entries
WHERE ref_table='expenses' AND ref_id IN
            ('d60a28a2-7289-4b14-a71f-80d0976cf1f9','1126942b-94fd-41c1-be00-c50d81db75f9',
             '16d9f96f-b3b0-46bd-aab2-07071bc96665','ec781d0a-94e8-4c85-9362-5c7786f49f02',
             '55be6069-d7fc-4295-90a8-c57f1227d094','bd8c5a80-42a1-4e1a-93b5-a8aa60b629b4',
             'bf7270ed-18bd-40e9-9fd0-e9ed2f805a3c')
GROUP BY entry_date;

COMMIT;
