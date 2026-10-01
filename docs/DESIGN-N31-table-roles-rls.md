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
- **⚠️ لسه مااتقاسش:** عدد الصفوف اللي `system_type` فيها **null** في كل جدول — `apiGetAll` بيضم
  صفوف `system_type=is.null` لكل نظام، فلو فيه صفوف كده، أي policy مبنية على النظام هتخفيها.
  (محتاج جلسة admin — القياس جاهز، `select=id&system_type=is.null` بـ`Prefer: count=exact`.)
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
- **الـRPCs كلها security definer** (صاحبها postgres) ⇒ بتعدّي الـRLS ⇒ مش متأثرة بـN-31.
- **الـtriggers:** `trg_reject_je_on_parent` على journal_entries (invoker — بيقرا chart_of_accounts بنفس
  المستخدم ⇒ لازم القراءة متاحة لنفس النظام ✓)، و`trg_assign_vehicle_file_no` (fleet، secdef).
- **Fleet:** الواجهة بتبعت `Accept-Profile: fleet` وبتلمس جداول fleet بس (fleet_vehicles/drivers/
  assignments/receipts/payments/notes/accounts + views) ⇒ **مش متأثرة**.

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
- **chart_of_accounts:** كتابة admin بس (شاشة الشجرة إدارية) — يتأكد في القياس.
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
- **(٣) صفوف `system_type is null`:** بعد N-31 **هتختفي عن الكل** (الـpolicy بتقارن بأنظمة المستخدم).
  ⇒ لكل جدول فيه null: العدد + عينة، والقرار يتكتب هنا قبل الـSQL: **backfill بـSQL بإذن المالك** (لو النظام
  واضح من file_no/السياق) **أو policy قراءة للـadmin على null**. ⏳ القياس مستني جلسة admin.

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

## ٧. برّه N-31 (للتسجيل)
- **Storage** (bucket المرفقات — journal_attachments.file_url): policies الـbucket منفصلة — محتاجة جرد.
- views في public (لو فيه) بتتنفّذ بصلاحية صاحبها ⇒ ممكن تعدّي الـRLS — محتاجة جرد (`security_invoker`).
- **الدوال الـinvoker اللي بتقرا جداول** هتتفلتر بالـRLS بعد N-31 لو اتنادت من سياق مستخدم (جرد sql/، 2026-10-01):
  | الدالة | بتقرا | بتتنادى من | بعد N-31 |
  |---|---|---|---|
  | `reject_je_on_parent_account` (trigger على journal_entries) | chart_of_accounts | إدراج سطر قيد — **بنفس المستخدم** | بيقرا شجرة نفس النظام بتاع السطر ⇒ مسموحة (المستخدم كاتب في النظام ده) ✓ — بشرط مفيش chart_of_accounts بـsystem_type null (§٨) |
  | `partner_custody_open_balance`، `partner_ledger_source_check` (B-2e، لسه) | custody_holders، journal_entries، chart_of_accounts | جوّه create/update_partner_ledger_entry (secdef) ⇒ current_user = postgres | مش متأثرة ✓ |
  | `is_treasury_name` | — | — | ✓ |
  | `is_permanent_partner` (على الحي invoker، مش في الريبو) | partner_account_links غالبًا | جوّه create_custody_holder وpost_file_profit_all ودوال m6 (secdef) — **js/ وfleet مابينادوهاش بـRPC خالص** (grep 2026-10-01: ذكر واحد في تعليق core.js:1224) | ✓ — **ويتأكد بجرد حي** إن مفيش caller تاني من سياق مستخدم |
  ⇒ «فحص قبل» لـN-31: كل دوال public **invoker** وأي واحدة بتتنادى مباشرة من الـAPI (`has_function_privilege('authenticated')`)
  وبتقرا جداول — جرد حي قبل الـSQL.

## ٨. مفتوح
- عدد صفوف `system_type is null` في كل جدول + عينة + القرار (§٢، §٤-٣) — ⏳ مستني جلسة admin.
- هل `chart_of_accounts`/`contacts` محتاجين كتابة employee؟ (المنفّذ يقيس من الشاشات.)
- جرد حي: الدوال الـinvoker اللي بتتنادى من الـAPI وبتقرا جداول، والـviews (security_invoker)، وStorage.
- **الترتيب ثابت:** N-32 ← N-28/N-26b ← N-31.
