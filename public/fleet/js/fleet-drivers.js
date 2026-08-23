// ╔══════════════════════════════════════════════════════════╗
// ║  fleet-drivers.js — قائمة السائقين + بطاقة السائق (CRUD)   ║
// ╚══════════════════════════════════════════════════════════╝

import { apiGet, apiPost, apiPatch } from './fleet-core.js';
import { toast, confirmAsync, openFormModal, guardedCall } from './fleet-ui.js';
import { navigate } from './fleet-router.js';

function _residencyBadge(expiry) {
  if (!expiry) return '<span class="fleet-badge warn">غير مسجَّلة</span>';
  const days = Math.ceil((new Date(expiry) - new Date()) / 86400000);
  if (days < 0) return `<span class="fleet-badge err">منتهية منذ ${Math.abs(days)} يوم</span>`;
  if (days <= 30) return `<span class="fleet-badge warn">تنتهي خلال ${days} يوم</span>`;
  return `<span class="fleet-badge ok">سارية</span>`;
}

export async function renderDriversList(params, main) {
  // استبعاد fixtures الريجريشن (ZZTEST%) صراحة من الاستعلام — نفس مبدأ
  // BOX/TM التاريخي، مش الاعتماد على حالة الأرشفة بس.
  const drivers = await apiGet('fleet_drivers', { select: '*', full_name: 'not.ilike.ZZTEST*', order: 'created_at.desc' });

  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap">
      <input id="driverSearch" placeholder="بحث بالاسم أو الرقم المدني" class="fleet-btn" style="flex:1;min-width:180px;text-align:right;cursor:text">
      <button id="addDriverBtn" class="fleet-btn primary" type="button">+ سائق جديد</button>
    </div>
    <div class="fleet-card" style="padding:0;overflow:auto">
      <table class="fleet-table" id="driversTable">
        <thead><tr><th>الاسم</th><th>الرقم المدني</th><th>الهاتف</th><th>الإقامة</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>`;

  const tbody = main.querySelector('#driversTable tbody');
  function renderRows(list) {
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text3)">لا يوجد سائقين</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(d => `
      <tr style="cursor:pointer" data-id="${d.id}">
        <td data-label="الاسم">${d.full_name}</td>
        <td data-label="الرقم المدني">${d.civil_id || '—'}</td>
        <td data-label="الهاتف">${d.phone || '—'}</td>
        <td data-label="الإقامة">${_residencyBadge(d.residency_expiry)}</td>
      </tr>`).join('');
    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.onclick = () => navigate('driver', { id: tr.dataset.id });
    });
  }
  renderRows(drivers);

  main.querySelector('#driverSearch').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    renderRows(drivers.filter(d =>
      (d.full_name || '').toLowerCase().includes(q) || (d.civil_id || '').toLowerCase().includes(q)));
  };

  main.querySelector('#addDriverBtn').onclick = async () => {
    const fd = await openFormModal('سائق جديد', `
      <label>الاسم الكامل *<input name="full_name" required class="fleet-input"></label>
      <label>الرقم المدني<input name="civil_id" class="fleet-input"></label>
      <label>الهاتف<input name="phone" class="fleet-input"></label>
      <label>رقم الإقامة<input name="residency_no" class="fleet-input"></label>
      <label>تاريخ انتهاء الإقامة<input name="residency_expiry" type="date" class="fleet-input"></label>
    `);
    if (!fd) return;
    const { ok } = await guardedCall(() => apiPost('fleet_drivers', {
      full_name: fd.get('full_name'), civil_id: fd.get('civil_id') || null,
      phone: fd.get('phone') || null, residency_no: fd.get('residency_no') || null,
      residency_expiry: fd.get('residency_expiry') || null, status: 'active',
    }), 'إضافة سائق');
    if (ok) { toast('تمت إضافة السائق', 'ok'); renderDriversList(params, main); }
  };
}

export async function renderDriverDetail(params, main) {
  const id = params.id;
  const [driver] = await apiGet('fleet_drivers', { select: '*', id: `eq.${id}` });
  if (!driver) { main.innerHTML = '<div class="fleet-card">السائق غير موجود</div>'; return; }

  const assignments = await apiGet('fleet_assignments', {
    select: '*,fleet_vehicles(plate_no,make,model)', driver_id: `eq.${id}`, order: 'start_date.desc',
  });

  main.innerHTML = `
    <button class="fleet-btn" id="backBtn" type="button" style="margin-bottom:12px">→ رجوع لقائمة السائقين</button>
    <div class="fleet-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
        <div>
          <div style="font-weight:700;font-size:18px">${driver.full_name}</div>
          <div style="color:var(--text2);font-size:13px">الرقم المدني: ${driver.civil_id || '—'} — الهاتف: ${driver.phone || '—'}</div>
          <div style="color:var(--text3);font-size:12px">الإقامة: ${driver.residency_no || '—'} (${driver.residency_expiry || '—'}) ${_residencyBadge(driver.residency_expiry)}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button id="editDriverBtn" class="fleet-btn" type="button">تعديل</button>
          ${driver.status !== 'inactive' ? '<button id="archiveDriverBtn" class="fleet-btn danger" type="button">أرشفة</button>' : ''}
        </div>
      </div>
    </div>

    <div class="fleet-card">
      <div style="font-weight:700;margin-bottom:10px">السيارات المرتبطة (حاليًا وسابقًا)</div>
      <table class="fleet-table">
        <thead><tr><th>السيارة</th><th>من</th><th>إلى</th></tr></thead>
        <tbody>
          ${assignments.length ? assignments.map(a => `
            <tr style="cursor:pointer" data-vehicle-id="${a.vehicle_id}">
              <td data-label="السيارة">${a.fleet_vehicles?.plate_no || '—'} ${[a.fleet_vehicles?.make, a.fleet_vehicles?.model].filter(Boolean).join(' ')}</td>
              <td data-label="من">${a.start_date}</td>
              <td data-label="إلى">${a.end_date || '<span class="fleet-badge ok">حاليًا</span>'}</td>
            </tr>`).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--text3)">لا يوجد سيارات مرتبطة</td></tr>'}
        </tbody>
      </table>
    </div>`;

  main.querySelector('#backBtn').onclick = () => navigate('drivers');
  main.querySelectorAll('tr[data-vehicle-id]').forEach(tr => {
    tr.onclick = () => navigate('vehicle', { id: tr.dataset.vehicleId });
  });

  main.querySelector('#editDriverBtn').onclick = async () => {
    const fd = await openFormModal('تعديل السائق', `
      <label>الاسم الكامل *<input name="full_name" required class="fleet-input" value="${driver.full_name || ''}"></label>
      <label>الرقم المدني<input name="civil_id" class="fleet-input" value="${driver.civil_id || ''}"></label>
      <label>الهاتف<input name="phone" class="fleet-input" value="${driver.phone || ''}"></label>
      <label>رقم الإقامة<input name="residency_no" class="fleet-input" value="${driver.residency_no || ''}"></label>
      <label>تاريخ انتهاء الإقامة<input name="residency_expiry" type="date" class="fleet-input" value="${driver.residency_expiry || ''}"></label>
    `);
    if (!fd) return;
    const { ok } = await guardedCall(() => apiPatch('fleet_drivers', { id: `eq.${id}` }, {
      full_name: fd.get('full_name'), civil_id: fd.get('civil_id') || null,
      phone: fd.get('phone') || null, residency_no: fd.get('residency_no') || null,
      residency_expiry: fd.get('residency_expiry') || null,
    }), 'تعديل سائق');
    if (ok) { toast('تم التعديل', 'ok'); renderDriverDetail(params, main); }
  };

  main.querySelector('#archiveDriverBtn')?.addEventListener('click', async () => {
    const sure = await confirmAsync('أرشفة السائق', 'هيتم تعطيل السائق من القوائم النشطة. السجل التاريخي هيفضل محفوظ كامل.', true, 'أرشفة');
    if (!sure) return;
    const { ok } = await guardedCall(() => apiPatch('fleet_drivers', { id: `eq.${id}` }, { status: 'inactive' }), 'أرشفة سائق');
    if (ok) { toast('تمت الأرشفة', 'ok'); renderDriverDetail(params, main); }
  });
}
