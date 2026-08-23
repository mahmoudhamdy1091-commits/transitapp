// ╔══════════════════════════════════════════════════════════╗
// ║  fleet-dashboard.js — الداشبورد (كروت إحصائية + جدول السيارات║
// ║  مباشرة، زي BOX/TM بالحرف) + شاشتي الإيرادات/المصروفات      ║
// ║  (تصفح قراءة فقط عبر كل السيارات).                          ║
// ╚══════════════════════════════════════════════════════════╝

import { apiGet, fmtKWD } from './fleet-core.js';
import { navigate } from './fleet-router.js';
import { issueBillFlow } from './fleet-bills.js';
import { mountVehiclesTable } from './fleet-vehicles.js';

function _balanceBadge(paid, amount) {
  paid = Number(paid); amount = Number(amount);
  if (paid >= amount) return '<span class="fleet-badge ok">مسددة بالكامل</span>';
  if (paid > 0) return `<span class="fleet-badge warn">جزئي (${fmtKWD(amount - paid)} متبقي)</span>`;
  return '<span class="fleet-badge err">غير مسددة</span>';
}

export async function renderDashboard(params, main) {
  const currentMonthStr = new Date().toISOString().slice(0, 7) + '-01';
  const [vehicles, unpaidInvoices] = await Promise.all([
    apiGet('fleet_vehicles', { select: 'id', status: 'eq.active', plate_no: 'not.ilike.ZZTEST*' }),
    apiGet('v_invoice_balances', { select: 'for_month,remaining_amount', remaining_amount: 'gt.0' }),
  ]);
  const unpaidThisMonth = unpaidInvoices.filter(i => i.for_month === currentMonthStr).length;
  const totalOutstanding = unpaidInvoices.reduce((s, i) => s + Number(i.remaining_amount), 0);

  main.innerHTML = `
    <div class="fleet-stats-grid">
      <div class="fleet-card fleet-stat">
        <div class="fleet-stat-label">سيارات نشطة</div>
        <div class="fleet-stat-val">${vehicles.length}</div>
      </div>
      <div class="fleet-card fleet-stat">
        <div class="fleet-stat-label">فواتير غير مسددة (الشهر الحالي)</div>
        <div class="fleet-stat-val">${unpaidThisMonth}</div>
      </div>
      <div class="fleet-card fleet-stat">
        <div class="fleet-stat-label">إجمالي المتبقي على العملاء</div>
        <div class="fleet-stat-val">${fmtKWD(totalOutstanding)}</div>
      </div>
    </div>
    <div id="dashboardVehicles"></div>`;

  await mountVehiclesTable(document.getElementById('dashboardVehicles'), params);
}

// فلتر سيارة/شهر بسيط + قائمة فواتير الإيجار مع سنداتها مجمّعة تحتها، نفس
// منطق العرض في ملف السيارة (fleet-vehicles.js: _buildMonthDetail) بس عبر
// كل السيارات مع بعض. قراءة فقط عمدًا — أي تحصيل/إلغاء يفضل حصري جوه ملف
// السيارة (تصميم معتمد صراحةً، مش سهو).
export async function renderRevenueList(params, main) {
  const [vehicles, invoices] = await Promise.all([
    apiGet('fleet_vehicles', { select: 'id,plate_no,status', plate_no: 'not.ilike.ZZTEST*', order: 'plate_no.asc' }),
    apiGet('v_invoice_balances', { select: '*', order: 'for_month.desc,invoice_no.desc' }),
  ]);
  // لوحة الأسماء (plateById) من كل السيارات بلا استثناء — حتى لو أُرشِفت لاحقًا،
  // فاتورة قديمة مرتبطة بيها لازم تفضل تعرض اسمها صح. لكن قائمة الفلتر نفسها
  // بتستثني المؤرشفة (fixtures الريجريشن بتتأرشف آخر كل تشغيلة — §Phase 5)
  // عشان متظهرش جوه قائمة اختيار حقيقية تواجه المستخدم.
  const plateById = Object.fromEntries(vehicles.map(v => [String(v.id), v.plate_no]));
  const selectableVehicles = vehicles.filter(v => v.status !== 'archived');
  const months = [...new Set(invoices.map(i => i.for_month))].sort().reverse();

  main.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <select id="filterVehicle" class="fleet-input" style="width:auto">
        <option value="">كل السيارات</option>
        ${selectableVehicles.map(v => `<option value="${v.id}">${v.plate_no}</option>`).join('')}
      </select>
      <select id="filterMonth" class="fleet-input" style="width:auto">
        <option value="">كل الشهور</option>
        ${months.map(m => `<option value="${m}">${m.slice(0, 7)}</option>`).join('')}
      </select>
    </div>
    <div id="revenueListBody"></div>`;

  async function renderList() {
    const vf = main.querySelector('#filterVehicle').value;
    const mf = main.querySelector('#filterMonth').value;
    const filtered = invoices.filter(i =>
      (!vf || String(i.vehicle_id) === vf) && (!mf || i.for_month === mf));

    const body = main.querySelector('#revenueListBody');
    if (!filtered.length) {
      body.innerHTML = '<div class="fleet-card" style="text-align:center;color:var(--text3)">لا يوجد فواتير</div>';
      return;
    }
    body.innerHTML = '<div class="fleet-loading">جاري التحميل...</div>';

    const receiptsByInvoice = {};
    await Promise.all(filtered.filter(i => Number(i.paid_amount) > 0).map(async i => {
      receiptsByInvoice[i.id] = await apiGet('fleet_receipts', {
        select: '*', invoice_id: `eq.${i.id}`, post_status: 'eq.posted', order: 'receipt_date.asc',
      });
    }));

    body.innerHTML = filtered.map(i => `
      <div class="fleet-card" style="cursor:pointer" data-vehicle-id="${i.vehicle_id}">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <span style="font-weight:700">${plateById[i.vehicle_id] || '—'} — ${i.invoice_no} — ${i.for_month.slice(0, 7)}</span>
          ${_balanceBadge(i.paid_amount, i.amount)}
        </div>
        <div style="color:var(--text3);font-size:12px;margin:4px 0 8px">
          ${fmtKWD(i.amount)}${Number(i.remaining_amount) > 0 ? ' — متبقي ' + fmtKWD(i.remaining_amount) : ''}
        </div>
        ${(receiptsByInvoice[i.id] || []).length ? `
        <div style="border-top:1px solid var(--border);padding-top:6px;margin-right:14px">
          ${(receiptsByInvoice[i.id] || []).map(r => `
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text3)">
              <span>↳ سند قبض ${r.receipt_no}</span><span>${fmtKWD(r.amount)} — ${r.receipt_date}</span>
            </div>`).join('')}
        </div>` : ''}
      </div>`).join('');

    body.querySelectorAll('[data-vehicle-id]').forEach(el => {
      el.onclick = () => navigate('vehicle', { id: el.dataset.vehicleId });
    });
  }

  main.querySelector('#filterVehicle').onchange = renderList;
  main.querySelector('#filterMonth').onchange = renderList;
  renderList();
}

// مرآة renderRevenueList لجانب المصروف — التزامات + سندات صرف مجمّعة تحتها.
// اتنين مصدرها bill.vehicle_id ممكن يكون null (مصروف عمومي) — بيتعرض كـ"عمومي".
// زرار "+ مصروف عمومي" موجود هنا لأن مفيش ملف سيارة يستضيفه أصلًا (نفس السبب
// اللي كان خلّاه في الداشبورد المؤقت قبل المرحلة دي).
export async function renderExpensesList(params, main) {
  const [vehicles, bills] = await Promise.all([
    apiGet('fleet_vehicles', { select: 'id,plate_no,status', plate_no: 'not.ilike.ZZTEST*', order: 'plate_no.asc' }),
    apiGet('v_bill_balances', { select: '*', order: 'for_month.desc,bill_no.desc' }),
  ]);
  // نفس منطق renderRevenueList: لوحة الأسماء من كل السيارات، قائمة الفلتر
  // تستثني المؤرشفة فقط (يشمل fixtures الريجريشن المؤرشفة آخر كل تشغيلة).
  const plateById = Object.fromEntries(vehicles.map(v => [String(v.id), v.plate_no]));
  const selectableVehicles = vehicles.filter(v => v.status !== 'archived');
  const months = [...new Set(bills.map(b => b.for_month))].sort().reverse();

  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select id="filterVehicle" class="fleet-input" style="width:auto">
          <option value="">كل السيارات</option>
          <option value="general">مصروفات عمومية</option>
          ${selectableVehicles.map(v => `<option value="${v.id}">${v.plate_no}</option>`).join('')}
        </select>
        <select id="filterMonth" class="fleet-input" style="width:auto">
          <option value="">كل الشهور</option>
          ${months.map(m => `<option value="${m}">${m.slice(0, 7)}</option>`).join('')}
        </select>
      </div>
      <button id="newGeneralBillBtn" class="fleet-btn primary" type="button">+ مصروف عمومي</button>
    </div>
    <div id="expensesListBody"></div>`;

  async function renderList() {
    const vf = main.querySelector('#filterVehicle').value;
    const mf = main.querySelector('#filterMonth').value;
    const filtered = bills.filter(b => {
      if (vf === 'general' && b.vehicle_id) return false;
      if (vf && vf !== 'general' && String(b.vehicle_id) !== vf) return false;
      return !mf || b.for_month === mf;
    });

    const body = main.querySelector('#expensesListBody');
    if (!filtered.length) {
      body.innerHTML = '<div class="fleet-card" style="text-align:center;color:var(--text3)">لا يوجد التزامات مصروفات</div>';
      return;
    }
    body.innerHTML = '<div class="fleet-loading">جاري التحميل...</div>';

    const paymentsByBill = {};
    await Promise.all(filtered.filter(b => Number(b.paid_amount) > 0).map(async b => {
      paymentsByBill[b.id] = await apiGet('fleet_payments', {
        select: '*', bill_id: `eq.${b.id}`, post_status: 'eq.posted', order: 'payment_date.asc',
      });
    }));

    body.innerHTML = filtered.map(b => `
      <div class="fleet-card" ${b.vehicle_id ? `style="cursor:pointer" data-vehicle-id="${b.vehicle_id}"` : ''}>
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <span style="font-weight:700">${b.vehicle_id ? (plateById[b.vehicle_id] || '—') : 'مصروف عمومي'} — ${b.bill_no} — ${b.for_month.slice(0, 7)}</span>
          ${_balanceBadge(b.paid_amount, b.amount)}
        </div>
        <div style="color:var(--text3);font-size:12px;margin:4px 0 8px">
          ${fmtKWD(b.amount)}${Number(b.remaining_amount) > 0 ? ' — متبقي ' + fmtKWD(b.remaining_amount) : ''}
        </div>
        ${(paymentsByBill[b.id] || []).length ? `
        <div style="border-top:1px solid var(--border);padding-top:6px;margin-right:14px">
          ${(paymentsByBill[b.id] || []).map(p => `
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text3)">
              <span>↳ سند صرف ${p.payment_no}</span><span>${fmtKWD(p.amount)} — ${p.payment_date}</span>
            </div>`).join('')}
        </div>` : ''}
      </div>`).join('');

    body.querySelectorAll('[data-vehicle-id]').forEach(el => {
      el.onclick = () => navigate('vehicle', { id: el.dataset.vehicleId });
    });
  }

  main.querySelector('#filterVehicle').onchange = renderList;
  main.querySelector('#filterMonth').onchange = renderList;
  main.querySelector('#newGeneralBillBtn').onclick = async () => {
    const ok = await issueBillFlow(null);
    if (ok) renderExpensesList(params, main);
  };
  renderList();
}
