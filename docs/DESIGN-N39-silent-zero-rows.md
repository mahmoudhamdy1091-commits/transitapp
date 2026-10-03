# N-39 — الـUPDATE/DELETE اللي الـRLS بترفضها بصمت ⇒ «✅ تم» كاذبة

> **تصميم + جرد بس — مفيش كود لحد حكم المراجع.** اكتُشف في PGlite بتاع N-31 (2026-10-03). PLAN: N-39.

## ١. المشكلة
- الـRLS على UPDATE/DELETE **مابترفضش بصوت**: الصف اللي الدور مش مسموحله بيتشال من الـWHERE ⇒ «0 صفوف» من غير أي خطأ.
  الـINSERT (والـUPDATE اللي بينقل صف لنظام تاني — with check) بس اللي بيرجع «new row violates row-level security policy».
- **`apiPatch`** (core.js:1339): بيبعت `Prefer: return=representation` وبيرمي لو `!res.ok` — بس **0 صفوف = `[]` من غير خطأ**،
  ومعظم النداءات مابتبصّش على النتيجة ⇒ الشاشة بتكمّل وتقول «✅ تم».
- **`apiDelete`** (accounting.js:988) **أسوأ:**
  - بيرجّع الـResponse زي ما هو **من غير ما يشيك `res.ok`** ⇒ **أي فشل HTTP في المسح (403/409/…) صامت النهارده**، وولا نداء
    من الـ28 بيقرا النتيجة.
  - بيكتب سطر `logAudit('DELETE', …)` **قبل** المسح ⇒ السجل بيقول «اتمسح» حتى لو المسح وقع أو لمس 0 صفوف.
- نفس العَرَض بيحصل النهارده من غير RLS كمان: **id قديم** (السجل اتمسح/اتغيّر من شاشة تانية) ⇒ 0 صفوف ⇒ «✅ تم».

## ٢. الجرد (2026-10-03، grep كامل على js/ — 117 موضع)
| الفئة | المعنى | العدد | لما يرجع 0 صفوف |
|---|---|---|---|
| **A** | سجل واحد بالـid (عملية مستخدم) | 76 | **غلط** — مش مسموح أو السجل اتغيّر ⇒ لازم رسالة |
| **B** | تنضيف / امسح-لو-موجود | 10 | **طبيعي** ⇒ `allowEmpty` |
| **C** | شرطي (compare-and-set) والنداء بيقرا النتيجة | 8 | **معنى مقصود** («اتعمل قبل كده») والنداء بيتعامل معاه ⇒ `allowEmpty` |
| **D** | أكتر من صف بفلتر | 11 | **غلط** (المتوقع ≥ 1) ⇒ رسالة — بس ٣ منهم جوّه catch (§٤-٢) |
| **E** | fetch مباشر (مش apiPatch/apiDelete) | 12 | **برّه المرحلة دي** (§٤-٣) |

- **B (تنضيف، الصفر طبيعي):** dashboard.js:1606/1607 (تحصيلات وsale_charges الفاتورة وقت مسحها)، modals.js:809 (stock_locations
  بالـVIN)، modals.js:1966 (sale_charges القديمة وقت تعديل الفاتورة — غالبًا 0)، reports.js:1004 (سيارة يتيمة)، operations.js:225
  (رجوع مصروف تشغيلي بعد فشل القيد)، engine.js:674 (تحصيل مرتبط وقت إلغاء فاتورة)، engine.js:970 (سطور قيد الشراء وقت الإلغاء)،
  modals.js:683 (دفعة قديمة)، modals.js:860 (شريك اتشال من الملف). **كلهم جوّه try/catch بيبلع أصلًا.**
- **C (شرطي):** operations.js:1840/1841 و2419/2420 (`post_status=eq.draft` ⇒ posted، والنتيجة الفاضية = «اتوافق قبل كده»)،
  1909/2339/2344 (`eq.pending_edit`)، 2220 (تحصيلات draft). ⚠️ بعد N-31 الصفر هنا ممكن يعني كمان «مش مسموح» — والرسالة
  هتقول «كانت معتمدة مسبقًا»؛ مقبول لأن الموافقات admin بس في الشاشة.
- **D (أكتر من صف):** dashboard.js:1605 (sales الفاتورة)، 1617 وmodals.js:898/2010 وviewer.js:40 (حالة/عدد سند الشراء بالملف)،
  engine.js:660 (إلغاء فاتورة)، engine.js:934 (إلغاء سجلات بالـid in)، modals.js:791 (تعديل سند الشراء — النتيجة بتتقري)،
  وجوّه catch بعد فشل القيد: modals.js:611 وmodals.js:1988 وoperations.js:1845 (رجوع draft).
- **E (fetch مباشر):** postDoubleEntry/_handoffPrimaryLine (engine.js:1072/1118/1133/1162/1169 — `return=minimal`، بيعملوا
  console.warn لو !ok)، ومدير القيود (operations.js:4358/4795/4891 — مسح بالـentry_no ومتسامح مع 404)، والترحيل (4974/4985/4995)،
  وcleanup.js:89 (بيشيك res.ok).

## ٣. التصميم المقترح (من غير كود)
1. **`apiPatch(table, match, data, { allowEmpty = false } = {})`:** بعد `res.ok` — لو النتيجة `[]` و`!allowEmpty` ⇒ `throw` برسالة:
   «ما اتغيّرش أي سجل — يا إما مش مسموح لك بالعملية دي، يا إما السجل اتغيّر أو اتمسح من مكان تاني. حدّث الصفحة وحاول تاني.»
2. **`apiDelete(table, match, { allowEmpty = false } = {})`:**
   - يشيك `res.ok` ويرمي بنفس طريقة apiPatch (فشل HTTP مايبقاش صامت).
   - يقرا الـrepresentation: `[]` و`!allowEmpty` ⇒ نفس الرسالة.
   - `logAudit('DELETE')` **بعد** المسح الناجح، وبعدد الصفوف الفعلي (ومايتكتبش لو 0).
3. **`{ allowEmpty: true }`** على الـB والـC (18 موضع) بالظبط. الـA والـD بيبقوا strict من غير لمس.
4. **مفيش تغيير على E** في المرحلة دي.

## ٤. مخاطر وقرارات للمراجع
1. **التغيير الافتراضي strict:** أي موضع اتصنّف A/D غلط وبيلمس 0 صفوف عادي هيبتدي يرمي. التخفيف: الجرد ده كامل (grep للـ117)،
   + اختبار harness (fetch وهمي بيرجّع `[]`/403 لكل فئة)، + فحص حي بالـadmin (قراءة + حاجز) زي N-31.
2. **D جوّه catch (modals.js:611، 1988، operations.js:1845 — رجوع draft بعد فشل القيد):** لو الرجوع لمس 0، الرمي من جوّه الـcatch
   هيغطّي رسالة فشل القيد الأصلية. **اقتراح:** strict، بس الـcatch يضم الرسالتين («فشل القيد: … — وكمان الرجوع لـdraft ماتمش»)،
   لأن الحالة دي (سجل posted من غير قيد) أخطر من إنها تعدّي بصمت.
3. **apiDelete بقى يرمي على فشل HTTP:** مسح كان بيفشل بصمت هيبان. ده المطلوب — بس ممكن يطلّع أخطاء قديمة مستخبية أول ما ينزل.
4. **ترتيب logAudit** (بعد المسح): تغيير صغير في سجل النشاط — سطور «DELETE» لمسح ماحصلش مش هتتكتب تاني.
5. **E (مدير القيود — مسح قيد بالـentry_no):** readonly/موظف ممكن ياخدوا «✅ تم حذف القيد» كاذبة برضه. بند لوحده بعد كده
   (`Prefer: return=representation` + العدد) لو المراجع شايف.

## ملحق — الجرد الكامل (117 موضع)
| # | الموقع | النوع | الجدول | الفلتر | الدالة | ملاحظة |
|---|---|---|---|---|---|---|
| A | accounting.js:688 | DELETE | journal_attachments | id | deleteJEAttachment |  |
| A | accounting.js:827 | PATCH | chart_of_accounts | id | submitAccount |  |
| A | accounting.js:835 | DELETE | chart_of_accounts | id | deleteAccount | جوّه try/catch بيبلع |
| A | accounting.js:906 | PATCH | contacts | id | submitContact |  |
| A | accounting.js:921 | DELETE | contacts | id | deleteContact |  |
| A | accounting.js:979 | PATCH | vehicles | id | submitEditVehicle |  |
| A | accounting.js:1369 | PATCH | journal_entries | id | postEntry |  |
| A | accounting.js:1434 | DELETE | journal_entries | id | deleteDraftEntry |  |
| A | cleanup.js:362 | PATCH | tbl | id |  |  |
| A | dashboard.js:1961 | PATCH | partner_payouts | id | openEditPayoutModal |  |
| A | engine.js:311 | PATCH | tbl | id |  |  |
| A | engine.js:464 | PATCH | partner_ledger | id | voidTransaction |  |
| A | engine.js:537 | PATCH | tableName | id |  |  |
| A | engine.js:817 | PATCH | collections | id | adjustInvoiceDue |  |
| A | engine.js:822 | PATCH | collections | id | adjustInvoiceDue |  |
| A | engine.js:834 | PATCH | collections | id | adjustInvoiceDue |  |
| A | engine.js:891 | PATCH | collections | id | syncInvoiceCollectionsAfterSaleEdit |  |
| A | engine.js:975 | PATCH | purchase_orders | id | voidPurchaseOrder |  |
| A | modals.js:807 | DELETE | vehicles | id | submitEditFileFull |  |
| A | modals.js:817 | PATCH | vehicles | id | submitEditFileFull |  |
| A | modals.js:866 | PATCH | partners_master | id | submitEditFileFull |  |
| A | modals.js:1403 | PATCH | expenses | id | submitExpense |  |
| A | modals.js:1508 | PATCH | payments | id | _proceedSubmitPayment |  |
| A | modals.js:2055 | PATCH | collections | id | submitSale |  |
| A | modals.js:2078 | PATCH | collections | id | submitSale |  |
| A | modals.js:2318 | PATCH | collections | id | submitCollection |  |
| A | modals.js:2353 | PATCH | collections | id | submitCollection |  |
| A | modals.js:2656 | PATCH | partner_payouts | id | submitPayout |  |
| A | modals.js:2931 | PATCH | partner_ledger | id | submitLedger |  |
| A | operations.js:265 | PATCH | operating_expenses | id | submitEditOpex |  |
| A | operations.js:345 | DELETE | operating_expenses | id | deleteOpex |  |
| A | operations.js:1372 | PATCH | cfg.table | id |  |  |
| A | operations.js:1575 | PATCH | sales | id | openEditSaleApproval |  |
| A | operations.js:1587 | PATCH | sales | id | openEditSaleApproval |  |
| A | operations.js:1846 | PATCH | cfg.table | id (رجوع draft) |  |  |
| A | operations.js:1926 | PATCH | tbl | id |  |  |
| A | operations.js:1986 | PATCH | tbl | id |  |  |
| A | operations.js:2011 | PATCH | purchase_orders | id | rejectItem |  |
| A | operations.js:2019 | PATCH | t | id |  |  |
| A | operations.js:2027 | PATCH | cfg.table | id |  |  |
| A | operations.js:2065 | PATCH | cfg.table | id |  |  |
| A | operations.js:3110 | DELETE | audit_log | id | deleteDealNote |  |
| A | operations.js:5576 | DELETE | stock_locations | id | deleteTransfer |  |
| A | reports.js:769 | DELETE | vehicles | id | confirmDeleteVehicle |  |
| A | reports.js:793 | DELETE | partner_payouts | id | deletePayoutEntry |  |
| A | reports.js:819 | DELETE | partner_payouts | id | deletePayoutEntry |  |
| A | reports.js:858 | DELETE | partner_ledger | id | deleteLedgerEntry |  |
| A | reports.js:885 | DELETE | partner_ledger | id | deleteLedgerEntry |  |
| A | settings.js:542 | PATCH | user_roles | id | mergeUserRows |  |
| A | settings.js:543 | DELETE | user_roles | id | mergeUserRows |  |
| A | settings.js:589 | PATCH | user_roles | id | saveUserRoleEdit |  |
| A | settings.js:623 | PATCH | user_roles | id | updateUserRole |  |
| A | settings.js:632 | DELETE | user_roles | id | deleteUserRole |  |
| A | settings.js:1011 | DELETE | contacts | id | acDeleteContact |  |
| A | settings.js:1114 | PATCH | table | id |  |  |
| A | settings.js:1161 | PATCH | payments | id | submitEditPayment |  |
| A | settings.js:1187 | PATCH | payments | id | submitEditPayment |  |
| A | settings.js:1209 | PATCH | payments | id | submitEditPayment |  |
| A | settings.js:1242 | DELETE | payments | id | deletePaymentEntry |  |
| A | settings.js:1303 | DELETE | expenses | id | deleteExpenseEntry |  |
| A | settings.js:1364 | DELETE | collections | id | deleteCollectionEntry |  |
| A | settings.js:1570 | PATCH | expenses | id | submitEditExpense |  |
| A | settings.js:1613 | PATCH | expenses | id | submitEditExpense |  |
| A | settings.js:1633 | PATCH | expenses | id | submitEditExpense |  |
| A | settings.js:1710 | PATCH | collections | id | submitEditCollection |  |
| A | settings.js:1737 | PATCH | collections | id | submitEditCollection |  |
| A | settings.js:1778 | PATCH | collections | id | submitEditCollection |  |
| A | settings.js:1808 | PATCH | collections | id | submitEditCollection |  |
| A | settings.js:1884 | PATCH | collections | id | submitMarkPaid |  |
| A | settings.js:1910 | PATCH | collections | id | submitMarkPaid |  |
| A | viewer.js:332 | PATCH | sales | id | submitQuickSale |  |
| A | viewer.js:407 | PATCH | collections | id | submitQuickCollection |  |
| A | viewer.js:439 | PATCH | collections | id | submitQuickCollection |  |
| A | viewer.js:489 | PATCH | expenses | id | submitQuickExpense |  |
| A | viewer.js:593 | PATCH | payments | id | submitQuickPayment |  |
| A | viewer.js:664 | PATCH | partner_payouts | id | submitQuickPayout |  |
| B | dashboard.js:1606 | DELETE | collections | system_type | deleteSaleInvoice | جوّه try/catch بيبلع |
| B | dashboard.js:1607 | DELETE | sale_charges | system_type | deleteSaleInvoice | جوّه try/catch بيبلع |
| B | engine.js:674 | PATCH | collections | id | _voidSaleInvoiceCore | جوّه try/catch بيبلع |
| B | engine.js:970 | PATCH | journal_entries | ? | voidPurchaseOrder | جوّه try/catch بيبلع |
| B | modals.js:683 | DELETE | payments | id | voidOrDeleteOldPayment | جوّه try/catch بيبلع |
| B | modals.js:809 | DELETE | stock_locations | system_type | submitEditFileFull | جوّه try/catch بيبلع |
| B | modals.js:860 | DELETE | partners_master | id | submitEditFileFull | جوّه try/catch بيبلع |
| B | modals.js:1966 | DELETE | sale_charges | system_type | submitSale | جوّه try/catch بيبلع |
| B | operations.js:225 | DELETE | operating_expenses | id | submitOpex | جوّه try/catch بيبلع |
| B | reports.js:1004 | DELETE | vehicles | system_type | checkVinDuplicate | جوّه try/catch بيبلع |
| C | operations.js:1840 | PATCH | cfg.table | inv + post_status=eq.draft |  | النتيجة بتتقري |
| C | operations.js:1841 | PATCH | cfg.table | id + post_status=eq.draft |  | النتيجة بتتقري |
| C | operations.js:1909 | PATCH | tbl | id + post_status=eq.pending_edit |  | النتيجة بتتقري |
| C | operations.js:2220 | PATCH | collections | id | _approveLinkedPaidCollections | النتيجة بتتقري |
| C | operations.js:2339 | PATCH | sales | system_type | _processEditApproval | النتيجة بتتقري |
| C | operations.js:2344 | PATCH | cfg.table | id + post_status=eq.pending_edit |  | النتيجة بتتقري |
| C | operations.js:2419 | PATCH | cfg.table | inv + post_status=eq.draft |  | النتيجة بتتقري |
| C | operations.js:2420 | PATCH | cfg.table | id + post_status=eq.draft |  | النتيجة بتتقري |
| D | dashboard.js:1605 | DELETE | sales | system_type | deleteSaleInvoice | جوّه try/catch بيبلع |
| D | dashboard.js:1617 | PATCH | purchase_orders | system_type | deleteSaleInvoice |  |
| D | engine.js:660 | PATCH | sales | system_type | _voidSaleInvoiceCore |  |
| D | engine.js:934 | PATCH | table | id in.(…) |  |  |
| D | modals.js:611 | PATCH | purchase_orders | system_type | _submitNewFileInner |  |
| D | modals.js:791 | PATCH | purchase_orders | system_type | submitEditFileFull | النتيجة بتتقري |
| D | modals.js:898 | PATCH | purchase_orders | system_type | submitEditFileFull |  |
| D | modals.js:1988 | PATCH | sales | ? | submitSale |  |
| D | modals.js:2010 | PATCH | purchase_orders | system_type | submitSale |  |
| D | operations.js:1845 | PATCH | cfg.table | inv (رجوع draft) |  |  |
| D | viewer.js:40 | PATCH | purchase_orders | system_type | submitAddVehicle |  |
| E | cleanup.js:89 | fetch-DELETE | ${tbl} | id | _cleanupDeleteDraft | النتيجة بتتقري |
| E | engine.js:1072 | fetch-PATCH | journal_entries | ? | postDoubleEntry |  |
| E | engine.js:1118 | fetch-DELETE | journal_entries | ? | postDoubleEntry | جوّه try/catch بيبلع |
| E | engine.js:1133 | fetch-PATCH | journal_entries | ? | postDoubleEntry |  |
| E | engine.js:1162 | fetch-PATCH | journal_entries | ? | _handoffPrimaryLine |  |
| E | engine.js:1169 | fetch-PATCH | journal_entries | ? | _handoffPrimaryLine |  |
| E | operations.js:4358 | fetch-DELETE | journal_entries | ? | fixUnbalancedEntries |  |
| E | operations.js:4795 | fetch-DELETE | journal_entries | ? | submitJE |  |
| E | operations.js:4891 | fetch-DELETE | journal_entries | ? | deleteJEEntry |  |
| E | operations.js:4974 | fetch-DELETE | journal_entries | ? | runMigration |  |
| E | operations.js:4985 | fetch-DELETE | journal_entries | ? | runMigration |  |
| E | operations.js:4995 | fetch-DELETE | journal_entries | ? | runMigration |  |
