// ╔══════════════════════════════════════════════════════════╗
// ║           TABLE OF CONTENTS — Transit Management         ║
// ╚══════════════════════════════════════════════════════════╝
//
// L.3233   CONFIG — Supabase URL & Keys
// L.3239   STATE — App state object
// L.3281   API HELPERS — headers, apiGet, apiPost, apiPatch, apiDelete
// L.3481   DASHBOARD — dashState, setDashPeriod
// L.3518   DASHBOARD — loadDashboard
// L.3742   DASHBOARD — render helpers (alerts, collections, chart)
// L.6620   DASHBOARD — showDashboard
// L.11039  DASHBOARD — Drill-down panel & renderDrillDown
// L.3892   VIEWER — openViewer, switchTab, renderDealsTable
// L.3961   VIEWER TABS — Summary
// L.4130   VIEWER TABS — Vehicles
// L.4167   VIEWER TABS — Payments
// L.4205   VIEWER TABS — Expenses
// L.4243   VIEWER TABS — Sales
// L.4510   VIEWER TABS — Collections
// L.4549   VIEWER TABS — Payouts (Partner Payouts)
// L.4887   NEW FILE MODAL — Purchase Order (openNewFileModal, submitNewFile)
// L.5545   PAYMENT MODAL — openPaymentModal, submitPayment
// L.5567   EXPENSE MODAL — openExpenseModal, submitExpense
// L.5754   SALE MODAL — openSaleModal, submitSale
// L.6021   COLLECTION MODAL — openCollectionModal, submitCollection
// L.6080   PAYOUT MODAL — openPayoutModal, submitPayout
// L.6671   UTILS — fmt, fmtDate, el, today, statusClass
// L.6728   UTILS — animateCount, switchView
// L.6757   UTILS — setLoading, skeleton, emptyHTML, errHTML
// L.7223   CONTACTS — showContacts, loadContacts, ledger
// L.7981   EXPORT — exportToExcel, print helpers, PDF
// L.8945   PARTNER STATEMENT — showPartnerStatement, printPartnerStatement
// L.9534   REPORTS — showReport, setReportType, runReport
// L.9907   ROLES — ROLES config, can()
// L.9945   ROLES — applyRoleRestrictions
// L.10165  SETTINGS — showSettings, switchSettTab, loadUserRoles
// L.10583  EDIT MODALS — Payment, Expense, Collection (edit)
// L.10718  OPERATING EXPENSES — showOpex, loadOpex, submitOpex
// L.11295  PWA — installPWA
//
// ════════════════════════════════════════════════════════════


// ════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════
const SB_URL  = 'https://tepaonhqszocyjsdcyoz.supabase.co';
const SB_KEY  = 'sb_publishable_l24VhFauUbUD7GfAyEnyhQ_9F_PKHH3';

// ════════════════════════════════════════
// STATE
// ════════════════════════════════════════
const state = {
  token: null,
  refreshToken: null,
  user: null,
  system: 'BOX',
  currentFileNo: null,
  currentTab: 0,
  dealsFilter: 'all',
  allDeals: [],
  allDealsEnriched: [],
  allVehicles: [],
  allSales: [],
  allExpenses: [],
  allCollections: [],
  currentDeal: null,
  currentVehicles: [],
  currentSales: [],
  chartOfAccounts: {},
  _cacheSystem: null,   // النظام اللي اتحمل منه الـ cache
  _cacheTime: 0,        // وقت آخر تحميل
};

// هل الـ cache محتاج refresh؟
function cacheStale() {
  return state._cacheSystem !== state.system || (Date.now() - state._cacheTime) > 60000;
}

// جيب البيانات من الـ cache أو حمّلها
async function ensureCache() {
  if (!cacheStale()) return;
  const sys = state.system;
  const [deals, vehicles, sales, expenses, collections] = await Promise.all([
    apiGet('purchase_orders', { select:'*', system_type:`eq.${sys}`, order:'created_at.desc' }),
    apiGet('vehicles',        { select:'*', system_type:`eq.${sys}` }),
    apiGet('sales',           { select:'*', system_type:`eq.${sys}` }),
    apiGet('expenses',        { select:'*', system_type:`eq.${sys}` }),
    apiGet('collections',     { select:'*', system_type:`eq.${sys}` }),
  ]);
  state.allDeals       = deals       || [];
  state.allVehicles    = vehicles    || [];
  state.allSales       = sales       || [];
  state.allExpenses    = expenses    || [];
  state.allCollections = collections || [];
  state._cacheSystem   = sys;
  state._cacheTime     = Date.now();

  // بناء الـ enriched deals
  const vehicleMap = {}, salesMap = {}, expMap = {};
  state.allVehicles.forEach(v => { vehicleMap[v.file_no]=vehicleMap[v.file_no]||[]; vehicleMap[v.file_no].push(v); });
  state.allSales.forEach(s   => { salesMap[s.file_no]=salesMap[s.file_no]||[];      salesMap[s.file_no].push(s); });
  state.allExpenses.forEach(e=> { expMap[e.file_no]=expMap[e.file_no]||[];          expMap[e.file_no].push(e); });

  state.allDealsEnriched = state.allDeals.map(d => {
    const fn = d.file_no;
    const vList = vehicleMap[fn]||[], sList = salesMap[fn]||[], eList = expMap[fn]||[];
    const soldCount = sList.filter(s=>s.post_status==='posted').length;
    const totalCost = +d.total_purchase || vList.reduce((s,v)=>s+(+v.purchase_price||0),0);
    const totalExp  = eList.filter(e=>e.post_status==='posted').reduce((s,e)=>s+(+e.amount||0),0);
    const totalSale = sList.filter(s=>s.post_status==='posted').reduce((s,s2)=>s+(+s2.sale_price||0),0);
    const soldVins  = new Set(sList.filter(s=>s.post_status==='posted').map(s=>s.vin));
    const fullCost  = totalCost + totalExp;
    return { ...d,
      _vTotal:vList.length, _vSold:soldCount, _vLeft:Math.max(0,vList.length-soldCount),
      _totalCost:totalCost, _totalExp:totalExp, _fullCost:fullCost,
      _totalSale:totalSale, _profit:totalSale-fullCost, _remaining:fullCost-totalSale,
      _stockVehicles: vList.filter(v => !soldVins.has(v.vin)),
    };
  });
}

// إبطال الـ cache عند أي تغيير
function invalidateCache() {
  state._cacheTime = 0;
}

// ════════════════════════════════════════
// TOKEN REFRESH
// ════════════════════════════════════════
async function refreshAccessToken() {
  const rt = state.refreshToken || localStorage.getItem('tm_refresh');
  if (!rt) { logout(); return false; }
  try {
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt })
    });
    const data = await res.json();
    if (data.access_token) {
      state.token        = data.access_token;
      state.refreshToken = data.refresh_token || rt;
      localStorage.setItem('tm_token',   data.access_token);
      localStorage.setItem('tm_refresh', data.refresh_token || rt);
      return true;
    }
  } catch(e) {}
  logout();
  return false;
}

// ════════════════════════════════════════
// API HELPERS
// ════════════════════════════════════════
function headers(extra = {}) {
  const h = {
    'apikey': SB_KEY,
    'Content-Type': 'application/json',
    ...extra
  };
  if (state.token) h['Authorization'] = `Bearer ${state.token}`;
  else h['Authorization'] = `Bearer ${SB_KEY}`;
  return h;
}

async function apiGet(table, params = {}) {
  // select و order لا يحتاجان encode — الفاصلة والنقطة جزء من syntax
  const NO_ENCODE = new Set(['select','order']);
  const qs = Object.entries(params).map(([k,v]) => NO_ENCODE.has(k) ? `${k}=${v}` : `${k}=${encodeURIComponent(v)}`).join('&');
  const url = `${SB_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`;
  let res = await fetch(url, { headers: headers({'Prefer':'return=representation'}) });
  if (res.status === 401) {
    const ok = await refreshAccessToken();
    if (!ok) throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مجدداً');
    res = await fetch(url, { headers: headers({'Prefer':'return=representation'}) });
  }
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || res.statusText); }
  return res.json();
}

async function apiPost(table, data) {
  const body = JSON.stringify(data);
  let res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers({'Prefer':'return=representation'}),
    body
  });
  if (res.status === 401) {
    const ok = await refreshAccessToken();
    if (!ok) throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مجدداً');
    res = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: headers({'Prefer':'return=representation'}),
      body
    });
  }
  const resBody = await res.json();
  if (!res.ok) throw new Error(resBody.message || resBody.error || res.statusText);
  return resBody;
}

async function apiPatch(table, matchParams, data) {
  let url = `${SB_URL}/rest/v1/${table}?`;
  for (const [k, v] of Object.entries(matchParams)) url += `${k}=${encodeURIComponent(v)}&`;
  const body = JSON.stringify(data);
  let res = await fetch(url, {
    method: 'PATCH',
    headers: headers({'Prefer':'return=representation'}),
    body
  });
  if (res.status === 401) {
    const ok = await refreshAccessToken();
    if (!ok) throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مجدداً');
    res = await fetch(url, {
      method: 'PATCH',
      headers: headers({'Prefer':'return=representation'}),
      body
    });
  }
  const resBody = await res.json();
  if (!res.ok) throw new Error(resBody.message || resBody.error || res.statusText);
  return resBody;
}

async function logAudit(action, tableName, fileNo, oldVal, newVal, notes='') {
  try {
    await apiPost('audit_log', {
      system_type: state.system,
      action,
      table_name: tableName,
      file_no: fileNo,
      old_value: oldVal ? JSON.stringify(oldVal) : null,
      new_value: newVal ? JSON.stringify(newVal) : null,
      notes,
      user_email: state.user?.email || 'unknown'
    });
  } catch(e) { /* silent */ }
}

// ════════════════════════════════════════
// AUTH
// ════════════════════════════════════════
async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value;
  const btn   = document.getElementById('loginBtn');
  const err   = document.getElementById('loginErr');
  const remember = document.getElementById('rememberMe').checked;

  if (!email || !pass) { err.textContent='يرجى إدخال البيانات كاملة'; err.style.display='block'; return; }

  btn.disabled = true;
  btn.textContent = 'جاري الدخول...';
  err.style.display = 'none';

  try {
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass })
    });
    const data = await res.json();
    if (data.access_token) {
      state.token        = data.access_token;
      state.refreshToken = data.refresh_token;
      state.user         = data.user;
      localStorage.setItem('tm_token',   data.access_token);
      localStorage.setItem('tm_refresh', data.refresh_token || '');
      localStorage.setItem('tm_user',    JSON.stringify(data.user));
      // Save credentials if remember me
      if (remember) {
        localStorage.setItem('tm_saved_email', email);
        localStorage.setItem('tm_saved_pass',  btoa(pass));
        localStorage.setItem('tm_remember', '1');
      } else {
        localStorage.removeItem('tm_saved_email');
        localStorage.removeItem('tm_saved_pass');
        localStorage.removeItem('tm_remember');
      }
      initApp();
    } else {
      err.textContent = '⚠️ ' + (data.error_description || data.msg || 'بيانات الدخول غير صحيحة');
      err.style.display = 'block';
    }
  } catch(e) {
    err.textContent = '⚠️ خطأ في الاتصال: ' + e.message;
    err.style.display = 'block';
  }
  btn.disabled = false;
  btn.textContent = 'دخول';
}

function logout() {
  localStorage.removeItem('tm_token');
  localStorage.removeItem('tm_refresh');
  localStorage.removeItem('tm_user');
  state.token        = null;
  state.refreshToken = null;
  state.user         = null;
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appScreen').style.display   = 'none';
  document.getElementById('loginPass').value = '';
}

// ════════════════════════════════════════
// TRANSACTIONS VIEW
// ════════════════════════════════════════
const TX_CONFIG = {
  sales:       { title:'المبيعات',         icon:'🧾', color:'var(--green)',  table:'sales',           amountField:'sale_price',     dateField:'sale_date', labelField:'customer' },
  expenses:    { title:'المصاريف',         icon:'💸', color:'var(--red)',    table:'expenses',        amountField:'amount',         dateField:'exp_date',  labelField:'description' },
  collections: { title:'التحصيلات',        icon:'💰', color:'var(--blue)',   table:'collections',     amountField:'amount',         dateField:'paid_date', labelField:'customer' },
  payments:    { title:'دفعات الموردين',   icon:'💳', color:'var(--cyan)',   table:'payments',        amountField:'amount',         dateField:'pay_date',  labelField:'payer' },
  payouts:     { title:'مسحوبات الشركاء', icon:'👥', color:'var(--purple)', table:'partner_payouts', amountField:'amount',         dateField:'pay_date',  labelField:'partner' },
  opex:        { title:'مصروفات عامة',     icon:'💼', color:'var(--text2)',  table:'operating_expenses', amountField:'amount',    dateField:'exp_date',  labelField:'description' },
};

let _txType = 'deals';

function showTransactions(type) {
  // الصفقات موجودة في الداشبورد — لا نكررها
  if (!type || type === 'deals') {
    showDashboard();
    return;
  }

  _txType = type;
  const cfg = TX_CONFIG[_txType];
  sessionStorage.setItem('tm_last_view', 'tx:'+_txType);

  hideAllViews();
  el('transactionsView').style.display = 'block';
  el('topBarTitle').textContent = cfg.icon + ' ' + cfg.title;
  navActive('');

  // Set default date range (current month) and activate month button
  const now = new Date();
  const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0');
  el('tx-from').value = `${y}-${m}-01`;
  el('tx-to').value   = today();
  document.querySelectorAll('[id^="txperiod-"]').forEach(b => b.classList.remove('active'));
  el('txperiod-month')?.classList.add('active');
  if (el('txCustomDateWrap')) el('txCustomDateWrap').style.display = 'none';

  el('tx-title').textContent = cfg.icon + ' ' + cfg.title;
  loadTransactions();
}


// ════════════════════════════════════════
// TRANSACTIONS DATE FILTER
// ════════════════════════════════════════
function setTxPeriod(period) {
  document.querySelectorAll('[id^="txperiod-"]').forEach(b => b.classList.remove('active'));
  el('txperiod-' + period)?.classList.add('active');
  const customWrap = el('txCustomDateWrap');
  const pad = n => String(n).padStart(2,'0');
  const toDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const now = new Date();

  if (period === 'custom') {
    customWrap.style.display = 'flex';
    return;
  }
  customWrap.style.display = 'none';

  let from, to;
  if (period === 'today') {
    from = to = toDate(now);
  } else if (period === 'week') {
    const sun = new Date(now); sun.setDate(now.getDate() - now.getDay());
    const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
    from = toDate(sun); to = toDate(sat);
  } else if (period === 'month') {
    from = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`;
    to   = toDate(new Date(now.getFullYear(), now.getMonth()+1, 0));
  } else if (period === '3months') {
    const f = new Date(now); f.setMonth(f.getMonth() - 3);
    from = toDate(f); to = toDate(now);
  }

  if (el('tx-from')) el('tx-from').value = from;
  if (el('tx-to'))   el('tx-to').value   = to;
  loadTransactions();
}

async function loadTransactions() {
  const type = _txType;
  const cfg  = TX_CONFIG[type];
  const from = el('tx-from').value;
  const to   = el('tx-to').value;
  const pf   = el('tx-post-filter')?.value || 'all';
  const sys  = state.system;

  el('tx-table').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  el('tx-kpis').innerHTML  = '';

  if (!from || !to) {
    el('tx-table').innerHTML = emptyHTML('📅','يرجى تحديد الفترة الزمنية');
    return;
  }

  const toEOD = to + 'T23:59:59';

  // helper: build Supabase URL with correct filters
  function buildUrl(table, dateCol) {
    let url = `${SB_URL}/rest/v1/${table}?select=*&system_type=eq.${encodeURIComponent(sys)}&${dateCol}=gte.${encodeURIComponent(from)}&${dateCol}=lte.${encodeURIComponent(toEOD)}&order=${dateCol}.desc`;
    // post_status: old records have null = treat as posted
    if (pf === 'draft')  url += '&post_status=eq.draft';
    if (pf === 'posted') url += '&or=(post_status.eq.posted,post_status.is.null)';
    return url;
  }

  try {
    let rows = [];

    if (type === 'opex') {
      // operating_expenses has no post_status
      const r = await fetch(buildUrl('operating_expenses', 'exp_date').replace('&or=(post_status.eq.posted,post_status.is.null)','').replace('&post_status=eq.draft',''), { headers: headers() });
      rows = r.ok ? await r.json() : [];
    } else {
      const r = await fetch(buildUrl(cfg.table, cfg.dateField), { headers: headers() });
      rows = r.ok ? await r.json() : [];
    }

    rows = rows || [];

    // Get audit_log for created_by
    let auditMap = {};
    try {
      const audits = await apiGet('audit_log', {
        select: 'ref_id,user_email',
        action: 'eq.INSERT',
        table_name: `eq.${cfg.table}`,
        limit: '500'
      });
      (audits||[]).forEach(a => { if(a.ref_id) auditMap[String(a.ref_id)] = (a.user_email||'').split('@')[0]; });
    } catch(e) {}

    // KPIs
    const total       = rows.reduce((s,r)=>s+(+r[cfg.amountField]||0), 0);
    const draftCount  = rows.filter(r=>r.post_status==='draft').length;
    const postedCount = rows.length - draftCount;

    el('tx-subtitle').textContent = `${rows.length} سجل · ${from} — ${to}`;
    el('tx-kpis').innerHTML = `
      <div class="j-kpi" style="border-right:3px solid ${cfg.color}">
        <div class="j-kpi-label">${cfg.icon} إجمالي ${cfg.title}</div>
        <div class="j-kpi-val" style="color:${cfg.color};font-size:18px;font-weight:900">${fmt(total)}</div>
      </div>
      <div class="j-kpi">
        <div class="j-kpi-label">عدد السجلات</div>
        <div class="j-kpi-val">${rows.length}</div>
      </div>
      ${pf==='all' && draftCount > 0 ? `
      <div class="j-kpi">
        <div class="j-kpi-label">✅ مرحَّل</div>
        <div class="j-kpi-val text-green">${postedCount}</div>
      </div>
      <div class="j-kpi">
        <div class="j-kpi-label">⏳ معلق</div>
        <div class="j-kpi-val" style="color:var(--accent)">${draftCount}</div>
      </div>` : ''}`;

    window._txRows = rows;
    window._txAuditMap = auditMap;
    window._txCfg = cfg;
    window._txType2 = type;

    renderTxTable(rows, cfg, auditMap, type);

  } catch(e) {
    el('tx-table').innerHTML = `<div class="empty-state"><div class="e-icon">⚠️</div><p>خطأ: ${e.message}</p></div>`;
    console.error('loadTransactions error:', e);
  }
}

function renderTxTable(rows, cfg, auditMap, type) {
  if (!rows.length) {
    el('tx-table').innerHTML = emptyHTML(cfg.icon, 'لا توجد سجلات في هذه الفترة');
    return;
  }

  // Build columns based on type
  const cols = {
    deals:       [{k:'po_date',t:'التاريخ'},{k:'file_no',t:'رقم الملف'},{k:'supplier',t:'المورد'},{k:'vehicle_count',t:'سيارات'},{k:'total_purchase',t:'القيمة',mono:true},{k:'status',t:'الحالة'}],
    sales:       [{k:'sale_date',t:'التاريخ'},{k:'file_no',t:'الملف'},{k:'inv_no',t:'الفاتورة'},{k:'customer',t:'العميل'},{k:'vin',t:'شاصي'},{k:'sale_price',t:'السعر',mono:true}],
    expenses:    [{k:'exp_date',t:'التاريخ'},{k:'file_no',t:'الملف'},{k:'ref_no',t:'المرجع'},{k:'description',t:'الوصف'},{k:'exp_type',t:'النوع'},{k:'amount',t:'المبلغ',mono:true}],
    collections: [{k:'paid_date',t:'التاريخ'},{k:'file_no',t:'الملف'},{k:'inv_no',t:'الفاتورة'},{k:'customer',t:'العميل'},{k:'amount',t:'المبلغ',mono:true}],
    payments:    [{k:'pay_date',t:'التاريخ'},{k:'file_no',t:'الملف'},{k:'ref_no',t:'المرجع'},{k:'payer',t:'الدافع'},{k:'pay_method',t:'الطريقة'},{k:'amount',t:'المبلغ',mono:true}],
    payouts:     [{k:'pay_date',t:'التاريخ'},{k:'file_no',t:'الملف'},{k:'pay_id',t:'المرجع'},{k:'partner',t:'الشريك'},{k:'payout_type',t:'النوع'},{k:'amount',t:'المبلغ',mono:true}],
    opex:        [{k:'exp_date',t:'التاريخ'},{k:'ref_no',t:'المرجع'},{k:'description',t:'الوصف'},{k:'category',t:'الفئة'},{k:'amount',t:'المبلغ',mono:true}],
  };

  const typeCols = cols[type] || cols.sales;

  const statusBadge = r => {
    if (!r.post_status || r.post_status==='posted') return '<span style="background:var(--green-dim);color:var(--green);padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">✅ مرحَّل</span>';
    return '<span style="background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">⏳ معلق</span>';
  };

  const thead = `<tr>${typeCols.map(c=>`<th>${c.t}</th>`).join('')}<th>بواسطة</th><th>الحالة</th></tr>`;

  const tbody = rows.map(r => {
    const cells = typeCols.map(col => {
      let v = r[col.k] ?? '—';
      if (col.k.includes('date')) v = fmtDate(v);
      if (col.mono) v = `<span class="mono" style="color:${cfg.color};font-weight:700">${fmt(v)}</span>`;
      return `<td>${v}</td>`;
    }).join('');
    const user = auditMap[String(r.id)] || '—';
    const shortUser = user.split('@')[0];
    const rowClick = type==='deals' ? `onclick="openViewer('${r.file_no}')" style="cursor:pointer"` : '';
    return `<tr ${rowClick}>${cells}<td style="font-size:11px;color:var(--text2)">${shortUser}</td><td>${statusBadge(r)}</td></tr>`;
  }).join('');

  const total = rows.reduce((s,r)=>s+(+r[cfg.amountField]||0),0);
  const tfoot = `<tr style="background:var(--card2);font-weight:700"><td colspan="${typeCols.length-1}">الإجمالي</td><td class="mono">${fmt(total)}</td><td colspan="2"></td></tr>`;

  el('tx-table').innerHTML = `
    <table class="data-table" id="tx-data-table">
      <thead>${thead}</thead>
      <tbody id="tx-tbody">${tbody}</tbody>
      <tfoot>${tfoot}</tfoot>
    </table>`;
}

function filterTxTable() {
  const q = el('tx-search')?.value?.toLowerCase() || '';
  const rows = document.querySelectorAll('#tx-tbody tr');
  rows.forEach(r => {
    r.style.display = !q || r.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

async function exportTxPDF() {
  const table = el('tx-data-table');
  if (!table) { toast('لا توجد بيانات','err'); return; }
  const cfg = TX_CONFIG[_txType];
  printDocument(`<h2 style="margin-bottom:16px">${cfg.icon} ${cfg.title}</h2>${table.outerHTML}`, cfg.title);
}

async function exportTxExcel() {
  if (!window._txRows?.length) { toast('لا توجد بيانات','err'); return; }
  const cfg = window._txCfg;
  const rows = window._txRows;
  const auditMap = window._txAuditMap || {};

  const headers2 = Object.keys(rows[0]).filter(k=>!k.startsWith('_'));
  headers2.push('created_by');
  const data = rows.map(r => {
    const row = headers2.slice(0,-1).map(k => r[k] ?? '');
    row.push(auditMap[String(r.id)] || '');
    return row;
  });

  exportToExcel([{ name: cfg.title, headers: headers2, data }], cfg.title + '_' + today());
}


function initApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';

  // User info
  const email = state.user?.email || 'user@tm.com';
  const name  = email.split('@')[0].replace('.', ' ');
  document.getElementById('userAvatar').textContent = name[0].toUpperCase();
  document.getElementById('userName').textContent = name;
  document.getElementById('userEmailDisplay').textContent = email;

  loadChartOfAccounts();
  loadDashboard().then(() => {
    // Restore last view after refresh
    const lastView = sessionStorage.getItem('tm_last_view');
    if (lastView === 'contacts') showContacts();
    else if (lastView === 'journal') showJournal();
    else if (lastView === 'activity') showActivityLog();
    else if (lastView === 'settings') showSettings();
    else if (lastView && lastView.startsWith('report:')) showReport(lastView.split(':')[1]);
    else showDashboard();
  });
  loadUserRoleFromDB();
  updateSystemUI();
}

// ════════════════════════════════════════
// SYSTEM SWITCH
// ════════════════════════════════════════
// Approval state
const approvalState = { all: [], filtered: [], currentType: 'all', currentItem: null, auditUsers: {} };

// تحميل شجرة الحسابات وتخزينها في cache
async function loadChartOfAccounts() {
  try {
    const rows = await apiGet('chart_of_accounts', {
      select: 'account_code,account_name,account_type,parent_code',
      system_type: `eq.${state.system}`,
      is_active: 'eq.true',
    });
    state.chartOfAccounts = {};
    (rows||[]).forEach(r => {
      state.chartOfAccounts[r.account_code] = {
        name: r.account_name,
        type: r.account_type,
        parent_code: r.parent_code,
      };
    });
  } catch(e) { console.warn('loadChartOfAccounts:', e.message); }
}

// جيب اسم الحساب من الـ cache
function getAccountName(code) {
  return state.chartOfAccounts[code]?.name || code;
}

function getAccountTypeCOA(code) {
  return state.chartOfAccounts[code]?.type || getAccountType(code);
}

function switchSystem(sys) {
  state.system = sys;
  state.currentFileNo = null;
  document.getElementById('sysBox').classList.toggle('active', sys === 'BOX');
  document.getElementById('sysTm').classList.toggle('active', sys === 'TM');
  updateSystemUI();
  loadChartOfAccounts();
  showDashboard();
  loadDashboard();
}

function updateSystemUI() {
  const sys = state.system;
  document.getElementById('topBarSub').textContent = `نظام ${sys}`;
  document.getElementById('nfSystemLabel').textContent = sys;
}

// ════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════
// ════════════════════════════════════════
// DASHBOARD — period-based
// ════════════════════════════════════════
const dashState = { days: 30, from: null, to: null };

function setDashPeriod(days) {
  // Update active button
  document.querySelectorAll('.dash-period-btn').forEach(b => b.classList.remove('active'));
  const btn = el('period-btn-' + days);
  if (btn) btn.classList.add('active');

  const customDates = el('dash-custom-dates');
  if (days === 'custom') {
    if (customDates) customDates.style.display = 'flex';
    const from = el('dash-from')?.value;
    const to   = el('dash-to')?.value;
    if (!from || !to) return;
    dashState.days = 'custom';
    dashState.from = from;
    dashState.to   = to;
  } else {
    if (customDates) customDates.style.display = 'none';
    dashState.days = days;
    const toDate   = new Date();
    const fromDate = new Date(Date.now() - days * 864e5);
    dashState.from = fromDate.toISOString().split('T')[0];
    dashState.to   = toDate.toISOString().split('T')[0];
  }

  // Update period label
  const labels = {7:'آخر 7 أيام', 30:'آخر 30 يوم', 60:'آخر 60 يوم', 90:'آخر 90 يوم'};
  if (el('dash-period-label')) {
    el('dash-period-label').textContent = days === 'custom'
      ? `${dashState.from} — ${dashState.to}`
      : labels[days] || '';
  }

  loadDashboard();
}

async function loadDashboard() {
  setLoading('dealsTableBody');
  const sys  = state.system;
  const from = dashState.from || new Date(Date.now() - 30*864e5).toISOString().split('T')[0];
  const to   = dashState.to   || new Date().toISOString().split('T')[0];
  const todayStr = new Date().toISOString().split('T')[0];
  const in7   = new Date(Date.now() + 7*864e5).toISOString().split('T')[0];

  try {
    await ensureCache();
    const deals       = state.allDeals;
    const vehicles    = state.allVehicles;
    const allSales    = state.allSales;
    const allExpenses = state.allExpenses;
    const collections = state.allCollections;
    const drafts      = await apiGet('journal_entries', { select:'id', system_type:`eq.${sys}`, post_status:'eq.draft' });

    // ── فلتر بيانات الفترة ──
    const inPeriod = (dateStr) => dateStr && dateStr >= from && dateStr <= to;
    const periodSales = (allSales||[]).filter(s => inPeriod(s.sale_date||s.created_at?.split('T')[0]));
    const periodExp   = (allExpenses||[]).filter(e => inPeriod(e.exp_date||e.expense_date||e.created_at?.split('T')[0]));

    // ── Enrich deals — من الـ cache ──
    // ensureCache() بنت allDealsEnriched بالفعل

    // ── حسابات الفترة ──
    const totSales      = periodSales.reduce((s,r)=>s+(+r.sale_price||0),0);
    const totExp        = periodExp.reduce((s,e)=>s+(+e.amount||0),0);
    const periodFileNos = new Set(periodSales.map(s=>s.file_no));
    const periodDeals        = (deals||[]).filter(d => periodFileNos.has(d.file_no));
    const periodPurchaseDeals= (deals||[]).filter(d => { const dt = d.po_date || d.created_at?.split('T')[0] || ''; return dt >= from && dt <= to; });
    const totPurchase        = periodPurchaseDeals.reduce((s,d2)=>s+(+d2.total_purchase||0),0);
    const profit        = totSales - totPurchase - totExp;
    const margin        = totSales > 0 ? ((profit/totSales)*100).toFixed(1) : 0;
    const soldVinsAll   = new Set((allSales||[]).map(s=>s.vin));
    const stockVehicles = (vehicles||[]).filter(v => !soldVinsAll.has(v.vin));
    const overdueList   = (collections||[]).filter(c => !c.paid_date && (c.due_date ? c.due_date <= todayStr : true));
    const upcomingList  = (collections||[]).filter(c => !c.paid_date && c.due_date && c.due_date > todayStr && c.due_date <= in7);
    const overdueAmt    = overdueList.reduce((s,c)=>s+(+c.amount||0),0);
    const draftCount    = (drafts||[]).length;

    // ── حفظ البيانات للـ drill-down ──
    _ddState.data = {
      periodSales, periodExp, periodDeals, periodPurchaseDeals,
      periodCollections: (collections||[]).filter(c => {
        const d = c.due_date||c.paid_date||c.created_at?.split('T')[0]||'';
        return d >= from && d <= to;
      }),
      stockVehicles, todayStr, from, to,
    };

    // ── KPIs ──
    const totCollections = (_ddState.data.periodCollections||[]).reduce((s,c)=>s+(+c.amount||0),0);
    const totFullCost    = totPurchase + totExp;

    const setKpi = (id, val, color) => { const e = el(id); if(!e) return; animateCount(e, String(val), color); };
    setKpi('kpi-purchase',    fmt(totPurchase),    'var(--blue)');
    setKpi('kpi-sales',       fmt(totSales),       'var(--green)');
    setKpi('kpi-collections', fmt(totCollections), 'var(--blue)');
    setKpi('kpi-month-exp',   fmt(totExp),         totExp>0?'var(--red)':'var(--text2)');
    setKpi('kpi-fullcost',    fmt(totFullCost),     'var(--accent)');
    setKpi('kpi-profit',      fmt(profit),          profit>=0?'var(--green)':'var(--red)');
    setKpi('kpi-stock',       stockVehicles.length, stockVehicles.length>0?'var(--purple)':'var(--green)');

    if(el('kpi-purchase-sub'))    el('kpi-purchase-sub').textContent    = `${periodPurchaseDeals.length} صفقة`;
    if(el('kpi-sales-sub'))       el('kpi-sales-sub').textContent       = `${periodSales.length} فاتورة`;
    if(el('kpi-collections-sub')) el('kpi-collections-sub').textContent = `${(_ddState.data.periodCollections||[]).length} قيد`;
    if(el('kpi-month-exp-sub'))   el('kpi-month-exp-sub').textContent   = `${periodExp.length} بند`;
    if(el('kpi-fullcost-sub'))    el('kpi-fullcost-sub').textContent    = `شراء ${fmt(totPurchase)} + مصاريف ${fmt(totExp)}`;
    if(el('kpi-profit-sub'))      el('kpi-profit-sub').textContent      = `هامش ${margin}%`;
    if(el('kpi-stock-sub'))       el('kpi-stock-sub').textContent       = stockVehicles.filter(v=>daysSince(v.created_at)>60).length>0 ? `${stockVehicles.filter(v=>daysSince(v.created_at)>60).length} أكثر من 60 يوم` : 'لم تُباع بعد';

    // ── Badges ──
    if(el('badge-open'))     el('badge-open').textContent     = (deals||[]).filter(d=>d.status==='OPEN').length || '';
    if(el('badge-progress')) el('badge-progress').textContent = (deals||[]).filter(d=>d.status==='IN PROGRESS').length || '';

    // ── مستحق للموردين ──
    try {
      const allPayments = await apiGet('payments', { select:'file_no,amount', system_type:`eq.${sys}` });
      const paidMap = {};
      (allPayments||[]).forEach(p => { paidMap[p.file_no] = (paidMap[p.file_no]||0) + (+p.amount||0); });
      const duelist = (deals||[]).map(d => ({
        file_no: d.file_no, supplier: d.supplier||'—',
        due: (+d.total_purchase||0) - (paidMap[d.file_no]||0)
      })).filter(d => d.due > 0.01).sort((a,b) => b.due - a.due);
      const totalDue = duelist.reduce((s,d) => s + d.due, 0);
      if (el('dash-supplier-due')) el('dash-supplier-due').textContent = fmt(totalDue);
      if (el('dash-supplier-due-list')) {
        el('dash-supplier-due-list').innerHTML = duelist.length
          ? duelist.slice(0,3).map(d =>
              `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)">
                <span style="color:var(--text)">${d.supplier} <span style="color:var(--accent);font-family:monospace;font-size:10px">${d.file_no}</span></span>
                <span style="font-family:monospace;color:var(--red);font-weight:700">${fmt(d.due)}</span>
              </div>`).join('') + (duelist.length > 3 ? `<div style="font-size:10px;color:var(--text2);margin-top:4px">+ ${duelist.length-3} صفقة أخرى</div>` : '')
          : '<div style="color:var(--green);font-size:11px">✓ لا توجد مستحقات</div>';
      }
    } catch(e) {}

    // ── تحصيلات متأخرة ──
    const overdueItems = (collections||[]).filter(c => !c.paid_date && (c.due_date ? c.due_date <= todayStr : true))
      .sort((a,b) => a.due_date > b.due_date ? 1 : -1);
    const overdueTotal = overdueItems.reduce((s,c) => s + (+c.amount||0), 0);
    if (el('dash-overdue-amt')) el('dash-overdue-amt').textContent = fmt(overdueTotal);
    if (el('dash-overdue-list')) {
      el('dash-overdue-list').innerHTML = overdueItems.length
        ? overdueItems.slice(0,3).map(c =>
            `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)">
              <span style="color:var(--text)">${c.customer||'—'} <span style="color:var(--text2);font-size:10px">${c.due_date}</span></span>
              <span style="font-family:monospace;color:var(--accent);font-weight:700">${fmt(c.amount)}</span>
            </div>`).join('') + (overdueItems.length > 3 ? `<div style="font-size:10px;color:var(--text2);margin-top:4px">+ ${overdueItems.length-3} فاتورة أخرى</div>` : '')
        : '<div style="color:var(--green);font-size:11px">✓ لا توجد تحصيلات متأخرة</div>';
    }

    // ── Alerts ──
    renderDashAlerts(overdueList, upcomingList, stockVehicles, draftCount, deals||[]);

    // ── Performance chart ──
    // Chart removed — drill-down replaces it

    // ── Expenses breakdown ──
    renderDashExpBreakdown(periodExp);

    // ── Collections list ──
    renderDashCollections(overdueList, upcomingList, todayStr);

    // ── Full deals table ──
    const list = state.dealsFilter==='all' ? state.allDealsEnriched : state.allDealsEnriched.filter(d=>d.status===state.dealsFilter);
    if(el('dealsCountLabel')) el('dealsCountLabel').textContent = `${state.allDealsEnriched.length} ملف`;
    renderDealsTable(list);

    // ── لو كان drill-down مفتوح، نحدثه ──
    if (_ddState.type) renderDrillDown(_ddState.type);

    // تحديث badge الموافقات
    if (can('roles')) updateApprovalBadge();

  } catch(e) {
    showErr('dealsTableBody', 'خطأ في تحميل البيانات: ' + e.message);
    console.error(e);
  }
}

// ── Performance Chart — Stacked Bar ──
function renderDashPerfChart(sales, expenses, from, to, days, deals) {
  const chartWrap  = el('dash-perf-chart');
  const labelsWrap = el('dash-perf-labels');
  if (!chartWrap) return;

  const fromD = new Date(from), toD = new Date(to);
  const totalDays = Math.round((toD - fromD) / 864e5) + 1;
  let buckets = [];

  if (totalDays <= 14) {
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(fromD); d.setDate(d.getDate() + i);
      const ds = d.toISOString().split('T')[0];
      buckets.push({ label: `${d.getDate()}/${d.getMonth()+1}`, from:ds, to:ds, purchase:0, exp:0, sales:0 });
    }
  } else if (totalDays <= 60) {
    let cur = new Date(fromD);
    while (cur <= toD) {
      const wEnd = new Date(cur); wEnd.setDate(wEnd.getDate()+6);
      if (wEnd > toD) wEnd.setTime(toD.getTime());
      buckets.push({ label:`${cur.getDate()}/${cur.getMonth()+1}`, from:cur.toISOString().split('T')[0], to:wEnd.toISOString().split('T')[0], purchase:0, exp:0, sales:0 });
      cur = new Date(wEnd); cur.setDate(cur.getDate()+1);
    }
  } else {
    let cur = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
    while (cur <= toD) {
      const mEnd = new Date(cur.getFullYear(), cur.getMonth()+1, 0);
      buckets.push({ label:cur.toLocaleDateString('en-GB',{month:'short'}), from:cur.toISOString().split('T')[0], to:mEnd.toISOString().split('T')[0], purchase:0, exp:0, sales:0 });
      cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
    }
  }

  // توزيع البيانات
  (deals||[]).forEach(d => {
    const date = d.po_date||'';
    const b = buckets.find(bk => date >= bk.from && date <= bk.to);
    if (b) b.purchase += +d.total_purchase||0;
  });
  sales.forEach(s => {
    const d = s.sale_date||s.created_at?.split('T')[0]||'';
    const b = buckets.find(bk => d >= bk.from && d <= bk.to);
    if (b) b.sales += +s.sale_price||0;
  });
  expenses.forEach(e => {
    const d = e.exp_date||e.expense_date||e.created_at?.split('T')[0]||'';
    const b = buckets.find(bk => d >= bk.from && d <= bk.to);
    if (b) b.exp += +e.amount||0;
  });
  buckets.forEach(b => b.profit = b.sales - b.purchase - b.exp);

  const fmtK = v => v >= 1000 ? (v/1000).toFixed(1)+'K' : v > 0 ? v.toFixed(0) : '';
  const CHART_H = 110;

  // Stacked Bar: كل بار = purchase (أزرق) + exp (أحمر) مكدسين، وبار المبيعات جنبهم (أخضر)
  const maxVal = Math.max(...buckets.map(b => Math.max(b.purchase + b.exp, b.sales, 1)), 1);

  chartWrap.style.cssText = 'display:flex;gap:6px;align-items:flex-end;height:' + CHART_H + 'px;margin-bottom:8px;padding-top:14px';

  chartWrap.innerHTML = buckets.map(b => {
    const stackH = Math.max(((b.purchase + b.exp) / maxVal) * CHART_H, (b.purchase+b.exp)>0?4:0);
    const purH   = stackH > 0 ? Math.round((b.purchase / (b.purchase+b.exp||1)) * stackH) : 0;
    const expH   = stackH - purH;
    const salH   = Math.max((b.sales / maxVal) * CHART_H, b.sales>0?4:0);
    const pColor = b.profit >= 0 ? 'var(--green)' : 'var(--red)';
    const tooltip = `مشتريات: ${fmtK(b.purchase)} | مصروفات: ${fmtK(b.exp)} | مبيعات: ${fmtK(b.sales)} | ربح: ${fmtK(Math.abs(b.profit))}`;
    return `
    <div style="flex:1;display:flex;gap:2px;align-items:flex-end;min-width:0" title="${tooltip}">
      <!-- Stacked: مشتريات + مصروفات -->
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;position:relative">
        ${b.purchase+b.exp > 0 ? `<div style="font-size:8px;color:var(--text2);position:absolute;top:-12px;white-space:nowrap">${fmtK(b.purchase+b.exp)}</div>` : ''}
        <div style="width:100%;display:flex;flex-direction:column;border-radius:3px 3px 0 0;overflow:hidden">
          <div style="width:100%;height:${purH}px;background:var(--blue);min-height:${b.purchase>0?2:0}px"></div>
          <div style="width:100%;height:${expH}px;background:var(--red);min-height:${b.exp>0?2:0}px"></div>
        </div>
      </div>
      <!-- مبيعات -->
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;position:relative">
        ${b.sales > 0 ? `<div style="font-size:8px;color:var(--green);position:absolute;top:-12px;white-space:nowrap">${fmtK(b.sales)}</div>` : ''}
        <div style="width:100%;height:${salH}px;background:var(--green);border-radius:3px 3px 0 0;min-height:${b.sales>0?2:0}px"></div>
      </div>
    </div>`;
  }).join('');

  if (labelsWrap) {
    labelsWrap.innerHTML = buckets.map(b =>
      `<div style="flex:1;text-align:center;font-size:9px;color:var(--text2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.label}</div>`
    ).join('');
  }
}

// ── Period deals summary ──

// ── Helper: days since date ──
function daysSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 864e5);
}

// ── Alerts strip ──
function renderDashAlerts(overdueList, upcomingList, stockVehicles, draftCount, deals) {
  const wrap   = el('dash-alerts-wrap');
  const alerts = el('dash-alerts');
  if (!wrap || !alerts) return;

  const items = [];
  if (overdueList.length)  items.push({ count: overdueList.length,  label: 'تحصيلات متأخرة',  sub: `أقدمها ${daysSince(overdueList.sort((a,b)=>a.due_date>b.due_date?1:-1)[0]?.due_date)} يوم`, color:'var(--red)',    bg:'var(--red-dim)' });
  if (upcomingList.length) items.push({ count: upcomingList.length, label: 'تحصيلات قادمة',   sub: 'خلال 7 أيام',  color:'var(--accent)', bg:'var(--accent-dim)' });
  const oldStock = stockVehicles.filter(v => daysSince(v.created_at) > 60);
  if (oldStock.length)     items.push({ count: oldStock.length,     label: 'سيارات +60 يوم',  sub: 'راكدة في المخزن', color:'var(--amber)', bg:'var(--amber-dim)||var(--accent-dim)' });
  if (draftCount)          items.push({ count: draftCount,          label: 'مسودات معلقة',    sub: 'لم تُرحَّل بعد', color:'var(--purple)', bg:'var(--purple-dim)' });
  const oldDeals = deals.filter(d => d.status==='OPEN' && daysSince(d.created_at||d.po_date) > 30);
  if (oldDeals.length)     items.push({ count: oldDeals.length,     label: 'صفقات مفتوحة طويل', sub: 'أكثر من 30 يوم', color:'var(--blue)', bg:'var(--blue-dim)' });

  if (!items.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  alerts.innerHTML = items.map(a => `
    <div style="flex-shrink:0;background:var(--card);border:1px solid var(--border);border-right:3px solid ${a.color};border-radius:var(--radius-sm);padding:10px 14px;min-width:140px;cursor:pointer;transition:background .15s"
      onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background='var(--card)'">
      <div style="font-size:22px;font-weight:700;color:${a.color};font-family:var(--mono);line-height:1;margin-bottom:3px">${a.count}</div>
      <div style="font-size:11px;font-weight:600;color:var(--text)">${a.label}</div>
      <div style="font-size:10px;color:${a.color};margin-top:2px">${a.sub}</div>
    </div>`).join('');
}

// ── Collections list ──
function renderDashCollections(overdueList, upcomingList, today) {
  const wrap = el('dash-collections-list');
  if (!wrap) return;
  const all  = [
    ...overdueList.map(c=>({...c, _type:'overdue'})),
    ...upcomingList.map(c=>({...c, _type:'upcoming'})),
  ].sort((a,b) => (a.due_date||'') > (b.due_date||'') ? 1 : -1).slice(0,5);
  if(el('collections-label')) el('collections-label').textContent = `${overdueList.length} متأخر · ${upcomingList.length} قادم`;
  if (!all.length) { wrap.innerHTML = `<div style="font-size:12px;color:var(--green);text-align:center;padding:16px">✓ لا توجد تحصيلات متأخرة</div>`; return; }
  wrap.innerHTML = all.map(c => {
    const isOverdue = c._type === 'overdue';
    const daysAgo   = daysSince(c.due_date);
    const color     = isOverdue ? 'var(--red)' : 'var(--accent)';
    const subText   = isOverdue ? `متأخر ${daysAgo} يوم` : `يستحق ${c.due_date}`;
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="openViewer('${c.file_no||''}')">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.customer||'—'}</div>
        <div style="font-size:10px;color:var(--text2)">${c.file_no||'—'} · ${c.inv_no||'—'}</div>
      </div>
      <div style="text-align:left;flex-shrink:0;margin-right:8px">
        <div style="font-size:12px;font-weight:700;color:${color};font-family:monospace">${fmt(c.amount)}</div>
        <div style="font-size:10px;color:${color}">${subText}</div>
      </div>
    </div>`; }).join('');
}

// ── Expenses breakdown ──
function renderDashExpBreakdown(expenses) {
  const wrap = el('dash-exp-breakdown');
  if (!wrap) return;
  const byType = {};
  expenses.forEach(e => { const t = e.exp_type||e.category||'أخرى'; byType[t]=(byType[t]||0)+(+e.amount||0); });
  const total = Object.values(byType).reduce((s,v)=>s+v,0);
  if (!total) { wrap.innerHTML = `<div style="font-size:11px;color:var(--text2)">لا توجد مصاريف</div>`; return; }
  const colors = ['var(--blue)','var(--purple)','var(--accent)','var(--cyan)','var(--green)'];
  wrap.innerHTML = Object.entries(byType).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([type,amt],i) => {
    const pct = Math.round((amt/total)*100);
    return `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
      <div style="font-size:11px;color:var(--text2);width:55px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${type}</div>
      <div style="flex:1;height:5px;background:var(--card2);border-radius:3px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${colors[i%colors.length]};border-radius:3px"></div>
      </div>
      <div style="font-size:10px;font-weight:600;color:${colors[i%colors.length]};width:28px;text-align:left">${pct}%</div>
    </div>`;
  }).join('');
}



// دالة موحدة لعرض جدول الصفقات
// targetId: العنصر اللي هيتكتب فيه
// opts.showSales: يضيف عمود المبيعات (للتقارير)
// opts.totalRow: يضيف صف الإجمالي
function renderDealsTable(deals, targetId = 'dealsTableBody', opts = {}) {
  const target = el(targetId);
  if (!target) return;

  const showSales = opts.showSales || false;
  const countLabel = el('dealsCountLabel');
  if (countLabel) countLabel.textContent = `${deals.length} ملف`;

  if (!deals.length) {
    target.innerHTML = `<div class="empty-state"><div class="e-icon">📂</div><p>لا توجد صفقات بعد</p><small>أضف ملف جديد للبدء</small></div>`;
    return;
  }

  const rows = deals.map(d => {
    const profitColor   = d._profit > 0 ? 'var(--green)' : d._profit < 0 ? 'var(--red)' : 'var(--text2)';
    const remaining     = (d._fullCost||0) - (d._totalSale||0);
    const fileNoDisplay = d.file_no || '⚠️ بدون رقم';
    const canOpen       = !!d.file_no;
    return `<tr onclick="${canOpen?`openViewer('${d.file_no}')`:'void(0)'}" style="cursor:${canOpen?'pointer':'default'}">
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="mono text-amber" style="font-weight:700">${fileNoDisplay}</span>
          ${canOpen ? `<button onclick="event.stopPropagation();openNewFileModal('${d.file_no}')"
            style="background:none;border:none;cursor:pointer;color:var(--text2);font-size:13px;padding:2px 4px;border-radius:4px" title="تعديل">✏️</button>` : ''}
          ${can('delete') ? `<button onclick="event.stopPropagation();deleteOrphanDeal('${d.id||d.file_no}')"
            style="background:none;border:none;cursor:pointer;color:var(--red);font-size:13px;padding:2px 4px;border-radius:4px" title="حذف">🗑</button>` : ''}
        </div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${fmtDate(d.po_date)}</div>
      </td>
      <td>
        <div style="font-weight:600">${d.supplier||d.file||'—'}</div>
        <div style="font-size:11px;color:var(--text2)">${d.notes||''}</div>
      </td>
      <td style="text-align:center">
        <div style="font-family:var(--mono);font-weight:700">${d._vTotal||0}</div>
        <div style="font-size:10px;color:var(--text2)">${d._vSold||0} مباع · ${d._vLeft||0} متبقي</div>
      </td>
      <td class="mono text-blue">${fmt(d._totalCost||d.total_purchase||d.purchase||0)}</td>
      <td class="mono text-red">${fmt(d._totalExp||d.expenses||0)}</td>
      <td class="mono" style="font-weight:700">${fmt(d._fullCost||d.fullCost||0)}</td>
      ${showSales ? `<td class="mono text-green">${fmt(d._totalSale||d.sales||0)}</td>` : ''}
      <td class="mono" style="font-weight:700;color:${profitColor}">
        ${(d._profit||d.profit||0)>=0?'▲':'▼'} ${fmt(Math.abs(d._profit||d.profit||0))}
      </td>
      <td class="mono" style="color:${remaining>0?'var(--red)':remaining<0?'var(--green)':'var(--text2)'};font-size:12px">
        ${remaining > 0 ? fmt(remaining)+' غير مغطى' : remaining < 0 ? fmt(Math.abs(remaining))+' ربح ✓' : '✓ متعادل'}
      </td>
      <td><span class="badge badge-${statusClass(d.status)}">${d.status||'—'}</span></td>
    </tr>`;
  }).join('');

  // صف الإجمالي (للتقارير)
  let totalRow = '';
  if (opts.totalRow) {
    const tp = deals.reduce((s,d)=>s+(d._totalCost||d.purchase||0),0);
    const te = deals.reduce((s,d)=>s+(d._totalExp||d.expenses||0),0);
    const ts = deals.reduce((s,d)=>s+(d._totalSale||d.sales||0),0);
    const tP = deals.reduce((s,d)=>s+(d._profit||d.profit||0),0);
    totalRow = `<tr style="background:var(--card2);font-weight:700;border-top:2px solid var(--border)">
      <td colspan="3">الإجمالي (${deals.length} صفقة)</td>
      <td class="mono text-blue">${fmt(tp)}</td>
      <td class="mono text-red">${fmt(te)}</td>
      <td class="mono">${fmt(tp+te)}</td>
      ${showSales ? `<td class="mono text-green">${fmt(ts)}</td>` : ''}
      <td class="mono" style="color:${tP>=0?'var(--green)':'var(--red)'}">
        ${tP>=0?'▲':'▼'} ${fmt(Math.abs(tP))}
      </td>
      <td></td><td></td>
    </tr>`;
  }

  target.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>رقم الملف</th><th>المورد / البيان</th>
        <th style="text-align:center">السيارات</th>
        <th style="color:var(--blue)">تكلفة الشراء</th>
        <th style="color:var(--red)">المصاريف</th>
        <th>التكلفة الكاملة</th>
        ${showSales ? '<th style="color:var(--green)">المبيعات</th>' : ''}
        <th>الربح/الخسارة</th>
        <th>متبقي / ربح</th>
        <th>الحالة</th>
      </tr></thead>
      <tbody>${rows}${totalRow}</tbody>
    </table>`;
}

function filterDeals(status) {
  state.dealsFilter = status;
  const src = state.allDealsEnriched || state.allDeals || [];
  const deals = status === 'all' ? src : src.filter(d => d.status === status);
  renderDealsTable(deals);
  navActive('nav-dashboard');
  showDashboard();
  // Update active filter button
  document.querySelectorAll('.section-actions .btn').forEach(b => b.classList.remove('active-filter'));
  const labels = {'all':'الكل','OPEN':'مفتوح','IN PROGRESS':'جاري','CLOSED':'مغلق'};
  document.querySelectorAll('.section-actions .btn').forEach(b => {
    if (b.textContent.trim() === (labels[status]||status)) b.classList.add('active-filter');
  });
}

// ════════════════════════════════════════
// VIEWER
// ════════════════════════════════════════

async function openViewer(fileNo) {
  state.currentFileNo = fileNo;
  state.currentTab = 0;

  hideAllViews();
  el('viewerView').style.display = 'block';

  // Find deal from cache
  const deal = state.allDeals.find(d => d.file_no === fileNo);
  state.currentDeal = deal;

  // Header
  el('vh-fileNo').textContent = fileNo;
  el('vh-meta').innerHTML = `
    <span class="vh-meta-item"><strong>المورد:</strong> ${deal?.supplier || '—'}</span>
    <span class="vh-meta-item"><strong>PO:</strong> ${deal?.po_no || '—'}</span>
    <span class="vh-meta-item"><strong>التاريخ:</strong> ${fmtDate(deal?.po_date)}</span>
    <span class="vh-meta-item"><strong>عدد السيارات:</strong> ${deal?.vehicle_count || '—'}</span>
  `;
  el('vh-status-badge').innerHTML = `<span class="badge badge-${statusClass(deal?.status)}">${deal?.status}</span>`;
  el('vh-actions').innerHTML = `
    <div class="vh-action-group">
      <button class="btn btn-secondary btn-sm" onclick="openPaymentModal()">💳 دفعة</button>
      <button class="btn btn-secondary btn-sm" onclick="openSaleModal()">🤝 بيع</button>
      <button class="btn btn-secondary btn-sm" onclick="openExpenseModal()">💸 مصروف</button>
      <button class="btn btn-secondary btn-sm" onclick="openCollectionModal()">💰 تحصيل</button>
      <button class="btn btn-secondary btn-sm" onclick="openPayoutModal()">👥 صرف شريك</button>
      <button class="btn btn-secondary btn-sm" onclick="openNewFileModal('${fileNo}')">✏️ تعديل</button>
    </div>
    <div class="vh-print-group">
      <button class="btn btn-secondary btn-sm" onclick="printPurchaseOrder('${fileNo}')">🖨️ سند</button>
      <button class="btn btn-secondary btn-sm" onclick="printDealStatement('${fileNo}')">🖨️ كشف</button>
      <button class="btn btn-secondary btn-sm" onclick="exportDealExcel('${fileNo}')">📊 Excel</button>
      <button class="btn btn-secondary btn-sm" onclick="exportPurchaseOrderExcel('${fileNo}')">📋 Excel PO</button>
    </div>
  `;

  // Reset tabs
  switchTab(0);
  loadViewerTab(0);
  navActive('');
  // Show quick expense FAB
  const fab = el('quickExpFab');
  if (fab && can('transactions')) fab.style.display = 'flex';
}

function switchTab(idx) {
  state.currentTab = idx;
  document.querySelectorAll('.tabs .tab').forEach((t,i) => t.classList.toggle('active', i === idx));
  document.querySelectorAll('.tab-content').forEach((c,i) => c.classList.toggle('active', i === idx));
  loadViewerTab(idx);
}

async function loadViewerTab(idx) {
  const fn = state.currentFileNo;
  const sys = state.system;
  if (!fn) return;

  if (idx === 0) await loadSummaryTab(fn, sys);
  loadViewerKpis(fn, sys);
  if (idx === 1) await loadVehiclesTab(fn, sys);
  if (idx === 2) await loadPaymentsTab(fn, sys);
  if (idx === 3) await loadExpensesTab(fn, sys);
  if (idx === 4) await loadSalesTab(fn, sys);
  if (idx === 5) await loadCollectionsTab(fn, sys);
  if (idx === 6) await loadPayoutsTab(fn, sys);
  if (idx === 7) await loadDealStatement(fn, sys);
}

async function loadSummaryTab(fn, sys) {
  try {
    const [vehicles, payments, expenses, sales, collections, partners, payouts, poArr] = await Promise.all([
      apiGet('vehicles',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('payments',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('expenses',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('sales',           { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('collections',     { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('partners_master', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('partner_payouts', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('purchase_orders', { select:'total_purchase,supplier', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
    ]);

    state.currentVehicles = vehicles || [];
    state.currentSales    = sales    || [];

    const totalPurchase  = +(poArr?.[0]?.total_purchase) || (vehicles||[]).reduce((s,v)=>s+(+v.purchase_price||0),0);

    // فصل posted من draft
    const postedPay  = (payments||[]).filter(p=>p.post_status==='posted');
    const postedExp  = (expenses||[]).filter(e=>e.post_status==='posted');
    const postedSal  = (sales||[]).filter(s=>s.post_status==='posted');
    const postedCol  = (collections||[]).filter(c=>c.post_status==='posted');
    const postedPout = (payouts||[]).filter(p=>p.post_status==='posted');
    const draftCount = (payments||[]).filter(p=>p.post_status==='draft').length +
                       (expenses||[]).filter(e=>e.post_status==='draft').length +
                       (sales||[]).filter(s=>s.post_status==='draft').length +
                       (collections||[]).filter(c=>c.post_status==='draft').length +
                       (payouts||[]).filter(p=>p.post_status==='draft').length;

    const totalPaid      = postedPay.reduce((s,p)=>s+(+p.amount||0),0);
    const totalExp       = postedExp.reduce((s,e)=>s+(+e.amount||0),0);
    const totalSales     = postedSal.reduce((s,s2)=>s+(+s2.sale_price||0),0);
    const totalCollected = postedCol.reduce((s,c)=>s+(+c.amount||0),0);
    const totalPayouts   = postedPout.reduce((s,p)=>s+(+p.amount||0),0);
    const fullCost       = totalPurchase + totalExp;
    const profit         = totalSales - fullCost;
    const remaining      = totalPurchase - totalPaid;
    const uncollected    = totalSales - totalCollected;
    const soldVins       = new Set(postedSal.map(s=>s.vin));
    const draftSoldVins  = new Set((sales||[]).filter(s=>s.post_status==='draft').map(s=>s.vin));
    const totalV         = (vehicles||[]).length;
    const soldV          = soldVins.size;
    const unsoldV        = totalV - soldV - draftSoldVins.size;
    const sellPct        = totalV > 0 ? Math.round(soldV/totalV*100) : 0;
    const margin         = totalSales > 0 ? Math.round(profit/totalSales*100) : 0;
    const draftBanner    = draftCount > 0 ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:var(--radius-sm);padding:8px 14px;margin-bottom:12px;font-size:12px;color:#92400e;display:flex;align-items:center;gap:8px">⏳ <strong>${draftCount} عملية معلقة</strong> لم تُرحَّل بعد — الأرقام تعكس المرحَّل فقط &nbsp;<a onclick="showApprovalQueue()" href="javascript:void(0)" style="color:#92400e;font-weight:700;text-decoration:underline">راجعها</a></div>` : '';

    // ── KPI Strip ──
    el('sum-financial').innerHTML = draftBanner + `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px">
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">تكلفة الشراء</div>
          <div style="font-size:20px;font-weight:700;color:var(--blue)">${fmt(totalPurchase)}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">+ ${fmt(totalExp)} مصاريف</div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px">
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">المبيعات</div>
          <div style="font-size:20px;font-weight:700;color:var(--green)">${fmt(totalSales)}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${soldV} سيارة مباعة</div>
        </div>
        <div style="background:var(--card);border:1px solid ${profit>=0?'var(--green)':'var(--red)'};border-radius:var(--radius);padding:14px 16px">
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">صافي الربح</div>
          <div style="font-size:20px;font-weight:700;color:${profit>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(profit))}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${profit>=0?'ربح':'خسارة'} · هامش ${margin}%</div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px">
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">غير محصّل</div>
          <div style="font-size:20px;font-weight:700;color:${uncollected>0?'var(--accent)':'var(--green)'}">${fmt(uncollected)}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">من العملاء</div>
        </div>
      </div>

      <!-- Two cols -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">

        <!-- المالية -->
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px">💰 المالية</div>
          ${summRow('تكلفة الشراء','text-blue',fmt(totalPurchase))}
          ${summRow('المصاريف','text-red',fmt(totalExp))}
          ${summRow('التكلفة الكاملة','',fmt(fullCost),true)}
          <hr style="border:none;border-top:1px solid var(--border);margin:6px 0">
          ${summRow('المبيعات','text-green',fmt(totalSales))}
          ${summRow('المحصّل','text-green',fmt(totalCollected))}
          ${summRow('متبقي تحصيل',uncollected>0?'text-amber':'text-green',fmt(uncollected))}
          <hr style="border:none;border-top:1px solid var(--border);margin:6px 0">
          <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px;font-weight:700">
            <span>الربح الصافي</span>
            <span style="color:${profit>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(profit))} ${profit>=0?'✓':'↓'}</span>
          </div>
        </div>

        <!-- المورد + السيارات -->
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)">🏭 المورد</div>
          ${summRow('قيمة الصفقة','',fmt(totalPurchase))}
          ${summRow('المدفوع','text-green',fmt(totalPaid))}
          ${summRow('المتبقي',remaining>0?'text-red':'text-green',fmt(remaining) + (remaining<=0?' ✓':''))}
          <hr style="border:none;border-top:1px solid var(--border);margin:10px 0">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">🚗 السيارات</div>
          ${summRow('الإجمالي','',totalV)}
          ${summRow('مباع','text-green',soldV)}
          ${summRow('في المخزن',unsoldV>0?'text-amber':'',unsoldV)}
          <div style="margin-top:8px">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-bottom:4px"><span>نسبة البيع</span><span>${sellPct}%</span></div>
            <div style="height:6px;background:var(--card2);border-radius:10px;overflow:hidden">
              <div style="width:${sellPct}%;height:100%;background:var(--green);border-radius:10px;transition:width .5s"></div>
            </div>
          </div>
        </div>
      </div>`;

    // ── Partners ──
    const partnerColors = [
      {bg:'var(--blue-dim)',   color:'var(--blue)'},
      {bg:'var(--accent-dim)',color:'var(--accent)'},
      {bg:'var(--green-dim)', color:'var(--green)'},
      {bg:'var(--purple-dim)',color:'var(--purple)'},
      {bg:'var(--cyan-dim)',  color:'var(--cyan)'},
    ];

    const partnersHtml = (partners||[]).map((p,i) => {
      const share     = +p.share_percent || 0;
      const pAmt      = profit * (share/100);
      const capitalIn = (payments||[]).filter(px=>px.payer===p.partner).reduce((s,px)=>s+(+px.amount||0),0);
      const pPayouts  = (payouts||[]).filter(px=>px.partner===p.partner);
      const totalOut  = pPayouts.reduce((s,px)=>s+(+px.amount||0),0);
      const netDue    = capitalIn + pAmt - totalOut;
      const c         = partnerColors[i % partnerColors.length];
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer"
          onclick="showPartnerDealStatement('${fn}','${p.partner}','${sys}')"
          onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background=''">
          <div style="width:36px;height:36px;border-radius:50%;background:${c.bg};color:${c.color};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">
            ${p.partner[0]}
          </div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;margin-bottom:4px">
              ${p.partner}
              <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:${c.bg};color:${c.color};margin-right:4px">${share}%</span>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--card2);color:var(--text2)">دفع: <strong style="color:var(--blue)">${fmt(capitalIn)}</strong></span>
              <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--card2);color:var(--text2)">ربح: <strong style="color:${pAmt>=0?'var(--green)':'var(--red)'}">${fmt(pAmt)}</strong></span>
              <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--card2);color:var(--text2)">سُحب: <strong style="color:var(--amber)">${fmt(totalOut)}</strong></span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <div style="text-align:left">
              <div style="font-size:15px;font-weight:700;color:${netDue>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(netDue))}</div>
              <div style="font-size:10px;color:var(--text2)">${netDue>=0?'متبقي له':'تجاوز'}</div>
            </div>
            <div style="display:flex;gap:4px">
              <button onclick="event.stopPropagation();showPartnerStatement('${p.partner}','${fn}')"
                style="background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent);border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:'Cairo',sans-serif">
                📋 هذه الصفقة
              </button>
              <button onclick="event.stopPropagation();showPartnerStatement('${p.partner}')"
                style="background:var(--purple-dim);color:var(--purple);border:1px solid var(--purple);border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:'Cairo',sans-serif">
                📊 كل الصفقات
              </button>
              <button onclick="event.stopPropagation();openPartnerAccountLedger('${p.partner}')"
                style="background:var(--blue-dim);color:var(--blue);border:1px solid var(--blue);border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:'Cairo',sans-serif">
                📒 جاري الشريك
              </button>
            </div>
          </div>
        </div>`;
    }).join('');

    el('sum-partners').innerHTML = `
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)">👥 الشركاء</div>
      ${partnersHtml || '<div style="color:var(--text2);padding:8px;font-size:13px">لا يوجد شركاء</div>'}`;

    el('sum-vehicles').innerHTML = '';
    el('sum-payments').innerHTML = '';

  } catch(e) { console.error('Summary error:', e); }
}

function summRow(label, cls, val, bold=false) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px">
    <span style="color:var(--text2)">${label}</span>
    <span class="${cls}" style="${bold?'font-weight:700':''}${cls?'':';color:var(--text)'}">${val}</span>
  </div>`;
}

async function loadVehiclesTab(fn, sys) {
  try {
    const data = await apiGet('vehicles', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` });
    state.currentVehicles = data || [];
    const soldVins = new Set((state.currentSales||[]).map(s=>s.vin));

    if (!data?.length) { el('vehiclesTable').innerHTML = emptyHTML('🚗','لا توجد سيارات'); return; }
    el('vehiclesTable').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>الكود</th><th>VIN</th><th>النوع</th><th>الموديل</th>
          <th>السنة</th><th>اللوحة</th><th>اللون</th><th>الحجم</th>
          <th>سعر الشراء</th><th>انتهاء الرخصة</th><th>الحالة</th><th></th>
        </tr></thead>
        <tbody>${data.map((v,i)=>{
          const code = `${fn}-V${String(i+1).padStart(2,'0')}`;
          const expired = v.license_expiry && new Date(v.license_expiry) < new Date();
          return `<tr>
            <td><span class="mono text-amber" style="font-size:11px">${code}</span></td>
            <td><span class="mono" style="direction:ltr;font-size:11px">${v.vin||'—'}</span></td>
            <td>${v.vehicle_type||'—'}</td>
            <td>${v.model||'—'}</td>
            <td>${v.year||'—'}</td>
            <td><span class="mono" style="direction:ltr">${v.plate||'—'}</span></td>
            <td>${v.color||'—'}</td>
            <td>${v.engine_size||'—'}</td>
            <td class="mono text-blue">${fmt(v.purchase_price)}</td>
            <td class="${expired?'text-red':'text-muted'}">${v.license_expiry||'—'}</td>
            <td><span class="badge ${soldVins.has(v.vin)?'badge-closed':'badge-open'}">${soldVins.has(v.vin)?'مباع':'في المخزن'}</span></td>
            <td><button class="btn btn-secondary btn-sm" onclick="openEditVehicleModal(${v.id})">✏️</button></td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
  } catch(e) { el('vehiclesTable').innerHTML = errHTML(e.message); }
}

async function loadPaymentsTab(fn, sys) {
  try {
    const data = await apiGet('payments', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'pay_date.desc' });
    if (!data?.length) { el('paymentsTable').innerHTML = emptyHTML('💳','لا توجد دفعات'); return; }
    const total = data.reduce((s,p)=>s+(+p.amount||0),0);
    const csvRows = data.map(p=>[p.ref_no||'—', p.payer||'—', +p.amount||0, p.pay_method||'—', p.document||'—', p.pay_date||'—', p.notes||'']);
    const csvHeaders = ['رقم الدفعة','الدافع','المبلغ','طريقة الدفع','المستند','التاريخ','ملاحظات'];
    el('paymentsTable').innerHTML = `
      ${exportBtns(
        `exportCSV(${JSON.stringify(csvHeaders)},${JSON.stringify(csvRows)},'دفعات_${fn}')`,
        `printSection('دفعات المورد','ملف: ${fn}',document.querySelector('#tab-2 table')?.outerHTML||'')`
      )}
      <table class="data-table">
        <thead><tr>
          <th>رقم الدفعة</th><th>الدافع</th><th>المبلغ</th><th>طريقة الدفع</th>
          <th>المستند</th><th>التاريخ</th><th>ملاحظات</th><th></th>
        </tr></thead>
        <tbody>
          ${data.map(p=>`<tr>
            <td class="mono" style="color:var(--cyan);font-weight:700;font-size:11px">${p.ref_no||'—'}</td>
            <td>${p.payer||'—'}</td>
            <td class="mono text-blue">${fmt(p.amount)}</td>
            <td>${p.pay_method||'—'}</td>
            <td class="mono">${p.document||'—'}</td>
            <td class="mono">${fmtDate(p.pay_date)}</td>
            <td class="text-muted">${p.notes||''}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="openEditPaymentModal(${p.id})">✏️</button></td>
          </tr>`).join('')}
          <tr style="background:var(--surface)">
            <td colspan="2"><strong>الإجمالي</strong></td>
            <td class="mono text-blue"><strong>${fmt(total)}</strong></td>
            <td colspan="4"></td>
          </tr>
        </tbody>
      </table>`;
  } catch(e) { el('paymentsTable').innerHTML = errHTML(e.message); }
}

async function loadExpensesTab(fn, sys) {
  try {
    const data = await apiGet('expenses', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'exp_date.desc' });
    if (!data?.length) { el('expensesTable').innerHTML = emptyHTML('💸','لا توجد مصاريف'); return; }
    const total = data.reduce((s,e)=>s+(+e.amount||0),0);
    const csvRows = data.map(e=>[e.ref_no||'—', e.description||'—', e.exp_type||'—', +e.amount||0, e.pay_method||'—', e.document||'—', e.exp_date||'—']);
    const csvHeaders = ['رقم المصروف','الوصف','النوع','المبلغ','طريقة الدفع','المستند','التاريخ'];
    el('expensesTable').innerHTML = `
      ${exportBtns(
        `exportCSV(${JSON.stringify(csvHeaders)},${JSON.stringify(csvRows)},'مصاريف_${fn}')`,
        `printSection('المصاريف','ملف: ${fn}',document.querySelector('#tab-3 table')?.outerHTML||'')`
      )}
      <table class="data-table">
        <thead><tr>
          <th>رقم المصروف</th><th>الوصف</th><th>النوع</th><th>المبلغ</th>
          <th>طريقة الدفع</th><th>المستند</th><th>التاريخ</th><th></th>
        </tr></thead>
        <tbody>
          ${data.map(e=>`<tr>
            <td class="mono" style="color:var(--red);font-weight:700;font-size:11px">${e.ref_no||'—'}</td>
            <td>${e.description||'—'}</td>
            <td><span class="chip">${e.exp_type||'—'}</span></td>
            <td class="mono text-red">${fmt(e.amount)}</td>
            <td>${e.pay_method||'—'}</td>
            <td class="mono">${e.document||'—'}</td>
            <td class="mono">${fmtDate(e.exp_date)}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="openEditExpenseModal(${e.id})">✏️</button></td>
          </tr>`).join('')}
          <tr style="background:var(--surface)">
            <td colspan="3"><strong>الإجمالي</strong></td>
            <td class="mono text-red"><strong>${fmt(total)}</strong></td>
            <td colspan="3"></td>
          </tr>
        </tbody>
      </table>`;
  } catch(e) { el('expensesTable').innerHTML = errHTML(e.message); }
}

async function loadSalesTab(fn, sys) {
  try {
    const data = await apiGet('sales', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'sale_date.desc' });
    state.currentSales = data || [];
    if (!data?.length) { el('salesTable').innerHTML = emptyHTML('🤝','لا توجد مبيعات'); return; }
    const total = data.reduce((s,v)=>s+(+v.sale_price||0),0);

    // Group by invoice number
    const invoices = {};
    (data||[]).forEach(s => {
      const k = s.inv_no || '__no_inv__';
      if (!invoices[k]) invoices[k] = { inv_no:s.inv_no, customer:s.customer, date:s.sale_date, fn:s.file_no, notes:s.notes, items:[] };
      invoices[k].items.push(s);
    });

    const rows = Object.values(invoices).map(inv => {
      const invTotal = inv.items.reduce((s,i)=>s+(+i.sale_price||0),0);
      const vins = inv.items.map(i=>i.vin||'—').join('، ');
      return `<tr>
        <td>
          <div class="mono text-amber" style="font-weight:700">${inv.inv_no||'—'}</div>
          <div style="font-size:11px;color:var(--text2)">${fmtDate(inv.date)}</div>
        </td>
        <td>
          <div style="font-weight:600">${inv.customer||'—'}</div>
        </td>
        <td style="font-size:12px;direction:ltr">${vins}</td>
        <td style="text-align:center">${inv.items.length}</td>
        <td class="mono text-green" style="font-weight:700">${fmt(invTotal)}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="reprintInvoice('${inv.inv_no}','${fn}')">🖨️ طباعة</button>
          <button class="btn btn-secondary btn-sm" onclick="sendWhatsappInvoice({invNo:'${inv.inv_no}',customer:'${(inv.customer||'').replace(/'/g,"\\'")}',date:'${inv.sale_date||''}',items:${JSON.stringify(inv._items||[])},total:${inv._total||0},phone:''})" style="background:rgba(37,211,102,.1);border-color:#25d366;color:#25d366">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-left:3px"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.135.558 4.14 1.535 5.878L.057 23.943l6.235-1.635A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.001-1.366l-.36-.214-3.7.971.988-3.608-.236-.372A9.818 9.818 0 0112 2.182c5.42 0 9.818 4.398 9.818 9.818 0 5.42-4.398 9.818-9.818 9.818z"/></svg>
            واتساب
          </button>
        </td>
      </tr>`;
    }).join('');

    el('salesTable').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>رقم الفاتورة</th><th>العميل</th><th>VINs</th>
          <th style="text-align:center">عدد السيارات</th><th>الإجمالي</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot style="background:var(--card2)">
          <tr><td colspan="4" style="padding:10px 16px;font-weight:700">الإجمالي الكلي</td>
          <td class="mono text-green" style="padding:10px 16px;font-weight:700">${fmt(total)}</td><td></td></tr>
        </tfoot>
      </table>`;
  } catch(e) { el('salesTable').innerHTML = errHTML(e.message); }
}

async function reprintInvoice(invNo, fn) {
  try {
    // جيب بيانات الفاتورة — من الـ cache أو fresh fetch
    await ensureCache();
    let data = state.allSales.filter(s => s.file_no === fn && s.inv_no === invNo);
    if (!data.length) {
      // fallback: fresh fetch لو مش في الـ cache
      data = await apiGet('sales', { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${fn}`, inv_no:`eq.${invNo}` });
    }
    if (!data?.length) { toast('لم يتم إيجاد بيانات الفاتورة','err'); return; }
    const s = data[0];

    // جيب بيانات السيارات من الـ cache
    const vehicles = state.allVehicles.filter(v => v.file_no === fn);

    const items = data.map(d => {
      const v = vehicles.find(v => v.vin === d.vin);
      return {
        vin:           d.vin||'',
        model:         v?.model||v?.vehicle_type||'',
        plate:         v?.plate||'',
        color:         v?.color||'',
        engine:        v?.engine_size||'',
        year:          v?.year||'',
        price:         +d.sale_price||0,
        vnote:         d.notes||'',
        purchasePrice: +v?.purchase_price||0,
      };
    });

    printSaleInvoice({
      invNo, customer: s.customer, date: s.sale_date,
      fn, notes: s.notes||'',
      items, total: items.reduce((t,i)=>t+i.price,0)
    });
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

function printSaleInvoice({ invNo, customer, date, fn, notes, items, total }) {
  const companyName = 'Transit Co.';
  const companyNameAr = 'ترانزيت';
  const companyAddress = 'Kuwait · الكويت';

  const itemsHtml = items.map((item, i) => `
    <tr>
      <td style="text-align:center">${i+1}</td>
      <td>
        <div style="font-weight:600">${item.model||'—'}</div>
        <div style="font-size:11px;color:#666">${item.color||''}${item.year?' · '+item.year:''}</div>
      </td>
      <td style="direction:ltr;text-align:center;font-family:monospace;font-size:12px">${item.vin||'—'}</td>
      <td style="direction:ltr;text-align:center;font-family:monospace">${item.plate||'—'}</td>
      <td style="text-align:center">${item.engine?item.engine+' L':'—'}</td>
      <td style="text-align:left;font-weight:600">${item.price.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>فاتورة ${invNo}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color:#1a1a1a; font-size:13px; background:#fff; }
  .page { max-width:800px; margin:0 auto; padding:32px 36px; }

  /* Header */
  .inv-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:28px; padding-bottom:20px; border-bottom:3px solid #1a1a1a; }
  .logo-area { text-align:right; }
  .logo-placeholder { width:120px; height:60px; border:2px dashed #ccc; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#aaa; font-size:11px; margin-bottom:6px; }
  .company-name { font-size:22px; font-weight:800; color:#1a1a1a; }
  .company-name-ar { font-size:14px; color:#555; margin-top:2px; }
  .inv-title-area { text-align:left; }
  .inv-title { font-size:28px; font-weight:800; color:#1a1a1a; letter-spacing:-0.5px; }
  .inv-title-ar { font-size:16px; color:#555; margin-top:4px; }
  .inv-number { font-size:16px; font-weight:700; margin-top:8px; color:#c47a00; }

  /* Info boxes */
  .inv-info { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
  .info-box { background:#f8f9fa; border-radius:8px; padding:14px 16px; }
  .info-box-title { font-size:10px; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; }
  .info-row { display:flex; justify-content:space-between; padding:3px 0; font-size:13px; }
  .info-label { color:#666; }
  .info-value { font-weight:600; color:#1a1a1a; }

  /* Table */
  table { width:100%; border-collapse:collapse; margin-bottom:20px; }
  thead tr { background:#1a1a1a; color:#fff; }
  thead th { padding:10px 12px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
  tbody tr { border-bottom:1px solid #eee; }
  tbody tr:nth-child(even) { background:#fafafa; }
  tbody td { padding:10px 12px; vertical-align:middle; }

  /* Total */
  .total-section { display:flex; justify-content:flex-end; margin-bottom:24px; }
  .total-box { background:#1a1a1a; color:#fff; border-radius:10px; padding:16px 24px; min-width:220px; }
  .total-label { font-size:12px; color:#aaa; margin-bottom:4px; }
  .total-amount { font-size:24px; font-weight:800; color:#fff; }
  .total-currency { font-size:13px; color:#aaa; margin-top:2px; }

  /* Notes */
  .notes-section { background:#f8f9fa; border-radius:8px; padding:14px 16px; margin-bottom:24px; }
  .notes-title { font-size:11px; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px; }

  /* Footer */
  .inv-footer { text-align:center; padding-top:20px; border-top:1px solid #eee; color:#999; font-size:11px; }

  /* Signature area */
  .sig-area { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-bottom:24px; }
  .sig-box { text-align:center; padding-top:40px; border-top:1px solid #ccc; }
  .sig-label { font-size:11px; color:#888; margin-top:6px; }

  @media print {
    body { print-color-adjust:exact; -webkit-print-color-adjust:exact; }
    .page { padding:20px; }
    .no-print { display:none !important; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Print button -->
  <div class="no-print" style="text-align:center;margin-bottom:20px;display:flex;gap:10px;justify-content:center">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">🖨️ طباعة / Print</button>
    <button onclick="window.close()" style="background:#f1f1f1;color:#333;border:1px solid #ddd;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer">✕ إغلاق</button>
  </div>

  <!-- Header -->
  <div class="inv-header">
    <div class="logo-area">
      <div class="logo-placeholder">LOGO</div>
      <div class="company-name">${companyName}</div>
      <div class="company-name-ar">${companyNameAr}</div>
      <div style="font-size:11px;color:#888;margin-top:4px">${companyAddress}</div>
    </div>
    <div class="inv-title-area">
      <div class="inv-title">INVOICE</div>
      <div class="inv-title-ar">فاتورة بيع</div>
      <div class="inv-number"># ${invNo}</div>
    </div>
  </div>

  <!-- Info -->
  <div class="inv-info">
    <div class="info-box">
      <div class="info-box-title">بيانات العميل / Bill To</div>
      <div class="info-row">
        <span class="info-label">العميل / Customer</span>
        <span class="info-value">${customer}</span>
      </div>
      <div class="info-row">
        <span class="info-label">رقم الملف / File No</span>
        <span class="info-value">${fn||'—'}</span>
      </div>
    </div>
    <div class="info-box">
      <div class="info-box-title">بيانات الفاتورة / Invoice Details</div>
      <div class="info-row">
        <span class="info-label">رقم الفاتورة / No</span>
        <span class="info-value" style="color:#c47a00">${invNo}</span>
      </div>
      <div class="info-row">
        <span class="info-label">التاريخ / Date</span>
        <span class="info-value">${new Date(date).toLocaleDateString('en-GB',{year:'numeric',month:'long',day:'numeric'})}</span>
      </div>
      <div class="info-row">
        <span class="info-label">عدد السيارات / Vehicles</span>
        <span class="info-value">${items.length}</span>
      </div>
    </div>
  </div>

  <!-- Items table -->
  <table>
    <thead>
      <tr>
        <th style="width:40px">#</th>
        <th>السيارة / Vehicle</th>
        <th>رقم الشاصي / VIN</th>
        <th>اللوحة / Plate</th>
        <th>الحجم / Engine</th>
        <th style="text-align:left">السعر / Price</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <!-- Total -->
  <div class="total-section">
    <div class="total-box">
      <div class="total-label">الإجمالي / Total Amount</div>
      <div class="total-amount">${total.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
      <div class="total-currency">KWD / د.ك</div>
    </div>
  </div>

  ${notes ? `<div class="notes-section"><div class="notes-title">ملاحظات / Notes</div><p style="color:#444;line-height:1.6">${notes}</p></div>` : ''}

  <!-- Signatures -->
  <div class="sig-area">
    <div class="sig-box">
      <div class="sig-label">توقيع البائع / Seller Signature</div>
    </div>
    <div class="sig-box">
      <div class="sig-label">توقيع المشتري / Buyer Signature</div>
    </div>
  </div>

  <div class="inv-footer">
    ${companyName} · ${companyAddress} · شكراً لتعاملكم معنا · Thank you for your business
  </div>
</div>
</body>
</html>`;

  openPrintOverlay(html);

  // WhatsApp option after print
  setTimeout(() => {
    if (confirm('إرسال الفاتورة عبر واتساب؟')) {
      const phone = prompt('رقم واتساب العميل (مثال: 96512345678)\nاتركه فارغاً لاختيار يدوي:','');
      if (phone !== null) sendWhatsappInvoice({ invNo, customer, date, fn, notes, items, total, phone });
    }
  }, 800);
}

async function loadCollectionsTab(fn, sys) {
  try {
    const data = await apiGet('collections', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'paid_date.desc' });
    if (!data?.length) { el('collectionsTable').innerHTML = emptyHTML('💰','لا توجد تحصيلات'); return; }
    const total = data.reduce((s,c)=>s+(+c.amount||0),0);
    const csvRows = data.map(c=>[c.ref_no||'—', c.inv_no||'—', c.customer||'—', c.vin||'—', +c.amount||0, c.pay_method||'—', c.due_date||'—', c.paid_date||'—']);
    const csvHeaders = ['رقم التحصيل','رقم الفاتورة','العميل','الشاصي','المبلغ','طريقة الدفع','تاريخ الاستحقاق','تاريخ الدفع'];
    el('collectionsTable').innerHTML = `
      ${exportBtns(
        `exportCSV(${JSON.stringify(csvHeaders)},${JSON.stringify(csvRows)},'تحصيلات_${fn}')`,
        `printSection('التحصيلات','ملف: ${fn}',document.querySelector('#tab-5 table')?.outerHTML||'')`
      )}
      <table class="data-table">
        <thead><tr>
          <th>رقم التحصيل</th><th>رقم الفاتورة</th><th>العميل</th><th>الشاصي</th>
          <th>المبلغ</th><th>طريقة الدفع</th><th>الاستحقاق</th><th>تاريخ الدفع</th><th></th>
        </tr></thead>
        <tbody>
          ${data.map(c=>`<tr>
            <td class="mono" style="color:var(--green);font-weight:700;font-size:11px">${c.ref_no||'—'}</td>
            <td class="mono">${c.inv_no||'—'}</td>
            <td>${c.customer||'—'}</td>
            <td class="mono">${c.vin||'—'}</td>
            <td class="mono text-green">${fmt(c.amount)}</td>
            <td>${c.pay_method||'—'}</td>
            <td class="mono">${fmtDate(c.due_date)}</td>
            <td class="mono">${fmtDate(c.paid_date)}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="openEditCollectionModal(${c.id})">✏️</button></td>
          </tr>`).join('')}
          <tr style="background:var(--surface)">
            <td colspan="4"><strong>الإجمالي</strong></td>
            <td class="mono text-green"><strong>${fmt(total)}</strong></td>
            <td colspan="3"></td>
          </tr>
        </tbody>
      </table>`;
  } catch(e) { el('collectionsTable').innerHTML = errHTML(e.message); }
}

async function loadPayoutsTab(fn, sys) {
  try {
    const [data, poArr] = await Promise.all([
      apiGet('partner_payouts', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'pay_date.desc' }),
      apiGet('purchase_orders', { select:'supplier', system_type:`eq.${sys}`, file_no:`eq.${fn}`, limit:1 }),
    ]);
    const supplierName = poArr?.[0]?.supplier || '—';
    if (!data?.length) { el('payoutsTable').innerHTML = emptyHTML('👥','لا توجد صرف للشركاء بعد'); return; }
    const total     = data.reduce((s,p)=>s+(+p.amount||0),0);
    const capTotal  = data.reduce((s,p)=>s+(+p.capital_amount||0),0);
    const profTotal = data.reduce((s,p)=>s+(+p.profit_amount||0),0);
    const advTotal  = data.reduce((s,p)=>s+(+p.advance_amount||0),0);

    const rows = data.map(p => {
      const hasSplit = (+p.capital_amount||0) + (+p.profit_amount||0) + (+p.advance_amount||0) > 0;
      const splitInfo = hasSplit ? `
        <div style="font-size:10px;color:var(--text2);margin-top:2px;display:flex;gap:6px">
          ${+p.capital_amount ? `<span style="color:var(--blue)">رأس مال: ${fmt(p.capital_amount)}</span>` : ''}
          ${+p.profit_amount  ? `<span style="color:${+p.profit_amount>=0?'var(--green)':'var(--red)'}">أرباح: ${fmt(p.profit_amount)}</span>` : ''}
          ${+p.advance_amount ? `<span style="color:var(--amber)">سلفة: ${fmt(p.advance_amount)}</span>` : ''}
        </div>` : '';
      return `<tr>
        <td class="mono" style="color:var(--accent);font-weight:700;font-size:11px">${p.pay_id||'—'}</td>
        <td><strong>${p.partner||'—'}</strong></td>
        <td>
          <span class="chip">${p.payout_type||'—'}</span>
          ${splitInfo}
        </td>
        <td class="mono" style="color:var(--purple);font-weight:700">${fmt(p.amount)}</td>
        <td style="font-size:11px;color:var(--text2)">${supplierName}</td>
        <td>${p.pay_method||'—'}</td>
        <td class="mono text-muted">${p.document||'—'}</td>
        <td class="mono text-muted">${fmtDate(p.pay_date)}</td>
        <td>
          <div style="display:flex;gap:4px">
            <button class="btn btn-secondary btn-sm" onclick="printPayoutVoucher(${p.id})" title="طباعة سند" style="color:var(--purple)">🖨️</button>
            <button class="btn btn-secondary btn-sm" onclick="openEditPayoutModal(${p.id})" title="تعديل">✏️</button>
            ${can('delete') ? `<button class="btn btn-secondary btn-sm" onclick="deletePayoutEntry(${p.id},'${fn}')" title="حذف" style="color:var(--red)">🗑</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');

    el('payoutsTable').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
        <div class="j-kpi"><div class="j-kpi-label">إجمالي الصرف</div><div class="j-kpi-val" style="color:var(--purple)">${fmt(total)}</div></div>
        <div class="j-kpi"><div class="j-kpi-label">رأس مال مُسترد</div><div class="j-kpi-val text-blue">${fmt(capTotal)}</div></div>
        <div class="j-kpi"><div class="j-kpi-label">أرباح موزعة</div><div class="j-kpi-val text-green">${fmt(profTotal)}</div></div>
        <div class="j-kpi"><div class="j-kpi-label">سلف</div><div class="j-kpi-val text-amber">${fmt(advTotal)}</div></div>
      </div>
      ${exportBtns(
        `exportCSV(['رقم الصرف','الشريك','نوع الصرف','المبلغ','طريقة الدفع','المستند','التاريخ'],${JSON.stringify(data.map(p=>[p.pay_id||'—',p.partner||'—',p.payout_type||'—',+p.amount||0,p.pay_method||'—',p.document||'—',p.pay_date||'—']))},'صرف_شركاء_${fn}')`,
        `printSection('صرف الشركاء','ملف: ${fn}',document.querySelector('#tab-6 table')?.outerHTML||'')`
      )}
      <table class="data-table">
        <thead><tr>
          <th>رقم الصرف</th><th>الشريك</th><th>نوع الصرف</th><th>المبلغ</th><th>دفع للمورد</th>
          <th>طريقة الدفع</th><th>المستند</th><th>التاريخ</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot style="background:var(--card2)">
          <tr><td colspan="2" style="padding:10px 16px;font-weight:700">الإجمالي</td>
          <td class="mono" style="color:var(--purple);padding:10px 16px;font-weight:700">${fmt(total)}</td>
          <td colspan="4"></td></tr>
        </tfoot>
      </table>`;
  } catch(e) { el('payoutsTable').innerHTML = errHTML(e.message); }
}

async function printPayoutVoucher(payoutId) {
  try {
    const [pArr, dealArr] = await Promise.all([
      apiGet('partner_payouts', { select:'*', id:`eq.${payoutId}` }),
      null
    ]);
    const p = pArr?.[0];
    if (!p) { toast('لم يُعثر على بيانات الصرف','err'); return; }

    const poArr = await apiGet('purchase_orders', { select:'supplier,po_date,total_purchase', system_type:`eq.${state.system}`, file_no:`eq.${p.file_no}` });
    const deal  = poArr?.[0];
    // Get full deal balance for this partner
    let dealSummary = null;
    try { dealSummary = await getPartnerDealBalance(p.file_no, p.partner, state.system); } catch(e) {}
    const fmt2 = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:2});
    const typeColor = { 'استرداد رأس مال':'#2563eb', 'توزيع أرباح':'#16a34a', 'رأس مال + أرباح':'#7c3aed', 'سلفة':'#e6930a' };
    const color = typeColor[p.payout_type] || '#1a1a1a';

    const dealBreakdown = dealSummary ? `
      <div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">ملخص الصفقة — ملف ${p.file_no}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px">
          <div><div style="font-size:10px;color:#888">رأس المال (شراء)</div><div style="font-weight:700;color:#2563eb">${fmt2(dealSummary._totalCost)} KWD</div></div>
          <div><div style="font-size:10px;color:#888">المصاريف</div><div style="font-weight:700;color:#dc2626">${fmt2(dealSummary._totalExp)} KWD</div></div>
          <div><div style="font-size:10px;color:#888">المبيعات</div><div style="font-weight:700;color:#16a34a">${fmt2(dealSummary._totalSales)} KWD</div></div>
        </div>
        <div style="border-top:1px solid #e5e7eb;padding-top:10px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          <div><div style="font-size:10px;color:#888">رأس المال المدفوع (حصتي)</div><div style="font-weight:700;color:#2563eb">${fmt2(dealSummary.capitalPaid)} KWD</div></div>
          <div><div style="font-size:10px;color:#888">الربح المستحق (حصتي)</div><div style="font-weight:700;color:${dealSummary.profit>=0?'#16a34a':'#dc2626'}">${fmt2(Math.abs(dealSummary.profit))} KWD</div></div>
          <div><div style="font-size:10px;color:#888">المسحوبات السابقة</div><div style="font-weight:700;color:#e6930a">${fmt2(dealSummary.totalWithdrawn)} KWD</div></div>
        </div>
      </div>` : '';

    const splitRows = [];
    if (+p.capital_amount) splitRows.push(`<tr><td>رأس مال مُسترد</td><td style="font-weight:700;color:#2563eb">${(+p.capital_amount).toLocaleString('en-US',{minimumFractionDigits:2})} KWD</td></tr>`);
    if (+p.profit_amount)  splitRows.push(`<tr><td>أرباح موزعة</td><td style="font-weight:700;color:#16a34a">${(+p.profit_amount).toLocaleString('en-US',{minimumFractionDigits:2})} KWD</td></tr>`);
    if (+p.advance_amount) splitRows.push(`<tr><td>سلفة</td><td style="font-weight:700;color:#e6930a">${(+p.advance_amount).toLocaleString('en-US',{minimumFractionDigits:2})} KWD</td></tr>`);

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>سند صرف ${p.pay_id||payoutId}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Cairo',Arial,sans-serif;color:#1a1a1a;background:#fff;font-size:13px}
  .page{max-width:700px;margin:0 auto;padding:32px 36px}
  .no-print{text-align:center;margin-bottom:20px;display:flex;gap:10px;justify-content:center}
  .no-print button{padding:10px 28px;border-radius:8px;font-family:'Cairo',sans-serif;font-size:14px;font-weight:700;cursor:pointer;border:none}
  /* Header */
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:18px;border-bottom:3px solid #1a1a1a}
  .company-name{font-size:22px;font-weight:900}
  .company-sub{font-size:12px;color:#888;margin-top:3px}
  .voucher-title{text-align:left}
  .voucher-title h1{font-size:26px;font-weight:900;letter-spacing:-0.5px}
  .voucher-title .pay-id{font-size:15px;font-weight:700;color:${color};margin-top:6px;letter-spacing:1px}
  /* Info grid */
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:22px}
  .info-box{background:#f8f9fa;border-radius:8px;padding:14px 16px}
  .info-box-title{font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
  .info-row{display:flex;justify-content:space-between;padding:3px 0;font-size:13px}
  .info-label{color:#666}
  .info-value{font-weight:700;color:#1a1a1a}
  /* Amount box */
  .amount-box{background:#1a1a1a;color:#fff;border-radius:10px;padding:20px 28px;text-align:center;margin-bottom:22px}
  .amount-label{font-size:12px;color:#aaa;margin-bottom:6px}
  .amount-value{font-size:32px;font-weight:900;letter-spacing:-1px}
  .amount-currency{font-size:13px;color:#aaa;margin-top:4px}
  .amount-type{display:inline-block;background:${color};color:#fff;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;margin-top:8px}
  /* Split table */
  .split-table{width:100%;border-collapse:collapse;margin-bottom:22px}
  .split-table td{padding:8px 14px;border-bottom:1px solid #eee}
  .split-table td:last-child{text-align:left}
  /* Notes */
  .notes-box{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:22px}
  .notes-label{font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
  /* Signatures */
  .sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:28px}
  .sig-box{text-align:center;padding-top:44px;border-top:1px solid #ccc}
  .sig-label{font-size:11px;color:#888;margin-top:6px}
  /* Footer */
  .footer{text-align:center;padding-top:16px;border-top:1px solid #eee;color:#bbb;font-size:10px}
  @media print{
    body{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    .page{padding:16px}
    .no-print{display:none!important}
  }
</style>
</head>
<body>
<div class="page">

  <div class="no-print">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff">🖨️ طباعة</button>
    <button onclick="window.close()" style="background:#f1f1f1;color:#333;border:1px solid #ddd">✕ إغلاق</button>
  </div>

  <div class="hdr">
    <div>
      <div class="company-name">Transit Cars</div>
      <div class="company-sub">ترانزيت للسيارات · الكويت</div>
    </div>
    <div class="voucher-title">
      <h1>سند صرف شريك</h1>
      <div class="pay-id"># ${p.pay_id||payoutId}</div>
    </div>
  </div>

  ${dealBreakdown}

  <div class="info-grid">
    <div class="info-box">
      <div class="info-box-title">بيانات الشريك</div>
      <div class="info-row"><span class="info-label">اسم الشريك</span><span class="info-value">${p.partner||'—'}</span></div>
      <div class="info-row"><span class="info-label">رقم الملف</span><span class="info-value">${p.file_no||'—'}</span></div>
      ${deal ? `<div class="info-row"><span class="info-label">المورد</span><span class="info-value">${deal.supplier||'—'}</span></div>` : ''}
    </div>
    <div class="info-box">
      <div class="info-box-title">بيانات الدفع</div>
      <div class="info-row"><span class="info-label">التاريخ</span><span class="info-value">${p.pay_date||'—'}</span></div>
      <div class="info-row"><span class="info-label">طريقة الدفع</span><span class="info-value">${p.pay_method||'—'}</span></div>
      ${p.document ? `<div class="info-row"><span class="info-label">رقم المستند</span><span class="info-value">${p.document}</span></div>` : ''}
    </div>
  </div>

  <div class="amount-box">
    <div class="amount-label">المبلغ الإجمالي</div>
    <div class="amount-value">${(+p.amount).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
    <div class="amount-currency">KWD — دينار كويتي</div>
    <div><span class="amount-type">${p.payout_type||'صرف'}</span></div>
  </div>

  ${splitRows.length > 1 ? `
  <table class="split-table">
    <tr style="background:#f8f9fa"><td colspan="2" style="padding:8px 14px;font-weight:700;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">تفاصيل التوزيع</td></tr>
    ${splitRows.join('')}
  </table>` : ''}

  ${p.notes ? `
  <div class="notes-box">
    <div class="notes-label">ملاحظات</div>
    <div>${p.notes}</div>
  </div>` : ''}

  <div class="sig-grid">
    <div class="sig-box">
      <div class="sig-label">توقيع المستلم (الشريك)</div>
      <div style="font-size:12px;color:#1a1a1a;margin-top:4px">${p.partner||''}</div>
    </div>
    <div class="sig-box">
      <div class="sig-label">توقيع المُصدِر</div>
    </div>
  </div>

  <div class="footer">
    تم إنشاؤه بتاريخ ${new Date().toLocaleDateString('en-GB')} · Transit Cars System
  </div>

</div>
</body></html>`;

    openPrintOverlay(html);

  } catch(e) { toast('خطأ في الطباعة: '+e.message,'err'); }
}

async function openEditPayoutModal(payoutId) {
  // Load payout data and reopen payout modal in edit mode
  try {
    const data = await apiGet('partner_payouts', { select:'*', id:`eq.${payoutId}` });
    const p = data?.[0];
    if (!p) return;
    // Set modal values
    const partners = await apiGet('partners_master', { select:'partner', system_type:`eq.${state.system}`, file_no:`eq.${p.file_no}` });
    el('poutModalTitle').textContent = `تعديل صرف — ${p.partner}`;
    el('pout-partner').innerHTML = (partners||[]).map(pm=>`<option value="${pm.partner}" ${pm.partner===p.partner?'selected':''}>${pm.partner}</option>`).join('');
    el('pout-type').value    = p.payout_type || 'استرداد رأس مال';
    el('pout-date').value    = p.pay_date    || today();
    el('pout-method').value  = p.pay_method  || 'تحويل بنكي';
    el('pout-doc').value     = p.document    || '';
    el('pout-notes').value   = p.notes       || '';
    el('poutError').style.display = 'none';
    onPayoutTypeChange();
    if (p.payout_type === 'رأس مال + أرباح') {
      el('pout-capital').value = p.capital_amount || '';
      el('pout-profit').value  = p.profit_amount  || '';
    } else {
      el('pout-amount').value = p.amount || '';
    }
    // Override submit to edit mode
    el('poutSubmitBtn').onclick = async () => {
      await deletePayoutEntry(payoutId, p.file_no, true);
      el('poutSubmitBtn').onclick = () => submitPayout();
      await submitPayout();
    };
    el('pout-balance-card').style.display = 'none';
    openModal('payoutModal');
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}


// ════════════════════════════════════════
// NEW FILE FORM
// ════════════════════════════════════════
// ════════════════════════════════════════
// NEW FILE MODAL — سند شراء
// ════════════════════════════════════════
let nfPriceMode = 'equal';

// Edit mode state
let _nfEditMode = false;
let _nfEditFileNo = null;


// Add vehicle row pre-filled with existing data
function addVehicleRowWithData(v) {
  addVehicleRow();
  const rows = el('vehiclesContainer').querySelectorAll('tr.v-row');
  const row  = rows[rows.length - 1];
  if (!row) return;
  row.dataset.vehicleId = v.id;
  const setVal = (name, val) => { const i = row.querySelector(`[name="${name}"]`); if(i) i.value = val||''; };
  setVal('v-type',   v.vehicle_type  || '');
  setVal('v-model',  v.model         || '');
  setVal('v-year',   v.year          || '');
  setVal('v-vin',    v.vin           || '');
  setVal('v-plate',  v.plate         || '');
  setVal('v-color',  v.color         || '');
  setVal('v-engine', v.engine_size   || '');
  setVal('v-expiry', v.license_expiry|| '');
  setVal('v-notes',  v.notes         || '');
  const priceInp = row.querySelector('[name="v-price"]');
  if (priceInp) { priceInp.value = v.purchase_price || ''; priceInp.readOnly = false; priceInp.style.opacity = '1'; priceInp.style.cursor = ''; }
}

// Add partner row pre-filled with existing data
async function addPartnerRowWithData(partner, payment) {
  await addPartnerRow();
  const rows = el('partnersContainer').querySelectorAll('.p-row');
  const row  = rows[rows.length - 1];
  if (!row) return;
  row.dataset.partnerId = partner.id;

  const inputs = row.querySelectorAll('input');
  const sels   = row.querySelectorAll('select');

  // Partner name — set in select, add option if missing
  if (sels[0]) {
    const partnerName = partner.partner || '';
    let opt = Array.from(sels[0].options).find(o => o.value === partnerName);
    if (!opt && partnerName) {
      opt = document.createElement('option');
      opt.value = partnerName; opt.textContent = partnerName;
      sels[0].insertBefore(opt, sels[0].lastElementChild);
    }
    sels[0].value = partnerName;
  }

  // Share percent
  if (inputs[0]) inputs[0].value = partner.share_percent || '';

  // Payment data
  if (payment) {
    if (inputs[1]) inputs[1].value = payment.amount     || '';
    if (inputs[2]) inputs[2].value = payment.pay_date   || '';
    if (sels[1])   sels[1].value   = payment.pay_method || 'تحويل بنكي';
    if (inputs[3]) inputs[3].value = payment.document   || '';
  }

  updatePartnerSummary();
}

async function openNewFileModal(editFileNo = null) {
  // ── set mode FIRST ──
  _nfEditMode   = !!editFileNo;
  _nfEditFileNo = editFileNo || null;

  // Generate file no only for NEW mode
  if (!_nfEditMode) {
    try {
      const data = await apiGet('purchase_orders', { select:'file_no', system_type:`eq.${state.system}`, order:'created_at.desc', limit:100 });
      let nextNum = 1;
      if (data && data.length) {
        const nums = data.map(d => parseInt((d.file_no||'').split('-')[1]) || 0);
        nextNum = Math.max(...nums) + 1;
      }
      el('nf-fileNo').value = `${state.system}-${String(nextNum).padStart(3,'0')}`;
    } catch(e) { el('nf-fileNo').value = `${state.system}-001`; }
  }

  // UI labels
  if (el('nfModalIcon'))  el('nfModalIcon').textContent   = _nfEditMode ? '✏️' : '📋';
  if (el('nfModalTitle')) el('nfModalTitle').innerHTML    = _nfEditMode
    ? `تعديل سند الشراء — <span id="nfSystemLabel">${state.system}</span> — <span style="color:var(--accent)">${editFileNo}</span>`
    : `سند شراء جديد — <span id="nfSystemLabel">${state.system}</span>`;
  if (el('nfSubmitBtn'))  el('nfSubmitBtn').textContent   = _nfEditMode ? '💾 حفظ التعديلات' : '💾 حفظ السند';
  if (el('nfDeleteBtn'))  el('nfDeleteBtn').style.display = _nfEditMode ? 'inline-flex' : 'none';

  el('nfError').style.display = 'none';
  el('vehiclesContainer').innerHTML = '';
  el('partnersContainer').innerHTML = '';
  el('partnerSummary').style.display = 'none';

  // Lock file no in edit mode
  if (_nfEditMode) {
    el('nf-fileNo').setAttribute('readonly', true);
    el('nf-fileNo').style.opacity = '0.6';
    el('nf-fileNo').style.cursor  = 'not-allowed';
  } else {
    el('nf-fileNo').removeAttribute('readonly');
    el('nf-fileNo').style.opacity = '1';
    el('nf-fileNo').style.cursor  = '';
  }

  await populatePartnersSelect();

  if (_nfEditMode && editFileNo) {
    // ── EDIT: load existing deal ──
    nfPriceMode = 'manual';
    document.querySelectorAll('[id^="pm-"]').forEach(b => b.classList.remove('active'));
    el('pm-manual')?.classList.add('active');
    el('nf-vehicles-label').style.display = '';
    el('nf-price-mode-wrap').style.display = '';
    // Show loading
    el('vehiclesContainer').innerHTML = '<div style="padding:12px;color:var(--text2);font-size:13px">⏳ جاري تحميل البيانات...</div>';
    el('partnersContainer').innerHTML = '<div style="padding:12px;color:var(--text2);font-size:13px">⏳ جاري التحميل...</div>';

    try {
      const [deals, vList, pList, payList] = await Promise.all([
        apiGet('purchase_orders', { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${editFileNo}` }),
        apiGet('vehicles',        { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${editFileNo}` }),
        apiGet('partners_master', { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${editFileNo}` }),
        apiGet('payments',        { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${editFileNo}` }),
      ]);

      const d = deals?.[0] || {};
      el('nf-fileNo').value       = d.file_no       || editFileNo;
      el('nf-poDate').value       = d.po_date        || '';
      el('nf-notes').value        = d.notes          || '';
      el('nf-poNo').value         = d.po_no          || '';
      el('nf-totalAmount').value  = d.total_purchase || '';
      el('nf-vehicleCount').value = d.vehicle_count  || '';
      

      // Set supplier — ac-input (text), just set value directly
      el('nf-supplier').value = d.supplier || '';
      // pre-cache supplier contacts silently
      acGetContacts('supplier').catch(()=>{});

      // Load vehicles
      el('vehiclesContainer').innerHTML = '';
      if (vList?.length) {
        vList.forEach(v => addVehicleRowWithData(v));
      } else {
        addVehicleRow();
      }

      // Load partners
      el('partnersContainer').innerHTML = '';
      if (pList?.length) {
        for (const p of pList) {
          const pay = (payList||[]).find(pm => pm.payer === p.partner);
          await addPartnerRowWithData(p, pay);
        }
      } else {
        await addPartnerRow();
      }

      // Update price mode UI
      setPriceMode('manual');
      updateEqualPriceInfo();

    } catch(e) {
      console.error('Edit load error:', e);
      el('vehiclesContainer').innerHTML = '';
      el('partnersContainer').innerHTML = '';
      addVehicleRow();
      await addPartnerRow();
      showFieldErr('nfError', 'خطأ في تحميل بيانات الصفقة: ' + e.message);
    }
  } else {
    // ── NEW ──
    nfPriceMode = 'equal';
    document.querySelectorAll('[id^="pm-"]').forEach(b => b.classList.remove('active'));
    el('pm-equal')?.classList.add('active');
    el('nf-vehicles-label').style.display = 'none';
    el('nf-price-mode-wrap').style.display = 'none';
    el('nf-poDate').value       = today();
    el('nf-notes').value        = '';
    
    el('nf-poNo').value         = '';
    el('nf-totalAmount').value  = '';
    el('nf-vehicleCount').value = '';
    await addPartnerRow();
  }

  openModal('newFileModal');
}

async function populatePartnersSelect() {
  // Pre-cache partners for autocomplete in partner rows
  await getContactsByType('partner');
}

function onVehicleCountChange(val) {
  const n = parseInt(val) || 0;
  if (n < 1 || n > 100) return;
  el('nf-vehicles-label').style.display = '';
  el('nf-price-mode-wrap').style.display = '';
  buildVehicleRows(n);
  updateEqualPriceInfo();
}

function onTotalAmountChange() {
  updateEqualPriceInfo();
  if (nfPriceMode === 'equal') applyEqualPrices();
  checkPriceTotal();
}

function setPriceMode(mode) {
  nfPriceMode = mode;
  document.querySelectorAll('[id^="pm-"]').forEach(b => b.classList.remove('active'));
  el('pm-' + mode)?.classList.add('active');
  el('vehiclesContainer').querySelectorAll('[name="v-price"]').forEach(inp => {
    inp.readOnly = (mode === 'equal');
    inp.style.opacity = mode === 'equal' ? '.6' : '1';
    inp.style.cursor  = mode === 'equal' ? 'not-allowed' : '';
  });
  if (mode === 'equal') applyEqualPrices();
  updateEqualPriceInfo();
}

function buildVehicleRows(n) {
  const container = el('vehiclesContainer');
  const existing = container.querySelectorAll('tr.v-row').length;
  for (let i = existing; i < n; i++) addVehicleRow();
  const rows = container.querySelectorAll('tr.v-row');
  for (let i = rows.length - 1; i >= n; i--) rows[i].remove();
  renumberVehicles();
  setPriceMode(nfPriceMode);
}

function applyEqualPrices() {
  const total = parseFloat(el('nf-totalAmount').value) || 0;
  const rows = el('vehiclesContainer').querySelectorAll('[name="v-price"]');
  if (!rows.length) return;
  const each = total / rows.length;
  rows.forEach(inp => { inp.value = each.toFixed(2); });
  checkPriceTotal();
}

function checkPriceTotal() {
  const total = parseFloat(el('nf-totalAmount').value) || 0;
  const chk = el('pm-total-check');
  if (!chk) return;
  if (!total) { chk.style.display='none'; return; }
  let sum = 0;
  el('vehiclesContainer').querySelectorAll('[name="v-price"]').forEach(inp => { sum += parseFloat(inp.value)||0; });
  const diff = Math.abs(sum - total);
  chk.style.display = '';
  if (diff < 0.01) {
    chk.innerHTML = `<span style="color:var(--green)">✓ مجموع الأسعار = ${fmt(sum)} — متطابق مع إجمالي الصفقة</span>`;
  } else {
    chk.innerHTML = `<span style="color:var(--red)">⚠ مجموع الأسعار = ${fmt(sum)} — الفرق: ${fmt(diff)}</span>`;
  }
}

function updateEqualPriceInfo() {
  const total = parseFloat(el('nf-totalAmount').value) || 0;
  const n = el('vehiclesContainer').querySelectorAll('[name="v-price"]').length;
  const info = el('pm-equal-info');
  if (!info) return;
  if (!n || !total) { info.textContent = ''; return; }
  info.innerHTML = `سعر كل سيارة = <strong style="color:var(--accent)">${fmt(total/n)}</strong>`;
}

function addVehicleRow() {
  const container = el('vehiclesContainer');
  // Ensure table exists
  let tbody = container.querySelector('tbody');
  if (!tbody) {
    container.innerHTML = `
      <table class="vt-table">
        <thead><tr>
          <th class="vt-num">#</th>
          <th style="min-width:90px">النوع</th>
          <th style="min-width:120px">الموديل</th>
          <th style="min-width:50px">السنة</th>
          <th style="min-width:130px">VIN</th>
          <th style="min-width:80px">اللوحة</th>
          <th style="min-width:70px">اللون</th>
          <th style="min-width:60px">الحجم</th>
          <th style="min-width:90px">السعر</th>
          <th style="min-width:95px">انتهاء الرخصة</th>
          <th style="min-width:80px">ملاحظات</th>
          <th style="width:56px"></th>
        </tr></thead>
        <tbody></tbody>
      </table>
      <div id="pm-total-check" style="font-size:12px;margin-top:6px"></div>`;
    tbody = container.querySelector('tbody');
  }

  const num = tbody.querySelectorAll('tr').length + 1;
  const isEqual = nfPriceMode === 'equal';
  const tr = document.createElement('tr');
  tr.className = 'v-row';
  tr.innerHTML = `
    <td class="vt-num">${num}</td>
    <td><input class="vt-inp" type="text" name="v-type" placeholder="Pickup"></td>
    <td><input class="vt-inp" type="text" name="v-model" placeholder="Hilux 2024"></td>
    <td><input class="vt-inp" type="number" name="v-year" placeholder="2024" min="1990" max="2030" style="width:60px"></td>
    <td><input class="vt-inp" type="text" name="v-vin" placeholder="VIN" style="direction:ltr;letter-spacing:.5px" onblur="onVinBlur(this,'')"></td>
    <td><input class="vt-inp" type="text" name="v-plate" placeholder="ABC-123" style="direction:ltr"></td>
    <td><input class="vt-inp" type="text" name="v-color" placeholder="أبيض"></td>
    <td><input class="vt-inp" type="text" name="v-engine" placeholder="1.5" style="width:55px"></td>
    <td><input class="vt-inp" type="number" name="v-price" placeholder="0.00" min="0" step="0.01"
      ${isEqual ? 'readonly style="opacity:.6;cursor:not-allowed"' : ''}
      oninput="checkPriceTotal()"></td>
    <td><input class="vt-inp" type="date" name="v-expiry" style="width:110px"></td>
    <td><input class="vt-inp" type="text" name="v-notes" placeholder="..."></td>
    <td>
      <button class="btn-remove" onclick="uploadLicenseForRow(this.closest('tr'))" title="رفع رخصة" style="color:var(--blue);margin-left:2px">📷</button>
      <button class="btn-remove" onclick="this.closest('tr').remove();renumberVehicles();checkPriceTotal()" title="حذف">✕</button>
    </td>
  `;
  // Copy button
  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn-remove';
  copyBtn.title = 'نسخ الصف';
  copyBtn.textContent = '⧉';
  copyBtn.style.cssText = 'color:var(--text2);margin-left:2px';
  copyBtn.onclick = () => copyVehicleRow(tr);
  tr.querySelector('td:last-child').appendChild(copyBtn);

  tbody.appendChild(tr);
}

function copyVehicleRow(sourceTr) {
  const container = el('vehiclesContainer');
  const tbody = container.querySelector('tbody');
  const newTr = sourceTr.cloneNode(true);
  // Clear VIN and plate (unique per car)
  const vinInp = newTr.querySelector('[name="v-vin"]');
  const plateInp = newTr.querySelector('[name="v-plate"]');
  if (vinInp) vinInp.value = '';
  if (plateInp) plateInp.value = '';
  // Re-attach event handlers
  newTr.querySelector('.btn-remove').onclick = function() {
    this.closest('tr').remove(); renumberVehicles(); checkPriceTotal();
  };
  const btns = newTr.querySelectorAll('.btn-remove');
  if (btns[1]) btns[1].onclick = () => copyVehicleRow(newTr);
  tbody.appendChild(newTr);
  renumberVehicles();
  checkPriceTotal();
}

function renumberVehicles() {
  const rows = el('vehiclesContainer').querySelectorAll('tr.v-row');
  rows.forEach((r, i) => {
    const numCell = r.querySelector('.vt-num');
    if (numCell) numCell.textContent = i + 1;
  });
  updateEqualPriceInfo();
  if (nfPriceMode === 'equal') applyEqualPrices();
}

async function addPartnerRow() {
  const partners = await getContactsByType('partner');
  const inp = (placeholder, type='text', extra='') =>
    `<input type="${type}" placeholder="${placeholder}" ${extra}
      style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px;width:100%">`;
  const div = document.createElement('div');
  div.className = 'dyn-row p-row';
  div.style.cssText = 'grid-template-columns:1.8fr 0.7fr 0.8fr 0.7fr 0.9fr 0.8fr 32px;gap:6px;align-items:center;padding:8px 4px;border-bottom:1px solid var(--border)';
  const opts = partners.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
  div.innerHTML = `
    <select style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px;width:100%">
      <option value="">-- اختر --</option>${opts}
      <option value="__new__">+ جديد...</option>
    </select>
    ${inp('الحصة %','number','min="0" max="100" step="0.01" oninput="updatePartnerSummary()"')}
    ${inp('المبلغ','number','min="0" step="0.01" oninput="updatePartnerSummary()"')}
    <input type="date" style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px;width:100%" value="${today()}">
    <select style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px;width:100%">
      <option value="تحويل بنكي">تحويل بنكي</option>
      <option value="نقد">نقد</option>
      <option value="شيك">شيك</option>
      <option value="SWIFT">SWIFT</option>
    </select>
    ${inp('رقم المستند')}
    <button class="btn-remove" onclick="this.parentElement.remove();updatePartnerSummary()" title="حذف">✕</button>
  `;
  const sel = div.querySelector('select');
  sel.onchange = function() {
    if (this.value === '__new__') {
      const name = prompt('اسم الشريك الجديد:');
      if (name) {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        this.insertBefore(opt, this.lastElementChild);
        this.value = name;
      } else { this.value = ''; }
    }
    updatePartnerSummary();
  };
  el('partnersContainer').appendChild(div);
}

function updatePartnerSummary() {
  const total = parseFloat(el('nf-totalAmount').value) || 0;
  const rows  = el('partnersContainer').querySelectorAll('.p-row');
  let shareSum = 0, paidSum = 0, valid = true;
  const lines = [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const sel    = row.querySelector('select');
    const name   = sel?.value || '';
    const share  = parseFloat(inputs[0].value) || 0;
    const paid   = parseFloat(inputs[1].value) || 0;
    if (name && share) {
      const due       = total * share / 100;
      const remaining = due - paid;
      shareSum += share;
      paidSum  += paid;
      lines.push(`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="font-weight:600">${name}</span>
        <span style="font-size:11px;color:var(--text2)">حصة: ${share}% = <span style="color:var(--accent)">${fmt(due)}</span> | دفع: <span style="color:var(--green)">${fmt(paid)}</span> | متبقي: <span style="color:${remaining>0?'var(--red)':'var(--green)'}">${fmt(remaining)}</span></span>
      </div>`);
    }
    if (name && share) valid = true;
  });
  el('partnerShareWarning').style.display = (shareSum > 0 && Math.abs(shareSum-100) > 0.01) ? 'block' : 'none';
  const summary = el('partnerSummary');
  if (lines.length) {
    summary.style.display = '';
    summary.innerHTML = lines.join('') +
      `<div style="display:flex;justify-content:space-between;margin-top:6px;font-weight:700">
        <span>الإجمالي</span>
        <span style="font-size:11px">الحصص: ${fmt(shareSum)}% | مدفوع: <span style="color:var(--green)">${fmt(paidSum)}</span> | متبقي: <span style="color:var(--red)">${fmt(total-paidSum)}</span></span>
      </div>`;
  } else { summary.style.display = 'none'; }
}

function checkShareTotal() {
  updatePartnerSummary();
}

async function submitNewFile() {
  // Route to edit if in edit mode
  if (_nfEditMode) { await submitEditFileFull(); return; }

  const fileNo      = el('nf-fileNo').value.trim();
  const supplier    = el('nf-supplier')?.value?.trim() || '';
  const poNo        = el('nf-poNo').value.trim();
  const poDate      = el('nf-poDate').value;
  const notes       = el('nf-notes').value.trim();
  const totalAmount = parseFloat(el('nf-totalAmount').value) || 0;

  if (!fileNo)      { showFieldErr('nfError','يرجى إدخال رقم الملف'); return; }
  if (!supplier)    { showFieldErr('nfError','يرجى اختيار المورد'); return; }
  if (!poDate)      { showFieldErr('nfError','يرجى إدخال التاريخ'); return; }
  if (!totalAmount) { showFieldErr('nfError','يرجى إدخال قيمة الصفقة'); return; }

  // Collect vehicles from table rows
  const vRows = el('vehiclesContainer').querySelectorAll('tr.v-row');
  const vehicles = [];
  let totalPurchase = 0;
  vRows.forEach(row => {
    const type   = row.querySelector('[name="v-type"]')?.value.trim()   || '';
    const model  = row.querySelector('[name="v-model"]')?.value.trim()  || '';
    const year   = parseInt(row.querySelector('[name="v-year"]')?.value) || null;
    const vin    = row.querySelector('[name="v-vin"]')?.value.trim()    || '';
    const plate  = row.querySelector('[name="v-plate"]')?.value.trim()  || '';
    const color  = row.querySelector('[name="v-color"]')?.value.trim()  || '';
    const engine = row.querySelector('[name="v-engine"]')?.value.trim() || '';
    const expiry = row.querySelector('[name="v-expiry"]')?.value        || '';
    const price  = parseFloat(row.querySelector('[name="v-price"]')?.value) || 0;
    const vnotes = row.querySelector('[name="v-notes"]')?.value.trim()  || '';
    vehicles.push({ type, model, year, vin, plate, color, engine, expiry, price, notes:vnotes });
    totalPurchase += price;
  });

  // Use totalAmount as the authoritative total
  const finalTotal = totalAmount || totalPurchase;

  // Collect partners
  const pRows = el('partnersContainer').querySelectorAll('.p-row');
  const partners = [];
  let shareTotal = 0;
  pRows.forEach(row => {
    const inputs  = row.querySelectorAll('input');
    const sels    = row.querySelectorAll('select');
    const name    = sels[0]?.value || '';
    const share   = parseFloat(inputs[0].value) || 0;
    const paid    = parseFloat(inputs[1].value) || 0;
    const payDate = inputs[2]?.value || poDate || '';
    const method  = sels[1]?.value || 'تحويل بنكي';
    const doc     = inputs[3]?.value.trim() || '';
    if (name && share) { partners.push({ name, share, paid, payDate, method, doc }); shareTotal += share; }
  });

  if (partners.length && Math.abs(shareTotal-100) > 0.01) {
    showFieldErr('nfError',`مجموع حصص الشركاء = ${shareTotal}% يجب أن يساوي 100%`); return;
  }

  const btn = el('nfSubmitBtn');
  btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...';

  try {
    // 1. Insert PO
    const poData = {
      system_type:    state.system,
      file_no:        fileNo,
      supplier,
      po_no:          poNo || null,
      po_date:        poDate || null,
      total_purchase: finalTotal,
      vehicle_count:  vehicles.length,
      status:         'OPEN',
      post_status:    entryStatus(),
      notes:          notes || null
    };
    await apiPost('purchase_orders', poData);

    // 2. Ledger entry for supplier — امسح القديم وأضف جديد
    if (finalTotal > 0) {
      const vinList = vehicles.filter(v=>v.vin).map(v=>v.vin).join(' / ');
      if (entryStatus()==='posted') await je_purchase({sys:state.system,date:poDate||today(),amount:finalTotal,fileNo,supplier});
    }

    // 3. Insert vehicles
    for (const v of vehicles) {
      await apiPost('vehicles', {
        system_type: state.system, file_no: fileNo, po_no: poNo||null,
        vin: v.vin||null, vehicle_type: v.type||v.model||null,
        model: v.model||v.type||null, plate: v.plate||null,
        color: v.color||null, engine_size: v.engine||null,
        year: v.year||null, license_expiry: v.expiry||null,
        purchase_price: v.price||0,
        purchase_date: poDate||null, notes: v.notes||null
      });
    }

    // 4. Insert partners + their payments
    for (const p of partners) {
      await apiPost('partners_master', {
        system_type: state.system, file_no: fileNo,
        partner: p.name, share_percent: p.share
      });
      // If partner paid something, record as payment
      if (p.paid > 0) {
        const pmtId = `PMT-${fileNo}-P${partners.indexOf(p)+1}`;
        await apiPost('payments', {
          system_type: state.system, file_no: fileNo,
          pay_id: pmtId, ref_no: pmtId,
          po_no: poNo||null, payer: p.name,
          amount: p.paid, pay_method: p.method||'تحويل بنكي',
          document: p.doc||null, pay_date: p.payDate||poDate||null,
          notes: `حصة ${p.share}% — دفع مقدماً`
        });
        // Ledger: partner paid (credit partner account)
        if (entryStatus()==='posted') await je_payment({sys:state.system,date:poDate||today(),amount:p.paid,fileNo,supplierName:supplier,payerName:p.name,method:p.method||'تحويل بنكي'});
      }
    }

    // 5. Audit
    await logAudit('INSERT','purchase_orders', fileNo, null, poData);
    closeModal('newFileModal');
    toast(`✅ تم إنشاء الملف ${fileNo} — ${vehicles.length} سيارة`, 'ok');
    invalidateCache();
    await loadDashboard();
    showDashboard();

    // ✅ طباعة سند الشراء تلقائياً
    // طباعة اختيارية من داخل الملف

  } catch(e) {
    showFieldErr('nfError','خطأ: ' + e.message);
    console.error(e);
  }
  btn.disabled = false; btn.textContent = '💾 حفظ السند';
}

// ════════════════════════════════════════
// SUBMIT EDIT (full sند update)
// ════════════════════════════════════════
async function submitEditFileFull() {
  const oldFileNo   = _nfEditFileNo;
  const newFileNo   = el('nf-fileNo').value.trim();
  const supplier    = el('nf-supplier')?.value?.trim() || '';
  const poNo        = el('nf-poNo').value.trim();
  const poDate      = el('nf-poDate').value;
  const notes       = el('nf-notes').value.trim();
  const totalAmount = parseFloat(el('nf-totalAmount').value) || 0;

  if (!supplier)    { showFieldErr('nfError','يرجى اختيار المورد'); return; }
  if (!totalAmount) { showFieldErr('nfError','يرجى إدخال قيمة الصفقة'); return; }

  // Collect vehicles from table rows
  const vRows2 = el('vehiclesContainer').querySelectorAll('tr.v-row');
  const vehicles = [];
  let totalPurchase = 0;
  vRows2.forEach(row => {
    const type   = row.querySelector('[name="v-type"]')?.value.trim()   || '';
    const model  = row.querySelector('[name="v-model"]')?.value.trim()  || '';
    const year   = parseInt(row.querySelector('[name="v-year"]')?.value) || null;
    const vin    = row.querySelector('[name="v-vin"]')?.value.trim()    || '';
    const plate  = row.querySelector('[name="v-plate"]')?.value.trim()  || '';
    const color  = row.querySelector('[name="v-color"]')?.value.trim()  || '';
    const engine = row.querySelector('[name="v-engine"]')?.value.trim() || '';
    const expiry = row.querySelector('[name="v-expiry"]')?.value        || '';
    const price  = parseFloat(row.querySelector('[name="v-price"]')?.value) || 0;
    const vnotes = row.querySelector('[name="v-notes"]')?.value.trim()  || '';
    const vid    = row.dataset.vehicleId || null;
    vehicles.push({ vid, type, model, year, vin, plate, color, engine, expiry, price, notes:vnotes });
    totalPurchase += price;
  });

  // Collect partners
  const pRows = el('partnersContainer').querySelectorAll('.p-row');
  const partners = [];
  let shareTotal = 0;
  pRows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const sels   = row.querySelectorAll('select');
    const name   = sels[0]?.value || '';
    const share  = parseFloat(inputs[0].value) || 0;
    const paid   = parseFloat(inputs[1].value) || 0;
    const payDate= inputs[2]?.value || poDate || '';
    const method = sels[1]?.value || 'تحويل بنكي';
    const doc    = inputs[3]?.value.trim() || '';
    const pid    = row.dataset.partnerId || null;
    if (name) { partners.push({ pid, name, share, paid, payDate, method, doc }); shareTotal += share; }
  });

  if (partners.length && Math.abs(shareTotal-100) > 0.01) {
    showFieldErr('nfError',`مجموع حصص الشركاء = ${shareTotal}% يجب أن يساوي 100%`); return;
  }

  const finalTotal = totalAmount || totalPurchase;
  const btn = el('nfSubmitBtn');
  btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...';

  try {
    // 1. Update PO
    await apiPatch('purchase_orders',
      { system_type:`eq.${state.system}`, file_no:`eq.${oldFileNo}` },
      { file_no:newFileNo, supplier, po_no:poNo||null, po_date:poDate||null,
        total_purchase:finalTotal, vehicle_count:vehicles.length,
        notes:notes||null }
    );

    // 2. Update vehicles — update existing, insert new
    for (const v of vehicles) {
      if (v.vid) {
        await apiPatch('vehicles', { id:`eq.${v.vid}` }, {
          vehicle_type:v.type||v.model||null, model:v.model||v.type||null,
          vin:v.vin||null, plate:v.plate||null, color:v.color||null,
          engine_size:v.engine||null, year:v.year||null,
          license_expiry:v.expiry||null,
          purchase_price:v.price||0, notes:v.notes||null,
          file_no: newFileNo
        });
      } else {
        await apiPost('vehicles', {
          system_type:state.system, file_no:newFileNo,
          po_no:poNo||null, vin:v.vin||null,
          vehicle_type:v.type||v.model||null, model:v.model||v.type||null,
          plate:v.plate||null, color:v.color||null,
          purchase_price:v.price||0, purchase_date:poDate||null, notes:v.notes||null
        });
      }
    }

    // 3. Update partners — delete all then re-insert (simplest approach)
    await apiDelete('partners_master', { system_type:`eq.${state.system}`, file_no:`eq.${oldFileNo}` });
    for (const p of partners) {
      await apiPost('partners_master', {
        system_type:state.system, file_no:newFileNo,
        partner:p.name, share_percent:p.share
      });
      // Update existing payment or create new one
      if (p.paid > 0) {
        // Try to delete old payment for this partner then reinsert
        try { await apiDelete('payments', { system_type:`eq.${state.system}`, file_no:`eq.${oldFileNo}`, payer:`eq.${p.name}` }); } catch(e) {}
        await apiPost('payments', {
          system_type:state.system, file_no:newFileNo,
          pay_id:`PMT-${newFileNo}-P${p.name.slice(0,3)}`, ref_no:`PMT-${newFileNo}-P${p.name.slice(0,3)}`,
          po_no:poNo||null, payer:p.name,
          amount:p.paid, pay_method:p.method||'تحويل بنكي',
          document:p.doc||null, pay_date:p.payDate||poDate||null,
          notes:`حصة ${p.share}%`
        });
      }
    }

    // 4. Update ledger entry for supplier if total changed
    await logAudit('UPDATE','purchase_orders',oldFileNo,null,{newFileNo,supplier,finalTotal});

    closeModal('newFileModal');
    toast(`✅ تم تعديل الصفقة ${newFileNo}`,'ok');
    await loadDashboard();
    if (state.currentFileNo === oldFileNo || state.currentFileNo === newFileNo) {
      state.currentFileNo = newFileNo;
      openViewer(newFileNo);
    } else {
      showDashboard();
    }
  } catch(e) {
    showFieldErr('nfError','خطأ: '+e.message);
    console.error(e);
  }
  btn.disabled = false; btn.textContent = '💾 حفظ التعديلات';
}



// ════════════════════════════════════════
// OPERATIONS
// ════════════════════════════════════════

async function openPaymentModal() {
  const fn  = state.currentFileNo;
  const sys = state.system;

  el('payError').style.display = 'none';
  el('pay-amount').value = '';
  el('pay-date').value   = today();
  el('pay-doc').value    = '';
  el('pay-notes').value  = '';

  try {
    // جيب بيانات الصفقة والدفعات السابقة بالتوازي
    const [po, prevPayments, partners] = await Promise.all([
      apiGet('purchase_orders', { select:'file_no,supplier,total_purchase', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('payments',        { select:'amount', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('partners_master', { select:'partner', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
    ]);

    const poData    = po?.[0] || {};
    const totalPO   = +poData.total_purchase || 0;
    const totalPaid = (prevPayments||[]).reduce((s,p)=>s+(+p.amount||0), 0);
    const remaining = Math.max(totalPO - totalPaid, 0);

    // بطاقة أمر الشراء
    if(el('pay-card-supplier'))  el('pay-card-supplier').textContent  = poData.supplier || '—';
    if(el('pay-card-file'))      el('pay-card-file').textContent      = fn || '—';
    if(el('pay-card-total'))     el('pay-card-total').textContent     = fmt(totalPO);
    if(el('pay-card-paid'))      el('pay-card-paid').textContent      = fmt(totalPaid);
    if(el('pay-card-remaining')) {
      el('pay-card-remaining').textContent = fmt(remaining);
      el('pay-card-remaining').style.color = remaining > 0 ? 'var(--accent)' : 'var(--green)';
    }

    // اقتراح المبلغ = الباقي
    el('pay-amount').value = remaining > 0 ? remaining.toFixed(3) : '';

    // الدافع — الشركاء أو المورد
    let payerOptions = '';
    if (partners?.length) {
      payerOptions = partners.map(p=>`<option value="${p.partner}">${p.partner}</option>`).join('');
    } else {
      // fallback — جيب من contacts
      const allPartners = await getContactsByType('partner');
      payerOptions = (allPartners||[]).map(p=>`<option value="${p.name}">${p.name}</option>`).join('');
    }
    // أضف المورد كخيار كمان
    if (poData.supplier) {
      payerOptions = `<option value="${poData.supplier}">${poData.supplier} (المورد)</option>` + payerOptions;
    }
    el('pay-payer').innerHTML = '<option value="">— اختر الدافع —</option>' + payerOptions;

  } catch(e) {
    console.error('openPaymentModal:', e.message);
  }

  openModal('paymentModal');
}

// ════════════════════════════════════════
// EXPENSE MODAL — multi-row
// ════════════════════════════════════════
function openExpenseModal() {
  const fn = state.currentFileNo;
  el('exp-date').value   = today();
  el('exp-method').value = 'تحويل بنكي';
  el('exp-doc').value    = '';
  el('expError').style.display = 'none';
  el('expenseRowsContainer').innerHTML = '';
  addExpenseRow({ fileNo: fn });
  openModal('expenseModal');
}

function addExpenseRow(prefill={}) {
  const tbody = el('expenseRowsContainer');
  if (!tbody) return;
  const fn = prefill.fileNo || state.currentFileNo || '';
  const dealOpts = (state.allDeals||[]).map(d =>
    `<option value="${d.file_no}" ${d.file_no===fn?'selected':''}>${d.file_no} — ${d.supplier||''}</option>`
  ).join('');
  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid var(--border)';
  const s = 'width:100%;background:var(--card);border:1px solid var(--border);border-radius:4px;padding:5px 7px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px';
  tr.innerHTML = `
    <td style="padding:4px 3px">
      <select name="er-file" style="${s}">
        <option value="">-- اختر --</option>${dealOpts}
      </select>
    </td>
    <td style="padding:4px 3px"><input type="text" name="er-desc" placeholder="الوصف *" style="${s}"></td>
    <td style="padding:4px 3px">
      <select name="er-type" style="${s}">
        <option>شحن</option><option>جمارك</option><option>تأمين</option>
        <option>إدارية</option><option>صيانة</option><option>أخرى</option>
      </select>
    </td>
    <td style="padding:4px 3px"><input type="number" name="er-amount" placeholder="0.00" min="0" step="0.01" oninput="updateExpenseTotal()" style="${s}"></td>
    <td style="padding:4px 3px"><input type="text" name="er-doc" placeholder="مستند" style="${s}"></td>
    <td style="padding:4px 3px"><input type="text" name="er-notes" placeholder="..." style="${s}"></td>
    <td style="padding:4px 3px;text-align:center">
      <button class="btn-remove" onclick="this.closest('tr').remove();updateExpenseTotal()">✕</button>
    </td>`;
  tbody.appendChild(tr);
  updateExpenseTotal();
}

function updateExpenseTotal() {
  const rows = el('expenseRowsContainer')?.querySelectorAll('tr') || [];
  let total = 0;
  rows.forEach(r => { total += parseFloat(r.querySelector('[name="er-amount"]')?.value)||0; });
  if (el('exp-total')) el('exp-total').textContent = fmt(total);
}

function toggleExpenseModalSize() {
  const modal = el('expenseModalInner');
  if (!modal) return;
  if (modal.style.maxWidth === '98vw') {
    modal.style.maxWidth = '';
    modal.style.width    = '';
  } else {
    modal.style.maxWidth = '98vw';
    modal.style.width    = '98vw';
    modal.style.maxHeight= '95vh';
  }
}

async function submitExpense() {
  const dateEl   = document.getElementById('exp-date');
  const methodEl = document.getElementById('exp-method');
  const docEl    = document.getElementById('exp-doc');
  const date   = dateEl?.value   || today();
  const method = methodEl?.value || 'تحويل بنكي';
  const docRef = docEl?.value?.trim() || '';

  if (!date) { showFieldErr('expError','يرجى إدخال التاريخ'); return; }

  const rows = el('expenseRowsContainer')?.querySelectorAll('tr') || [];
  const expenses = [];
  rows.forEach(r => {
    const fileNo = r.querySelector('[name="er-file"]')?.value || state.currentFileNo || '';
    const desc   = r.querySelector('[name="er-desc"]')?.value.trim()  || '';
    const type   = r.querySelector('[name="er-type"]')?.value         || 'أخرى';
    const amount = parseFloat(r.querySelector('[name="er-amount"]')?.value) || 0;
    const doc    = r.querySelector('[name="er-doc"]')?.value.trim()   || docRef || '';
    const notes  = r.querySelector('[name="er-notes"]')?.value.trim() || '';
    if (amount > 0) expenses.push({ fileNo, desc:desc||'مصروف', type, amount, doc, notes });
  });

  if (!expenses.length) { showFieldErr('expError','يرجى إضافة بند واحد على الأقل مع المبلغ'); return; }
  
  // Validate file_no for each row
  const missingFile = expenses.find(e => !e.fileNo);
  if (missingFile) { showFieldErr('expError','يرجى اختيار رقم الملف لكل بند'); return; }

  const btn = document.querySelector('#expenseModal .btn-primary');
  if (btn) { btn.disabled=true; btn.textContent='⏳ جاري الحفظ...'; }
  try {
    for (const exp of expenses) {
      const expFileNo = exp.fileNo || state.currentFileNo || 'GENERAL';
      const refNo = (await genSeqRef('EXP', state.system, expFileNo, 'expenses')) || `EXP-${expFileNo}-${Date.now()}`;
      const data = {
        system_type: state.system,
        file_no:     expFileNo,
        pay_id:      refNo,
        description: exp.desc  || 'مصروف',
        exp_type:    exp.type  || 'Miscellaneous',
        category:    exp.type  || null,
        amount:      exp.amount,
        pay_method:  method    || 'Cash',
        document:    exp.doc   || null,
        exp_date:    date,
        expense_date:date,
        notes:       exp.notes || null,
        ref_no:      refNo
      , post_status:entryStatus()};
      await apiPost('expenses', data);
      await logAudit('INSERT','expenses', expFileNo, null, data);
      if (entryStatus()==='posted') await je_expense({sys:state.system,date,amount:exp.amount,fileNo:expFileNo,desc:exp.desc||'مصروف',expType:exp.type||'أخرى',method});
    }
    closeModal('expenseModal');
    invalidateCache();
    toast(`✅ تم تسجيل ${expenses.length} مصروف`,'ok');
    if (state.currentFileNo) {
      if (state.currentTab === 3) loadExpensesTab(state.currentFileNo, state.system);
      if (state.currentTab === 0) loadSummaryTab(state.currentFileNo, state.system);
      loadViewerKpis(state.currentFileNo, state.system);
    }
  } catch(e) { showFieldErr('expError','خطأ: '+e.message); }
  if (btn) { btn.disabled=false; btn.textContent='💾 حفظ الكل'; }
}

// Payment
async function submitPayment() {
  const fn     = state.currentFileNo;
  const payer  = (el('pay-payer').value || '').trim();
  const amount = parseFloat(el('pay-amount').value);
  const method = el('pay-method').value;
  const doc    = el('pay-doc').value.trim();
  const date   = el('pay-date').value;
  const notes  = el('pay-notes').value.trim();

  if (!payer || !amount || !date) { showFieldErr('payError','يرجى ملء الحقول المطلوبة'); return; }

  // تحذير لو الدفعة أكبر من المتبقي (من البطاقة المحسوبة)
  const remainingText = el('pay-card-remaining')?.textContent?.replace(/,/g,'');
  const remaining = parseFloat(remainingText) || 0;
  if (remaining > 0 && amount > remaining + 0.001) {
    const proceed = confirm(`⚠️ قيمة الدفعة (${fmt(amount)}) أكبر من الباقي للمورد (${fmt(remaining)}).\n\nهل تريد المتابعة؟`);
    if (!proceed) return;
  }

  try {
    const refNo = (await genSeqRef('PMT', state.system, fn, 'payments')) || `PMT-${fn}-${Date.now()}`;
    const data = {
      system_type: state.system, file_no: fn,
      pay_id: refNo, ref_no: refNo,
      po_no: state.currentDeal?.po_no || null,
      payer, amount, pay_method: method,
      document: doc||null, pay_date: date,
      notes: notes||null
    , post_status:entryStatus()};
    await apiPost('payments', data);
    await logAudit('INSERT','payments',fn,null,data);
    const poArr = await apiGet('purchase_orders', { select:'supplier', system_type:`eq.${state.system}`, file_no:`eq.${fn}` });
    const supplierName = poArr?.[0]?.supplier || state.allDeals.find(d=>d.file_no===fn)?.supplier || '';
    if (entryStatus()==='posted') await je_payment({sys:state.system,date,amount,fileNo:fn,supplierName,payerName:payer,method});
    closeModal('paymentModal');
    toast('✅ تم تسجيل الدفعة بنجاح','ok');
    if (state.currentTab === 2) loadPaymentsTab(fn, state.system);
    if (state.currentTab === 0) loadSummaryTab(fn, state.system);
  } catch(e) { showFieldErr('payError','خطأ: '+e.message); }
}

// Expense
// submitExpense moved to EXPENSE MODAL section above

// Sale - open modal, populate vehicles
async function openSaleModal(fileNoOverride = null) {
  const fn  = fileNoOverride || state.currentFileNo;
  const sys = state.system;

  // ملأ قائمة الملفات
  const sel = el('sale-fileNo');
  sel.innerHTML = '<option value="">— اختر الملف —</option>';
  try {
    const deals = await apiGet('purchase_orders', {
      select:'file_no,supplier', system_type:`eq.${sys}`, order:'created_at.desc'
    });
    (deals||[]).forEach(d => {
      const o = document.createElement('option');
      o.value = d.file_no;
      o.textContent = `${d.file_no} — ${d.supplier||''}`;
      sel.appendChild(o);
    });
    if (fn) sel.value = fn;
  } catch(e) {}

  // Reset
  el('sale-date').value  = today();
  el('sale-notes').value = '';
  el('sale-customer').value = '';
  el('saleError').style.display = 'none';
  el('saleTotalDisplay').textContent = '0.000';
  await populateContactSelect('sale-customer','customer');

  // رقم الفاتورة
  const fileNo = sel.value;
  try {
    if (fileNo) {
      const prev = await apiGet('sales', { select:'inv_no', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, order:'created_at.desc', limit:100 });
      const max  = Math.max(0, ...(prev||[]).map(s=>{ const m=(s.inv_no||'').match(/(\d+)$/); return m?+m[1]:0; }));
      el('sale-invNo').value = `INV-${fileNo}-${String(max+1).padStart(3,'0')}`;
    } else {
      el('sale-invNo').value = `INV-${sys}-001`;
    }
  } catch(e) {}

  // السيارات
  el('saleVehiclesContainer').innerHTML = '';
  state._saleAvailableVehicles = fileNo ? await loadAvailableVehicles(fileNo, sys) : [];
  addSaleVehicleRow();
  openModal('saleModal');
}

async function onSaleFileChange(fn) {
  try {
    if (fn) {
      const prev = await apiGet('sales', { select:'inv_no', system_type:`eq.${state.system}`, file_no:`eq.${fn}`, order:'created_at.desc', limit:100 });
      const max  = Math.max(0, ...(prev||[]).map(s=>{ const m=(s.inv_no||'').match(/(\d+)$/); return m?+m[1]:0; }));
      el('sale-invNo').value = `INV-${fn}-${String(max+1).padStart(3,'0')}`;
    }
  } catch(e) {}
  state._saleAvailableVehicles = fn ? await loadAvailableVehicles(fn, state.system) : [];
  el('saleVehiclesContainer').innerHTML = '';
  addSaleVehicleRow();
  updateSaleTotal();
}

async function loadAvailableVehicles(fn, sys) {
  const vehicles = await apiGet('vehicles', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` });
  const sales    = await apiGet('sales',    { select:'vin', system_type:`eq.${sys}`, file_no:`eq.${fn}` });
  const soldVins = new Set((sales||[]).map(s=>s.vin));
  return (vehicles||[]).filter(v=>!soldVins.has(v.vin));
}


function addSaleVehicleRow() {
  const container = el('saleVehiclesContainer');
  const tr = document.createElement('tr');
  tr.className = 'sale-v-row';
  const vehicles = state._saleAvailableVehicles || [];
  const vOpts = ['<option value="">— اختر سيارة (رقم الشاصي) —</option>',
    ...vehicles.map(v => {
      const vin = v.vin || '—';
      const info = [v.model||v.vehicle_type, v.year, v.color].filter(Boolean).join(' · ');
      // Label = VIN فقط (المعلومات الإضافية في data-* للـ JS)
      return `<option value="${v.id}" data-vin="${v.vin||''}" data-model="${v.model||v.vehicle_type||''}" data-plate="${v.plate||''}" data-color="${v.color||''}" data-year="${v.year||''}" title="${info}">${vin}</option>`;
    })
  ].join('');
  tr.innerHTML = `
    <td style="padding:4px 3px">
      <select name="sv-vehicle" onchange="onSaleRowVehicleChange(this)"
        style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:4px;padding:6px 8px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px">
        ${vOpts}
      </select>
    </td>
    <td style="padding:4px 3px">
      <input type="text" name="sv-vin" readonly placeholder="—"
        style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:6px 8px;color:var(--text);font-family:monospace;font-size:11px;direction:ltr;opacity:.8">
    </td>
    <td style="padding:4px 3px">
      <input type="number" name="sv-price" placeholder="0.000" min="0" step="0.001"
        oninput="updateSaleTotal()"
        style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:4px;padding:6px 8px;color:var(--text);font-family:monospace;font-size:12px">
    </td>
    <td style="padding:4px 3px">
      <input type="text" name="sv-notes" placeholder="ملاحظة"
        style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:4px;padding:6px 8px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px">
    </td>
    <td style="padding:4px 3px;text-align:center">
      <button class="btn-remove" onclick="this.closest('tr').remove();updateSaleTotal()" title="حذف">✕</button>
    </td>
  `;
  container.appendChild(tr);
}

async function onSaleRowFileChange(sel) {
  const fn  = sel.value;
  const row = sel.closest('tr');
  const vehicleSel = row.querySelector('[name="sv-vehicle"]');
  vehicleSel.innerHTML = '<option value="">⏳ جاري التحميل...</option>';
  if (!fn) { vehicleSel.innerHTML = '<option value="">-- اختر ملف أولاً --</option>'; return; }
  try {
    const vehicles = await apiGet('vehicles', { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${fn}` });
    const sales    = await apiGet('sales',    { select:'vin', system_type:`eq.${state.system}`, file_no:`eq.${fn}` });
    const soldVins = new Set((sales||[]).map(s=>s.vin));
    const avail    = (vehicles||[]).filter(v=>!soldVins.has(v.vin));
    vehicleSel.innerHTML = '<option value="">— اختر سيارة (رقم الشاصي) —</option>' +
      avail.map(v=>{
        const info = [v.model||v.vehicle_type, v.year, v.color].filter(Boolean).join(' · ');
        return `<option value="${v.id}"
          data-vin="${v.vin||''}"
          data-model="${v.model||v.vehicle_type||''}"
          data-plate="${v.plate||''}"
          data-color="${v.color||''}"
          data-engine="${v.engine_size||''}"
          data-year="${v.year||''}"
          title="${info}">${v.vin||'—'}</option>`;
      }).join('');
  } catch(e) { vehicleSel.innerHTML = '<option value="">خطأ في التحميل</option>'; }
}

function onSaleRowVehicleChange(sel) {
  const opt = sel.options[sel.selectedIndex];
  const row = sel.closest('tr');
  row.querySelector('[name="sv-vin"]').value = opt?.dataset?.vin || '';
  updateSaleTotal();
}

function onSaleVehicleChange(sel) {
  const opt = sel.options[sel.selectedIndex];
  const row = sel.closest('tr');
  if (row.querySelector('[name="sv-vin"]'))
    row.querySelector('[name="sv-vin"]').value = opt.dataset.vin || '';
  updateSaleTotal();
}

function updateSaleTotal() {
  const rows = el('saleVehiclesContainer')?.querySelectorAll('tr.sale-v-row') || [];
  let total = 0;
  rows.forEach(r => { total += parseFloat(r.querySelector('[name="sv-price"]')?.value) || 0; });
  if (el('saleTotalDisplay')) el('saleTotalDisplay').textContent = fmt(total);
  if (el('saleTotalWrap')) el('saleTotalWrap').style.display = rows.length ? 'flex' : 'none';
}

function toggleSalePayment(checked) {
  const fields = el('sale-payment-fields');
  if (fields) fields.style.display = checked ? 'block' : 'none';
  if (checked) {
    // اضبط تاريخ الدفع على اليوم تلقائي
    const payDate = el('sale-pay-date');
    if (payDate && !payDate.value) payDate.value = today();
    // اضبط المبلغ على الإجمالي تلقائي
    const totalAmt = Array.from(document.querySelectorAll('[name="sv-price"]'))
      .reduce((s, i) => s + (parseFloat(i.value)||0), 0);
    const payAmt = el('sale-pay-amount');
    if (payAmt && !payAmt.value && totalAmt > 0) payAmt.value = totalAmt.toFixed(3);
  }
}

async function submitSale() {
  const fn       = el('sale-fileNo').value.trim();
  const invNo    = el('sale-invNo').value.trim();
  const customer = el('sale-customer')?.value?.trim() || '';
  const date     = el('sale-date').value;
  const notes    = el('sale-notes').value.trim();

  if (!fn)       { showFieldErr('saleError','يرجى اختيار رقم الملف'); return; }
  if (!customer) { showFieldErr('saleError','يرجى اختيار العميل'); return; }
  if (!date)     { showFieldErr('saleError','يرجى إدخال التاريخ'); return; }
  if (!invNo)    { showFieldErr('saleError','يرجى إدخال رقم الفاتورة'); return; }

  // Collect vehicles from table rows
  const rows = el('saleVehiclesContainer').querySelectorAll('tr.sale-v-row');
  const saleItems = [];
  rows.forEach(row => {
    const vehicleSel = row.querySelector('[name="sv-vehicle"]');
    const opt        = vehicleSel?.options[vehicleSel?.selectedIndex];
    const price      = parseFloat(row.querySelector('[name="sv-price"]')?.value) || 0;
    const vnote      = row.querySelector('[name="sv-notes"]')?.value?.trim() || '';
    if (vehicleSel?.value && price > 0) {
      saleItems.push({
        vehicleId: vehicleSel.value, price, vnote,
        fileNo: fn,
        vin:   opt?.dataset?.vin   || row.querySelector('[name="sv-vin"]')?.value || '',
        model: opt?.dataset?.model || '',
        plate: opt?.dataset?.plate || '',
        color: opt?.dataset?.color || '',
        year:  opt?.dataset?.year  || '',
      });
    }
  });

  if (!saleItems.length) { showFieldErr('saleError','يرجى إضافة سيارة واحدة على الأقل مع السعر'); return; }

  const totalPrice = saleItems.reduce((s,i)=>s+i.price,0);
  const btn = el('saleSubmitBtn');
  btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...';

  try {
    // Insert a sale record per vehicle
    const insertedSales = [];
    for (const item of saleItems) {
      const data = {
        system_type: state.system, file_no: item.fileNo||fn,
        inv_no: invNo, vin: item.vin||null, customer,
        sale_price: item.price, sale_date: date, post_status:entryStatus(), notes: item.vnote||notes||null
      };
      await apiPost('sales', data);
      insertedSales.push(data);
      await logAudit('INSERT','sales',item.fileNo||fn,null,data);
    }

    // Journal Entry: بيع
    if (entryStatus()==='posted') {
      for (const item of saleItems) {
        await je_sale({sys:state.system,date,amount:item.price,cost:0,fileNo:item.fileNo||fn,customer,invNo});
      }
    }

    // Update PO status
    const allV = await apiGet('vehicles', { select:'vin', system_type:`eq.${state.system}`, file_no:`eq.${fn}` });
    const allS = await apiGet('sales',    { select:'vin', system_type:`eq.${state.system}`, file_no:`eq.${fn}` });
    const soldSet = new Set((allS||[]).map(s=>s.vin));
    const allSold = (allV||[]).every(v=>soldSet.has(v.vin));
    await apiPatch('purchase_orders', { system_type:`eq.${state.system}`, file_no:`eq.${fn}` },
      { status: allSold ? 'CLOSED' : 'IN PROGRESS' });

    // اقرأ بيانات الدفع قبل ما تتقفل الـ modal
    const isPaid    = el('sale-paid-now')?.checked || false;
    const payMethod = el('sale-pay-method')?.value || 'تحويل بنكي';
    const payDoc    = el('sale-pay-doc')?.value?.trim() || null;
    const payDate   = el('sale-pay-date')?.value || date;
    const payNotes  = el('sale-pay-notes')?.value?.trim() || null;
    const payAmtInput = parseFloat(el('sale-pay-amount')?.value) || 0;

    closeModal('saleModal');
    invalidateCache();
    // أضف تحصيل لكل سيارة

    for (const item of saleItems) {
      try {
        // المبلغ المدفوع — لو جزئي نوزّعه بالنسبة
        const itemPaidAmt = isPaid
          ? (payAmtInput > 0 ? Math.min(payAmtInput, item.price) : item.price)
          : 0;

        await apiPost('collections', {
          system_type: state.system,
          file_no:     item.fileNo || fn,
          inv_no:      invNo,
          customer,
          vin:         item.vin || '',
          amount:      item.price,
          pay_method:  payMethod,
          document:    payDoc,
          due_date:    date,
          paid_date:   isPaid ? payDate : null,
          notes:       payNotes,
          post_status: entryStatus(),
          ref_no:      `COL-${invNo}-${item.vin||Math.random().toString(36).slice(2,6)}`,
        });

        if (isPaid && entryStatus()==='posted') {
          await je_collection({
            sys:      state.system,
            date:     payDate,
            amount:   itemPaidAmt,
            fileNo:   item.fileNo || fn,
            customer,
            invNo,
            method:   payMethod,
          });
        }
      } catch(e) { console.warn('collection create error:', e.message); }
    }
    invalidateCache();
    toast(`✅ تم تسجيل فاتورة ${invNo} — ${saleItems.length} سيارة`,'ok');
    state.currentSales = allS || [];
    if (state.currentTab === 4) loadSalesTab(fn, state.system);
    if (state.currentTab === 0) loadSummaryTab(fn, state.system);

    // Open printable invoice
    printSaleInvoice({ invNo, customer, date, fn, notes, items: saleItems, total: totalPrice });

  } catch(e) { showFieldErr('saleError','خطأ: '+e.message); console.error(e); }
  btn.disabled = false; btn.textContent = '💾 حفظ وعرض الفاتورة';
}

// ════════════════════════════════════════
// PRINT SALE INVOICE
// ════════════════════════════════════════

// Collection - open modal
async function openCollectionModal() {
  const fn  = state.currentFileNo;
  const sys = state.system;

  // Reset form
  el('col-invNo').innerHTML    = '<option value="">جاري التحميل...</option>';
  el('col-inv-card').style.display   = 'none';
  el('col-form-fields').style.display = 'none';
  el('col-submit-btn').style.display  = 'none';
  el('col-amount').value   = '';
  el('col-dueDate').value  = '';
  el('col-paidDate').value = today();
  el('col-doc').value      = '';
  el('col-notes').value    = '';
  el('colError').style.display = 'none';
  openModal('collectionModal');

  try {
    const [sales, collections] = await Promise.all([
      apiGet('sales', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'sale_date.desc' }),
      apiGet('collections', { select:'inv_no,amount', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
    ]);

    const collectedMap = {};
    (collections||[]).forEach(c => {
      if (c.inv_no) collectedMap[c.inv_no] = (collectedMap[c.inv_no]||0) + (+c.amount||0);
    });

    const normalizedSales = (sales||[]).map(s => ({
      ...s, inv_no: s.inv_no || '',
    })).filter(s => s.inv_no);

    const pendingSales = normalizedSales.map(s => ({
      ...s,
      collected: collectedMap[s.inv_no] || 0,
      remaining: (+s.sale_price||0) - (collectedMap[s.inv_no]||0),
    })).filter(s => s.remaining > 0.001);

    if (!pendingSales.length) {
      el('col-invNo').innerHTML = '<option value="">لا توجد فواتير غير محصّلة</option>';
      return;
    }

    el('col-invNo').innerHTML = '<option value="">— اختر بالشاصي أو الفاتورة —</option>' +
      pendingSales.map(s => `
        <option value="${s.inv_no}"
          data-customer="${s.customer||''}"
          data-vin="${s.vin||''}"
          data-total="${s.sale_price||0}"
          data-collected="${s.collected}"
          data-remaining="${s.remaining}">
          ${s.vin||'—'}  |  ${s.inv_no||'—'} — ${s.customer||''}  (باقي: ${fmt(s.remaining)})
        </option>`).join('');

    // حفظ البيانات للاستخدام في onchange
    el('col-invNo')._salesData = pendingSales;

  } catch(e) {
    el('col-invNo').innerHTML = '<option value="">خطأ في التحميل</option>';
    console.error(e);
  }
}

function onCollectionInvChange() {
  const sel = el('col-invNo');
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) {
    el('col-inv-card').style.display    = 'none';
    el('col-form-fields').style.display = 'none';
    el('col-submit-btn').style.display  = 'none';
    return;
  }

  const total     = parseFloat(opt.dataset.total)     || 0;
  const collected = parseFloat(opt.dataset.collected) || 0;
  const remaining = parseFloat(opt.dataset.remaining) || 0;

  // ملء الـ hidden fields
  el('col-customer').value = opt.dataset.customer || '';
  el('col-vin').value      = opt.dataset.vin      || '';

  // بطاقة الفاتورة
  el('col-card-customer').textContent  = opt.dataset.customer || '—';
  el('col-card-vin').textContent       = opt.dataset.vin      || '—';
  el('col-card-total').textContent     = fmt(total);
  el('col-card-collected').textContent = fmt(collected);
  el('col-card-remaining').textContent = fmt(remaining);

  // لون الباقي
  const remEl = el('col-card-remaining');
  remEl.style.color = remaining > 0 ? 'var(--accent)' : 'var(--green)';

  // اقتراح المبلغ = الباقي كاملاً
  el('col-amount').value = remaining > 0 ? remaining.toFixed(3) : '';

  el('col-inv-card').style.display    = 'block';
  el('col-form-fields').style.display = 'block';
  el('col-submit-btn').style.display  = '';
}

async function submitCollection() {
  const fn     = state.currentFileNo;
  const invNo  = el('col-invNo').value;
  const cust   = el('col-customer').value.trim();
  const vin    = el('col-vin').value.trim();
  const amount = parseFloat(el('col-amount').value);
  const method = el('col-method').value;
  const doc    = el('col-doc').value.trim();
  const due    = el('col-dueDate').value;
  const paid   = el('col-paidDate').value;
  const notes  = el('col-notes').value.trim();

  if (!invNo || !amount) { showFieldErr('colError','يرجى ملء الحقول المطلوبة'); return; }

  // تحقق من عدم تجاوز الباقي
  const sel2 = el('col-invNo');
  const opt2 = sel2?.options[sel2?.selectedIndex];
  const remAllowed = parseFloat(opt2?.dataset?.remaining || 999999);
  if (amount > remAllowed + 0.001) {
    showFieldErr('colError', `⚠️ المبلغ أكبر من الباقي المستحق (${fmt(remAllowed)})`);
    return;
  }

  try {
    const refNo = (await genSeqRef('COL', state.system, fn, 'collections')) || `COL-${fn}-${Date.now()}`;
    const pay_id = refNo;
    const data = {
      system_type: state.system, file_no: fn,
      pay_id, inv_no: invNo, customer: cust, vin: vin||null, amount,
      pay_method: method, document: doc||null,
      due_date: due||null, paid_date: paid||null, notes: notes||null,
      ref_no: refNo
    , post_status:entryStatus()};
    await apiPost('collections', data);
    await logAudit('INSERT','collections',fn,null,data);
    if (entryStatus()==='posted' && cust) await je_collection({sys:state.system,date:paid||today(),amount,fileNo:fn,customer:cust,invNo:invNo||'',method});
    closeModal('collectionModal');
    toast('✅ تم تسجيل التحصيل بنجاح','ok');
    invalidateCache();
    if (state.currentTab === 5) loadCollectionsTab(fn, state.system);
    if (state.currentTab === 0) loadSummaryTab(fn, state.system);
  } catch(e) { showFieldErr('colError','خطأ: '+e.message); }
}

// Payout
async function openPayoutModal() {
  const fn  = state.currentFileNo;
  const sys = state.system;

  // Get partners from partners_master for this file
  // Fallback to all partners from contacts if none found
  let partners = await apiGet('partners_master', { select:'partner', system_type:`eq.${sys}`, file_no:`eq.${fn}` });
  if (!partners?.length) {
    const allPartners = await getContactsByType('partner');
    partners = (allPartners||[]).map(p => ({ partner: p.name }));
  }

  el('poutModalTitle').textContent = `صرف للشريك — ملف ${fn||''}`;
  el('pout-partner').innerHTML = '<option value="">-- اختر الشريك --</option>' +
    (partners||[]).map(p=>`<option value="${p.partner}">${p.partner}</option>`).join('');
  el('pout-amount').value  = '';
  el('pout-capital').value = '';
  el('pout-profit').value  = '';
  el('pout-date').value    = today();
  el('pout-doc').value     = '';
  el('pout-notes').value   = '';
  el('poutError').style.display       = 'none';
  el('pout-balance-card').style.display = 'none';
  el('pout-type').value = 'استرداد رأس مال';
  onPayoutTypeChange();
  openModal('payoutModal');
}

async function onPayoutPartnerChange() {
  const partner = el('pout-partner').value;
  const fn      = state.currentFileNo;
  if (!partner || !fn) return;
  const card = el('pout-balance-card');
  card.style.display = '';
  card.innerHTML = `<div style="text-align:center;padding:8px;color:var(--text2);font-size:12px">⏳ جاري التحميل...</div>`;
  try {
    const s = await getPartnerDealBalance(fn, partner, state.system);
    const shareP = (s.share * 100).toFixed(0);
    const fmt2 = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:2});
    card.innerHTML = `
      <div style="font-weight:800;font-size:13px;color:var(--purple);margin-bottom:10px;display:flex;align-items:center;gap:6px">
        👤 ${partner}
        <span style="background:var(--purple);color:#fff;border-radius:20px;padding:2px 10px;font-size:11px">${shareP}% حصة</span>
      </div>
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:6px">تفاصيل الصفقة الكاملة</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px">
        <div style="background:var(--card2);border-radius:6px;padding:8px 10px;border-right:3px solid var(--blue)">
          <div style="font-size:9px;color:var(--text2);font-weight:700">رأس المال (شراء)</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:var(--blue)">${fmt2(s._totalCost)}</div>
        </div>
        <div style="background:var(--card2);border-radius:6px;padding:8px 10px;border-right:3px solid var(--red)">
          <div style="font-size:9px;color:var(--text2);font-weight:700">المصاريف</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:var(--red)">${fmt2(s._totalExp)}</div>
        </div>
        <div style="background:var(--card2);border-radius:6px;padding:8px 10px;border-right:3px solid var(--green)">
          <div style="font-size:9px;color:var(--text2);font-weight:700">المبيعات</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:var(--green)">${fmt2(s._totalSales)}</div>
        </div>
      </div>
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:6px">حصة الشريك (${shareP}%)</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:10px">
        <div style="background:var(--card2);border-radius:6px;padding:8px 10px">
          <div style="font-size:9px;color:var(--text2);font-weight:700">رأس المال المدفوع</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:var(--blue)">${fmt2(s.capitalPaid)}</div>
        </div>
        <div style="background:var(--card2);border-radius:6px;padding:8px 10px">
          <div style="font-size:9px;color:var(--text2);font-weight:700">الربح المستحق</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:${s.profit>=0?'var(--green)':'var(--red)'}">${fmt2(Math.abs(s.profit))}</div>
        </div>
        <div style="background:var(--card2);border-radius:6px;padding:8px 10px">
          <div style="font-size:9px;color:var(--text2);font-weight:700">إجمالي المسحوبات</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:var(--amber)">${fmt2(s.totalWithdrawn)}</div>
        </div>
        <div style="background:var(--card2);border-radius:6px;padding:8px 10px">
          <div style="font-size:9px;color:var(--text2);font-weight:700">صافي الربح (حصتي)</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:${s.dealProfit>=0?'var(--green)':'var(--red)'}">${fmt2(s.dealProfit * s.share)}</div>
        </div>
      </div>
      <div style="background:${s.netDue>=0?'var(--green-dim)':'var(--red-dim)'};border:1px solid ${s.netDue>=0?'var(--green)':'var(--red)'};border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;font-weight:700">المتبقي المستحق للشريك</span>
        <span style="font-family:var(--mono);font-size:16px;font-weight:900;color:${s.netDue>=0?'var(--green)':'var(--red)'}">
          ${fmt2(Math.abs(s.netDue))} ${s.netDue>=0?'✅':'⚠️'}
        </span>
      </div>`;
    // ملء المبالغ تلقائياً
    const type = el('pout-type').value;
    if (type === 'رأس مال + أرباح') {
      if (!el('pout-capital').value) el('pout-capital').value = Math.max(0, s.capitalPaid - s.capitalRet).toFixed(3);
      if (!el('pout-profit').value && s.profit > 0) el('pout-profit').value = Math.max(0, s.profit - s.profitTaken).toFixed(3);
      calcPayoutTotal();
    } else if (type === 'استرداد رأس مال' && !el('pout-amount').value) {
      el('pout-amount').value = Math.max(0, s.capitalPaid - s.capitalRet).toFixed(3);
    } else if (type === 'توزيع أرباح' && !el('pout-amount').value && s.profit > 0) {
      el('pout-amount').value = Math.max(0, s.profit - s.profitTaken).toFixed(3);
    }
  } catch(e) {
    card.innerHTML = `<div style="color:var(--red);padding:8px">خطأ: ${e.message}</div>`;
  }
}

function onPayoutTypeChange() {
  const type = el('pout-type').value;
  const isSplit = type === 'رأس مال + أرباح';
  el('pout-split-wrap').style.display  = isSplit ? '' : 'none';
  el('pout-simple-wrap').style.display = isSplit ? 'none' : '';
  el('pout-amount-label').textContent  = type === 'توزيع أرباح' ? 'مبلغ الأرباح *' :
                                          type === 'سلفة' ? 'مبلغ السلفة *' : 'مبلغ رأس المال *';
}

function onPayoutAmountChange() { /* live validation if needed */ }

function calcPayoutTotal() {
  const cap = parseFloat(el('pout-capital').value) || 0;
  const prf = parseFloat(el('pout-profit').value)  || 0;
  const tot = cap + prf;
  el('pout-split-total').innerHTML = `الإجمالي: <strong style="color:var(--accent)">${fmt(tot)}</strong>`;
  el('pout-amount').value = tot;
}

// Get partner balance for a deal
async function getPartnerDealBalance(fileNo, partner, sys) {
  const [pmRow, payments, payouts, vehicles, sales, expenses, poRow] = await Promise.all([
    apiGet('partners_master', { select:'share_percent', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, partner:`eq.${partner}` }),
    apiGet('payments',        { select:'amount', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, payer:`eq.${partner}` }),
    apiGet('partner_payouts', { select:'amount,payout_type,capital_amount,profit_amount,advance_amount', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, partner:`eq.${partner}` }),
    apiGet('vehicles',        { select:'purchase_price', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
    apiGet('sales',           { select:'sale_price', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
    apiGet('expenses',        { select:'amount', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
    apiGet('purchase_orders', { select:'total_purchase', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
  ]);
  const share       = (pmRow?.[0]?.share_percent || 0) / 100;
  const capitalPaid = (payments||[]).reduce((s,p)=>s+(+p.amount||0),0);
  const totalCost   = +poRow?.[0]?.total_purchase || (vehicles||[]).reduce((s,v)=>s+(+v.purchase_price||0),0);
  const totalSales  = (sales||[]).reduce((s,s2)=>s+(+s2.sale_price||0),0);
  const totalExp    = (expenses||[]).reduce((s,e)=>s+(+e.amount||0),0);
  const dealProfit  = totalSales - totalCost - totalExp;
  const profit      = dealProfit * share;
  const capitalRet  = (payouts||[]).reduce((s,p)=>s+(+p.capital_amount||0),0);
  const profitTaken = (payouts||[]).reduce((s,p)=>s+(+p.profit_amount||0),0);
  const advances    = (payouts||[]).reduce((s,p)=>s+(+p.advance_amount||0),0);
  const totalWithdrawn = capitalRet + profitTaken + advances;
  const netDue = capitalPaid + profit - totalWithdrawn;
  return { share, capitalPaid, profit, capitalRet, profitTaken, advances, totalWithdrawn, netDue, dealProfit,
           _totalCost: totalCost, _totalExp: totalExp, _totalSales: totalSales };
}

async function submitPayout() {
  const fn      = state.currentFileNo;
  const partner = el('pout-partner').value;
  const type    = el('pout-type').value;
  const date    = el('pout-date').value;
  const method  = el('pout-method').value;
  const doc     = el('pout-doc').value.trim();
  const notes   = el('pout-notes').value.trim();

  if (!partner) { showFieldErr('poutError','يرجى اختيار الشريك'); return; }
  if (!date)    { showFieldErr('poutError','يرجى إدخال التاريخ'); return; }

  let amount = 0, capitalAmt = 0, profitAmt = 0, advanceAmt = 0;

  if (type === 'رأس مال + أرباح') {
    capitalAmt = parseFloat(el('pout-capital').value) || 0;
    profitAmt  = parseFloat(el('pout-profit').value)  || 0;
    amount     = capitalAmt + profitAmt;
  } else if (type === 'استرداد رأس مال') {
    amount = capitalAmt = parseFloat(el('pout-amount').value) || 0;
  } else if (type === 'توزيع أرباح') {
    amount = profitAmt = parseFloat(el('pout-amount').value) || 0;
  } else if (type === 'سلفة') {
    amount = advanceAmt = parseFloat(el('pout-amount').value) || 0;
  }

  if (!amount && type !== 'رأس مال + أرباح') { showFieldErr('poutError','يرجى إدخال المبلغ'); return; }
  if (type === 'رأس مال + أرباح' && amount === 0) { showFieldErr('poutError','يرجى إدخال المبالغ'); return; }

  try {
    // Generate pay_id
    let pay_id = `PAY-${fn}-001`;
    try {
      const existing = await apiGet('partner_payouts', { select:'pay_id', system_type:`eq.${state.system}`, file_no:`eq.${fn}`, order:'created_at.desc', limit:100 });
      const lastNums = (existing||[]).map(p=>{ const m=(p.pay_id||'').match(/(\d+)$/); return m?parseInt(m[1]):0; });
      const nextNum  = (lastNums.length ? Math.max(...lastNums) : 0) + 1;
      pay_id = `PAY-${fn}-${String(nextNum).padStart(3,'0')}`;
    } catch(e) {}
    const data = {
      system_type: state.system, file_no: fn, partner,
      pay_id, payout_type: type, amount,
      capital_amount: capitalAmt, profit_amount: profitAmt, advance_amount: advanceAmt,
      pay_method: method, document: doc||null, pay_date: date, notes: notes||null,
      post_status: entryStatus()
    };
    await apiPost('partner_payouts', data);
    await logAudit('INSERT','partner_payouts',fn,null,data);
    if (entryStatus()==='posted') await je_payout({sys:state.system,date,amount,fileNo:fn,partner,method});
    closeModal('payoutModal');
    toast(`✅ تم تسجيل ${type} للشريك ${partner}`,'ok');
    invalidateCache();
    if (state.currentTab === 6) loadPayoutsTab(fn, state.system);
    if (state.currentTab === 0) loadSummaryTab(fn, state.system);
  } catch(e) { showFieldErr('poutError','خطأ: '+e.message); }
}

// Add vehicle to existing deal
function openAddVehicleModal() {
  el('av-vin').value=''; el('av-type').value=''; el('av-model').value='';
  el('av-plate').value=''; el('av-color').value=''; el('av-price').value='';
  el('av-date').value = today(); el('av-notes').value='';
  el('avError').style.display='none';
  openModal('addVehicleModal');
}

async function submitAddVehicle() {
  const fn    = state.currentFileNo;
  const vin   = el('av-vin').value.trim();
  const type  = el('av-type').value.trim();
  const model = el('av-model').value.trim();
  const plate = el('av-plate').value.trim();
  const color = el('av-color').value.trim();
  const price = parseFloat(el('av-price').value) || 0;
  const date  = el('av-date').value;
  const notes = el('av-notes').value.trim();

  if (!type) { showFieldErr('avError','يرجى إدخال نوع السيارة'); return; }

  try {
    const data = {
      system_type: state.system, file_no: fn,
      po_no: state.currentDeal?.po_no || null,
      vin: vin||null, vehicle_type: type, model: model||type,
      plate: plate||null, color: color||null,
      purchase_price: price, purchase_date: date||null, notes: notes||null
    };
    await apiPost('vehicles', data);
    // Update vehicle count on PO
    const vCount = (await apiGet('vehicles', { select:'id', system_type:`eq.${state.system}`, file_no:`eq.${fn}` })).length;
    await apiPatch('purchase_orders', { system_type:`eq.${state.system}`, file_no:`eq.${fn}` }, { vehicle_count: vCount });
    await logAudit('INSERT','vehicles',fn,null,data);
    closeModal('addVehicleModal');
    invalidateCache();
    toast('✅ تم إضافة السيارة','ok');
    loadVehiclesTab(fn, state.system);
  } catch(e) { showFieldErr('avError','خطأ: '+e.message); }
}

// ════════════════════════════════════════
// FILE DROPDOWN HELPER
// ════════════════════════════════════════

async function populateFileDropdown(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">-- اختر الملف --</option>';
  try {
    const deals = await apiGet('purchase_orders', {
      select:'file_no,supplier',
      system_type:`eq.${state.system}`,
      order:'created_at.desc'
    });
    (deals||[]).forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.file_no;
      opt.textContent = `${d.file_no} — ${d.supplier||''}`;
      sel.appendChild(opt);
    });
    // Pre-select current file if open
    if (state.currentFileNo) sel.value = state.currentFileNo;
    else if (currentVal) sel.value = currentVal;
  } catch(e) {}
}

// ════════════════════════════════════════
// MODAL EXPAND / COLLAPSE
// ════════════════════════════════════════
function toggleModalSize(modalId) {
  const overlay = document.getElementById(modalId);
  if (!overlay) return;
  const modal = overlay.querySelector('.modal');
  if (!modal) return;
  modal.classList.toggle('expanded');
}

// ════════════════════════════════════════
// QUICK ENTRY (from Journal)
// ════════════════════════════════════════
async function openQuickModal(type) {
  const map = {
    sale:       'quickSaleModal',
    collection: 'quickCollectionModal',
    expense:    'quickExpenseModal',
    payment:    'quickPaymentModal',
    payout:     'quickPayoutModal',
  };
  // Reset error messages
  ['qsSaleError','qsColError','qsExpError','qsPayError','qsPoError'].forEach(id => {
    const e = el(id); if (e) { e.style.display='none'; e.textContent=''; }
  });
  // Set today as default date
  const dateIds = ['qs-date','qc-date','qe-date','qp-date','qpo-date'];
  dateIds.forEach(id => { const e = el(id); if (e && !e.value) e.value = today(); });

  // Populate file dropdowns
  const fileSelIds = { sale:'qs-fileNo', collection:'qc-fileNo', expense:'qe-fileNo', payment:'qp-fileNo', payout:'qpo-fileNo' };
  if (fileSelIds[type]) await populateFileDropdown(fileSelIds[type]);

  if (type === 'expense') { openExpenseModal(); return; }
  if (type === 'sale')    { await populateContactSelect('qs-customer','customer'); }
  if (type === 'payment') {
    el('qp-po-card').style.display    = 'none';
    el('qp-form-fields').style.display = 'none';
    el('qp-submit-btn').style.display  = 'none';
    el('qp-amount').value = '';
    el('qp-doc').value    = '';
    el('qp-notes').value  = '';
    // لو في ملف مفتوح — حمّله تلقائياً
    if (state.currentFileNo) {
      el('qp-fileNo').value = state.currentFileNo;
      await loadPaymentPOCard(state.currentFileNo);
    }
  }

  // Collection — reset invoice fields
  if (type === 'collection') {
    el('qc-invNo').innerHTML    = '<option value="">— اختر ملفاً أولاً —</option>';
    el('qc-inv-card').style.display    = 'none';
    el('qc-form-fields').style.display = 'none';
    el('qc-submit-btn').style.display  = 'none';
    el('qc-amount').value  = '';
    el('qc-doc').value     = '';
    el('qc-notes').value   = '';
    el('qc-dueDate').value = '';
    // لو في ملف مفتوح حالياً — حمّل فواتيره تلقائياً
    if (state.currentFileNo) {
      el('qc-fileNo').value = state.currentFileNo;
      await loadQuickInvoices(state.currentFileNo);
    }
  }

  openModal(map[type]);
}

// Load unsold VINs for a file (used in quick sale)
let _vinLoadTimer;
async function loadQuickVins(fileNo) {
  clearTimeout(_vinLoadTimer);
  if (!fileNo) return;
  _vinLoadTimer = setTimeout(async () => {
    try {
      const vehicles = await apiGet('vehicles', { select:'vin,model,vehicle_type', system_type:`eq.${state.system}`, file_no:`eq.${fileNo.trim()}` });
      const sales    = await apiGet('sales',    { select:'vin', system_type:`eq.${state.system}`, file_no:`eq.${fileNo.trim()}` });
      const soldVins = new Set((sales||[]).map(s=>s.vin));
      const unsold   = (vehicles||[]).filter(v => !soldVins.has(v.vin));
      el('qs-vin').innerHTML = unsold.length
        ? unsold.map(v=>`<option value="${v.vin}" title="${v.model||v.vehicle_type||''}">${v.vin}</option>`).join('')
        : '<option value="">— لا توجد سيارات متاحة في هذا الملف —</option>';
    } catch(e) {}
  }, 500);
}

// Load sales invoices for a file (used in quick collection)
let _invLoadTimer;
async function loadQuickInvoices(fileNo) {
  clearTimeout(_invLoadTimer);
  const invSel = el('qc-invNo');
  invSel.innerHTML = '<option value="">جاري التحميل...</option>';
  el('qc-inv-card').style.display    = 'none';
  el('qc-form-fields').style.display = 'none';
  el('qc-submit-btn').style.display  = 'none';

  if (!fileNo) {
    invSel.innerHTML = '<option value="">— اختر ملفاً أولاً —</option>';
    return;
  }

  // بدون timeout — نجيب البيانات فوراً
  try {
    const sys = state.system;
    const fn  = fileNo.trim();

    const [sales, collections] = await Promise.all([
      apiGet('sales',       { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'sale_date.desc' }),
      apiGet('collections', { select:'inv_no,amount', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
    ]);

    const collectedMap = {};
    (collections||[]).forEach(c => {
      if (c.inv_no) collectedMap[c.inv_no] = (collectedMap[c.inv_no]||0) + (+c.amount||0);
    });

    const normalizedSales = (sales||[]).map(s => ({
      ...s, inv_no: s.inv_no || '',
    })).filter(s => s.inv_no);

    const pending = normalizedSales.map(s => ({
      ...s,
      collected: collectedMap[s.inv_no] || 0,
      remaining: (+s.sale_price||0) - (collectedMap[s.inv_no]||0),
    })).filter(s => s.remaining > 0.001);

    invSel._salesData = pending;

    if (!pending.length) {
      invSel.innerHTML = '<option value="">لا توجد فواتير غير محصّلة</option>';
      return;
    }

    invSel.innerHTML = '<option value="">— اختر بالشاصي أو الفاتورة —</option>' +
      pending.map(s => `
        <option value="${s.inv_no}"
          data-customer="${s.customer||''}"
          data-vin="${s.vin||''}"
          data-total="${s.sale_price||0}"
          data-collected="${s.collected}"
          data-remaining="${s.remaining}">
          ${s.vin||'—'}  |  ${s.inv_no} — ${s.customer||''}  (باقي: ${fmt(s.remaining)})
        </option>`).join('');

  } catch(e) {
    console.error('loadQuickInvoices error:', e.message, e);
    invSel.innerHTML = `<option value="">خطأ: ${e.message}</option>`;
  }
}

function onQuickCollectionInvChange() {
  const sel = el('qc-invNo');
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) {
    el('qc-inv-card').style.display    = 'none';
    el('qc-form-fields').style.display = 'none';
    el('qc-submit-btn').style.display  = 'none';
    return;
  }
  const total     = parseFloat(opt.dataset.total)     || 0;
  const collected = parseFloat(opt.dataset.collected) || 0;
  const remaining = parseFloat(opt.dataset.remaining) || 0;

  el('qc-customer').value          = opt.dataset.customer || '';
  el('qc-vin').value               = opt.dataset.vin      || '';
  el('qc-card-customer').textContent  = opt.dataset.customer || '—';
  el('qc-card-vin').textContent       = opt.dataset.vin      || '—';
  el('qc-card-total').textContent     = fmt(total);
  el('qc-card-collected').textContent = fmt(collected);
  el('qc-card-remaining').textContent = fmt(remaining);
  el('qc-card-remaining').style.color = remaining > 0 ? 'var(--accent)' : 'var(--green)';
  el('qc-amount').value = remaining > 0 ? remaining.toFixed(3) : '';

  el('qc-inv-card').style.display    = 'block';
  el('qc-form-fields').style.display = 'block';
  el('qc-submit-btn').style.display  = '';
}

// Legacy — not used anymore
function fillCollectionCustomer() {}

// Load partners for a file (used in quick payout)
let _partnerLoadTimer;
async function loadQuickPartners(fileNo) {
  clearTimeout(_partnerLoadTimer);
  if (!fileNo) return;
  _partnerLoadTimer = setTimeout(async () => {
    try {
      const partners = await apiGet('partners_master', { select:'partner', system_type:`eq.${state.system}`, file_no:`eq.${fileNo.trim()}` });
      el('qpo-partner').innerHTML = (partners&&partners.length)
        ? partners.map(p=>`<option value="${p.partner}">${p.partner}</option>`).join('')
        : '<option value="">— لا يوجد شركاء في هذا الملف —</option>';
    } catch(e) {}
  }, 500);
}

// Submit quick sale
async function submitQuickSale() {
  const fileNo   = el('qs-fileNo').value;
  const vin      = el('qs-vin').value.trim();
  const customer = el('qs-customer')?.value?.trim() || '';
  const invNo    = el('qs-invNo').value.trim();
  const price    = parseFloat(el('qs-price').value);
  const date     = el('qs-date').value;
  const notes    = el('qs-notes').value.trim();

  if (!fileNo || !vin || !customer || !price || !date) {
    showFieldErr('qsSaleError','يرجى ملء جميع الحقول المطلوبة (*)'); return;
  }
  try {
    const data = { system_type:state.system, file_no:fileNo, vin, customer,
      invoice_no:invNo||null, sale_price:price, sale_date:date, notes:notes||null , post_status:entryStatus()};
    await apiPost('sales', data);
    await logAudit('INSERT','sales',fileNo,null,data);
    if (entryStatus()==='posted') await je_sale({sys:state.system,date,amount:price,cost:0,fileNo,customer,invNo:invNo||'QS'});
    closeModal('quickSaleModal');
    toast('✅ تم تسجيل البيع بنجاح','ok');
    invalidateCache();
    loadJournal();
  } catch(e) { showFieldErr('qsSaleError','خطأ: '+e.message); }
}

// Submit quick collection
async function submitQuickCollection() {
  const fileNo   = el('qc-fileNo').value;
  const invNo    = el('qc-invNo').value;
  const customer = el('qc-customer').value.trim();
  const vin      = el('qc-vin').value.trim();
  const amount   = parseFloat(el('qc-amount').value);
  const method   = el('qc-method').value;
  const doc      = el('qc-doc').value.trim();
  const due      = el('qc-dueDate').value;
  const paid     = el('qc-date').value;
  const notes    = el('qc-notes').value.trim();

  if (!fileNo || !invNo || !amount || !paid) {
    showFieldErr('qsColError','يرجى ملء جميع الحقول المطلوبة (*)'); return;
  }

  // تحقق من عدم تجاوز الباقي
  const sel = el('qc-invNo');
  const opt = sel.options[sel.selectedIndex];
  const remaining = parseFloat(opt?.dataset.remaining || 0);
  if (amount > remaining + 0.001) {
    showFieldErr('qsColError', `⚠️ المبلغ أكبر من الباقي المستحق (${fmt(remaining)})`);
    return;
  }

  try {
    const refNo = (await genSeqRef('COL', state.system, fileNo, 'collections')) || `COL-${fileNo}-${Date.now()}`;
    const data = {
      system_type: state.system, file_no: fileNo,
      pay_id: refNo, inv_no: invNo, customer: customer||null,
      vin: vin||null, amount, pay_method: method,
      document: doc||null, due_date: due||null,
      paid_date: paid, notes: notes||null, ref_no: refNo
    , post_status:entryStatus()};
    await apiPost('collections', data);
    await logAudit('INSERT','collections', fileNo, null, data);
    if (entryStatus()==='posted' && customer) await je_collection({sys:state.system,date:paid||today(),amount,fileNo,customer,invNo,method});
    closeModal('quickCollectionModal');
    toast('✅ تم تسجيل التحصيل بنجاح','ok');
    invalidateCache();
    loadJournal();
    if (state.currentTab === 5 && state.currentFileNo === fileNo) loadCollectionsTab(fileNo, state.system);
  } catch(e) { showFieldErr('qsColError','خطأ: '+e.message); }
}

// Submit quick expense
async function submitQuickExpense() {
  const fileNo = el('qe-fileNo').value;
  const desc   = el('qe-desc').value.trim();
  const type   = el('qe-type').value;
  const amount = parseFloat(el('qe-amount').value);
  const method = el('qe-method').value;
  const doc    = el('qe-doc').value.trim();
  const date   = el('qe-date').value;
  const notes  = el('qe-notes').value.trim();

  if (!fileNo || !desc || !amount || !date) {
    showFieldErr('qsExpError','يرجى ملء جميع الحقول المطلوبة (*)'); return;
  }
  try {
    const refNo = (await genSeqRef('EXP', state.system, fileNo, 'expenses')) || `EXP-${fileNo}-${Date.now()}`;
    const data = { system_type:state.system, file_no:fileNo, description:desc,
      pay_id:refNo, exp_type:type, category:type, amount, pay_method:method, document:doc||null,
      exp_date: date, expense_date:date, notes:notes||null, ref_no:refNo,
      post_status:entryStatus() };
    await apiPost('expenses', data);
    await logAudit('INSERT','expenses',fileNo,null,data);
    if (entryStatus()==='posted') await je_expense({sys:state.system,date,amount,fileNo,desc,expType:type,method});
    closeModal('quickExpenseModal');
    toast('✅ تم تسجيل المصروف بنجاح','ok');
    invalidateCache();
    loadJournal();
  } catch(e) { showFieldErr('qsExpError','خطأ: '+e.message); }
}

// Submit quick payment (to supplier)
async function loadPaymentPOCard(fileNo) {
  el('qp-po-card').style.display    = 'none';
  el('qp-form-fields').style.display = 'none';
  el('qp-submit-btn').style.display  = 'none';
  if (!fileNo) return;

  try {
    const sys = state.system;
    const [po, prevPayments, partners] = await Promise.all([
      apiGet('purchase_orders', { select:'file_no,supplier,total_purchase', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGet('payments',        { select:'amount', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGet('partners_master', { select:'partner', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
    ]);

    const poData    = po?.[0] || {};
    const totalPO   = +poData.total_purchase || 0;
    const totalPaid = (prevPayments||[]).reduce((s,p)=>s+(+p.amount||0), 0);
    const remaining = Math.max(totalPO - totalPaid, 0);

    el('qp-card-supplier').textContent  = poData.supplier || '—';
    el('qp-card-total').textContent     = fmt(totalPO);
    el('qp-card-paid').textContent      = fmt(totalPaid);
    el('qp-card-remaining').textContent = fmt(remaining);
    el('qp-card-remaining').style.color = remaining > 0 ? 'var(--accent)' : 'var(--green)';

    el('qp-amount').value = remaining > 0 ? remaining.toFixed(3) : '';

    // الدافع
    let payerOptions = '';
    if (partners?.length) {
      payerOptions = partners.map(p=>`<option value="${p.partner}">${p.partner}</option>`).join('');
    }
    if (poData.supplier) {
      payerOptions = `<option value="${poData.supplier}">${poData.supplier} (المورد)</option>` + payerOptions;
    }
    el('qp-payer').innerHTML = '<option value="">— اختر الدافع —</option>' + payerOptions;

    el('qp-po-card').style.display    = 'block';
    el('qp-form-fields').style.display = 'block';
    el('qp-submit-btn').style.display  = '';

  } catch(e) { console.error('loadPaymentPOCard:', e.message); }
}

async function submitQuickPayment() {
  const fileNo = el('qp-fileNo').value;
  const payer  = (el('qp-payer').value || '').trim();
  const amount = parseFloat(el('qp-amount').value);
  const method = el('qp-method').value;
  const doc    = el('qp-doc').value.trim();
  const date   = el('qp-date').value;
  const notes  = el('qp-notes').value.trim();

  if (!fileNo || !payer || !amount || !date) {
    showFieldErr('qsPayError','يرجى ملء جميع الحقول المطلوبة (*)'); return;
  }

  // تحقق من عدم تجاوز الباقي
  const remainingText = el('qp-card-remaining')?.textContent?.replace(/,/g,'');
  const remaining = parseFloat(remainingText) || 0;
  if (remaining > 0 && amount > remaining + 0.001) {
    const proceed = confirm(`⚠️ قيمة الدفعة (${fmt(amount)}) أكبر من الباقي للمورد (${fmt(remaining)}).\n\nهل تريد المتابعة؟`);
    if (!proceed) return;
  }

  try {
    const refNo = (await genSeqRef('PMT', state.system, fileNo, 'payments')) || `PMT-${fileNo}-${Date.now()}`;
    const supplierName = el('qp-card-supplier')?.textContent || '';
    const data = { system_type:state.system, file_no:fileNo, payer, amount,
      pay_id:refNo, ref_no:refNo,
      pay_method:method, document:doc||null, pay_date: date, notes:notes||null,
      post_status:entryStatus() };
    await apiPost('payments', data);
    await logAudit('INSERT','payments', fileNo, null, data);
    if (entryStatus()==='posted') await je_payment({sys:state.system,date,amount,fileNo,supplierName,payerName:payer,method});
    closeModal('quickPaymentModal');
    toast('✅ تم تسجيل الدفعة بنجاح','ok');
    loadJournal();
    if (state.currentTab === 2 && state.currentFileNo === fileNo) loadPaymentsTab(fileNo, state.system);
  } catch(e) { showFieldErr('qsPayError','خطأ: '+e.message); }
}

// Submit quick payout (to partner)
async function submitQuickPayout() {
  const fileNo  = el('qpo-fileNo').value;
  const partner = el('qpo-partner').value;
  const type    = el('qpo-type').value;
  const amount  = parseFloat(el('qpo-amount').value);
  const method  = el('qpo-method').value;
  const doc     = el('qpo-doc').value.trim();
  const date    = el('qpo-date').value;
  const notes   = el('qpo-notes').value.trim();

  if (!fileNo || !partner || !amount || !date) {
    showFieldErr('qsPoError','يرجى ملء جميع الحقول المطلوبة (*)'); return;
  }
  try {
    // Generate pay_id
    let pay_id = `PAY-${fileNo}-001`;
    try {
      const existing = await apiGet('partner_payouts', { select:'pay_id', system_type:`eq.${state.system}`, file_no:`eq.${fileNo}`, order:'created_at.desc', limit:100 });
      const lastNums = (existing||[]).map(p=>{ const m=(p.pay_id||'').match(/(\d+)$/); return m?parseInt(m[1]):0; });
      const nextNum  = (lastNums.length ? Math.max(...lastNums) : 0) + 1;
      pay_id = `PAY-${fileNo}-${String(nextNum).padStart(3,'0')}`;
    } catch(e) {}
    const data = { system_type:state.system, file_no:fileNo, partner,
      pay_id, payout_type:type, amount, pay_method:method, document:doc||null,
      pay_date: date, notes:notes||null, post_status:entryStatus() };
    await apiPost('partner_payouts', data);
    await logAudit('INSERT','partner_payouts',fileNo,null,data);
    if (entryStatus()==='posted') await je_payout({sys:state.system,date,amount,fileNo,partner,method});
    closeModal('quickPayoutModal');
    invalidateCache();
    toast('✅ تم تسجيل الصرف بنجاح','ok');
    loadJournal();
  } catch(e) { showFieldErr('qsPoError','خطأ: '+e.message); }
}

// VIN Search
function closeVinDropdown() {
  const dd = el('vinDropdown');
  if (dd) dd.style.display = 'none';
}

let _vinSearchTimer = null;
async function searchVinDropdown(q) {
  const dd = el('vinDropdown');
  if (!dd) return;

  if (!q || q.length < 3) { dd.style.display = 'none'; return; }

  dd.innerHTML = '<div style="padding:10px 14px;color:var(--text2);font-size:12px">⏳ جاري البحث...</div>';
  dd.style.display = 'block';

  clearTimeout(_vinSearchTimer);
  _vinSearchTimer = setTimeout(async () => {
    try {
      const vehicles = await apiGet('vehicles', {
        select: 'vin,model,vehicle_type,year,file_no,color',
        system_type: `eq.${state.system}`,
        vin: `ilike.*${q}*`,
        limit: 10
      });

      if (!vehicles?.length) {
        dd.innerHTML = '<div style="padding:10px 14px;color:var(--text2);font-size:12px">لا توجد نتائج</div>';
        return;
      }

      dd.innerHTML = vehicles.map(v => {
        const label = [v.model||v.vehicle_type, v.year, v.color].filter(Boolean).join(' · ');
        return `
        <div onclick="selectVinFromDropdown('${v.vin}')"
          style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"
          onmouseenter="this.style.background='var(--card2)'" onmouseleave="this.style.background=''">
          <div>
            <div style="font-family:monospace;font-weight:700;color:var(--accent);font-size:13px;direction:ltr">${v.vin}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px">${label||'—'}</div>
          </div>
          <span style="font-size:11px;background:var(--accent-dim);color:var(--accent);padding:2px 8px;border-radius:10px;font-family:monospace;flex-shrink:0;margin-right:8px">${v.file_no||'—'}</span>
        </div>`;
      }).join('');

    } catch(e) {
      dd.innerHTML = `<div style="padding:10px 14px;color:var(--red);font-size:12px">خطأ: ${e.message}</div>`;
    }
  }, 300);
}

async function selectVinFromDropdown(vin) {
  closeVinDropdown();
  const inp = el('vinSearch');
  if (inp) inp.value = vin;
  await searchVin(vin);
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('.sidebar-search')) closeVinDropdown();
});

async function searchVin(q) {
  if (!q || q.length < 3) {
    el('vin-card-overlay')?.remove();
    return;
  }
  try {
    const [vehicles, sales] = await Promise.all([
      apiGet('vehicles', {
        select: '*',
        system_type: `eq.${state.system}`,
        vin: `ilike.*${q}*`,
        limit: 5
      }),
      apiGet('sales', {
        select: 'vin,sale_price,sale_date,customer,inv_no',
        system_type: `eq.${state.system}`,
        vin: `ilike.*${q}*`
      })
    ]);

    el('vin-card-overlay')?.remove();

    if (!vehicles?.length) {
      toast('لم يُعثر على هذا الـ VIN', 'err');
      return;
    }

    const v    = vehicles[0];
    const sale = (sales||[]).find(s => s.vin === v.vin);
    const isSold = !!sale;
    const days = Math.floor((Date.now() - new Date(v.created_at||Date.now()).getTime()) / 864e5);

    const card = document.createElement('div');
    card.id = 'vin-card-overlay';
    card.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:rgba(0,0,0,.5);z-index:9999;
      display:flex;align-items:center;justify-content:center;padding:20px
    `;
    card.onclick = e => { if(e.target===card) card.remove(); };

    card.innerHTML = `
      <div style="background:var(--card);border-radius:var(--radius);padding:0;max-width:480px;width:100%;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);animation:fadeSlideIn .25s ease">

        <!-- Header -->
        <div style="background:${isSold?'var(--green)':'var(--purple)'};padding:16px 20px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:11px;color:#ffffff99;margin-bottom:2px">${isSold?'✅ مباعة':'🏭 في المخزن'}</div>
            <div style="font-size:18px;font-weight:700;color:#fff;font-family:monospace">${v.vin||'—'}</div>
          </div>
          <button onclick="document.getElementById('vin-card-overlay').remove()"
            style="background:#ffffff22;border:none;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px;font-family:'Cairo',sans-serif">✕</button>
        </div>

        <!-- Body -->
        <div style="padding:20px">

          <!-- Vehicle info -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
            <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
              <div style="font-size:10px;color:var(--text2);margin-bottom:3px">الموديل</div>
              <div style="font-size:14px;font-weight:700">${v.model||v.make||'—'} ${v.year||''}</div>
            </div>
            <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
              <div style="font-size:10px;color:var(--text2);margin-bottom:3px">رقم الملف</div>
              <div style="font-size:14px;font-weight:700;color:var(--accent)">${v.file_no||'—'}</div>
            </div>
            <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
              <div style="font-size:10px;color:var(--text2);margin-bottom:3px">تكلفة الشراء</div>
              <div style="font-size:14px;font-weight:700;color:var(--blue);font-family:monospace">${fmt(v.purchase_price)}</div>
            </div>
            <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
              <div style="font-size:10px;color:var(--text2);margin-bottom:3px">${isSold?'سعر البيع':'في المخزن منذ'}</div>
              <div style="font-size:14px;font-weight:700;color:${isSold?'var(--green)':'var(--accent)'};font-family:monospace">
                ${isSold ? fmt(sale.sale_price) : days+' يوم'}
              </div>
            </div>
          </div>

          <!-- Sale info if sold -->
          ${isSold ? `
          <div style="background:var(--green-dim);border:1px solid var(--green);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px">
            <div style="font-size:11px;font-weight:700;color:var(--green);margin-bottom:8px">تفاصيل البيع</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">
              <div><span style="color:var(--text2)">العميل: </span><span style="font-weight:600">${sale.customer||'—'}</span></div>
              <div><span style="color:var(--text2)">تاريخ البيع: </span><span style="font-weight:600">${fmtDate(sale.sale_date)}</span></div>
              <div><span style="color:var(--text2)">رقم الفاتورة: </span><span style="font-family:monospace">${sale.inv_no||'—'}</span></div>
              <div><span style="color:var(--text2)">الربح: </span><span style="font-weight:700;color:${(+sale.sale_price-(+v.purchase_price||0))>=0?'var(--green)':'var(--red)'}">
                ${fmt((+sale.sale_price||0)-(+v.purchase_price||0))}
              </span></div>
            </div>
          </div>` : ''}

          <!-- Actions -->
          <div style="display:flex;gap:8px">
            <button onclick="document.getElementById('vin-card-overlay').remove();openViewer('${v.file_no}')"
              class="btn btn-primary" style="flex:1">
              📁 فتح الصفقة ${v.file_no}
            </button>
            <button onclick="document.getElementById('vin-card-overlay').remove()"
              class="btn btn-secondary">إغلاق</button>
          </div>

        </div>
      </div>`;

    document.body.appendChild(card);

  } catch(e) { toast('خطأ في البحث: '+e.message, 'err'); }
}

// ════════════════════════════════════════
// UI HELPERS
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

function openModal(id) {
  document.getElementById(id).classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
  document.body.style.overflow = '';
}

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

let toastTimer;
function toast(msg, type='ok') {
  const t = el('toast');
  t.className = '';
  t.textContent = msg;
  void t.offsetWidth; // force reflow
  t.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.add('hiding');
    setTimeout(() => { t.className = ''; }, 200);
  }, 3000);
}

// ── Count-up animation for KPI numbers ──
function animateCount(el, targetStr, color) {
  if (!el) return;
  // Extract numeric value for animation
  const isNum = /^[\d,\.]+$/.test(targetStr.replace(/\s/g,''));
  if (!isNum) { el.textContent = targetStr; if(color) el.style.color=color; return; }
  const target = parseFloat(targetStr.replace(/,/g,'')) || 0;
  const duration = 600;
  const start = performance.now();
  const startVal = parseFloat(el.textContent?.replace(/,/g,'')) || 0;
  // Kick off animation
  el.style.transition = 'color .3s';
  if(color) el.style.color = color;
  function step(now) {
    const p = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3); // ease-out-cubic
    const cur = startVal + (target - startVal) * ease;
    // Format same as target
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

// ── Skeleton loading ──
function setLoading(id, msg='جاري التحميل...') {
  el(id).innerHTML = `
    <div style="padding:16px">
      <div class="skeleton" style="height:38px;margin-bottom:8px;border-radius:6px"></div>
      <div class="skeleton" style="height:38px;margin-bottom:8px;opacity:.8;border-radius:6px"></div>
      <div class="skeleton" style="height:38px;margin-bottom:8px;opacity:.6;border-radius:6px"></div>
      <div class="skeleton" style="height:38px;opacity:.4;border-radius:6px"></div>
    </div>`;
}

// ── Smooth view transition ──
function switchView(showId, title, sub='') {
  const current = document.querySelector('.content-area > div[id$="View"]:not([style*="display: none"]):not([style*="display:none"])');
  if (current && current.id !== showId) {
    current.style.opacity = '0';
    current.style.transform = 'translateY(6px)';
    current.style.transition = 'opacity .15s, transform .15s';
    setTimeout(() => {
      current.style.display = 'none';
      current.style.opacity = '';
      current.style.transform = '';
      current.style.transition = '';
    }, 150);
  }
  const next = el(showId);
  if (next) {
    next.style.display = 'block';
    next.style.opacity = '0';
    next.style.transform = 'translateY(10px)';
    next.style.transition = 'none';
    void next.offsetWidth;
    next.style.transition = 'opacity .25s ease, transform .25s ease';
    next.style.opacity = '1';
    next.style.transform = 'translateY(0)';
    setTimeout(() => {
      next.style.transition = '';
      next.style.opacity = '';
      next.style.transform = '';
    }, 300);
  }
  if(title) el('topBarTitle').textContent = title;
  if(sub)   el('topBarSub').textContent   = sub;
}

// ════════════════════════════════════════
// JOURNAL (صفحة اليومية)
// ════════════════════════════════════════
const journalState = {
  period: 'today',
  entries: [],
};

function showJournal() {
  sessionStorage.setItem('tm_last_view','journal');
  hideAllViews();
  el('journalView').style.display  = 'block';
  el('topBarTitle').textContent    = 'صفحة اليومية';
  el('topBarSub').textContent      = `نظام ${state.system}`;
  navActive('nav-journal');
  state.currentFileNo = null;
  loadJournal();
}

function setJournalPeriod(period) {
  journalState.period = period;
  document.querySelectorAll('.journal-period-btn').forEach(b => b.classList.remove('active'));
  el('jperiod-' + period)?.classList.add('active');
  const customWrap = el('jCustomDateWrap');
  if (period === 'custom') {
    customWrap.style.display = 'flex';
  } else {
    customWrap.style.display = 'none';
    loadJournal();
  }
}

function getJournalDateRange() {
  const pad = n => String(n).padStart(2,'0');
  const toDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  if (journalState.period === 'today') {
    const t = toDate(new Date());
    return { from: t, to: t };
  }
  if (journalState.period === 'week') {
    const now  = new Date();
    const day  = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const sun  = new Date(now); sun.setDate(now.getDate() - day);       // الأحد = بداية الأسبوع
    const sat  = new Date(sun); sat.setDate(sun.getDate() + 6);         // السبت = نهاية الأسبوع
    return { from: toDate(sun), to: toDate(sat) };
  }
  if (journalState.period === 'month') {
    const now  = new Date();
    const from = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`;
    const last = new Date(now.getFullYear(), now.getMonth()+1, 0);
    return { from, to: toDate(last) };
  }
  if (journalState.period === 'custom') {
    return { from: el('jDateFrom').value, to: el('jDateTo').value };
  }
  return { from: toDate(new Date()), to: toDate(new Date()) };
}

async function loadJournal() {
  el('journalTimeline').innerHTML = `<div class="loading"><div class="spinner"></div><br>جاري تحميل اليومية...</div>`;
  el('journalKpis').innerHTML = '';

  const { from, to } = getJournalDateRange();
  if (!from || !to) { el('journalTimeline').innerHTML = `<div class="empty-state"><div class="e-icon">📅</div><p>اختر نطاق تاريخ</p></div>`; return; }

  const toPlus = to + 'T23:59:59';

  try {
    const sys = state.system;

    async function apiGetRange(table, dateCol, from, to, extra={}) {
      // Use end of day for 'to' to include all records on that day
      const toEOD = to + 'T23:59:59';
      let url = `${SB_URL}/rest/v1/${table}?system_type=eq.${encodeURIComponent(sys)}&${dateCol}=gte.${encodeURIComponent(from)}&${dateCol}=lte.${encodeURIComponent(toEOD)}&order=${dateCol}.desc`;
      for (const [k,v] of Object.entries(extra)) url += `&${k}=${encodeURIComponent(v)}`;
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) { console.warn(`apiGetRange ${table} failed:`, res.status); return []; }
      return res.json();
    }

    const [purchases, sales, expenses, payments, payouts, opexItems] = await Promise.all([
      apiGetRange('purchase_orders', 'po_date', from, to),
      apiGetRange('sales',           'sale_date', from, to),
      apiGetRange('expenses',        'exp_date',  from, to),
      apiGetRange('payments',        'pay_date',  from, to),
      apiGetRange('partner_payouts', 'pay_date',  from, to),
      fetchOpexForJournal(from, to, sys),
    ]);

    // Collections — نجيب بالـ due_date والـ paid_date معاً
    const toEOD2 = to + 'T23:59:59';
    const [colByDue, colByPaid] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/collections?system_type=eq.${encodeURIComponent(sys)}&due_date=gte.${encodeURIComponent(from)}&due_date=lte.${encodeURIComponent(toEOD2)}&order=due_date.desc`, { headers: headers() }).then(r=>r.ok?r.json():[]),
      fetch(`${SB_URL}/rest/v1/collections?system_type=eq.${encodeURIComponent(sys)}&paid_date=gte.${encodeURIComponent(from)}&paid_date=lte.${encodeURIComponent(toEOD2)}&order=paid_date.desc`, { headers: headers() }).then(r=>r.ok?r.json():[]),
    ]);
    // دمج بدون تكرار
    const colMap = {};
    [...(colByDue||[]), ...(colByPaid||[])].forEach(c => { colMap[c.id] = c; });
    const collections = Object.values(colMap);

    // Normalize entries
    const entries = [
      ...(purchases||[]).map(r=>({type:'purchase',date:r.po_date||from,amount:+r.total_purchase||0,sign:-1,title:`سند شراء — ${r.supplier||''}`,status:r.post_status||'posted',meta:[r.file_no?`<span style="background:var(--accent-dim);color:var(--accent);padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">${r.file_no}</span>`:'',r.supplier?`مورد: ${r.supplier}`:''].filter(Boolean),fileNo:r.file_no,raw:r})),
      ...(sales||[]).map(r=>({
        type:'sale', date: r.sale_date||r.created_at?.split('T')[0]||from,
        amount: +r.sale_price||0, sign:+1,
        title:`بيع سيارة — ${r.vin||''}`,
        meta:[
          r.customer?`عميل: ${r.customer}`:'',
          `ملف: ${r.file_no||'—'}`,
          r.vin?`شاصي: ${r.vin}`:'',
          r.inv_no||r.invoice_no?`فاتورة: ${r.inv_no||r.invoice_no}`:'',
          r.sale_date?`تاريخ: ${r.sale_date}`:'',
        ],
        fileNo: r.file_no, raw: r,
      })),
      ...(collections||[]).map(r=>({
        type:'collection',
        date: r.due_date||r.paid_date||r.created_at?.split('T')[0]||from,
        amount: +r.amount||0, sign:+1,
        title:`تحصيل — ${r.customer||r.inv_no||''}`,
        meta:[
          r.ref_no?`<span style="background:var(--green-dim);color:var(--green);padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">${r.ref_no}</span>`:'',
          r.customer?`من: ${r.customer}`:'',
          `ملف: ${r.file_no||'—'}`,
          r.inv_no?`فاتورة: ${r.inv_no}`:'',
          r.vin?`شاصي: ${r.vin}`:'',
          r.pay_method?`طريقة: ${r.pay_method}`:'',
          r.paid_date?`تاريخ الدفع: ${r.paid_date}`:r.due_date?`استحقاق: ${r.due_date}`:'',
          r.document?`مستند: ${r.document}`:'',
        ],
        fileNo: r.file_no, raw: r,
      })),
      ...(expenses||[]).map(r=>({
        type:'expense',
        date: r.exp_date||r.expense_date||r.created_at?.split('T')[0]||from,
        amount: +r.amount||0, sign:-1,
        title:`مصروف — ${r.exp_type||r.category||r.description||''}`,
        meta:[
          r.ref_no?`<span style="background:var(--red-dim);color:var(--red);padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">${r.ref_no}</span>`:'',
          r.description?`بيان: ${r.description}`:'',
          `ملف: ${r.file_no||'—'}`,
          r.pay_method?`طريقة: ${r.pay_method}`:'',
          (r.exp_date||r.expense_date)?`تاريخ: ${r.exp_date||r.expense_date}`:'',
        ],
        fileNo: r.file_no, raw: r,
      })),
      ...(payments||[]).map(r=>({
        type:'payment',
        date: r.pay_date||r.created_at?.split('T')[0]||from,
        amount: +r.amount||0, sign:-1,
        title:`دفعة للمورد — ${r.payer||''}`,
        meta:[
          r.ref_no?`<span style="background:var(--cyan-dim);color:var(--cyan);padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">${r.ref_no}</span>`:'',
          `ملف: ${r.file_no||'—'}`,
          r.pay_method?`طريقة: ${r.pay_method}`:'',
          r.pay_date?`تاريخ: ${r.pay_date}`:'',
          r.document?`مستند: ${r.document}`:'',
          r.notes?`ملاحظة: ${r.notes}`:'',
        ],
        fileNo: r.file_no, raw: r,
      })),
      ...(payouts||[]).map(r=>({
        type:'payout',
        date: r.pay_date||r.created_at?.split('T')[0]||from,
        amount: +r.amount||0, sign:-1,
        title:`صرف لشريك — ${r.partner||''}`,
        meta:[
          r.pay_id?`<span style="background:var(--purple-dim);color:var(--purple);padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">${r.pay_id}</span>`:'',
          `ملف: ${r.file_no||'—'}`,
          r.payout_type?`نوع: ${r.payout_type}`:'',
          r.pay_method?`طريقة: ${r.pay_method}`:'',
          r.pay_date?`تاريخ: ${r.pay_date}`:'',
          r.notes?`ملاحظة: ${r.notes}`:'',
        ],
        fileNo: r.file_no, raw: r,
      })),
      ...(opexItems||[]).map(r=>({
        type:'opex',
        date: r.exp_date||r.created_at?.split('T')[0]||from,
        amount: +r.amount||0, sign:-1,
        title:`مصروف تشغيلي — ${r.exp_type||''}: ${r.description||''}`,
        meta:[
          r.ref_no?`<span style="background:var(--purple-dim);color:var(--purple);padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">${r.ref_no}</span>`:'',
          r.beneficiary?`جهة: ${r.beneficiary}`:'',
          r.pay_method?`طريقة: ${r.pay_method}`:'',
          r.exp_date?`تاريخ: ${r.exp_date}`:'',
          r.document?`مستند: ${r.document}`:'',
          r.notes?`ملاحظة: ${r.notes}`:'',
        ],
        fileNo: null, raw: r,
      })),
    ];

    entries.sort((a,b) => (b.date||'').localeCompare(a.date||''));
    journalState.entries = entries;
    renderJournalKpis(entries);
    renderJournalEntries();
    loadJournalDrafts();
  } catch(e) {
    el('journalTimeline').innerHTML = errHTML('خطأ في تحميل اليومية: ' + e.message);
  }
}

function renderJournalKpis(entries) {
  const groups = {
    purchase:   entries.filter(e=>e.type==='purchase'),
    sale:       entries.filter(e=>e.type==='sale'),
    expenses:   entries.filter(e=>e.type==='expense'||e.type==='opex'),
    collection: entries.filter(e=>e.type==='collection'),
    payment:    entries.filter(e=>e.type==='payment'),
    payout:     entries.filter(e=>e.type==='payout'),
  };
  const totals = {
    purchase:   groups.purchase.reduce((s,e)=>s+e.amount,0),
    sale:       groups.sale.reduce((s,e)=>s+e.amount,0),
    expenses:   groups.expenses.reduce((s,e)=>s+e.amount,0),
    collection: groups.collection.reduce((s,e)=>s+e.amount,0),
    payment:    groups.payment.reduce((s,e)=>s+e.amount,0),
    payout:     groups.payout.reduce((s,e)=>s+e.amount,0),
  };
  const config = [
    { key:'purchase', label:'مشتريات',    icon:'📋', color:'var(--accent)', filterVal:'purchase'   },
    { key:'sale',     label:'مبيعات',      icon:'🧾', color:'var(--green)',  filterVal:'sale'       },
    { key:'expenses', label:'مصاريف',      icon:'💸', color:'var(--red)',    filterVal:'expense'    },
    { key:'collection', label:'تحصيلات',  icon:'💰', color:'var(--blue)',   filterVal:'collection' },
    { key:'payment',  label:'دفعات مورد', icon:'💳', color:'var(--cyan)',   filterVal:'payment'    },
    { key:'payout',   label:'صرف شركاء',  icon:'👥', color:'var(--purple)', filterVal:'payout'     },
  ];

  el('journalKpis').innerHTML = config.map(c => `
    <div class="j-kpi" id="jkpi-${c.key}"
      onclick="filterJournalByType('${c.filterVal}', '${c.key}')"
      style="cursor:pointer;border-right:3px solid ${c.color};transition:all .15s"
      onmouseover="this.style.background='var(--card2)'"
      onmouseout="this.style.background=''">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div class="j-kpi-label">${c.icon} ${c.label}</div>
        <div style="font-size:10px;color:var(--text2)">${groups[c.key].length} قيد</div>
      </div>
      <div class="j-kpi-val" style="color:${c.color}">${fmt(totals[c.key])}</div>
      <div style="font-size:9px;color:var(--text2);margin-top:3px">اضغط للتفاصيل</div>
    </div>`).join('');

  // Detail panel
  if (!el('jkpi-detail')) {
    const panel = document.createElement('div');
    panel.id = 'jkpi-detail';
    panel.style.cssText = 'display:none;margin-bottom:14px;background:var(--card);border:2px solid var(--accent);border-radius:var(--radius);padding:14px 16px;animation:fadeSlideIn .2s ease';
    el('journalKpis').after(panel);
  }
}

function filterJournalByType(filterVal, key) {
  // Toggle — لو نفس البند اضغطت تاني يغلق
  const panel = el('jkpi-detail');
  const sel   = el('jTypeFilter');

  // Remove active from all
  document.querySelectorAll('[id^="jkpi-"]').forEach(k => {
    k.style.borderWidth = '3px';
    k.style.boxShadow   = '';
  });

  if (panel._activeKey === key) {
    panel.style.display  = 'none';
    panel._activeKey     = null;
    if (sel) { sel.value = 'all'; renderJournalEntries(); }
    return;
  }

  // Set active
  panel._activeKey = key;
  const activeEl = el('jkpi-' + key);
  if (activeEl) { activeEl.style.borderWidth = '3px'; activeEl.style.boxShadow = '0 0 0 2px var(--accent)'; }

  // Filter timeline
  if (sel) {
    sel.value = filterVal;
    renderJournalEntries();
  }

  // Build detail table
  const entries = journalState.entries.filter(e => {
    if (key === 'expenses') return e.type==='expense'||e.type==='opex';
    return e.type === filterVal;
  });

  const configs = {
    sale:       { color:'var(--green)',  title:'🧾 تفاصيل المبيعات' },
    expenses:   { color:'var(--red)',    title:'💸 تفاصيل المصاريف' },
    collection: { color:'var(--blue)',   title:'💰 تفاصيل التحصيلات' },
    payment:    { color:'var(--cyan)',   title:'💳 تفاصيل دفعات المورد' },
    payout:     { color:'var(--purple)', title:'👥 تفاصيل صرف الشركاء' },
  };
  const cfg   = configs[key];
  const total = entries.reduce((s,e)=>s+e.amount,0);

  panel.style.display = 'block';
  panel.style.borderColor = cfg.color;
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700">${cfg.title}</div>
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:13px;font-weight:700;color:${cfg.color};font-family:monospace">${fmt(total)}</span>
        <button onclick="document.getElementById('jkpi-detail').style.display='none';document.getElementById('jkpi-detail')._activeKey=null;document.getElementById('jTypeFilter').value='all';renderJournalEntries()"
          style="background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:'Cairo',sans-serif;color:var(--text)">✕ إغلاق</button>
      </div>
    </div>
    ${entries.length ? `
    <div style="max-height:240px;overflow-y:auto">
      <table class="data-table" style="font-size:12px">
        <thead><tr>
          <th>التاريخ</th><th>البيان</th><th>الملف</th><th>طريقة الدفع</th><th>المبلغ</th>
        </tr></thead>
        <tbody>
          ${entries.map(e => {
            const r = e.raw || {};
            const method = r.pay_method||r.method||'—';
            const fileNo = e.fileNo||r.file_no||'—';
            return `<tr onclick="${fileNo!=='—'?`openViewer('${fileNo}')`:''}" style="cursor:${fileNo!=='—'?'pointer':'default'}">
              <td class="mono">${fmtDate(e.date)}</td>
              <td>${e.title||'—'}</td>
              <td class="mono text-amber">${fileNo}</td>
              <td>${method}</td>
              <td class="mono" style="font-weight:700;color:${cfg.color}">${fmt(e.amount)}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="background:var(--card2);font-weight:700">
            <td colspan="4">الإجمالي — ${entries.length} قيد</td>
            <td class="mono" style="color:${cfg.color}">${fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>` : `<div class="empty-state" style="padding:20px"><div class="e-icon">📭</div><p>لا توجد عمليات</p></div>`}`;
}

function renderJournalEntries() {
  const typeFilter = el('jTypeFilter')?.value || 'all';
  let entries = journalState.entries;
  if (typeFilter !== 'all') entries = entries.filter(e=>e.type===typeFilter);

  if (!entries.length) {
    el('journalTimeline').innerHTML = `<div class="empty-state"><div class="e-icon">📅</div><p>لا توجد عمليات في هذه الفترة</p></div>`;
    return;
  }

  // Group by date
  const groups = {};
  entries.forEach(e => {
    const d = (e.date||'').split('T')[0];
    if (!groups[d]) groups[d] = [];
    groups[d].push(e);
  });

  const typeConfig = {
    purchase:   { icon:'📋', bg:'var(--accent-dim)', label:'سند شراء', amountColor:'var(--accent)' },
    sale:       { icon:'🤝', bg:'var(--green-dim)',   label:'بيع',            amountColor:'var(--green)'  },
    collection: { icon:'💰', bg:'var(--blue-dim)',    label:'تحصيل',          amountColor:'var(--blue)'   },
    expense:    { icon:'💸', bg:'var(--red-dim)',     label:'مصروف',          amountColor:'var(--red)'    },
    payment:    { icon:'💳', bg:'var(--cyan-dim)',    label:'دفعة مورد',      amountColor:'var(--cyan)'   },
    payout:     { icon:'👥', bg:'var(--purple-dim)',  label:'صرف شريك',       amountColor:'var(--purple)' },
    opex:       { icon:'💼', bg:'var(--purple-dim)',  label:'مصروف عام',         amountColor:'var(--purple)' },
  };

  let html = '';
  Object.keys(groups).sort((a,b)=>b.localeCompare(a)).forEach(date => {
    const dayEntries = groups[date];
    const dayIn  = dayEntries.filter(e=>e.sign>0).reduce((s,e)=>s+e.amount,0);
    const dayOut = dayEntries.filter(e=>e.sign<0).reduce((s,e)=>s+e.amount,0);
    const dayNet = dayIn - dayOut;

    html += `<div class="journal-day-group">
      <div class="journal-day-header">
        <span class="journal-day-label">${fmtDate(date)}</span>
        <div class="journal-day-line"></div>
        <span class="journal-day-total" style="color:${dayNet>=0?'var(--green)':'var(--red)'}">
          صافي: ${dayNet>=0?'+':''}${fmt(dayNet)}
        </span>
      </div>`;

    dayEntries.forEach(e => {
      const cfg = typeConfig[e.type] || { icon:'📌', bg:'var(--card2)', label:e.type, amountColor:'var(--text)' };
      const metaFiltered = (e.meta||[]).filter(Boolean).join(' · ');
      const amountSign = e.sign > 0 ? '+' : '-';
      html += `
        <div class="j-entry j-type-${e.type}${e.status==='draft'?' is-draft':''}" style="cursor:pointer"
          onclick="${e.fileNo ? `openViewer('${e.fileNo}')` : ''}">
          <div class="j-entry-icon" style="background:${cfg.bg}">${cfg.icon}</div>
          <div class="j-entry-body">
            <div class="j-entry-title">
              ${e.title}
              ${e.status==='draft'?'<span class="draft-badge" style="margin-right:6px">مسودة</span>':''}
            </div>
            <div class="j-entry-meta">
              <span style="background:var(--card2);padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">${cfg.label}</span>
              ${metaFiltered}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="j-entry-amount" style="color:${cfg.amountColor}">
              ${amountSign}${fmt(e.amount)}
            </div>
            <button onclick="event.stopPropagation();editJournalEntry('${e.type}',null,'${e.fileNo||''}')"
              style="background:none;border:none;cursor:pointer;color:var(--text2);font-size:13px;padding:2px 4px" title="تعديل">✏️</button>
          </div>
        </div>`;
    });

    html += `</div>`;
  });

  el('journalTimeline').innerHTML = html;
}

// ════════════════════════════════════════
// ════════════════════════════════════════
// LEDGER ENGINE — auto-creates entries
// ════════════════════════════════════════
const typeLabels = { customer:'عميل', supplier:'مورد', partner:'شريك', custodian:'عهدة' };


// ════════════════════════════════════════
// REFERENCE NUMBERS & EXPORT HELPERS
// ════════════════════════════════════════

async function genSeqRef(prefix, sys, fileNo, table) {
  const safe = (fileNo || 'GEN').toString().replace(/[^A-Za-z0-9\-]/g,'');
  try {
    const rows = await apiGet(table, { select:'id', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, limit:1000 });
    const next = ((rows && rows.length) || 0) + 1;
    return `${prefix}-${safe}-${String(next).padStart(3,'0')}`;
  } catch(e) {
    return `${prefix}-${safe}-${String(Date.now()).slice(-5)}`;
  }
}

function exportCSV(headers, rows, filename) {
  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v==null?'':v).replace(/"/g,'""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename + '.csv';
  a.click();
}

function printSection(title, subtitle, tableHtml, summaryHtml='') {
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Cairo',Arial,sans-serif;color:#1a1a1a;font-size:12px;background:#fff}
  .page{max-width:900px;margin:0 auto;padding:28px 32px}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a1a1a;padding-bottom:16px;margin-bottom:20px}
  .co-name{font-size:20px;font-weight:900} .co-sub{font-size:11px;color:#888;margin-top:2px}
  .rep-title{text-align:left} .rep-title h1{font-size:22px;font-weight:900}
  .rep-title .sub{font-size:12px;color:#666;margin-top:4px}
  .summary{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
  .s-box{background:#f8f9fa;border-radius:8px;padding:10px 16px;flex:1;min-width:120px}
  .s-box-label{font-size:10px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
  .s-box-val{font-size:16px;font-weight:900;margin-top:3px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  thead tr{background:#1a1a1a;color:#fff}
  thead th{padding:9px 10px;font-size:11px;font-weight:700;text-align:right}
  tbody tr:nth-child(even){background:#fafafa}
  tbody td{padding:8px 10px;border-bottom:1px solid #eee;vertical-align:middle}
  tfoot td{padding:9px 10px;background:#f0f2f5;font-weight:700}
  .footer{text-align:center;padding-top:12px;border-top:1px solid #eee;color:#aaa;font-size:10px;margin-top:12px}
  .no-print{text-align:center;margin-bottom:16px;display:flex;gap:8px;justify-content:center}
  .no-print button{padding:9px 24px;border-radius:8px;font-family:'Cairo',sans-serif;font-size:13px;font-weight:700;cursor:pointer;border:none}
  @media print{.no-print{display:none!important}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style>
</head>
<body><div class="page">
  <div class="no-print">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff">🖨️ طباعة</button>
    <button onclick="window.close()" style="background:#f1f1f1;color:#333;border:1px solid #ddd">✕ إغلاق</button>
  </div>
  <div class="hdr">
    <div><div class="co-name">Transit Cars</div><div class="co-sub">ترانزيت للسيارات · الكويت</div></div>
    <div class="rep-title"><h1>${title}</h1><div class="sub">${subtitle}</div></div>
  </div>
  ${summaryHtml}
  ${tableHtml}
  <div class="footer">تم الإنشاء بتاريخ ${new Date().toLocaleDateString('en-GB')} · Transit Cars System</div>
</div></body></html>`;
  openPrintOverlay(html, title);
}

function exportBtns(csvFn, printFn) {
  return `<div style="display:flex;gap:6px;margin-bottom:10px;justify-content:flex-end">
    <button class="btn btn-sm btn-secondary" onclick="${csvFn}" style="color:var(--green)">⬇️ Excel</button>
    <button class="btn btn-sm btn-secondary" onclick="${printFn}" style="color:var(--blue)">🖨️ PDF</button>
  </div>`;
}


// ════════════════════════════════════════
// CONTACTS VIEW
// ════════════════════════════════════════
const contactsState = { all: [], typeFilter: 'all' };

async function showContacts(type='all') {
  sessionStorage.setItem('tm_last_view','contacts');
  hideAllViews();
  el('contactsView').style.display = 'block';
  el('topBarTitle').textContent = 'جهات الاتصال';
  navActive('nav-contacts');
  contactsState.typeFilter = type;
  await loadContacts();
  // Apply filter after data loads
  filterContacts(type);
}

async function loadContacts() {
  el('contactsGrid').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  try {
    const contacts = await apiGet('contacts', { select:'*', system_type:`eq.${state.system}`, order:'name.asc' });
    const jeEntries = await apiGet('journal_entries', { select:'contact_id,dr_amount,cr_amount', system_type:`eq.${state.system}`, post_status:'eq.posted' });

    // Aggregate balances per contact from journal_entries
    const balMap = {};
    (jeEntries||[]).forEach(e => {
      if (!e.contact_id) return;
      if (!balMap[e.contact_id]) balMap[e.contact_id] = { debit:0, credit:0 };
      balMap[e.contact_id].debit  += +e.dr_amount || 0;
      balMap[e.contact_id].credit += +e.cr_amount || 0;
    });

    contactsState.all = (contacts||[]).map(c => ({
      ...c,
      totalDebit:  (balMap[c.id]?.debit  || 0) + (+c.opening_balance > 0 ? +c.opening_balance : 0),
      totalCredit: (balMap[c.id]?.credit || 0) + (+c.opening_balance < 0 ? Math.abs(+c.opening_balance) : 0),
      balance:     (balMap[c.id]?.debit || 0) - (balMap[c.id]?.credit || 0) + (+c.opening_balance || 0)
    }));

    renderContactsList();
  } catch(e) {
    el('contactsGrid').innerHTML = errHTML('خطأ في تحميل جهات الاتصال: ' + e.message);
  }
}

function filterContacts(type) {
  contactsState.typeFilter = type;
  document.querySelectorAll('[id^="ctype-"]').forEach(b => b.classList.remove('active'));
  el('ctype-' + type)?.classList.add('active');
  renderContactsList();
}

function renderContactsList() {
  const search = (el('contactSearch')?.value || '').toLowerCase();
  let list = contactsState.all;
  if (contactsState.typeFilter !== 'all') list = list.filter(c => c.type === contactsState.typeFilter);
  if (search) list = list.filter(c => c.name.toLowerCase().includes(search));

  if (!list.length) {
    el('contactsGrid').innerHTML = emptyHTML('👤','لا توجد جهات اتصال — أضف جهة جديدة');
    return;
  }

  const typeColors = {
    asset:'var(--blue)', liability:'var(--red)', equity:'var(--purple)',
    revenue:'var(--green)', cogs:'var(--accent)', expense:'var(--red)',
    customer:'var(--blue)', supplier:'var(--accent)', partner:'var(--purple)',
  };
  const typeLabelsAcc = {
    asset:'أصول', liability:'التزامات', equity:'حقوق ملكية',
    revenue:'إيرادات', cogs:'تكلفة مبيعات', expense:'مصروفات', other:'أخرى',
  };
  const typeDims   = { customer:'var(--blue-dim)', supplier:'var(--accent-dim)', partner:'var(--purple-dim)', custodian:'var(--cyan-dim)' };
  const typeIcons  = { customer:'🤝', supplier:'🏭', partner:'👥', custodian:'🗝' };

  const rows = list.map((c,i) => {
    const bal = c.balance;
    const balColor = bal > 0 ? 'var(--green)' : bal < 0 ? 'var(--red)' : 'var(--text3)';
    const balLabel = bal > 0 ? 'له عندك' : bal < 0 ? 'عليك له' : '—';
    const safeName = c.name.replace(/'/g,"\\'");
    return `<tr style="transition:background .12s" onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background=''">
      <td style="padding:11px 14px;font-size:12px;color:var(--text3);width:40px;text-align:center">${i+1}</td>
      <td style="padding:11px 14px;cursor:pointer" onclick="showLedger(${c.id},'${safeName}','${c.type}')">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:32px;height:32px;border-radius:50%;background:${typeDims[c.type]||'var(--card2)'};display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">
            ${typeIcons[c.type]||'👤'}
          </div>
          <div>
            <div style="font-weight:700;font-size:13px">${c.name}</div>
            ${c.phone ? `<div style="font-size:11px;color:var(--text3)">📞 ${c.phone}</div>` : ''}
          </div>
        </div>
      </td>
      <td style="padding:11px 14px">
        <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;background:${typeDims[c.type]||'var(--card2)'};color:${typeColors[c.type]||'var(--text2)'}">
          ${typeLabels[c.type]||c.type}
        </span>
      </td>
      <td style="padding:11px 14px;font-family:var(--mono);font-size:12px;color:var(--green);text-align:left">${fmt(c.totalDebit)}</td>
      <td style="padding:11px 14px;font-family:var(--mono);font-size:12px;color:var(--red);text-align:left">${fmt(c.totalCredit)}</td>
      <td style="padding:11px 14px;text-align:left">
        <div style="font-family:var(--mono);font-size:13px;font-weight:700;color:${balColor}">${bal!==0?fmt(Math.abs(bal)):'—'}</div>
        <div style="font-size:10px;color:${balColor}">${balLabel}</div>
      </td>
      <td style="padding:11px 14px;text-align:center;white-space:nowrap">
        <button onclick="openContactModal(contactsState.all.find(x=>x.id===${c.id}))" title="تعديل"
          style="background:var(--blue-dim);border:1px solid var(--blue);color:var(--blue);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:Cairo,sans-serif;margin-left:4px">✏️</button>
        <button onclick="deleteContact(${c.id},'${safeName}')" title="حذف"
          style="background:var(--red-dim);border:1px solid var(--red);color:var(--red);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:Cairo,sans-serif">🗑</button>
      </td>
    </tr>`;
  }).join('');

  el('contactsGrid').innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--card2);border-bottom:1px solid var(--border)">
            <th style="padding:10px 14px;font-size:11px;color:var(--text3);font-weight:700;text-align:center">#</th>
            <th style="padding:10px 14px;font-size:11px;color:var(--text3);font-weight:700;text-align:right">الاسم</th>
            <th style="padding:10px 14px;font-size:11px;color:var(--text3);font-weight:700;text-align:right">النوع</th>
            <th style="padding:10px 14px;font-size:11px;color:var(--text3);font-weight:700;text-align:left">مدين</th>
            <th style="padding:10px 14px;font-size:11px;color:var(--text3);font-weight:700;text-align:left">دائن</th>
            <th style="padding:10px 14px;font-size:11px;color:var(--text3);font-weight:700;text-align:left">الرصيد</th>
            <th style="padding:10px 14px;font-size:11px;color:var(--text3);font-weight:700;text-align:center">إجراءات</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ════════════════════════════════════════
// CONTACT LEDGER (individual statement)
// ════════════════════════════════════════
async function showLedger(contactId, contactName, contactType) {
  hideAllViews();
  el('ledgerView').style.display = 'block';
  el('topBarTitle').textContent = 'كشف حساب';
  el('ledger-contact-badge').innerHTML = `<span style="color:var(--text2);font-weight:400;font-size:13px">كشف حساب /</span> ${contactName}
    <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:var(--blue-dim);color:var(--blue);margin-right:6px">${typeLabels[contactType]||contactType}</span>`;
  navActive('nav-contacts');
  el('ledgerTable').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';

  // Store globally for renderLedgerTable
  window._ledgerContactId   = contactId;
  window._ledgerContactName = contactName;
  window._ledgerContactType = contactType;

  try {
    const contact = contactsState.all.find(c => c.id === contactId);
    window._ledgerOpening = contact?.opening_balance ? +contact.opening_balance : 0;

    // جيب كل الـ entries من journal_entries
    const jeRaw = await apiGet('journal_entries', {
      select: '*',
      system_type: `eq.${state.system}`,
      contact_id: `eq.${contactId}`,
      post_status: 'eq.posted',
      order: 'entry_date.asc,id.asc'
    });
    // تحويل للشكل القديم عشان باقي الكود يشتغل
    const entries = (jeRaw||[]).map(e => ({
      ...e,
      entry_date:   e.entry_date,
      description:  e.description,
      debit:        +e.dr_amount || 0,
      credit:       +e.cr_amount || 0,
      source_table: e.ref_table,
      file_no:      e.file_no,
    }));
    window._ledgerAllEntries = entries || [];

    // جيب السيارات عشان نضيف VINs في بيان الشراء
    const vehicles = await apiGet('vehicles', {
      select: 'file_no,vin,model,vehicle_type',
      system_type: `eq.${state.system}`
    });
    // بني map: file_no => list of vins
    window._ledgerVehicleMap = {};
    (vehicles||[]).forEach(v => {
      if (!window._ledgerVehicleMap[v.file_no]) window._ledgerVehicleMap[v.file_no] = [];
      window._ledgerVehicleMap[v.file_no].push(v);
    });

    // بني فلتر الملفات
    const fileNos = [...new Set((entries||[]).map(e=>e.file_no).filter(Boolean))].sort();
    const sel = el('ledger-file-filter');
    sel.innerHTML = '<option value="">كل الصفقات</option>' +
      fileNos.map(f=>`<option value="${f}">${f}</option>`).join('');

    el('ledgerView').dataset.contactName = contactName;
    renderLedgerTable();

  } catch(e) {
    el('ledgerTable').innerHTML = errHTML('خطأ: ' + e.message);
  }
}

function renderLedgerTable() {
  const fileFilter = el('ledger-file-filter')?.value || '';
  const allEntries = window._ledgerAllEntries || [];
  const vehicleMap = window._ledgerVehicleMap || {};
  const contact    = contactsState.all.find(c => c.id === window._ledgerContactId);

  let list = fileFilter ? allEntries.filter(e => e.file_no === fileFilter) : allEntries;
  let running = !fileFilter && window._ledgerOpening ? window._ledgerOpening : 0;

  const totalDebit  = list.reduce((s,e) => s + (+e.debit||0), 0) + (running > 0 ? running : 0);
  const totalCredit = list.reduce((s,e) => s + (+e.credit||0), 0) + (running < 0 ? Math.abs(running) : 0);
  const finalBal    = running + list.reduce((s,e) => s + (+e.debit||0) - (+e.credit||0), 0);

  el('ledgerKpis').innerHTML = `
    <div class="j-kpi"><div class="j-kpi-label">مجموع المدين</div><div class="j-kpi-val text-green">${fmt(totalDebit)}</div></div>
    <div class="j-kpi"><div class="j-kpi-label">مجموع الدائن</div><div class="j-kpi-val text-red">${fmt(totalCredit)}</div></div>
    <div class="j-kpi"><div class="j-kpi-label">الرصيد الحالي</div><div class="j-kpi-val" style="color:${finalBal>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(finalBal))} ${finalBal>=0?'مدين':'دائن'}</div></div>
    <div class="j-kpi"><div class="j-kpi-label">عدد الحركات</div><div class="j-kpi-val">${list.length}</div></div>`;

  if (!list.length && !running) {
    el('ledgerTable').innerHTML = emptyHTML('📋', 'لا توجد حركات بعد');
    return;
  }

  let rows = '';
  if (running !== 0) {
    rows += `<tr style="background:var(--card2)">
      <td><span class="mono text-muted">—</span></td>
      <td colspan="2"><strong>رصيد افتتاحي</strong></td>
      <td class="mono ${running>0?'text-green':'text-red'}">${running>0?fmt(running):'—'}</td>
      <td class="mono ${running<0?'text-red':'text-green'}">${running<0?fmt(Math.abs(running)):'—'}</td>
      <td class="mono" style="color:${running>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(running))}</td>
    </tr>`;
  }

  list.forEach(e => {
    running += (+e.debit||0) - (+e.credit||0);

    // بني البيان — لو كان شراء أضف تفاصيل السيارات
    let desc = e.description || '—';
    if (e.source_table === 'purchase_orders' && e.file_no && vehicleMap[e.file_no]) {
      const vList = vehicleMap[e.file_no];
      const count = vList.length;
      const vins  = vList.map(v => v.vin || (v.model||v.vehicle_type||'سيارة')).filter(Boolean);
      const vinStr = vins.length <= 4
        ? vins.join(' · ')
        : vins.slice(0,4).join(' · ') + ` ... (+${vins.length-4})`;
      desc = `${desc}<div style="font-size:11px;color:var(--text2);margin-top:3px">
        ${count} سيارة — ${vinStr}
      </div>`;
    }

    rows += `<tr onclick="${e.file_no?`openViewer('${e.file_no}')`:''}" style="${e.file_no?'cursor:pointer':''}">
      <td class="mono text-muted">${fmtDate(e.entry_date)}</td>
      <td>${desc}</td>
      <td><span class="mono text-muted" style="font-size:11px">${e.file_no||'—'}</span></td>
      <td class="mono text-green">${+e.debit?fmt(e.debit):'—'}</td>
      <td class="mono text-red">${+e.credit?fmt(e.credit):'—'}</td>
      <td class="mono" style="color:${running>=0?'var(--green)':'var(--red)'};font-weight:700">${fmt(Math.abs(running))}</td>
    </tr>`;
  });

  el('ledgerTable').innerHTML = `<table class="data-table">
    <thead><tr>
      <th>التاريخ</th><th>البيان</th><th>الملف</th>
      <th style="color:var(--green)">مدين</th>
      <th style="color:var(--red)">دائن</th>
      <th>الرصيد</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot style="background:var(--card2)"><tr>
      <td colspan="3" style="font-weight:700;padding:10px 16px">الإجمالي ${fileFilter?'— '+fileFilter:''}</td>
      <td class="mono text-green" style="padding:10px 16px;font-weight:700">${fmt(totalDebit)}</td>
      <td class="mono text-red" style="padding:10px 16px;font-weight:700">${fmt(totalCredit)}</td>
      <td class="mono" style="padding:10px 16px;font-weight:700;color:${finalBal>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(finalBal))}</td>
    </tr></tfoot>
  </table>`;

  el('ledgerView').dataset.entries = JSON.stringify(list);
}

function exportLedgerCSV() {
  const name = el('ledgerView').dataset.contactName || 'ledger';
  const entries = JSON.parse(el('ledgerView').dataset.entries || '[]');
  const rows = [['التاريخ','البيان','الملف','مدين','دائن']];
  entries.forEach(e => rows.push([e.entry_date, e.description, e.file_no||'', e.debit||0, e.credit||0]));
  downloadCSV(rows, `كشف_${name}.csv`);
}

function printLedgerStatement() {
  const contactName = window._ledgerContactName || '—';
  const contactType = window._ledgerContactType || '';
  const allEntries  = window._ledgerAllEntries  || [];
  const vehicleMap  = window._ledgerVehicleMap  || {};
  const fileFilter  = el('ledger-file-filter')?.value || '';
  const opening     = !fileFilter ? (window._ledgerOpening || 0) : 0;
  const fmt2        = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:2});

  const typeLabelsP = { customer:'عميل', supplier:'مورد', partner:'شريك', custodian:'عهدة' };
  const typeColors  = { customer:'#2563eb', supplier:'#e6930a', partner:'#7c3aed', custodian:'#0891b2' };
  const color = typeColors[contactType] || '#1a1a1a';

  let list = fileFilter ? allEntries.filter(e => e.file_no === fileFilter) : allEntries;
  let running = opening;

  const totalDebit  = list.reduce((s,e)=>s+(+e.debit||0),0)  + (opening>0?opening:0);
  const totalCredit = list.reduce((s,e)=>s+(+e.credit||0),0) + (opening<0?Math.abs(opening):0);
  const finalBal    = opening + list.reduce((s,e)=>s+(+e.debit||0)-(+e.credit||0),0);

  let rows = '';
  if (opening !== 0) {
    rows += `<tr style="background:#f8f9fa;font-weight:700">
      <td>—</td><td colspan="2">رصيد افتتاحي</td>
      <td style="color:#16a34a;text-align:left">${opening>0?fmt2(opening):'—'}</td>
      <td style="color:#dc2626;text-align:left">${opening<0?fmt2(Math.abs(opening)):'—'}</td>
      <td style="text-align:left;font-weight:700">${fmt2(Math.abs(opening))}</td>
    </tr>`;
  }

  list.forEach(e => {
    running += (+e.debit||0) - (+e.credit||0);
    // Enrich description with VINs
    let desc = (e.description||'—').replace(/<[^>]+>/g,''); // strip html tags for print
    if (e.source_table === 'purchase_orders' && e.file_no && vehicleMap[e.file_no]) {
      const vins = vehicleMap[e.file_no].map(v=>v.vin).filter(Boolean);
      if (vins.length) desc += `\n شواصي: ${vins.join(' · ')}`;
    }
    const rowBg = running < 0 ? '#fff5f5' : '';
    rows += `<tr style="background:${rowBg}">
      <td style="white-space:nowrap">${e.entry_date||'—'}</td>
      <td style="font-size:11px;line-height:1.6;white-space:pre-line">${desc}</td>
      <td style="font-family:monospace;font-size:11px;color:#666">${e.file_no||'—'}</td>
      <td style="color:#16a34a;text-align:left;font-weight:600">${+e.debit?fmt2(e.debit):'—'}</td>
      <td style="color:#dc2626;text-align:left;font-weight:600">${+e.credit?fmt2(e.credit):'—'}</td>
      <td style="text-align:left;font-weight:700;color:${running>=0?'#16a34a':'#dc2626'}">${fmt2(Math.abs(running))}</td>
    </tr>`;
  });

  const printDate = new Date().toLocaleDateString('en-GB');
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>كشف حساب — ${contactName}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Cairo',Arial,sans-serif;color:#1a1a1a;background:#fff;font-size:12px}
  .page{max-width:960px;margin:0 auto;padding:28px 32px}
  .no-print{text-align:center;margin-bottom:16px;display:flex;gap:8px;justify-content:center}
  .no-print button{padding:9px 24px;border-radius:8px;font-family:'Cairo',sans-serif;font-size:13px;font-weight:700;cursor:pointer;border:none}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a1a1a;padding-bottom:16px;margin-bottom:20px}
  .co{font-size:18px;font-weight:900}.co-sub{font-size:11px;color:#888;margin-top:2px}
  .title-area h1{font-size:22px;font-weight:900;text-align:left}
  .contact-badge{display:inline-block;background:${color};color:#fff;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-top:6px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
  .kpi{background:#f8f9fa;border-radius:8px;padding:10px 14px;border-right:3px solid ${color}}
  .kpi-label{font-size:10px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
  .kpi-val{font-size:15px;font-weight:900;margin-top:3px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:11px}
  thead tr{background:#1a1a1a;color:#fff}
  thead th{padding:8px 10px;text-align:right;font-weight:700}
  tbody tr{border-bottom:1px solid #eee}
  tbody tr:nth-child(even){background:#fafafa}
  tbody td{padding:7px 10px;vertical-align:top}
  tfoot td{padding:9px 10px;background:#f0f2f5;font-weight:700}
  .footer{text-align:center;padding-top:12px;border-top:1px solid #eee;color:#aaa;font-size:10px;margin-top:16px}
  .sig-row{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:28px}
  .sig-box{text-align:center;padding-top:40px;border-top:1px solid #ccc;font-size:11px;color:#888}
  @media print{
    .no-print{display:none!important}
    body{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    .page{padding:14px}
  }
</style>
</head>
<body><div class="page">

  <div class="no-print">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff">🖨️ طباعة</button>
    <button onclick="window.close()" style="background:#f1f1f1;color:#333;border:1px solid #ddd">✕ إغلاق</button>
  </div>

  <div class="hdr">
    <div>
      <div class="co">Transit Cars</div>
      <div class="co-sub">ترانزيت للسيارات · الكويت</div>
      <div class="co-sub" style="margin-top:4px">تاريخ الطباعة: ${printDate}</div>
    </div>
    <div class="title-area">
      <h1>كشف حساب</h1>
      <div class="contact-badge">${typeLabelsP[contactType]||contactType}</div>
      <div style="font-size:18px;font-weight:900;text-align:left;margin-top:6px">${contactName}</div>
      ${fileFilter?`<div style="font-size:12px;color:#666;text-align:left;margin-top:2px">ملف: ${fileFilter}</div>`:''}
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="kpi-label">إجمالي المدين</div><div class="kpi-val" style="color:#16a34a">${fmt2(totalDebit)}</div></div>
    <div class="kpi"><div class="kpi-label">إجمالي الدائن</div><div class="kpi-val" style="color:#dc2626">${fmt2(totalCredit)}</div></div>
    <div class="kpi"><div class="kpi-label">الرصيد الحالي</div><div class="kpi-val" style="color:${finalBal>=0?'#16a34a':'#dc2626'}">${fmt2(Math.abs(finalBal))} ${finalBal>=0?'مدين':'دائن'}</div></div>
    <div class="kpi"><div class="kpi-label">عدد الحركات</div><div class="kpi-val">${list.length}</div></div>
  </div>

  <table>
    <thead><tr>
      <th>التاريخ</th><th>البيان</th><th>الملف</th>
      <th style="text-align:left">مدين</th>
      <th style="text-align:left">دائن</th>
      <th style="text-align:left">الرصيد</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="3">الإجمالي</td>
      <td style="color:#16a34a;text-align:left">${fmt2(totalDebit)}</td>
      <td style="color:#dc2626;text-align:left">${fmt2(totalCredit)}</td>
      <td style="color:${finalBal>=0?'#16a34a':'#dc2626'};text-align:left">${fmt2(Math.abs(finalBal))} ${finalBal>=0?'مدين':'دائن'}</td>
    </tr></tfoot>
  </table>

  <div class="sig-row">
    <div class="sig-box">توقيع المحاسب</div>
    <div class="sig-box">توقيع المدير</div>
  </div>

  <div class="footer">Transit Cars System · تم الإنشاء بتاريخ ${printDate}</div>

</div></body></html>`;

  openPrintOverlay(html);

}

// ════════════════════════════════════════
// TRIAL BALANCE
// ════════════════════════════════════════
const trialState = { data: [], typeFilter: 'all' };

async function showTrialBalance() {
  hideAllViews();
  el('trialView').style.display = 'block';
  el('topBarTitle').textContent = 'تريال بالانس';
  navActive('nav-trial');
  await loadTrialBalance();
}

async function loadTrialBalance() {
  el('trialTable').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري الحساب...</div>';
  try {
    // جيب القيود من journal_entries مجمّعة بالحساب
    const jeEntries = await apiGet('journal_entries', {
      select: 'account_code,account_name,dr_amount,cr_amount',
      system_type: `eq.${state.system}`,
      post_status: 'eq.posted',
    });

    // جمّع Dr/Cr لكل حساب
    const accMap = {};
    (jeEntries||[]).forEach(e => {
      const code = e.account_code || 'unknown';
      const name = e.account_name || code;
      if (!accMap[code]) accMap[code] = { code, name, dr:0, cr:0 };
      accMap[code].dr += +e.dr_amount || 0;
      accMap[code].cr += +e.cr_amount || 0;
    });

    // حوّل لمصفوفة وأضف الرصيد
    trialState.data = Object.values(accMap).map(a => ({
      id:          a.code,
      name:        getAccountName(a.code) || a.name,
      type:        getAccountTypeCOA(a.code),
      totalDebit:  a.dr,
      totalCredit: a.cr,
      balance:     a.dr - a.cr,
    })).sort((a,b) => a.id.localeCompare(b.id));

    filterTrial(trialState.typeFilter);
  } catch(e) {
    el('trialTable').innerHTML = errHTML('خطأ: ' + e.message);
  }
}

// تحديد نوع الحساب من الكود
function getAccountType(code) {
  if (!code) return 'other';
  const c = String(code);
  if (c.startsWith('1')) return 'asset';
  if (c.startsWith('2')) return 'liability';
  if (c.startsWith('3')) return 'equity';
  if (c.startsWith('4')) return 'revenue';
  if (c.startsWith('5')) return 'cogs';
  if (c.startsWith('6')) return 'expense';
  return 'other';
}

function filterTrial(type) {
  trialState.typeFilter = type;
  document.querySelectorAll('[id^="ttype-"]').forEach(b => b.classList.remove('active'));
  el('ttype-' + type)?.classList.add('active');
  renderTrialBalance();
}

function renderTrialBalance() {
  let list = trialState.data;
  if (trialState.typeFilter && trialState.typeFilter !== 'all') {
    list = list.filter(c => c.type === trialState.typeFilter);
  }

  const sumDebit  = list.reduce((s,c) => s + c.totalDebit, 0);
  const sumCredit = list.reduce((s,c) => s + c.totalCredit, 0);
  const sumBal    = list.reduce((s,c) => s + c.balance, 0);

  el('trialKpis').innerHTML = `
    <div class="j-kpi"><div class="j-kpi-label">إجمالي المدين</div><div class="j-kpi-val text-green">${fmt(sumDebit)}</div></div>
    <div class="j-kpi"><div class="j-kpi-label">إجمالي الدائن</div><div class="j-kpi-val text-red">${fmt(sumCredit)}</div></div>
    <div class="j-kpi"><div class="j-kpi-label">صافي المركز</div><div class="j-kpi-val" style="color:${sumBal>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(sumBal))} ${sumBal>=0?'↑':'↓'}</div></div>`;

  if (!list.length) { el('trialTable').innerHTML = emptyHTML('⚖️','لا توجد بيانات'); return; }

  const typeColors = {
    asset:'var(--blue)', liability:'var(--red)', equity:'var(--purple)',
    revenue:'var(--green)', cogs:'var(--accent)', expense:'var(--red)',
    customer:'var(--blue)', supplier:'var(--accent)', partner:'var(--purple)',
  };
  const typeLabelsAcc = {
    asset:'أصول', liability:'التزامات', equity:'حقوق ملكية',
    revenue:'إيرادات', cogs:'تكلفة مبيعات', expense:'مصروفات', other:'أخرى',
  };
  const rows = list.map(c => `
    <tr onclick="showLedger(${c.id},'${c.name.replace(/'/g,"\'")}','${c.type}')" style="cursor:pointer">
      <td>
        <div style="font-weight:600">${c.name}</div>
      </td>
      <td><span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:var(--card2);color:${typeColors[c.type]||'var(--text2)'}">${typeLabels[c.type]||c.type}</span></td>
      <td class="mono text-green">${fmt(c.totalDebit)}</td>
      <td class="mono text-red">${fmt(c.totalCredit)}</td>
      <td class="mono" style="font-weight:700;color:${c.balance>0?'var(--green)':c.balance<0?'var(--red)':'var(--text2)'}">
        ${fmt(Math.abs(c.balance))} <span style="font-size:10px">${c.balance>0?'مدين':c.balance<0?'دائن':'صفر'}</span>
      </td>
    </tr>`).join('');

  el('trialTable').innerHTML = `<table class="data-table">
    <thead><tr>
      <th>الاسم</th><th>النوع</th>
      <th style="color:var(--green)">مدين</th>
      <th style="color:var(--red)">دائن</th>
      <th>الرصيد</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot style="background:var(--card2)"><tr>
      <td colspan="2" style="font-weight:700;padding:10px 16px">الإجمالي (${list.length} جهة)</td>
      <td class="mono text-green" style="padding:10px 16px;font-weight:700">${fmt(sumDebit)}</td>
      <td class="mono text-red" style="padding:10px 16px;font-weight:700">${fmt(sumCredit)}</td>
      <td class="mono" style="padding:10px 16px;font-weight:700;color:${sumBal>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(sumBal))}</td>
    </tr></tfoot>
  </table>`;
}

async function showAccountMovements(accountCode, accountName) {
  // Open a quick modal showing all journal entries for this account
  const entries = await apiGet('journal_entries', {
    select: '*',
    system_type: `eq.${state.system}`,
    account_code: `eq.${accountCode}`,
    post_status: 'eq.posted',
    order: 'entry_date.asc,id.asc',
  });

  let running = 0;
  const rows = (entries||[]).map(e => {
    running += (+e.dr_amount||0) - (+e.cr_amount||0);
    return `<tr>
      <td class="mono">${e.entry_date||'—'}</td>
      <td class="mono" style="font-size:11px;color:var(--text2)">${e.entry_no||'—'}</td>
      <td>${e.description||'—'}</td>
      <td>${e.file_no||'—'}</td>
      <td class="mono text-green">${+e.dr_amount>0 ? fmt(e.dr_amount) : '—'}</td>
      <td class="mono text-red">${+e.cr_amount>0 ? fmt(e.cr_amount) : '—'}</td>
      <td class="mono" style="font-weight:700;color:${running>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(running))}</td>
    </tr>`;
  }).join('');

  const totalDr = (entries||[]).reduce((s,e)=>s+(+e.dr_amount||0),0);
  const totalCr = (entries||[]).reduce((s,e)=>s+(+e.cr_amount||0),0);

  const html = `
    <div style="font-size:13px;font-weight:700;margin-bottom:12px">
      حركات حساب: ${accountCode} — ${accountName}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">
      <div class="j-kpi"><div class="j-kpi-label">إجمالي المدين</div><div class="j-kpi-val text-green">${fmt(totalDr)}</div></div>
      <div class="j-kpi"><div class="j-kpi-label">إجمالي الدائن</div><div class="j-kpi-val text-red">${fmt(totalCr)}</div></div>
      <div class="j-kpi"><div class="j-kpi-label">الرصيد</div><div class="j-kpi-val" style="color:${(totalDr-totalCr)>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(totalDr-totalCr))}</div></div>
    </div>
    ${entries?.length ? `<div style="overflow-x:auto"><table class="data-table">
      <thead><tr>
        <th>التاريخ</th><th>رقم القيد</th><th>البيان</th><th>الملف</th>
        <th style="color:var(--green)">مدين</th>
        <th style="color:var(--red)">دائن</th>
        <th>الرصيد</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>` : emptyHTML('📒','لا توجد حركات لهذا الحساب')}`;

  // Show in a simple overlay
  let overlay = el('accountMovementsOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'accountMovementsOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.onclick = e => { if(e.target===overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="background:var(--card);border-radius:var(--radius);padding:20px;max-width:800px;width:100%;max-height:80vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-weight:700">دفتر الأستاذ — ${accountCode}</span>
        <button onclick="el('accountMovementsOverlay').remove()" style="background:none;border:1px solid var(--border);padding:4px 10px;border-radius:6px;cursor:pointer;font-family:'Cairo',sans-serif">✕ إغلاق</button>
      </div>
      ${html}
    </div>`;
  overlay.style.display = 'flex';
}

function exportTrialCSV() {
  const rows = [['الاسم','النوع','مدين','دائن','الرصيد']];
  trialState.data.forEach(c => rows.push([c.name, typeLabels[c.type]||c.type, c.totalDebit, c.totalCredit, c.balance]));
  downloadCSV(rows, 'تريال_بالانس.csv');
}

function downloadCSV(rows, filename) {
  const bom = '\uFEFF';
  const csv = bom + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
}

// ════════════════════════════════════════
// CONTACT MODAL (add/edit)
// ════════════════════════════════════════
function openContactModal(contact = null) {
  el('contactModalTitle').textContent = contact ? 'تعديل جهة الاتصال' : 'جهة اتصال جديدة';
  el('cm-name').value    = contact?.name    || '';
  el('cm-type').value    = contact?.type    || 'customer';
  el('cm-phone').value   = contact?.phone   || '';
  el('cm-email').value   = contact?.email   || '';
  el('cm-opening').value = contact?.opening_balance || '';
  el('cm-notes').value   = contact?.notes   || '';
  el('cmError').style.display = 'none';
  el('contactModal').dataset.editId = contact?.id || '';
  openModal('contactModal');
}

async function submitContact() {
  const name    = el('cm-name').value.trim();
  const type    = el('cm-type').value;
  const phone   = el('cm-phone').value.trim();
  const email   = el('cm-email').value.trim();
  const opening = parseFloat(el('cm-opening').value) || 0;
  const notes   = el('cm-notes').value.trim();

  if (!name) { showFieldErr('cmError','يرجى إدخال الاسم'); return; }

  const btn = el('cmSubmitBtn');
  btn.disabled = true; btn.textContent = 'جاري الحفظ...';
  try {
    const data = { system_type:state.system, name, type, phone:phone||null, email:email||null, opening_balance:opening, notes:notes||null };
    const editId = el('contactModal').dataset.editId;
    if (editId) {
      await apiPatch('contacts', { id:`eq.${editId}` }, data);
    } else {
      await apiPost('contacts', data);
    }
    Object.keys(_acCache).forEach(k => { if(k.startsWith(state.system)) delete _acCache[k]; });
    closeModal('contactModal');
    toast('✅ تم حفظ جهة الاتصال','ok');
    await loadContacts();
  } catch(e) { showFieldErr('cmError','خطأ: '+e.message); }
  btn.disabled = false; btn.textContent = '💾 حفظ';
}

async function deleteContact(id, name) {
  showConfirm(`حذف ${name}`, 'سيتم حذف جهة الاتصال نهائياً. هذا الإجراء لا يمكن التراجع عنه.', async () => {
    try {
      await apiDelete('contacts', { id:`eq.${id}` });
      Object.keys(_acCache).forEach(k => delete _acCache[k]);
      toast('✅ تم الحذف','ok');
      await loadContacts();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

// ════════════════════════════════════════
// hideAllViews helper
// ════════════════════════════════════════
function hideAllViews() {
  ['dashboardView','viewerView','journalView','contactsView','ledgerView','trialView','allSalesView','allCollectionsView','reportsView','vehiclesReportView','activityView','settingsView','opexView','approvalView','transactionsView']
    .forEach(id => {
      const e = el(id);
      if (e) {
        e.style.display = 'none';
        e.style.opacity = '';
        e.style.transform = '';
        e.style.transition = '';
      }
    });
}

// ════════════════════════════════════════
// ════════════════════════════════════════
// CONTACT AUTOCOMPLETE
// ════════════════════════════════════════
let _acTimer;
const _acCache = {};

async function getContactsByType(type) {
  const key = state.system + ':' + type;
  if (_acCache[key] && (Date.now() - _acCache[key].ts < 30000)) return _acCache[key].data;
  try {
    const typeParam = type === 'all' ? undefined : type;
    const params = { select:'id,name,type', system_type:`eq.${state.system}`, order:'name.asc' };
    if (typeParam) params.type = `eq.${typeParam}`;
    const data = await apiGet('contacts', params);
    _acCache[key] = { data: data||[], ts: Date.now() };
    return data || [];
  } catch(e) { return []; }
}

function contactAutocomplete(input, type) {
  clearTimeout(_acTimer);
  const q = input.value.trim();
  removeAcList(input);
  if (!q || q.length < 1) return;
  _acTimer = setTimeout(async () => {
    const contacts = await getContactsByType(type === 'any' ? 'all' : type);
    const matches = contacts.filter(c => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
    if (!matches.length) return;
    showAcList(input, matches, type);
  }, 250);
}

function showAcList(input, items, type) {
  removeAcList(input);
  const typeColors = {
    asset:'var(--blue)', liability:'var(--red)', equity:'var(--purple)',
    revenue:'var(--green)', cogs:'var(--accent)', expense:'var(--red)',
    customer:'var(--blue)', supplier:'var(--accent)', partner:'var(--purple)',
  };
  const typeLabelsAcc = {
    asset:'أصول', liability:'التزامات', equity:'حقوق ملكية',
    revenue:'إيرادات', cogs:'تكلفة مبيعات', expense:'مصروفات', other:'أخرى',
  };
  const typeDims   = { customer:'var(--blue-dim)', supplier:'var(--accent-dim)', partner:'var(--purple-dim)', custodian:'var(--cyan-dim)' };

  // Wrap input if not already wrapped
  let wrap = input.parentElement;
  if (!wrap.classList.contains('ac-wrap')) {
    wrap = document.createElement('div');
    wrap.className = 'ac-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
  }

  const list = document.createElement('div');
  list.className = 'ac-list';
  list.id = 'ac-list-' + input.id;

  items.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = 'ac-item' + (i === 0 ? ' ac-active' : '');
    item.innerHTML = `<span class="ac-item-name">${c.name}</span>
      <span class="ac-item-type" style="background:${typeDims[c.type]||'var(--card2)'};color:${typeColors[c.type]||'var(--text2)'}">${typeLabels[c.type]||c.type}</span>`;
    item.onmousedown = (e) => {
      e.preventDefault();
      input.value = c.name;
      removeAcList(input);
      input.dispatchEvent(new Event('change'));
    };
    list.appendChild(item);
  });

  wrap.appendChild(list);

  // Close on blur
  input.onblur = () => setTimeout(() => removeAcList(input), 200);

  // Keyboard navigation
  input.onkeydown = (e) => {
    const items = list.querySelectorAll('.ac-item');
    const active = list.querySelector('.ac-active');
    let idx = Array.from(items).indexOf(active);
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx+1, items.length-1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx-1, 0); }
    else if (e.key === 'Enter' && active) { e.preventDefault(); input.value = active.querySelector('.ac-item-name').textContent; removeAcList(input); return; }
    else if (e.key === 'Escape') { removeAcList(input); return; }
    items.forEach(it => it.classList.remove('ac-active'));
    if (items[idx]) items[idx].classList.add('ac-active');
  };
}

function removeAcList(input) {
  const existing = document.getElementById('ac-list-' + input.id);
  if (existing) existing.remove();
}

// Invalidate cache when new contact is saved
const _origSubmitContact = typeof submitContact !== 'undefined' ? submitContact : null;

// ════════════════════════════════════════
// EDIT VEHICLE
// ════════════════════════════════════════
let _editVehicleId = null;

function openEditVehicleModal(vehicleId) {
  const v = state.currentVehicles?.find(v=>v.id==vehicleId);
  if (!v) return;
  _editVehicleId = vehicleId;
  el('ev-type').value   = v.vehicle_type   || '';
  el('ev-model').value  = v.model           || '';
  el('ev-year').value   = v.year            || '';
  el('ev-engine').value = v.engine_size     || '';
  el('ev-vin').value    = v.vin             || '';
  el('ev-plate').value  = v.plate           || '';
  el('ev-color').value  = v.color           || '';
  el('ev-price').value  = v.purchase_price  || '';
  el('ev-expiry').value = v.license_expiry  || '';
  el('ev-licnum').value = v.license_number  || '';
  el('ev-notes').value  = v.notes           || '';
  el('evError').style.display = 'none';
  openModal('editVehicleModal');
}

async function submitEditVehicle() {
  const data = {
    vehicle_type:    el('ev-type').value.trim()   || null,
    model:           el('ev-model').value.trim()  || null,
    year:            parseInt(el('ev-year').value)|| null,
    engine_size:     el('ev-engine').value.trim() || null,
    vin:             el('ev-vin').value.trim()     || null,
    plate:           el('ev-plate').value.trim()  || null,
    color:           el('ev-color').value.trim()  || null,
    purchase_price:  parseFloat(el('ev-price').value)||0,
    license_expiry:  el('ev-expiry').value        || null,
    license_number:  el('ev-licnum').value.trim() || null,
    notes:           el('ev-notes').value.trim()  || null,
  };
  try {
    await apiPatch('vehicles', { id:`eq.${_editVehicleId}` }, data);
    closeModal('editVehicleModal');
    toast('✅ تم تعديل بيانات السيارة','ok');
    loadVehiclesTab(state.currentFileNo, state.system);
  } catch(e) { showFieldErr('evError','خطأ: '+e.message); }
}


// apiDelete helper — includes permission guard + auto audit log
const apiDelete = async function(table, matchParams) {
  const protectedTables = ['purchase_orders','vehicles','sales','expenses','payments','collections','partner_payouts','contacts'];
  if (protectedTables.includes(table) && !can('delete')) {
    toast('🔒 ليس لديك صلاحية الحذف', 'err');
    throw new Error('غير مصرح بالحذف');
  }
  // Log the delete action
  try {
    const fileNo = matchParams?.file_no?.replace('eq.','') || matchParams?.id?.replace('eq.','') || null;
    logAudit('DELETE', table, fileNo, null, matchParams, `حذف من جدول ${table}`);
  } catch(e) {}

  let url = `${SB_URL}/rest/v1/${table}?`;
  for (const [k,v] of Object.entries(matchParams)) url += `${k}=${encodeURIComponent(v)}&`;
  let res = await fetch(url, { method:'DELETE', headers: headers({'Prefer':'return=representation'}) });
  if (res.status === 401) { const ok = await refreshAccessToken(); if(!ok) throw new Error('انتهت الجلسة'); res = await fetch(url,{method:'DELETE',headers:headers()}); }
  return res;
}

// ════════════════════════════════════════
// DELETE ORPHAN DEAL (no file_no)
// ════════════════════════════════════════
async function deleteOrphanDeal(dealId) {
  if (!confirm('هل تريد حذف هذا الملف نهائياً؟ لا يمكن التراجع.')) return;
  try {
    // Delete by id (works even with null file_no)
    await apiDelete('purchase_orders', { id:`eq.${dealId}` });
    toast('✅ تم الحذف','ok');
    await loadDashboard();
  } catch(e) { alert('خطأ: ' + e.message); }
}

// ════════════════════════════════════════
// EXPORT ENGINE — Excel + PDF/Print
// ════════════════════════════════════════

// ── EXCEL EXPORT ──
function exportToExcel(sheets, filename) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, data, headers }) => {
    const wsData = [headers, ...data];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // Style header row
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({r:0, c})];
      if (cell) cell.s = { font:{bold:true}, fill:{fgColor:{rgb:'E6930A'}} };
    }
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, filename + '.xlsx');
}

const PRINT_STYLES=`*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Cairo','Segoe UI',Arial,sans-serif;color:#1a1a1a;font-size:12px;direction:rtl}.print-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:3px solid #1a1a1a}.logo-area .company{font-size:20px;font-weight:800}.doc-title{font-size:24px;font-weight:800;text-align:left}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:11px}thead tr{background:#1a1a1a;color:#fff}thead th{padding:8px 10px;text-align:right}tbody tr{border-bottom:1px solid #eee}tbody td{padding:7px 10px}tfoot tr{background:#f0f0f0;font-weight:700}.kpi-box{background:#f8f9fa;border-radius:6px;padding:10px 14px;border-right:3px solid #e6930a}.info-row{display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid #eee}.green{color:#16a34a}.red{color:#dc2626}.blue{color:#2563eb}.amber{color:#d97706}.page{max-width:700px;margin:0 auto;padding:20px}.amount-box{background:#1a1a1a;color:#fff;border-radius:10px;padding:20px 28px;text-align:center;margin-bottom:22px}.amount-value{font-size:32px;font-weight:900}.sig-box{text-align:center;padding-top:44px;border-top:1px solid #ccc}`;function openPrintOverlay(html,title){const o=document.getElementById('printOverlay'),b=document.getElementById('printOverlayBody'),t=document.getElementById('printOverlayTitle');if(!o||!b)return;if(t)t.textContent=title||'معاينة الطباعة';b.innerHTML=`<style>${PRINT_STYLES}</style>`+html;o.style.display='block';document.body.style.overflow='hidden';}function closePrintOverlay(){const o=document.getElementById('printOverlay');if(o)o.style.display='none';document.body.style.overflow='';}document.addEventListener('keydown',e=>{if(e.key==='Escape')closePrintOverlay();});
function printDocument(html,title){openPrintOverlay(html,title);}

function docHeader(title, subtitle, fileNo) {
  return `<div class="print-header">
    <div class="logo-area">
      <div class="company">Transit International</div>
      <div class="sub">نظام إدارة صفقات السيارات</div>
      <div class="sub" style="margin-top:4px;color:#999">تاريخ الطباعة: ${new Date().toLocaleDateString('en-GB')}</div>
    </div>
    <div>
      <div class="doc-title">${title}</div>
      ${subtitle ? `<div class="doc-subtitle">${subtitle}</div>` : ''}
      ${fileNo ? `<div style="font-size:13px;color:#e6930a;font-weight:700;text-align:left;margin-top:4px"># ${fileNo}</div>` : ''}
    </div>
  </div>`;
}

// ════════════════════════════════════════
// 1. PURCHASE ORDER PRINT / EXPORT
// ════════════════════════════════════════
async function printPurchaseOrder(fileNo) {
  try {
    const sys = state.system;
    const [poArr, vehicles, partners, payments, expenses] = await Promise.all([
      apiGet('purchase_orders', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGet('vehicles',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGet('partners_master', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGet('payments',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, order:'pay_date.asc' }),
      apiGet('expenses',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, order:'exp_date.asc' }),
    ]);
    const po         = poArr?.[0] || {};
    const totalPaid  = (payments||[]).reduce((s,p)=>s+(+p.amount||0),0);
    const totalExp   = (expenses||[]).reduce((s,e)=>s+(+e.amount||0),0);
    const remaining  = (+po.total_purchase||0) - totalPaid;
    const fmt2 = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:2});

    const vehicleRows = (vehicles||[]).map((v,i) => `<tr>
      <td style="text-align:center;font-weight:700">${i+1}</td>
      <td>${v.vehicle_type||'—'} ${v.model||''}</td>
      <td style="direction:ltr;font-family:monospace;font-size:11px;font-weight:700">${v.vin||'—'}</td>
      <td style="direction:ltr">${v.plate||'—'}</td>
      <td>${v.color||'—'}</td>
      <td style="text-align:center">${v.engine_size?v.engine_size+' L':'—'}</td>
      <td style="text-align:center">${v.year||'—'}</td>
      <td class="amber" style="text-align:left">${fmt2(v.purchase_price)}</td>
    </tr>`).join('');

    const paymentRows = (payments||[]).map(p => `<tr>
      <td style="font-size:10px;color:#2563eb;font-weight:700">${p.ref_no||'—'}</td>
      <td>${p.payer||'—'}</td>
      <td class="green" style="text-align:left">${fmt2(p.amount)}</td>
      <td>${p.pay_method||'—'}</td>
      <td style="direction:ltr">${p.document||'—'}</td>
      <td>${p.pay_date||'—'}</td>
    </tr>`).join('');

    const expenseRows = (expenses||[]).map(e => `<tr>
      <td style="font-size:10px;color:#dc2626;font-weight:700">${e.ref_no||'—'}</td>
      <td>${e.description||'—'}</td>
      <td>${e.exp_type||'—'}</td>
      <td class="red" style="text-align:left">${fmt2(e.amount)}</td>
      <td>${e.pay_method||'—'}</td>
      <td>${e.exp_date||e.expense_date||'—'}</td>
    </tr>`).join('');

    const partnerRows = (partners||[]).map(p => {
      const paid = (payments||[]).filter(pm=>pm.payer===p.partner).reduce((s,pm)=>s+(+pm.amount||0),0);
      const due  = (+po.total_purchase||0) * (+p.share_percent||0) / 100;
      return `<tr>
        <td style="font-weight:700">${p.partner}</td>
        <td style="text-align:center">${p.share_percent}%</td>
        <td class="blue" style="text-align:left">${fmt2(due)}</td>
        <td class="green" style="text-align:left">${fmt2(paid)}</td>
        <td class="${(due-paid)>0.01?'red':'green'}" style="text-align:left;font-weight:700">${fmt2(due-paid)}</td>
      </tr>`;
    }).join('');

    const html = `
      ${docHeader('سند شراء', 'Purchase Order', fileNo)}

      <div class="kpi-row" style="grid-template-columns:repeat(4,1fr)">
        <div class="kpi-box"><div class="kpi-label">قيمة الصفقة</div><div class="kpi-val amber">${fmt2(po.total_purchase)} KWD</div></div>
        <div class="kpi-box" style="border-color:#16a34a"><div class="kpi-label">المدفوع للمورد</div><div class="kpi-val green">${fmt2(totalPaid)} KWD</div></div>
        <div class="kpi-box" style="border-color:${remaining>0?'#dc2626':'#16a34a'}"><div class="kpi-label">المتبقي</div><div class="kpi-val ${remaining>0?'red':'green'}">${fmt2(remaining)} KWD</div></div>
        <div class="kpi-box" style="border-color:#7c3aed"><div class="kpi-label">المصاريف</div><div class="kpi-val" style="color:#7c3aed">${fmt2(totalExp)} KWD</div></div>
      </div>

      <div class="info-grid">
        <div class="info-box">
          <div class="info-row"><span class="info-label">رقم الملف</span><span class="info-val amber">${po.file_no||'—'}</span></div>
          <div class="info-row"><span class="info-label">المورد</span><span class="info-val">${po.supplier||'—'}</span></div>
          <div class="info-row"><span class="info-label">رقم PO</span><span class="info-val" style="direction:ltr">${po.po_no||'—'}</span></div>
          <div class="info-row"><span class="info-label">تاريخ الصفقة</span><span class="info-val">${po.po_date||'—'}</span></div>
          <div class="info-row"><span class="info-label">الحالة</span><span class="info-val">${po.status||'—'}</span></div>
        </div>
        <div class="info-box">
          <div class="info-row"><span class="info-label">عدد السيارات</span><span class="info-val">${(vehicles||[]).length} سيارة</span></div>
          <div class="info-row"><span class="info-label">عدد الشركاء</span><span class="info-val">${(partners||[]).length} شريك</span></div>
          <div class="info-row"><span class="info-label">عدد الدفعات</span><span class="info-val">${(payments||[]).length} دفعة</span></div>
          <div class="info-row"><span class="info-label">عدد المصاريف</span><span class="info-val">${(expenses||[]).length} بند</span></div>
          <div class="info-row"><span class="info-label">تاريخ الطباعة</span><span class="info-val">${new Date().toLocaleDateString('en-GB')}</span></div>
        </div>
      </div>

      <div class="section-title">📦 السيارات / Vehicles</div>
      <table>
        <thead><tr><th>#</th><th>النوع / الموديل</th><th>رقم الشاصي (VIN)</th><th>اللوحة</th><th>اللون</th><th>الحجم</th><th>السنة</th><th>سعر الشراء</th></tr></thead>
        <tbody>${vehicleRows}</tbody>
        <tfoot><tr>
          <td colspan="6" style="padding:8px 10px"><strong>إجمالي قيمة الشراء</strong></td>
          <td class="amber" style="text-align:left"><strong>${fmt2(po.total_purchase)} KWD</strong></td>
        </tr></tfoot>
      </table>

      ${partners?.length ? `
      <div class="section-title">👥 الشركاء / Partners</div>
      <table>
        <thead><tr><th>الشريك</th><th>الحصة %</th><th>المستحق</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
        <tbody>${partnerRows}</tbody>
      </table>` : ''}

      ${payments?.length ? `
      <div class="section-title">💳 دفعات المورد / Payments</div>
      <table>
        <thead><tr><th>رقم الدفعة</th><th>الدافع</th><th>المبلغ</th><th>طريقة الدفع</th><th>المستند</th><th>التاريخ</th></tr></thead>
        <tbody>${paymentRows}</tbody>
        <tfoot><tr>
          <td colspan="2"><strong>الإجمالي المدفوع</strong></td>
          <td class="green" style="text-align:left"><strong>${fmt2(totalPaid)} KWD</strong></td>
          <td colspan="3"></td>
        </tr></tfoot>
      </table>` : ''}

      ${expenses?.length ? `
      <div class="section-title">💸 المصاريف / Expenses</div>
      <table>
        <thead><tr><th>رقم المصروف</th><th>البيان</th><th>النوع</th><th>المبلغ</th><th>طريقة الدفع</th><th>التاريخ</th></tr></thead>
        <tbody>${expenseRows}</tbody>
        <tfoot><tr>
          <td colspan="3"><strong>إجمالي المصاريف</strong></td>
          <td class="red" style="text-align:left"><strong>${fmt2(totalExp)} KWD</strong></td>
          <td colspan="2"></td>
        </tr></tfoot>
      </table>` : ''}

      ${po.notes ? `<div style="margin:12px 0;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px"><strong>ملاحظات:</strong> ${po.notes}</div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:32px;margin-top:32px">
        <div style="text-align:center;padding-top:44px;border-top:1px solid #ccc">
          <div style="font-size:11px;color:#888">توقيع المورد</div>
          <div style="font-size:12px;font-weight:700;margin-top:4px">${po.supplier||''}</div>
        </div>
        <div style="text-align:center;padding-top:44px;border-top:1px solid #ccc">
          <div style="font-size:11px;color:#888">توقيع المدير</div>
        </div>
        <div style="text-align:center;padding-top:44px;border-top:1px solid #ccc">
          <div style="font-size:11px;color:#888">توقيع المحاسب</div>
        </div>
      </div>

      <div class="footer">Transit Cars · نظام ترانزيت لإدارة صفقات السيارات</div>`;

    printDocument(html, `سند شراء — ${fileNo}`);
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

async function exportPurchaseOrderExcel(fileNo) {
  try {
    const sys = state.system;
    const [poArr, vehicles, payments] = await Promise.all([
      apiGet('purchase_orders', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGet('vehicles',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGet('payments',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
    ]);
    const po = poArr?.[0] || {};
    exportToExcel([
      {
        name: 'بيانات الصفقة',
        headers: ['البند','القيمة'],
        data: [
          ['رقم الملف', po.file_no||''], ['المورد', po.supplier||''],
          ['التاريخ', po.po_date||''], ['قيمة الصفقة', +po.total_purchase||0],
          ['عدد السيارات', (vehicles||[]).length], ['الحالة', po.status||''],
        ]
      },
      {
        name: 'السيارات',
        headers: ['#','النوع','الموديل','VIN','اللوحة','اللون','سعر الشراء'],
        data: (vehicles||[]).map((v,i) => [i+1, v.vehicle_type||'', v.model||'', v.vin||'', v.plate||'', v.color||'', +v.purchase_price||0])
      },
      {
        name: 'دفعات المورد',
        headers: ['التاريخ','الدافع','المبلغ','طريقة الدفع','المستند','ملاحظات'],
        data: (payments||[]).map(p => [p.pay_date||'', p.payer||'', +p.amount||0, p.pay_method||'', p.document||'', p.notes||''])
      }
    ], `سند-شراء-${fileNo}`);
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

// ════════════════════════════════════════
// 2. DEAL STATEMENT PRINT / EXPORT
// ════════════════════════════════════════

async function exportDealExcel(fileNo) {
  try {
    const sys = state.system;
    const [sales, expenses, payments, collections, payouts] = await Promise.all([
      apiGet('sales',           { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGet('expenses',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGet('payments',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGet('collections',     { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGet('partner_payouts', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
    ]);
    exportToExcel([
      { name:'مبيعات', headers:['التاريخ','الفاتورة','VIN','العميل','السعر','ملاحظات'],
        data:(sales||[]).map(s=>[s.sale_date,s.inv_no,s.vin,s.customer,+s.sale_price||0,s.notes||'']) },
      { name:'مصاريف', headers:['التاريخ','البيان','النوع','المبلغ','طريقة الدفع'],
        data:(expenses||[]).map(e=>[e.exp_date||e.expense_date,e.description,e.category,+e.amount||0,e.pay_method||'']) },
      { name:'دفعات المورد', headers:['التاريخ','الدافع','المبلغ','طريقة الدفع','المستند'],
        data:(payments||[]).map(p=>[p.pay_date,p.payer,+p.amount||0,p.pay_method||'',p.document||'']) },
      { name:'تحصيلات', headers:['التاريخ','العميل','المبلغ','طريقة الدفع'],
        data:(collections||[]).map(c=>[c.paid_date,c.customer,+c.amount||0,c.pay_method||'']) },
      { name:'صرف شركاء', headers:['التاريخ','الشريك','النوع','رأس مال','أرباح','إجمالي'],
        data:(payouts||[]).map(p=>[p.pay_date,p.partner,p.payout_type,+p.capital_amount||0,+p.profit_amount||0,+p.amount||0]) },
    ], `كشف-حساب-${fileNo}`);
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

// ════════════════════════════════════════
// 3. REPORTS PRINT / EXPORT
// ════════════════════════════════════════
async function printCurrentReport() {
  const type = reportState.type;
  const from = el('r-from').value;
  const to   = el('r-to').value;
  const data = reportState.data || [];
  if (!data.length) { toast('لا توجد بيانات للطباعة','err'); return; }

  const titles = { profit:'تقرير الأرباح والخسائر', sales:'تقرير المبيعات', expenses:'تقرير المصاريف', partners:'تقرير الشركاء' };
  let tableHtml = '';

  if (type === 'profit') {
    const rows = data.map(d=>`<tr>
      <td>${d.file}</td>
      <td class="green">${fmt(d.sales)}</td>
      <td class="red">${fmt(d.expenses)}</td>
      <td class="amber">${fmt(d.payments)}</td>
      <td class="${d.profit>=0?'green':'red'}">${fmt(d.profit)}</td>
    </tr>`).join('');
    const totProfit = data.reduce((s,d)=>s+d.profit,0);
    tableHtml = `<table>
      <thead><tr><th>الملف</th><th>مبيعات</th><th>مصاريف</th><th>دفعات مورد</th><th>صافي ربح</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td><strong>الإجمالي</strong></td><td></td><td></td><td></td><td class="${totProfit>=0?'green':'red'}"><strong>${fmt(totProfit)}</strong></td></tr></tfoot>
    </table>`;
  } else if (type === 'sales') {
    tableHtml = `<table>
      <thead><tr><th>التاريخ</th><th>الملف</th><th>VIN</th><th>العميل</th><th>السعر</th></tr></thead>
      <tbody>${data.map(s=>`<tr><td>${s.sale_date||''}</td><td>${s.file_no||''}</td><td style="direction:ltr">${s.vin||''}</td><td>${s.customer||''}</td><td class="green">${fmt(s.sale_price)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4"><strong>الإجمالي</strong></td><td class="green"><strong>${fmt(data.reduce((s,r)=>s+(+r.sale_price||0),0))}</strong></td></tr></tfoot>
    </table>`;
  } else if (type === 'expenses') {
    tableHtml = `<table>
      <thead><tr><th>التاريخ</th><th>الملف</th><th>البيان</th><th>النوع</th><th>المبلغ</th></tr></thead>
      <tbody>${data.map(e=>`<tr><td>${e.exp_date||e.expense_date||e.created_at?.split('T')[0]||''}</td><td>${e.file_no||''}</td><td>${e.description||''}</td><td>${e.category||e.exp_type||''}</td><td class="red">${fmt(e.amount)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4"><strong>الإجمالي</strong></td><td class="red"><strong>${fmt(data.reduce((s,r)=>s+(+r.amount||0),0))}</strong></td></tr></tfoot>
    </table>`;
  } else if (type === 'partners') {
    tableHtml = `<table>
      <thead><tr><th>التاريخ</th><th>الملف</th><th>الشريك</th><th>النوع</th><th>المبلغ</th></tr></thead>
      <tbody>${data.map(p=>`<tr><td>${p.pay_date||''}</td><td>${p.file_no||''}</td><td>${p.partner||''}</td><td>${p.payout_type||''}</td><td class="amber">${fmt(p.amount)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4"><strong>الإجمالي</strong></td><td class="amber"><strong>${fmt(data.reduce((s,r)=>s+(+r.amount||0),0))}</strong></td></tr></tfoot>
    </table>`;
  }

  const html = `
    ${docHeader(titles[type], `من ${from} إلى ${to}`, '')}
    ${tableHtml}
    <div class="footer">Transit International · ${titles[type]} · ${from} — ${to}</div>`;
  printDocument(html, titles[type]);
}

async function exportCurrentReportExcel() {
  const type = reportState.type;
  const data = reportState.data || [];
  if (!data.length) { toast('لا توجد بيانات للتصدير','err'); return; }
  const titles = { profit:'تقرير-الأرباح', sales:'تقرير-المبيعات', expenses:'تقرير-المصاريف', partners:'تقرير-الشركاء' };
  const headers = {
    profit:   ['الملف','مبيعات','مصاريف','دفعات مورد','صافي ربح'],
    sales:    ['التاريخ','الملف','VIN','العميل','السعر'],
    expenses: ['التاريخ','الملف','البيان','النوع','المبلغ'],
    partners: ['التاريخ','الملف','الشريك','النوع','المبلغ'],
  };
  const rows = {
    profit:   data.map(d=>[d.file, d.sales, d.expenses, d.payments, d.profit]),
    sales:    data.map(s=>[s.sale_date, s.file_no, s.vin, s.customer, +s.sale_price||0]),
    expenses: data.map(e=>[e.exp_date||e.expense_date, e.file_no, e.description, e.category||e.exp_type||'', +e.amount||0]),
    partners: data.map(p=>[p.pay_date, p.file_no, p.partner, p.payout_type, +p.amount||0]),
  };
  exportToExcel([{ name: titles[type], headers: headers[type], data: rows[type] }], titles[type]);
}

// ════════════════════════════════════════
// 4. TRIAL BALANCE PRINT / EXPORT
// ════════════════════════════════════════
function printTrialBalance() {
  const data = trialState.data || [];
  if (!data.length) { toast('لا توجد بيانات','err'); return; }
  const typeLabelsAr = { customer:'عميل', supplier:'مورد', partner:'شريك', custodian:'عهدة' };
  const rows = data.map(c=>`<tr>
    <td>${c.name}</td>
    <td>${typeLabelsAr[c.type]||c.type}</td>
    <td class="green">${fmt(c.totalDebit)}</td>
    <td class="red">${fmt(c.totalCredit)}</td>
    <td class="${c.balance>=0?'green':'red'}">${fmt(Math.abs(c.balance))} ${c.balance>=0?'مدين':'دائن'}</td>
  </tr>`).join('');
  const sumD = data.reduce((s,c)=>s+c.totalDebit,0);
  const sumC = data.reduce((s,c)=>s+c.totalCredit,0);
  const sumB = data.reduce((s,c)=>s+c.balance,0);
  const html = `
    ${docHeader('ميزان المراجعة','Trial Balance','')}
    <table>
      <thead><tr><th>الاسم</th><th>النوع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="2"><strong>الإجمالي (${data.length} جهة)</strong></td>
        <td class="green"><strong>${fmt(sumD)}</strong></td>
        <td class="red"><strong>${fmt(sumC)}</strong></td>
        <td class="${sumB>=0?'green':'red'}"><strong>${fmt(Math.abs(sumB))}</strong></td>
      </tr></tfoot>
    </table>
    <div class="footer">Transit International · ميزان المراجعة · ${new Date().toLocaleDateString('en-GB')}</div>`;
  printDocument(html, 'ميزان المراجعة');
}

function exportTrialBalanceExcel() {
  const data = trialState.data || [];
  const typeLabelsAr = { customer:'عميل', supplier:'مورد', partner:'شريك', custodian:'عهدة' };
  exportToExcel([{
    name: 'ميزان المراجعة',
    headers: ['الاسم','النوع','مدين','دائن','الرصيد','طبيعة الرصيد'],
    data: data.map(c=>[c.name, typeLabelsAr[c.type]||c.type, c.totalDebit, c.totalCredit, Math.abs(c.balance), c.balance>=0?'مدين':'دائن'])
  }], 'ميزان-المراجعة');
}

// ════════════════════════════════════════
// LICENSE OCR — Claude API
// ════════════════════════════════════════
function uploadLicenseForRow(row) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    if (files.length === 1) {
      await readLicenseIntoRow(files[0], row);
    } else {
      await readMultipleLicenses(files, row);
    }
  };
  input.click();
}

function uploadMultipleLicenses() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    // Get current rows count
    const container = el('vehiclesContainer');
    await readMultipleLicenses(files, null);
  };
  input.click();
}

async function readLicenseIntoRow(file, row) {
  const btn = row.querySelector('[title="رفع رخصة"]');
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const data = await extractLicenseData(file);
    fillRowFromLicense(row, data);
    toast('✅ تم قراءة الرخصة', 'ok');
  } catch(e) {
    toast('خطأ في قراءة الرخصة: ' + e.message, 'err');
  }
  if (btn) { btn.textContent = '📷'; btn.disabled = false; }
}

async function readMultipleLicenses(files, startRow) {
  toast(`⏳ جاري قراءة ${files.length} رخصة...`, 'ok');
  const container = el('vehiclesContainer');

  for (let i = 0; i < files.length; i++) {
    // Add new row if needed
    if (i > 0 || !startRow) addVehicleRow();
    const rows = container.querySelectorAll('tr.v-row');
    const row = startRow && i === 0 ? startRow : rows[rows.length - 1];

    try {
      const data = await extractLicenseData(files[i]);
      fillRowFromLicense(row, data);
    } catch(e) {
      console.warn(`خطأ في الرخصة ${i+1}:`, e.message);
    }
  }
  toast(`✅ تم قراءة ${files.length} رخصة`, 'ok');
  checkPriceTotal();
}

async function extractLicenseData(file) {
  // Get API key from settings
  const apiKey = localStorage.getItem('tm_anthropic_key') || '';
  if (!apiKey) {
    throw new Error('يرجى إدخال مفتاح Anthropic API في ⚙️ الإعدادات ← معلومات النظام');
  }

  // Convert image to base64
  const base64 = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result.split(',')[1]);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });

  const mediaType = file.type || 'image/jpeg';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 }
          },
          {
            type: 'text',
            text: `استخرج بيانات السيارة من هذه الوثيقة (رخصة مركبة أو استمارة تسجيل).
أرجع JSON فقط بدون أي نص إضافي:
{
  "vehicle_type": "نوع المركبة (مثال: سيدان، بيكاب، SUV)",
  "model": "الماركة والموديل (مثال: Toyota Hilux)",
  "year": 2024,
  "vin": "رقم الشاصي كاملاً",
  "plate": "رقم اللوحة",
  "color": "اللون بالعربي",
  "engine_size": "سعة المحرك (مثال: 2.7)",
  "license_expiry": "تاريخ انتهاء الرخصة بصيغة YYYY-MM-DD"
}
إذا لم تجد قيمة اجعلها null.`
          }
        ]
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `خطأ ${response.status}`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text || '{}';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('لم يتم التعرف على البيانات من الصورة');
  return JSON.parse(match[0]);
}

function fillRowFromLicense(row, data) {
  if (!row || !data) return;
  const setVal = (name, val) => {
    const inp = row.querySelector(`[name="${name}"]`);
    if (inp && val) inp.value = val;
  };
  setVal('v-type',   data.vehicle_type);
  setVal('v-model',  data.model);
  setVal('v-year',   data.year);
  setVal('v-vin',    data.vin);
  setVal('v-plate',  data.plate);
  setVal('v-color',  data.color);
  setVal('v-engine', data.engine_size);
  setVal('v-expiry', data.license_expiry);
  // Highlight row briefly
  row.style.background = 'var(--green-dim)';
  setTimeout(() => row.style.background = '', 2000);
}

// ════════════════════════════════════════
// DRAFT / POST SYSTEM
// ════════════════════════════════════════

// Save any operation as Draft first, then Post

// ════ ENTRY STATUS ════
function isAdminUser() { return _currentRole === 'admin'; }
function adminPostsImmediately() { return localStorage.getItem('tm_admin_post') !== 'draft'; }
function entryStatus() { return (isAdminUser() && adminPostsImmediately()) ? 'posted' : 'draft'; }
function toggleAdminPostSetting() {
  const v = adminPostsImmediately() ? 'draft' : 'posted';
  localStorage.setItem('tm_admin_post', v);
  updateAdminPostToggleUI();
  toast(v==='draft'?'✅ إدخالات المدير ستحتاج موافقة':'✅ إدخالات المدير ستُرحَّل فوراً','ok');
}
function updateAdminPostToggleUI() {
  const im=adminPostsImmediately(),t=document.getElementById('adminPostToggle'),k=document.getElementById('adminPostKnob'),l=document.getElementById('adminPostLabel');
  if(!t)return; t.style.background=im?'var(--green)':'var(--border2)';
  if(k)k.style.transform=im?'translateX(0)':'translateX(-18px)';
  if(l)l.textContent=im?'ترحيل فوري ✓':'يحتاج موافقة';
}

async function saveDraft(entryType, fileNo, description, amount, refTable, refId) {
  try {
    const entry = await apiPost('journal_entries', {
      system_type: state.system,
      entry_date:  today(),
      entry_type:  entryType,
      file_no:     fileNo   || null,
      description: description,
      amount:      amount   || 0,
      post_status:entryStatus(),
      ref_table:   refTable || null,
      ref_id:      refId    || null,
    });
    return Array.isArray(entry) ? entry[0] : entry;
  } catch(e) { console.warn('saveDraft error:', e.message); return null; }
}

async function postEntry(journalId) {
  try {
    await apiPatch('journal_entries', { id:`eq.${journalId}` }, {
      post_status: 'posted',
      posted_at: new Date().toISOString()
    });
  } catch(e) { console.warn('postEntry error:', e.message); }
}

// Load drafts for journal
async function loadJournalDrafts() {
  try {
    const drafts = await apiGet('journal_entries', {
      select: '*',
      system_type: `eq.${state.system}`,
      post_status: 'eq.draft',
      order: 'created_at.desc'
    });

    const section = el('journal-drafts-section');
    const list    = el('journal-drafts-list');
    const count   = el('drafts-count');

    if (!drafts?.length) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    count.textContent = drafts.length;

    const typeConfig = {
      purchase:   { icon:'📋', label:'شراء',       color:'var(--accent)'  },
      sale:       { icon:'🧾', label:'بيع',         color:'var(--green)'   },
      collection: { icon:'💰', label:'تحصيل',       color:'var(--blue)'    },
      expense:    { icon:'💸', label:'مصروف',       color:'var(--red)'     },
      payment:    { icon:'💳', label:'دفعة مورد',   color:'var(--cyan)'    },
      payout:     { icon:'👥', label:'صرف شريك',   color:'var(--purple)'  },
    };

    list.innerHTML = drafts.map(d => {
      const cfg = typeConfig[d.entry_type] || { icon:'📌', label:d.entry_type, color:'var(--text2)' };
      return `<div class="draft-card">
        <span style="font-size:18px">${cfg.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${d.description || d.entry_type}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">
            ${d.file_no ? `ملف: ${d.file_no} · ` : ''}${fmtDate(d.entry_date)} · ${fmt(d.amount)}
          </div>
        </div>
        <span class="draft-badge">مسودة</span>
        <button class="btn btn-sm" onclick="postDraftEntry(${d.id},'${d.entry_type}','${d.file_no||''}')"
          style="background:var(--green-dim);border:1px solid var(--green);color:var(--green)">✓ Post</button>
        <button class="btn btn-sm" onclick="deleteDraftEntry(${d.id})"
          style="background:var(--red-dim);border:1px solid var(--red);color:var(--red)">🗑</button>
      </div>`;
    }).join('');
  } catch(e) { console.warn('loadJournalDrafts error:', e.message); }
}

async function postDraftEntry(id, type, fileNo) {
  await postEntry(id);
  toast(`✅ تم ترحيل القيد`,'ok');
  loadJournal();
}

async function deleteDraftEntry(id) {
  if (!confirm('حذف المسودة؟')) return;
  await apiDelete('journal_entries', { id:`eq.${id}` });
  toast('تم الحذف','ok');
  loadJournal();
}

// ════════════════════════════════════════
// JOURNAL EDIT — edit any entry
// ════════════════════════════════════════
async function editJournalEntry(type, sourceId, fileNo) {
  // Open the appropriate modal in edit mode based on type
  state.currentFileNo = fileNo || state.currentFileNo;
  switch(type) {
    case 'sale':       openSaleModal(); break;
    case 'collection': openCollectionModal(); break;
    case 'expense':    openExpenseModal(); break;
    case 'payment':    openPaymentModal(); break;
    case 'payout':     openPayoutModal(); break;
    default: toast('لا يمكن تعديل هذا النوع مباشرة — ادخل الملف وعدّل من هناك','err');
  }
}

// ════════════════════════════════════════
// JOURNAL REPORT
// ════════════════════════════════════════
function showJournalReport() {
  const from = el('jDateFrom')?.value || today();
  const to   = el('jDateTo')?.value   || today();
  const entries = journalState.entries || [];

  if (!entries.length) { toast('لا توجد بيانات للتقرير','err'); return; }

  const typeLabels = {
    sale:'مبيعات', collection:'تحصيلات', expense:'مصاريف',
    payment:'دفعات مورد', payout:'صرف شركاء', purchase:'مشتريات'
  };

  // Group by type
  const groups = {};
  entries.forEach(e => {
    const t = e.type || 'أخرى';
    if (!groups[t]) groups[t] = { count:0, total:0 };
    groups[t].count++;
    groups[t].total += e.amount || 0;
  });

  const totalIn  = entries.filter(e=>e.sign>0).reduce((s,e)=>s+e.amount,0);
  const totalOut = entries.filter(e=>e.sign<0).reduce((s,e)=>s+e.amount,0);
  const net      = totalIn - totalOut;

  const summaryRows = Object.entries(groups).map(([type,g]) =>
    `<tr><td>${typeLabels[type]||type}</td><td style="text-align:center">${g.count}</td>
     <td style="text-align:left">${g.total.toLocaleString('en-US',{minimumFractionDigits:2})}</td></tr>`
  ).join('');

  const detailRows = entries.map(e => `<tr>
    <td>${fmtDate(e.date)}</td>
    <td>${typeLabels[e.type]||e.type||'—'}</td>
    <td>${e.title||e.description||'—'}</td>
    <td>${e.fileNo||'—'}</td>
    <td style="text-align:left;color:${e.sign>0?'#16a34a':'#dc2626'}">${e.sign>0?'+':'−'}${fmt(e.amount)}</td>
  </tr>`).join('');

  const html = `
    ${docHeader('التقرير اليومي','Daily Report','')}
    <div style="font-size:13px;color:#666;margin-bottom:16px">الفترة: ${from} — ${to}</div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
      <div class="kpi-box"><div class="kpi-label">إجمالي الداخل</div><div class="kpi-val green">${fmt(totalIn)}</div></div>
      <div class="kpi-box"><div class="kpi-label">إجمالي الخارج</div><div class="kpi-val red">${fmt(totalOut)}</div></div>
      <div class="kpi-box"><div class="kpi-label">صافي الحركة</div><div class="kpi-val ${net>=0?'green':'red'}">${fmt(net)}</div></div>
    </div>

    <div class="section-title">ملخص بالنوع</div>
    <table>
      <thead><tr><th>النوع</th><th>العدد</th><th>الإجمالي</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>

    <div class="section-title" style="margin-top:16px">التفاصيل</div>
    <table>
      <thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>الملف</th><th>المبلغ</th></tr></thead>
      <tbody>${detailRows}</tbody>
    </table>
    <div class="footer">Transit International · التقرير اليومي · ${new Date().toLocaleDateString('en-GB')}</div>`;

  printDocument(html, 'التقرير اليومي');
}

// ════════════════════════════════════════
// UPDATE loadJournal to show drafts + edit buttons
// ════════════════════════════════════════
// ════════════════════════════════════════
// VEHICLES REPORT
// ════════════════════════════════════════
const vrState = { all: [], filter: 'all' };

async function showVehiclesReport() {
  hideAllViews();
  el('vehiclesReportView').style.display = 'block';
  el('topBarTitle').textContent = 'تقرير السيارات';
  navActive('');
  await loadVehiclesReport();
}

async function loadVehiclesReport() {
  el('vr-table').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  try {
    const sys = state.system;
    const [vehicles, sales, deals] = await Promise.all([
      apiGet('vehicles', { select:'*', system_type:`eq.${sys}`, order:'file_no.asc,created_at.asc' }),
      apiGet('sales',    { select:'vin,sale_price,customer,sale_date,inv_no', system_type:`eq.${sys}` }),
      apiGet('purchase_orders', { select:'file_no,supplier', system_type:`eq.${sys}` }),
    ]);

    const soldMap = {};
    (sales||[]).forEach(s => { soldMap[s.vin] = s; });

    const dealMap = {};
    (deals||[]).forEach(d => { dealMap[d.file_no] = d.supplier; });

    // Enrich vehicles with sold info and internal code
    const fileNums = {};
    vrState.all = (vehicles||[]).map(v => {
      if (!fileNums[v.file_no]) fileNums[v.file_no] = 0;
      fileNums[v.file_no]++;
      const code = `${v.file_no}-V${String(fileNums[v.file_no]).padStart(2,'0')}`;
      const saleInfo = v.vin ? soldMap[v.vin] : null;
      return { ...v, _code: code, _sold: !!saleInfo, _saleInfo: saleInfo, _supplier: dealMap[v.file_no]||'' };
    });

    // Populate file filter
    const files = [...new Set((vehicles||[]).map(v=>v.file_no).filter(Boolean))].sort();
    el('vr-file').innerHTML = '<option value="">كل الملفات</option>' +
      files.map(f=>`<option value="${f}">${f}</option>`).join('');

    filterVehiclesReport();
  } catch(e) { el('vr-table').innerHTML = errHTML(e.message); }
}

function filterVehiclesReport(status) {
  if (status) {
    vrState.filter = status;
    document.querySelectorAll('[id^="vr-"]').forEach(b => { if(b.tagName==='BUTTON') b.classList.remove('active'); });
    el('vr-' + status)?.classList.add('active');
  }

  const fileFilter   = el('vr-file')?.value   || '';
  const searchFilter = (el('vr-search')?.value || '').toLowerCase();
  const statusFilter = vrState.filter;

  let list = vrState.all;
  if (statusFilter === 'stock') list = list.filter(v => !v._sold);
  if (statusFilter === 'sold')  list = list.filter(v =>  v._sold);
  if (fileFilter)   list = list.filter(v => v.file_no === fileFilter);
  if (searchFilter) list = list.filter(v =>
    (v.vin||'').toLowerCase().includes(searchFilter) ||
    (v.plate||'').toLowerCase().includes(searchFilter) ||
    (v.model||'').toLowerCase().includes(searchFilter) ||
    (v.vehicle_type||'').toLowerCase().includes(searchFilter)
  );

  // KPIs
  const totalV   = list.length;
  const soldV    = list.filter(v=>v._sold).length;
  const stockV   = totalV - soldV;
  const totalCost = list.reduce((s,v)=>s+(+v.purchase_price||0),0);
  const totalSales = list.filter(v=>v._sold).reduce((s,v)=>s+(+v._saleInfo?.sale_price||0),0);
  const expiring  = list.filter(v => {
    if (!v.license_expiry) return false;
    const days = (new Date(v.license_expiry) - new Date()) / 86400000;
    return days < 30 && days > 0;
  }).length;

  el('vr-kpis').innerHTML = `
    <div class="j-kpi"><div class="j-kpi-label">إجمالي السيارات</div><div class="j-kpi-val">${totalV}</div></div>
    <div class="j-kpi"><div class="j-kpi-label">في المخزن</div><div class="j-kpi-val text-amber">${stockV}</div></div>
    <div class="j-kpi"><div class="j-kpi-label">مباعة</div><div class="j-kpi-val text-green">${soldV}</div></div>
    <div class="j-kpi"><div class="j-kpi-label">${expiring?'⚠️ رخص تنتهي قريباً':'تكلفة الشراء'}</div>
      <div class="j-kpi-val ${expiring?'text-red':''}">${expiring ? expiring+' سيارة' : fmt(totalCost)}</div></div>`;

  if (!list.length) { el('vr-table').innerHTML = emptyHTML('🚗','لا توجد سيارات'); return; }

  const rows = list.map(v => {
    const expired = v.license_expiry && new Date(v.license_expiry) < new Date();
    const expiringSoon = v.license_expiry && !expired && (new Date(v.license_expiry)-new Date())/86400000 < 30;
    return `<tr ${v._sold?'style="opacity:.7"':''}>
      <td><span class="mono text-amber" style="font-size:11px">${v._code}</span></td>
      <td><span class="mono text-amber" style="font-size:11px">${v.file_no||'—'}</span></td>
      <td style="font-size:11px;color:var(--text2)">${v._supplier}</td>
      <td>${v.vehicle_type||'—'}</td>
      <td>${v.model||'—'}</td>
      <td>${v.year||'—'}</td>
      <td><span class="mono" style="direction:ltr;font-size:11px">${v.vin||'—'}</span></td>
      <td><span class="mono" style="direction:ltr">${v.plate||'—'}</span></td>
      <td>${v.color||'—'}</td>
      <td>${v.engine_size||'—'}</td>
      <td class="mono text-blue">${fmt(v.purchase_price)}</td>
      <td class="${expired?'text-red':expiringSoon?'text-amber':''}" style="font-size:11px">${v.license_expiry||'—'}</td>
      <td>
        ${v._sold
          ? `<span class="badge badge-closed">مباع</span>`
          : `<span class="badge badge-open">في المخزن</span>`}
      </td>
      ${v._sold ? `<td style="font-size:11px;color:var(--text2)">${v._saleInfo?.customer||''}</td>` : '<td></td>'}
    </tr>`;
  }).join('');

  el('vr-table').innerHTML = `<table class="data-table">
    <thead><tr>
      <th>الكود</th><th>الملف</th><th>المورد</th><th>النوع</th><th>الموديل</th>
      <th>السنة</th><th>VIN</th><th>اللوحة</th><th>اللون</th><th>الحجم</th>
      <th>سعر الشراء</th><th>انتهاء الرخصة</th><th>الحالة</th><th>العميل</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot style="background:var(--card2)"><tr>
      <td colspan="10" style="padding:10px 16px;font-weight:700">الإجمالي (${list.length} سيارة)</td>
      <td class="mono text-blue" style="padding:10px 16px;font-weight:700">${fmt(list.reduce((s,v)=>s+(+v.purchase_price||0),0))}</td>
      <td colspan="3"></td>
    </tr></tfoot>
  </table>`;

  vrState.filtered = list;
}

function printVehiclesReport() {
  const list = vrState.filtered || vrState.all;
  if (!list.length) { toast('لا توجد بيانات','err'); return; }
  const rows = list.map((v,i) => `<tr>
    <td>${v._code}</td><td>${v.file_no||'—'}</td><td>${v._supplier}</td>
    <td>${v.vehicle_type||'—'}</td><td>${v.model||'—'}</td><td>${v.year||'—'}</td>
    <td style="direction:ltr">${v.vin||'—'}</td><td style="direction:ltr">${v.plate||'—'}</td>
    <td>${v.color||'—'}</td><td>${v.engine_size||'—'}</td>
    <td>${(+v.purchase_price||0).toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    <td>${v.license_expiry||'—'}</td>
    <td>${v._sold?'مباع':'في المخزن'}</td>
    <td>${v._saleInfo?.customer||'—'}</td>
  </tr>`).join('');
  const html = `
    ${docHeader('تقرير السيارات','Vehicles Report','')}
    <table>
      <thead><tr><th>الكود</th><th>الملف</th><th>المورد</th><th>النوع</th><th>الموديل</th>
      <th>السنة</th><th>VIN</th><th>اللوحة</th><th>اللون</th><th>الحجم</th>
      <th>السعر</th><th>انتهاء الرخصة</th><th>الحالة</th><th>العميل</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer">Transit International · تقرير السيارات · ${new Date().toLocaleDateString('en-GB')}</div>`;
  printDocument(html, 'تقرير السيارات');
}

function exportVehiclesExcel() {
  const list = vrState.filtered || vrState.all;
  if (!list.length) { toast('لا توجد بيانات','err'); return; }
  exportToExcel([{
    name: 'السيارات',
    headers: ['الكود','الملف','المورد','النوع','الموديل','السنة','VIN','اللوحة','اللون','الحجم','سعر الشراء','انتهاء الرخصة','الحالة','العميل'],
    data: list.map(v => [v._code, v.file_no, v._supplier, v.vehicle_type, v.model, v.year, v.vin, v.plate, v.color, v.engine_size, +v.purchase_price||0, v.license_expiry||'', v._sold?'مباع':'في المخزن', v._saleInfo?.customer||''])
  }], 'تقرير-السيارات');
}

// ════════════════════════════════════════
// VIEWER KPI STRIP
// ════════════════════════════════════════
async function loadViewerKpis(fn, sys) {
  try {
    const [po, vehicles, sales, expenses, collections, payments] = await Promise.all([
      apiGet('purchase_orders', { select:'total_purchase,status',      system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('vehicles',        { select:'purchase_price,vin',         system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('sales',           { select:'sale_price,vin,post_status', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('expenses',        { select:'amount,post_status',         system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('collections',     { select:'amount,post_status',         system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('payments',        { select:'amount,post_status',         system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
    ]);

    const totalCost    = +(po?.[0]?.total_purchase) || (vehicles||[]).reduce((s,v)=>s+(+v.purchase_price||0),0);
    const totalExp     = (expenses||[]).filter(e=>e.post_status==='posted').reduce((s,e)=>s+(+e.amount||0),0);
    const fullCost     = totalCost + totalExp;
    const totalSales   = (sales||[]).filter(s=>s.post_status==='posted').reduce((s,s2)=>s+(+s2.sale_price||0),0);
    const totalColl    = (collections||[]).filter(c=>c.post_status==='posted').reduce((s,c)=>s+(+c.amount||0),0);
    const totalPaid    = (payments||[]).filter(p=>p.post_status==='posted').reduce((s,p)=>s+(+p.amount||0),0);
    const profit       = totalSales - fullCost;
    const soldVins     = new Set((sales||[]).filter(s=>s.post_status==='posted').map(s=>s.vin));
    const unsold       = (vehicles||[]).filter(v=>!soldVins.has(v.vin)).length;
    const uncollected  = totalSales - totalColl;
    const supplierLeft = totalCost - totalPaid;

    el('viewer-kpis').innerHTML = `
      <div class="vkpi">
        <div class="vkpi-label">💰 تكلفة الشراء</div>
        <div class="vkpi-val text-blue">${fmt(totalCost)}</div>
      </div>
      <div class="vkpi">
        <div class="vkpi-label">💸 المصاريف</div>
        <div class="vkpi-val text-red">${fmt(totalExp)}</div>
      </div>
      <div class="vkpi">
        <div class="vkpi-label">🤝 المبيعات</div>
        <div class="vkpi-val text-green">${fmt(totalSales)}</div>
      </div>
      <div class="vkpi">
        <div class="vkpi-label">${profit>=0?'📈 الربح':'📉 الخسارة'}</div>
        <div class="vkpi-val" style="color:${profit>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(profit))}</div>
      </div>
      <div class="vkpi">
        <div class="vkpi-label">🚗 سيارات</div>
        <div class="vkpi-val">${(vehicles||[]).length} <span style="font-size:11px;color:var(--text2)">/ ${soldVins.size} مباع / ${unsold} متبقي</span></div>
      </div>
      <div class="vkpi">
        <div class="vkpi-label">💳 متبقي للمورد</div>
        <div class="vkpi-val" style="color:${supplierLeft>0?'var(--red)':'var(--green)'}">${fmt(supplierLeft)}</div>
      </div>
    `;
  } catch(e) { console.warn('KPI strip error:', e.message); }
}

// ════════════════════════════════════════
// PARTNER DEAL STATEMENT (popup)
// ════════════════════════════════════════
// ════════════════════════════════════════
// كشف حساب الشريك — شامل أو لصفقة محددة
// ════════════════════════════════════════
async function showPartnerStatement(partnerName, fileNoFilter = null) {
  // Show loading overlay first
  const overlay = document.createElement('div');
  overlay.id = 'partnerStatementOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';
  overlay.innerHTML = `<div style="background:var(--card);border-radius:16px;padding:32px;text-align:center;color:var(--text)"><div class="spinner"></div><br>جاري إعداد الكشف...</div>`;
  document.body.appendChild(overlay);
  overlay.onclick = e => { if(e.target===overlay) overlay.remove(); };

  try {
    const sys = state.system;

    // ── 1. جلب كل الصفقات التي الشريك فيها ──
    const allPartnerDeals = await apiGet('partners_master', {
      select:'*', system_type:`eq.${sys}`, partner:`eq.${partnerName}`
    });
    if (!allPartnerDeals?.length) { overlay.remove(); toast('لا توجد صفقات لهذا الشريك','err'); return; }

    const deals = fileNoFilter
      ? allPartnerDeals.filter(d => d.file_no === fileNoFilter)
      : allPartnerDeals;

    // ── 2. جلب بيانات كل صفقة بالتوازي ──
    const dealDetails = await Promise.all(deals.map(async pm => {
      const fn = pm.file_no;
      const share = (pm.share_percent||0) / 100;

      const [po, vehicles, expenses, sales, allPartners, payments, payouts] = await Promise.all([
        apiGet('purchase_orders', { select:'*',       system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGet('vehicles',        { select:'*',       system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGet('expenses',        { select:'*',       system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGet('sales',           { select:'*',       system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGet('partners_master', { select:'*',       system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGet('payments',        { select:'*',       system_type:`eq.${sys}`, file_no:`eq.${fn}`, payer:`eq.${partnerName}` }),
        apiGet('partner_payouts', { select:'*',       system_type:`eq.${sys}`, file_no:`eq.${fn}`, partner:`eq.${partnerName}` }),
      ]);

      const poData       = po?.[0] || {};
      const totalPurchase= +poData.total_purchase || (vehicles||[]).reduce((s,v)=>s+(+v.purchase_price||0),0);
      const totalExp     = (expenses||[]).filter(e=>e.post_status==='posted').reduce((s,e)=>s+(+e.amount||0),0);
      const totalSales   = (sales||[]).filter(s=>s.post_status==='posted').reduce((s,s2)=>s+(+s2.sale_price||0),0);
      const fullCost     = totalPurchase + totalExp;
      const dealProfit   = totalSales - fullCost;

      // حصة الشريك
      const myPurchase   = totalPurchase * share;
      const myExpenses   = totalExp * share;
      const myFullCost   = fullCost * share;
      const mySales      = totalSales * share;
      const myProfit     = dealProfit * share;

      // ما دفعه الشريك (posted فقط)
      const capitalPaid  = (payments||[]).filter(p=>p.post_status==='posted').reduce((s,p)=>s+(+p.amount||0),0);

      // ما استرده
      const capitalRet   = (payouts||[]).reduce((s,p)=>s+(+p.capital_amount||0),0);
      const profitTaken  = (payouts||[]).reduce((s,p)=>s+(+p.profit_amount||0),0);
      const advances     = (payouts||[]).reduce((s,p)=>s+(+p.advance_amount||0),0);
      const totalWithdrawn = capitalRet + profitTaken + advances;

      // الرصيد المستحق
      const netDue = capitalPaid + myProfit - totalWithdrawn;

      // ما دفعه كل شركاء الصفقة (مش بس الشريك المطلوب)
      const allPartnersPayments = await apiGet('payments', {
        select:'payer,amount', system_type:`eq.${sys}`, file_no:`eq.${fn}`
      });

      // احسب ما دفعه كل شريك فعلاً
      const paidByPartner = {};
      (allPartnersPayments||[]).forEach(p => {
        paidByPartner[p.payer] = (paidByPartner[p.payer]||0) + (+p.amount||0);
      });

      // حصة كل شريك المفروض يدفعها
      const shouldPayMap = {};
      (allPartners||[]).forEach(p => {
        shouldPayMap[p.partner] = totalPurchase * ((+p.share_percent||0)/100);
      });

      // الديون بين الشركاء
      const partnerDebts = [];
      (allPartners||[]).forEach(p => {
        const name      = p.partner;
        const shouldPay = shouldPayMap[name] || 0;
        const didPay    = paidByPartner[name] || 0;
        const diff      = didPay - shouldPay; // موجب = دفع زيادة، سالب = دفع أقل
        if (Math.abs(diff) > 0.001) {
          partnerDebts.push({ name, shouldPay, didPay, diff });
        }
      });

      return {
        fn, share, poData, vehicles: vehicles||[], expenses: expenses||[],
        sales: sales||[], allPartners: allPartners||[],
        payments: payments||[], payouts: payouts||[],
        totalPurchase, totalExp, totalSales, fullCost, dealProfit,
        myPurchase, myExpenses, myFullCost, mySales, myProfit,
        capitalPaid, capitalRet, profitTaken, advances, totalWithdrawn, netDue,
        status: poData.status || '—', supplier: poData.supplier || '—',
        poDate: poData.po_date || poData.created_at || '',
        partnerDebts, paidByPartner, shouldPayMap,
      };
    }));

    // ── 3. الإجماليات الشاملة ──
    const grandCapital    = dealDetails.reduce((s,d)=>s+d.capitalPaid,   0);
    const grandMyProfit   = dealDetails.reduce((s,d)=>s+d.myProfit,      0);
    const grandWithdrawn  = dealDetails.reduce((s,d)=>s+d.totalWithdrawn,0);
    const grandNetDue     = dealDetails.reduce((s,d)=>s+d.netDue,        0);
    const grandDealProfit = dealDetails.reduce((s,d)=>s+d.dealProfit,    0);

    // ── 4. بناء الـ HTML ──
    const fmt2 = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:3});
    const fmtP = n => ((+n||0)*100).toFixed(1)+'%';
    const statusColor = s => s==='CLOSED'?'#16a34a':s==='IN PROGRESS'?'#d97706':'#2563eb';
    const statusLabel = s => s==='CLOSED'?'مغلقة':s==='IN PROGRESS'?'جارية':s==='OPEN'?'مفتوحة':s;

    const dealBlocks = dealDetails.map(d => `
      <!-- ══ صفقة ${d.fn} ══ -->
      <div style="border:1.5px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:24px;page-break-inside:avoid">

        <!-- رأس الصفقة -->
        <div style="background:#1a1a2e;color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:16px;font-weight:900;font-family:monospace">${d.fn}</span>
            <span style="background:#ffffff22;padding:2px 10px;border-radius:20px;font-size:11px">${d.supplier}</span>
            <span style="background:${statusColor(d.status)}33;color:${statusColor(d.status)};border:1px solid ${statusColor(d.status)}55;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700">${statusLabel(d.status)}</span>
          </div>
          <div style="font-size:12px;opacity:.7">${d.poDate ? 'تاريخ الصفقة: '+d.poDate.split('T')[0] : ''}</div>
        </div>

        <div style="padding:16px">

          <!-- شركاء الصفقة -->
          <div style="margin-bottom:14px">
            <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">شركاء الصفقة</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${d.allPartners.map(p=>`
                <div style="background:${p.partner===partnerName?'#fef3c7':'#f1f5f9'};border:1px solid ${p.partner===partnerName?'#f59e0b':'#e2e8f0'};border-radius:8px;padding:6px 12px;font-size:12px">
                  <span style="font-weight:700;color:${p.partner===partnerName?'#92400e':'#475569'}">${p.partner}</span>
                  <span style="color:#94a3b8;margin-right:6px">${p.share_percent}%</span>
                </div>`).join('')}
            </div>
          </div>

          <!-- السيارات -->
          <div style="margin-bottom:14px">
            <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
              السيارات (${d.vehicles.length} سيارة)
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#f8fafc">
                  <th style="padding:7px 10px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b">#</th>
                  <th style="padding:7px 10px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b">الموديل</th>
                  <th style="padding:7px 10px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b">رقم الشاصي</th>
                  <th style="padding:7px 10px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b">سعر الشراء</th>
                  <th style="padding:7px 10px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b">حصة الشريك (${fmtP(d.share)})</th>
                  <th style="padding:7px 10px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b">الحالة</th>
                </tr>
              </thead>
              <tbody>
                ${d.vehicles.map((v,i)=>{
                  const sold = d.sales.find(s=>s.vin===v.vin);
                  return `<tr style="border-bottom:1px solid #f1f5f9">
                    <td style="padding:7px 10px;color:#94a3b8">${i+1}</td>
                    <td style="padding:7px 10px;font-weight:600">${v.model||v.make||'—'} ${v.year||''}</td>
                    <td style="padding:7px 10px;font-family:monospace;color:#2563eb;font-size:11px">${v.vin||'—'}</td>
                    <td style="padding:7px 10px;font-family:monospace;font-weight:600">${fmt2(v.purchase_price)}</td>
                    <td style="padding:7px 10px;font-family:monospace;color:#d97706">${fmt2((+v.purchase_price||0)*d.share)}</td>
                    <td style="padding:7px 10px">
                      ${sold
                        ? `<span style="background:#f0fdf4;color:#16a34a;border:1px solid #86efac;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700">✓ مباع — ${fmt2(sold.sale_price)}</span>`
                        : `<span style="background:#fef9ec;color:#d97706;border:1px solid #fcd34d;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700">في المخزن</span>`}
                    </td>
                  </tr>`;
                }).join('')}
                <tr style="background:#f8fafc;font-weight:700">
                  <td colspan="3" style="padding:8px 10px;color:#64748b">الإجمالي</td>
                  <td style="padding:8px 10px;font-family:monospace">${fmt2(d.totalPurchase)}</td>
                  <td style="padding:8px 10px;font-family:monospace;color:#d97706">${fmt2(d.myPurchase)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- المصاريف -->
          ${d.expenses.length ? `
          <div style="margin-bottom:14px">
            <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
              المصاريف (${d.expenses.length} بند)
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#fff1f2">
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">البيان</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">النوع</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">التاريخ</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">المبلغ</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">حصة الشريك</th>
                </tr>
              </thead>
              <tbody>
                ${d.expenses.map(e=>`
                <tr style="border-bottom:1px solid #fff1f2">
                  <td style="padding:6px 10px">${e.description||'—'}</td>
                  <td style="padding:6px 10px"><span style="background:#fef2f2;color:#dc2626;padding:1px 6px;border-radius:10px;font-size:10px">${e.exp_type||e.category||'—'}</span></td>
                  <td style="padding:6px 10px;color:#94a3b8">${(e.expense_date||e.exp_date||'').split('T')[0]||'—'}</td>
                  <td style="padding:6px 10px;font-family:monospace;color:#dc2626">${fmt2(e.amount)}</td>
                  <td style="padding:6px 10px;font-family:monospace;color:#dc2626">${fmt2((+e.amount||0)*d.share)}</td>
                </tr>`).join('')}
                <tr style="background:#fff1f2;font-weight:700">
                  <td colspan="3" style="padding:7px 10px;color:#dc2626">إجمالي المصاريف</td>
                  <td style="padding:7px 10px;font-family:monospace;color:#dc2626">${fmt2(d.totalExp)}</td>
                  <td style="padding:7px 10px;font-family:monospace;color:#dc2626">${fmt2(d.myExpenses)}</td>
                </tr>
              </tbody>
            </table>
          </div>` : ''}

          <!-- المبيعات -->
          ${d.sales.length ? `
          <div style="margin-bottom:14px">
            <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
              المبيعات (${d.sales.length} فاتورة)
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#f0fdf4">
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #86efac;color:#16a34a">الشاصي</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #86efac;color:#16a34a">العميل</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #86efac;color:#16a34a">التاريخ</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #86efac;color:#16a34a">سعر البيع</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #86efac;color:#16a34a">حصة الشريك</th>
                </tr>
              </thead>
              <tbody>
                ${d.sales.map(s=>`
                <tr style="border-bottom:1px solid #f0fdf4">
                  <td style="padding:6px 10px;font-family:monospace;color:#2563eb;font-size:11px">${s.vin||'—'}</td>
                  <td style="padding:6px 10px">${s.customer||'—'}</td>
                  <td style="padding:6px 10px;color:#94a3b8">${(s.sale_date||'').split('T')[0]||'—'}</td>
                  <td style="padding:6px 10px;font-family:monospace;color:#16a34a;font-weight:700">${fmt2(s.sale_price)}</td>
                  <td style="padding:6px 10px;font-family:monospace;color:#16a34a">${fmt2((+s.sale_price||0)*d.share)}</td>
                </tr>`).join('')}
                <tr style="background:#f0fdf4;font-weight:700">
                  <td colspan="3" style="padding:7px 10px;color:#16a34a">إجمالي المبيعات</td>
                  <td style="padding:7px 10px;font-family:monospace;color:#16a34a">${fmt2(d.totalSales)}</td>
                  <td style="padding:7px 10px;font-family:monospace;color:#16a34a">${fmt2(d.mySales)}</td>
                </tr>
              </tbody>
            </table>
          </div>` : ''}

          <!-- ملخص الصفقة للشريك -->
          <div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:14px">
            <div style="font-size:11px;font-weight:700;color:#888;margin-bottom:10px">ملخص الصفقة — حصة ${partnerName} (${fmtP(d.share)})</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
              <div style="background:#fff;border-radius:8px;padding:10px;text-align:center;border:1px solid #e2e8f0">
                <div style="font-size:10px;color:#888;margin-bottom:4px">حصته من تكلفة الشراء</div>
                <div style="font-family:monospace;font-weight:700;color:#2563eb">${fmt2(d.myPurchase)}</div>
              </div>
              <div style="background:#fff;border-radius:8px;padding:10px;text-align:center;border:1px solid #e2e8f0">
                <div style="font-size:10px;color:#888;margin-bottom:4px">حصته من المصاريف</div>
                <div style="font-family:monospace;font-weight:700;color:#dc2626">${fmt2(d.myExpenses)}</div>
              </div>
              <div style="background:#fff;border-radius:8px;padding:10px;text-align:center;border:1px solid #e2e8f0">
                <div style="font-size:10px;color:#888;margin-bottom:4px">حصته من المبيعات</div>
                <div style="font-family:monospace;font-weight:700;color:#16a34a">${fmt2(d.mySales)}</div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
              <div style="background:${d.myProfit>=0?'#f0fdf4':'#fff1f2'};border-radius:8px;padding:10px;text-align:center;border:1px solid ${d.myProfit>=0?'#86efac':'#fca5a5'}">
                <div style="font-size:10px;color:#888;margin-bottom:4px">ربح / خسارة الشريك</div>
                <div style="font-family:monospace;font-weight:900;font-size:16px;color:${d.myProfit>=0?'#16a34a':'#dc2626'}">${d.myProfit>=0?'+':''}${fmt2(d.myProfit)}</div>
              </div>
              <div style="background:#f0fdf4;border-radius:8px;padding:10px;text-align:center;border:1px solid #86efac">
                <div style="font-size:10px;color:#888;margin-bottom:4px">ربح الصفقة الكلي</div>
                <div style="font-family:monospace;font-weight:700;color:${d.dealProfit>=0?'#16a34a':'#dc2626'}">${fmt2(d.dealProfit)}</div>
              </div>
            </div>
          </div>

          <!-- ديون بين الشركاء -->
          ${d.partnerDebts && d.partnerDebts.length ? `
          <div style="margin-bottom:14px">
            <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">⚖️ تسوية بين الشركاء</div>
            <div style="background:#f8fafc;border-radius:8px;padding:12px;border:1px solid #e2e8f0">
              <table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead>
                  <tr style="background:#f1f5f9">
                    <th style="padding:7px 10px;text-align:right;color:#64748b">الشريك</th>
                    <th style="padding:7px 10px;text-align:right;color:#64748b">حصته المفروض</th>
                    <th style="padding:7px 10px;text-align:right;color:#64748b">دفع فعلاً</th>
                    <th style="padding:7px 10px;text-align:right;color:#64748b">الفرق</th>
                    <th style="padding:7px 10px;text-align:right;color:#64748b">الوضع</th>
                  </tr>
                </thead>
                <tbody>
                  ${(d.allPartners||[]).map(p => {
                    const should = d.shouldPayMap[p.partner] || 0;
                    const did    = d.paidByPartner[p.partner] || 0;
                    const diff   = did - should;
                    const isMe   = p.partner === partnerName;
                    return `<tr style="border-bottom:1px solid #f1f5f9;${isMe?'background:#fef9ec;font-weight:700':''}">
                      <td style="padding:7px 10px">${p.partner}${isMe?' ★':''}</td>
                      <td style="padding:7px 10px;font-family:monospace">${fmt2(should)}</td>
                      <td style="padding:7px 10px;font-family:monospace">${fmt2(did)}</td>
                      <td style="padding:7px 10px;font-family:monospace;color:${diff>0?'#16a34a':diff<0?'#dc2626':'#64748b'};font-weight:700">
                        ${diff>0?'+':''}${fmt2(diff)}
                      </td>
                      <td style="padding:7px 10px">
                        ${diff > 0.001 
                          ? `<span style="background:#f0fdf4;color:#16a34a;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">دفع زيادة — يستحق ${fmt2(diff)}</span>`
                          : diff < -0.001
                          ? `<span style="background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">مدين بـ ${fmt2(Math.abs(diff))}</span>`
                          : `<span style="background:#f0fdf4;color:#16a34a;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">✓ مسوّى</span>`}
                      </td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
              ${d.partnerDebts.length ? `
              <div style="margin-top:10px;padding:10px;background:#fff;border-radius:6px;border:1px solid #e2e8f0;font-size:12px">
                ${d.partnerDebts.filter(x=>x.diff>0).map(creditor => {
                  const debtors = d.partnerDebts.filter(x=>x.diff<0);
                  return debtors.map(debtor => `
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                      <span style="color:#dc2626;font-weight:700">${debtor.name}</span>
                      <span style="color:#64748b">مدين لـ</span>
                      <span style="color:#16a34a;font-weight:700">${creditor.name}</span>
                      <span style="color:#64748b">بمبلغ</span>
                      <span style="font-family:monospace;font-weight:700;color:#1d4ed8">${fmt2(Math.min(Math.abs(debtor.diff), creditor.diff))}</span>
                    </div>`).join('');
                }).join('')}
              </div>` : ''}
            </div>
          </div>` : ''}

          <!-- الحركات المالية للشريك -->
          <div>
            <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">الحركات المالية</div>
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#1e293b;color:#fff">
                  <th style="padding:8px 10px;text-align:right">التاريخ</th>
                  <th style="padding:8px 10px;text-align:right">البيان</th>
                  <th style="padding:8px 10px;text-align:center">رأس مال دفع</th>
                  <th style="padding:8px 10px;text-align:center">رأس مال استرد</th>
                  <th style="padding:8px 10px;text-align:center">أرباح</th>
                  <th style="padding:8px 10px;text-align:center">سلف</th>
                  <th style="padding:8px 10px;text-align:right">مستند</th>
                </tr>
              </thead>
              <tbody>
                ${d.payments.map(p=>`
                <tr style="background:#eff6ff;border-bottom:1px solid #dbeafe">
                  <td style="padding:7px 10px;color:#64748b">${(p.pay_date||'').split('T')[0]||'—'}</td>
                  <td style="padding:7px 10px;font-weight:600;color:#1d4ed8">دفع رأس مال</td>
                  <td style="padding:7px 10px;text-align:center;font-family:monospace;color:#2563eb;font-weight:700">${fmt2(p.amount)}</td>
                  <td style="padding:7px 10px;text-align:center;color:#94a3b8">—</td>
                  <td style="padding:7px 10px;text-align:center;color:#94a3b8">—</td>
                  <td style="padding:7px 10px;text-align:center;color:#94a3b8">—</td>
                  <td style="padding:7px 10px;font-family:monospace;font-size:11px;color:#94a3b8">${p.document||p.ref_no||'—'}</td>
                </tr>`).join('')}
                ${d.payouts.map(p=>`
                <tr style="border-bottom:1px solid #f1f5f9">
                  <td style="padding:7px 10px;color:#64748b">${(p.pay_date||'').split('T')[0]||'—'}</td>
                  <td style="padding:7px 10px;font-weight:600">${p.payout_type||'صرف'}</td>
                  <td style="padding:7px 10px;text-align:center;color:#94a3b8">—</td>
                  <td style="padding:7px 10px;text-align:center;font-family:monospace;color:${+p.capital_amount?'#d97706':'#94a3b8'}">${+p.capital_amount?fmt2(p.capital_amount):'—'}</td>
                  <td style="padding:7px 10px;text-align:center;font-family:monospace;color:${+p.profit_amount?'#16a34a':'#94a3b8'}">${+p.profit_amount?fmt2(p.profit_amount):'—'}</td>
                  <td style="padding:7px 10px;text-align:center;font-family:monospace;color:${+p.advance_amount?'#dc2626':'#94a3b8'}">${+p.advance_amount?fmt2(p.advance_amount):'—'}</td>
                  <td style="padding:7px 10px;font-family:monospace;font-size:11px;color:#94a3b8">${p.document||p.pay_id||'—'}</td>
                </tr>`).join('')}
              </tbody>
              <tfoot>
                <tr style="background:#1e293b;color:#fff;font-weight:700">
                  <td colspan="2" style="padding:8px 10px">الإجمالي</td>
                  <td style="padding:8px 10px;text-align:center;font-family:monospace;color:#60a5fa">${fmt2(d.capitalPaid)}</td>
                  <td style="padding:8px 10px;text-align:center;font-family:monospace;color:#fbbf24">${fmt2(d.capitalRet)}</td>
                  <td style="padding:8px 10px;text-align:center;font-family:monospace;color:#4ade80">${fmt2(d.profitTaken)}</td>
                  <td style="padding:8px 10px;text-align:center;font-family:monospace;color:#f87171">${fmt2(d.advances)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>

            <!-- الرصيد النهائي للصفقة -->
            <div style="margin-top:10px;background:${d.netDue>=0?'#f0fdf4':'#fff1f2'};border:2px solid ${d.netDue>=0?'#86efac':'#fca5a5'};border-radius:10px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-size:12px;color:#64748b;margin-bottom:2px">الرصيد المستحق للشريك من هذه الصفقة</div>
                <div style="font-size:10px;color:#94a3b8">رأس مال مدفوع + أرباح - إجمالي المسحوبات</div>
                <div style="font-size:10px;color:#94a3b8">${fmt2(d.capitalPaid)} + ${fmt2(d.myProfit)} - ${fmt2(d.totalWithdrawn)}</div>
              </div>
              <div style="font-size:24px;font-weight:900;font-family:monospace;color:${d.netDue>=0?'#16a34a':'#dc2626'}">${d.netDue>=0?'+':''}${fmt2(d.netDue)}</div>
            </div>
          </div>

        </div>
      </div>`).join('');

    // حساب إجمالي الديون للشريك المطلوب عبر كل الصفقات
    const totalOverpaid  = dealDetails.reduce((s,d) => {
      const diff = (d.paidByPartner?.[partnerName]||0) - (d.shouldPayMap?.[partnerName]||0);
      return s + (diff > 0 ? diff : 0);
    }, 0);
    const totalUnderpaid = dealDetails.reduce((s,d) => {
      const diff = (d.paidByPartner?.[partnerName]||0) - (d.shouldPayMap?.[partnerName]||0);
      return s + (diff < 0 ? Math.abs(diff) : 0);
    }, 0);

    // ── الملخص الشامل (لو أكثر من صفقة) ──
    const summaryBlock = dealDetails.length > 1 ? `
      <div style="background:#1a1a2e;color:#fff;border-radius:12px;padding:20px;margin-bottom:24px">
        <div style="font-size:13px;font-weight:700;margin-bottom:14px;opacity:.7;letter-spacing:.5px">الملخص الشامل — كل الصفقات</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px">
          ${dealDetails.map(d=>`
          <div style="background:#ffffff11;border-radius:8px;padding:10px;border-right:3px solid ${d.netDue>=0?'#4ade80':'#f87171'}">
            <div style="font-size:11px;opacity:.7;margin-bottom:4px">${d.fn} — ${d.supplier}</div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:11px;opacity:.6">حصة ${fmtP(d.share)}</span>
              <span style="font-family:monospace;font-weight:700;color:${d.netDue>=0?'#4ade80':'#f87171'}">${d.netDue>=0?'+':''}${fmt2(d.netDue)}</span>
            </div>
          </div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;border-top:1px solid #ffffff22;padding-top:14px">
          <div style="text-align:center">
            <div style="font-size:10px;opacity:.6;margin-bottom:4px">إجمالي رأس المال</div>
            <div style="font-family:monospace;font-size:16px;font-weight:700;color:#60a5fa">${fmt2(grandCapital)}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:10px;opacity:.6;margin-bottom:4px">إجمالي الأرباح</div>
            <div style="font-family:monospace;font-size:16px;font-weight:700;color:${grandMyProfit>=0?'#4ade80':'#f87171'}">${fmt2(grandMyProfit)}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:10px;opacity:.6;margin-bottom:4px">إجمالي المسحوبات</div>
            <div style="font-family:monospace;font-size:16px;font-weight:700;color:#fbbf24">${fmt2(grandWithdrawn)}</div>
          </div>
          <div style="text-align:center;background:${grandNetDue>=0?'#16a34a33':'#dc262633'};border-radius:8px;padding:8px">
            <div style="font-size:10px;opacity:.8;margin-bottom:4px">الرصيد الكلي المستحق</div>
            <div style="font-family:monospace;font-size:20px;font-weight:900;color:${grandNetDue>=0?'#4ade80':'#f87171'}">${grandNetDue>=0?'+':''}${fmt2(grandNetDue)}</div>
          </div>
        </div>
        ${(totalOverpaid > 0.001 || totalUnderpaid > 0.001) ? `
        <div style="margin-top:12px;border-top:1px solid #ffffff22;padding-top:12px">
          <div style="font-size:11px;opacity:.7;margin-bottom:8px">⚖️ وضع التسوية مع الشركاء</div>
          ${totalOverpaid > 0.001 ? `
          <div style="background:#16a34a22;border-radius:6px;padding:8px 12px;font-size:12px;margin-bottom:6px">
            <span style="color:#4ade80;font-weight:700">${partnerName}</span>
            <span style="opacity:.8"> دفع زيادة عن حصته بإجمالي </span>
            <span style="font-family:monospace;font-weight:900;color:#4ade80">+${fmt2(totalOverpaid)}</span>
            <span style="opacity:.8"> — يستحق استردادها من الشركاء</span>
          </div>` : ''}
          ${totalUnderpaid > 0.001 ? `
          <div style="background:#dc262622;border-radius:6px;padding:8px 12px;font-size:12px">
            <span style="color:#f87171;font-weight:700">${partnerName}</span>
            <span style="opacity:.8"> لم يدفع كامل حصته — متبقي عليه </span>
            <span style="font-family:monospace;font-weight:900;color:#f87171">${fmt2(totalUnderpaid)}</span>
          </div>` : ''}
        </div>` : `
        <div style="margin-top:10px;border-top:1px solid #ffffff22;padding-top:10px;text-align:center;font-size:11px;opacity:.6">
          ✓ التسوية مع الشركاء مكتملة
        </div>`}
      </div>` : '';

    // ── التجميع الكامل ──
    const fullHTML = `
      <div id="partnerStatementContent" style="background:var(--bg,#f8fafc);min-width:min(800px,95vw);max-width:900px;font-family:'Cairo',sans-serif;direction:rtl">

        <!-- هيدر الكشف -->
        <div style="background:#1a1a2e;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-size:22px;font-weight:900;margin-bottom:4px">${partnerName}</div>
            <div style="font-size:13px;opacity:.7">كشف حساب شامل — نظام ${sys}</div>
            <div style="font-size:12px;opacity:.5;margin-top:2px">${fileNoFilter ? 'صفقة: '+fileNoFilter : dealDetails.length+' صفقة'} · ${new Date().toLocaleDateString('en-GB')}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button id="partnerPdfBtn" onclick="exportPartnerStatementPDF()" style="background:#e6930a;color:#000;border:none;border-radius:8px;padding:8px 16px;font-family:'Cairo',sans-serif;font-size:12px;font-weight:700;cursor:pointer">📥 تصدير PDF</button>
            <button onclick="printPartnerStatement()" style="background:#ffffff22;color:#fff;border:1px solid #ffffff44;border-radius:8px;padding:8px 16px;font-family:'Cairo',sans-serif;font-size:12px;cursor:pointer">🖨️ طباعة</button>
            <button onclick="document.getElementById('partnerStatementOverlay').remove()" style="background:#ffffff11;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-family:'Cairo',sans-serif;font-size:12px;cursor:pointer">✕ إغلاق</button>
          </div>
        </div>

        <div style="padding:20px;max-height:75vh;overflow-y:auto">
          ${summaryBlock}
          ${dealBlocks}
        </div>

      </div>`;

    overlay.innerHTML = `<div style="max-height:90vh;overflow:hidden;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.5)">${fullHTML}</div>`;

  } catch(e) {
    overlay.remove();
    toast('خطأ في إعداد الكشف: '+e.message,'err');
    console.error(e);
  }
}

// ── تصدير كشف الشريك PDF ──
async function exportPartnerStatementPDF() {
  const content = document.getElementById('partnerStatementContent');
  if (!content) return;

  const btn = document.getElementById('partnerPdfBtn');
  if (btn) { btn.textContent = '⏳ جاري التصدير...'; btn.disabled = true; }

  try {
    // Load libraries if not loaded
    if (!window.html2canvas) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }
    if (!window.jspdf) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    }

    const { jsPDF } = window.jspdf;

    // Temporarily expand content for capture
    const scrollEl = content.closest('[style*="overflow"]');
    const origMaxH = scrollEl ? scrollEl.style.maxHeight : null;
    const origOverflow = scrollEl ? scrollEl.style.overflow : null;
    if (scrollEl) { scrollEl.style.maxHeight = 'none'; scrollEl.style.overflow = 'visible'; }

    const canvas = await html2canvas(content, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#f8fafc',
      logging: false,
      scrollX: 0,
      scrollY: -window.scrollY,
    });

    // Restore
    if (scrollEl) { scrollEl.style.maxHeight = origMaxH; scrollEl.style.overflow = origOverflow; }

    const imgData  = canvas.toDataURL('image/jpeg', 0.92);
    const pdf      = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const pageW    = pdf.internal.pageSize.getWidth();
    const pageH    = pdf.internal.pageSize.getHeight();
    const margin   = 10;
    const imgW     = pageW - margin * 2;
    const imgH     = (canvas.height * imgW) / canvas.width;
    const totalPages = Math.ceil(imgH / (pageH - margin * 2));

    for (let i = 0; i < totalPages; i++) {
      if (i > 0) pdf.addPage();
      const srcY  = i * (pageH - margin * 2) * (canvas.width / imgW);
      const sliceH = Math.min((pageH - margin * 2) * (canvas.width / imgW), canvas.height - srcY);
      const sliceCanvas  = document.createElement('canvas');
      sliceCanvas.width  = canvas.width;
      sliceCanvas.height = sliceH;
      sliceCanvas.getContext('2d').drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.92);
      pdf.addImage(sliceData, 'JPEG', margin, margin, imgW, sliceH * (imgW / canvas.width));
    }

    // Build filename
    const partnerName = content.querySelector('[style*="font-size:22px"]')?.textContent?.trim() || 'شريك';
    const dateStr = new Date().toISOString().split('T')[0];
    pdf.save(`كشف_حساب_${partnerName}_${dateStr}.pdf`);
    toast('✅ تم تصدير PDF بنجاح', 'ok');

  } catch(e) {
    toast('خطأ في التصدير: ' + e.message, 'err');
    console.error(e);
  } finally {
    if (btn) { btn.textContent = '📥 تصدير PDF'; btn.disabled = false; }
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// للطباعة
function printPartnerStatement() {
  const content = document.getElementById('partnerStatementContent');
  if (!content) return;
  openPrintOverlay(`<!DOCTYPE html><html dir="rtl"><head>    <meta charset="UTF-8">    <title>كشف حساب شريك</title>    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">    <style>      *{box-sizing:border-box;margin:0;padding:0}      body{font-family:'Cairo',sans-serif;direction:rtl;background:#fff;padding:20px;font-size:12px;color:#1a1a2e}      @media print{body{padding:10px}@page{margin:15mm;size:A4}}      table{border-collapse:collapse;width:100%}      th,td{padding:6px 8px}    </style>  </head><body>${content.outerHTML}<script>window.onload=()=>window.print()<\/script></body></html>`);

}

function openPartnerStatementFromReport() {
  const partner = el('report-partner-select')?.value;
  if (!partner) { toast('اختر شريكاً أولاً','err'); return; }
  showPartnerStatement(partner);
}

// Backward compat
async function showPartnerDealStatement(fileNo, partner, sys) {
  await showPartnerStatement(partner, fileNo);
}

// ════════════════════════════════════════
// CONTACTS BY TYPE SHORTCUT
// ════════════════════════════════════════
function showContactsByType(type) {
  showContacts(type);
}

// ════════════════════════════════════════
// ALL SALES VIEW
// ════════════════════════════════════════
async function showAllSales() {
  hideAllViews();
  el('allSalesView').style.display = 'block';
  el('topBarTitle').textContent = 'كل المبيعات';
  navActive('');
  await loadAllSales();
}

async function loadAllSales() {
  el('allSalesTable').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  try {
    await ensureCache();
    const data = [...state.allSales].sort((a,b)=>(b.sale_date||'').localeCompare(a.sale_date||''));
    if (!data?.length) { el('allSalesTable').innerHTML = emptyHTML('🤝','لا توجد مبيعات'); return; }
    const total = data.reduce((s,r)=>s+(+r.sale_price||0),0);
    const rows = data.map(s=>`<tr onclick="openViewer('${s.file_no}')" style="cursor:pointer">
      <td class="mono text-muted">${fmtDate(s.sale_date)}</td>
      <td><span class="mono text-amber">${s.file_no||'—'}</span></td>
      <td class="mono" style="direction:ltr">${s.vin||'—'}</td>
      <td>${s.customer||'—'}</td>
      <td class="mono text-muted">${s.inv_no||'—'}</td>
      <td class="mono text-green">${fmt(s.sale_price)}</td>
    </tr>`).join('');
    el('allSalesTable').innerHTML = `<table class="data-table">
      <thead><tr><th>التاريخ</th><th>الملف</th><th>VIN</th><th>العميل</th><th>الفاتورة</th><th>السعر</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot style="background:var(--card2)"><tr>
        <td colspan="5" style="padding:10px 16px;font-weight:700">الإجمالي (${data.length})</td>
        <td class="mono text-green" style="padding:10px 16px;font-weight:700">${fmt(total)}</td>
      </tr></tfoot></table>`;
  } catch(e) { el('allSalesTable').innerHTML = errHTML(e.message); }
}

// ════════════════════════════════════════
// ALL COLLECTIONS VIEW
// ════════════════════════════════════════
async function showAllCollections() {
  hideAllViews();
  el('allCollectionsView').style.display = 'block';
  el('topBarTitle').textContent = 'كل التحصيلات';
  navActive('');
  await loadAllCollections();
}

async function loadAllCollections() {
  el('allCollectionsTable').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  try {
    await ensureCache();
    const data = [...state.allCollections].sort((a,b)=>(b.paid_date||'').localeCompare(a.paid_date||''));
    if (!data?.length) { el('allCollectionsTable').innerHTML = emptyHTML('💰','لا توجد تحصيلات'); return; }
    const total = data.reduce((s,r)=>s+(+r.amount||0),0);
    const rows = data.map(r=>`<tr onclick="openViewer('${r.file_no}')" style="cursor:pointer">
      <td class="mono text-muted">${fmtDate(r.paid_date)}</td>
      <td><span class="mono text-amber">${r.file_no||'—'}</span></td>
      <td>${r.customer||'—'}</td>
      <td class="mono text-muted">${r.inv_no||'—'}</td>
      <td>${r.pay_method||'—'}</td>
      <td class="mono text-blue">${fmt(r.amount)}</td>
    </tr>`).join('');
    el('allCollectionsTable').innerHTML = `<table class="data-table">
      <thead><tr><th>التاريخ</th><th>الملف</th><th>العميل</th><th>الفاتورة</th><th>الطريقة</th><th>المبلغ</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot style="background:var(--card2)"><tr>
        <td colspan="5" style="padding:10px 16px;font-weight:700">الإجمالي (${data.length})</td>
        <td class="mono text-blue" style="padding:10px 16px;font-weight:700">${fmt(total)}</td>
      </tr></tfoot></table>`;
  } catch(e) { el('allCollectionsTable').innerHTML = errHTML(e.message); }
}

// ════════════════════════════════════════
// REPORTS
// ════════════════════════════════════════
const reportState = { type:'profit', data:[] };

async function apiGetDateRange(table, dateCol, from, to, extra={}) {
  let url = `${SB_URL}/rest/v1/${table}?system_type=eq.${encodeURIComponent(state.system)}&${dateCol}=gte.${encodeURIComponent(from)}&${dateCol}=lte.${encodeURIComponent(to)}`;
  for (const [k,v] of Object.entries(extra)) url += `&${k}=${encodeURIComponent(v)}`;
  let res = await fetch(url, { headers: headers() });
  if (res.status === 401) { const ok = await refreshAccessToken(); if(!ok) throw new Error('انتهت الجلسة'); res = await fetch(url,{headers:headers()}); }
  if (!res.ok) { const e = await res.json(); throw new Error(e.message||res.statusText); }
  return res.json();
}

function showReport(type) {
  sessionStorage.setItem('tm_last_view','report:'+type);
  hideAllViews();
  el('reportsView').style.display = 'block';
  const _rt={profit:'الأرباح والخسائر',cashflow:'التدفقات النقدية',inventory:'تقرير المخزون',sales:'المبيعات',expenses:'المصاريف',partners:'الشركاء',opex:'التشغيلية'};
  el('topBarTitle').textContent = _rt[type]||'التقارير';
  navActive('');
  const now = new Date();
  const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0');
  if (!el('r-from').value) el('r-from').value = `${y}-${m}-01`;
  if (!el('r-to').value)   el('r-to').value   = today();
  setReportType(type);
}

function setReportType(type) {
  reportState.type = type;
  document.querySelectorAll('[id^="rtype-"]').forEach(b => b.classList.remove('active'));
  el('rtype-' + type)?.classList.add('active');
  runReport();
}

async function runReport() {
  const from = el('r-from').value;
  const to   = el('r-to').value;
  if (!from || !to) return;
  const sys  = state.system;
  const type = reportState.type;
  el('reportTable').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري إعداد التقرير...</div>';
  el('reportKpis').innerHTML = '';

  try {
    if (type === 'profit') {
      await ensureCache();
      const [salesPeriod, opexItems] = await Promise.all([
        apiGetDateRange('sales', 'sale_date', from, to),
        fetchOpexForJournal(from, to, sys),
      ]);
      const sales    = salesPeriod;
      const expenses = state.allExpenses;
      const deals    = state.allDeals;

      // Map التكاليف
      const dealMap = {};
      (deals||[]).forEach(d => { dealMap[d.file_no] = d; });

      // تجميع المبيعات بالملف أولاً
      const salesByFile = {};
      (sales||[]).forEach(r => {
        salesByFile[r.file_no] = (salesByFile[r.file_no]||0) + (+r.sale_price||0);
      });

      // بناء fileMap — كل الصفقات (بمبيعات أو بدون)
      const allFileNos = new Set([...Object.keys(salesByFile), ...Object.keys(dealMap)]);
      const fileMap = {};
      allFileNos.forEach(fn => {
        const d = dealMap[fn] || {};
        const fe = (expenses||[]).filter(e=>e.file_no===fn).reduce((s,e)=>s+(+e.amount||0),0);
        fileMap[fn] = {
          file:     fn,
          supplier: d.supplier || '—',
          purchase: +d.total_purchase || 0,
          expenses: fe,
          sales:    salesByFile[fn] || 0,
          status:   d.status || '—',
        };
      });

      const rows_data = Object.values(fileMap).map(v => ({
        ...v,
        fullCost: v.purchase + v.expenses,
        profit:   v.sales - v.purchase - v.expenses,
      })).sort((a,b) => b.profit - a.profit);

      const ts         = rows_data.reduce((s,v)=>s+v.sales, 0);
      const tp         = rows_data.reduce((s,v)=>s+v.purchase, 0);
      const te         = rows_data.reduce((s,v)=>s+v.expenses, 0);
      const dealProfit = ts - tp - te;
      const opexTotal  = (opexItems||[]).reduce((s,r)=>s+(+r.amount||0), 0);
      const netProfit  = dealProfit - opexTotal;

      el('reportKpis').innerHTML = `
        <div class="j-kpi" style="border-right:3px solid var(--green)">
          <div class="j-kpi-label">إجمالي المبيعات</div>
          <div class="j-kpi-val text-green">${fmt(ts)}</div>
        </div>
        <div class="j-kpi" style="border-right:3px solid var(--blue)">
          <div class="j-kpi-label">تكلفة الشراء</div>
          <div class="j-kpi-val text-blue">${fmt(tp)}</div>
        </div>
        <div class="j-kpi" style="border-right:3px solid var(--red)">
          <div class="j-kpi-label">مصاريف الصفقات</div>
          <div class="j-kpi-val text-red">${fmt(te)}</div>
        </div>
        <div class="j-kpi" style="border-right:3px solid var(--accent);background:var(--accent-dim)">
          <div class="j-kpi-label">ربح الصفقات</div>
          <div class="j-kpi-val" style="color:${dealProfit>=0?'var(--green)':'var(--red)'};font-size:20px">${fmt(dealProfit)}</div>
        </div>
        <div class="j-kpi" style="border-right:3px solid var(--purple)">
          <div class="j-kpi-label">المصاريف التشغيلية</div>
          <div class="j-kpi-val text-purple">${fmt(opexTotal)}</div>
          <div style="font-size:10px;color:var(--text2);margin-top:2px">إيجار، رواتب، إلخ</div>
        </div>
        <div class="j-kpi" style="border-right:3px solid ${netProfit>=0?'var(--green)':'var(--red)'};background:${netProfit>=0?'var(--green-dim)':'var(--red-dim)'}">
          <div class="j-kpi-label">صافي ربح الشركة</div>
          <div class="j-kpi-val" style="color:${netProfit>=0?'var(--green)':'var(--red)'};font-size:20px;font-weight:900">${fmt(netProfit)}</div>
          <div style="font-size:10px;color:var(--text2);margin-top:2px">بعد خصم التشغيلية</div>
        </div>`;

      // إثراء rows_data من allDealsEnriched
      const enriched = state.allDealsEnriched || [];
      const enrichMap = {};
      enriched.forEach(d => { enrichMap[d.file_no] = d; });

      reportState.data = rows_data;

      // دمج بيانات الـ enriched مع rows_data
      const enrichedRows = rows_data.map(v => {
        const en = enrichMap[v.file] || {};
        return { ...v,
          file_no: v.file, supplier: v.supplier, notes: en.notes||'',
          po_date: en.po_date||'', status: v.status,
          _vTotal: en._vTotal||0, _vSold: en._vSold||0, _vLeft: en._vLeft||0,
          _totalCost: v.purchase, _totalExp: v.expenses,
          _fullCost: v.fullCost, _totalSale: v.sales, _profit: v.profit,
        };
      });

      el('reportTable').innerHTML = enrichedRows.length
        ? '<div id="reportDealsTable"></div>'
        : emptyHTML('📈','لا توجد بيانات في هذه الفترة');

      if (enrichedRows.length) {
        renderDealsTable(enrichedRows, 'reportDealsTable', { showSales: true, totalRow: true });
      }

    } else if (type === 'sales') {
      await ensureCache();
      const data = state.allSales.filter(s => {
        const d = s.sale_date || s.created_at?.split('T')[0] || '';
        return d >= from && d <= to;
      }).sort((a,b)=>(b.sale_date||'').localeCompare(a.sale_date||''));
      const total = data.reduce((s,r)=>s+(+r.sale_price||0),0);
      reportState.data = data;
      el('reportKpis').innerHTML = `
        <div class="j-kpi"><div class="j-kpi-label">عدد المبيعات</div><div class="j-kpi-val">${data.length}</div></div>
        <div class="j-kpi"><div class="j-kpi-label">إجمالي</div><div class="j-kpi-val text-green">${fmt(total)}</div></div>`;
      const rows = data.map(s=>`<tr onclick="openViewer('${s.file_no}')" style="cursor:pointer">
        <td class="mono text-muted">${fmtDate(s.sale_date)}</td><td class="mono text-amber">${s.file_no}</td>
        <td class="mono" style="direction:ltr">${s.vin||'—'}</td><td>${s.customer||'—'}</td>
        <td class="mono text-green">${fmt(s.sale_price)}</td></tr>`).join('');
      el('reportTable').innerHTML = rows ? `<table class="data-table"><thead><tr><th>التاريخ</th><th>الملف</th><th>VIN</th><th>العميل</th><th>السعر</th></tr></thead><tbody>${rows}</tbody></table>` : emptyHTML('💹','لا توجد مبيعات');

    } else if (type === 'expenses') {
      await ensureCache();
      const data = state.allExpenses.filter(e => {
        const d = e.exp_date || e.expense_date || e.created_at?.split('T')[0] || '';
        return d >= from && d <= to;
      }).sort((a,b)=>(b.exp_date||'').localeCompare(a.exp_date||''));
      const total = data.reduce((s,r)=>s+(+r.amount||0),0);
      reportState.data = data;
      el('reportKpis').innerHTML = `
        <div class="j-kpi"><div class="j-kpi-label">عدد المصاريف</div><div class="j-kpi-val">${data.length}</div></div>
        <div class="j-kpi"><div class="j-kpi-label">إجمالي</div><div class="j-kpi-val text-red">${fmt(total)}</div></div>`;
      const rows = data.map(e=>`<tr>
        <td class="mono text-muted">${fmtDate(e.exp_date||e.expense_date)}</td><td class="mono text-amber">${e.file_no||'—'}</td>
        <td>${e.description||'—'}</td><td>${e.exp_type||e.category||'—'}</td>
        <td class="mono text-red">${fmt(e.amount)}</td></tr>`).join('');
      el('reportTable').innerHTML = rows ? `<table class="data-table"><thead><tr><th>التاريخ</th><th>الملف</th><th>البيان</th><th>النوع</th><th>المبلغ</th></tr></thead><tbody>${rows}</tbody></table>` : emptyHTML('💸','لا توجد مصاريف');

    } else if (type === 'partners') {
      await ensureCache();
      const [payouts, allPartnerDeals] = await Promise.all([
        apiGetDateRange('partner_payouts','pay_date',from,to,{order:'pay_date.desc'}),
        apiGet('partners_master',{ select:'partner', system_type:`eq.${sys}` }),
      ]);
      // payments من الـ cache مع فلتر تاريخ
      const payments = state.allPayments
        ? state.allPayments.filter(p => { const d = p.pay_date||''; return d >= from && d <= to; })
        : await apiGetDateRange('payments','pay_date',from,to);

      // قائمة الشركاء الفريدة
      const uniquePartners = [...new Set((allPartnerDeals||[]).map(p=>p.partner))].filter(Boolean);

      const tp  = (payments||[]).reduce((s,r)=>s+(+r.amount||0),0);
      const tpo = (payouts||[]).reduce((s,r)=>s+(+r.amount||0),0);
      reportState.data = payouts||[];

      el('reportKpis').innerHTML = `
        <div class="j-kpi"><div class="j-kpi-label">دفعات للموردين</div><div class="j-kpi-val text-cyan">${fmt(tp)}</div></div>
        <div class="j-kpi"><div class="j-kpi-label">صرف للشركاء</div><div class="j-kpi-val text-purple">${fmt(tpo)}</div></div>
        <div class="j-kpi" style="border-right:3px solid var(--accent)">
          <div class="j-kpi-label">كشف شامل لشريك</div>
          <div style="margin-top:6px">
            <select id="report-partner-select" style="background:var(--card2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:5px 10px;color:var(--text);font-family:'Cairo',sans-serif;font-size:12px;width:100%">
              <option value="">اختر شريكاً...</option>
              ${uniquePartners.map(p=>`<option value="${p}">${p}</option>`).join('')}
            </select>
            <button onclick="openPartnerStatementFromReport()" class="btn btn-primary btn-sm" style="margin-top:6px;width:100%">📋 عرض الكشف</button>
          </div>
        </div>`;

      const rows = (payouts||[]).map(p=>`<tr>
        <td class="mono text-muted">${fmtDate(p.pay_date)}</td>
        <td class="mono text-amber">${p.file_no||'—'}</td>
        <td>${p.partner||'—'}</td>
        <td>${p.payout_type||'—'}</td>
        <td class="mono text-purple">${fmt(p.amount)}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="showPartnerStatement('${p.partner}')">📋 كشف شامل</button></td>
      </tr>`).join('');
      el('reportTable').innerHTML = rows
        ? `<table class="data-table"><thead><tr><th>التاريخ</th><th>الملف</th><th>الشريك</th><th>النوع</th><th>المبلغ</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : emptyHTML('👥','لا توجد بيانات');
    }
    if (type === 'inventory') {
      await runInventoryReport(sys);
      return;
    }
    if (type === 'cashflow') { await runCashFlowReport(from, to, sys); return; }
    if (type === 'opex') {
      await loadOpexReport(from, to);
    }
  } catch(e) { el('reportTable').innerHTML = errHTML('خطأ: '+e.message); console.error(e); }
}

// ════════════════════════════════════════
// CASH FLOW REPORT
// ════════════════════════════════════════
async function runCashFlowReport(from, to, sys) {
  el('reportKpis').innerHTML = '';
  el('reportTable').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري إعداد تقرير التدفقات...</div>';
  try {
    const toEOD = to + 'T23:59:59';
    // جيب كل البيانات بدون فلتر post_status — التقرير يعرض الكل
    async function cfGet(table, dateCol) {
      const url = `${SB_URL}/rest/v1/${table}?system_type=eq.${encodeURIComponent(sys)}&${dateCol}=gte.${encodeURIComponent(from)}&${dateCol}=lte.${encodeURIComponent(toEOD)}&order=${dateCol}.desc`;
      const r = await fetch(url, { headers: headers() });
      if (!r.ok) return [];
      return r.json();
    }
    const [collections, payments, expenses, payouts, opexItems] = await Promise.all([
      cfGet('collections',     'paid_date'),
      cfGet('payments',        'pay_date'),
      cfGet('expenses',        'exp_date'),
      cfGet('partner_payouts', 'pay_date'),
      fetchOpexForJournal(from, to, sys),
    ]);

    // فلتر post_status
    const postFilter = el('r-post-filter')?.value || 'all';
    const filterFn = arr => {
      if (postFilter === 'all') return arr||[];
      return (arr||[]).filter(r => {
        if (postFilter === 'posted') return r.post_status === 'posted' || !r.post_status;
        if (postFilter === 'draft')  return r.post_status === 'draft';
        return true;
      });
    };

    const inC   = filterFn(collections).reduce((s,r)=>s+(+r.amount||0),0);
    const outP  = filterFn(payments).reduce((s,r)=>s+(+r.amount||0),0);
    const outE  = filterFn(expenses).reduce((s,r)=>s+(+r.amount||0),0);
    const outPo = filterFn(payouts).reduce((s,r)=>s+(+r.amount||0),0);
    const outO  = filterFn(opexItems).reduce((s,r)=>s+(+r.amount||0),0);

    const totalIn  = inC;
    const totalOut = outP + outE + outPo + outO;
    const net      = totalIn - totalOut;

    const draftCount = (collections||[]).filter(r=>r.post_status==='draft').length +
                       (payments||[]).filter(r=>r.post_status==='draft').length +
                       (expenses||[]).filter(r=>r.post_status==='draft').length +
                       (payouts||[]).filter(r=>r.post_status==='draft').length;

    const draftNote = postFilter==='all' && draftCount > 0
      ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:var(--radius-sm);padding:7px 12px;font-size:11px;color:#92400e;margin-top:8px">
          ⏳ يشمل ${draftCount} عملية معلقة — غيّر الفلتر لعرض المرحَّل فقط
         </div>` : '';

    el('reportKpis').innerHTML = `
      <div class="j-kpi" style="border-right:3px solid var(--green);background:var(--green-dim)">
        <div class="j-kpi-label">💚 إجمالي الداخل</div>
        <div class="j-kpi-val text-green" style="font-size:20px;font-weight:900">${fmt(totalIn)}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:2px">تحصيلات العملاء (${all(collections).length} عملية)</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--red);background:var(--red-dim)">
        <div class="j-kpi-label">❤️ إجمالي الخارج</div>
        <div class="j-kpi-val text-red" style="font-size:20px;font-weight:900">${fmt(totalOut)}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:2px">دفعات + مصاريف + صرف + تشغيلية</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid ${net>=0?'var(--green)':'var(--red)'};background:${net>=0?'var(--green-dim)':'var(--red-dim)'}">
        <div class="j-kpi-label">💵 صافي التدفق</div>
        <div class="j-kpi-val" style="color:${net>=0?'var(--green)':'var(--red)'};font-size:22px;font-weight:900">${net>=0?'+':''}${fmt(net)}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:2px">${net>=0?'▲ موجب':'▼ سالب'}</div>
      </div>
      ${draftNote}`;

    const breakdown=[
      {label:'تحصيلات العملاء',amount:inC,  dir:+1,icon:'💰',color:'var(--green)', count:filterFn(collections).length},
      {label:'دفعات للموردين', amount:outP,  dir:-1,icon:'💳',color:'var(--cyan)',  count:filterFn(payments).length},
      {label:'مصاريف الصفقات', amount:outE,  dir:-1,icon:'💸',color:'var(--red)',   count:filterFn(expenses).length},
      {label:'صرف الشركاء',    amount:outPo, dir:-1,icon:'👥',color:'var(--purple)',count:filterFn(payouts).length},
      {label:'مصاريف تشغيلية',amount:outO,  dir:-1,icon:'💼',color:'var(--text2)', count:filterFn(opexItems).length},
    ];

    const months={};
    const addM=(d,a,dir)=>{if(!d)return;const m=d.slice(0,7);if(!months[m])months[m]={in:0,out:0};if(dir>0)months[m].in+=a;else months[m].out+=a;};
    filterFn(collections).forEach(r=>addM(r.paid_date||r.due_date,+r.amount||0,+1));
    filterFn(payments).forEach(r=>addM(r.pay_date,+r.amount||0,-1));
    filterFn(expenses).forEach(r=>addM(r.exp_date||r.expense_date,+r.amount||0,-1));
    filterFn(payouts).forEach(r=>addM(r.pay_date,+r.amount||0,-1));
    filterFn(opexItems).forEach(r=>addM(r.exp_date,+r.amount||0,-1));
    const mks=Object.keys(months).sort();
    const mx=Math.max(...mks.map(m=>Math.max(months[m].in,months[m].out)),1);
    const bar=(v,col)=>`<div style="height:6px;background:${col};border-radius:3px;width:${Math.round(v/mx*100)}%;margin-top:3px;min-width:${v>0?'4px':'0'}"></div>`;

    const detailRows=breakdown.map(b=>{
      const pct=b.dir>0?(totalIn>0?Math.round(b.amount/totalIn*100):0):(totalOut>0?Math.round(b.amount/totalOut*100):0);
      return `<tr><td><div style="display:flex;align-items:center;gap:8px"><span style="font-size:18px">${b.icon}</span><div><div style="font-weight:600;font-size:13px">${b.label}</div><div style="font-size:11px;color:var(--text2)">${b.count} عملية</div></div></div></td><td style="text-align:center"><span style="background:${b.dir>0?'var(--green-dim)':'var(--red-dim)'};color:${b.dir>0?'var(--green)':'var(--red)'};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700">${b.dir>0?'↑ داخل':'↓ خارج'}</span></td><td class="mono" style="font-weight:700;color:${b.color};font-size:14px">${fmt(b.amount)}</td><td><div style="background:var(--card2);border-radius:4px;height:8px;overflow:hidden;min-width:80px"><div style="width:${pct}%;height:100%;background:${b.color};border-radius:4px"></div></div><div style="font-size:10px;color:var(--text2);margin-top:2px">${pct}%</div></td></tr>`;
    }).join('');

    const monthRows=mks.map(m=>{const n=months[m].in-months[m].out;return `<tr><td style="font-family:monospace">${m}</td><td><div class="mono text-green">${fmt(months[m].in)}</div>${bar(months[m].in,'var(--green)')}</td><td><div class="mono text-red">${fmt(months[m].out)}</div>${bar(months[m].out,'var(--red)')}</td><td class="mono" style="font-weight:700;color:${n>=0?'var(--green)':'var(--red)'}">${n>=0?'+':''}${fmt(n)}</td></tr>`;}).join('');

    reportState.data=breakdown.map(b=>({البند:b.label,الاتجاه:b.dir>0?'داخل':'خارج',المبلغ:b.amount,العمليات:b.count}));
    el('reportTable').innerHTML=`
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:16px">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:13px;display:flex;justify-content:space-between"><span>📊 تفصيل مصادر التدفق</span><span style="font-size:11px;color:var(--text2)">${from} — ${to}</span></div>
        <table class="data-table"><thead><tr><th>البند</th><th style="text-align:center">الاتجاه</th><th>المبلغ</th><th style="min-width:120px">النسبة</th></tr></thead><tbody>${detailRows}</tbody>
        <tfoot style="background:var(--card2)"><tr><td colspan="2" style="padding:10px 16px;font-weight:700">صافي التدفق النقدي</td><td class="mono" style="padding:10px 16px;font-weight:900;font-size:15px;color:${net>=0?'var(--green)':'var(--red)'}">${net>=0?'+':''}${fmt(net)}</td><td></td></tr></tfoot></table>
      </div>
      ${mks.length>1?`<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden"><div style="padding:12px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:13px">📅 التحليل الشهري</div><table class="data-table"><thead><tr><th>الشهر</th><th style="color:var(--green)">↑ داخل</th><th style="color:var(--red)">↓ خارج</th><th>الصافي</th></tr></thead><tbody>${monthRows}</tbody><tfoot style="background:var(--card2)"><tr><td style="padding:10px 16px;font-weight:700">الإجمالي</td><td class="mono text-green" style="padding:10px 16px;font-weight:700">${fmt(totalIn)}</td><td class="mono text-red" style="padding:10px 16px;font-weight:700">${fmt(totalOut)}</td><td class="mono" style="padding:10px 16px;font-weight:900;color:${net>=0?'var(--green)':'var(--red)'}">${net>=0?'+':''}${fmt(net)}</td></tr></tfoot></table></div>`:''}`;
  } catch(e) { el('reportTable').innerHTML=`<div class="empty-state"><div class="e-icon">⚠️</div><p>خطأ: ${e.message}</p></div>`; console.error(e); }
}

// ════════════════════════════════════════
// INVENTORY REPORT — تقرير المخزون
// ════════════════════════════════════════
async function runInventoryReport(sys) {
  el('reportKpis').innerHTML = '';
  el('reportTable').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري تحميل المخزون...</div>';
  try {
    await ensureCache();
    const vehicles = state.allVehicles;
    const sales    = state.allSales;
    const deals    = state.allDeals;

    const soldVins    = new Set((sales||[]).map(s=>s.vin).filter(Boolean));
    const dealMap     = {};
    (deals||[]).forEach(d => { dealMap[d.file_no] = d; });
    const saleMap     = {};
    (sales||[]).forEach(s => { if(s.vin) saleMap[s.vin] = s; });

    const inStock  = (vehicles||[]).filter(v => !soldVins.has(v.vin));
    const sold     = (vehicles||[]).filter(v =>  soldVins.has(v.vin));
    const total    = (vehicles||[]).length;

    const stockValue  = inStock.reduce((s,v)=>s+(+v.purchase_price||0), 0);
    const soldRevenue = sold.reduce((v2,v)=>{ const s=saleMap[v.vin]; return v2+(+s?.sale_price||0); }, 0);
    const soldCost    = sold.reduce((s,v)=>s+(+v.purchase_price||0), 0);
    const soldProfit  = soldRevenue - soldCost;

    // KPIs
    el('reportKpis').innerHTML = `
      <div class="j-kpi" style="border-right:3px solid var(--accent)">
        <div class="j-kpi-label">📦 إجمالي السيارات</div>
        <div class="j-kpi-val" style="color:var(--accent);font-size:22px;font-weight:900">${total}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--blue)">
        <div class="j-kpi-label">🏭 في المخزن</div>
        <div class="j-kpi-val text-blue" style="font-size:22px;font-weight:900">${inStock.length}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">قيمة: ${fmt(stockValue)}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--green)">
        <div class="j-kpi-label">✅ مباعة</div>
        <div class="j-kpi-val text-green" style="font-size:22px;font-weight:900">${sold.length}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">إيراد: ${fmt(soldRevenue)}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid ${soldProfit>=0?'var(--green)':'var(--red)'}">
        <div class="j-kpi-label">💰 ربح المبيعات</div>
        <div class="j-kpi-val" style="color:${soldProfit>=0?'var(--green)':'var(--red)'};font-size:20px;font-weight:900">${fmt(soldProfit)}</div>
      </div>`;

    // Table — in stock first
    const allRows = [
      ...inStock.map(v => ({ ...v, _status:'stock' })),
      ...sold.map(v   => ({ ...v, _status:'sold'  })),
    ];

    const rows = allRows.map(v => {
      const deal = dealMap[v.file_no] || {};
      const sale = saleMap[v.vin]     || {};
      const isSold = v._status === 'sold';
      const profit = isSold ? ((+sale.sale_price||0) - (+v.purchase_price||0)) : null;
      const days = Math.floor((Date.now() - new Date(v.created_at||Date.now())) / 864e5);
      return `<tr>
        <td class="mono" style="direction:ltr;font-size:11px">${v.vin||'—'}</td>
        <td>${v.model||v.vehicle_type||'—'} ${v.year||''}</td>
        <td>${v.color||'—'}</td>
        <td class="mono text-accent" onclick="openViewer('${v.file_no}')" style="cursor:pointer;font-weight:700">${v.file_no||'—'}</td>
        <td>${deal.supplier||'—'}</td>
        <td class="mono text-blue">${fmt(v.purchase_price)}</td>
        <td>
          ${isSold
            ? `<span style="background:var(--green-dim);color:var(--green);padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700">✅ مباعة</span>`
            : `<span style="background:var(--blue-dim);color:var(--blue);padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700">🏭 مخزن (${days}د)</span>`}
        </td>
        ${isSold ? `
          <td class="mono text-green">${fmt(sale.sale_price)}</td>
          <td class="mono" style="color:${profit>=0?'var(--green)':'var(--red)'};font-weight:700">${fmt(profit)}</td>
          <td style="font-size:11px;color:var(--text2)">${sale.customer||'—'}</td>
        ` : `<td>—</td><td>—</td><td>—</td>`}
      </tr>`;
    }).join('');

    reportState.data = allRows.map(v => ({
      VIN: v.vin||'',
      الموديل: (v.model||v.vehicle_type||'')+(v.year?' '+v.year:''),
      اللون: v.color||'',
      الملف: v.file_no||'',
      المورد: dealMap[v.file_no]?.supplier||'',
      'تكلفة الشراء': +v.purchase_price||0,
      الحالة: v._status==='sold'?'مباعة':'في المخزن',
      'سعر البيع': v._status==='sold'?(+saleMap[v.vin]?.sale_price||0):'',
      الربح: v._status==='sold'?((+saleMap[v.vin]?.sale_price||0)-(+v.purchase_price||0)):'',
      العميل: v._status==='sold'?saleMap[v.vin]?.customer||'':'',
    }));

    el('reportTable').innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <table class="data-table">
          <thead><tr>
            <th>VIN</th><th>الموديل</th><th>اللون</th><th>الملف</th>
            <th>المورد</th><th>التكلفة</th><th>الحالة</th>
            <th>سعر البيع</th><th>الربح</th><th>العميل</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

  } catch(e) {
    el('reportTable').innerHTML = `<div class="empty-state"><div class="e-icon">⚠️</div><p>خطأ: ${e.message}</p></div>`;
    console.error(e);
  }
}

function exportReportCSV() {
  if (!reportState.data?.length) { toast('لا توجد بيانات للتصدير','err'); return; }
  const rows = [Object.keys(reportState.data[0])];
  reportState.data.forEach(r => rows.push(Object.values(r)));
  downloadCSV(rows, `تقرير_${reportState.type}.csv`);
}

// ════════════════════════════════════════
// LOGIN HELPERS
// ════════════════════════════════════════
function togglePassword() {
  const inp = document.getElementById('loginPass');
  const btn = document.getElementById('togglePass');
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = '🙈';
  } else {
    inp.type = 'password';
    btn.textContent = '👁';
  }
}

function clearSavedLogin() {
  localStorage.removeItem('tm_saved_email');
  localStorage.removeItem('tm_saved_pass');
  localStorage.removeItem('tm_remember');
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPass').value  = '';
  document.getElementById('rememberMe').checked = false;
  document.getElementById('savedBadge').style.display    = 'none';
  document.getElementById('clearSavedBtn').style.display = 'none';
  toast('تم مسح البيانات المحفوظة', 'ok');
}

// ════════════════════════════════════════
// EVENT LISTENERS
// ════════════════════════════════════════
document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', function(e) {
    if (e.target === this) closeModal(this.id);
  });
});

// Intercept collection/sale/payout modal buttons (safe - all use ?.)
document.querySelector('[onclick="openModal(\'collectionModal\')"]')?.setAttribute('onclick','openCollectionModal()');
// saleModal button already calls openSaleModal() directly
document.querySelector('[onclick="openModal(\'payoutModal\')"]')?.setAttribute('onclick','openPayoutModal()');

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
(function init() {
  const savedToken   = localStorage.getItem('tm_token');
  const savedRefresh = localStorage.getItem('tm_refresh');
  const savedUser    = localStorage.getItem('tm_user');
  if (savedToken) {
    state.token        = savedToken;
    state.refreshToken = savedRefresh || null;
    state.user         = savedUser ? JSON.parse(savedUser) : { email: 'user@tm.com' };
    initApp();
  }

  // Prefill saved credentials
  const remember    = localStorage.getItem('tm_remember');
  const savedEmail  = localStorage.getItem('tm_saved_email');
  const savedPass   = localStorage.getItem('tm_saved_pass');
  if (remember && savedEmail && savedPass) {
    document.getElementById('loginEmail').value   = savedEmail;
    document.getElementById('loginPass').value    = atob(savedPass);
    document.getElementById('rememberMe').checked = true;
    document.getElementById('savedBadge').style.display    = 'inline-block';
    document.getElementById('clearSavedBtn').style.display = 'block';
  }

  // Set today as default dates
  const dateInputs = document.querySelectorAll('input[type="date"]');
  dateInputs.forEach(inp => { if (!inp.value) inp.value = today(); });
})();

// ════════════════════════════════════════
// PWA — unregister any old SW to prevent caching
// ════════════════════════════════════════
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister());
  });
}


// ════════════════════════════════════════
// FEATURE 1 — CONFIRM DELETE MODAL
// ════════════════════════════════════════
function showConfirm(title, msg, onConfirm) {
  el('confirmDeleteTitle').textContent = title;
  el('confirmDeleteMsg').textContent = msg;
  const btn = el('confirmDeleteOkBtn');
  btn.onclick = async () => { closeModal('confirmDeleteModal'); await onConfirm(); };
  openModal('confirmDeleteModal');
}

// Override browser confirm() for delete operations
async function confirmDeleteDealFromModal() {
  const fn = _nfEditFileNo;
  if (!fn) return;
  showConfirm(
    `حذف الصفقة ${fn}`,
    `سيتم حذف كل السيارات والعمليات والمدفوعات المرتبطة بها نهائياً. هذا الإجراء لا يمكن التراجع عنه.`,
    async () => {
      const btn = el('nfDeleteBtn');
      btn.disabled = true; btn.textContent = '⏳ جاري الحذف...';
      try {
        const sys = state.system;
        const tables = ['vehicles','payments','expenses','sales','collections','partner_payouts','partners_master','ledger_entries','journal_entries','opex_entries','account_ledger'];
        for (const t of tables) { try { await apiDelete(t, { system_type:`eq.${sys}`, file_no:`eq.${fn}` }); } catch(e) {} }
        await logAudit('DELETE','purchase_orders', fn, {file_no:fn}, null, 'حذف صفقة كاملة');
        try { await apiDelete('audit_log', { file_no:`eq.${fn}` }); } catch(e) {}
        await apiDelete('purchase_orders', { system_type:`eq.${sys}`, file_no:`eq.${fn}` });
        closeModal('newFileModal');
        toast(`✅ تم حذف الصفقة ${fn}`,'ok');
        state.currentFileNo = null;
        await loadDashboard(); showDashboard();
      } catch(e) { toast('خطأ: '+e.message,'err'); btn.disabled=false; btn.textContent='🗑 حذف الصفقة'; }
    }
  );
}

async function confirmDeleteVehicle() {
  if (!_editVehicleId) return;
  showConfirm('حذف السيارة', 'هل تريد حذف هذه السيارة نهائياً من الصفقة؟', async () => {
    try {
      await apiDelete('vehicles', { id:`eq.${_editVehicleId}` });
      closeModal('editVehicleModal');
      toast('✅ تم حذف السيارة','ok');
      if (state.currentFileNo) await loadViewerTab(state.currentTab);
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

async function deletePayoutEntry(payoutId, fileNo, silent=false) {
  if (silent) {
    try { await apiDelete('partner_payouts', { id:`eq.${payoutId}` }); await loadPayoutsTab(fileNo, state.system); } catch(e) { toast('خطأ: '+e.message,'err'); }
    return;
  }
  showConfirm('حذف الدفعة', 'هل تريد حذف هذه الدفعة نهائياً؟', async () => {
    try { await apiDelete('partner_payouts', { id:`eq.${payoutId}` }); await loadPayoutsTab(fileNo, state.system); toast('✅ تم الحذف','ok'); }
    catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

// ════════════════════════════════════════
// FEATURE 2 — ROLES & PERMISSIONS
// ════════════════════════════════════════
const ROLES = {
  admin:    { label:'👑 مدير كامل',  edit:true,  delete:true,  transactions:true,  roles:true  },
  employee: { label:'👤 موظف',       edit:true,  delete:false, transactions:true,  roles:false },
  readonly: { label:'👁 مشاهدة',     edit:false, delete:false, transactions:false, roles:false },
};

let _currentRole = localStorage.getItem('tm_role') || 'admin';

function can(action) { return ROLES[_currentRole]?.[action] !== false; }

function openRolesModal() {
  openModal('rolesModal');
  updateRoleUI(_currentRole);
}

let _pendingRole = _currentRole;
function setRole(role) {
  _pendingRole = role;
  updateRoleUI(role);
}

function updateRoleUI(role) {
  document.querySelectorAll('.role-btn').forEach(b => b.classList.toggle('active', b.dataset.role === role));
  const r = ROLES[role];
  el('perm-edit').innerHTML        = r.edit         ? '<span class="perm-yes">✅ مسموح</span>' : '<span class="perm-no">❌ ممنوع</span>';
  el('perm-delete').innerHTML      = r.delete        ? '<span class="perm-yes">✅ مسموح</span>' : '<span class="perm-no">❌ ممنوع</span>';
  el('perm-transactions').innerHTML= r.transactions  ? '<span class="perm-yes">✅ مسموح</span>' : '<span class="perm-no">❌ ممنوع</span>';
  el('perm-roles').innerHTML       = r.roles         ? '<span class="perm-yes">✅ مسموح</span>' : '<span class="perm-limited">🔒 مدير فقط</span>';
}

function saveRole() {
  _currentRole = _pendingRole;
  localStorage.setItem('tm_role', _currentRole);
  applyRoleRestrictions();
  closeModal('rolesModal');
  toast(`✅ تم الحفظ — الدور: ${ROLES[_currentRole].label}`,'ok');
}

function applyRoleRestrictions() {
  const canDel   = can('delete');
  const canTx    = can('transactions');
  const isAdmin  = can('roles');

  // Hide static delete buttons
  document.querySelectorAll('.btn-danger, #nfDeleteBtn').forEach(btn => {
    btn.style.display = canDel ? '' : 'none';
  });
  // Hide add/edit buttons for readonly
  document.querySelectorAll('#nfSubmitBtn, #saleSubmitBtn, #paymentSubmitBtn, #expSubmitBtn').forEach(btn => {
    btn.style.display = canTx ? '' : 'none';
  });
  // Quick expense fab
  const fab = el('quickExpFab');
  if (fab) fab.style.display = canTx && state.currentFileNo ? 'flex' : 'none';

  // Hide admin-only sidebar section (الإدارة) for non-admins
  const adminNav = el('nav-section-admin');
  if (adminNav) adminNav.style.display = isAdmin ? '' : 'none';
}

// ════════════════════════════════════════
// FEATURE 3 — VIN DUPLICATE CHECK
// ════════════════════════════════════════
async function checkVinDuplicate(vin, excludeFileNo='') {
  if (!vin || vin.length < 3) return null;
  try {
    const results = await apiGet('vehicles', { select:'file_no,model,vin', system_type:`eq.${state.system}`, vin:`eq.${vin}` });
    const found = (results||[]).filter(v => v.file_no !== excludeFileNo);
    if (!found.length) return null;
    const deals = await apiGet('purchase_orders', { select:'file_no', system_type:`eq.${state.system}`, file_no:`eq.${found[0].file_no}` });
    if (!deals || !deals.length) {
      // VIN exists but deal is deleted — clean up orphan silently
      try { await apiDelete('vehicles', { system_type:`eq.${state.system}`, vin:`eq.${vin}`, file_no:`eq.${found[0].file_no}` }); } catch(e) {}
      return null;
    }
    return found[0];
  } catch(e) { return null; }
}

async function onVinBlur(input, excludeFileNo='') {
  const vin = input.value.trim().toUpperCase();
  if (!vin) return;
  input.value = vin;
  const dup = await checkVinDuplicate(vin, excludeFileNo);
  if (dup) {
    input.style.borderColor = 'var(--red)';
    input.style.boxShadow = '0 0 0 3px var(--red-dim)';
    const warn = input.parentElement.querySelector('.vin-warn') || (() => {
      const d = document.createElement('div');
      d.className = 'vin-warn hint';
      d.style.color = 'var(--red)';
      input.parentElement.appendChild(d);
      return d;
    })();
    warn.textContent = `⚠️ هذا الشاصي موجود في صفقة ${dup.file_no} (${dup.model||''})`;
  } else {
    input.style.borderColor = '';
    input.style.boxShadow = '';
    const warn = input.parentElement.querySelector('.vin-warn');
    if (warn) warn.remove();
  }
}

// ════════════════════════════════════════
// FEATURE 4 — WHATSAPP INVOICE
// ════════════════════════════════════════
function sendWhatsappInvoice({ invNo, customer, date, items, total, phone='' }) {
  const itemLines = items.map((it,i) => `${i+1}. ${it.model||'سيارة'} — ${it.price.toLocaleString('en-US',{minimumFractionDigits:2})} ج.م`).join('\n');
  const msg = `🚗 *ترانزيت — فاتورة مبيعات*\n\n` +
    `رقم الفاتورة: *${invNo}*\n` +
    `التاريخ: ${date}\n` +
    `العميل: ${customer}\n\n` +
    `*السيارات:*\n${itemLines}\n\n` +
    `*الإجمالي: ${total.toLocaleString('en-US',{minimumFractionDigits:2})} ج.م*\n\n` +
    `شكراً لتعاملكم مع ترانزيت 🤝`;

  const num = phone.replace(/\D/g,'');
  const url = num ? `https://wa.me/${num}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

// WhatsApp after print — called from reprint buttons directly

// ════════════════════════════════════════
// FEATURE 5 — QUICK EXPENSE FAB
// ════════════════════════════════════════
function openQuickExpFab() {
  if (!state.currentFileNo) { toast('افتح صفقة أولاً','err'); return; }
  openQuickModal('expense');
}

// FAB shown in openViewer directly

function showDashboard_withFab() {
  showDashboard();
  const fab = el('quickExpFab');
  if (fab) fab.style.display = 'none';
}

// Init roles on load
document.addEventListener('DOMContentLoaded', () => {
  _currentRole = localStorage.getItem('tm_role') || 'admin';
  _pendingRole = _currentRole;

  // Top bar shadow on scroll
  const contentArea = document.querySelector('.content-area');
  const topBar = document.querySelector('.top-bar');
  if (contentArea && topBar) {
    contentArea.addEventListener('scroll', () => {
      topBar.classList.toggle('scrolled', contentArea.scrollTop > 10);
    });
  }
});

// ════════════════════════════════════════
// ACTIVITY LOG
// ════════════════════════════════════════
let _activityData = [];

async function showActivityLog() {
  if (!can('roles')) { toast('🔒 هذه الصفحة للمدراء فقط', 'err'); return; }
  hideAllViews();
  el('activityView').style.display = 'block';
  el('topBarTitle').textContent = 'سجل النشاط';
  navActive('nav-activity');
  sessionStorage.setItem('tm_last_view','activity');
  await loadActivityLog();
}

async function loadActivityLog() {
  el('activityTableWrap').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  try {
    const data = await apiGet('audit_log', {
      select:'*', system_type:`eq.${state.system}`,
      order:'id.desc', limit:200
    });
    _activityData = data || [];

    // Populate user filter
    const users = [...new Set(_activityData.map(r => r.user_email).filter(Boolean))];
    const sel = el('actFilter-user');
    const cur = sel.value;
    sel.innerHTML = '<option value="">كل المستخدمين</option>' +
      users.map(u => `<option value="${u}" ${u===cur?'selected':''}>${u}</option>`).join('');

    renderActivityLog();
  } catch(e) { el('activityTableWrap').innerHTML = errHTML('خطأ: '+e.message); }
}

function clearActivityFilters() {
  ['actFilter-action','actFilter-user','actFilter-table','actFilter-from','actFilter-to']
    .forEach(id => { const e = el(id); if(e) e.value = ''; });
  renderActivityLog();
}

function renderActivityLog() {
  const filterUser   = el('actFilter-user')?.value   || '';
  const filterAction = el('actFilter-action')?.value || '';
  const filterTable  = el('actFilter-table')?.value  || '';
  const filterFrom   = el('actFilter-from')?.value   || '';
  const filterTo     = el('actFilter-to')?.value     || '';

  let list = _activityData;
  if (filterUser)   list = list.filter(r => r.user_email  === filterUser);
  if (filterAction) list = list.filter(r => r.action      === filterAction);
  if (filterTable)  list = list.filter(r => r.table_name  === filterTable);
  if (filterFrom)   list = list.filter(r => (r.created_at||'') >= filterFrom);
  if (filterTo)     list = list.filter(r => (r.created_at||'').split('T')[0] <= filterTo);

  if(el('activity-subtitle')) el('activity-subtitle').textContent = `${list.length} سجل`;

  if (!list.length) { el('activityTableWrap').innerHTML = emptyHTML('🕵️','لا توجد سجلات'); return; }

  const actionColors = { INSERT:'var(--green)', UPDATE:'var(--accent)', DELETE:'var(--red)' };
  const actionLabels = { INSERT:'➕ إضافة', UPDATE:'✏️ تعديل', DELETE:'🗑 حذف' };
  const actionBg     = { INSERT:'var(--green-dim)', UPDATE:'var(--accent-dim)', DELETE:'var(--red-dim)' };
  const tableLabels  = {
    purchase_orders:'أوامر الشراء', sales:'المبيعات', expenses:'المصاريف',
    payments:'الدفعات', collections:'التحصيلات', partner_payouts:'صرف الشركاء',
    vehicles:'السيارات', contacts:'جهات الاتصال', user_roles:'المستخدمين',
    operating_expenses:'التشغيلية',
  };

  const rows = list.map(r => {
    const dt       = r.created_at ? new Date(r.created_at).toLocaleString('en-US') : '—';
    const email    = r.user_email || 'غير معروف';
    const initials = email[0]?.toUpperCase() || '?';
    const hasDetail= r.new_val || r.old_val || r.notes;
    return `
    <tr onclick="${hasDetail ? `showActivityDetail('${r.id}')` : ''}"
      style="cursor:${hasDetail?'pointer':'default'};transition:background .1s"
      onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background=''">
      <td style="padding:9px 12px;font-size:11px;color:var(--text2);white-space:nowrap">${dt}</td>
      <td style="padding:9px 12px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:26px;height:26px;border-radius:50%;background:var(--accent-dim);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;color:var(--accent);flex-shrink:0">${initials}</div>
          <span style="font-size:12px">${email}</span>
        </div>
      </td>
      <td style="padding:9px 12px">
        <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;background:${actionBg[r.action]||'var(--card2)'};color:${actionColors[r.action]||'var(--text2)'}">
          ${actionLabels[r.action]||r.action}
        </span>
      </td>
      <td style="padding:9px 12px;font-size:12px;color:var(--text2)">${tableLabels[r.table_name]||r.table_name||'—'}</td>
      <td style="padding:9px 12px;font-size:12px;font-weight:700;color:var(--accent);font-family:monospace">${r.file_no||'—'}</td>
      <td style="padding:9px 12px;font-size:11px;color:var(--text2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.notes||'—'}</td>
      <td style="padding:9px 12px">${hasDetail ? '<span style="font-size:10px;color:var(--blue)">تفاصيل ←</span>' : ''}</td>
    </tr>`;
  }).join('');

  el('activityTableWrap').innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      <table class="data-table">
        <thead><tr>
          <th>الوقت</th><th>المستخدم</th><th>العملية</th>
          <th>الجدول</th><th>رقم الملف</th><th>ملاحظات</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function showActivityDetail(id) {
  const r = _activityData.find(x => String(x.id) === String(id));
  if (!r) return;

  const actionColors = { INSERT:'var(--green)', UPDATE:'var(--accent)', DELETE:'var(--red)' };
  const actionLabels = { INSERT:'➕ إضافة', UPDATE:'✏️ تعديل', DELETE:'🗑 حذف' };

  let detailHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
        <div style="font-size:10px;color:var(--text2);margin-bottom:3px">المستخدم</div>
        <div style="font-weight:600">${r.user_email||'—'}</div>
      </div>
      <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
        <div style="font-size:10px;color:var(--text2);margin-bottom:3px">الوقت</div>
        <div style="font-weight:600;font-size:11px">${r.created_at ? new Date(r.created_at).toLocaleString('en-US') : '—'}</div>
      </div>
      <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
        <div style="font-size:10px;color:var(--text2);margin-bottom:3px">العملية</div>
        <div style="font-weight:700;color:${actionColors[r.action]||'var(--text)'}">${actionLabels[r.action]||r.action}</div>
      </div>
      <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
        <div style="font-size:10px;color:var(--text2);margin-bottom:3px">الملف</div>
        <div style="font-weight:700;color:var(--accent);font-family:monospace">${r.file_no||'—'}</div>
      </div>
    </div>`;

  if (r.notes) {
    detailHTML += `
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px">ملاحظات</div>
      <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px;font-size:12px">${r.notes}</div>
    </div>`;
  }

  // Old/New values
  if (r.old_value) {
    try {
      const old = typeof r.old_value === 'string' ? JSON.parse(r.old_value) : r.old_value;
      detailHTML += `
      <div style="margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:var(--red);margin-bottom:6px">القيمة قبل التعديل</div>
        <div style="background:var(--red-dim);border:1px solid var(--red);border-radius:var(--radius-sm);padding:10px;font-family:monospace;font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-all">
          ${JSON.stringify(old, null, 2)}
        </div>
      </div>`;
    } catch(e) { detailHTML += `<div style="margin-bottom:12px;font-size:11px;color:var(--text2)">القيمة القديمة: ${r.old_value}</div>`; }
  }

  if (r.new_value) {
    try {
      const nw = typeof r.new_value === 'string' ? JSON.parse(r.new_value) : r.new_value;
      detailHTML += `
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--green);margin-bottom:6px">البيانات المضافة / بعد التعديل</div>
        <div style="background:var(--green-dim);border:1px solid var(--green);border-radius:var(--radius-sm);padding:10px;font-family:monospace;font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-all">
          ${JSON.stringify(nw, null, 2)}
        </div>
      </div>`;
    } catch(e) { detailHTML += `<div style="font-size:11px;color:var(--text2)">البيانات: ${r.new_value}</div>`; }
  }

  el('act-detail-title').textContent = `🕵️ تفاصيل — ${r.table_name||'—'} — ${r.file_no||'—'}`;
  el('act-detail-body').innerHTML = detailHTML;
  el('activity-detail').style.display = 'flex';
}

// ════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════
function switchSettTab(name) {
  document.querySelectorAll('.sett-panel').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.sett-tab').forEach(t => t.classList.remove('active'));
  const panel = el('sett-panel-' + name);
  const tab   = el('stab-' + name);
  if (panel) panel.style.display = 'block';
  if (tab)   tab.classList.add('active');
  if (name === 'roles') setTimeout(updateAdminPostToggleUI, 50);
}

// ════════════════════════════════════════
// ANTHROPIC API KEY MANAGEMENT
// ════════════════════════════════════════
function saveApiKey() {
  const key = el('sett-api-key')?.value?.trim() || '';
  if (!key) { toast('يرجى إدخال المفتاح أولاً', 'err'); return; }
  if (!key.startsWith('sk-ant-')) { toast('⚠️ المفتاح يجب أن يبدأ بـ sk-ant-', 'err'); return; }
  localStorage.setItem('tm_anthropic_key', key);
  updateApiKeyStatus();
  toast('✅ تم حفظ مفتاح API — ميزة قراءة الرخص مفعّلة 📷', 'ok');
}
function clearApiKey() {
  localStorage.removeItem('tm_anthropic_key');
  if (el('sett-api-key')) el('sett-api-key').value = '';
  updateApiKeyStatus();
  toast('تم مسح المفتاح', 'ok');
}
function updateApiKeyStatus() {
  const key    = localStorage.getItem('tm_anthropic_key') || '';
  const status = el('api-key-status');
  if (!status) return;
  if (key) {
    status.innerHTML = `<span style="color:var(--green)">✅ مفعّل — ${key.slice(0,12)}...${key.slice(-4)}</span>`;
  } else {
    status.innerHTML = `<span style="color:var(--text3)">⚪ غير مفعّل — ميزة قراءة الرخص معطّلة</span>`;
  }
}
function loadApiKeyInSettings() {
  const key = localStorage.getItem('tm_anthropic_key') || '';
  if (el('sett-api-key') && key) el('sett-api-key').value = key;
  updateApiKeyStatus();
}

async function showSettings() {
  if (!can('roles')) { toast('🔒 هذه الصفحة للمدراء فقط', 'err'); return; }
  hideAllViews();
  el('settingsView').style.display = 'block';
  el('topBarTitle').textContent = 'الإعدادات';
  navActive('nav-settings');
  sessionStorage.setItem('tm_last_view','settings');
  switchSettTab('users');
  if(el('sett-email'))  el('sett-email').textContent  = state.user?.email || '—';
  if(el('sett-role'))   el('sett-role').textContent   = ROLES[_currentRole]?.label || _currentRole;
  if(el('sett-system')) el('sett-system').textContent = state.system;
  loadApiKeyInSettings();
  await loadUserRoles();
}

async function loadUserRoles() {
  const wrap = el('userRolesList');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  try {
    const data = await apiGet('user_roles', { select:'*', order:'email.asc' });
    const all  = data || [];

    // Update stats
    const admins = all.filter(u => u.role === 'admin').length;
    if(el('sett-stat-total'))  el('sett-stat-total').textContent  = all.length;
    if(el('sett-stat-active')) el('sett-stat-active').textContent = all.length;
    if(el('sett-stat-admins')) el('sett-stat-admins').textContent = admins;

    if (!all.length) {
      wrap.innerHTML = '<div class="empty-state"><div class="e-icon">👥</div><p>لا يوجد مستخدمون بعد</p><small>أضف مستخدمًا من تبويب "دعوة مستخدم"</small></div>';
      return;
    }

    const roleLabel = { admin:'👑 مدير', employee:'👤 موظف', readonly:'👁 مشاهدة' };

    wrap.innerHTML = all.map(u => {
      const sys = u.systems ? u.systems.split(',') : [u.system_type || state.system];
      const sysTags = sys.map(s => s.trim()).filter(Boolean).map(s =>
        `<span class="sett-sys-tag ${s==='BOX'?'sett-sys-box':'sett-sys-tr'}">${s}</span>`
      ).join(' ');
      const isSelf = u.email === state.user?.email;
      return `
      <div class="sett-user-row" id="urow-${u.id}">
        <div class="sett-user-avatar sett-av-${u.role}">${u.email[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px">
            ${u.email}
            ${isSelf ? '<span style="font-size:10px;background:var(--green-dim);color:var(--green);padding:1px 7px;border-radius:10px;font-weight:700">أنت</span>' : ''}
          </div>
          <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;align-items:center">
            <span class="sett-role-badge sett-badge-${u.role}">${roleLabel[u.role]||u.role}</span>
            ${sysTags}
          </div>
        </div>
        ${!isSelf ? `
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-secondary btn-sm" onclick="openSettEditCard(${u.id},'${u.email}','${u.role}','${sys.join(',')}')">✏️ تعديل</button>
          <button class="btn btn-danger btn-sm" onclick="deleteUserRole(${u.id},'${u.email}')">🗑</button>
        </div>` : ''}
      </div>`;
    }).join('');

  } catch(e) { wrap.innerHTML = `<div style="color:var(--red);font-size:12px;padding:12px">خطأ في التحميل: ${e.message}</div>`; }
}

function openSettEditCard(id, email, role, systems) {
  el('sett-edit-id').value            = id;
  el('sett-edit-email-label').textContent = email;
  el('sett-edit-role').value          = role;
  el('sett-edit-sys-box').checked     = systems.includes('BOX');
  el('sett-edit-sys-tr').checked      = systems.includes('TRANSIT');
  el('sett-edit-card').style.display  = 'block';
  el('sett-edit-card').scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function closeSettEditCard() {
  el('sett-edit-card').style.display = 'none';
}

async function saveUserRoleEdit() {
  const id      = el('sett-edit-id').value;
  const role    = el('sett-edit-role').value;
  const sysBox  = el('sett-edit-sys-box').checked;
  const sysTr   = el('sett-edit-sys-tr').checked;
  if (!sysBox && !sysTr) { toast('اختر نظاماً واحداً على الأقل','err'); return; }
  const systems = [sysBox?'BOX':null, sysTr?'TRANSIT':null].filter(Boolean).join(',');
  try {
    await apiPatch('user_roles', { id:`eq.${id}` }, { role, systems, system_type: sysBox ? 'BOX' : 'TRANSIT' });
    toast('✅ تم تحديث بيانات المستخدم','ok');
    closeSettEditCard();
    await loadUserRoles();
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

async function addUserRole() {
  const email  = el('newUserEmail')?.value.trim();
  const role   = el('newUserRole')?.value;
  const sysBox = el('newUserSysBox')?.checked;
  const sysTr  = el('newUserSysTr')?.checked;
  const note   = el('newUserNote')?.value.trim() || '';
  const errEl  = el('inviteError');
  if (errEl) errEl.style.display = 'none';
  if (!email) { if(errEl){errEl.textContent='أدخل البريد الإلكتروني';errEl.style.display='flex';} return; }
  if (!sysBox && !sysTr) { if(errEl){errEl.textContent='اختر نظاماً واحداً على الأقل';errEl.style.display='flex';} return; }
  const systems = [sysBox?'BOX':null, sysTr?'TRANSIT':null].filter(Boolean).join(',');
  try {
    await apiPost('user_roles', { email, role, system_type: sysBox ? 'BOX' : 'TRANSIT', systems, notes: note });
    el('newUserEmail').value = '';
    if(el('newUserNote')) el('newUserNote').value = '';
    toast(`✅ تم إضافة ${email}`,'ok');
    switchSettTab('users');
    await loadUserRoles();
  } catch(e) {
    if(errEl){errEl.textContent='خطأ: '+e.message;errEl.style.display='flex';}
    else toast('خطأ: '+e.message,'err');
  }
}

async function updateUserRole(id, role) {
  try {
    await apiPatch('user_roles', { id:`eq.${id}` }, { role });
    toast('✅ تم تحديث الصلاحية','ok');
    await loadUserRoles();
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

async function deleteUserRole(id, email) {
  showConfirm(`إزالة ${email}`, 'سيتم إزالة صلاحيات هذا المستخدم من النظام.', async () => {
    try {
      await apiDelete('user_roles', { id:`eq.${id}` });
      toast('✅ تم الحذف','ok');
      await loadUserRoles();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

// Load role from Supabase on login
async function loadUserRoleFromDB() {
  try {
    const data = await apiGet('user_roles', {
      select:'role,systems', system_type:`eq.${state.system}`,
      email:`eq.${state.user?.email}`, limit:1
    });
    if (data && data[0]) {
      _currentRole = data[0].role;
      _pendingRole = _currentRole;
      localStorage.setItem('tm_role', _currentRole);
      applyRoleRestrictions();
    }
  } catch(e) {}
}


// ════════════════════════════════════════
// DEAL STATEMENT (TAB 7)
// ════════════════════════════════════════
async function loadDealStatement(fn, sys) {
  const wrap = el('dealStatementWrap');
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  try {
    const [po, vehicles, payments, expenses, sales, collections, partners, payouts] = await Promise.all([
      apiGet('purchase_orders', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('vehicles',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('payments',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'pay_date.asc' }),
      apiGet('expenses',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'exp_date.asc' }),
      apiGet('sales',           { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'sale_date.asc' }),
      apiGet('collections',     { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'paid_date.asc' }),
      apiGet('partners_master', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGet('partner_payouts', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'pay_date.asc' }),
    ]);

    const deal = po?.[0] || {};
    const totalPurchase = +deal.total_purchase || 0;
    const totalPaid     = (payments||[]).reduce((s,p)=>s+(+p.amount||0),0);
    const totalExp      = (expenses||[]).reduce((s,e)=>s+(+e.amount||0),0);
    const totalSales    = (sales||[]).reduce((s,s2)=>s+(+s2.sale_price||0),0);
    const totalColl     = (collections||[]).reduce((s,c)=>s+(+c.amount||0),0);
    const totalPayouts  = (payouts||[]).reduce((s,p)=>s+(+p.amount||0),0);
    const profit        = totalSales - totalPurchase - totalExp;

    const entries = [
      { date:deal.po_date||deal.created_at, type:'شراء', icon:'📋', color:'var(--blue)',
        party:deal.supplier||'—', debit:totalPurchase, credit:0,
        desc:`سند شراء ${fn}${deal.po_no?' — PO: '+deal.po_no:''}`,
        extra:`${(vehicles||[]).length} سيارة` },
      ...(payments||[]).map(p=>({ date:p.pay_date, type:'دفعة للمورد', icon:'💳', color:'var(--cyan)',
        party:p.payer||'—', debit:0, credit:+p.amount,
        desc:`دفعة من ${p.payer||'—'}`, extra:`${p.pay_method||''}${p.document?' · '+p.document:''}` })),
      ...(expenses||[]).map(e=>({ date:e.exp_date||e.expense_date, type:'مصروف', icon:'💸', color:'var(--red)',
        party:e.vendor||'—', debit:0, credit:+e.amount,
        desc:e.category||e.description||'مصروف', extra:`${e.pay_method||''}` })),
      ...(sales||[]).map(s=>({ date:s.sale_date, type:'بيع', icon:'🤝', color:'var(--green)',
        party:s.customer||'—', debit:+s.sale_price, credit:0,
        desc:`بيع ${s.model||s.vin||'سيارة'} — ${s.customer||'—'}`,
        extra:`${s.vin?'شاصي: '+s.vin:''}${s.invoice_no?' · '+s.invoice_no:''}` })),
      ...(collections||[]).map(c=>({ date:c.paid_date, type:'تحصيل', icon:'💰', color:'var(--green)',
        party:c.customer||'—', debit:+c.amount, credit:0,
        desc:`تحصيل من ${c.customer||'—'}`, extra:`${c.pay_method||''}` })),
      ...(payouts||[]).map(p=>({ date:p.pay_date, type:'صرف شريك', icon:'👥', color:'var(--purple)',
        party:p.partner||'—', debit:0, credit:+p.amount,
        desc:`${p.payout_type||'صرف'} — ${p.partner||'—'}`, extra:`${p.pay_method||''}${p.notes?' · '+p.notes:''}` })),
    ].sort((a,b)=>(a.date||'').localeCompare(b.date||''));

    window._dealStatementData = { fn, deal, entries, totalPurchase, totalPaid, totalExp, totalSales, totalColl, totalPayouts, profit, partners, payouts, vehicles };

    const kpis = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:16px">
      ${[['تكلفة الشراء',fmt(totalPurchase),'var(--blue)'],['المدفوع',fmt(totalPaid),'var(--cyan)'],
         ['المصاريف',fmt(totalExp),'var(--red)'],['المبيعات',fmt(totalSales),'var(--green)'],
         ['المحصّل',fmt(totalColl),'var(--green)'],['صافي الربح',fmt(Math.abs(profit)),profit>=0?'var(--green)':'var(--red)'],
      ].map(([l,v,c])=>`<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px">
        <div style="font-size:10px;color:var(--text2);margin-bottom:4px">${l}</div>
        <div style="font-size:16px;font-weight:700;color:${c}">${v}</div></div>`).join('')}
    </div>`;

    let running = 0;
    const rows = entries.map(e => {
      if (e.debit>0) running += e.debit; if (e.credit>0) running -= e.credit;
      return `<tr onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background=''">
        <td style="padding:10px 12px;font-size:11px;color:var(--text3);white-space:nowrap">${e.date||'—'}</td>
        <td style="padding:10px 12px"><span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px;background:${e.color}22;color:${e.color}">${e.icon} ${e.type}</span></td>
        <td style="padding:10px 12px"><div style="font-size:12px;font-weight:600">${e.desc}</div>${e.extra?`<div style="font-size:10px;color:var(--text3)">${e.extra}</div>`:''}</td>
        <td style="padding:10px 12px;font-size:12px;color:var(--text2)">${e.party}</td>
        <td style="padding:10px 12px;text-align:left;font-family:var(--mono);font-size:12px;color:var(--green)">${e.debit>0?fmt(e.debit):'—'}</td>
        <td style="padding:10px 12px;text-align:left;font-family:var(--mono);font-size:12px;color:var(--red)">${e.credit>0?fmt(e.credit):'—'}</td>
        <td style="padding:10px 12px;text-align:left;font-family:var(--mono);font-size:13px;font-weight:700;color:${running>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(running))}</td>
      </tr>`;
    }).join('');

    const partnersHtml = (partners||[]).length ? `
      <div style="margin-top:16px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px">
        <div style="font-weight:700;margin-bottom:12px;font-size:13px">👥 توزيع الأرباح على الشركاء</div>
        ${(partners||[]).map(p=>{
          const paid = (payouts||[]).filter(py=>py.partner===p.partner).reduce((s,py)=>s+(+py.amount||0),0);
          const share = profit*(+p.share_percent||0)/100;
          return `<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="flex:1;font-weight:700;min-width:100px">${p.partner}</div>
            <div style="font-size:12px;color:var(--text2)">حصة: <b>${p.share_percent}%</b></div>
            <div style="font-size:12px;color:var(--green)">ربح مستحق: <b>${fmt(share)}</b></div>
            <div style="font-size:12px;color:var(--accent)">مصروف: <b>${fmt(paid)}</b></div>
            <div style="font-size:12px;font-weight:700;color:${share-paid>0?'var(--red)':'var(--green)'}">متبقي: <b>${fmt(share-paid)}</b></div>
          </div>`;
        }).join('')}
      </div>` : '';

    wrap.innerHTML = kpis + `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--card2);border-bottom:1px solid var(--border)">
            ${['التاريخ','النوع','البيان','الطرف','مدين','دائن','الرصيد'].map((h,i)=>`<th style="padding:10px 12px;font-size:11px;color:var(--text3);font-weight:700;text-align:${i>=4?'left':'right'}">${h}</th>`).join('')}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` + partnersHtml;

  } catch(e) { el('dealStatementWrap').innerHTML = errHTML('خطأ: '+e.message); }
}

async function printDealStatement(fileNo) {
  // لو فيه fileNo → جيب البيانات مباشرة
  // لو مفيش → استخدم _dealStatementData المحفوظ
  let d = window._dealStatementData;
  if (fileNo && (!d || d.fn !== fileNo)) {
    toast('⏳ جاري تحميل كشف الصفقة...', 'ok');
    try {
      await loadDealStatement(fileNo, state.system);
      d = window._dealStatementData;
    } catch(e) { toast('خطأ: ' + e.message, 'err'); return; }
  }
  if (!d) { toast('افتح كشف الصفقة أولاً', 'err'); return; }
  const { fn, deal, entries, totalPurchase, totalPaid, totalExp, totalSales, totalColl, profit } = d;
  let running = 0;
  const rows = entries.map(e => {
    if(e.debit>0) running+=e.debit; if(e.credit>0) running-=e.credit;
    return `<tr><td>${e.date||'—'}</td><td>${e.type}</td><td><b>${e.desc}</b>${e.extra?'<br><small>'+e.extra+'</small>':''}</td>
    <td>${e.party}</td>
    <td style="text-align:left;color:green">${e.debit>0?e.debit.toLocaleString('en-US',{minimumFractionDigits:2}):'—'}</td>
    <td style="text-align:left;color:red">${e.credit>0?e.credit.toLocaleString('en-US',{minimumFractionDigits:2}):'—'}</td>
    <td style="text-align:left;font-weight:700;color:${running>=0?'green':'red'}">${Math.abs(running).toLocaleString('en-US',{minimumFractionDigits:2})}</td></tr>`;
  }).join('');
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>كشف الصفقة ${fn}</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;padding:20px}
  h2{margin-bottom:4px}.sub{color:#666;margin-bottom:16px}
  .kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:16px}
  .kpi{border:1px solid #ddd;border-radius:6px;padding:8px;text-align:center}
  .kpi div:first-child{font-size:10px;color:#666}.kpi div:last-child{font-weight:700;font-size:13px}
  table{width:100%;border-collapse:collapse}th{background:#f0f0f0;padding:7px 10px;font-size:11px;border:1px solid #ddd;text-align:right}
  td{padding:6px 10px;border:1px solid #eee;font-size:11px}tr:nth-child(even){background:#fafafa}
  @media print{@page{size:A4 landscape}}</style></head><body>
  <div style="display:flex;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #000">
    <div><h2>كشف الصفقة — ${fn}</h2><div class="sub">المورد: ${deal.supplier||'—'} · تاريخ: ${deal.po_date||'—'}</div></div>
    <div style="text-align:left;font-size:11px;color:#666">Transit Co.<br>${new Date().toLocaleDateString('en-GB')}</div>
  </div>
  <div class="kpis">
    <div class="kpi"><div>تكلفة الشراء</div><div style="color:#2563eb">${totalPurchase.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi"><div>المدفوع</div><div style="color:#0891b2">${totalPaid.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi"><div>المصاريف</div><div style="color:#dc2626">${totalExp.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi"><div>المبيعات</div><div style="color:#16a34a">${totalSales.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi"><div>المحصّل</div><div style="color:#16a34a">${totalColl.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi"><div>صافي الربح</div><div style="color:${profit>=0?'#16a34a':'#dc2626'}">${Math.abs(profit).toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
  </div>
  <table><thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>الطرف</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <scr` + `ipt>window.onload=()=>window.print()<` + `/scr` + `ipt></body></html>`;
  openPrintOverlay(html, 'كشف الصفقة');
}

function exportDealStatementExcel() {
  const d = window._dealStatementData;
  if (!d) { toast('افتح كشف الصفقة أولاً','err'); return; }
  const { fn, entries } = d;
  let running = 0;
  const rows = [['التاريخ','النوع','البيان','الطرف','مدين','دائن','الرصيد']];
  entries.forEach(e => {
    if(e.debit>0) running+=e.debit; if(e.credit>0) running-=e.credit;
    rows.push([e.date||'', e.type, e.desc+(e.extra?' — '+e.extra:''), e.party,
      e.debit>0?e.debit:'', e.credit>0?e.credit:'', Math.abs(running)]);
  });
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `كشف_${fn}.csv`; a.click();
}

// ════════════════════════════════════════
// ACTIVITY LOG
// ════════════════════════════════════════
async function acGetContacts(type) {
  const key = state.system + ':' + type;
  if (_acCache[key] && (Date.now() - _acCache[key].ts < 60000)) return _acCache[key].data;
  try {
    const data = await apiGet('contacts', { select:'id,name,type,phone', system_type:`eq.${state.system}`, order:'name.asc' });
    const filtered = (data||[]).filter(c => type==='all' || c.type===type);
    _acCache[key] = { data: filtered, ts: Date.now() };
    return filtered;
  } catch(e) { return []; }
}

function acClearCache() { Object.keys(_acCache).forEach(k => delete _acCache[k]); }

const _acTypeLabels2 = { customer:'عميل', supplier:'مورد', partner:'شريك', custodian:'عهدة' };
const _acTypeBadges  = { customer:'ac-badge-customer', supplier:'ac-badge-supplier', partner:'ac-badge-partner', custodian:'ac-badge-custodian' };
const _acTypeIcons   = { customer:'🤝', supplier:'🏭', partner:'👥', custodian:'🗝' };
let _acActiveIndex = -1;

async function acSearch(type, inputId) {
  const inp  = el(inputId);
  const drop = el('ac-' + inputId);
  if (!inp || !drop) return;
  const q = inp.value.trim().toLowerCase();
  const contacts = await acGetContacts(type);
  const filtered = q ? contacts.filter(c => c.name.toLowerCase().includes(q)) : contacts;
  _acActiveIndex = -1;
  let html = '';
  filtered.slice(0,8).forEach(c => {
    html += `<div class="ac-item" data-name="${c.name}" onmousedown="acSelect('${inputId}','${c.name.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')">
      <span>${_acTypeIcons[c.type]||'👤'}</span>
      <span class="ac-item-name">${c.name}</span>
      <span class="ac-item-badge ${_acTypeBadges[c.type]||''}">${_acTypeLabels2[c.type]||c.type}</span>
      ${c.phone?`<span style="font-size:10px;color:var(--text3)">${c.phone}</span>`:''}
    </div>`;
  });
  if (q && !contacts.find(c => c.name.toLowerCase()===q)) {
    html += `<div class="ac-item" onmousedown="acSelectNew('${inputId}','${type}','${inp.value.trim().replace(/'/g,"\\'")}')">
      <span>➕</span><span class="ac-item-name ac-item-new">إضافة "${inp.value.trim()}" كـ ${_acTypeLabels2[type]||type} جديد</span>
    </div>`;
  }
  drop.innerHTML = html || `<div class="ac-item" style="color:var(--text3);cursor:default">لا توجد نتائج</div>`;
  drop.classList.add('open');
}

function acSelect(inputId, name) {
  const inp = el(inputId); if(inp) inp.value = name;
  const drop = el('ac-'+inputId); if(drop) drop.classList.remove('open');
}

async function acSelectNew(inputId, type, name) {
  if (!name) return;
  try {
    const existing = await apiGet('contacts',{select:'id',system_type:`eq.${state.system}`,name:`eq.${name}`});
    if (!existing||!existing.length) {
      await apiPost('contacts',{system_type:state.system,name,type});
      acClearCache();
      toast(`✅ تم إضافة "${name}"`,'ok');
    }
    acSelect(inputId, name);
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

function acBlur(inputId) {
  setTimeout(() => { const d=el('ac-'+inputId); if(d) d.classList.remove('open'); }, 200);
}

function acKey(e, inputId) {
  const drop = el('ac-'+inputId);
  if (!drop||!drop.classList.contains('open')) return;
  const items = drop.querySelectorAll('.ac-item');
  if (e.key==='ArrowDown')  { e.preventDefault(); _acActiveIndex=Math.min(_acActiveIndex+1,items.length-1); items.forEach((it,i)=>it.classList.toggle('active',i===_acActiveIndex)); }
  else if (e.key==='ArrowUp')   { e.preventDefault(); _acActiveIndex=Math.max(_acActiveIndex-1,0); items.forEach((it,i)=>it.classList.toggle('active',i===_acActiveIndex)); }
  else if (e.key==='Enter'&&_acActiveIndex>=0) { e.preventDefault(); items[_acActiveIndex]?.dispatchEvent(new MouseEvent('mousedown')); }
  else if (e.key==='Escape') drop.classList.remove('open');
}

// Patch populateContactSelect — ac inputs just clear value & pre-cache
const _origPopulateCS = populateContactSelect;
async function populateContactSelect(selectId, type, allowEmpty=true) {
  const e2 = document.getElementById(selectId);
  if (!e2 || e2.tagName !== 'SELECT') { if(e2) e2.value=''; acGetContacts(type); return; }
  return _origPopulateCS(selectId, type, allowEmpty);
}

// Cache cleared in submitContact directly

// Fix value reading for supplier/customer — no more -new suffix
// (already handled: nf-supplier, sale-customer, qs-customer are now single inputs)

// ════════════════════════════════════════
// EDIT PAYMENT
// ════════════════════════════════════════
async function openEditPaymentModal(paymentId) {
  try {
    const data = await apiGet('payments', { select:'*', id:`eq.${paymentId}` });
    const p = data?.[0];
    if (!p) { toast('لم يُعثر على البيانات','err'); return; }

    // Load partners for this file
    let partners = await apiGet('partners_master', { select:'partner', system_type:`eq.${state.system}`, file_no:`eq.${p.file_no}` });
    if (!partners?.length) {
      const all = await getContactsByType('partner');
      partners = (all||[]).map(x=>({partner:x.name}));
    }
    el('ep-id').value     = p.id;
    el('ep-payer').innerHTML = (partners||[]).map(pm =>
      `<option value="${pm.partner}" ${pm.partner===p.payer?'selected':''}>${pm.partner}</option>`
    ).join('');
    el('ep-payer').value  = p.payer    || '';
    el('ep-amount').value = p.amount   || '';
    el('ep-method').value = p.pay_method || 'تحويل بنكي';
    el('ep-date').value   = p.pay_date  || '';
    el('ep-doc').value    = p.document  || '';
    el('ep-notes').value  = p.notes     || '';
    el('epError').style.display = 'none';
    openModal('editPaymentModal');
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

async function submitEditPayment() {
  const id     = el('ep-id').value;
  const payer  = el('ep-payer').value;
  const amount = parseFloat(el('ep-amount').value);
  const method = el('ep-method').value;
  const date   = el('ep-date').value;
  const doc    = el('ep-doc').value.trim();
  const notes  = el('ep-notes').value.trim();
  if (!payer || !amount || !date) { showFieldErr('epError','يرجى ملء الحقول المطلوبة'); return; }
  try {
    await apiPatch('payments', { id:`eq.${id}` }, { payer, amount, pay_method:method, pay_date:date, document:doc||null, notes:notes||null });
    closeModal('editPaymentModal');
    toast('✅ تم تعديل الدفعة','ok');
    if (state.currentTab === 2) loadPaymentsTab(state.currentFileNo, state.system);
    if (state.currentTab === 0) loadSummaryTab(state.currentFileNo, state.system);
  } catch(e) { showFieldErr('epError','خطأ: '+e.message); }
}

// ════════════════════════════════════════
// EDIT EXPENSE
// ════════════════════════════════════════
async function openEditExpenseModal(expenseId) {
  try {
    const data = await apiGet('expenses', { select:'*', id:`eq.${expenseId}` });
    const e = data?.[0];
    if (!e) { toast('لم يُعثر على البيانات','err'); return; }
    el('ee-id').value     = e.id;
    el('ee-desc').value   = e.description  || '';
    el('ee-type').value   = e.exp_type     || 'أخرى';
    el('ee-amount').value = e.amount       || '';
    el('ee-date').value   = e.exp_date     || '';
    el('ee-method').value = e.pay_method   || 'تحويل بنكي';
    el('ee-doc').value    = e.document     || '';
    el('ee-notes').value  = e.notes        || '';
    el('eeError').style.display = 'none';
    openModal('editExpenseModal');
  } catch(err) { toast('خطأ: '+err.message,'err'); }
}

async function submitEditExpense() {
  const id     = el('ee-id').value;
  const desc   = el('ee-desc').value.trim();
  const type   = el('ee-type').value;
  const amount = parseFloat(el('ee-amount').value);
  const date   = el('ee-date').value;
  const method = el('ee-method').value;
  const doc    = el('ee-doc').value.trim();
  const notes  = el('ee-notes').value.trim();
  if (!desc || !amount || !date) { showFieldErr('eeError','يرجى ملء الحقول المطلوبة'); return; }
  try {
    await apiPatch('expenses', { id:`eq.${id}` }, { description:desc, exp_type:type, amount, exp_date:date, pay_method:method, document:doc||null, notes:notes||null });
    closeModal('editExpenseModal');
    toast('✅ تم تعديل المصروف','ok');
    if (state.currentTab === 3) loadExpensesTab(state.currentFileNo, state.system);
    if (state.currentTab === 0) loadSummaryTab(state.currentFileNo, state.system);
  } catch(e) { showFieldErr('eeError','خطأ: '+e.message); }
}

// ════════════════════════════════════════
// EDIT COLLECTION
// ════════════════════════════════════════
async function openEditCollectionModal(collectionId) {
  try {
    const data = await apiGet('collections', { select:'*', id:`eq.${collectionId}` });
    const c = data?.[0];
    if (!c) { toast('لم يُعثر على البيانات','err'); return; }
    el('ec-id').value       = c.id;
    el('ec-invNo').value    = c.inv_no    || '';
    el('ec-customer').value = c.customer  || '';
    el('ec-amount').value   = c.amount    || '';
    el('ec-method').value   = c.pay_method || 'تحويل بنكي';
    el('ec-dueDate').value  = c.due_date  || '';
    el('ec-paidDate').value = c.paid_date || '';
    el('ec-doc').value      = c.document  || '';
    el('ec-notes').value    = c.notes     || '';
    el('ecError').style.display = 'none';
    openModal('editCollectionModal');
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

async function submitEditCollection() {
  const id     = el('ec-id').value;
  const amount = parseFloat(el('ec-amount').value);
  const method = el('ec-method').value;
  const due    = el('ec-dueDate').value;
  const paid   = el('ec-paidDate').value;
  const doc    = el('ec-doc').value.trim();
  const notes  = el('ec-notes').value.trim();
  if (!amount) { showFieldErr('ecError','يرجى إدخال المبلغ'); return; }
  try {
    await apiPatch('collections', { id:`eq.${id}` }, { amount, pay_method:method, due_date:due||null, paid_date:paid||null, document:doc||null, notes:notes||null });
    closeModal('editCollectionModal');
    toast('✅ تم تعديل التحصيل','ok');
    if (state.currentTab === 5) loadCollectionsTab(state.currentFileNo, state.system);
    if (state.currentTab === 0) loadSummaryTab(state.currentFileNo, state.system);
  } catch(e) { showFieldErr('ecError','خطأ: '+e.message); }
}

// ════════════════════════════════════════
// OPERATING EXPENSES (مصاريف تشغيلية)
// ════════════════════════════════════════

const OPEX_TYPES = ['رواتب','إيجارات','عمولات','نظافة','ضيافة','مصروفات حكومية','أخرى'];
const OPEX_COLORS = {
  'رواتب':'var(--blue)', 'إيجارات':'var(--purple)', 'عمولات':'var(--accent)',
  'نظافة':'var(--cyan)', 'ضيافة':'var(--green)', 'مصروفات حكومية':'var(--red)', 'أخرى':'var(--text2)'
};

async function showOpex() {
  hideAllViews();
  el('opexView').style.display = 'block';
  el('topBarTitle').textContent = 'المصاريف التشغيلية';
  el('topBarSub').textContent   = `نظام ${state.system}`;
  if(el('opexSystemLabel')) el('opexSystemLabel').textContent = `نظام ${state.system}`;
  navActive('nav-opex');
  sessionStorage.setItem('tm_last_view','opex');
  await loadOpex();
}

async function loadOpex() {
  const wrap = el('opexTableBody');
  if (!wrap) return;
  setLoading('opexTableBody');

  const typeFilter = el('opex-filter-type')?.value || '';
  const fromFilter = el('opex-filter-from')?.value || '';
  const toFilter   = el('opex-filter-to')?.value   || '';

  try {
    const params = { select:'*', system_type:`eq.${state.system}`, order:'exp_date.desc' };
    if (typeFilter) params.exp_type = `eq.${typeFilter}`;
    if (fromFilter) params['exp_date'] = `gte.${fromFilter}`;
    if (toFilter)   params['exp_date_end'] = `lte.${toFilter}`;

    // Build URL manually for date range
    let url = `${SB_URL}/rest/v1/operating_expenses?system_type=eq.${encodeURIComponent(state.system)}&order=exp_date.desc&select=*`;
    if (typeFilter) url += `&exp_type=eq.${encodeURIComponent(typeFilter)}`;
    if (fromFilter) url += `&exp_date=gte.${encodeURIComponent(fromFilter)}`;
    if (toFilter)   url += `&exp_date=lte.${encodeURIComponent(toFilter)}`;

    const res  = await fetch(url, { headers: headers() });
    const data = res.ok ? await res.json() : [];

    // KPIs
    renderOpexKpis(data);

    if (!data.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="e-icon">💼</div><p>لا توجد مصاريف تشغيلية</p><small>اضغط "إضافة مصروف" لتسجيل أول مصروف</small></div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>الرقم المرجعي</th><th>النوع</th><th>الوصف / البيان</th>
          <th>المستفيد</th><th>المبلغ</th><th>طريقة الدفع</th>
          <th>المستند</th><th>التاريخ</th><th>ملاحظات</th><th></th>
        </tr></thead>
        <tbody>
          ${data.map(r => `<tr>
            <td class="mono" style="font-size:11px;color:var(--purple);font-weight:700">${r.ref_no||'—'}</td>
            <td><span style="background:var(--purple-dim);color:var(--purple);padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap">${r.exp_type||'—'}</span></td>
            <td style="font-weight:600">${r.description||'—'}</td>
            <td style="color:var(--text2)">${r.beneficiary||'—'}</td>
            <td class="mono text-red" style="font-weight:700">${fmt(r.amount)}</td>
            <td>${r.pay_method||'—'}</td>
            <td class="mono">${r.document||'—'}</td>
            <td class="mono">${fmtDate(r.exp_date)}</td>
            <td style="color:var(--text2);font-size:12px">${r.notes||''}</td>
            <td>
              <div style="display:flex;gap:4px">
                <button class="btn btn-secondary btn-sm" onclick="openEditOpexModal(${r.id})">✏️</button>
                ${can('delete') ? `<button class="btn btn-secondary btn-sm" onclick="deleteOpex(${r.id})" style="color:var(--red)">🗑</button>` : ''}
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    wrap.innerHTML = `<div class="alert alert-err" style="margin:16px">⚠️ خطأ: ${e.message}</div>`;
  }
}

function renderOpexKpis(data) {
  const kpis = el('opexKpis');
  if (!kpis) return;
  const total = data.reduce((s,r) => s + (+r.amount||0), 0);

  // Group by type
  const byType = {};
  data.forEach(r => {
    const t = r.exp_type || 'أخرى';
    byType[t] = (byType[t]||0) + (+r.amount||0);
  });

  const topType = Object.entries(byType).sort((a,b)=>b[1]-a[1])[0];

  kpis.innerHTML = `
    <div class="vkpi" style="border-right:3px solid var(--purple)">
      <div class="vkpi-label">إجمالي التشغيلية</div>
      <div class="vkpi-val" style="color:var(--purple)">${fmt(total)}</div>
      <div style="font-size:10px;color:var(--text2);margin-top:3px">${data.length} قيد</div>
    </div>
    ${Object.entries(byType).map(([type, amt]) => `
    <div class="vkpi" style="border-right:3px solid ${OPEX_COLORS[type]||'var(--text2)'}">
      <div class="vkpi-label">${type}</div>
      <div class="vkpi-val" style="color:${OPEX_COLORS[type]||'var(--text2)'}">${fmt(amt)}</div>
      <div style="font-size:10px;color:var(--text2);margin-top:3px">${((amt/total)*100).toFixed(0)}% من الإجمالي</div>
    </div>`).join('')}`;
}

function onOpexTypeChange() {
  const type = el('opex-type').value;
  const wrap = el('opex-other-wrap');
  if (wrap) wrap.style.display = type === 'أخرى' ? 'block' : 'none';
}

function openOpexModal() {
  el('opex-id').value          = '';
  el('opexModalTitle').textContent = 'إضافة مصروف تشغيلي';
  el('opex-type').value        = '';
  el('opex-desc').value        = '';
  el('opex-amount').value      = '';
  el('opex-date').value        = today();
  el('opex-method').value      = 'تحويل بنكي';
  el('opex-doc').value         = '';
  el('opex-beneficiary').value = '';
  el('opex-notes').value       = '';
  el('opexError').style.display = 'none';
  if(el('opex-other-wrap')) el('opex-other-wrap').style.display = 'none';
  el('opexSubmitBtn').textContent = '💾 حفظ';
  el('opexSubmitBtn').onclick = submitOpex;
  openModal('opexModal');
}

async function openEditOpexModal(id) {
  try {
    const data = await apiGet('operating_expenses', { select:'*', id:`eq.${id}` });
    const r = data?.[0];
    if (!r) { toast('لم يُعثر على البيانات','err'); return; }
    el('opex-id').value          = r.id;
    el('opexModalTitle').textContent = 'تعديل مصروف تشغيلي';
    el('opex-type').value        = OPEX_TYPES.includes(r.exp_type) ? r.exp_type : 'أخرى';
    el('opex-desc').value        = r.description   || '';
    el('opex-amount').value      = r.amount        || '';
    el('opex-date').value        = r.exp_date      || '';
    el('opex-method').value      = r.pay_method    || 'تحويل بنكي';
    el('opex-doc').value         = r.document      || '';
    el('opex-beneficiary').value = r.beneficiary   || '';
    el('opex-notes').value       = r.notes         || '';
    el('opexError').style.display = 'none';
    if (!OPEX_TYPES.includes(r.exp_type) || r.exp_type === 'أخرى') {
      if(el('opex-other-wrap'))  el('opex-other-wrap').style.display  = 'block';
      if(el('opex-other-label')) el('opex-other-label').value = r.exp_type !== 'أخرى' ? r.exp_type : '';
    } else {
      if(el('opex-other-wrap')) el('opex-other-wrap').style.display = 'none';
    }
    el('opexSubmitBtn').textContent = '💾 حفظ التعديل';
    el('opexSubmitBtn').onclick = submitEditOpex;
    openModal('opexModal');
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

async function submitOpex() {
  const type        = el('opex-type').value;
  const otherLabel  = el('opex-other-label')?.value?.trim() || '';
  const finalType   = type === 'أخرى' ? (otherLabel || 'أخرى') : type;
  const desc        = el('opex-desc').value.trim();
  const amount      = parseFloat(el('opex-amount').value);
  const date        = el('opex-date').value;
  const method      = el('opex-method').value;
  const doc         = el('opex-doc').value.trim();
  const beneficiary = el('opex-beneficiary').value.trim();
  const notes       = el('opex-notes').value.trim();

  if (!finalType || !desc || !amount || !date) {
    showFieldErr('opexError','يرجى ملء الحقول المطلوبة: النوع، الوصف، المبلغ، التاريخ');
    return;
  }

  try {
    const refNo = await genSeqRef('OPEX', state.system, null, 'operating_expenses') || `OPEX-${state.system}-${Date.now()}`;
    const payload = {
      system_type: state.system, ref_no: refNo,
      exp_type: finalType, description: desc, amount,
      exp_date: date, pay_method: method,
      document: doc||null, beneficiary: beneficiary||null, notes: notes||null
    };
    await apiPost('operating_expenses', payload);
    await logAudit('INSERT','operating_expenses', null, null, payload);
    closeModal('opexModal');
    invalidateCache();
    toast('✅ تم تسجيل المصروف التشغيلي','ok');
    invalidateCache();
    await loadOpex();
  } catch(e) { showFieldErr('opexError','خطأ: '+e.message); }
}

async function submitEditOpex() {
  const id          = el('opex-id').value;
  const type        = el('opex-type').value;
  const otherLabel  = el('opex-other-label')?.value?.trim() || '';
  const finalType   = type === 'أخرى' ? (otherLabel || 'أخرى') : type;
  const desc        = el('opex-desc').value.trim();
  const amount      = parseFloat(el('opex-amount').value);
  const date        = el('opex-date').value;
  const method      = el('opex-method').value;
  const doc         = el('opex-doc').value.trim();
  const beneficiary = el('opex-beneficiary').value.trim();
  const notes       = el('opex-notes').value.trim();

  if (!finalType || !desc || !amount || !date) {
    showFieldErr('opexError','يرجى ملء الحقول المطلوبة');
    return;
  }
  try {
    await apiPatch('operating_expenses', { id:`eq.${id}` }, {
      exp_type: finalType, description: desc, amount,
      exp_date: date, pay_method: method,
      document: doc||null, beneficiary: beneficiary||null, notes: notes||null
    });
    closeModal('opexModal');
    toast('✅ تم تعديل المصروف','ok');
    await loadOpex();
  } catch(e) { showFieldErr('opexError','خطأ: '+e.message); }
}

async function deleteOpex(id) {
  showConfirm('حذف مصروف تشغيلي', 'سيتم حذف هذا المصروف نهائياً. لا يمكن التراجع.', async () => {
    try {
      await apiDelete('operating_expenses', { id:`eq.${id}` });
      toast('✅ تم الحذف','ok');
      await loadOpex();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

function exportOpexExcel() {
  const rows = document.querySelectorAll('#opexTableBody table tbody tr');
  if (!rows.length) { toast('لا توجد بيانات للتصدير','err'); return; }
  const data = [['الرقم','النوع','الوصف','المستفيد','المبلغ','طريقة الدفع','المستند','التاريخ','ملاحظات']];
  rows.forEach(tr => {
    const cells = tr.querySelectorAll('td');
    data.push([
      cells[0]?.textContent?.trim()||'',
      cells[1]?.textContent?.trim()||'',
      cells[2]?.textContent?.trim()||'',
      cells[3]?.textContent?.trim()||'',
      cells[4]?.textContent?.trim()||'',
      cells[5]?.textContent?.trim()||'',
      cells[6]?.textContent?.trim()||'',
      cells[7]?.textContent?.trim()||'',
      cells[8]?.textContent?.trim()||'',
    ]);
  });
  exportToExcel([{ name:'المصاريف التشغيلية', data }], `OPEX_${state.system}_${today()}`);
}

// ── Inject opex into Journal ──
// Called from loadJournal — adds operating_expenses to journal entries
async function fetchOpexForJournal(from, to, sys) {
  try {
    let url = `${SB_URL}/rest/v1/operating_expenses?system_type=eq.${encodeURIComponent(sys)}&exp_date=gte.${encodeURIComponent(from)}&exp_date=lte.${encodeURIComponent(to)}&order=exp_date.desc&select=*`;
    const res = await fetch(url, { headers: headers() });
    return res.ok ? await res.json() : [];
  } catch(e) { return []; }
}

// ── Opex in Reports ──
async function loadOpexReport(from, to) {
  const wrap = el('reportTable');
  const kpis = el('reportKpis');
  if (!wrap) return;
  wrap.innerHTML = `<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>`;

  try {
    let url = `${SB_URL}/rest/v1/operating_expenses?system_type=eq.${encodeURIComponent(state.system)}&select=*&order=exp_date.desc`;
    if (from) url += `&exp_date=gte.${encodeURIComponent(from)}`;
    if (to)   url += `&exp_date=lte.${encodeURIComponent(to)}`;
    const res  = await fetch(url, { headers: headers() });
    const data = res.ok ? await res.json() : [];

    const total = data.reduce((s,r) => s + (+r.amount||0), 0);
    const byType = {};
    data.forEach(r => { const t=r.exp_type||'أخرى'; byType[t]=(byType[t]||0)+(+r.amount||0); });

    kpis.innerHTML = `
      <div class="vkpi" style="border-right:3px solid var(--purple)">
        <div class="vkpi-label">الإجمالي</div>
        <div class="vkpi-val" style="color:var(--purple)">${fmt(total)}</div>
      </div>
      ${Object.entries(byType).map(([t,v])=>`
      <div class="vkpi" style="border-right:3px solid ${OPEX_COLORS[t]||'var(--text2)'}">
        <div class="vkpi-label">${t}</div>
        <div class="vkpi-val">${fmt(v)}</div>
      </div>`).join('')}`;

    if (!data.length) { wrap.innerHTML = `<div class="empty-state"><div class="e-icon">💼</div><p>لا توجد مصاريف في هذه الفترة</p></div>`; return; }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>الرقم</th><th>النوع</th><th>الوصف</th><th>المستفيد</th>
          <th>المبلغ</th><th>طريقة الدفع</th><th>التاريخ</th>
        </tr></thead>
        <tbody>
          ${data.map(r=>`<tr>
            <td class="mono" style="font-size:11px;color:var(--purple)">${r.ref_no||'—'}</td>
            <td><span style="background:var(--purple-dim);color:var(--purple);padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">${r.exp_type||'—'}</span></td>
            <td>${r.description||'—'}</td>
            <td style="color:var(--text2)">${r.beneficiary||'—'}</td>
            <td class="mono text-red">${fmt(r.amount)}</td>
            <td>${r.pay_method||'—'}</td>
            <td class="mono">${fmtDate(r.exp_date)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch(e) { wrap.innerHTML = errHTML(e.message); }
}

// ════════════════════════════════════════
// DRILL-DOWN — كل KPI بيفتح تفاصيله
// ════════════════════════════════════════
let _ddState = { type: null, data: {} };

function closeDrillDownMain() {
  if(el('dash-details-area')) el('dash-details-area').style.display = 'none';
  _ddState.type = null;
  document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('kpi-active'));
}

function closeDrillDown() {
  if(el('dash-drilldown')) el('dash-drilldown').style.display = 'none';
  if(el('dash-details-area')) el('dash-details-area').style.display = 'none';
  document.querySelectorAll('.kpi-clickable').forEach(c => c.classList.remove('dd-active'));
  _ddState.type = null;
}


function toggleDrillDown(type) {
  document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('kpi-active'));
  const activeCard = el('kpi-card-' + type);
  if(activeCard && _ddState.type !== type) activeCard.classList.add('kpi-active');
  if (_ddState.type === type) { closeDrillDownMain(); return; }
  _ddState.type = type;
  document.querySelectorAll('.kpi-clickable').forEach(c => c.classList.remove('dd-active'));
  el('kpi-card-' + type)?.classList.add('dd-active');
  renderDrillDown(type);
  // أظهر في المنطقة الجديدة
  if(el('dash-details-area')) {
    el('dash-details-area').style.display = 'block';
    el('dash-details-area').scrollIntoView({ behavior:'smooth', block:'nearest' });
  }
  if(el('dash-drilldown')) el('dash-drilldown').style.display = 'none';
}

function renderDrillDown(type) {
  const d = _ddState.data;
  const panel = el('dash-details-area') || el('dash-drilldown');
  const ddKpis = el('dd-kpis-main')||el('dd-kpis');
  const ddTable = el('dd-table-main')||el('dd-table');
  const ddChartWrap = el('dd-chart-wrap-main')||el('dd-chart-wrap');
  if (!panel) return;

  const periodLabel = el('dash-period-label')?.textContent || '';

  // ── تكلفة الشراء ──
  if (type === 'purchase') {
    (el('dd-title-main')||el('dd-title')).textContent = `📋 تفاصيل تكلفة الشراء — ${periodLabel}`;
    const deals = (d.periodPurchaseDeals && d.periodPurchaseDeals.length) ? d.periodPurchaseDeals : (d.periodDeals || []);
    const total = deals.reduce((s,d2)=>s+(+d2.total_purchase||0),0);
    const bySupplier = {};
    deals.forEach(d2=>{ bySupplier[d2.supplier||'غير محدد']=(bySupplier[d2.supplier||'غير محدد']||0)+(+d2.total_purchase||0); });
    ddKpis.style.gridTemplateColumns = 'repeat(3,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--blue)">${fmt(total)}</div><div class="dd-kpi-lbl">إجمالي الشراء</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val">${deals.length}</div><div class="dd-kpi-lbl">عدد الصفقات</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val">${deals.reduce((s,d2)=>s+(+d2.vehicle_count||0),0)}</div><div class="dd-kpi-lbl">عدد السيارات</div></div>`;
    renderDDChart(Object.entries(bySupplier).sort((a,b)=>b[1]-a[1]), 'var(--blue)');
    ddTable.innerHTML = deals.length ? `
      <table class="data-table"><thead><tr>
        <th>رقم الملف</th><th>المورد</th><th>تاريخ PO</th><th>السيارات</th><th>تكلفة الشراء</th><th>الحالة</th>
      </tr></thead><tbody>
      ${deals.map(d2=>`<tr onclick="openViewer('${d2.file_no}')" style="cursor:pointer">
        <td class="mono text-amber" style="font-weight:700">${d2.file_no}</td>
        <td>${d2.supplier||'—'}</td>
        <td class="mono">${fmtDate(d2.po_date)}</td>
        <td style="text-align:center">${d2.vehicle_count||0}</td>
        <td class="mono text-blue" style="font-weight:700">${fmt(d2.total_purchase)}</td>
        <td><span class="badge badge-${statusClass(d2.status)}">${d2.status}</span></td>
      </tr>`).join('')}
      </tbody></table>` : emptyHTML('📋','لا توجد صفقات في هذه الفترة');
  }

  // ── مبيعات ──
  else if (type === 'sales') {
    (el('dd-title-main')||el('dd-title')).textContent = `💹 تفاصيل المبيعات — ${periodLabel}`;
    const sales = d.periodSales || [];
    const total = sales.reduce((s,r)=>s+(+r.sale_price||0),0);
    const byFile = {};
    sales.forEach(r => { byFile[r.file_no]=(byFile[r.file_no]||0)+(+r.sale_price||0); });
    ddKpis.style.gridTemplateColumns = 'repeat(3,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--green)">${fmt(total)}</div><div class="dd-kpi-lbl">إجمالي المبيعات</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val">${sales.length}</div><div class="dd-kpi-lbl">عدد الفواتير</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val">${Object.keys(byFile).length}</div><div class="dd-kpi-lbl">عدد الملفات</div></div>`;
    renderDDChart(Object.entries(byFile).sort((a,b)=>b[1]-a[1]), 'var(--green)');
    ddTable.innerHTML = sales.length ? `
      <table class="data-table"><thead><tr>
        <th>التاريخ</th><th>الملف</th><th>الشاصي</th><th>العميل</th><th>سعر البيع</th>
      </tr></thead><tbody>
      ${sales.map(r=>`<tr onclick="openViewer('${r.file_no}')" style="cursor:pointer">
        <td class="mono">${fmtDate(r.sale_date)}</td>
        <td class="mono text-amber">${r.file_no||'—'}</td>
        <td class="mono" style="font-size:11px">${r.vin||'—'}</td>
        <td>${r.customer||'—'}</td>
        <td class="mono text-green" style="font-weight:700">${fmt(r.sale_price)}</td>
      </tr>`).join('')}
      </tbody></table>` : emptyHTML('💹','لا توجد مبيعات في هذه الفترة');
  }

  // ── تحصيلات ──
  else if (type === 'collections') {
    (el('dd-title-main')||el('dd-title')).textContent = `💰 تفاصيل التحصيلات — ${periodLabel}`;
    const colls = d.periodCollections || [];
    const paid   = colls.filter(c=>c.paid_date).reduce((s,c)=>s+(+c.amount||0),0);
    const unpaid = colls.filter(c=>!c.paid_date).reduce((s,c)=>s+(+c.amount||0),0);
    const overdue= colls.filter(c=>!c.paid_date && (c.due_date ? c.due_date <= d.todayStr : true)).length;
    ddKpis.style.gridTemplateColumns = 'repeat(4,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--blue)">${fmt(paid+unpaid)}</div><div class="dd-kpi-lbl">إجمالي التحصيلات</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--green)">${fmt(paid)}</div><div class="dd-kpi-lbl">تم تحصيله</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--accent)">${fmt(unpaid)}</div><div class="dd-kpi-lbl">لم يُحصَّل</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--red)">${overdue}</div><div class="dd-kpi-lbl">متأخر</div></div>`;
    // chart by customer
    const byCustomer = {};
    colls.forEach(c=>{ byCustomer[c.customer||'غير محدد']=(byCustomer[c.customer||'غير محدد']||0)+(+c.amount||0); });
    renderDDChart(Object.entries(byCustomer).sort((a,b)=>b[1]-a[1]).slice(0,8), 'var(--blue)');
    ddTable.innerHTML = colls.length ? `
      <table class="data-table"><thead><tr>
        <th>الاستحقاق</th><th>تاريخ الدفع</th><th>الملف</th><th>رقم الفاتورة</th><th>العميل</th><th>المبلغ</th><th>الحالة</th>
      </tr></thead><tbody>
      ${colls.map(c=>{
        const isOverdue = !c.paid_date && c.due_date && c.due_date < d.todayStr;
        return `<tr onclick="openViewer('${c.file_no||''}')" style="cursor:pointer">
          <td class="mono">${fmtDate(c.due_date)}</td>
          <td class="mono" style="color:${c.paid_date?'var(--green)':'var(--text2)'}">${c.paid_date?fmtDate(c.paid_date):'—'}</td>
          <td class="mono text-amber">${c.file_no||'—'}</td>
          <td class="mono">${c.inv_no||'—'}</td>
          <td>${c.customer||'—'}</td>
          <td class="mono" style="font-weight:700;color:var(--blue)">${fmt(c.amount)}</td>
          <td><span style="background:${c.paid_date?'var(--green-dim)':isOverdue?'var(--red-dim)':'var(--accent-dim)'};color:${c.paid_date?'var(--green)':isOverdue?'var(--red)':'var(--accent)'};padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">
            ${c.paid_date?'✓ مُحصَّل':isOverdue?'متأخر':'معلق'}</span></td>
        </tr>`;
      }).join('')}
      </tbody></table>` : emptyHTML('💰','لا توجد تحصيلات في هذه الفترة');
  }

  // ── مصاريف ──
  else if (type === 'expenses') {
    (el('dd-title-main')||el('dd-title')).textContent = `💸 تفاصيل المصاريف — ${periodLabel}`;
    const exps = d.periodExp || [];
    const total = exps.reduce((s,e)=>s+(+e.amount||0),0);
    const byType = {};
    exps.forEach(e=>{byType[e.exp_type||'أخرى']=(byType[e.exp_type||'أخرى']||0)+(+e.amount||0);});
    ddKpis.style.gridTemplateColumns = `repeat(${Math.min(Object.keys(byType).length+1,5)},1fr)`;
    ddKpis.innerHTML = `<div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--red)">${fmt(total)}</div><div class="dd-kpi-lbl">إجمالي المصاريف</div></div>`
      + Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([t,v])=>
        `<div class="dd-kpi"><div class="dd-kpi-val">${fmt(v)}</div><div class="dd-kpi-lbl">${t}</div></div>`).join('');
    renderDDChart(Object.entries(byType).sort((a,b)=>b[1]-a[1]), 'var(--red)');
    ddTable.innerHTML = exps.length ? `
      <table class="data-table"><thead><tr>
        <th>التاريخ</th><th>الملف</th><th>الوصف</th><th>النوع</th><th>طريقة الدفع</th><th>المبلغ</th>
      </tr></thead><tbody>
      ${exps.map(e=>`<tr onclick="${e.file_no?`openViewer('${e.file_no}')`:'void(0)'}" style="cursor:${e.file_no?'pointer':'default'}">
        <td class="mono">${fmtDate(e.exp_date||e.expense_date)}</td>
        <td class="mono text-amber">${e.file_no||'—'}</td>
        <td>${e.description||'—'}</td>
        <td><span style="background:var(--red-dim);color:var(--red);padding:2px 8px;border-radius:10px;font-size:10px">${e.exp_type||'—'}</span></td>
        <td>${e.pay_method||'—'}</td>
        <td class="mono text-red" style="font-weight:700">${fmt(e.amount)}</td>
      </tr>`).join('')}
      </tbody></table>` : emptyHTML('💸','لا توجد مصاريف في هذه الفترة');
  }

  // ── التكلفة الكاملة ──
  else if (type === 'fullcost') {
    (el('dd-title-main')||el('dd-title')).textContent = `🏷️ التكلفة الكاملة — ${periodLabel}`;
    const deals  = d.periodDeals  || [];
    const totPur = deals.reduce((s,d2)=>s+(+d2.total_purchase||0),0);
    const totExp = (d.periodExp||[]).filter(e=>e.file_no).reduce((s,e)=>s+(+e.amount||0),0);
    ddKpis.style.gridTemplateColumns = 'repeat(3,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--blue)">${fmt(totPur)}</div><div class="dd-kpi-lbl">تكلفة الشراء</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--red)">${fmt(totExp)}</div><div class="dd-kpi-lbl">مصاريف الصفقات</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--accent)">${fmt(totPur+totExp)}</div><div class="dd-kpi-lbl">التكلفة الكاملة</div></div>`;
    const byFile = {};
    deals.forEach(d2=>{
      const fe = (d.periodExp||[]).filter(e=>e.file_no===d2.file_no).reduce((s,e)=>s+(+e.amount||0),0);
      byFile[d2.file_no]=(+d2.total_purchase||0)+fe;
    });
    renderDDChart(Object.entries(byFile).sort((a,b)=>b[1]-a[1]), 'var(--accent)');
    ddTable.innerHTML = deals.length ? `
      <table class="data-table"><thead><tr>
        <th>الملف</th><th>المورد</th><th>تكلفة الشراء</th><th>المصاريف</th><th>التكلفة الكاملة</th><th>الحالة</th>
      </tr></thead><tbody>
      ${deals.map(d2=>{
        const fe=(d.periodExp||[]).filter(e=>e.file_no===d2.file_no).reduce((s,e)=>s+(+e.amount||0),0);
        const fc=(+d2.total_purchase||0)+fe;
        return `<tr onclick="openViewer('${d2.file_no}')" style="cursor:pointer">
          <td class="mono text-amber" style="font-weight:700">${d2.file_no}</td>
          <td>${d2.supplier||'—'}</td>
          <td class="mono text-blue">${fmt(d2.total_purchase)}</td>
          <td class="mono text-red">${fmt(fe)}</td>
          <td class="mono" style="font-weight:700;color:var(--accent)">${fmt(fc)}</td>
          <td><span class="badge badge-${statusClass(d2.status)}">${d2.status}</span></td>
        </tr>`;
      }).join('')}
      </tbody></table>` : emptyHTML('🏷️','لا توجد صفقات في هذه الفترة');
  }

  // ── صافي الربح ──
  else if (type === 'profit') {
    (el('dd-title-main')||el('dd-title')).textContent = `📈 نتائج العمليات — ${periodLabel}`;
    const sales   = d.periodSales  || [];
    const deals   = d.periodDeals  || [];
    const exps    = d.periodExp    || [];
    const totS    = sales.reduce((s,r)=>s+(+r.sale_price||0),0);
    const totPur  = deals.reduce((s,d2)=>s+(+d2.total_purchase||0),0);
    const totE    = exps.filter(e=>e.file_no).reduce((s,e)=>s+(+e.amount||0),0);
    const profit  = totS - totPur - totE;
    const margin  = totS>0?((profit/totS)*100).toFixed(1):0;
    ddKpis.style.gridTemplateColumns = 'repeat(5,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--green)">${fmt(totS)}</div><div class="dd-kpi-lbl">المبيعات</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--blue)">${fmt(totPur)}</div><div class="dd-kpi-lbl">تكلفة الشراء</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--red)">${fmt(totE)}</div><div class="dd-kpi-lbl">المصاريف</div></div>
      <div class="dd-kpi" style="background:${profit>=0?'var(--green-dim)':'var(--red-dim)'}"><div class="dd-kpi-val" style="color:${profit>=0?'var(--green)':'var(--red)'}">${fmt(profit)}</div><div class="dd-kpi-lbl">صافي الربح</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:${profit>=0?'var(--green)':'var(--red)'}">${margin}%</div><div class="dd-kpi-lbl">هامش الربح</div></div>`;
    // ربح كل صفقة
    const fileNos = [...new Set(sales.map(s=>s.file_no))];
    const fileData = fileNos.map(fn=>{
      const fs = sales.filter(s=>s.file_no===fn).reduce((s,r)=>s+(+r.sale_price||0),0);
      const fd = deals.find(d2=>d2.file_no===fn);
      const fe = exps.filter(e=>e.file_no===fn).reduce((s,e)=>s+(+e.amount||0),0);
      const fp = (+fd?.total_purchase||0)+fe;
      return {fn, sales:fs, cost:fp, profit:fs-fp};
    });
    renderDDChart(fileData.sort((a,b)=>b.profit-a.profit).map(f=>[f.fn, f.profit]), profit>=0?'var(--accent)':'var(--red)');
    ddTable.innerHTML = fileData.length ? `
      <table class="data-table"><thead><tr>
        <th>الملف</th><th>المبيعات</th><th>التكلفة الكاملة</th><th>الربح / الخسارة</th><th>الهامش</th>
      </tr></thead><tbody>
      ${fileData.sort((a,b)=>b.profit-a.profit).map(f=>`<tr onclick="openViewer('${f.fn}')" style="cursor:pointer">
        <td class="mono text-amber" style="font-weight:700">${f.fn}</td>
        <td class="mono text-green">${fmt(f.sales)}</td>
        <td class="mono">${fmt(f.cost)}</td>
        <td class="mono" style="font-weight:700;color:${f.profit>=0?'var(--green)':'var(--red)'}">${f.profit>=0?'+':''}${fmt(f.profit)}</td>
        <td style="color:${f.profit>=0?'var(--green)':'var(--red)'}">${f.sales>0?((f.profit/f.sales)*100).toFixed(1)+'%':'—'}</td>
      </tr>`).join('')}
      </tbody></table>` : emptyHTML('📈','لا توجد بيانات');
  }

  // ── المخزن ──
  else if (type === 'stock') {
    (el('dd-title-main')||el('dd-title')).textContent = `🚗 تفاصيل المخزن`;
    const stock = d.stockVehicles || [];
    const old60 = stock.filter(v=>daysSince(v.created_at)>60).length;
    const old30 = stock.filter(v=>daysSince(v.created_at)>30&&daysSince(v.created_at)<=60).length;
    ddKpis.style.gridTemplateColumns = 'repeat(4,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--purple)">${stock.length}</div><div class="dd-kpi-lbl">إجمالي المخزن</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--green)">${stock.length-old30-old60}</div><div class="dd-kpi-lbl">أقل من 30 يوم</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--accent)">${old30}</div><div class="dd-kpi-lbl">30-60 يوم</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--red)">${old60}</div><div class="dd-kpi-lbl">أكثر من 60 يوم</div></div>`;
    ddChartWrap.style.display = 'none';
    ddTable.innerHTML = stock.length ? `
      <table class="data-table"><thead><tr>
        <th>الملف</th><th>الموديل</th><th>رقم الشاصي</th><th>تكلفة الشراء</th><th>أيام في المخزن</th><th>الحالة</th>
      </tr></thead><tbody>
      ${stock.sort((a,b)=>daysSince(b.created_at)-daysSince(a.created_at)).map(v=>{
        const days=daysSince(v.created_at);
        const color=days>60?'var(--red)':days>30?'var(--accent)':'var(--green)';
        const bg=days>60?'var(--red-dim)':days>30?'var(--accent-dim)':'var(--green-dim)';
        return `<tr onclick="openViewer('${v.file_no}')" style="cursor:pointer">
          <td class="mono text-amber">${v.file_no||'—'}</td>
          <td style="font-weight:600">${v.model||v.make||'—'} ${v.year||''}</td>
          <td class="mono" style="font-size:11px">${v.vin||'—'}</td>
          <td class="mono">${fmt(v.purchase_price)}</td>
          <td><span style="background:${bg};color:${color};padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">${days} يوم</span></td>
          <td><span style="font-size:10px;color:${color}">${days>60?'⚠️ راكدة':days>30?'تنبه':'جيدة'}</span></td>
        </tr>`;
      }).join('')}
      </tbody></table>` : emptyHTML('🚗','المخزن فارغ');
  }
}

// ── DD mini chart ──
function renderDDChart(entries, color) {
  const chartWrap  = el('dd-chart-wrap-main')||el('dd-chart-wrap');
  const chart      = el('dd-chart-main')||el('dd-chart');
  const labelsWrap = el('dd-chart-labels-main')||el('dd-chart-labels');
  if (!chartWrap||!chart||!entries.length) { if(chartWrap) chartWrap.style.display='none'; return; }
  chartWrap.style.display = 'block';
  const CHART_H = 100;
  const max = Math.max(...entries.map(e=>Math.abs(+e[1]||0)), 1);
  chart.style.cssText = `display:flex;gap:6px;align-items:flex-end;height:${CHART_H}px;border-bottom:1px solid var(--border);padding-bottom:0`;
  chart.innerHTML = entries.slice(0,10).map(([label,val])=>{
    const h   = Math.max(Math.round((Math.abs(+val)/max)*CHART_H), +val!==0?4:0);
    const c   = +val >= 0 ? color : 'var(--red)';
    const amt = Math.abs(+val) >= 1000 ? (Math.abs(+val)/1000).toFixed(1)+'K' : (+val||0).toFixed(0);
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;min-width:0;position:relative">
      <div style="font-size:8px;color:${c};font-weight:600;margin-bottom:2px;white-space:nowrap">${amt}</div>
      <div style="width:100%;height:${h}px;background:${c};border-radius:3px 3px 0 0"></div>
    </div>`;
  }).join('');
  labelsWrap.innerHTML = entries.slice(0,10).map(([label])=>`
    <div style="flex:1;text-align:center;font-size:9px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;padding-top:4px">${label}</div>`).join('');
}

// ── Regenerate file number ──
async function regenFileNo() {
  try {
    const sys  = state.system;
    const all  = await apiGet('purchase_orders', { select:'file_no', system_type:`eq.${sys}`, order:'created_at.desc' });
    const nums = (all||[]).map(d => { const m=(d.file_no||'').match(/(\d+)$/); return m?parseInt(m[1]):0; });
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    el('nf-fileNo').value = `${sys}-${String(next).padStart(3,'0')}`;
    el('nf-fileNo').style.borderColor = 'var(--accent)';
    setTimeout(() => el('nf-fileNo').style.borderColor = '', 1000);
  } catch(e) { toast('خطأ في توليد الرقم','err'); }
}

// ── Regenerate invoice number ──
async function regenInvNo() {
  try {
    const fn  = state.currentFileNo || el('nf-fileNo')?.value?.trim();
    const sys = state.system;
    if (!fn) { toast('حدد رقم الملف أولاً','err'); return; }
    const existing = await apiGet('sales', { select:'inv_no', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'created_at.desc' });
    const nums = (existing||[]).map(s => { const m=(s.inv_no||'').match(/(\d+)$/); return m?parseInt(m[1]):0; });
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    el('sale-invNo').value = `INV-${fn}-${String(next).padStart(3,'0')}`;
    el('sale-invNo').style.borderColor = 'var(--green)';
    setTimeout(() => el('sale-invNo').style.borderColor = '', 1000);
  } catch(e) { toast('خطأ في توليد رقم الفاتورة','err'); }
}

// ════════════════════════════════════════
// APPROVAL QUEUE
// ════════════════════════════════════════
// approvalState moved to top

const APPROVAL_CONFIG = {
  purchase: { icon:'📋', label:'سند شراء', color:'var(--accent)', table:'purchase_orders', amountField:'total_purchase', dateField:'po_date', descFields:['file_no','supplier'] },
  sale:       { icon:'🧾', label:'بيع',         color:'var(--green)',  table:'sales',           amountField:'sale_price',   dateField:'sale_date',  descFields:['inv_no','customer','vin'] },
  expense:    { icon:'💸', label:'مصروف',       color:'var(--red)',    table:'expenses',         amountField:'amount',       dateField:'exp_date',   descFields:['description','exp_type','file_no'] },
  collection: { icon:'💰', label:'تحصيل',       color:'var(--blue)',   table:'collections',      amountField:'amount',       dateField:'paid_date',  descFields:['inv_no','customer','file_no'] },
  payment:    { icon:'💳', label:'دفعة مورد',   color:'var(--cyan)',   table:'payments',         amountField:'amount',       dateField:'pay_date',   descFields:['payer','file_no','pay_method'] },
  payout:     { icon:'👥', label:'صرف شريك',   color:'var(--purple)', table:'partner_payouts',  amountField:'amount',       dateField:'pay_date',   descFields:['partner','payout_type','file_no'] },
};

async function showApprovalQueue() {
  if (!can('roles')) { toast('🔒 هذه الصفحة للمدراء فقط','err'); return; }
  hideAllViews();
  el('approvalView').style.display = 'block';
  el('topBarTitle').textContent = 'المراجعة';
  navActive('nav-approval');
  sessionStorage.setItem('tm_last_view','approval');
  await loadApprovalQueue();
}

async function loadApprovalQueue() {
  const wrap = el('approval-list');
  setLoading('approval-list');

  try {
    const sys = state.system;

    // جيب كل البنود المعلقة من كل الجداول بالتوازي
    const [purchases, sales, expenses, collections, payments, payouts] = await Promise.all([
      apiGet('purchase_orders', { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`, order:'created_at.desc' }),
      apiGet('sales',           { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`, order:'created_at.desc' }),
      apiGet('expenses',        { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`, order:'created_at.desc' }),
      apiGet('collections',     { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`, order:'created_at.desc' }),
      apiGet('payments',        { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`, order:'created_at.desc' }),
      apiGet('partner_payouts', { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`, order:'created_at.desc' }),
    ]);

    // دمج كل البنود مع نوعها
    // جيب المستخدمين من audit_log
    const allIds = [...(purchases||[]),...(sales||[]),...(expenses||[]),...(collections||[]),...(payments||[]),...(payouts||[])].map(r=>r.id).filter(Boolean);
    let _auditUsers = {};
    try {
      const audits = await apiGet('audit_log',{ select:'ref_id,user_email', action:'eq.INSERT', limit:'500' });
      (audits||[]).forEach(a=>{ if(a.ref_id) _auditUsers[String(a.ref_id)] = (a.user_email||'').split('@')[0]; });
    } catch(e) {}
    approvalState.auditUsers = _auditUsers;

    approvalState.all = [
      ...(purchases||[]).map(r    => ({...r, _type:'purchase',   _amount:+r.total_purchase||0, _date:r.po_date,    _desc:`${r.file_no||'—'} · ${r.supplier||'—'} · ${r.vehicle_count||0} سيارة`, _file:r.file_no })),
      ...(sales||[]).map(r        => ({...r, _type:'sale',       _amount:+r.sale_price||0,     _date:r.sale_date,  _desc:`${r.inv_no||'—'} · ${r.customer||'—'} · ${r.vin||'—'}`,               _file:r.file_no })),
      ...(expenses||[]).map(r     => ({...r, _type:'expense',    _amount:+r.amount||0,         _date:r.exp_date||r.expense_date, _desc:`${r.description||'—'} · ${r.exp_type||'—'} · ${r.file_no||'—'}`, _file:r.file_no })),
      ...(collections||[]).map(r  => ({...r, _type:'collection', _amount:+r.amount||0,         _date:r.paid_date||r.due_date,    _desc:`${r.inv_no||'—'} · ${r.customer||'—'} · ${r.file_no||'—'}`,      _file:r.file_no })),
      ...(payments||[]).map(r     => ({...r, _type:'payment',    _amount:+r.amount||0,         _date:r.pay_date,   _desc:`${r.payer||'—'} · ${r.file_no||'—'} · ${r.pay_method||'—'}`,          _file:r.file_no })),
      ...(payouts||[]).map(r      => ({...r, _type:'payout',     _amount:+r.amount||0,         _date:r.pay_date,   _desc:`${r.partner||'—'} · ${r.payout_type||'—'} · ${r.file_no||'—'}`,       _file:r.file_no })),
    ].sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));

    // تحديث الـ badge في الـ sidebar
    const total = approvalState.all.length;
    const badge = el('approval-badge');
    if (badge) { badge.textContent = total || ''; badge.style.display = total ? '' : 'none'; }

    // تحديث الـ subtitle
    if (el('approval-subtitle')) el('approval-subtitle').textContent = `${total} عملية معلقة للمراجعة`;

    // تحديث counts
    Object.keys(APPROVAL_CONFIG).forEach(type => {
      const cnt = el(`af-count-${type}`);
      if (cnt) cnt.textContent = approvalState.all.filter(r=>r._type===type).length || '';
    });
    const cntAll = el('af-count-all');
    if (cntAll) cntAll.textContent = total || '';

    // زر موافقة على الكل
    if (el('approve-all-btn')) el('approve-all-btn').style.display = total ? '' : 'none';

    filterApproval(approvalState.currentType);

  } catch(e) {
    wrap.innerHTML = `<div class="alert alert-err">خطأ: ${e.message}</div>`;
  }
}

function filterApproval(type) {
  approvalState.currentType = type;
  document.querySelectorAll('.approval-filter-btn').forEach(b => b.classList.remove('active'));
  el('af-' + type)?.classList.add('active');

  approvalState.filtered = type === 'all'
    ? approvalState.all.filter(r => r.post_status !== 'cancelled')
    : approvalState.all.filter(r => r._type === type && r.post_status !== 'cancelled');

  renderApprovalList();
}

function renderApprovalList() {
  const wrap = el('approval-list');
  const items = approvalState.filtered;

  if (!items.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="e-icon">✅</div><p>لا توجد عمليات معلقة</p><small>كل العمليات تمت الموافقة عليها</small></div>`;
    return;
  }

  wrap.innerHTML = items.map(r => {
    const cfg = APPROVAL_CONFIG[r._type];
    return `
    <div class="approval-row" onclick="openApprovalDetail('${r._type}','${r.id}')">
      <div class="approval-row-icon" style="background:${cfg.color}22;color:${cfg.color}">${cfg.icon}</div>
      <div class="approval-row-body">
        <div class="approval-row-title">${cfg.label} — ${r._desc}</div>
        <div class="approval-row-meta">
          ${fmtDate(r._date)}
          ${r._file ? `· <span style="color:var(--accent);font-family:monospace">${r._file}</span>` : ''}
          · <span style="color:var(--text2)">${r.ref_no||r.pay_id||r.inv_no||r.file_no||'—'}</span>
          ${approvalState.auditUsers?.[String(r.id)] ? `· <span style="color:var(--blue);font-size:10px;font-weight:600">👤 ${approvalState.auditUsers[String(r.id)]}</span>` : ''}
        </div>
      </div>
      <div class="approval-row-amount" style="color:${cfg.color}">${fmt(r._amount)}</div>
      <div class="approval-row-actions" onclick="event.stopPropagation()">
        <button class="btn btn-sm" onclick="approveItem('${r._type}','${r.id}')"
          style="background:var(--green-dim);border:1px solid var(--green);color:var(--green);padding:4px 8px" title="موافقة">✓</button>
        <button class="btn btn-sm" onclick="rejectItem('${r._type}','${r.id}')"
          style="background:var(--red-dim);border:1px solid var(--red);color:var(--red);padding:4px 8px" title="حذف">🗑</button>
      </div>
    </div>`;
  }).join('');
}


const FIELD_LABELS = {
  file_no:'رقم الملف', supplier:'المورد', po_no:'رقم PO', po_date:'تاريخ PO',
  total_purchase:'قيمة الصفقة', vehicle_count:'عدد السيارات',
  payer:'الدافع', amount:'المبلغ', pay_method:'طريقة الدفع', pay_date:'تاريخ الدفع',
  document:'رقم المستند', notes:'ملاحظات', ref_no:'مرجع', pay_id:'رقم العملية',
  description:'الوصف', exp_type:'النوع', exp_date:'التاريخ',
  inv_no:'رقم الفاتورة', customer:'العميل', vin:'رقم الشاصي',
  sale_price:'سعر البيع', sale_date:'تاريخ البيع',
  due_date:'تاريخ الاستحقاق', paid_date:'تاريخ الدفع',
  partner:'الشريك', payout_type:'نوع الصرف',
  capital_amount:'رأس المال', profit_amount:'الأرباح', advance_amount:'السلفة',
};
const SKIP_FIELDS = new Set(['_type','_amount','_date','_desc','_file','post_status',
  'created_at','updated_at','id','system_type','ref_table','ref_id','status','po_no']);

async function openApprovalDetail(type, id) {
  const cfg  = APPROVAL_CONFIG[type];
  const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
  if (!item || !cfg) return;

  approvalState.currentItem = { type, id, item };

  el('ad-icon').textContent = cfg.icon;
  el('ad-icon').style.background = cfg.color + '22';
  el('ad-title').textContent = cfg.label + ' — مراجعة';

  const fields = Object.entries(item).filter(([k,v]) =>
    !SKIP_FIELDS.has(k) && v !== null && v !== undefined && v !== ''
  );

  el('ad-body').innerHTML = `
    <div style="background:${cfg.color}11;border:1px solid ${cfg.color}33;border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:11px;color:${cfg.color};font-weight:700">${cfg.label}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">${item._desc}</div>
        ${approvalState.auditUsers?.[String(item.id)]?`<div style="font-size:11px;color:var(--blue);margin-top:3px">👤 أُدخل بواسطة: ${approvalState.auditUsers[String(item.id)]}</div>`:''}
        ${item._file?`<div style="font-size:11px;color:var(--accent);font-family:monospace;margin-top:2px">${item._file}</div>`:''}
      </div>
      <div style="font-size:22px;font-weight:900;color:${cfg.color};font-family:monospace">${fmt(item._amount)}</div>
    </div>
    <table class="data-table" style="font-size:12px">
      <tbody>
        ${fields.map(([k,v])=>`
        <tr>
          <td style="color:var(--text2);font-weight:600;padding:7px 14px;width:42%">${FIELD_LABELS[k]||k}</td>
          <td style="padding:7px 14px;font-family:${typeof v==='number'||String(v).match(/^[0-9.\-]+$/)?'monospace':'inherit'}">${v}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  openModal('approvalDetailModal');
}

async function approveFromDetail() {
  if (!approvalState.currentItem) return;
  const { type, id } = approvalState.currentItem;
  closeModal('approvalDetailModal');
  await approveItem(type, id);
}

async function cancelFromDetail() {
  if (!approvalState.currentItem) return;
  const { type, id, item } = approvalState.currentItem;
  closeModal('approvalDetailModal');
  showConfirm('إلغاء العملية', 'سيتم وضع العملية كـ "ملغية" مع إمكانية الإرجاع لاحقاً.', async () => {
    try {
      const cfg = APPROVAL_CONFIG[type];
      await apiPatch(cfg.table, { id:`eq.${id}` }, { post_status:'cancelled' });
      invalidateCache();
      toast('⊘ تم إلغاء العملية','ok');
      await loadApprovalQueue();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

async function rejectFromDetail() {
  if (!approvalState.currentItem) return;
  const { type, id } = approvalState.currentItem;
  closeModal('approvalDetailModal');
  await rejectItem(type, id);
}

async function editFromDetail() {
  if (!approvalState.currentItem) return;
  const { type, id, item } = approvalState.currentItem;
  closeModal('approvalDetailModal');
  // فتح الأمر مع إمكانية التعديل
  if (type === 'purchase' && item?.file_no) {
    openNewFileModal(item.file_no);
  } else if (type === 'sale' && item?.file_no) {
    openViewer(item.file_no);
    setTimeout(() => switchTab(4), 500); // تبويب المبيعات
  } else if (type === 'payment') {
    openEditPaymentModal(id);
  } else if (type === 'expense') {
    openEditExpenseModal(id);
  } else if (type === 'collection') {
    openEditCollectionModal(id);
  } else if (type === 'payout') {
    openEditPayoutModal(id);
  } else if (item?.file_no) {
    openViewer(item.file_no);
  } else {
    toast('لا يمكن فتح هذا الأمر','err');
  }
}


async function approveItem(type, id) {
  try {
    const cfg = APPROVAL_CONFIG[type];
    if (!cfg) { toast('نوع غير معروف','err'); return; }
    await apiPatch(cfg.table, { id:`eq.${id}` }, { post_status:'posted' });
    // لو شراء — نولّد قيد محاسبي
    if (type === 'purchase') {
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
      if (item && item.file_no) {
        await je_purchase({ sys:state.system, date:item.po_date||today(), amount:+item.total_purchase||0, fileNo:item.file_no, supplier:item.supplier||'' });
      }
    }
    if (type === 'sale') {
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
      if (item) await je_sale({ sys:state.system, date:item.sale_date||today(), amount:+item.sale_price||0, cost:0, fileNo:item.file_no, customer:item.customer||'', invNo:item.inv_no||'' });
    }
    if (type === 'collection') {
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
      if (item) await je_collection({ sys:state.system, date:item.paid_date||today(), amount:+item.amount||0, fileNo:item.file_no, customer:item.customer||'', invNo:item.inv_no||'', method:item.pay_method||'تحويل بنكي' });
    }
    if (type === 'payment') {
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
      if (item) await je_payment({ sys:state.system, date:item.pay_date||today(), amount:+item.amount||0, fileNo:item.file_no, supplierName:item.supplier||'', payerName:item.payer||'', method:item.pay_method||'تحويل بنكي' });
    }
    if (type === 'expense') {
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
      if (item) await je_expense({ sys:state.system, date:item.exp_date||today(), amount:+item.amount||0, fileNo:item.file_no, desc:item.description||'مصروف', expType:item.exp_type||'أخرى', method:item.pay_method||'تحويل بنكي' });
    }
    if (type === 'payout') {
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
      if (item) await je_payout({ sys:state.system, date:item.pay_date||today(), amount:+item.amount||0, fileNo:item.file_no, partner:item.partner||'', method:item.pay_method||'تحويل بنكي' });
    }
    invalidateCache();
    toast('✅ تمت الموافقة','ok');
    await loadApprovalQueue();
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

async function rejectItem(type, id) {
  const cfg = APPROVAL_CONFIG[type];
  if (!cfg) return;
  showConfirm('مسح نهائي', '⚠️ هل تريد مسح هذه العملية نهائياً؟ لا يمكن التراجع.', async () => {
    try {
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
      await apiDelete(cfg.table, { id:`eq.${id}` });
      if (type === 'sale' && item?.inv_no) {
        try { await apiDelete('collections', { system_type:`eq.${state.system}`, inv_no:`eq.${item.inv_no}`, paid_date:'is.null' }); } catch(e) {}
      }
      invalidateCache();
      toast('🗑 تم المسح النهائي','ok');
      await loadApprovalQueue();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

async function approveAll() {
  const items = approvalState.filtered;
  if (!items.length) return;
  showConfirm(`موافقة على الكل`, `هل تريد الموافقة على ${items.length} عملية دفعة واحدة؟`, async () => {
    try {
      await Promise.all(items.map(r => apiPatch(APPROVAL_CONFIG[r._type].table, { id:`eq.${r.id}` }, { post_status:'posted' })));
      toast(`✅ تمت الموافقة على ${items.length} عملية`,'ok');
      await loadApprovalQueue();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

// تحديث badge في الـ sidebar عند تحميل أي صفحة
async function updateApprovalBadge() {
  try {
    const sys = state.system;
    const [s,e,c,p,po] = await Promise.all([
      apiGet('sales',           { select:'id', system_type:`eq.${sys}`, post_status:`eq.draft` }),
      apiGet('expenses',        { select:'id', system_type:`eq.${sys}`, post_status:`eq.draft` }),
      apiGet('collections',     { select:'id', system_type:`eq.${sys}`, post_status:`eq.draft` }),
      apiGet('payments',        { select:'id', system_type:`eq.${sys}`, post_status:`eq.draft` }),
      apiGet('partner_payouts', { select:'id', system_type:`eq.${sys}`, post_status:`eq.draft` }),
    ]);
    const total = (s?.length||0)+(e?.length||0)+(c?.length||0)+(p?.length||0)+(po?.length||0);
    const badge = el('approval-badge');
    if (badge) { badge.textContent = total||''; badge.style.display = total?'':'none'; }
  } catch(e) {}
}

// ════════════════════════════════════════
// جاري الشريك — Partner Account Ledger
// ════════════════════════════════════════
const partnerAccountState = { partner: null, entries: [] };

async function openPartnerAccountLedger(partnerName) {
  partnerAccountState.partner = partnerName;
  el('pa-partner-name').textContent = partnerName;
  el('pa-ledger-table').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  openModal('partnerAccountModal');
  await loadPartnerAccountLedger();
}

async function loadPartnerAccountLedger() {
  const partner = partnerAccountState.partner;
  const sys     = state.system;
  if (!partner) return;

  try {
    // جيب كل الصفقات اللي فيها الشريك
    const [allDeals, allPayouts, accountEntries] = await Promise.all([
      apiGet('partners_master',   { select:'file_no,share_percent', system_type:`eq.${sys}`, partner:`eq.${partner}` }),
      apiGet('partner_payouts',   { select:'*', system_type:`eq.${sys}`, partner:`eq.${partner}`, order:'pay_date.desc' }),
      apiGet('partner_accounts',  { select:'*', system_type:`eq.${sys}`, partner:`eq.${partner}`, order:'entry_date.desc' }),
    ]);

    // احسب الأرباح من كل الصفقات
    let totalProfits = 0;
    const dealEntries = [];
    for (const pm of (allDeals||[])) {
      try {
        const [po, sales, expenses] = await Promise.all([
          apiGet('purchase_orders', { select:'total_purchase', system_type:`eq.${sys}`, file_no:`eq.${pm.file_no}` }),
          apiGet('sales',           { select:'sale_price',     system_type:`eq.${sys}`, file_no:`eq.${pm.file_no}` }),
          apiGet('expenses',        { select:'amount',         system_type:`eq.${sys}`, file_no:`eq.${pm.file_no}` }),
        ]);
        const share      = (+pm.share_percent||0)/100;
        const totalPurch = +po?.[0]?.total_purchase||0;
        const totalSale  = (sales||[]).reduce((s,r)=>s+(+r.sale_price||0),0);
        const totalExp   = (expenses||[]).reduce((s,r)=>s+(+r.amount||0),0);
        const profit     = (totalSale - totalPurch - totalExp) * share;
        if (Math.abs(profit) > 0.001) {
          totalProfits += profit;
          dealEntries.push({
            type:'profit_credit', file_no:pm.file_no,
            amount:profit, entry_date:'—',
            description:`ربح صفقة ${pm.file_no} (${pm.share_percent}%)`,
            _sign: +1
          });
        }
      } catch(e) {}
    }

    // صرف على صفقات
    const dealPayouts = (allPayouts||[]).map(p => ({
      ...p,
      type:'deal_payout',
      description:`صرف ${p.payout_type||''} — ${p.file_no||'—'}`,
      _sign: -1
    }));

    // سحوبات عامة وسلف من partner_accounts
    const generalEntries = (accountEntries||[]).map(e => ({
      ...e,
      _sign: e.entry_type === 'general_withdraw' || e.entry_type === 'advance' ? -1 : +1
    }));

    // دمج كل الحركات
    const allEntries = [
      ...dealEntries,
      ...dealPayouts,
      ...generalEntries,
    ].sort((a,b) => {
      const da = a.entry_date||a.pay_date||'0';
      const db = b.entry_date||b.pay_date||'0';
      return db.localeCompare(da);
    });

    partnerAccountState.entries = allEntries;

    // KPIs
    const totalDebits  = allEntries.filter(e=>e._sign>0).reduce((s,e)=>s+(+e.amount||0),0);
    const totalCredits = allEntries.filter(e=>e._sign<0).reduce((s,e)=>s+(+e.amount||0),0);
    const balance      = totalDebits - totalCredits;

    el('pa-summary-kpis').innerHTML = `
      <div class="j-kpi" style="border-right:3px solid var(--green)">
        <div class="j-kpi-label">إجمالي الأرباح</div>
        <div class="j-kpi-val text-green">${fmt(totalProfits)}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--red)">
        <div class="j-kpi-label">إجمالي السحوبات</div>
        <div class="j-kpi-val text-red">${fmt(totalCredits)}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--purple);background:var(--purple-dim)">
        <div class="j-kpi-label">الرصيد المتاح</div>
        <div class="j-kpi-val" style="color:${balance>=0?'var(--green)':'var(--red)'};">${fmt(balance)}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--blue)">
        <div class="j-kpi-label">عدد الصفقات</div>
        <div class="j-kpi-val text-blue">${(allDeals||[]).length}</div>
      </div>`;

    // Store balance for withdraw modal
    partnerAccountState.balance = balance;

    renderPartnerAccountLedger();
  } catch(e) {
    el('pa-ledger-table').innerHTML = `<div class="alert alert-err">خطأ: ${e.message}</div>`;
  }
}

function renderPartnerAccountLedger() {
  const filterType = el('pa-filter-type')?.value || '';
  let entries = partnerAccountState.entries;
  if (filterType) entries = entries.filter(e => (e.type||e.entry_type) === filterType);

  const typeLabels = {
    profit_credit:'أرباح مرصودة', capital_credit:'رأس مال مرصود',
    general_withdraw:'سحب عام', advance:'سلفة', deal_payout:'صرف صفقة'
  };
  const typeColors = {
    profit_credit:'var(--green)', capital_credit:'var(--blue)',
    general_withdraw:'var(--red)', advance:'var(--amber)', deal_payout:'var(--purple)'
  };

  if (!entries.length) {
    el('pa-ledger-table').innerHTML = emptyHTML('📒','لا توجد حركات');
    return;
  }

  let runningBalance = 0;
  const rows = [...entries].reverse().map(e => {
    const type   = e.type || e.entry_type;
    const sign   = e._sign || (type==='general_withdraw'||type==='advance'||type==='deal_payout' ? -1 : +1);
    const amount = +e.amount || 0;
    runningBalance += sign * amount;
    const balance = runningBalance;
    return { e, type, sign, amount, balance };
  }).reverse().map(({e, type, sign, amount, balance}) => {
    const color = typeColors[type] || 'var(--text2)';
    const date  = e.entry_date||e.pay_date||e.created_at?.split('T')[0]||'—';
    return `<tr>
      <td class="mono" style="font-size:11px;color:var(--text2)">${fmtDate(date)}</td>
      <td>
        <span style="background:${color}22;color:${color};padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">
          ${typeLabels[type]||type}
        </span>
      </td>
      <td style="font-size:12px">${e.description||'—'}</td>
      <td class="mono text-amber" style="font-size:11px">${e.file_no||'—'}</td>
      <td class="mono" style="color:${sign>0?'var(--green)':'var(--red)'};font-weight:700">
        ${sign>0?'+':'−'}${fmt(amount)}
      </td>
      <td class="mono" style="font-weight:700;color:${balance>=0?'var(--blue)':'var(--red)'}">
        ${fmt(balance)}
      </td>
      <td style="font-size:11px;color:var(--text2)">${e.document||e.notes||'—'}</td>
    </tr>`;
  }).join('');

  el('pa-ledger-table').innerHTML = `
    <table class="data-table" style="font-size:12px">
      <thead><tr>
        <th>التاريخ</th><th>النوع</th><th>البيان</th>
        <th>الملف</th><th>المبلغ</th><th>الرصيد</th><th>ملاحظات</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function openGeneralWithdrawModal() {
  el('gw-amount').value  = '';
  el('gw-date').value    = today();
  el('gw-doc').value     = '';
  el('gw-notes').value   = '';
  el('gwError').style.display = 'none';
  const balance = partnerAccountState.balance || 0;
  if(el('gw-available')) el('gw-available').textContent = fmt(balance);
  el('gw-available').style.color = balance > 0 ? 'var(--purple)' : 'var(--red)';
  openModal('generalWithdrawModal');
}

async function submitGeneralWithdraw() {
  const partner = partnerAccountState.partner;
  const amount  = parseFloat(el('gw-amount').value);
  const date    = el('gw-date').value;
  const method  = el('gw-method').value;
  const doc     = el('gw-doc').value.trim();
  const notes   = el('gw-notes').value.trim();

  if (!amount || !date) { showFieldErr('gwError','يرجى ملء المبلغ والتاريخ'); return; }

  const balance = partnerAccountState.balance || 0;
  if (amount > balance + 0.001) {
    const go = confirm(`⚠️ المبلغ (${fmt(amount)}) أكبر من الرصيد المتاح (${fmt(balance)}).\nهل تريد المتابعة؟`);
    if (!go) return;
  }

  try {
    await apiPost('partner_accounts', {
      system_type: state.system,
      partner, entry_type:'general_withdraw',
      amount, entry_date:date,
      description:`سحب عام — ${partner}`,
      document:doc||null, notes:notes||null
    });
    await logAudit('INSERT','partner_accounts', null, null, {partner, amount, date});
    closeModal('generalWithdrawModal');
    toast(`✅ تم تسجيل السحب العام — ${fmt(amount)}`,'ok');
    await loadPartnerAccountLedger();
  } catch(e) { showFieldErr('gwError','خطأ: '+e.message); }
}

// تحديث onPayoutTypeChange لإظهار رصيد الشريك عند السحب العام
// (يتم patch الدالة الموجودة بإضافة منطق السحب العام)
const _patchPayoutType = () => {
  const orig = window.onPayoutTypeChange;
  window.onPayoutTypeChange = function() {
    orig && orig();
    const type    = el('pout-type')?.value;
    const accCard = el('pout-account-card');
    if (!accCard) return;
    if (type === 'سحب عام') {
      accCard.style.display = 'block';
      loadPartnerAccountBalance();
    } else {
      accCard.style.display = 'none';
    }
  };
};
// تطبيق الـ patch بعد تحميل الصفحة
document.addEventListener('DOMContentLoaded', _patchPayoutType);

async function loadPartnerAccountBalance() {
  const partner = el('pout-partner')?.value;
  if (!partner) return;
  try {
    const [allDeals, allPayouts, accountEntries] = await Promise.all([
      apiGet('partners_master',  { select:'file_no,share_percent', system_type:`eq.${state.system}`, partner:`eq.${partner}` }),
      apiGet('partner_payouts',  { select:'amount', system_type:`eq.${state.system}`, partner:`eq.${partner}` }),
      apiGet('partner_accounts', { select:'amount,entry_type', system_type:`eq.${state.system}`, partner:`eq.${partner}` }),
    ]);

    let totalProfits = 0;
    for (const pm of (allDeals||[])) {
      try {
        const [po, sales, exp] = await Promise.all([
          apiGet('purchase_orders',{select:'total_purchase',system_type:`eq.${state.system}`,file_no:`eq.${pm.file_no}`}),
          apiGet('sales',{select:'sale_price',system_type:`eq.${state.system}`,file_no:`eq.${pm.file_no}`}),
          apiGet('expenses',{select:'amount',system_type:`eq.${state.system}`,file_no:`eq.${pm.file_no}`}),
        ]);
        const share = (+pm.share_percent||0)/100;
        const profit = ((sales||[]).reduce((s,r)=>s+(+r.sale_price||0),0) - (+po?.[0]?.total_purchase||0) - (exp||[]).reduce((s,e)=>s+(+e.amount||0),0)) * share;
        totalProfits += profit;
      } catch(e) {}
    }

    const totalPayouts = (allPayouts||[]).reduce((s,p)=>s+(+p.amount||0),0);
    const generalWithdrawn = (accountEntries||[]).filter(e=>e.entry_type==='general_withdraw'||e.entry_type==='advance').reduce((s,e)=>s+(+e.amount||0),0);
    const balance = totalProfits - totalPayouts - generalWithdrawn;

    if(el('pacc-profits'))   el('pacc-profits').textContent   = fmt(totalProfits);
    if(el('pacc-withdrawn')) el('pacc-withdrawn').textContent = fmt(totalPayouts + generalWithdrawn);
    if(el('pacc-balance'))   { el('pacc-balance').textContent = fmt(balance); el('pacc-balance').style.color = balance>=0?'var(--purple)':'var(--red)'; }
  } catch(e) {}
}

// PWA Install prompt
let _pwaInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _pwaInstallPrompt = e;
  // Show all install buttons
  document.querySelectorAll('.pwa-install-btn').forEach(b => b.style.display = 'flex');
});

function installPWA() {
  if (_pwaInstallPrompt) {
    _pwaInstallPrompt.prompt();
    _pwaInstallPrompt.userChoice.then(() => {
      _pwaInstallPrompt = null;
      document.querySelectorAll('.pwa-install-btn').forEach(b => b.style.display = 'none');
    });
  }
}

// ════════════════════════════════════════════════════════
// POSTING ENGINE v2 — Double Entry Accounting
// كل العمليات بتسجل قيودًا مزدوجة Dr/Cr في journal_entries
// ════════════════════════════════════════════════════════

const EXPENSE_ACCOUNT_MAP = {
  'شحن':'5200','جمارك':'6600','تأمين':'6600',
  'إدارية':'6500','صيانة':'6700','أخرى':'6500',
  'إيجار':'6100','رواتب':'6200','نقل':'5200','تسويق':'6500',
};

async function _jeNo(sys) {
  try {
    const r = await apiGet('journal_entries',{select:'id',system_type:`eq.${sys}`,order:'id.desc',limit:1});
    return `JE-${new Date().getFullYear()}-${String((r?.[0]?.id||0)+1).padStart(5,'0')}`;
  } catch(e) { return `JE-${Date.now()}`; }
}

async function postDoubleEntry({sys, date, fileNo, refTable, refId, desc, lines}) {
  const dr = lines.reduce((s,l)=>s+(+l.dr||0),0);
  const cr = lines.reduce((s,l)=>s+(+l.cr||0),0);
  if (Math.abs(dr-cr)>0.01) { console.warn(`قيد غير متوازن Dr=${dr} Cr=${cr} — ${desc}`); return; }
  try {
    const no = await _jeNo(sys);
    for (const l of lines) {
      await apiPost('journal_entries',{
        system_type: sys,
        entry_no:    no,
        entry_date:  date || today(),
        account_code: l.acc,
        account_name: l.name,
        dr_amount:   +l.dr||0,
        cr_amount:   +l.cr||0,
        description: l.desc || desc,
        ref_table:   refTable||null,
        ref_id:      refId||null,
        file_no:     fileNo||null,
        post_status: 'posted',
        posted_at:   new Date().toISOString(),
      });
    }
  } catch(e) { console.warn('postDoubleEntry:', e.message); }
}

// شراء: مخزون Dr / مورد Cr
async function je_purchase({sys,date,amount,fileNo,supplier}) {
  if(!amount||amount<=0) return;
  await postDoubleEntry({sys,date,fileNo,refTable:'purchase_orders',desc:`شراء — ملف ${fileNo} — ${supplier}`,lines:[
    {acc:'1300',name:getAccountName('1300'),   dr:amount, cr:0     },
    {acc:'2100',name:`مورد: ${supplier}`,       dr:0,      cr:amount},
  ]});
}

// بيع: عميل Dr / إيراد Cr + COGS Dr / مخزون Cr
async function je_sale({sys,date,amount,cost,fileNo,customer,invNo}) {
  if(!amount||amount<=0) return;
  const lines = [
    {acc:'1200',name:`عميل: ${customer}`,     dr:amount, cr:0    , desc:`فاتورة ${invNo}`},
    {acc:'4100',name:getAccountName('4100'),   dr:0,      cr:amount, desc:`فاتورة ${invNo}`},
  ];
  if (cost>0) {
    lines.push({acc:'5100',name:'تكلفة المخزون المباع', dr:cost, cr:0   });
    lines.push({acc:'1300',name:'المخزون — سيارات',      dr:0,    cr:cost});
  }
  await postDoubleEntry({sys,date,fileNo,refTable:'sales',desc:`بيع فاتورة ${invNo} — ملف ${fileNo}`,lines});
}

// تحصيل: نقد Dr / عميل Cr
async function je_collection({sys,date,amount,fileNo,customer,invNo,method}) {
  if(!amount||amount<=0) return;
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'collections',desc:`تحصيل ${invNo} — ملف ${fileNo}`,lines:[
    {acc:cashAcc, name:cashNm,                  dr:amount, cr:0     },
    {acc:'1200',  name:`عميل: ${customer}`,     dr:0,      cr:amount},
  ]});
}

// دفعة مورد: مورد Dr / نقد Cr
async function je_payment({sys,date,amount,fileNo,supplier,supplierName,method}) {
  if(!amount||amount<=0) return;
  const sup = supplier || supplierName || 'مورد';
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'payments',desc:`دفعة للمورد ${sup} — ملف ${fileNo}`,lines:[
    {acc:'2100',  name:`مورد: ${sup}`,          dr:amount, cr:0     },
    {acc:cashAcc, name:cashNm,                  dr:0,      cr:amount},
  ]});
}

// مصروف: مصروف Dr / نقد Cr
async function je_expense({sys,date,amount,fileNo,desc,expType,method}) {
  if(!amount||amount<=0) return;
  const eAcc  = EXPENSE_ACCOUNT_MAP[expType]||'6500';
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'expenses',desc:`${desc} — ملف ${fileNo||'عام'}`,lines:[
    {acc:eAcc,    name:expType||'مصروف', dr:amount, cr:0     },
    {acc:cashAcc, name:cashNm,           dr:0,      cr:amount},
  ]});
}

// صرف شريك: شريك Dr / نقد Cr
async function je_payout({sys,date,amount,fileNo,partner,method}) {
  if(!amount||amount<=0) return;
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'partner_payouts',desc:`صرف شريك ${partner} — ملف ${fileNo}`,lines:[
    {acc:'2400',  name:`شريك: ${partner}`, dr:amount, cr:0     },
    {acc:cashAcc, name:cashNm,             dr:0,      cr:amount},
  ]});
}

// ═══════════════════════════════════════════════════════
// ربط تلقائي — يُغلّف الدوال الموجودة بدون تعديلها
// يشتغل بعد ما الصفحة تكمل التحميل
// ═══════════════════════════════════════════════════════

