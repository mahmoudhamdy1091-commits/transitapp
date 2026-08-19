-- ============================================================================
-- Fleet schema — نظام إدارة أسطول (شركة الترانزيت الدولي لنقل البضائع)
-- مبني على fleet_project_execution_prompt.md v6 + خطة التنفيذ المعتمدة
--
-- تنبيه إلزامي قبل التشغيل (لا يقوم به هذا الملف):
--   Supabase Dashboard → Settings → API → Data API → Exposed schemas → أضف "fleet"
--   بدون هذه الخطوة، الجداول هنا موجودة لكن غير قابلة للاستدعاء عبر REST API.
--
-- هذا الملف يُراجَع ويُشغَّل يدويًا من المستخدم عبر Supabase SQL Editor.
-- لا يُنفَّذ أي جزء منه تلقائيًا من الوكيل.
-- ============================================================================

create schema if not exists fleet;

-- ============================================================================
-- 1) الهوية والعلاقات
-- ============================================================================

create table fleet.fleet_vehicles (
  id           bigint generated always as identity primary key,
  plate_no     text not null,
  chassis_no   text,
  make         text,
  model        text,
  year         int,
  specs        text,
  status       text not null default 'active'
               check (status in ('active','maintenance','sold','archived')),
  created_at   timestamptz not null default now()
);

create table fleet.fleet_drivers (
  id                bigint generated always as identity primary key,
  full_name         text not null,
  civil_id          text,
  phone             text,
  residency_no      text,
  residency_expiry  date,
  status            text not null default 'active'
                    check (status in ('active','inactive')),
  created_at        timestamptz not null default now()
);

-- سجل تاريخي: سيارة ↔ سائق. end_date فارغ = التعيين الحالي/النشط.
-- قيد فريد: سيارة واحدة لا يمكن أن يكون لها أكثر من تعيين نشط في نفس الوقت
-- (السائق نفسه يمكن أن يكون له أكثر من تعيين نشط على سيارات مختلفة — ملفات مستقلة).
create table fleet.fleet_assignments (
  id            bigint generated always as identity primary key,
  vehicle_id    bigint not null references fleet.fleet_vehicles(id),
  driver_id     bigint not null references fleet.fleet_drivers(id),
  monthly_rent  numeric(14,3),
  start_date    date not null,
  end_date      date,
  created_at    timestamptz not null default now()
);

create unique index uq_fleet_assignments_active_vehicle
  on fleet.fleet_assignments(vehicle_id) where end_date is null;

-- ============================================================================
-- 2) دليل الحسابات
-- ============================================================================

create table fleet.fleet_accounts (
  code        text primary key,
  name_ar     text not null,
  name_en     text,
  type        text not null check (type in ('asset','liability','revenue','expense')),
  parent_code text references fleet.fleet_accounts(code)
);

-- بذر مبدئي — placeholder قابل للتعديل بالكامل عبر UPDATE/INSERT عادي
-- بدون أي migration، لحد ما بنود §8 (تفاصيل دليل الحسابات النهائية) تتأكد.
insert into fleet.fleet_accounts (code, name_ar, name_en, type, parent_code) values
  ('1110', 'الصندوق',                     'Cash',                              'asset',     null),
  ('1200', 'ذمم مدينة - سائقين',            'Accounts Receivable - Drivers',    'asset',     null),
  ('2100', 'ذمم دائنة - مصروفات',           'Accounts Payable - Expenses',      'liability', null),
  ('4100', 'إيراد تأجير',                   'Rental Revenue',                   'revenue',   null),
  ('6100', 'مصروفات مركبات',                'Vehicle Expenses',                 'expense',   null),
  ('6110', 'وقود',                          'Fuel',                             'expense',   '6100'),
  ('6120', 'صيانة',                         'Maintenance',                      'expense',   '6100'),
  ('6130', 'مخالفات مرورية',                'Traffic Fines',                    'expense',   '6100'),
  ('6140', 'تأمين',                         'Insurance',                        'expense',   '6100'),
  ('6150', 'رسوم ترخيص / فحص فني',           'Licensing / Inspection Fees',      'expense',   '6100'),
  ('6200', 'مصروفات عمومية وإدارية',         'General & Administrative Expenses','expense',   null),
  ('6210', 'إيجار مكتب',                    'Office Rent',                      'expense',   '6200'),
  ('6220', 'رواتب',                         'Salaries',                         'expense',   '6200'),
  ('6230', 'اتصالات ومرافق',                'Utilities & Communications',       'expense',   '6200')
on conflict (code) do nothing;

-- ============================================================================
-- 3) دفتر اليومية + الترقيم الذرّي
-- ============================================================================

-- نفس نمط je_counters/next_je_no المُثبَت في sql/next_je_no.sql، بجدول ودالة
-- مستقلين تمامًا لـfleet (عزل كامل، بدون أي اعتماد على جداول public.*).
create table fleet.fleet_counters (
  doc_type  text primary key,
  year      int not null,
  counter   int not null default 0
);

create or replace function fleet.fleet_next_seq(p_doc_type text)
returns text
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_year    int := extract(year from now())::int;
  v_counter int;
begin
  insert into fleet.fleet_counters (doc_type, year, counter)
  values (p_doc_type, v_year, 1)
  on conflict (doc_type) do update
    set counter = case when fleet.fleet_counters.year = v_year
                        then fleet.fleet_counters.counter + 1
                        else 1 end,
        year    = v_year
  returning counter into v_counter;
  return upper(p_doc_type) || '-' || v_year || '-' || lpad(v_counter::text, 5, '0');
end;
$$;

-- reverses_entry_no فقط (مش reversed_by) — العلاقة العكسية تُشتق بالاستعلام
-- وقت الحاجة، مش تُخزَّن كحالة مكررة (نفس فلسفة رصيد الفاتورة في §5/§6).
create table fleet.fleet_journal_entries (
  id                bigint generated always as identity primary key,
  entry_no          text not null,
  entry_date        date not null,
  account_code      text not null references fleet.fleet_accounts(code),
  dr_amount         numeric(14,3) not null default 0,
  cr_amount         numeric(14,3) not null default 0,
  description_ar    text,
  description_en    text,
  ref_table         text not null,
  ref_id            bigint not null,
  vehicle_id        bigint references fleet.fleet_vehicles(id),
  driver_id         bigint references fleet.fleet_drivers(id),
  post_status       text not null default 'posted' check (post_status in ('posted','voided')),
  reverses_entry_no text,
  created_at        timestamptz not null default now(),
  check (dr_amount = 0 or cr_amount = 0)
);

create index idx_fje_entry_no  on fleet.fleet_journal_entries(entry_no);
create index idx_fje_reverses  on fleet.fleet_journal_entries(reverses_entry_no);
create index idx_fje_ref       on fleet.fleet_journal_entries(ref_table, ref_id);

-- الدالة المركزية الوحيدة لكتابة أي قيد (§3 بند 6/8/12) — ترفض أي قيد غير
-- متوازن (بدقة 3 خانات عشرية)، إدراج كل السطور في عبارة واحدة (all-or-nothing).
create or replace function fleet.fleet_post_je(
  p_entry_date        date,
  p_lines              jsonb,   -- [{account_code, dr_amount, cr_amount, description_ar, description_en}, ...]
  p_ref_table          text,
  p_ref_id             bigint,
  p_vehicle_id         bigint,
  p_driver_id          bigint,
  p_reverses_entry_no  text default null
) returns text
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_entry_no  text;
  v_dr_sum    numeric(14,3) := 0;
  v_cr_sum    numeric(14,3) := 0;
  v_line      jsonb;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'fleet_post_je: لا يوجد سطور للقيد';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_dr_sum := v_dr_sum + coalesce((v_line->>'dr_amount')::numeric, 0);
    v_cr_sum := v_cr_sum + coalesce((v_line->>'cr_amount')::numeric, 0);
  end loop;

  if round(v_dr_sum, 3) <> round(v_cr_sum, 3) then
    raise exception 'fleet_post_je: قيد غير متوازن (مدين=%، دائن=%)', v_dr_sum, v_cr_sum;
  end if;

  v_entry_no := fleet.fleet_next_seq('je');

  -- ✅ باج حقيقي اكتُشف عبر scripts/regression-fleet.js (مش بالمراجعة الثابتة):
  -- الاسم "v_line" هنا كان بيتصادم مع متغيّر PL/pgSQL المُعلَن فوق (سطر 163،
  -- نفس الاسم مُستخدَم كمتغيّر حلقة FOR في سطر 169) — النتيجة "column reference
  -- v_line is ambiguous" وقت التنفيذ الفعلي، رغم إن المراجعة النصية للكود
  -- ماكانتش قادرة تكتشفه. استخدام alias مختلف هنا (ln) بدل إعادة استخدام نفس
  -- اسم متغيّر PL/pgSQL يقفل فئة الباج دي بالكامل.
  insert into fleet.fleet_journal_entries
    (entry_no, entry_date, account_code, dr_amount, cr_amount,
     description_ar, description_en, ref_table, ref_id,
     vehicle_id, driver_id, post_status, reverses_entry_no)
  select
    v_entry_no, p_entry_date, ln->>'account_code',
    coalesce((ln->>'dr_amount')::numeric, 0),
    coalesce((ln->>'cr_amount')::numeric, 0),
    ln->>'description_ar', ln->>'description_en',
    p_ref_table, p_ref_id, p_vehicle_id, p_driver_id, 'posted', p_reverses_entry_no
  from jsonb_array_elements(p_lines) as ln;

  return v_entry_no;
end;
$$;

-- ============================================================================
-- 4) الإيراد: فواتير الإيجار + سندات القبض
-- ============================================================================

create table fleet.fleet_rent_invoices (
  id            bigint generated always as identity primary key,
  client_uuid   uuid not null unique,
  invoice_no    text not null unique,
  vehicle_id    bigint not null references fleet.fleet_vehicles(id),
  driver_id     bigint not null references fleet.fleet_drivers(id),
  for_month     date not null,               -- اصطلاح: أول يوم في الشهر
  amount        numeric(14,3) not null check (amount > 0),
  issue_date    date not null default current_date,
  post_status   text not null default 'posted' check (post_status in ('posted','voided')),
  created_at    timestamptz not null default now()
);

-- قيد فريد تجاري: فاتورة posted واحدة فقط لكل (سيارة، شهر) — مختلف تمامًا
-- عن client_uuid (idempotency) أعلاه؛ الاثنان يحلّان مشكلتين مختلفتين (§3 بند 8).
create unique index uq_fleet_rent_invoices_active_month
  on fleet.fleet_rent_invoices(vehicle_id, for_month) where post_status = 'posted';

create table fleet.fleet_receipts (
  id                bigint generated always as identity primary key,
  client_uuid       uuid not null unique,
  receipt_no        text not null unique,
  invoice_id        bigint not null references fleet.fleet_rent_invoices(id),
  amount            numeric(14,3) not null check (amount > 0),
  receipt_date      date not null default current_date,
  description_ar    text,
  description_en    text,
  post_status       text not null default 'posted' check (post_status in ('posted','voided')),
  created_at        timestamptz not null default now()
);

create index idx_fleet_receipts_invoice on fleet.fleet_receipts(invoice_id);

-- إصدار فاتورة: يدوي، واحدة في كل مرة (§5) — إدراج الفاتورة وقيدها في نفس
-- استدعاء الدالة (ذرّية §3 بند 12). idempotency عبر client_uuid يُفحَص أولًا.
create or replace function fleet.fleet_issue_invoice(
  p_client_uuid  uuid,
  p_vehicle_id   bigint,
  p_driver_id    bigint,
  p_for_month    date,
  p_amount       numeric,
  p_issue_date   date default current_date
) returns fleet.fleet_rent_invoices
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_invoice           fleet.fleet_rent_invoices;
  v_invoice_no        text;
  v_constraint_name   text;
begin
  select * into v_invoice from fleet.fleet_rent_invoices where client_uuid = p_client_uuid;
  if found then
    return v_invoice;
  end if;

  v_invoice_no := fleet.fleet_next_seq('invoice');

  insert into fleet.fleet_rent_invoices
    (client_uuid, invoice_no, vehicle_id, driver_id, for_month, amount, issue_date, post_status)
  values (p_client_uuid, v_invoice_no, p_vehicle_id, p_driver_id, p_for_month, p_amount, p_issue_date, 'posted')
  returning * into v_invoice;

  perform fleet.fleet_post_je(
    p_issue_date,
    jsonb_build_array(
      jsonb_build_object('account_code','1200','dr_amount',p_amount,'cr_amount',0,
                          'description_ar','فاتورة إيجار '||v_invoice_no,'description_en','Rent invoice '||v_invoice_no),
      jsonb_build_object('account_code','4100','dr_amount',0,'cr_amount',p_amount,
                          'description_ar','فاتورة إيجار '||v_invoice_no,'description_en','Rent invoice '||v_invoice_no)
    ),
    'fleet_rent_invoices', v_invoice.id, p_vehicle_id, p_driver_id, null
  );

  return v_invoice;
exception when unique_violation then
  -- ميّز بين تعارض القيد التجاري (سيارة+شهر مكرر) وأي unique_violation تاني
  -- (مثلاً سباق نادر على client_uuid) — الاتنين مختلفان تمامًا ولازم رسائل مختلفة،
  -- مش نفس النص لأي unique_violation عام (كان أعمّ من اللازم في المسودة الأولى).
  get stacked diagnostics v_constraint_name = constraint_name;
  if v_constraint_name = 'uq_fleet_rent_invoices_active_month' then
    raise exception 'يوجد بالفعل فاتورة مرحّلة لنفس السيارة ونفس الشهر';
  else
    raise;
  end if;
end;
$$;

-- تسوية (سند قبض) — الدالة الأهم لمنع Overpayment تحت تزامن فعلي:
-- تقفل صف الفاتورة (FOR UPDATE)، تعيد حساب الرصيد المتبقي من السندات
-- المرحّلة الفعلية **بعد** القفل، ثم ترفض أو تقبل — نفس نمط post_sale_je.
create or replace function fleet.fleet_settle_invoice(
  p_client_uuid     uuid,
  p_invoice_id      bigint,
  p_amount          numeric,
  p_receipt_date    date default current_date,
  p_description_ar  text default null,
  p_description_en  text default null
) returns fleet.fleet_receipts
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_receipt     fleet.fleet_receipts;
  v_invoice     fleet.fleet_rent_invoices;
  v_paid        numeric(14,3);
  v_remaining   numeric(14,3);
  v_receipt_no  text;
begin
  select * into v_receipt from fleet.fleet_receipts where client_uuid = p_client_uuid;
  if found then
    return v_receipt;
  end if;

  select * into v_invoice from fleet.fleet_rent_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'الفاتورة غير موجودة';
  end if;
  if v_invoice.post_status <> 'posted' then
    raise exception 'لا يمكن التسوية على فاتورة ملغاة';
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from fleet.fleet_receipts where invoice_id = p_invoice_id and post_status = 'posted';
  v_remaining := v_invoice.amount - v_paid;

  if p_amount > v_remaining then
    raise exception 'المبلغ (%) أكبر من الرصيد المتبقي على الفاتورة (%)', p_amount, v_remaining;
  end if;

  v_receipt_no := fleet.fleet_next_seq('receipt');

  insert into fleet.fleet_receipts
    (client_uuid, receipt_no, invoice_id, amount, receipt_date, description_ar, description_en, post_status)
  values (p_client_uuid, v_receipt_no, p_invoice_id, p_amount, p_receipt_date, p_description_ar, p_description_en, 'posted')
  returning * into v_receipt;

  perform fleet.fleet_post_je(
    p_receipt_date,
    jsonb_build_array(
      jsonb_build_object('account_code','1110','dr_amount',p_amount,'cr_amount',0,
                          'description_ar','سند قبض '||v_receipt_no,'description_en','Receipt '||v_receipt_no),
      jsonb_build_object('account_code','1200','dr_amount',0,'cr_amount',p_amount,
                          'description_ar','سند قبض '||v_receipt_no,'description_en','Receipt '||v_receipt_no)
    ),
    'fleet_receipts', v_receipt.id, v_invoice.vehicle_id, v_invoice.driver_id, null
  );

  return v_receipt;
end;
$$;

-- إلغاء سند قبض: قيد عكسي + وضع السند voided. لا تعديل مباشر أبدًا (§3 بند 6/§10).
create or replace function fleet.fleet_void_receipt(p_receipt_id bigint) returns void
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_receipt         fleet.fleet_receipts;
  v_invoice         fleet.fleet_rent_invoices;
  v_orig_entry_no   text;
begin
  select * into v_receipt from fleet.fleet_receipts where id = p_receipt_id for update;
  if not found then raise exception 'السند غير موجود'; end if;
  if v_receipt.post_status <> 'posted' then raise exception 'السند ملغى بالفعل'; end if;

  select * into v_invoice from fleet.fleet_rent_invoices where id = v_receipt.invoice_id;

  select entry_no into v_orig_entry_no from fleet.fleet_journal_entries
    where ref_table = 'fleet_receipts' and ref_id = v_receipt.id and post_status = 'posted' limit 1;

  perform fleet.fleet_post_je(
    current_date,
    jsonb_build_array(
      jsonb_build_object('account_code','1200','dr_amount',v_receipt.amount,'cr_amount',0,
                          'description_ar','عكس سند قبض '||v_receipt.receipt_no,'description_en','Reversal of receipt '||v_receipt.receipt_no),
      jsonb_build_object('account_code','1110','dr_amount',0,'cr_amount',v_receipt.amount,
                          'description_ar','عكس سند قبض '||v_receipt.receipt_no,'description_en','Reversal of receipt '||v_receipt.receipt_no)
    ),
    'fleet_receipts', v_receipt.id, v_invoice.vehicle_id, v_invoice.driver_id, v_orig_entry_no
  );

  update fleet.fleet_receipts set post_status = 'voided' where id = p_receipt_id;
end;
$$;

-- إلغاء فاتورة: يرفض لو عليها أي سند قبض posted (§4/§10 بند 14) — التسويات تُلغى أولًا.
create or replace function fleet.fleet_void_invoice(p_invoice_id bigint) returns void
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_invoice           fleet.fleet_rent_invoices;
  v_orig_entry_no     text;
  v_active_receipts   int;
begin
  select * into v_invoice from fleet.fleet_rent_invoices where id = p_invoice_id for update;
  if not found then raise exception 'الفاتورة غير موجودة'; end if;
  if v_invoice.post_status <> 'posted' then raise exception 'الفاتورة ملغاة بالفعل'; end if;

  select count(*) into v_active_receipts from fleet.fleet_receipts
    where invoice_id = p_invoice_id and post_status = 'posted';
  if v_active_receipts > 0 then
    raise exception 'لا يمكن إلغاء الفاتورة — يوجد % سند قبض مُرحَّل عليها، يجب إلغاؤه أولًا', v_active_receipts;
  end if;

  select entry_no into v_orig_entry_no from fleet.fleet_journal_entries
    where ref_table = 'fleet_rent_invoices' and ref_id = v_invoice.id and post_status = 'posted' limit 1;

  perform fleet.fleet_post_je(
    current_date,
    jsonb_build_array(
      jsonb_build_object('account_code','4100','dr_amount',v_invoice.amount,'cr_amount',0,
                          'description_ar','عكس فاتورة '||v_invoice.invoice_no,'description_en','Reversal of invoice '||v_invoice.invoice_no),
      jsonb_build_object('account_code','1200','dr_amount',0,'cr_amount',v_invoice.amount,
                          'description_ar','عكس فاتورة '||v_invoice.invoice_no,'description_en','Reversal of invoice '||v_invoice.invoice_no)
    ),
    'fleet_rent_invoices', v_invoice.id, v_invoice.vehicle_id, v_invoice.driver_id, v_orig_entry_no
  );

  update fleet.fleet_rent_invoices set post_status = 'voided' where id = p_invoice_id;
end;
$$;

-- ============================================================================
-- 5) المصروف: التزامات + سندات صرف (بنية موازية كاملة للإيراد — §4)
-- ============================================================================

create table fleet.fleet_expense_bills (
  id            bigint generated always as identity primary key,
  client_uuid   uuid not null unique,
  bill_no       text not null unique,
  vehicle_id    bigint references fleet.fleet_vehicles(id),  -- فارغ = مصروف عمومي على الشركة
  account_code  text not null references fleet.fleet_accounts(code),
  for_month     date not null,
  amount        numeric(14,3) not null check (amount > 0),
  issue_date    date not null default current_date,
  post_status   text not null default 'posted' check (post_status in ('posted','voided')),
  created_at    timestamptz not null default now()
);

-- ملاحظة: NULL في vehicle_id لا يتصادم أبدًا مع نفسه في unique index (سلوك
-- Postgres الافتراضي)، فمصروفات عمومية متعددة لنفس الحساب/الشهر مسموحة بلا قيد.
create unique index uq_fleet_expense_bills_active_month
  on fleet.fleet_expense_bills(vehicle_id, account_code, for_month)
  where post_status = 'posted' and vehicle_id is not null;

create table fleet.fleet_payments (
  id                bigint generated always as identity primary key,
  client_uuid       uuid not null unique,
  payment_no        text not null unique,
  bill_id           bigint not null references fleet.fleet_expense_bills(id),
  amount            numeric(14,3) not null check (amount > 0),
  payment_date      date not null default current_date,
  description_ar    text,
  description_en    text,
  post_status       text not null default 'posted' check (post_status in ('posted','voided')),
  created_at        timestamptz not null default now()
);

create index idx_fleet_payments_bill on fleet.fleet_payments(bill_id);

create or replace function fleet.fleet_issue_bill(
  p_client_uuid  uuid,
  p_vehicle_id   bigint,
  p_account_code text,
  p_for_month    date,
  p_amount       numeric,
  p_issue_date   date default current_date
) returns fleet.fleet_expense_bills
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_bill              fleet.fleet_expense_bills;
  v_bill_no           text;
  v_constraint_name   text;
begin
  select * into v_bill from fleet.fleet_expense_bills where client_uuid = p_client_uuid;
  if found then
    return v_bill;
  end if;

  v_bill_no := fleet.fleet_next_seq('bill');

  insert into fleet.fleet_expense_bills
    (client_uuid, bill_no, vehicle_id, account_code, for_month, amount, issue_date, post_status)
  values (p_client_uuid, v_bill_no, p_vehicle_id, p_account_code, p_for_month, p_amount, p_issue_date, 'posted')
  returning * into v_bill;

  perform fleet.fleet_post_je(
    p_issue_date,
    jsonb_build_array(
      jsonb_build_object('account_code',p_account_code,'dr_amount',p_amount,'cr_amount',0,
                          'description_ar','التزام مصروف '||v_bill_no,'description_en','Expense bill '||v_bill_no),
      jsonb_build_object('account_code','2100','dr_amount',0,'cr_amount',p_amount,
                          'description_ar','التزام مصروف '||v_bill_no,'description_en','Expense bill '||v_bill_no)
    ),
    'fleet_expense_bills', v_bill.id, p_vehicle_id, null, null
  );

  return v_bill;
exception when unique_violation then
  -- نفس المنطق المُصحَّح في fleet_issue_invoice أعلاه: تمييز فعلي بين تعارض
  -- القيد التجاري وأي unique_violation آخر، لا رسالة عامة لأي تعارض.
  get stacked diagnostics v_constraint_name = constraint_name;
  if v_constraint_name = 'uq_fleet_expense_bills_active_month' then
    raise exception 'يوجد بالفعل التزام مرحّل لنفس السيارة/التصنيف/الشهر';
  else
    raise;
  end if;
end;
$$;

-- تسوية (سند صرف) — نفس آلية القفل ومنع Overpayment بالضبط.
create or replace function fleet.fleet_settle_bill(
  p_client_uuid     uuid,
  p_bill_id         bigint,
  p_amount          numeric,
  p_payment_date    date default current_date,
  p_description_ar  text default null,
  p_description_en  text default null
) returns fleet.fleet_payments
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_payment     fleet.fleet_payments;
  v_bill        fleet.fleet_expense_bills;
  v_paid        numeric(14,3);
  v_remaining   numeric(14,3);
  v_payment_no  text;
begin
  select * into v_payment from fleet.fleet_payments where client_uuid = p_client_uuid;
  if found then
    return v_payment;
  end if;

  select * into v_bill from fleet.fleet_expense_bills where id = p_bill_id for update;
  if not found then
    raise exception 'الالتزام غير موجود';
  end if;
  if v_bill.post_status <> 'posted' then
    raise exception 'لا يمكن السداد على التزام ملغى';
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from fleet.fleet_payments where bill_id = p_bill_id and post_status = 'posted';
  v_remaining := v_bill.amount - v_paid;

  if p_amount > v_remaining then
    raise exception 'المبلغ (%) أكبر من الرصيد المتبقي على الالتزام (%)', p_amount, v_remaining;
  end if;

  v_payment_no := fleet.fleet_next_seq('payment');

  insert into fleet.fleet_payments
    (client_uuid, payment_no, bill_id, amount, payment_date, description_ar, description_en, post_status)
  values (p_client_uuid, v_payment_no, p_bill_id, p_amount, p_payment_date, p_description_ar, p_description_en, 'posted')
  returning * into v_payment;

  perform fleet.fleet_post_je(
    p_payment_date,
    jsonb_build_array(
      jsonb_build_object('account_code','2100','dr_amount',p_amount,'cr_amount',0,
                          'description_ar','سند صرف '||v_payment_no,'description_en','Payment '||v_payment_no),
      jsonb_build_object('account_code','1110','dr_amount',0,'cr_amount',p_amount,
                          'description_ar','سند صرف '||v_payment_no,'description_en','Payment '||v_payment_no)
    ),
    'fleet_payments', v_payment.id, v_bill.vehicle_id, null, null
  );

  return v_payment;
end;
$$;

create or replace function fleet.fleet_void_payment(p_payment_id bigint) returns void
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_payment        fleet.fleet_payments;
  v_bill           fleet.fleet_expense_bills;
  v_orig_entry_no  text;
begin
  select * into v_payment from fleet.fleet_payments where id = p_payment_id for update;
  if not found then raise exception 'السند غير موجود'; end if;
  if v_payment.post_status <> 'posted' then raise exception 'السند ملغى بالفعل'; end if;

  select * into v_bill from fleet.fleet_expense_bills where id = v_payment.bill_id;

  select entry_no into v_orig_entry_no from fleet.fleet_journal_entries
    where ref_table = 'fleet_payments' and ref_id = v_payment.id and post_status = 'posted' limit 1;

  perform fleet.fleet_post_je(
    current_date,
    jsonb_build_array(
      jsonb_build_object('account_code','1110','dr_amount',v_payment.amount,'cr_amount',0,
                          'description_ar','عكس سند صرف '||v_payment.payment_no,'description_en','Reversal of payment '||v_payment.payment_no),
      jsonb_build_object('account_code','2100','dr_amount',0,'cr_amount',v_payment.amount,
                          'description_ar','عكس سند صرف '||v_payment.payment_no,'description_en','Reversal of payment '||v_payment.payment_no)
    ),
    'fleet_payments', v_payment.id, v_bill.vehicle_id, null, v_orig_entry_no
  );

  update fleet.fleet_payments set post_status = 'voided' where id = p_payment_id;
end;
$$;

create or replace function fleet.fleet_void_bill(p_bill_id bigint) returns void
language plpgsql security definer set search_path = fleet, pg_temp as $$
declare
  v_bill              fleet.fleet_expense_bills;
  v_orig_entry_no     text;
  v_active_payments   int;
begin
  select * into v_bill from fleet.fleet_expense_bills where id = p_bill_id for update;
  if not found then raise exception 'الالتزام غير موجود'; end if;
  if v_bill.post_status <> 'posted' then raise exception 'الالتزام ملغى بالفعل'; end if;

  select count(*) into v_active_payments from fleet.fleet_payments
    where bill_id = p_bill_id and post_status = 'posted';
  if v_active_payments > 0 then
    raise exception 'لا يمكن إلغاء الالتزام — يوجد % سند صرف مُرحَّل عليه، يجب إلغاؤه أولًا', v_active_payments;
  end if;

  select entry_no into v_orig_entry_no from fleet.fleet_journal_entries
    where ref_table = 'fleet_expense_bills' and ref_id = v_bill.id and post_status = 'posted' limit 1;

  perform fleet.fleet_post_je(
    current_date,
    jsonb_build_array(
      jsonb_build_object('account_code','2100','dr_amount',v_bill.amount,'cr_amount',0,
                          'description_ar','عكس التزام '||v_bill.bill_no,'description_en','Reversal of bill '||v_bill.bill_no),
      jsonb_build_object('account_code',v_bill.account_code,'dr_amount',0,'cr_amount',v_bill.amount,
                          'description_ar','عكس التزام '||v_bill.bill_no,'description_en','Reversal of bill '||v_bill.bill_no)
    ),
    'fleet_expense_bills', v_bill.id, v_bill.vehicle_id, null, v_orig_entry_no
  );

  update fleet.fleet_expense_bills set post_status = 'voided' where id = p_bill_id;
end;
$$;

-- ============================================================================
-- 6) عروض مساعدة للقراءة فقط (الرصيد محسوب دائمًا — §4/§6)
-- بدون security definer عمدًا: تعمل بصلاحيات المستخدم المستعلم، فترث RLS
-- الجداول الأصلية تلقائيًا (مش bypass).
-- ============================================================================

create or replace view fleet.v_invoice_balances as
select
  i.*,
  coalesce((select sum(r.amount) from fleet.fleet_receipts r
            where r.invoice_id = i.id and r.post_status = 'posted'), 0) as paid_amount,
  i.amount - coalesce((select sum(r.amount) from fleet.fleet_receipts r
            where r.invoice_id = i.id and r.post_status = 'posted'), 0) as remaining_amount
from fleet.fleet_rent_invoices i
where i.post_status = 'posted';

create or replace view fleet.v_bill_balances as
select
  b.*,
  coalesce((select sum(p.amount) from fleet.fleet_payments p
            where p.bill_id = b.id and p.post_status = 'posted'), 0) as paid_amount,
  b.amount - coalesce((select sum(p.amount) from fleet.fleet_payments p
            where p.bill_id = b.id and p.post_status = 'posted'), 0) as remaining_amount
from fleet.fleet_expense_bills b
where b.post_status = 'posted';

-- ============================================================================
-- 7) RLS — رفض anon بالكامل، سماح للمستخدمين المصادَقين المصرَّح لهم بـFLEET فقط
-- ============================================================================

-- TECH DEBT (مُسجَّلة، غير عاجلة الآن): systems like '%FLEET%' مطابقة substring
-- مش token دقيق — لو ظهر مستقبلًا اسم نظام يحتوي "FLEET" كجزء من كلمة تانية
-- (مثلاً "FLEETX")، هيتفتحله دخول غلط. البيانات الحالية معروفة فمفيش خطر فوري،
-- لكن لازم تتصلح لمطابقة دقيقة (مثلاً string_to_array(systems,',') && array['FLEET'])
-- قبل ما عدد المستخدمين/الأنظمة يزيد. الواجهة (js/transactions.js،
-- checkFleetCompanySwitch) بتستخدم نفس منطق الـsubstring بالظبط عمدًا —
-- عشان الواجهة وRLS يفضلوا متطابقين تمامًا، فلو اتصلحت هنا لازم تتصلح هناك
-- في نفس اللحظة، مش نسخة مستقلة.
create or replace function fleet.is_fleet_user() returns boolean
language sql security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.user_roles
    where email = auth.jwt() ->> 'email'
      and systems like '%FLEET%'
  );
$$;

alter table fleet.fleet_vehicles       enable row level security;
alter table fleet.fleet_drivers        enable row level security;
alter table fleet.fleet_assignments    enable row level security;
alter table fleet.fleet_accounts       enable row level security;
alter table fleet.fleet_journal_entries enable row level security;
alter table fleet.fleet_counters       enable row level security;
alter table fleet.fleet_rent_invoices  enable row level security;
alter table fleet.fleet_receipts       enable row level security;
alter table fleet.fleet_expense_bills  enable row level security;
alter table fleet.fleet_payments       enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'fleet_vehicles','fleet_drivers','fleet_assignments','fleet_accounts',
    'fleet_journal_entries','fleet_counters','fleet_rent_invoices',
    'fleet_receipts','fleet_expense_bills','fleet_payments'
  ] loop
    execute format(
      'create policy fleet_select_authenticated on fleet.%I for select to authenticated using (fleet.is_fleet_user())', t);
    execute format(
      'create policy fleet_insert_authenticated on fleet.%I for insert to authenticated with check (fleet.is_fleet_user())', t);
    execute format(
      'create policy fleet_update_authenticated on fleet.%I for update to authenticated using (fleet.is_fleet_user()) with check (fleet.is_fleet_user())', t);
    -- لا توجد سياسة DELETE عمدًا — الأرشفة عبر UPDATE فقط، لا حذف فعلي (§3 بند 9).
  end loop;
end $$;

-- ============================================================================
-- 8) صلاحيات على مستوى الجدول (RLS وحدها لا تكفي — لازم GRANT كمان)
-- بدون GRANT DELETE على أي جدول إطلاقًا: طبقة حماية إضافية تفرض "أرشفة لا حذف"
-- حتى لو حاول أحد تجاوز الواجهة والاتصال مباشرة بـPostgREST.
-- ============================================================================

grant usage on schema fleet to authenticated;
grant select, insert, update on all tables in schema fleet to authenticated;
grant select on fleet.v_invoice_balances, fleet.v_bill_balances to authenticated;
grant usage, select on all sequences in schema fleet to authenticated;

revoke execute on all functions in schema fleet from anon;
grant execute on function
  fleet.fleet_issue_invoice, fleet.fleet_settle_invoice, fleet.fleet_void_receipt, fleet.fleet_void_invoice,
  fleet.fleet_issue_bill,    fleet.fleet_settle_bill,    fleet.fleet_void_payment, fleet.fleet_void_bill
  to authenticated;

-- ============================================================================
-- الخطوة التالية بعد تشغيل هذا الملف: اختبار حقيقي (Phase 5 من الخطة) —
-- توازن القيد، overpayment تحت تزامن فعلي (نداءات متوازية حقيقية)،
-- idempotency retry، ترتيب void، وRLS بجلستين (anon + حقيقية).
-- ============================================================================
