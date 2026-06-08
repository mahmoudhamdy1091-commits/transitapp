// ╔══════════════════════════════════════════════════════════╗
// ║  settings.js — Settings · Roles · Users · Activity Log  ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝

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
  if (!el('actFilter-from').value) setActivityPeriod('month');
  else await loadActivityLog();
}

// ── فلتر الفترة السريعة — نفس آلية setTxPeriod المستخدمة في كل شاشات النظام ──
function setActivityPeriod(period) {
  document.querySelectorAll('[id^="actperiod-"]').forEach(b => b.classList.remove('active'));
  el('actperiod-' + period)?.classList.add('active');
  const customWrap = el('actCustomDateWrap');
  const pad = n => String(n).padStart(2,'0');
  const toDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const now = new Date();
  const yr  = now.getFullYear();

  if (period === 'custom') { customWrap.style.display = 'flex'; return; }
  customWrap.style.display = 'none';

  let from, to;
  if (period === 'today') {
    from = to = toDate(now);
  } else if (period === 'week') {
    const sun = new Date(now); sun.setDate(now.getDate() - now.getDay());
    const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
    from = toDate(sun); to = toDate(sat);
  } else if (period === 'month') {
    from = `${yr}-${pad(now.getMonth()+1)}-01`;
    to   = toDate(new Date(yr, now.getMonth()+1, 0));
  } else if (period === '3months') {
    const f = new Date(now); f.setMonth(f.getMonth() - 3);
    from = toDate(f); to = toDate(now);
  } else if (period === 'year') {
    from = `${yr}-01-01`; to = `${yr}-12-31`;
  } else if (period === 'lastyear') {
    from = `${yr-1}-01-01`; to = `${yr-1}-12-31`;
  }

  el('actFilter-from').value = from;
  el('actFilter-to').value   = to;
  loadActivityLog();
}

async function loadActivityLog() {
  el('activityTableWrap').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  try {
    const from = el('actFilter-from')?.value;
    const to   = el('actFilter-to')?.value;

    // ✅ فلتر الفترة على مستوى السيرفر — نفس نطاق ما يظهر في باقي شاشات النظام
    // (PostgREST يحتاج and=(...) لتطبيق شرطي gte/lte معاً على نفس العمود created_at)
    let dateFilter = '';
    if (from && to) dateFilter = `&and=(created_at.gte.${encodeURIComponent(from)},created_at.lte.${encodeURIComponent(to+'T23:59:59')})`;
    else if (from)  dateFilter = `&created_at=gte.${encodeURIComponent(from)}`;
    else if (to)    dateFilter = `&created_at=lte.${encodeURIComponent(to+'T23:59:59')}`;

    const h = headers({ 'Range': '0-49999', 'Range-Unit': 'items' });
    // ✅ نجلب أيضاً السجلات القديمة التي بلا system_type (بيانات قديمة قبل إضافة الحقل) — نفس نمط apiGetAll
    const base = `${SB_URL}/rest/v1/audit_log?select=*&order=id.desc${dateFilter}`;
    const [r1, r2] = await Promise.all([
      fetch(`${base}&system_type=eq.${encodeURIComponent(state.system)}`, { headers: h, cache: 'no-store' }),
      fetch(`${base}&system_type=is.null`,                                 { headers: h, cache: 'no-store' }),
    ]);
    if (!r1.ok && !r2.ok) throw new Error(r1.statusText || r2.statusText);
    const [d1, d2] = await Promise.all([r1.ok ? r1.json() : [], r2.ok ? r2.json() : []]);
    const seen = new Set(); const merged = [];
    [...(d1||[]), ...(d2||[])].forEach(r => {
      const key = r.id ?? JSON.stringify(r);
      if (!seen.has(key)) { seen.add(key); merged.push(r); }
    });
    merged.sort((a,b) => (b.id||0) - (a.id||0));
    _activityData = merged;

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
  ['actFilter-action','actFilter-user','actFilter-table']
    .forEach(id => { const e = el(id); if(e) e.value = ''; });
  setActivityPeriod('month');
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
      <td style="padding:9px 12px;font-size:13px;color:var(--text2);white-space:nowrap">${dt}</td>
      <td style="padding:9px 12px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:26px;height:26px;border-radius:50%;background:var(--accent-dim);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:var(--accent);flex-shrink:0">${initials}</div>
          <span style="font-size:12px">${email}</span>
        </div>
      </td>
      <td style="padding:9px 12px">
        <span style="font-size:13px;font-weight:700;padding:2px 8px;border-radius:6px;background:${actionBg[r.action]||'var(--card2)'};color:${actionColors[r.action]||'var(--text2)'}">
          ${actionLabels[r.action]||r.action}
        </span>
      </td>
      <td style="padding:9px 12px;font-size:12px;color:var(--text2)">${tableLabels[r.table_name]||r.table_name||'—'}</td>
      <td style="padding:9px 12px;font-size:12px;font-weight:700;color:var(--accent);font-family:monospace">${r.file_no||'—'}</td>
      <td style="padding:9px 12px;font-size:13px;color:var(--text2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.notes||'—'}</td>
      <td style="padding:9px 12px">${hasDetail ? '<span style="font-size:12px;color:var(--blue)">تفاصيل ←</span>' : ''}</td>
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
        <div style="font-size:12px;color:var(--text2);margin-bottom:3px">المستخدم</div>
        <div style="font-weight:600">${r.user_email||'—'}</div>
      </div>
      <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
        <div style="font-size:12px;color:var(--text2);margin-bottom:3px">الوقت</div>
        <div style="font-weight:600;font-size:13px">${r.created_at ? new Date(r.created_at).toLocaleString('en-US') : '—'}</div>
      </div>
      <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
        <div style="font-size:12px;color:var(--text2);margin-bottom:3px">العملية</div>
        <div style="font-weight:700;color:${actionColors[r.action]||'var(--text)'}">${actionLabels[r.action]||r.action}</div>
      </div>
      <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
        <div style="font-size:12px;color:var(--text2);margin-bottom:3px">الملف</div>
        <div style="font-weight:700;color:var(--accent);font-family:monospace">${r.file_no||'—'}</div>
      </div>
    </div>`;

  if (r.notes) {
    detailHTML += `
    <div style="margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:6px">ملاحظات</div>
      <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px;font-size:12px">${r.notes}</div>
    </div>`;
  }

  // Old/New values
  if (r.old_value) {
    try {
      const old = typeof r.old_value === 'string' ? JSON.parse(r.old_value) : r.old_value;
      detailHTML += `
      <div style="margin-bottom:12px">
        <div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:6px">القيمة قبل التعديل</div>
        <div style="background:var(--red-dim);border:1px solid var(--red);border-radius:var(--radius-sm);padding:10px;font-family:monospace;font-size:13px;overflow-x:auto;white-space:pre-wrap;word-break:break-all">
          ${JSON.stringify(old, null, 2)}
        </div>
      </div>`;
    } catch(e) { detailHTML += `<div style="margin-bottom:12px;font-size:13px;color:var(--text2)">القيمة القديمة: ${r.old_value}</div>`; }
  }

  if (r.new_value) {
    try {
      const nw = typeof r.new_value === 'string' ? JSON.parse(r.new_value) : r.new_value;
      detailHTML += `
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--green);margin-bottom:6px">البيانات المضافة / بعد التعديل</div>
        <div style="background:var(--green-dim);border:1px solid var(--green);border-radius:var(--radius-sm);padding:10px;font-family:monospace;font-size:13px;overflow-x:auto;white-space:pre-wrap;word-break:break-all">
          ${JSON.stringify(nw, null, 2)}
        </div>
      </div>`;
    } catch(e) { detailHTML += `<div style="font-size:13px;color:var(--text2)">البيانات: ${r.new_value}</div>`; }
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
            ${isSelf ? '<span style="font-size:12px;background:var(--green-dim);color:var(--green);padding:1px 7px;border-radius:10px;font-weight:700">أنت</span>' : ''}
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
  } catch(e) { console.warn('loadUserRole:', e.message); }
}


// ════════════════════════════════════════
// DEAL STATEMENT (TAB 7)
// ════════════════════════════════════════
async function loadDealStatement(fn, sys) {
  const wrap = el('dealStatementWrap');
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  try {
    const [po, vehicles, payments, expenses, sales, collections, partners, payouts] = await Promise.all([
      apiGetAll('purchase_orders', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('vehicles',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('payments',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'pay_date.asc' }),
      apiGetAll('expenses',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'exp_date.asc' }),
      apiGetAll('sales',           { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'sale_date.asc' }),
      apiGetAll('collections',     { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'paid_date.asc' }),
      apiGetAll('partners_master', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('partner_payouts', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'pay_date.asc' }),
    ]);

    const deal = po?.[0] || {};
    const totalPurchase = +deal.total_purchase || 0;

    // ✅ فلترة: المرحّلة فقط (posted أو null) — استثناء الملغية والمعلقة
    // isActive: معرّف في core.js
    // ✅ pending_edit = مرحّلة في طور التعديل
    const isSettled = isEffective;

    const totalPaid    = (payments||[]).filter(isActive).reduce((s,p)=>s+(+p.amount||0),0);
    const totalExp     = (expenses||[]).filter(isSettled).reduce((s,e)=>s+(+e.amount||0),0);
    const totalSales   = (sales||[]).filter(isSettled).reduce((s,s2)=>s+(+s2.sale_price||0),0);
    const totalColl    = (collections||[]).filter(r=>r.paid_date && isSettled(r)).reduce((s,c)=>s+(+c.amount||0),0);
    const totalPayouts = (payouts||[]).filter(isActive).reduce((s,p)=>s+(+p.amount||0),0);
    const profit       = totalSales - totalPurchase - totalExp;

    // عدد السجلات المعلقة/الملغية للتنبيه
    const draftSales  = (sales||[]).filter(r=>r.post_status==='draft').length;
    const draftExp    = (expenses||[]).filter(r=>r.post_status==='draft').length;
    const voidedCount = (sales||[]).filter(r=>r.post_status==='voided').length
                      + (expenses||[]).filter(r=>r.post_status==='voided').length;

    const entries = [
      { date:deal.po_date||deal.created_at, type:'شراء', icon:'📋', color:'var(--blue)',
        party:deal.supplier||'—', debit:0, credit:totalPurchase, _pl:true,
        desc:`سند شراء ${fn}${deal.po_no?' — PO: '+deal.po_no:''}`,
        extra:`${(vehicles||[]).length} سيارة` },
      // ✅ نُدرج فقط السجلات غير الملغية — الملغية تظهر بشفافية كمرجع
      ...(payments||[]).filter(isActive).map(p=>({ date:p.pay_date, type:'دفعة للمورد', icon:'💳', color:'var(--cyan)',
        party:p.payer||'—', debit:+p.amount, credit:0, _pl:false, _voided:false,
        desc:`دفعة من ${p.payer||'—'}`, extra:`${p.pay_method||''}${p.document?' · '+p.document:''}` })),
      ...(expenses||[]).filter(isSettled).map(e=>({ date:e.exp_date||e.expense_date, type:'مصروف', icon:'💸', color:'var(--red)',
        party:e.vendor||'—', debit:0, credit:+e.amount, _pl:true, _voided:false,
        desc:e.category||e.description||'مصروف', extra:`${e.pay_method||''}` })),
      ...(expenses||[]).filter(r=>r.post_status==='draft').map(e=>({ date:e.exp_date||e.expense_date, type:'مصروف (معلق)', icon:'⏳', color:'var(--accent)',
        party:e.vendor||'—', debit:0, credit:+e.amount, _pl:false, _draft:true,
        desc:e.category||e.description||'مصروف', extra:'في انتظار الموافقة' })),
      ...(sales||[]).filter(isSettled).map(s=>({ date:s.sale_date, type:'بيع', icon:'🤝', color:'var(--green)',
        party:s.customer||'—', debit:+s.sale_price, credit:0, _pl:true, _voided:false,
        desc:`بيع ${s.model||s.vin||'سيارة'} — ${s.customer||'—'}`,
        extra:`${s.vin?'شاصي: '+s.vin:''}${s.invoice_no?' · '+s.invoice_no:''}` })),
      ...(sales||[]).filter(r=>r.post_status==='draft').map(s=>({ date:s.sale_date, type:'بيع (معلق)', icon:'⏳', color:'var(--accent)',
        party:s.customer||'—', debit:+s.sale_price, credit:0, _pl:false, _draft:true,
        desc:`بيع ${s.model||s.vin||'سيارة'} — ${s.customer||'—'}`, extra:'في انتظار الموافقة' })),
      // التحصيلات: معلوماتية فقط لا تدخل في الربح/الخسارة
      ...(collections||[]).filter(c=>c.paid_date && isSettled(c)).map(c=>({ date:c.paid_date, type:'تحصيل', icon:'💰', color:'var(--green)',
        party:c.customer||'—', debit:+c.amount, credit:0, _pl:false,
        desc:`تحصيل من ${c.customer||'—'}`, extra:`${c.pay_method||''}` })),
      ...(payouts||[]).filter(isActive).map(p=>({ date:p.pay_date, type:'صرف شريك', icon:'👥', color:'var(--purple)',
        party:p.partner||'—', debit:0, credit:+p.amount, _pl:false,
        desc:`${p.payout_type||'صرف'} — ${p.partner||'—'}`, extra:`${p.pay_method||''}${p.notes?' · '+p.notes:''}` })),
    ].sort((a,b)=>(a.date||'').localeCompare(b.date||''));

    window._dealStatementData = { fn, deal, entries, totalPurchase, totalPaid, totalExp, totalSales, totalColl, totalPayouts, profit, partners, payouts, vehicles };

    // تنبيه للمستخدم لو في عمليات معلقة
    const draftAlert = (draftSales + draftExp) > 0
      ? `<div style="background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:8px 14px;margin-bottom:10px;font-size:13px;color:var(--accent);font-weight:700">
          ⚠️ يوجد ${draftSales+draftExp} عملية معلقة في انتظار الموافقة — الأرقام أعلاه للمرحّلة فقط
        </div>`
      : '';

    const kpis = draftAlert + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:16px">
      ${[['تكلفة الشراء',fmt(totalPurchase),'var(--blue)'],['المدفوع للمورد',fmt(totalPaid),'var(--cyan)'],
         ['المصاريف',fmt(totalExp),'var(--red)'],['المبيعات',fmt(totalSales),'var(--green)'],
         ['المحصّل فعلاً',fmt(totalColl),'var(--green)'],['صافي الربح',fmt(Math.abs(profit)),profit>=0?'var(--green)':'var(--red)'],
      ].map(([l,v,c])=>`<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px">
        <div style="font-size:12px;color:var(--text2);margin-bottom:4px">${l}</div>
        <div style="font-size:16px;font-weight:700;color:${c}">${v}</div></div>`).join('')}
    </div>`;

    let running = 0;
    const rows = entries.map(e => {
      // الرصيد الجاري يعكس ربح/خسارة الصفقة فقط (بيع - شراء - مصاريف)
      if (e._pl) {
        if (e.debit>0) running += e.debit;
        if (e.credit>0) running -= e.credit;
      }
      const infoTag = !e._pl
        ? `<span style="font-size:13px;background:var(--card2);color:var(--text2);padding:1px 5px;border-radius:6px;margin-right:4px">معلوماتي</span>`
        : '';
      return `<tr onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background=''">
        <td style="padding:10px 12px;font-size:13px;color:var(--text3);white-space:nowrap">${e.date||'—'}</td>
        <td style="padding:10px 12px"><span style="font-size:13px;font-weight:700;padding:2px 8px;border-radius:8px;background:${e.color}22;color:${e.color}">${e.icon} ${e.type}</span>${infoTag}</td>
        <td style="padding:10px 12px"><div style="font-size:12px;font-weight:600">${e.desc}</div>${e.extra?`<div style="font-size:12px;color:var(--text3)">${e.extra}</div>`:''}</td>
        <td style="padding:10px 12px;font-size:12px;color:var(--text2)">${e.party}</td>
        <td style="padding:10px 12px;text-align:left;font-family:var(--mono);font-size:12px;color:var(--green)">${e.debit>0?fmt(e.debit):'—'}</td>
        <td style="padding:10px 12px;text-align:left;font-family:var(--mono);font-size:12px;color:var(--red)">${e.credit>0?fmt(e.credit):'—'}</td>
        <td style="padding:10px 12px;text-align:left;font-family:var(--mono);font-size:13px;font-weight:700;color:${e._pl?(running>=0?'var(--green)':'var(--red)'):'var(--text2)'}">
          ${e._pl?fmt(Math.abs(running)):'—'}
        </td>
      </tr>`;
    }).join('');

    const partnersHtml = (partners||[]).length ? `
      <div style="margin-top:16px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px">
        <div style="font-weight:700;margin-bottom:12px;font-size:13px">👥 توزيع الأرباح على الشركاء</div>
        ${(partners||[]).map(p=>{
          const pctShare = (+p.share_percent||0) / 100;
          // ما دفعه الشريك للمورد (رأس المال)
          const _singlePartner = (partners||[]).length <= 1;
          const capitalPaid  = (payments||[])
            .filter(py => isActive(py))
            .filter(py => _singlePartner || py.payer === p.partner)
            .reduce((s,py)=>s+(+py.amount||0),0);
          // حصته في الربح
          const profitShare  = profit * pctShare;
          // ما استرده (كل payouts بغض النظر عن النوع)
          const withdrawn    = (payouts||[]).filter(py=>py.partner===p.partner && isActive(py)).reduce((s,py)=>s+(+py.amount||0),0);
          // ✅ المستحق الكامل = رأس المال المدفوع + حصة الربح - ما استرده
          const totalDue     = capitalPaid + profitShare - withdrawn;
          const dueColor     = totalDue > 0.01 ? 'var(--green)' : totalDue < -0.01 ? 'var(--red)' : 'var(--text2)';
          return `<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="flex:1;font-weight:700;min-width:100px">${p.partner}</div>
            <div style="font-size:12px;color:var(--text2)">حصة: <b>${p.share_percent}%</b></div>
            <div style="font-size:12px;color:var(--blue)">رأس المال المدفوع: <b>${fmt(capitalPaid)}</b></div>
            <div style="font-size:12px;color:var(--green)">ربح مستحق: <b>${fmt(profitShare)}</b></div>
            <div style="font-size:12px;color:var(--accent)">تم الصرف: <b>${fmt(withdrawn)}</b></div>
            <div style="font-size:12px;font-weight:700;color:${dueColor}">المستحق: <b>${fmt(totalDue)}</b></div>
          </div>`;
        }).join('')}
      </div>` : '';

    wrap.innerHTML = kpis + `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <div style="padding:8px 14px;background:var(--card2);border-bottom:1px solid var(--border);font-size:13px;color:var(--text2)">
          📊 الرصيد الجاري = صافي ربح/خسارة الصفقة (مبيعات − تكلفة شراء − مصاريف) · الصفوف المعلّمة "معلوماتي" لا تدخل في الحساب
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--card2);border-bottom:1px solid var(--border)">
            ${['التاريخ','النوع','البيان','الطرف','مدين','دائن','الرصيد (ر/خ)'].map((h,i)=>`<th style="padding:10px 12px;font-size:13px;color:var(--text3);font-weight:700;text-align:${i>=4?'left':'right'}">${h}</th>`).join('')}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` + partnersHtml;

  } catch(e) { el('dealStatementWrap').innerHTML = errHTML('خطأ: '+e.message); }
}

// printDealStatement → js/print.js


function exportDealStatementExcel() {
  const d = window._dealStatementData;
  if (!d) { toast('افتح كشف الصفقة أولاً','err'); return; }
  const { fn, entries } = d;
  let running = 0;
  const rows = [['التاريخ','النوع','البيان','الطرف','مدين','دائن','الرصيد (ر/خ)','ملاحظة']];
  entries.forEach(e => {
    // ✅ الرصيد يُحدَّث فقط للصفوف التي تدخل في P&L (مطابق للعرض في الشاشة)
    if (e._pl) {
      if(e.debit>0) running+=e.debit;
      if(e.credit>0) running-=e.credit;
    }
    rows.push([e.date||'', e.type, e.desc+(e.extra?' — '+e.extra:''), e.party,
      e.debit>0?e.debit:'', e.credit>0?e.credit:'',
      e._pl ? Math.abs(running) : '',
      e._draft ? 'معلق - في انتظار الموافقة' : '']);
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
    // جلب المطابق للنظام + بدون system_type (بيانات قديمة)
    const [matched, nullSys] = await Promise.all([
      apiGet('contacts', { select:'id,name,type,phone', system_type:`eq.${state.system}`, order:'name.asc' }),
      apiGet('contacts', { select:'id,name,type,phone', system_type:'is.null',             order:'name.asc' }),
    ]);
    const seen = new Set();
    const all = [];
    [...(matched||[]), ...(nullSys||[])].forEach(c => {
      if (!seen.has(c.id)) { seen.add(c.id); all.push(c); }
    });
    all.sort((a,b) => (a.name||'').localeCompare(b.name||'', 'ar'));
    const filtered = all.filter(c => type === 'all' || c.type === type);
    _acCache[key] = { data: filtered, ts: Date.now() };
    return filtered;
  } catch(e) { return []; }
}

function acClearCache() { Object.keys(_acCache).forEach(k => delete _acCache[k]); }

const _acTypeLabels2 = { customer:'عميل', supplier:'مورد', partner:'شريك', custodian:'عهدة' };
const _acTypeBadges  = { customer:'ac-badge-customer', supplier:'ac-badge-supplier', partner:'ac-badge-partner', custodian:'ac-badge-custodian' };
const _acTypeIcons   = { customer:'🤝', supplier:'🏭', partner:'👥', custodian:'🗝' };
let _acActiveIndex = -1;

// Pre-load contacts cache on focus (no display)
function acPreload(type) {
  acGetContacts(type); // warm cache silently
}

// ── الدالة الرئيسية للبحث ──
async function acSearch(type, inputId) {
  const inp  = el(inputId);
  const drop = el('ac-' + inputId);
  if (!inp || !drop) return;
  const q = inp.value.trim();

  // لا تعرض شيء إذا كان الحقل فارغ
  if (!q) {
    drop.style.cssText = 'display:none';
    drop.innerHTML = '';
    return;
  }

  const contacts = await acGetContacts(type);
  const filtered = contacts.filter(c => c.name.toLowerCase().includes(q.toLowerCase()));
  _acActiveIndex = -1;

  let html = '';
  filtered.slice(0, 10).forEach(c => {
    const safeName = c.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    html += `
    <div class="ac-item" data-id="${c.id}" data-name="${c.name}" style="display:flex;align-items:center;gap:0;padding:0">
      <div style="display:flex;align-items:center;gap:6px;flex:1;padding:8px 10px;cursor:pointer"
        onmousedown="event.preventDefault();acSelect('${inputId}','${safeName}')">
        <span style="font-size:14px">${_acTypeIcons[c.type]||'👤'}</span>
        <span class="ac-item-name" style="font-weight:600">${c.name}</span>
        <span class="ac-item-badge ${_acTypeBadges[c.type]||''}" style="font-size:12px;padding:1px 7px;border-radius:10px">${_acTypeLabels2[c.type]||c.type}</span>
        ${c.phone ? `<span style="font-size:12px;color:var(--text3);margin-right:auto">${c.phone}</span>` : ''}
      </div>
      <div style="display:flex;gap:2px;padding:4px 6px;flex-shrink:0;border-right:1px solid var(--border)">
        <button onmousedown="event.preventDefault();event.stopPropagation();acEditContact(${c.id})"
          style="background:var(--blue-dim);border:1px solid var(--blue);color:var(--blue);border-radius:4px;padding:2px 6px;font-size:13px;cursor:pointer;font-family:Cairo,sans-serif;line-height:1.2"
          title="تعديل">✏️</button>
        <button onmousedown="event.preventDefault();event.stopPropagation();acDeleteContact(${c.id},'${inputId}')"
          style="background:var(--red-dim);border:1px solid var(--red);color:var(--red);border-radius:4px;padding:2px 6px;font-size:13px;cursor:pointer;font-family:Cairo,sans-serif;line-height:1.2"
          title="حذف">🗑</button>
      </div>
    </div>`;
  });

  // زر إضافة جديد لو الاسم مش موجود
  const exact = contacts.find(c => c.name.toLowerCase() === q.toLowerCase());
  if (!exact) {
    html += `
    <div class="ac-item ac-item-add" style="padding:8px 10px;display:flex;align-items:center;gap:6px;cursor:pointer;border-top:1px solid var(--border)"
      onmousedown="event.preventDefault();acSelectNew('${inputId}','${type}','${inp.value.trim().replace(/'/g, "\\'")}')">
      <span style="color:var(--green);font-size:14px">➕</span>
      <span style="color:var(--green);font-weight:600;font-size:12px">إضافة "${inp.value.trim()}" كـ ${_acTypeLabels2[type]||type} جديد</span>
    </div>`;
  }

  if (!filtered.length && exact) {
    html = `<div style="padding:10px 14px;color:var(--text3);font-size:12px">لا توجد نتائج مطابقة</div>`;
  }
  if (!html && !filtered.length) {
    html = `<div style="padding:10px 14px;color:var(--text3);font-size:12px">لا توجد نتائج — اكتب لإضافة جديد</div>`;
  }

  drop.innerHTML = html;
  drop.style.cssText = 'display:block;position:absolute;top:100%;right:0;left:0;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);z-index:9999;max-height:260px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.2);margin-top:2px';
}

// ── تحديد جهة اتصال ──
function acSelect(inputId, name) {
  const inp  = el(inputId);
  const drop = el('ac-' + inputId);
  if (inp)  inp.value = name;
  if (drop) { drop.style.display = 'none'; drop.innerHTML = ''; }
}

// ── إضافة جهة اتصال جديدة ──
async function acSelectNew(inputId, type, name) {
  if (!name) return;
  try {
    const [matchedSys, nullSys] = await Promise.all([
      apiGet('contacts', { select:'id', system_type:`eq.${state.system}`, name:`eq.${name}` }),
      apiGet('contacts', { select:'id', system_type:'is.null',             name:`eq.${name}` }),
    ]);
    const existing = [...(matchedSys||[]), ...(nullSys||[])];
    if (!existing.length) {
      await apiPost('contacts', { system_type: state.system, name, type });
      acClearCache();
      toast(`✅ تم إضافة "${name}" كـ ${_acTypeLabels2[type]||type}`, 'ok');
    }
    acSelect(inputId, name);
  } catch(e) { toast('خطأ: ' + e.message, 'err'); }
}

// ── تعديل جهة اتصال من الـ dropdown ──
async function acEditContact(contactId) {
  document.querySelectorAll('[id^="ac-"]').forEach(d => { d.style.display = 'none'; d.innerHTML = ''; });
  try {
    const data = await apiGet('contacts', { select:'*', id:`eq.${contactId}` });
    const c = data?.[0];
    if (c) openContactModal(c);
    else toast('لم يُعثر على جهة الاتصال', 'err');
  } catch(e) { toast('خطأ: ' + e.message, 'err'); }
}

// ── حذف جهة اتصال من الـ dropdown ──
async function acDeleteContact(contactId, inputId) {
  document.querySelectorAll('[id^="ac-"]').forEach(d => { d.style.display = 'none'; d.innerHTML = ''; });
  showConfirm('حذف جهة الاتصال', 'هل تريد حذف هذه الجهة نهائياً؟ لا يمكن التراجع.', async () => {
    try {
      await apiDelete('contacts', { id:`eq.${contactId}` });
      acClearCache();
      toast('✅ تم الحذف', 'ok');
      const inp = el(inputId);
      if (inp) inp.value = '';
      if (el('contactsView')?.style?.display !== 'none') loadContacts();
    } catch(e) { toast('خطأ: ' + e.message, 'err'); }
  });
}

// ── إغلاق عند الـ blur ──
function acBlur(inputId) {
  setTimeout(() => {
    const d = el('ac-' + inputId);
    if (d) { d.style.display = 'none'; }
  }, 250);
}

// ── التنقل بالكيبورد ──
function acKey(e, inputId) {
  const drop = el('ac-' + inputId);
  if (!drop || drop.style.display === 'none') return;
  const items = drop.querySelectorAll('.ac-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _acActiveIndex = Math.min(_acActiveIndex + 1, items.length - 1);
    items.forEach((it, i) => it.style.background = i === _acActiveIndex ? 'var(--card2)' : '');
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _acActiveIndex = Math.max(_acActiveIndex - 1, 0);
    items.forEach((it, i) => it.style.background = i === _acActiveIndex ? 'var(--card2)' : '');
  } else if (e.key === 'Enter' && _acActiveIndex >= 0) {
    e.preventDefault();
    const activeDiv = items[_acActiveIndex]?.querySelector('[onmousedown]');
    if (activeDiv) activeDiv.dispatchEvent(new MouseEvent('mousedown'));
  } else if (e.key === 'Escape') {
    drop.style.display = 'none';
  }
}

// ── تسجيل جهة اتصال تلقائياً لو مش موجودة ──
async function ensureContact(name, type) {
  if (!name || !name.trim()) return;
  try {
    // ابحث في المطابق للنظام + null (قديمة) عشان لا تكرر
    const [matchedSys, nullSys] = await Promise.all([
      apiGet('contacts', { select:'id', system_type:`eq.${state.system}`, name:`eq.${name.trim()}` }),
      apiGet('contacts', { select:'id', system_type:'is.null',             name:`eq.${name.trim()}` }),
    ]);
    const existing = [...(matchedSys||[]), ...(nullSys||[])];
    if (!existing.length) {
      await apiPost('contacts', { system_type: state.system, name: name.trim(), type });
      acClearCache();
    }
  } catch(e) { /* silent */ }
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
    const data = await apiGetAll('payments', { select:'*', id:`eq.${paymentId}` });
    const p = data?.[0];
    if (!p) { toast('لم يُعثر على البيانات','err'); return; }

    // Load partners for this file
    let partners = await apiGetAll('partners_master', { select:'partner', system_type:`eq.${state.system}`, file_no:`eq.${p.file_no}` });
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

// طلب تعديل لسجل مُرحَّل: يحفظ القيم الجديدة في حقول _edit_* ويضع السجل قيد المراجعة
// بدل تعديله مباشرة — مشترك بين تعديل الدفعات والمصاريف (نفس النمط بالضبط).
async function requestPostedEdit({ table, old, editFields, summary, auditLabel, modalId }) {
  await apiPatch(table, { id:`eq.${old.id}` }, {
    post_status: 'pending_edit',
    ...editFields,
    notes: summary,
  });
  await logAudit('EDIT_REQUEST', table, old.file_no, old, editFields, auditLabel);
  await updateApprovalBadge();
  markSaving(modalId); closeModal(modalId);
  toast('📋 تم إرسال التعديل للمراجعة — في انتظار الموافقة', 'ok');
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
    // جلب السجل الحالي لمعرفة حالته
    const oldData = await apiGetAll('payments', { select:'*', id:`eq.${id}` });
    const old = oldData?.[0];
    if (!old) { showFieldErr('epError','لم يُعثر على السجل'); return; }

    if (old.post_status === 'posted') {
      // ── السجل مرحّل: تعديل in-place بدل void+new ──
      await requestPostedEdit({
        table: 'payments', old, modalId: 'editPaymentModal',
        editFields: { _edit_payer:payer, _edit_amount:amount, _edit_method:method, _edit_date:date, _edit_doc:doc||null },
        summary: `طلب تعديل: ${payer} · ${amount} · ${date}${notes?' — '+notes:''} | أصل: ${old.payer} · ${old.amount} · ${old.pay_date}`,
        auditLabel: `طلب تعديل دفعة ${old.ref_no||id}`,
      });
    } else {
      // ── السجل draft: تعديل مباشر ──
      await apiPatch('payments', { id:`eq.${id}` }, { payer, amount, pay_method:method, pay_date:date, document:doc||null, notes:notes||null });
      markSaving('editPaymentModal'); closeModal('editPaymentModal');
      toast('✅ تم تعديل الدفعة', 'ok');
    }
    invalidateCache();
    if (state.currentTab === 2) loadPaymentsTab(state.currentFileNo, state.system);
    if (state.currentTab === 0) loadSummaryTab(state.currentFileNo, state.system);
  } catch(e) { showFieldErr('epError','خطأ: '+e.message); }
}

// ════════════════════════════════════════
// VOID TRANSACTION — إلغاء بقيد عكسي
// ════════════════════════════════════════
async function deletePaymentEntry(paymentId, fileNo) {
  try {
    const data = await apiGetAll('payments', { select:'*', id:`eq.${paymentId}` });
    const p = data?.[0];
    if (!p) { toast('لم يُعثر على الدفعة','err'); return; }
    if (p.post_status === 'voided') { toast('⚠️ هذه الدفعة مُلغاة مسبقاً','warn'); return; }

    const details = `رقم الدفعة: ${p.ref_no||'—'}\nالدافع: ${p.payer||'—'}\nالمبلغ: ${fmt(p.amount)}\nالتاريخ: ${p.pay_date||'—'}`;
    showConfirm(
      `🔄 إلغاء دفعة — ${p.ref_no||'#'+paymentId}`,
      `سيتم إلغاء هذه الدفعة بقيد عكسي محاسبي.\nالدفعة لن تُحذف — ستُعلَّم "ملغاة".\n\n${details}`,
      async () => {
        try {
          await voidTransaction('payment', p);
          toast(`✅ تم إلغاء الدفعة ${p.ref_no||''} بقيد عكسي`, 'ok');
          if (state.currentTab === 2) loadPaymentsTab(state.currentFileNo||fileNo, state.system);
          if (state.currentTab === 0) loadSummaryTab(state.currentFileNo||fileNo, state.system);
        } catch(e) { toast('خطأ: '+e.message, 'err'); }
      }
    );
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

function deletePaymentFromModal() {
  const id     = el('ep-id').value;
  const fileNo = state.currentFileNo;
  if (!id) return;
  closeModal('editPaymentModal');
  deletePaymentEntry(id, fileNo);
}

// ════════════════════════════════════════
// DELETE EXPENSE ENTRY
// ════════════════════════════════════════
async function deleteExpenseEntry(expenseId, fileNo) {
  try {
    const data = await apiGetAll('expenses', { select:'*', id:`eq.${expenseId}` });
    const e = data?.[0];
    if (!e) { toast('لم يُعثر على المصروف','err'); return; }
    if (e.post_status === 'voided') { toast('⚠️ هذا المصروف مُلغى مسبقاً','warn'); return; }

    const details = `رقم المصروف: ${e.ref_no||'—'}\nالبيان: ${e.description||'—'}\nالمبلغ: ${fmt(e.amount)}\nالتاريخ: ${e.exp_date||'—'}`;
    showConfirm(
      `🔄 إلغاء مصروف — ${e.ref_no||'#'+expenseId}`,
      `سيتم إلغاء هذا المصروف بقيد عكسي محاسبي.\n\n${details}`,
      async () => {
        try {
          await voidTransaction('expense', e);
          toast(`✅ تم إلغاء المصروف ${e.ref_no||''} بقيد عكسي`, 'ok');
          if (state.currentTab === 3) loadExpensesTab(state.currentFileNo||fileNo, state.system);
          if (state.currentTab === 0) loadSummaryTab(state.currentFileNo||fileNo, state.system);
        } catch(err) { toast('خطأ: '+err.message, 'err'); }
      }
    );
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

// ════════════════════════════════════════
// DELETE COLLECTION ENTRY
// ════════════════════════════════════════
async function deleteCollectionEntry(collectionId, fileNo) {
  try {
    const data = await apiGetAll('collections', { select:'*', id:`eq.${collectionId}` });
    const c = data?.[0];
    if (!c) { toast('لم يُعثر على التحصيل','err'); return; }
    if (c.post_status === 'voided') { toast('⚠️ هذا التحصيل مُلغى مسبقاً','warn'); return; }
    if (!c.paid_date) {
      // تحصيل لم يُدفع بعد — مش عنده قيد محاسبي → نلغيه مباشرة
      showConfirm(
        `🗑 إلغاء تحصيل منتظر — ${c.ref_no||'#'+collectionId}`,
        `هذا التحصيل لم يُدفع بعد (مستحق)، إلغاؤه لن يؤثر على القيود.\n\nهل تريد إلغاءه؟`,
        async () => {
          try {
            await apiPatch('collections', { id:`eq.${collectionId}` }, { post_status:'voided', notes:`${c.notes||''} | مُلغى ${today()}` });
            await logAudit('VOID','collections', fileNo||c.file_no, c, null, `إلغاء تحصيل منتظر ${c.ref_no}`);
            invalidateCache();
            toast(`✅ تم إلغاء التحصيل ${c.ref_no||''}`, 'ok');
            if (state.currentTab === 5) loadCollectionsTab(state.currentFileNo||fileNo, state.system);
            if (state.currentTab === 0) loadSummaryTab(state.currentFileNo||fileNo, state.system);
          } catch(err) { toast('خطأ: '+err.message, 'err'); }
        }
      );
      return;
    }
    // تحصيل مدفوع — عنده قيد → نعكسه
    const details = `رقم التحصيل: ${c.ref_no||'—'}\nالعميل: ${c.customer||'—'}\nالمبلغ: ${fmt(c.amount)}\nتاريخ الدفع: ${c.paid_date}`;
    showConfirm(
      `🔄 إلغاء تحصيل مدفوع — ${c.ref_no||'#'+collectionId}`,
      `سيتم إلغاء هذا التحصيل بقيد عكسي محاسبي.\n\n${details}`,
      async () => {
        try {
          await voidTransaction('collection', c);
          toast(`✅ تم إلغاء التحصيل ${c.ref_no||''} بقيد عكسي`, 'ok');
          if (state.currentTab === 5) loadCollectionsTab(state.currentFileNo||fileNo, state.system);
          if (state.currentTab === 0) loadSummaryTab(state.currentFileNo||fileNo, state.system);
        } catch(err) { toast('خطأ: '+err.message, 'err'); }
      }
    );
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}
// EDIT EXPENSE
// ════════════════════════════════════════
async function openEditExpenseModal(expenseId) {
  try {
    const data = await apiGetAll('expenses', { select:'*', id:`eq.${expenseId}` });
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
    const oldData = await apiGetAll('expenses', { select:'*', id:`eq.${id}` });
    const old = oldData?.[0];
    if (!old) { showFieldErr('eeError','لم يُعثر على السجل'); return; }

    if (old.post_status === 'posted') {
      // ── تعديل in-place بدل void+new ──
      await requestPostedEdit({
        table: 'expenses', old, modalId: 'editExpenseModal',
        editFields: { _edit_desc:desc, _edit_type:type, _edit_amount:amount, _edit_date:date, _edit_method:method, _edit_doc:doc||null },
        summary: `طلب تعديل: ${desc} · ${amount} · ${date}${notes?' — '+notes:''} | أصل: ${old.description} · ${old.amount} · ${old.exp_date}`,
        auditLabel: `طلب تعديل مصروف ${old.ref_no||id}`,
      });
    } else {
      await apiPatch('expenses', { id:`eq.${id}` }, { description:desc, exp_type:type, amount, exp_date:date, pay_method:method, document:doc||null, notes:notes||null });
      markSaving('editExpenseModal'); closeModal('editExpenseModal');
      toast('✅ تم تعديل المصروف','ok');
    }
    invalidateCache();
    if (state.currentTab === 3) loadExpensesTab(state.currentFileNo, state.system);
    if (state.currentTab === 0) loadSummaryTab(state.currentFileNo, state.system);
  } catch(e) { showFieldErr('eeError','خطأ: '+e.message); }
}

// ════════════════════════════════════════
// EDIT COLLECTION
// ════════════════════════════════════════
async function openEditCollectionModal(collectionId) {
  try {
    const data = await apiGetAll('collections', { select:'*', id:`eq.${collectionId}` });
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
    const oldData = await apiGetAll('collections', { select:'*', id:`eq.${id}` });
    const old = oldData?.[0] || {};

    if (old.post_status === 'posted' && old.paid_date) {
      // ── تعديل in-place بدل void+new ──
      await apiPatch('collections', { id:`eq.${id}` }, {
        post_status:   'pending_edit',
        _edit_amount:  amount,
        _edit_method:  method,
        _edit_due:     due || null,
        _edit_paid:    paid || null,
        _edit_doc:     doc || null,
        notes:         `طلب تعديل: ${amount} · ${paid||due||'—'}${notes?' — '+notes:''} | أصل: ${old.amount} · ${old.paid_date||'—'}`,
      });
      await logAudit('EDIT_REQUEST','collections', old.file_no, old, {amount,method,due,paid}, `طلب تعديل تحصيل ${old.ref_no||id}`);
      await updateApprovalBadge();
      markSaving('editCollectionModal'); closeModal('editCollectionModal');
      toast('📋 تم إرسال التعديل للمراجعة — في انتظار الموافقة', 'ok');
      invalidateCache();
      if (state.currentTab === 5) loadCollectionsTab(state.currentFileNo, state.system);
      if (state.currentTab === 0) loadSummaryTab(state.currentFileNo, state.system);
      return;
    }

    // ── draft أو غير مدفوع: تعديل مباشر ──
    const wasUnpaid = !old.paid_date;
    const nowPaid   = !!paid;
    const isPostedRecord = old.post_status !== 'draft';
    const effectivePaidDate = (paid && isPostedRecord) ? paid : null;

    await apiPatch('collections', { id:`eq.${id}` }, { amount, pay_method:method, due_date:due||null, paid_date:effectivePaidDate, document:doc||null, notes:notes||null });

    // إذا كانت غير مدفوعة وأصبحت مدفوعة الآن → أنشئ قيد تحصيل
    if (wasUnpaid && nowPaid && isPostedRecord) {
      try {
        await je_collection({
          sys:      state.system,
          date:     paid,
          amount:   amount,
          fileNo:   old.file_no,
          refId:    old.id || null,
          customer: old.customer || '—',
          invNo:    old.inv_no   || '',
          method:   method,
        });
      } catch(jeErr) {
        toast(`⚠️ تم الحفظ لكن فشل القيد المحاسبي: ${jeErr.message}`, 'warn');
      }
    }

    markSaving('editCollectionModal');
    closeModal('editCollectionModal');
    toast('✅ تم تعديل التحصيل', 'ok');
    invalidateCache();
    if (state.currentTab === 5) loadCollectionsTab(state.currentFileNo, state.system);
    if (state.currentTab === 0) loadSummaryTab(state.currentFileNo, state.system);
  } catch(e) { showFieldErr('ecError', 'خطأ: ' + e.message); }
}

// ════════════════════════════════════════
// MARK COLLECTION AS PAID — تسجيل دفع سريع
// ════════════════════════════════════════
async function markCollectionPaid(collectionId, fileNo) {
  try {
    const data = await apiGetAll('collections', { select:'*', id:`eq.${collectionId}` });
    const c = data?.[0];
    if (!c) { toast('لم يُعثر على التحصيل','err'); return; }
    if (c.paid_date) { toast('هذا التحصيل مسجّل كمدفوع بالفعل','warn'); return; }

    // ملء مودال الدفع السريع
    el('cpaid-id').value      = c.id;
    el('cpaid-inv').textContent   = c.inv_no  || '—';
    el('cpaid-cust').textContent  = c.customer || '—';
    el('cpaid-amt').textContent   = fmt(c.amount);
    el('cpaid-date').value    = today();
    el('cpaid-method').value  = c.pay_method || 'تحويل بنكي';
    el('cpaid-doc').value     = '';
    el('cpaid-notes').value   = '';
    el('cpaidError').style.display = 'none';
    openModal('markPaidModal');
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

async function submitMarkPaid() {
  const id     = el('cpaid-id').value;
  const date   = el('cpaid-date').value;
  const method = el('cpaid-method').value;
  const doc    = el('cpaid-doc').value.trim();
  const notes  = el('cpaid-notes').value.trim();
  if (!date) { showFieldErr('cpaidError','يرجى تحديد تاريخ الدفع'); return; }
  try {
    const data = await apiGetAll('collections', { select:'*', id:`eq.${id}` });
    const c = data?.[0];
    if (!c) throw new Error('لم يُعثر على التحصيل');

    // FIX: لا يمكن تسجيل الدفع على تحصيل Draft — يجب الموافقة عليه أولاً
    if (c.post_status === 'draft') {
      showFieldErr('cpaidError', '⚠️ هذا التحصيل في انتظار الموافقة (Draft) — راجع قائمة الموافقات أولاً');
      return;
    }

    await apiPatch('collections', { id:`eq.${id}` }, {
      paid_date:  date,
      pay_method: method,
      document:   doc  || null,
      notes:      notes || c.notes || null,
    });

    // قيد محاسبي لو مرحّل (posted أو null = بيانات قديمة)
    if (isPosted(c)) {
      try {
        await je_collection({
          sys:      state.system,
          date,
          amount:   +c.amount,
          fileNo:   c.file_no,
          refId:    c.id || null,
          customer: c.customer || '—',
          invNo:    c.inv_no   || '',
          method,
        });
      } catch(jeErr) { toast(`⚠️ تم الحفظ — فشل القيد: ${jeErr.message}`, 'warn'); }
    }

    markSaving('markPaidModal');
    closeModal('markPaidModal');
    invalidateCache();
    toast(`✅ تم تسجيل دفع ${c.ref_no||''} — ${fmt(c.amount)}`, 'ok');
    if (state.currentTab === 5) loadCollectionsTab(state.currentFileNo || c.file_no, state.system);
    if (state.currentTab === 0) loadSummaryTab(state.currentFileNo || c.file_no, state.system);
  } catch(e) { showFieldErr('cpaidError','خطأ: '+e.message); }
}
