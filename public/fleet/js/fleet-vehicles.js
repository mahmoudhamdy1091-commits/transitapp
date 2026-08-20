// ╔══════════════════════════════════════════════════════════╗
// ║  fleet-vehicles.js — قائمة السيارات + إدارة (CRUD)        ║
// ╚══════════════════════════════════════════════════════════╝

import { apiGet, apiPost, apiPatch, apiDelete, fmtKWD } from './fleet-core.js';
import { toast, confirmAsync, openFormModal, guardedCall, showCtxMenu } from './fleet-ui.js';
import { navigate } from './fleet-router.js';
import { issueInvoiceFlow, settleInvoiceFlow, voidInvoiceFlow, voidReceiptFlow } from './fleet-invoices.js';
import { issueBillFlow, settleBillFlow, voidBillFlow, voidPaymentFlow } from './fleet-bills.js';

const STATUS_LABEL = {
  active: { label: 'نشطة', cls: 'ok' },
  maintenance: { label: 'صيانة', cls: 'warn' },
  sold: { label: 'مباعة', cls: 'err' },
  archived: { label: 'مؤرشفة', cls: 'err' },
};

function _statusBadge(status) {
  const s = STATUS_LABEL[status] || { label: status, cls: 'warn' };
  return `<span class="fleet-badge ${s.cls}">${s.label}</span>`;
}

// ── جدول "ملفات" — نفس نمط renderDealsTable (public/js/dashboard.js) بالحرف:
// إيراد/مصروف/صافي كـpill ملوّن + سهم + نسبة هامش، صف إجمالي أسفل الجدول
// (Phase 7 Stage 2). إيراد/مصروف تراكميان منذ البداية — بدون فلتر تاريخ هنا
// عمدًا (فلتر النطاق الزمني حصري جوه ملف السيارة، Stage 3).
function _renderVehiclesTable(list, driverByVehicle, revByVehicle, expByVehicle, main) {
  const wrap = main.querySelector('#vehiclesTableWrap');
  if (!list.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="e-icon">🚚</div><p>لا توجد سيارات</p></div>`;
    return;
  }

  const rows = list.map(v => {
    const rev = revByVehicle[v.id] || 0;
    const exp = expByVehicle[v.id] || 0;
    const net = rev - exp;
    const netColor = net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--text2)';
    const netBg    = net > 0 ? 'var(--green-dim)' : net < 0 ? 'var(--red-dim)' : 'transparent';
    const netArrow = net >= 0 ? '▲' : '▼';
    const driver = driverByVehicle[v.id];

    return `<tr style="cursor:pointer" data-id="${v.id}">
      <td>
        <div class="mono" style="font-weight:700">${v.plate_no || '—'}</div>
        <div style="font-size:12px;color:var(--text2)">${[v.make, v.model].filter(Boolean).join(' ') || '—'}</div>
      </td>
      <td>
        ${driver ? `<div style="font-weight:600">${driver.full_name}</div><div style="font-size:12px;color:var(--text2)">${driver.civil_id || ''}</div>` : `<span style="color:var(--text3)">لا يوجد سائق</span>`}
      </td>
      <td><div class="mono text-blue" style="font-weight:700">${fmtKWD(rev)}</div></td>
      <td><div class="mono text-red" style="font-weight:700">${fmtKWD(exp)}</div></td>
      <td>
        <div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:8px;background:${netBg}">
          <span style="font-size:12px">${netArrow}</span>
          <span class="mono" style="font-weight:900;color:${netColor};font-size:13px">${fmtKWD(Math.abs(net))}</span>
        </div>
        ${net !== 0 && rev > 0 ? `<div style="font-size:12px;color:var(--text2);margin-top:2px">هامش ${((net / rev) * 100).toFixed(1)}%</div>` : ''}
      </td>
      <td>${_statusBadge(v.status)}</td>
    </tr>`;
  }).join('');

  const tRev = list.reduce((s, v) => s + (revByVehicle[v.id] || 0), 0);
  const tExp = list.reduce((s, v) => s + (expByVehicle[v.id] || 0), 0);
  const tNet = tRev - tExp;
  const totalRow = `<tr style="background:var(--card2);font-weight:700;border-top:2px solid var(--border)">
    <td colspan="2" style="padding:10px 14px;font-size:12px">الإجمالي — ${list.length} سيارة</td>
    <td class="mono text-blue" style="font-weight:900">${fmtKWD(tRev)}</td>
    <td class="mono text-red" style="font-weight:900">${fmtKWD(tExp)}</td>
    <td>
      <div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:8px;background:${tNet >= 0 ? 'var(--green-dim)' : 'var(--red-dim)'}">
        <span>${tNet >= 0 ? '▲' : '▼'}</span>
        <span class="mono" style="font-weight:900;color:${tNet >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtKWD(Math.abs(tNet))}</span>
      </div>
    </td>
    <td></td>
  </tr>`;

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>رقم اللوحة</th>
        <th>السائق الحالي</th>
        <th style="color:var(--blue)">الإيراد</th>
        <th style="color:var(--red)">المصروف</th>
        <th>الصافي</th>
        <th>الحالة</th>
      </tr></thead>
      <tbody>${rows}${totalRow}</tbody>
    </table>`;

  wrap.querySelectorAll('tbody tr[data-id]').forEach(tr => {
    tr.onclick = () => navigate('vehicle', { id: tr.dataset.id });
  });
}

export async function renderVehiclesList(params, main) {
  const [vehicles, openAssignments, invoices, bills] = await Promise.all([
    apiGet('fleet_vehicles', { select: '*', order: 'created_at.desc' }),
    apiGet('fleet_assignments', { select: 'vehicle_id,fleet_drivers(full_name,civil_id)', end_date: 'is.null' }),
    apiGet('v_invoice_balances', { select: 'vehicle_id,amount' }),
    apiGet('v_bill_balances', { select: 'vehicle_id,amount' }),
  ]);

  const driverByVehicle = Object.fromEntries(openAssignments.map(a => [a.vehicle_id, a.fleet_drivers]));
  const revByVehicle = {};
  invoices.forEach(i => { revByVehicle[i.vehicle_id] = (revByVehicle[i.vehicle_id] || 0) + Number(i.amount); });
  const expByVehicle = {};
  bills.forEach(b => { if (b.vehicle_id) expByVehicle[b.vehicle_id] = (expByVehicle[b.vehicle_id] || 0) + Number(b.amount); });

  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap">
      <input id="vehicleSearch" placeholder="بحث برقم اللوحة أو الشاصي" class="fleet-btn" style="flex:1;min-width:180px;text-align:right;cursor:text">
      <button id="addVehicleBtn" class="fleet-btn primary" type="button">+ سيارة جديدة</button>
    </div>
    <div class="data-table-wrap" id="vehiclesTableWrap"></div>`;

  _renderVehiclesTable(vehicles, driverByVehicle, revByVehicle, expByVehicle, main);

  main.querySelector('#vehicleSearch').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = vehicles.filter(v =>
      (v.plate_no || '').toLowerCase().includes(q) || (v.chassis_no || '').toLowerCase().includes(q));
    _renderVehiclesTable(filtered, driverByVehicle, revByVehicle, expByVehicle, main);
  };

  main.querySelector('#addVehicleBtn').onclick = async () => {
    const fd = await openFormModal('سيارة جديدة', `
      <label>رقم اللوحة *<input name="plate_no" required class="fleet-input"></label>
      <label>رقم الشاصي<input name="chassis_no" class="fleet-input"></label>
      <label>الماركة<input name="make" class="fleet-input"></label>
      <label>الموديل<input name="model" class="fleet-input"></label>
      <label>السنة<input name="year" type="number" class="fleet-input"></label>
      <label>مواصفات<textarea name="specs" class="fleet-input"></textarea></label>
    `);
    if (!fd) return;
    const { ok } = await guardedCall(() => apiPost('fleet_vehicles', {
      plate_no: fd.get('plate_no'), chassis_no: fd.get('chassis_no') || null,
      make: fd.get('make') || null, model: fd.get('model') || null,
      year: fd.get('year') ? Number(fd.get('year')) : null,
      specs: fd.get('specs') || null, status: 'active',
    }), 'إضافة سيارة');
    if (ok) { toast('تمت إضافة السيارة', 'ok'); renderVehiclesList(params, main); }
  };
}

const VEHICLE_TABS = [
  { id: 'summary', label: '📋 ملخص' },
  { id: 'driver', label: '👤 السائق' },
  { id: 'revenue', label: '🧾 الإيرادات' },
  { id: 'expenses', label: '💸 المصروفات' },
  { id: 'notes', label: '📝 الملاحظات' },
];

// إضافة جديدة برّه نمط BOX/TM عمدًا (§Phase 7 Stage 3) — فلتر نطاق تاريخ
// يقيّد الـKPI وتابَي الإيرادات/المصروفات، بدون فلتر تاريخ = تراكمي كامل
// (نفس منطق Stage 2 في قائمة السيارات).
function _periodRange(preset, from, to) {
  if (preset === 'custom') return (from && to) ? { from, to } : null;
  if (preset === 'all') return null;
  const end = new Date();
  const start = new Date();
  if (preset === '3m') start.setMonth(start.getMonth() - 3);
  if (preset === '1y') start.setFullYear(start.getFullYear() - 1);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function _inRange(dateStr, range) {
  if (!range) return true;
  if (range.from && dateStr < range.from) return false;
  if (range.to && dateStr > range.to) return false;
  return true;
}

function _balanceBadge(paid, amount) {
  paid = Number(paid); amount = Number(amount);
  if (paid >= amount) return '<span class="fleet-badge ok">مسددة بالكامل</span>';
  if (paid > 0) return `<span class="fleet-badge warn">جزئي (${fmtKWD(amount - paid)} متبقي)</span>`;
  return '<span class="fleet-badge err">غير مسددة</span>';
}

// ── ملف السيارة كصفحة كاملة (زي ملف الصفقة في BOX/TM بالحرف) — viewer-header
// + فلتر فترة + شريط KPI + tabs (Phase 7 Stage 3). كل التبويبات بتقرأ من
// invoices/bills اللي اتجابوا مرة واحدة فوق، فلترة الفترة كلها client-side.
export async function renderVehicleDetail(params, main) {
  const id = params.id;
  const [vehicle] = await apiGet('fleet_vehicles', { select: '*', id: `eq.${id}` });
  if (!vehicle) { main.innerHTML = '<div class="fleet-card">السيارة غير موجودة</div>'; return; }

  const [assignments, invoices, bills] = await Promise.all([
    apiGet('fleet_assignments', { select: '*,fleet_drivers(full_name,civil_id,residency_expiry)', vehicle_id: `eq.${id}`, order: 'start_date.desc' }),
    apiGet('v_invoice_balances', { select: '*', vehicle_id: `eq.${id}`, order: 'for_month.desc' }),
    apiGet('v_bill_balances', { select: '*', vehicle_id: `eq.${id}`, order: 'for_month.desc' }),
  ]);
  const current = assignments.find(a => !a.end_date);
  const context = { vehiclePlate: vehicle.plate_no, driverName: current?.fleet_drivers?.full_name, driverCivilId: current?.fleet_drivers?.civil_id };
  const ui = { tab: 'summary', preset: 'all', from: '', to: '' };
  const refresh = () => renderVehicleDetail(params, main);

  main.innerHTML = `
    <div class="viewer-header">
      <button class="vh-back" id="backBtn" type="button">← رجوع</button>
      <div class="vh-info">
        <div class="vh-file-no">${vehicle.plate_no}</div>
        <div class="vh-meta">
          <span class="vh-meta-item"><strong>الموديل:</strong> ${[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' — ') || '—'}</span>
          <span class="vh-meta-item"><strong>الشاصي:</strong> ${vehicle.chassis_no || '—'}</span>
          <span class="vh-meta-item"><strong>السائق:</strong> ${current?.fleet_drivers?.full_name || 'لا يوجد'}</span>
        </div>
        <div class="vh-actions">
          <div class="vh-action-group">
            <button class="btn btn-secondary btn-sm" id="qaInvoiceBtn" type="button">🧾 فاتورة إيجار</button>
            <button class="btn btn-secondary btn-sm" id="qaReceiptBtn" type="button">💰 تحصيل</button>
            <button class="btn btn-secondary btn-sm" id="qaBillBtn" type="button">💸 مصروف</button>
          </div>
          <div class="vh-action-group">
            <button class="btn btn-secondary btn-sm" id="qaPaymentBtn" type="button">💳 سداد</button>
            <button class="btn btn-secondary btn-sm" id="editVehicleBtn" type="button">✏️ تعديل</button>
            ${vehicle.status !== 'archived' ? '<button class="btn btn-secondary btn-sm" id="archiveVehicleBtn" type="button">🗄️ أرشفة</button>' : ''}
          </div>
        </div>
      </div>
      <div id="vh-status-badge">${_statusBadge(vehicle.status)}</div>
    </div>

    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      <span style="font-size:11px;color:var(--text2);font-weight:700">الفترة:</span>
      <div style="display:flex;background:var(--card2);border-radius:var(--radius-sm);padding:3px;gap:2px">
        <button class="btn btn-sm period-btn active" data-preset="all" type="button">كل الوقت</button>
        <button class="btn btn-sm period-btn" data-preset="3m" type="button">آخر 3 شهور</button>
        <button class="btn btn-sm period-btn" data-preset="1y" type="button">آخر سنة</button>
        <button class="btn btn-sm period-btn" data-preset="custom" type="button">تاريخ محدد</button>
      </div>
      <div id="customDateWrap" style="display:none;align-items:center;gap:6px">
        <input type="date" id="periodFrom" class="fleet-input" style="width:auto">
        <span style="color:var(--text2)">—</span>
        <input type="date" id="periodTo" class="fleet-input" style="width:auto">
        <button class="btn btn-secondary btn-sm" id="applyCustomBtn" type="button">تطبيق</button>
      </div>
    </div>

    <div id="vehicleKpis" style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:16px"></div>

    <div class="tabs" id="vehicleTabs">
      ${VEHICLE_TABS.map((t, i) => `<div class="tab ${i === 0 ? 'active' : ''}" data-tab="${t.id}">${t.label}</div>`).join('')}
    </div>
    <div id="vehicleTabContent"></div>`;

  main.querySelector('#backBtn').onclick = () => navigate('vehicles');

  function _renderKpis() {
    const range = _periodRange(ui.preset, ui.from, ui.to);
    const periodInvoices = invoices.filter(i => _inRange(i.for_month, range));
    const periodBills = bills.filter(b => _inRange(b.for_month, range));
    const rev = periodInvoices.reduce((s, i) => s + Number(i.amount), 0);
    const exp = periodBills.reduce((s, b) => s + Number(b.amount), 0);
    // فواتير غير مسددة/متبقي على العميل: رصيد حالي (نقطة زمنية)، مش تدفق —
    // بيفضلوا من إجمالي السجل دايمًا، مش مقيّدين بفلتر الفترة عمدًا.
    const unpaidInvoices = invoices.filter(i => Number(i.remaining_amount) > 0);
    const totalRemaining = unpaidInvoices.reduce((s, i) => s + Number(i.remaining_amount), 0);
    const lastDates = [...invoices.map(i => i.issue_date), ...bills.map(b => b.issue_date)].filter(Boolean).sort();
    const lastActivity = lastDates.length ? lastDates[lastDates.length - 1] : '—';

    const kpi = (label, val, color) => `
      <div class="fleet-card" style="margin-bottom:0;padding:10px 12px">
        <div style="font-size:11px;color:var(--text2);margin-bottom:4px">${label}</div>
        <div class="mono" style="font-size:15px;font-weight:700;${color ? `color:${color}` : ''}">${val}</div>
      </div>`;
    document.getElementById('vehicleKpis').innerHTML =
      kpi('الإيراد', fmtKWD(rev), 'var(--blue)') +
      kpi('المصروف', fmtKWD(exp), 'var(--red)') +
      kpi('الصافي', fmtKWD(rev - exp), rev - exp >= 0 ? 'var(--green)' : 'var(--red)') +
      kpi('فواتير غير مسددة', unpaidInvoices.length) +
      kpi('متبقي على العميل', fmtKWD(totalRemaining), 'var(--accent)') +
      kpi('آخر نشاط', lastActivity);

    return { periodInvoices, periodBills };
  }

  function _renderInvoiceCards(hostEl, list) {
    if (!list.length) { hostEl.innerHTML = `<div class="empty-state"><div class="e-icon">🧾</div><p>لا يوجد فواتير في الفترة دي</p></div>`; return; }
    (async () => {
      const receiptsByInvoice = {};
      await Promise.all(list.filter(i => Number(i.paid_amount) > 0).map(async i => {
        receiptsByInvoice[i.id] = await apiGet('fleet_receipts', { select: '*', invoice_id: `eq.${i.id}`, post_status: 'eq.posted', order: 'receipt_date.asc' });
      }));
      hostEl.innerHTML = list.map(i => `
        <div class="fleet-card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <span style="font-weight:700">${i.invoice_no} — ${i.for_month.slice(0, 7)}</span>
            ${_balanceBadge(i.paid_amount, i.amount)}
          </div>
          <div style="color:var(--text3);font-size:12px;margin:4px 0 8px">
            ${fmtKWD(i.amount)}${Number(i.remaining_amount) > 0 ? ' — متبقي ' + fmtKWD(i.remaining_amount) : ''}
          </div>
          ${(receiptsByInvoice[i.id] || []).length ? `
          <div style="border-top:1px solid var(--border);padding-top:6px;margin-right:14px;margin-bottom:8px">
            ${(receiptsByInvoice[i.id] || []).map(r => `
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text3);margin-bottom:4px;gap:6px">
                <span>↳ سند قبض ${r.receipt_no} — ${fmtKWD(r.amount)} — ${r.receipt_date}</span>
                <button class="btn btn-danger btn-sm void-receipt-btn" type="button" data-id="${r.id}">إلغاء</button>
              </div>`).join('')}
          </div>` : ''}
          <div style="display:flex;gap:6px">
            ${Number(i.remaining_amount) > 0 ? `<button class="btn btn-success btn-sm settle-invoice-btn" type="button" data-id="${i.id}">تحصيل</button>` : ''}
            ${Number(i.paid_amount) === 0 ? `<button class="btn btn-danger btn-sm void-invoice-btn" type="button" data-id="${i.id}">إلغاء</button>` : ''}
          </div>
        </div>`).join('');

      hostEl.querySelectorAll('.settle-invoice-btn').forEach(btn => btn.onclick = async () => {
        const inv = list.find(i => i.id === Number(btn.dataset.id));
        if (await settleInvoiceFlow(inv, context)) refresh();
      });
      hostEl.querySelectorAll('.void-invoice-btn').forEach(btn => btn.onclick = async () => {
        if (await voidInvoiceFlow(Number(btn.dataset.id))) refresh();
      });
      hostEl.querySelectorAll('.void-receipt-btn').forEach(btn => btn.onclick = async () => {
        if (await voidReceiptFlow(Number(btn.dataset.id))) refresh();
      });
    })();
  }

  function _renderBillCards(hostEl, list) {
    if (!list.length) { hostEl.innerHTML = `<div class="empty-state"><div class="e-icon">💸</div><p>لا يوجد التزامات في الفترة دي</p></div>`; return; }
    (async () => {
      const paymentsByBill = {};
      await Promise.all(list.filter(b => Number(b.paid_amount) > 0).map(async b => {
        paymentsByBill[b.id] = await apiGet('fleet_payments', { select: '*', bill_id: `eq.${b.id}`, post_status: 'eq.posted', order: 'payment_date.asc' });
      }));
      hostEl.innerHTML = list.map(b => `
        <div class="fleet-card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <span style="font-weight:700">${b.bill_no} — ${b.for_month.slice(0, 7)}</span>
            ${_balanceBadge(b.paid_amount, b.amount)}
          </div>
          <div style="color:var(--text3);font-size:12px;margin:4px 0 8px">
            ${fmtKWD(b.amount)}${Number(b.remaining_amount) > 0 ? ' — متبقي ' + fmtKWD(b.remaining_amount) : ''}
          </div>
          ${(paymentsByBill[b.id] || []).length ? `
          <div style="border-top:1px solid var(--border);padding-top:6px;margin-right:14px;margin-bottom:8px">
            ${(paymentsByBill[b.id] || []).map(p => `
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text3);margin-bottom:4px;gap:6px">
                <span>↳ سند صرف ${p.payment_no} — ${fmtKWD(p.amount)} — ${p.payment_date}</span>
                <button class="btn btn-danger btn-sm void-payment-btn" type="button" data-id="${p.id}">إلغاء</button>
              </div>`).join('')}
          </div>` : ''}
          <div style="display:flex;gap:6px">
            ${Number(b.remaining_amount) > 0 ? `<button class="btn btn-success btn-sm settle-bill-btn" type="button" data-id="${b.id}">سداد</button>` : ''}
            ${Number(b.paid_amount) === 0 ? `<button class="btn btn-danger btn-sm void-bill-btn" type="button" data-id="${b.id}">إلغاء</button>` : ''}
          </div>
        </div>`).join('');

      hostEl.querySelectorAll('.settle-bill-btn').forEach(btn => btn.onclick = async () => {
        const bill = list.find(b => b.id === Number(btn.dataset.id));
        if (await settleBillFlow(bill, context)) refresh();
      });
      hostEl.querySelectorAll('.void-bill-btn').forEach(btn => btn.onclick = async () => {
        if (await voidBillFlow(Number(btn.dataset.id))) refresh();
      });
      hostEl.querySelectorAll('.void-payment-btn').forEach(btn => btn.onclick = async () => {
        if (await voidPaymentFlow(Number(btn.dataset.id))) refresh();
      });
    })();
  }

  // تاب جديد كليًا (Phase 7 Stage 3) — fleet.fleet_vehicle_notes معزول
  // بالكامل داخل schema الفليت، مش public.audit_log اللي BOX/TM بيستخدمه
  // لملاحظات الصفقة (استخدامه كان هيكسر عزل الـschema). ربط الملاحظات
  // بشاشة اليومية (فليت وBOX/TM) مؤجّل عمدًا لمرحلة منفصلة.
  async function _renderNotesTab(content) {
    content.innerHTML = `
      <div class="section-header"><div class="section-title">ملاحظات السيارة</div></div>
      <div class="fleet-card">
        <textarea id="newNoteText" class="fleet-input" placeholder="اكتب ملاحظة..." style="min-height:70px"></textarea>
        <button class="btn btn-primary btn-sm" id="addNoteBtn" type="button" style="margin-top:8px">➕ إضافة ملاحظة</button>
      </div>
      <div id="notesList"><div class="fleet-loading">جاري التحميل...</div></div>`;

    async function loadNotes() {
      const listEl = content.querySelector('#notesList');
      const { ok, result: notes } = await guardedCall(
        () => apiGet('fleet_vehicle_notes', { select: '*', vehicle_id: `eq.${id}`, order: 'created_at.desc' }),
        'تحميل الملاحظات');
      if (!ok) { listEl.innerHTML = `<div class="empty-state"><div class="e-icon">⚠️</div><p>تعذّر تحميل الملاحظات</p></div>`; return; }
      if (!notes.length) { listEl.innerHTML = `<div class="empty-state"><div class="e-icon">📝</div><p>لا يوجد ملاحظات بعد</p></div>`; return; }
      listEl.innerHTML = notes.map(n => `
        <div class="fleet-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="font-size:13px;line-height:1.6;white-space:pre-wrap;flex:1">${n.note_text}</div>
            <button class="btn-ctx-menu note-ctx-btn" type="button" data-id="${n.id}" title="إجراءات">⋮</button>
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:6px">${n.author_email} — ${new Date(n.created_at).toLocaleString('ar-KW')}</div>
        </div>`).join('');

      listEl.querySelectorAll('.note-ctx-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const note = notes.find(n => n.id === Number(btn.dataset.id));
          showCtxMenu(btn, [
            { icon: '✏️', label: 'تعديل', action: () => _editNote(note) },
            { icon: '🗑', label: 'حذف', danger: true, action: () => _deleteNote(note) },
          ]);
        };
      });
    }

    // حذف حقيقي — استثناء متعمّد لهذا الجدول بس (§sql/fleet_vehicle_notes.sql)،
    // مش باقي جداول الفليت. مفيش GRANT DELETE عليهم أصلًا، فمحاولة استخدام
    // apiDelete عليهم كانت هتفشل بخطأ صريح من القاعدة، مش سهو من الواجهة.
    async function _deleteNote(note) {
      const sure = await confirmAsync('حذف الملاحظة', 'هيتم حذف الملاحظة نهائيًا — الإجراء ده غير قابل للتراجع.', true, 'حذف');
      if (!sure) return;
      const { ok } = await guardedCall(() => apiDelete('fleet_vehicle_notes', { id: `eq.${note.id}` }), 'حذف ملاحظة');
      if (ok) { toast('تم حذف الملاحظة', 'ok'); loadNotes(); }
    }

    async function _editNote(note) {
      const fd = await openFormModal('تعديل الملاحظة', `
        <label>النص *<textarea name="note_text" required class="fleet-input" style="min-height:70px">${note.note_text}</textarea></label>
      `, { submitLabel: 'حفظ' });
      if (!fd) return;
      const text = fd.get('note_text').trim();
      if (!text) return;
      const { ok } = await guardedCall(() => apiPatch('fleet_vehicle_notes', { id: `eq.${note.id}` }, { note_text: text }), 'تعديل ملاحظة');
      if (ok) { toast('تم التعديل', 'ok'); loadNotes(); }
    }

    loadNotes();

    content.querySelector('#addNoteBtn').onclick = async () => {
      const textEl = content.querySelector('#newNoteText');
      const text = textEl.value.trim();
      if (!text) { toast('اكتب نص الملاحظة أولًا', 'warn'); return; }
      const { ok } = await guardedCall(() => apiPost('fleet_vehicle_notes', {
        vehicle_id: Number(id), note_text: text,
      }), 'إضافة ملاحظة');
      if (ok) { textEl.value = ''; toast('تمت إضافة الملاحظة', 'ok'); loadNotes(); }
    };
  }

  function _renderTab() {
    const content = document.getElementById('vehicleTabContent');
    const { periodInvoices, periodBills } = _renderKpis();

    if (ui.tab === 'summary') {
      content.innerHTML = `
        <div class="fleet-card">
          <div style="font-weight:700;margin-bottom:8px">ملخص السيارة</div>
          <div style="font-size:13px;color:var(--text2);line-height:1.8">
            ${vehicle.plate_no} — ${current ? `مؤجّرة حاليًا لـ${current.fleet_drivers?.full_name}` : 'بدون سائق حاليًا'}.
            خلال الفترة المختارة: إيراد ${fmtKWD(periodInvoices.reduce((s, i) => s + Number(i.amount), 0))}،
            مصروف ${fmtKWD(periodBills.reduce((s, b) => s + Number(b.amount), 0))}.
          </div>
        </div>`;
      return;
    }

    if (ui.tab === 'driver') {
      content.innerHTML = `
        <div class="section-header"><div class="section-title">السائق الحالي</div></div>
        <div class="fleet-card">
          ${current ? `
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <div>
                <div style="font-weight:700">${current.fleet_drivers?.full_name || '—'}</div>
                <div style="color:var(--text3);font-size:12px">رقم مدني: ${current.fleet_drivers?.civil_id || '—'} — إيجار شهري: ${current.monthly_rent ?? '—'}</div>
              </div>
              <button class="btn btn-danger btn-sm" id="endAssignmentBtn" type="button">إنهاء التعيين</button>
            </div>` : `
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="color:var(--text3)">لا يوجد سائق حاليًا</span>
              <button class="btn btn-primary btn-sm" id="newAssignmentBtn" type="button">تعيين سائق</button>
            </div>`}
        </div>
        <div class="section-header"><div class="section-title">سجل السائقين</div></div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead><tr><th>السائق</th><th>من</th><th>إلى</th><th>الإيجار الشهري</th></tr></thead>
            <tbody>
              ${assignments.length ? assignments.map(a => `
                <tr>
                  <td>${a.fleet_drivers?.full_name || '—'}</td>
                  <td>${a.start_date}</td>
                  <td>${a.end_date || '<span class="fleet-badge ok">حاليًا</span>'}</td>
                  <td>${a.monthly_rent ?? '—'}</td>
                </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text3)">لا يوجد سجل بعد</td></tr>'}
            </tbody>
          </table>
        </div>`;

      content.querySelector('#endAssignmentBtn')?.addEventListener('click', async () => {
        const sure = await confirmAsync('إنهاء التعيين', `هيتم إنهاء تعيين ${current.fleet_drivers?.full_name || 'السائق'} على السيارة دي اليوم.`, true, 'إنهاء');
        if (!sure) return;
        const { ok } = await guardedCall(() => apiPatch('fleet_assignments', { id: `eq.${current.id}` }, {
          end_date: new Date().toISOString().slice(0, 10),
        }), 'إنهاء تعيين');
        if (ok) { toast('تم إنهاء التعيين', 'ok'); refresh(); }
      });
      content.querySelector('#newAssignmentBtn')?.addEventListener('click', async () => {
        const drivers = await apiGet('fleet_drivers', { select: 'id,full_name,civil_id', status: 'eq.active', order: 'full_name.asc' });
        if (!drivers.length) { toast('لا يوجد سائقين نشطين — أضف سائق أولًا', 'warn'); return; }
        const fd = await openFormModal('تعيين سائق', `
          <label>السائق *
            <select name="driver_id" required class="fleet-input">
              ${drivers.map(d => `<option value="${d.id}">${d.full_name} — ${d.civil_id || ''}</option>`).join('')}
            </select>
          </label>
          <label>الإيجار الشهري<input name="monthly_rent" type="number" step="0.001" class="fleet-input"></label>
          <label>تاريخ البدء *<input name="start_date" type="date" required class="fleet-input" value="${new Date().toISOString().slice(0, 10)}"></label>
        `);
        if (!fd) return;
        const { ok } = await guardedCall(() => apiPost('fleet_assignments', {
          vehicle_id: Number(id), driver_id: Number(fd.get('driver_id')),
          monthly_rent: fd.get('monthly_rent') ? Number(fd.get('monthly_rent')) : null,
          start_date: fd.get('start_date'),
        }), 'تعيين سائق');
        if (ok) { toast('تم تعيين السائق', 'ok'); refresh(); }
      });
      return;
    }

    if (ui.tab === 'revenue') {
      content.innerHTML = `
        <div class="section-header">
          <div class="section-title">فواتير الإيجار</div>
          <div class="section-actions"><button class="btn btn-primary btn-sm" id="newInvoiceBtn" type="button">➕ فاتورة إيجار</button></div>
        </div>
        <div id="revenueCards"></div>`;
      _renderInvoiceCards(content.querySelector('#revenueCards'), periodInvoices);
      content.querySelector('#newInvoiceBtn').onclick = async () => {
        if (!current) { toast('لازم تعيين سائق نشط على السيارة أولًا', 'warn'); return; }
        if (await issueInvoiceFlow(id, current.driver_id, current.monthly_rent)) refresh();
      };
      return;
    }

    if (ui.tab === 'expenses') {
      content.innerHTML = `
        <div class="section-header">
          <div class="section-title">التزامات المصروفات</div>
          <div class="section-actions"><button class="btn btn-primary btn-sm" id="newBillBtn" type="button">➕ مصروف على السيارة</button></div>
        </div>
        <div id="expenseCards"></div>`;
      _renderBillCards(content.querySelector('#expenseCards'), periodBills);
      content.querySelector('#newBillBtn').onclick = async () => {
        if (await issueBillFlow(id)) refresh();
      };
      return;
    }

    if (ui.tab === 'notes') { _renderNotesTab(content); }
  }

  main.querySelectorAll('#vehicleTabs .tab').forEach(t => {
    t.onclick = () => {
      ui.tab = t.dataset.tab;
      main.querySelectorAll('#vehicleTabs .tab').forEach(x => x.classList.toggle('active', x === t));
      _renderTab();
    };
  });

  main.querySelectorAll('.period-btn').forEach(btn => {
    btn.onclick = () => {
      ui.preset = btn.dataset.preset;
      main.querySelectorAll('.period-btn').forEach(b => b.classList.toggle('active', b === btn));
      main.querySelector('#customDateWrap').style.display = ui.preset === 'custom' ? 'flex' : 'none';
      if (ui.preset !== 'custom') _renderTab();
    };
  });
  main.querySelector('#applyCustomBtn').onclick = () => {
    ui.from = main.querySelector('#periodFrom').value;
    ui.to = main.querySelector('#periodTo').value;
    _renderTab();
  };

  main.querySelector('#qaInvoiceBtn').onclick = async () => {
    if (!current) { toast('لازم تعيين سائق نشط على السيارة أولًا', 'warn'); return; }
    if (await issueInvoiceFlow(id, current.driver_id, current.monthly_rent)) refresh();
  };
  main.querySelector('#qaReceiptBtn').onclick = async () => {
    const unpaid = invoices.filter(i => Number(i.remaining_amount) > 0);
    if (!unpaid.length) { toast('لا يوجد فواتير غير مسددة', 'warn'); return; }
    let inv = unpaid[0];
    if (unpaid.length > 1) {
      const fd = await openFormModal('اختر الفاتورة', `
        <label>الفاتورة *
          <select name="invoice_id" required class="fleet-input">
            ${unpaid.map(i => `<option value="${i.id}">${i.invoice_no} — ${i.for_month.slice(0, 7)} — متبقي ${fmtKWD(i.remaining_amount)}</option>`).join('')}
          </select>
        </label>`, { submitLabel: 'التالي' });
      if (!fd) return;
      inv = unpaid.find(i => i.id === Number(fd.get('invoice_id')));
    }
    if (await settleInvoiceFlow(inv, context)) refresh();
  };
  main.querySelector('#qaBillBtn').onclick = async () => {
    if (await issueBillFlow(id)) refresh();
  };
  main.querySelector('#qaPaymentBtn').onclick = async () => {
    const unpaid = bills.filter(b => Number(b.remaining_amount) > 0);
    if (!unpaid.length) { toast('لا يوجد التزامات غير مسددة', 'warn'); return; }
    let bill = unpaid[0];
    if (unpaid.length > 1) {
      const fd = await openFormModal('اختر الالتزام', `
        <label>الالتزام *
          <select name="bill_id" required class="fleet-input">
            ${unpaid.map(b => `<option value="${b.id}">${b.bill_no} — ${b.for_month.slice(0, 7)} — متبقي ${fmtKWD(b.remaining_amount)}</option>`).join('')}
          </select>
        </label>`, { submitLabel: 'التالي' });
      if (!fd) return;
      bill = unpaid.find(b => b.id === Number(fd.get('bill_id')));
    }
    if (await settleBillFlow(bill, context)) refresh();
  };

  main.querySelector('#editVehicleBtn').onclick = async () => {
    const fd = await openFormModal('تعديل السيارة', `
      <label>رقم اللوحة *<input name="plate_no" required class="fleet-input" value="${vehicle.plate_no || ''}"></label>
      <label>رقم الشاصي<input name="chassis_no" class="fleet-input" value="${vehicle.chassis_no || ''}"></label>
      <label>الماركة<input name="make" class="fleet-input" value="${vehicle.make || ''}"></label>
      <label>الموديل<input name="model" class="fleet-input" value="${vehicle.model || ''}"></label>
      <label>السنة<input name="year" type="number" class="fleet-input" value="${vehicle.year || ''}"></label>
      <label>الحالة
        <select name="status" class="fleet-input">
          ${Object.entries(STATUS_LABEL).map(([v, s]) => `<option value="${v}" ${vehicle.status === v ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </label>
      <label>مواصفات<textarea name="specs" class="fleet-input">${vehicle.specs || ''}</textarea></label>
    `);
    if (!fd) return;
    const { ok } = await guardedCall(() => apiPatch('fleet_vehicles', { id: `eq.${id}` }, {
      plate_no: fd.get('plate_no'), chassis_no: fd.get('chassis_no') || null,
      make: fd.get('make') || null, model: fd.get('model') || null,
      year: fd.get('year') ? Number(fd.get('year')) : null,
      status: fd.get('status'), specs: fd.get('specs') || null,
    }), 'تعديل سيارة');
    if (ok) { toast('تم التعديل', 'ok'); refresh(); }
  };

  main.querySelector('#archiveVehicleBtn')?.addEventListener('click', async () => {
    const sure = await confirmAsync('أرشفة السيارة', 'هيتم تعطيل السيارة من القوائم النشطة. السجل المالي والتاريخي هيفضل محفوظ كامل.', true, 'أرشفة');
    if (!sure) return;
    const { ok } = await guardedCall(() => apiPatch('fleet_vehicles', { id: `eq.${id}` }, { status: 'archived' }), 'أرشفة سيارة');
    if (ok) { toast('تمت الأرشفة', 'ok'); refresh(); }
  });

  _renderTab();
}
