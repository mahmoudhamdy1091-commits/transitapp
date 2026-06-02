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
