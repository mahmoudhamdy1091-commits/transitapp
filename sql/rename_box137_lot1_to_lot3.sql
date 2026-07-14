-- Rename file_no "BOX-137 - ( LOT 1 OLD  2024 )" → "BOX-137 - ( LOT 3 OLD  2024 )"
-- across every table that stores it. Runs as one atomic block: any failure
-- rolls back everything automatically (nothing partially changes).
--
-- Why the DO block instead of plain UPDATEs: purchase_orders.file_no is
-- referenced by foreign keys from vehicles (fk_vehicles_file_no) and possibly
-- others — a plain UPDATE on any single table fails with a FK violation
-- because the value must change in parent + all children together. This
-- script finds every FK constraint that touches a "file_no" column (in
-- either direction), drops them, performs the 7 renames, then recreates
-- each constraint from its original definition (pg_get_constraintdef),
-- so the schema ends up byte-identical to before except for the rename.
--
-- Run this once in the Supabase SQL editor. Review before running.

DO $$
DECLARE
  r     RECORD;
  names TEXT[] := '{}';
  tbls  regclass[] := '{}';
  defs  TEXT[] := '{}';
  i     INT;
  old_v TEXT := 'BOX-137 - ( LOT 1 OLD  2024 )';
  new_v TEXT := 'BOX-137 - ( LOT 3 OLD  2024 )';
BEGIN
  -- 1. Find + drop every FK constraint whose local (referencing) column is file_no
  FOR r IN
    SELECT con.conname, con.conrelid::regclass AS tbl, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND EXISTS (
        SELECT 1 FROM unnest(con.conkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
        WHERE a.attname = 'file_no'
      )
  LOOP
    names := array_append(names, r.conname);
    tbls  := array_append(tbls,  r.tbl);
    defs  := array_append(defs,  r.def);
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;

  -- 2. Rename in every table that has a row for this file (system_type='BOX')
  UPDATE purchase_orders SET file_no = new_v WHERE system_type = 'BOX' AND file_no = old_v;
  UPDATE vehicles        SET file_no = new_v WHERE system_type = 'BOX' AND file_no = old_v;
  UPDATE partners_master SET file_no = new_v WHERE system_type = 'BOX' AND file_no = old_v;
  UPDATE payments        SET file_no = new_v WHERE system_type = 'BOX' AND file_no = old_v;
  UPDATE stock_locations SET file_no = new_v WHERE system_type = 'BOX' AND file_no = old_v;
  UPDATE journal_entries SET file_no = new_v WHERE system_type = 'BOX' AND file_no = old_v;
  UPDATE audit_log       SET file_no = new_v WHERE file_no = old_v;

  -- 3. Recreate every constraint exactly as it was
  IF names IS NOT NULL THEN
    FOR i IN 1 .. array_length(names, 1) LOOP
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', tbls[i], names[i], defs[i]);
    END LOOP;
  END IF;
END $$;

-- 4. Verify: should show 0 rows left under the old name, and the expected
--    counts under the new name (purchase_orders=1, vehicles=49,
--    partners_master=1, payments=1, stock_locations=49, journal_entries=4,
--    audit_log=4).
SELECT 'purchase_orders' AS tbl, count(*) FILTER (WHERE file_no = 'BOX-137 - ( LOT 1 OLD  2024 )') AS old_left, count(*) FILTER (WHERE file_no = 'BOX-137 - ( LOT 3 OLD  2024 )') AS new_count FROM purchase_orders
UNION ALL
SELECT 'vehicles', count(*) FILTER (WHERE file_no = 'BOX-137 - ( LOT 1 OLD  2024 )'), count(*) FILTER (WHERE file_no = 'BOX-137 - ( LOT 3 OLD  2024 )') FROM vehicles
UNION ALL
SELECT 'partners_master', count(*) FILTER (WHERE file_no = 'BOX-137 - ( LOT 1 OLD  2024 )'), count(*) FILTER (WHERE file_no = 'BOX-137 - ( LOT 3 OLD  2024 )') FROM partners_master
UNION ALL
SELECT 'payments', count(*) FILTER (WHERE file_no = 'BOX-137 - ( LOT 1 OLD  2024 )'), count(*) FILTER (WHERE file_no = 'BOX-137 - ( LOT 3 OLD  2024 )') FROM payments
UNION ALL
SELECT 'stock_locations', count(*) FILTER (WHERE file_no = 'BOX-137 - ( LOT 1 OLD  2024 )'), count(*) FILTER (WHERE file_no = 'BOX-137 - ( LOT 3 OLD  2024 )') FROM stock_locations
UNION ALL
SELECT 'journal_entries', count(*) FILTER (WHERE file_no = 'BOX-137 - ( LOT 1 OLD  2024 )'), count(*) FILTER (WHERE file_no = 'BOX-137 - ( LOT 3 OLD  2024 )') FROM journal_entries
UNION ALL
SELECT 'audit_log', count(*) FILTER (WHERE file_no = 'BOX-137 - ( LOT 1 OLD  2024 )'), count(*) FILTER (WHERE file_no = 'BOX-137 - ( LOT 3 OLD  2024 )') FROM audit_log;
