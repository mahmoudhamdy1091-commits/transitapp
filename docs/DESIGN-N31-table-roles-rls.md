# N-31 — صلاحيات الجداول على مستوى القاعدة (RLS حسب الدور والنظام)

> **تصميم بس — مفيش SQL لسه.** الترتيب المعتمد: **N-32 (قفل التسجيل) ← N-28 + N-26b ← N-31**.
> المصدر: «فحص قبل ٥» (المالك، 2026-10-01) + قياس المنفّذ (قراءة بس، 2026-10-01).

## ١. المشكلة
- **17 جدول في public** عليهم policy واحدة `ALL to authenticated using (true) with check (true)`:
  account_ledger · chart_of_accounts (×2) · collections · contacts · expenses · journal_attachments ·
  **journal_entries** · operating_expenses · partner_accounts · partner_ledger · partner_payouts ·
  partners_master · payments · purchase_orders · sales · stock_locations · vehicles.
- يعني **أي جلسة authenticated** — حتى:
  - حساب مش في `user_roles` خالص (والتسجيل مفتوح — N-32)،
  - أو readonly،
  - أو أدمن FLEET بس (شريك)،
  
  تقدر **تقرا وتكتب وتمسح** أي صف في BOX وTM مباشرة بـREST، من غير ما تعدّي على أي RPC أو wrapper.
- الأدوار (`permissions.js` ROLES) مطبّقة **في الشاشات بس**:
  | الدور | edit | delete | transactions | approve | settings | roles |
  |---|---|---|---|---|---|---|
  | admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
  | employee | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
  | readonly | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
- fleet: الجداول محكومة بـ`fleet.is_fleet_user()` ✅ (مش جزء من N-31).
- `user_roles`: بيتعالج في N-28 (الكتابة لـ`is_app_admin()` = admin على BOX/TM).

## ٢. الحقائق اللي التصميم مبني عليها (قياس 2026-10-01)
- **كل الجداول فيها `system_type`** (الـ17 + audit_log + user_roles + sale_charges + profit_postings +
  partner_account_links + custody_holders) — `select=system_type` رجع 200 للكل.
- فاضيين: account_ledger · partner_accounts · profit_postings · sale_charges.
- **✅ صفوف `system_type` الـnull = صفر في كل الجداول (اتقاس 2026-10-01، جلسة admin test.verify، `Prefer: count=exact`؛
  الـpolicy الحالية `using (true)` ⇒ العدد كامل مش متفلتر).** 23 جدول (الـ17 + audit_log + user_roles + sale_charges +
  profit_postings + partner_account_links + custody_holders): الكل = BOX + TM بالظبط، صفر null وصفر قيمة تالتة — إلا
  user_roles (3 BOX + 2 FLEET، وده برّه N-31). الأعداد: journal_entries 5363 (BOX 1236 / TM 4127)، audit_log 3570،
  expenses 999، vehicles 754، stock_locations 756، sales 443، payments 289، partners_master 221، collections 198،
  purchase_orders 121، partner_ledger 103، contacts 97، chart_of_accounts 85 (BOX 40 / TM 45)، operating_expenses 17،
  partner_account_links 16، partner_payouts 3، journal_attachments 2، custody_holders 2، والـ4 الفاضيين 0.
  ⇒ §٤-٣ مش مشكلة النهارده، وشرط الـtrigger (مفيش chart_of_accounts بـnull) متحقق. **فاضل:** هل العمود نفسه
  `not null`؟ (جرد ٣) — لو لأ، صف جديد بـnull هيختفي بعد N-31 ⇒ نضيف `not null` في نفس الـSQL (آمن: صفر null).
- **مين بيكتب إيه من الشاشات** (grep js/، apiPost/Patch/Delete + fetch المباشر):
  | الجدول | POST | PATCH | DELETE | ملاحظة |
  |---|---|---|---|---|
  | journal_entries | engine postDoubleEntry (كل ترحيل)، accounting:1352 (يدوي) | engine:970 + postDoubleEntry (reversed_by/is_primary_line)، accounting:1369 | accounting:1434، + postDoubleEntry (تنضيف بعد فشل الإدراج) | employee بيكتب هنا عن طريق تعديل سجل مرحّل (updateJEInPlace) |
  | payments / expenses / collections | شاشات الإدخال (modals/viewer) | التعديل/الاعتماد/الإلغاء | settings:1242/1303/1364، modals:683، dashboard:1606 | |
  | sales / sale_charges | modals/viewer/operations | engine/operations | dashboard:1605-1607، modals:1966 | |
  | purchase_orders | modals:601 | modals/engine/dashboard | — | |
  | vehicles / stock_locations / partners_master | تعديل الملف (modals 619-870) | | **modals:807/809/860 — تعديل الملف بيمسح ويعيد إدراج** | employee (edit) بيمسح هنا |
  | partner_ledger | RPC (secdef) | engine:464، modals:2931 | reports:858/885 | |
  | partner_payouts | modals:2649، viewer:657 | dashboard/modals/viewer | reports:793/819 | |
  | operating_expenses | operations:218 | operations:265 | operations:225/345 | |
  | chart_of_accounts | accounting:801/828 | accounting:827 | accounting:835 | |
  | contacts | accounting/settings | accounting:906 | accounting:921، settings:1011 | |
  | journal_attachments | accounting:677 | — | accounting:688 | + Storage bucket (policies منفصلة — §٧) |
  | audit_log | core:1384 (logAudit) + operations | — | operations:3110 (تنضيف admin) | |
  | partner_accounts | operations:2962 | — | — | الجدول فاضي |
  | account_ledger / profit_postings / partner_account_links / custody_holders | — | — | — | RPCs/SQL بس |
- **مين بيكتب contacts وchart_of_accounts (قياس الشاشات 2026-10-01، §٨):**
  - **contacts — الموظف محتاج INSERT + UPDATE:** `ensureContact` (settings:1052) بيضيف جهة الاتصال تلقائيًا جوّه
    سير الإدخال العادي — modals:384 (شريك في ملف جديد)، 654 (مورد)، 1961/2049/2072/2348 (عميل) — و`acSelectNew`
    (settings:987، «إضافة جديد» في الـautocomplete)؛ والتعديل من `acEditContact` ← `submitContact` (accounting:906).
    **DELETE:** `apiDelete` فيه contacts في `protectedTables` ⇒ admin بس في الشاشة (accounting:921، settings:1011).
  - **chart_of_accounts — مفيش سير شغل موظف بيكتبها:** الكتابة من شاشة «شجرة الحسابات» بس — `seedDefaultAccounts`
    (accounting:801)، `submitAccount` (827/828)، `deleteAccount` (835). والحسابات اللي بتتعمل تلقائيًا (العهد إلخ)
    بتتعمل جوّه RPCs secdef ⇒ مش محتاجة صلاحية جدول.
  - **⚠️ N-34 (اكتشاف عرضي):** الشاشة دي **مش مقفولة بالدور خالص** — قسم «الحسابات» في الـsidebar ظاهر لكل الأدوار،
    والأزرار (حساب جديد / تحميل الافتراضي / تعديل / حذف) من غير `can()`، وchart_of_accounts مش في `protectedTables`
    ⇒ النهارده حتى readonly يقدر من الشاشة يضيف/يعدّل/يمسح حساب. (أثره النهارده صفر: كل المستخدمين admin.)
- **الـRPCs كلها security definer** (صاحبها postgres) ⇒ بتعدّي الـRLS ⇒ مش متأثرة بـN-31.
- **الـtriggers:** `trg_reject_je_on_parent` على journal_entries (invoker — بيقرا chart_of_accounts بنفس
  المستخدم ⇒ لازم القراءة متاحة لنفس النظام ✓)، و`trg_assign_vehicle_file_no` (fleet، secdef).
- **Fleet:** الواجهة بتبعت `Accept-Profile: fleet` وبتلمس جداول fleet بس (fleet_vehicles/drivers/
  assignments/receipts/payments/notes/accounts + viewين `v_invoice_balances`/`v_bill_balances` — fleet-dashboard.js) ⇒ **مش متأثرة**،
  ماعدا الـviewين: بياخدوا `security_invoker = true` في N-31 (§٧-٢) — ومستخدم fleet بيشوف نفس الأرقام (PGlite).

## ٣. التصميم المقترح (المرحلة الأولى — بيقفل الفتحات الكبيرة من غير ما يكسر سير الشغل)
لكل جدول من الـ17 (+ audit_log):
- **SELECT:** المستخدم **مسجّل في النظام ده بأي دور** (admin/employee/readonly).
- **INSERT / UPDATE / DELETE:** **admin أو employee في النظام ده.**
- readonly: قراءة بس. مش مسجّل / أدمن FLEET بس: **ولا حاجة** في BOX/TM.

**ليه DELETE للـemployee برضه في المرحلة الأولى؟** لأن مسارات «تعديل» شرعية بتمسح (تعديل الملف بيمسح
vehicles/stock_locations/partners_master ويعيد إدراجهم؛ postDoubleEntry بيمسح سطور قيد فشل إدراجه).
قصر الـDELETE على admin محتاج تحليل مسار بمسار — **المرحلة التانية** (§٥).

**الشكل (من غير SQL نهائي):**
- دالة helper واحدة secdef stable: `app_systems(p_min_role)` ⇒ `text[]` بالأنظمة اللي المستخدم ليه فيها
  دور ≥ المطلوب (من `user_roles.systems`، و`TRANSIT` ⇒ `TM`، بنفس منطق `app_role`).
- الـpolicy: `system_type = any ((select public.app_systems('readonly')))` للقراءة،
  و`… ('employee')` للكتابة (using + with check).
  - **`(select …)` إلزامي** — بيتحوّل لـinitPlan بيتحسب **مرة واحدة لكل استعلام** بدل مرة لكل صف
    (journal_entries آلاف الصفوف، والصفحات 1000).
  - `with check` على الـINSERT/UPDATE بيمنع كمان **نقل صف لنظام تاني** (system_type جديد مش من أنظمتك).
- **audit_log:** INSERT لأي دور مسجّل في النظام (الـlog بيتكتب من كل الأدوار)؛ UPDATE ممنوع؛ DELETE admin بس.
  - **قياس (2026-10-01):** `logAudit` (core.js:1384) والـ3 inserts المباشرة (operations.js 3004/3814/5544)
    **كلهم بيبعتوا `system_type: state.system`** (BOX/TM دايمًا في التطبيق الأساسي، وFleet مابيكتبش audit_log)
    ⇒ `with check (system_type = any(…))` مش هيرفض سطر شرعي.
  - ⚠️ **لكن `logAudit` بيبلع أي خطأ** (`catch → console.error`) ⇒ لو الـpolicy غلط، السجل هيوقف **بصمت**.
    ⇒ «تحقق بعد» إلزامي: سطر audit جديد بيتكتب بعد أول عملية حقيقية من كل دور.
- **chart_of_accounts (قرار المالك 2026-10-03، بالنص: «موافق، الشجرة للمدير بس») ✅:** SELECT لأي دور مسجّل في النظام،
  و**INSERT / UPDATE / DELETE لـadmin في النظام بس.**
  - القياس (§٢): مفيش سير موظف بيكتبها — الكتابة من شاشة الشجرة بس.
  - **مش متأثر:** الحسابات اللي بتتعمل أوتوماتيك جوّه RPCs secdef — `create_partner_account`
    (sql/create_partner_account.sql:39 `security definer`)، و`create_custody_holder` (sql/b2a_…:100)، والبنوك وأ.ذ.ع
    جوّه B-2f — بتعدّي الـRLS.
  - **الـtrigger `reject_je_on_parent_account`** (m5، invoker — مفيش `security definer` في sql/m5_lock_parent_accounts.sql)
    **بيقرا الشجرة بس** ⇒ القراءة لأي دور في النظام كفاية (employee بيرحّل قيود ✓).
  - N-34 (قفل الشاشة في الواجهة) بند منفصل بعد N-31.
- **contacts (حكم المراجع 2026-10-01 ✅):** INSERT + UPDATE لـadmin أو employee (`ensureContact` جوّه سير الإدخال)،
  و**DELETE لـadmin بس** — زي `protectedTables` في الشاشة، ومفيش مسار employee بيمسح contacts. ده تخصيص للجدول ده
  بس (مش قاعدة «DELETE للـemployee» العامة في المرحلة ١).
- **`system_type` يبقى `not null` في الجداول اللي في النطاق (حكم المراجع 2026-10-01 ✅)** — في نفس SQL الـN-31،
  للأعمدة اللي جرد ٣ يطلّعها nullable بس ⇒ **جرد ٣: audit_log بس** (الباقي NOT NULL أصلًا). + توصية `drop default 'BOX'` (§٧-٣).
  - **ليه:** بعد الـpolicy، صف بـnull **هيختفي بصمت** عن الكل؛ مع `not null` الإدراج **هيفشل بصوت** بدل كده.
  - **آمن النهارده:** صفر null في الـ23 جدول (§٢)، فالـ`alter … set not null` مش هيلاقي صف يرفضه.
  - **الشرط — كل insert بيبعت `system_type` (قياس المنفّذ 2026-10-01):**
    - **js/:** 45 موضع إدراج REST (كل `apiPost` + الـ`fetch` POST المباشر: accounting:801، engine:1107،
      operations:4820/4957/5533/6200) — **الـ45 كلهم فيهم `system_type`** (فحص آلي للـobject بين تعريفه والنداء،
      والاستيراد بيحطه في كل صف من أوله: operations:6064 `{ system_type: state.system, ...schema.fixed }`).
    - **sql/ (الـRPCs):** كل `insert into` على جداول النطاق بيذكر `system_type` في الأعمدة — journal_entries 60،
      audit_log 7، profit_postings 7، partner_ledger 6، chart_of_accounts 5، custody_holders 2، partner_account_links 2،
      purchase_orders/vehicles/sales 1. (اللي مابيذكروش: جداول backup وapp_gates وuser_system_roles — برّه النطاق.)
    - **حدود القياس:** ده الريبو؛ أجسام الحي ممكن تختلف (زي N-33). لكن صفر null من أول ما اشتغلنا بيقول إن مفيش
      مسار حي بيدخّل null — ولو فيه، `not null` هيكشفه برسالة بدل ما يخفي الصف.
- **user_roles:** N-28 (مش هنا).
- **⚠️ (١) الـpolicies الـpermissive بتتجمع بـOR:** لو فضلت أي policy قديمة `true` على الجدول، الجديدة
  مالهاش أي لازمة. ومش policy واحدة لكل جدول: chart_of_accounts عليها **اتنين** (allow_auth +
  auth_all_chart_of_accounts)، وaudit_log عليها **اتنين insert** (audit_insert {public} + auth_insert_audit_log).
  ⇒ الـSQL **يلف على `pg_policies` لكل جدول ويشيل كل الـpolicies القديمة** (مش بالاسم) بعد backup كامل
  (زي N-28)، وبعدين يعمل الجديدة. **«تحقق بعد»:** لكل جدول، مفيش ولا policy غير اللي احنا عملناها،
  ومفيش `qual`/`with_check` = `true`.
- **(٤) helper واحد لتحليل `systems`:** `app_role(p_sys)` (N-28) و`app_systems(p_min_role)` (هنا) **لازم يحللوا
  `user_roles.systems` بنفس الكود بالظبط** (TRANSIT ⇒ TM، والفواصل، والمسافات، وترتيب الأدوار)
  ⇒ دالة داخلية واحدة (مثلًا `_user_system_roles()` ⇒ صفوف `(system, role)` للمستخدم الحالي) والاتنين
  يبنوا عليها. + اختبار (PGlite لو اتسمح) بالقيم الحقيقية من «قبل ٤»: `'BOX,TM,FLEET'`، `'BOX,TM'`، `'FLEET'`.
  ⚠️ لو N-28 اتشغّل الأول بـ`app_role` بشكله الحالي، N-31 يعيد تعريف `app_role` فوق الـhelper (نفس النتيجة،
  ونفس التوقيع).

## ٤. الأثر
| مين | قبل | بعد |
|---|---|---|
| أي حد سجّل حساب (N-32) / مش في user_roles | يقرا ويكتب كل حاجة | **ولا حاجة** |
| أدمن FLEET بس (شريك) | يقرا ويكتب BOX/TM | **ولا حاجة في BOX/TM** (Fleet زي ما هو) |
| readonly | يكتب من الـconsole | **قراءة بس** |
| employee | كل حاجة | قراءة + كتابة في أنظمته بس (والـDELETE لسه متاح — §٥) |
| admin | كل حاجة | زي ما هو في أنظمته |
| RPCs / triggers secdef / Fleet | — | **مش متأثرين** |
| الحالي (الـ4 حسابات كلهم admin) | — | **صفر تغيير** |

- **(٥) لازم المالك يعرف:** أدمن FLEET بس (abdalrahemaljahed = عبد الرحيم الجاحد، **شريك دائم في BOX/TM**)
  **هيخسر حتى القراءة في BOX/TM** بعد N-31. ده متّسق مع الشاشات النهارده (الواجهة مابتفتحلوش BOX/TM أصلًا).
  **لو المالك عايزه يشوف كشوفه:** صف `readonly` لـBOX/TM في `user_roles` — قرار المالك وقت التشغيل.
- **(٣) صفوف `system_type is null`:** ✅ **صفر في كل الجداول (§٢)** ⇒ مفيش backfill ولا policy خاصة؛ و`not null`
  (§٣) بيمنع إنها تظهر بعد كده.

## ٥. المرحلة التانية (بعدين، بقرار المالك)
- DELETE على الجداول المالية = admin بس، بعد ما مسارات «تعديل الملف» وتنضيف postDoubleEntry تتحوّل
  لـRPC أو تتعالج.
- الترحيل (`post_status='posted'` وكتابة journal_entries كقيد جديد) = admin بس على مستوى القاعدة
  (النهارده الاعتماد admin في الشاشة بس — employee يقدر يرحّل من الـconsole).

## ٦. الاختبار
- **مفيش حسابات employee/readonly النهارده** (كل الـ4 admin) ⇒ المالك يعمل حسابين اختبار من اللوحة
  (بعد N-32) ويضيفهم في user_roles (employee BOX، readonly BOX).
- probes حية: قراءة بكل دور (المتوقع عدد صفوف = النظام بتاعه بس)، وكتابة **مرفوضة** (readonly) على صف
  ZZTEST — **بإذن المالك** (لو الـpolicy غلط، المحاولة هتكتب ⇒ ZZTEST + تنضيف مضمون).
- البرنامج كله بالـadmin (زي فحص N-26) + Fleet.

## ٧. الجرد الحي (المالك، 2026-10-03) — النتايج
**(١) الدوال الـinvoker في public/fleet:** اتنين بس.
| الدالة | بتقرا | authenticated / anon | بعد N-31 |
|---|---|---|---|
| `is_permanent_partner` (sql) | partner_account_links | ✓ / ✓ | بتتنادى من جوّه دوال secdef بس (create_custody_holder، post_file_profit_all، m6)، وjs/ وfleet مابينادوهاش ⇒ مش متأثرة ✓. وanon ✓ مش مشكلة: invoker، والـRLS بتقفل anon على الجدول. |
| `is_treasury_name` | — | ✓ / ✓ | من غير جداول ✓ |
- **⚠️ `reject_je_on_parent_account` (حارس م٥) ماظهرتش** ⇒ **جرد ٤ أكّد: مش موجودة على الحي (N-36 في PLAN)**؛ الـtrigger الوحيد في public/fleet = `fleet.fleet_vehicles.trg_assign_vehicle_file_no` (secdef) ⇒ مفيش trigger invoker يتأثر بـN-31. الاستعلام مش ممكن يفوّتها لو موجودة كـinvoker في public
  (نفس الاستعلام طلّعها في PGlite). يعني يا إما **حارس القاعدة بتاع م٥ ماتشغّلش على الحي أصلًا** (آخر تسجيل:
  «حارس القاعدة بانتظار تشغيل المالك (2026-09-21)»، ومفيش تسجيل إنه اتشغّل)، يا إما secdef على الحي. ⇒ **جرد ٤**.
  - لو secdef: مش متأثرة بالـRLS ✓. ولو مش موجودة: مفيش أثر على N-31، بس **قفل الحسابات الأب في القاعدة مش شغّال**
    (الواجهة بس — submitJE)، وده يتسجّل بند لوحده (وsql/b2a وD-1 كانوا فاكرينه شغّال).
- `partner_custody_open_balance` و`partner_ledger_source_check` (B-2e، لسه ماتعملوش): هيتنادوا من جوّه wrappers/_impl secdef ⇒ مش متأثرين.

**(٢) الـviews:** 3.
| الـview | security_invoker | anon | authenticated | بيقرا | الحل |
|---|---|---|---|---|---|
| `public.v_trial_balance` | false | **✓** | ✓ | journal_entries | **N-35 ✅ اتقفل** (sql/n35_…، 130a4b4): revoke anon + security_invoker |
| `fleet.v_invoice_balances` | false | ✗ | ✓ | fleet_rent_invoices، fleet_receipts | **N-31: `security_invoker = true`** |
| `fleet.v_bill_balances` | false | ✗ | ✓ | fleet_expense_bills، fleet_payments | **N-31: `security_invoker = true`** |
- **ليه:** view من غير `security_invoker` بيتنفّذ بصلاحية صاحبه (postgres) ⇒ بيعدّي الـRLS. يعني أي authenticated
  (حتى مستخدم BOX/TM بس) بيقرا فواتير Fleet من الـviewين، رغم إن الجداول نفسها مقفولة بـ`fleet.is_fleet_user()`.
  أثره النهارده صفر: كل المستخدمين ليهم FLEET، وكل الفواتير (5) والـbills (4) voided، فالـviewين بيرجّعوا 0 صف.
  - ⚠️ التعليق في sql/fleet_schema.sql:637-638 («تعمل بصلاحيات المستخدم المستعلم، فترث RLS») **غلط** — يتصحّح في نفس SQL الـN-31.
- **PGlite (11/11):** الـviewين بالحرف من sql/fleet_schema.sql + RLS زي الحي + محاكاة is_fleet_user. قبل: مستخدم مش fleet بيقرا
  الـview (والجدول مباشرة = 0). بعد `security_invoker = true`: مستخدم مش fleet = 0، ومستخدم fleet = نفس الأرقام بالظبط
  (مدفوع/باقي). وإصلاح N-35 بالحرف من الملف: anon ⇒ permission denied، وauthenticated لسه بيقرا. Fleet مش هيتأثر: الـauthenticated
  عنده select على الجداول بالـpolicy.
- **قاعدة من دلوقتي:** أي view جديد = `security_invoker = true` + `revoke all … from anon, public`. و**«تحقق بعد» N-31 = جرد ٢ تاني**:
  كل الصفوف `security_invoker = true` و`anon_select = false`.

**(٣) Storage + أعمدة system_type:**
- **Storage: مفيش خالص** (buckets = null، وstorage policies = null) ⇒ **مقفول**. `journal_attachments.file_url` مش Supabase Storage:
  ده **رابط نصّي بيكتبه المستخدم بإيده** (index.html:3529 «رابط (اختياري)»، accounting.js:673/677) — مفيش رفع ملفات، ومفيش
  `storage/v1` في js/ ولا public/fleet.
- **`system_type` NOT NULL في كل الجداول ماعدا `audit_log` (YES)** ⇒ الـ`not null` في N-31 على **audit_log بس** (صفر null متقاس).
- **⚠️ `default 'BOX'`** على 9 جداول: collections، expenses، partner_payouts، partners_master، payments، purchase_orders، sales،
  user_roles، vehicles ⇒ لو أي insert لـTM نسي system_type، **الصف هيتسجّل BOX بصمت** (ومع N-31 هيروح لنظام غلط من غير أي خطأ).
  - **توصية (قرار المالك — المراجع بيعرضها):** `alter … alter column system_type drop default` على الـ8 اللي في النطاق
    (user_roles برّه النطاق — N-28) ⇒ لو حد نسيه، الإدراج **يقع بصوت** بـNOT NULL.
  - **أثره على المسارات الحالية صفر:** 45/45 insert في js/ وكل inserts الـRPCs بيبعتوا system_type (§٣).

**(٤) جداول في public فيها system_type وبرّه الـ17** (anon ⇒ 200 و`*/0` — مقفولة على anon ✅، المراجع بالمفتاح العام):
| الجدول | بيعمل إيه | مين بيستخدمه | authenticated (admin، قراءة 10-03) |
|---|---|---|---|
| `je_counters` | عدّاد أرقام القيود لكل نظام/سنة | `next_je_no` بس (secdef، sql/next_je_no.sql) ⇒ مش متأثر | **0 صف** — والجدول أكيد فيه صفوف (أرقام JE-2026-… موجودة) ⇒ **مقفول على authenticated** ✅ (استنتاج قوي) |
| `journal_entries_backup_20260714` | نسخة احتياطية من **الصفوف اللي اتغيّرت بس** في ترحيل 07-14 (sql/migrate_capitalize_file_expenses.sql:23 — سطور expenses/reversal على 13 حساب مصروف ليها file_no؛ المتوقع 63 صف) — **مش نسخة كاملة من القيود** | مفيش (مش في js/ ولا fleet) | 0 صف — مقفول ولا فاضي؟ ⇒ جرد ٤ |
| `ledger_entries` | مش معروف — **مش مذكور في أي مكان في الريبو** (js/، public/fleet، sql/، scripts/) ⇒ اتعمل من الـdashboard | مفيش | 0 صف ⇒ جرد ٤ |
| `partner_deal_summary` | نفس الكلام — مش مذكور في الريبو خالص | مفيش | 0 صف ⇒ جرد ٤ |
- **✅ جرد ٤ (10-03): الأربعة RLS = true و0 policies** ⇒ deny-all لـanon وauthenticated عن طريق REST (الـgrants موجودة بس الـRLS بتقفل). je_counters صفين، والـbackup 63 صف، وledger_entries وpartner_deal_summary فاضيين ⇒ **N-31 مايلمسهمش.**
- **قرار المالك (في الآخر):** لكل جدول: (أ) RLS شغّالة ومفيش policy ⇒ مقفول على الكل ماعدا postgres/service_role — يفضل كده
  ولا يتشال؟ (ب) لو RLS مش شغّالة ⇒ تتشغّل في N-31. **الحذف قرار المالك بس** (والـbackup فيه أرقام حقيقية).

**جرد ٤ (متابعة — استعلام واحد، اتجرّب على PGlite):** الـtriggers على جداول public/fleet ونوع دالتها (يحسم م٥) + حالة الـ4 جداول
(rls، force، عدد الـpolicies، عدد الصفوف التقريبي n_live_tup، وصلاحيات anon/authenticated).

## ٨. مفتوح
- ✅ عدد صفوف `system_type is null` = صفر في كل الجداول (§٢).
- ✅ contacts: INSERT + UPDATE لـadmin/employee، وDELETE admin بس (حكم المراجع، §٣).
- ✅ **قرار المالك (2026-10-03):** كتابة chart_of_accounts = **admin بس**؛ القراءة لأي دور في النظام (§٣).
- ✅ `not null` على system_type ⇒ **audit_log بس** (الباقي NOT NULL أصلًا — جرد ٣).
- ✅ Storage مفيش (§٧-٣). ✅ N-35 (v_trial_balance) اتقفل. ✅ viewين fleet ⇒ `security_invoker = true` في N-31 (PGlite 11/11).
- ⏳ **توصية للمالك:** `drop default 'BOX'` على الـ8 جداول اللي في النطاق (§٧-٣).
- ✅ **جرد ٤:** م٥ مش موجود على الحي (N-36 — قرار بعد N-31)؛ الـ4 جداول deny-all (RLS بدون policies) ⇒ N-31 مايلمسهمش.
- ⏳ **قرار المالك في الآخر:** شيل ledger_entries وpartner_deal_summary (فاضيين ومش مستخدمين) وjournal_entries_backup_20260714 (63 صف) ولا يفضلوا.
- ✅ **N-34 اتشال بقرار المالك (10-03)** — قفل القاعدة على chart_of_accounts (admin بس) فاضل هنا.
- **الترتيب ثابت:** N-32 ← N-28/N-26b ← N-31.
