// ╔══════════════════════════════════════════════════════════╗
// ║  context-menus.js — ⋮ Context Menu Engine + Builders     ║
// ║  Transit Management System                               ║
// ╚══════════════════════════════════════════════════════════╝
// نُقلت من utils.js (Phase 1). تُحمَّل متأخرة (بعد operations.js)
// لأن بُناة القوائم تستدعي دوال من كل الوحدات وقت التشغيل.
// ملاحظة: confirmAction() مساعدة عامة بقيت في utils.js.

// ════════════════════════════════════════
// ⋮ CONTEXT MENU — قائمة الإجراءات
// ════════════════════════════════════════
let _ctxMenuActive = null;

function showCtxMenu(btnEl, items) {
  // أغلق أي قايمة مفتوحة
  closeCtxMenu();

  const menu = document.createElement('div');
  menu.id = '_ctxMenu';
  menu.style.cssText = `
    position:fixed;z-index:99999;
    background:var(--card);border:1px solid var(--border);
    border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);
    padding:4px 0;min-width:160px;
    animation:ctxFadeIn .12s ease;
  `;

  items.forEach(item => {
    if (item === 'divider') {
      const d = document.createElement('div');
      d.style.cssText = 'height:1px;background:var(--border);margin:3px 0';
      menu.appendChild(d);
      return;
    }
    const row = document.createElement('div');
    row.style.cssText = `
      padding:9px 16px;cursor:pointer;font-size:13px;
      display:flex;align-items:center;gap:10px;
      color:${item.danger ? 'var(--red)' : 'var(--text)'};
      transition:background .1s;
    `;
    row.innerHTML = `<span style="font-size:15px">${item.icon}</span><span>${item.label}</span>`;
    row.onmouseenter = () => row.style.background = 'var(--card2)';
    row.onmouseleave = () => row.style.background = '';
    row.onclick = (e) => {
      e.stopPropagation();
      closeCtxMenu();
      item.action();
    };
    menu.appendChild(row);
  });

  document.body.appendChild(menu);
  _ctxMenuActive = menu;

  // تحديد الموضع
  const rect = btnEl.getBoundingClientRect();
  const mw = 170, mh = items.length * 38 + 8;
  let top  = rect.bottom + 4;
  let left = rect.right - mw;
  if (top + mh > window.innerHeight) top = rect.top - mh - 4;
  if (left < 4) left = 4;
  menu.style.top  = top  + 'px';
  menu.style.left = left + 'px';

  // أغلق عند الضغط خارجه
  setTimeout(() => document.addEventListener('click', closeCtxMenu, { once: true }), 0);
}

function closeCtxMenu() {
  if (_ctxMenuActive) { _ctxMenuActive.remove(); _ctxMenuActive = null; }
}

// ── CSS animation ──
(function() {
  const s = document.createElement('style');
  s.textContent = `@keyframes ctxFadeIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}`;
  document.head.appendChild(s);
})();

// ════════════════════════════════════════
// CTX MENU ACTIONS REGISTRY
// بدل arrow functions في HTML attributes — نخزن الـ actions هنا
// ════════════════════════════════════════
window._ctxReg = {};
let _ctxRegCounter = 0;

function ctxReg(items) {
  // كل item ممكن يكون string ('divider') أو object بـ action function
  // نحوّل كل action لـ string reference آمن
  const key = 'ctx_' + (++_ctxRegCounter);
  window._ctxReg[key] = items;
  return key;
}

function showCtxMenuById(btnEl, regKey) {
  const items = window._ctxReg[regKey];
  if (!items) return;
  showCtxMenu(btnEl, items);
}

// ════════════════════════════════════════
// CTX REGISTRY v2 — حل مشكلة > في onclick attributes
// بدل كتابة arrow functions في HTML، نخزّن الـ items هنا ونستدعيها بـ key
// ════════════════════════════════════════
window._ctxStore = {};
let _ctxStoreIdx = 0;

/** تسجيل items وإرجاع key فريد */
function _regCtx(items) {
  const key = 'c' + (++_ctxStoreIdx);
  window._ctxStore[key] = items;
  return key;
}

/** استدعاء من onclick="event.stopPropagation();_execCtx(this,'KEY')" */
function _execCtx(btnEl, key) {
  const items = window._ctxStore[key];
  if (items) showCtxMenu(btnEl, items);
}

// ════════════════════════════════════════
// CTX BUTTON HANDLERS — data-attribute approach
// كل زر يحمل data attributes بدل JS inline
// ════════════════════════════════════════

// دفعات المورد (dashboard)
function _ctxPayment(btn) {
  const id = btn.dataset.id, fn = btn.dataset.fn;
  showCtxMenu(btn, [
    {icon:'🖨️', label:'طباعة سند الدفعة', action:()=>printPaymentVoucher(id, fn)},
    {icon:'✏️', label:'تعديل', action:()=>openEditPaymentModal(id)},
    {icon:'📜', label:'السجل', action:()=>showRecordAudit({table:'payments', fileNo:fn, id, title:'دفعة مورد'})},
    'divider',
    {icon:'🔄', label:'إلغاء بقيد عكسي', danger:true, action:()=>confirmAction('إلغاء دفعة','سيتم إلغاء الدفعة بقيد عكسي محاسبي — هل أنت متأكد؟',()=>deletePaymentEntry(id,fn))}
  ]);
}

// المصاريف (dashboard)
function _ctxExpense(btn) {
  const id = btn.dataset.id, fn = btn.dataset.fn;
  showCtxMenu(btn, [
    {icon:'🖨️', label:'طباعة سند المصروف', action:()=>printExpenseVoucher(id, fn)},
    {icon:'✏️', label:'تعديل', action:()=>openEditExpenseModal(id)},
    {icon:'📜', label:'السجل', action:()=>showRecordAudit({table:'expenses', fileNo:fn, id, title:'مصروف'})},
    'divider',
    {icon:'🔄', label:'إلغاء بقيد عكسي', danger:true, action:()=>confirmAction('إلغاء مصروف','سيتم إلغاء المصروف بقيد عكسي محاسبي — هل أنت متأكد؟',()=>deleteExpenseEntry(id,fn))}
  ]);
}

// التحصيلات (dashboard)
function _ctxCollection(btn) {
  const id = btn.dataset.id, fn = btn.dataset.fn, paid = btn.dataset.paid === '1';
  const items = [];
  if (!paid) items.push({icon:'✅', label:'تسجيل دفع', action:()=>markCollectionPaid(id,fn)});
  items.push({icon:'✏️', label:'تعديل', action:()=>openEditCollectionModal(id)});
  items.push({icon:'📜', label:'السجل', action:()=>showRecordAudit({table:'collections', fileNo:fn, id, title:'تحصيل'})});
  items.push('divider');
  items.push({icon:'🔄', label:'إلغاء بقيد عكسي', danger:true, action:()=>confirmAction('إلغاء تحصيل','سيتم إلغاء التحصيل بقيد عكسي محاسبي — هل أنت متأكد؟',()=>deleteCollectionEntry(id,fn))});
  showCtxMenu(btn, items);
}

// صرف الشركاء (dashboard)
function _ctxPayout(btn) {
  const id = btn.dataset.id, fn = btn.dataset.fn;
  const items = [
    {icon:'🖨️', label:'طباعة سند', action:()=>printPayoutVoucher(id)},
    {icon:'✏️', label:'تعديل', action:()=>openEditPayoutModal(id)},
    {icon:'📜', label:'السجل', action:()=>showRecordAudit({table:'partner_payouts', fileNo:fn, id, title:'صرف شريك'})},
    'divider',
  ];
  if (can('delete')) items.push({icon:'🔄', label:'إلغاء بقيد عكسي', danger:true, action:()=>confirmAction('إلغاء صرف شريك','سيتم إلغاء الصرف بقيد عكسي محاسبي — هل أنت متأكد؟',()=>deletePayoutEntry(id,fn))});
  showCtxMenu(btn, items);
}

// مصاريف تشغيلية (operations)
function _ctxOpex(btn) {
  const id = btn.dataset.id;
  const items = [{icon:'✏️', label:'تعديل', action:()=>openEditOpexModal(id)}, {icon:'📜', label:'السجل', action:()=>showRecordAudit({table:'operating_expenses', id, title:'مصروف تشغيلي'})}, 'divider'];
  if (can('delete')) items.push({icon:'🔄', label:'إلغاء بقيد عكسي', danger:true, action:()=>deleteOpex(id)});
  showCtxMenu(btn, items);
}

// قيد يومية (operations)
function _ctxJE(btn) {
  const no = btn.dataset.no, isManual = btn.dataset.manual === '1';
  const items = [];
  if (isManual) items.push({icon:'✏️', label:'تعديل', action:()=>openEditJEModal(no)});
  items.push('divider');
  items.push({icon:'🗑', label:'حذف القيد', danger:true, action:()=>confirmAction('حذف قيد محاسبي','⚠️ سيتم حذف هذا القيد نهائياً — هل أنت متأكد؟',()=>deleteJEEntry(no))});
  showCtxMenu(btn, items);
}

// اليومية — قائمة موحّدة لصف القيد (طباعة + تعديل + السجل)
function _ctxJournal(btn) {
  const p = btn.closest('.j-entry-actions') || btn;
  const etype = p.dataset.etype || '', fno = p.dataset.fno || '';
  const tableMap = { purchase:'purchase_orders', sale:'sales', collection:'collections', payment:'payments', expense:'expenses', payout:'partner_payouts', opex:'operating_expenses' };
  const items = [
    {icon:'🖨️', label:'طباعة سند القيد', action:()=>_jPrint(btn)},
    {icon:'✏️', label:'تعديل', action:()=>_jEdit(btn)},
  ];
  const tbl = tableMap[etype];
  if (tbl) items.push({icon:'📜', label:'السجل', action:()=>showRecordAudit({ table:tbl, fileNo:fno, id:p.dataset.erefid||'', title:'قيد — '+(p.dataset.etitle||'') })});
  showCtxMenu(btn, items);
}

// سيارة (operations)
function _ctxVehicle(btn) {
  const id = +btn.dataset.id, fn = btn.dataset.fn;
  showCtxMenu(btn, [
    {icon:'✏️', label:'تعديل بيانات السيارة', action:()=>openEditVehicleModal(id)},
    {icon:'🚛', label:'تحويل لمخزن', action:()=>{openNewTransferModal();setTimeout(()=>{if(el('st-file-no')){el('st-file-no').value=fn;loadVehiclesForTransfer(fn);}},300);}},
  ]);
}

// الصفقات — جدول الصفقات الرئيسي (dashboard)
async function _ctxDeal(btn) {
  const fn = btn.dataset.fn, id = btn.dataset.id;
  const items = [];
  items.push({icon:'✏️', label:'تعديل بيانات الملف', action:()=>openNewFileModal(fn)});
  items.push({icon:'📜', label:'السجل', action:()=>showRecordAudit({table:'purchase_orders', fileNo:fn, id:id||null, title:`صفقة ${fn}`})});
  // ✅ إلغاء سند الشراء — يظهر فقط لو السند posted فعلياً (لا draft ولا voided مسبقاً)
  try {
    const po = await apiGetAll('purchase_orders', { select:'post_status', system_type:`eq.${state.system}`, file_no:`eq.${fn}` });
    if ((po?.[0]?.post_status || 'posted') === 'posted') {
      items.push({icon:'🔄', label:'إلغاء سند الشراء', danger:true, action:()=>confirmAction(
        'إلغاء سند الشراء',
        `سيتم عكس سند الشراء لملف ${fn} بقيد محاسبي عكسي — لن يُسمح بذلك لو فيه سيارات مباعة أو دفعات مسجّلة. هل أنت متأكد؟`,
        async () => {
          try {
            await voidPurchaseOrder(fn);
            toast('✅ تم إلغاء سند الشراء بقيد عكسي','ok');
            invalidateCache();
            await loadDashboard();
          } catch(e) { toast('⚠️ '+e.message,'err'); }
        }
      )});
    }
  } catch(e) { console.warn('_ctxDeal post_status check:', e.message); }
  if (can('delete')) {
    items.push('divider');
    items.push({icon:'🗑', label:'حذف الصفقة', danger:true, action:()=>confirmAction('حذف الصفقة','هل أنت متأكد من حذف هذه الصفقة؟',()=>deleteOrphanDeal(id||fn))});
  }
  showCtxMenu(btn, items);
}

// طلب موافقة (operations)
function _ctxApproval(btn) {
  const type = btn.dataset.type, id = btn.dataset.id;
  showCtxMenu(btn, [
    {icon:'✏️', label:'تعديل', action:()=>editApprovalRow(type,id)},
    {icon:'⊘', label:'إلغاء', action:()=>confirmAction('إلغاء العملية','سيتم وضع العملية كـ ملغية — هل أنت متأكد؟',()=>cancelApprovalRow(type,id))},
    'divider',
    {icon:'🗑', label:'رفض نهائي', danger:true, action:()=>rejectItem(type,id)}
  ]);
}

// مسودة قيد (accounting)
function _ctxDraft(btn) {
  const id = btn.dataset.id;
  showCtxMenu(btn, [
    {icon:'🗑', label:'حذف المسودة', danger:true, action:()=>confirmAction('حذف مسودة قيد','هل تريد حذف هذه المسودة نهائياً؟',()=>deleteDraftEntry(id))}
  ]);
}

// المبيعات (dashboard)
function _ctxSale(btn) {
  const invNo = btn.dataset.inv, fn = btn.dataset.fn, saleId = btn.dataset.id;
  showCtxMenu(btn, [
    {icon:'✏️', label:'تعديل الفاتورة', action:()=>openEditSaleApproval(saleId, fn, invNo)},
    {icon:'🖨️', label:'طباعة الفاتورة', action:()=>reprintInvoice(invNo, fn)},
    {icon:'📜', label:'السجل', action:()=>showRecordAudit({table:'sales', fileNo:fn, refNo:invNo, title:`فاتورة ${invNo}`})},
    'divider',
    {icon:'🔄', label:'إلغاء بقيد عكسي', danger:true, action:()=>voidSaleInvoice(invNo, fn)}
  ]);
}

// المعاملات — handler موحّد لكل أنواع TX
function _ctxTx(btn, type) {
  const id = btn.dataset.id, fn = btn.dataset.fn, paid = btn.dataset.paid === '1';
  switch(type) {
    case 'payments':
      return _ctxPayment(btn);
    case 'expenses':
      showCtxMenu(btn, [
        {icon:'✏️', label:'تعديل', action:()=>openEditExpenseModal(id)},
        {icon:'📜', label:'السجل', action:()=>showRecordAudit({table:'expenses', fileNo:fn, id, title:'مصروف'})},
        'divider',
        {icon:'🔄', label:'إلغاء بقيد عكسي', danger:true, action:()=>confirmAction('إلغاء مصروف','سيتم إلغاء المصروف بقيد عكسي محاسبي — هل أنت متأكد؟',()=>deleteExpenseEntry(id,fn))}
      ]);
      break;
    case 'collections':
      _ctxCollection(btn);
      break;
    case 'payouts':
      showCtxMenu(btn, [
        {icon:'🖨️', label:'طباعة سند', action:()=>printPayoutVoucher(id)},
        {icon:'✏️', label:'تعديل', action:()=>openEditPayoutModal(id)},
        {icon:'📜', label:'السجل', action:()=>showRecordAudit({table:'partner_payouts', fileNo:fn, id, title:'صرف شريك'})},
        'divider',
        {icon:'🔄', label:'إلغاء بقيد عكسي', danger:true, action:()=>confirmAction('إلغاء صرف شريك','سيتم إلغاء الصرف بقيد عكسي محاسبي — هل أنت متأكد؟',()=>deletePayoutEntry(id,fn))}
      ]);
      break;
    case 'sales': {
      // المبيعات في TX: data-inv موجود على الزر
      const invNo = btn.dataset.inv || '';
      showCtxMenu(btn, [
        {icon:'✏️', label:'تعديل الفاتورة', action:()=>openEditSaleApproval(id, fn, invNo)},
        {icon:'🖨️', label:'طباعة الفاتورة', action:()=>openInvoiceModal(invNo)},
        {icon:'📜', label:'السجل', action:()=>showRecordAudit({table:'sales', fileNo:fn, refNo:invNo, title:`فاتورة ${invNo}`})},
        'divider',
        {icon:'🔄', label:'إلغاء بقيد عكسي', danger:true, action:()=>voidSaleInvoice(invNo, fn)}
      ]);
      break;
    }
  }
}
