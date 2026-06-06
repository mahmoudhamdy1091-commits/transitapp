// ╔══════════════════════════════════════════════════════════╗
// ║  utils.js — UI Helpers · Modal · Toast · Format         ║
// ║  Transit Management System                               ║
// ╚══════════════════════════════════════════════════════════╝
// لا تعديلات على المنطق — نقل حرفي من app.js

// ════════════════════════════════════════
// UI HELPERS — showDashboard, hideAllViews, navActive
// ════════════════════════════════════════
function showDashboard() {
  sessionStorage.setItem('tm_last_view','dashboard');
  hideAllViews();
  el('dashboardView').style.display = 'block';
  el('topBarTitle').textContent    = 'لوحة التحكم';
  navActive('nav-dashboard');
  state.currentFileNo = null;
  if (!dashState.from) setDashPeriod(30);
  else loadDashboard();
}

function toggleNav(titleEl) {
  const items = titleEl.nextElementSibling;
  const isOpen = items.classList.contains('open');
  titleEl.classList.toggle('open', !isOpen);
  items.classList.toggle('open', !isOpen);
}

function navActive(id) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (id) { const e = document.getElementById(id); if (e) e.classList.add('active'); }
}

function setMobNav(btn) {
  document.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function showView(viewId) {
  const map = {
    'dashboardView': () => showDashboard(),
    'contactsView':  () => showContacts(),
    'journalView':   () => showJournal(),
    'reportsView':   () => showReports(),
  };
  if (map[viewId]) map[viewId]();
  else { hideAllViews(); const e = el(viewId); if(e) e.style.display=''; }
}

function hideAllViews() {
  ['dashboardView','viewerView','journalView','contactsView','ledgerView','trialView',
   'allSalesView','allCollectionsView','reportsView','vehiclesReportView','activityView',
   'settingsView','opexView','approvalView','transactionsView','reviewView','jeManagerView',
   'warehousesView','contactStatementView','chartOfAccountsView','importWizardView']
    .forEach(id => {
      const e = el(id);
      if (e) {
        e.style.display    = 'none';
        e.style.opacity    = '';
        e.style.transform  = '';
        e.style.transition = '';
      }
    });
}

// ════════════════════════════════════════
// MODAL DIRTY TRACKING — تحذير بيانات غير محفوظة
// ════════════════════════════════════════
const _modalDirty  = new Map();
const _modalSaving = new Set();

function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';

  if (overlay._dirtyHandler) {
    overlay.removeEventListener('input',  overlay._dirtyHandler, true);
    overlay.removeEventListener('change', overlay._dirtyHandler, true);
  }
  _modalDirty.set(id, false);

  setTimeout(() => {
    overlay._dirtyHandler = (e) => {
      // تجاهل inputs في مودالات لا تحتاج dirty tracking
      const skipModals = ['migrationModal', 'confirmDeleteModal', 'rolesModal'];
      if (skipModals.some(m => overlay.id === m)) return;

      if (e.target && e.target.matches('input:not([type="hidden"]):not([type="checkbox"]), textarea')) {
        _modalDirty.set(id, true);
      }
      if (e.type === 'change' && e.target && e.target.tagName === 'SELECT') {
        const name = e.target.name || e.target.id || '';
        if (!['pay-method','exp-method','col-method','qc-method','qe-method','qp-method',
              'qpo-method','pout-method','ep-method','ec-method','ee-method','gw-method'].includes(name)) {
          _modalDirty.set(id, true);
        }
      }
    };
    overlay.addEventListener('input',  overlay._dirtyHandler, true);
    overlay.addEventListener('change', overlay._dirtyHandler, true);
  }, 200);
}

function closeModal(id) {
  if (_modalDirty.get(id) && !_modalSaving.has(id)) {
    if (!confirm('⚠️ توجد بيانات غير محفوظة\nهل تريد الخروج بدون حفظ؟\n\nاضغط "إلغاء" للبقاء والحفظ.')) return;
  }
  const overlay = document.getElementById(id);
  if (overlay && overlay._dirtyHandler) {
    overlay.removeEventListener('input',  overlay._dirtyHandler, true);
    overlay.removeEventListener('change', overlay._dirtyHandler, true);
    delete overlay._dirtyHandler;
  }
  _modalDirty.delete(id);
  _modalSaving.delete(id);
  overlay?.classList.remove('show');
  document.body.style.overflow = '';
}

function markSaving(id) { _modalSaving.add(id); }

// ════════════════════════════════════════
// CORE UTILS
// ════════════════════════════════════════
function el(id) { return document.getElementById(id); }

function fmt(n, decimals=2) {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString('en-GB', { year:'numeric', month:'short', day:'numeric' });
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function statusClass(s) {
  if (!s) return 'open';
  if (s === 'OPEN') return 'open';
  if (s === 'IN PROGRESS') return 'progress';
  if (s === 'CLOSED') return 'closed';
  return 'open';
}

function emptyHTML(icon, msg) {
  return `<div class="empty-state"><div class="e-icon">${icon}</div><p>${msg}</p></div>`;
}

function errHTML(msg) {
  return `<div class="alert alert-err" style="margin:16px">⚠️ ${msg}</div>`;
}

function showFieldErr(elId, msg) {
  const e = el(elId);
  e.textContent = '⚠️ ' + msg;
  e.style.display = 'flex';
}

function showErr(id, msg) {
  el(id).innerHTML = `<div class="alert alert-err" style="margin:16px">⚠️ ${msg}</div>`;
}

// ════════════════════════════════════════
// TOAST
// ════════════════════════════════════════
let toastTimer;
function toast(msg, type='ok') {
  const t = el('toast');
  t.className = '';
  t.textContent = msg;
  void t.offsetWidth;
  t.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.add('hiding');
    setTimeout(() => { t.className = ''; }, 200);
  }, 3000);
}

// ════════════════════════════════════════
// COUNT-UP ANIMATION
// ════════════════════════════════════════
function animateCount(el, targetStr, color) {
  if (!el) return;
  const isNum = /^[\d,\.]+$/.test(targetStr.replace(/\s/g,''));
  if (!isNum) { el.textContent = targetStr; if(color) el.style.color=color; return; }
  const target   = parseFloat(targetStr.replace(/,/g,'')) || 0;
  const duration = 600;
  const start    = performance.now();
  const startVal = parseFloat(el.textContent?.replace(/,/g,'')) || 0;
  el.style.transition = 'color .3s';
  if(color) el.style.color = color;
  function step(now) {
    const p    = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    const cur  = startVal + (target - startVal) * ease;
    if (targetStr.includes('.')) {
      el.textContent = cur.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
    } else {
      el.textContent = Math.round(cur).toLocaleString('en-US');
    }
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = targetStr;
  }
  requestAnimationFrame(step);
}

// ════════════════════════════════════════
// SKELETON LOADING
// ════════════════════════════════════════
function setLoading(id, msg='جاري التحميل...') {
  el(id).innerHTML = `
    <div style="padding:16px">
      <div class="skeleton" style="height:38px;margin-bottom:8px;border-radius:6px"></div>
      <div class="skeleton" style="height:38px;margin-bottom:8px;opacity:.8;border-radius:6px"></div>
      <div class="skeleton" style="height:38px;margin-bottom:8px;opacity:.6;border-radius:6px"></div>
      <div class="skeleton" style="height:38px;opacity:.4;border-radius:6px"></div>
    </div>`;
}

// ════════════════════════════════════════
// SMOOTH VIEW TRANSITION
// ════════════════════════════════════════
function switchView(showId, title, sub='') {
  const current = document.querySelector('.content-area > div[id$="View"]:not([style*="display: none"]):not([style*="display:none"])');
  if (current && current.id !== showId) {
    current.style.opacity    = '0';
    current.style.transform  = 'translateY(6px)';
    current.style.transition = 'opacity .15s, transform .15s';
    setTimeout(() => {
      current.style.display    = 'none';
      current.style.opacity    = '';
      current.style.transform  = '';
      current.style.transition = '';
    }, 150);
  }
  const next = el(showId);
  if (next) {
    next.style.display    = 'block';
    next.style.opacity    = '0';
    next.style.transform  = 'translateY(10px)';
    next.style.transition = 'none';
    void next.offsetWidth;
    next.style.transition = 'opacity .25s ease, transform .25s ease';
    next.style.opacity    = '1';
    next.style.transform  = 'translateY(0)';
    setTimeout(() => {
      next.style.transition = '';
      next.style.opacity    = '';
      next.style.transform  = '';
    }, 300);
  }
  if(title) el('topBarTitle').textContent = title;
  if(sub)   el('topBarSub').textContent   = sub;
}

// ════════════════════════════════════════
// ROLES & PERMISSIONS
// ════════════════════════════════════════
const ROLES = {
  admin:    { label:'👑 مدير كامل',  edit:true,  delete:true,  transactions:true,  roles:true  },
  employee: { label:'👤 موظف',       edit:true,  delete:false, transactions:true,  roles:false },
  readonly: { label:'👁 مشاهدة',     edit:false, delete:false, transactions:false, roles:false },
};

let _currentRole = localStorage.getItem('tm_role') || 'admin';

function can(action) { return ROLES[_currentRole]?.[action] !== false; }

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
// CONFIRM DIALOG — تأكيد الإجراء
// ════════════════════════════════════════
function confirmAction(title, msg, onConfirm, danger = true) {
  // استخدم الـ modal الموجود
  if (typeof showConfirm === 'function') {
    showConfirm(title, msg, onConfirm);
    // غيّر لون الزرار حسب خطورة العملية
    const btn = document.getElementById('confirmDeleteOkBtn');
    if (btn) {
      btn.textContent = danger ? '⚠️ تأكيد' : '✅ تأكيد';
      btn.style.background = danger ? 'var(--red)' : 'var(--green)';
    }
  }
}

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
    'divider',
  ];
  if (can('delete')) items.push({icon:'🔄', label:'إلغاء بقيد عكسي', danger:true, action:()=>confirmAction('إلغاء صرف شريك','سيتم إلغاء الصرف بقيد عكسي محاسبي — هل أنت متأكد؟',()=>deletePayoutEntry(id,fn))});
  showCtxMenu(btn, items);
}

// مصاريف تشغيلية (operations)
function _ctxOpex(btn) {
  const id = btn.dataset.id;
  const items = [{icon:'✏️', label:'تعديل', action:()=>openEditOpexModal(id)}, 'divider'];
  if (can('delete')) items.push({icon:'🗑', label:'حذف', danger:true, action:()=>confirmAction('حذف مصروف تشغيلي','هل أنت متأكد من حذف هذا المصروف؟',()=>deleteOpex(id))});
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

// سيارة (operations)
function _ctxVehicle(btn) {
  const id = +btn.dataset.id, fn = btn.dataset.fn;
  showCtxMenu(btn, [
    {icon:'✏️', label:'تعديل بيانات السيارة', action:()=>openEditVehicleModal(id)},
    {icon:'🚛', label:'تحويل لمخزن', action:()=>{openNewTransferModal();setTimeout(()=>{if(el('st-file-no')){el('st-file-no').value=fn;loadVehiclesForTransfer(fn);}},300);}},
  ]);
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
        'divider',
        {icon:'🔄', label:'إلغاء بقيد عكسي', danger:true, action:()=>voidSaleInvoice(invNo, fn)}
      ]);
      break;
    }
  }
}
