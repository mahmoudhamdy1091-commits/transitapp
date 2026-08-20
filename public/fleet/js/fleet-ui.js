// ╔══════════════════════════════════════════════════════════╗
// ║  fleet-ui.js — Toast + تأكيد + تصنيف أخطاء مركزي         ║
// ║  إعادة بناء (مش استيراد) لنمط confirmAsync/showConfirm    ║
// ║  الموجود في js/utils.js + js/reports.js — نفس التوقيع،   ║
// ║  لأن fleet لها صفحة HTML منفصلة بدون الـDOM الأصلي.       ║
// ╚══════════════════════════════════════════════════════════╝

// ── مودال نموذج عام (إضافة/تعديل سيارة/سائق/فاتورة...) ──
// يرجع Promise يتحلّل بالـFormData وقت الـsubmit، أو null لو المستخدم قفل المودال.
export function openFormModal(title, bodyHtml, { submitLabel = 'حفظ', wide = false } = {}) {
  return new Promise((resolve) => {
    document.getElementById('fleetFormModal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'fleetFormModal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100002;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
      <form id="fleetFormModalForm" style="background:var(--card);border-radius:var(--radius);padding:20px;max-width:${wide ? 560 : 420}px;width:100%;max-height:90vh;overflow:auto;font-family:Cairo,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.2)">
        <div style="font-weight:700;font-size:15px;margin-bottom:14px;color:var(--text)">${title}</div>
        <div id="fleetFormModalBody">${bodyHtml}</div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button type="button" id="fleetFormModalCancel" class="fleet-btn" style="flex:1">إلغاء</button>
          <button type="submit" class="fleet-btn primary" style="flex:1">${submitLabel}</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);

    const cleanup = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector('#fleetFormModalCancel').onclick = () => cleanup(null);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
    overlay.querySelector('#fleetFormModalForm').addEventListener('submit', (e) => {
      e.preventDefault();
      cleanup(new FormData(e.target));
    });
  });
}

export function closeFormModal() {
  document.getElementById('fleetFormModal')?.remove();
}

export function toast(msg, type = 'ok') {
  let host = document.getElementById('fleetToastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'fleetToastHost';
    host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:100000;display:flex;flex-direction:column;gap:8px';
    document.body.appendChild(host);
  }
  const colors = { ok: 'var(--green)', err: 'var(--red)', warn: 'var(--accent)' };
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `background:var(--card);border:1px solid ${colors[type] || colors.ok};color:var(--text);
    border-radius:var(--radius-sm);padding:10px 16px;font-family:Cairo,sans-serif;font-size:13px;
    box-shadow:0 4px 16px rgba(0,0,0,.15);max-width:320px`;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// طابور تأكيد بسيط — يمنع تراكم أكتر من مودال تأكيد واحد فوق بعض.
const _confirmQueue = [];
let _confirmBusy = false;

function _processConfirmQueue() {
  if (_confirmBusy || !_confirmQueue.length) return;
  _confirmBusy = true;
  const { title, msg, danger, okLabel, resolve } = _confirmQueue.shift();

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100001;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--card);border-radius:var(--radius);padding:20px;max-width:360px;width:90%;font-family:Cairo,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.2)">
      <div style="font-weight:700;font-size:15px;margin-bottom:8px;color:var(--text)">${title}</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px;line-height:1.6">${msg}</div>
      <div style="display:flex;gap:8px">
        <button id="fleetConfirmCancel" type="button" style="flex:1;padding:10px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--card2);cursor:pointer;font-family:Cairo,sans-serif;color:var(--text)">إلغاء</button>
        <button id="fleetConfirmOk" type="button" style="flex:1;padding:10px;border-radius:var(--radius-sm);border:none;cursor:pointer;font-family:Cairo,sans-serif;font-weight:700;color:#fff;background:${danger ? 'var(--red)' : 'var(--green)'}">${okLabel || (danger ? '⚠️ تأكيد' : '✅ تأكيد')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const cleanup = (result) => {
    overlay.remove();
    _confirmBusy = false;
    resolve(result);
    _processConfirmQueue();
  };
  overlay.querySelector('#fleetConfirmOk').onclick = () => cleanup(true);
  overlay.querySelector('#fleetConfirmCancel').onclick = () => cleanup(false);
}

// نفس توقيع confirmAsync(title, msg, danger, okLabel) الموجود في js/utils.js
export function confirmAsync(title, msg, danger = true, okLabel = null) {
  return new Promise((resolve) => {
    _confirmQueue.push({ title, msg, danger, okLabel, resolve });
    _processConfirmQueue();
  });
}

// ── القائمة الجانبية (Phase 7) — إعادة بناء مستقلة لنفس سلوك toggleNav/
// toggleMobileSidebar/closeMobileSidebar من js/utils.js، بدون أي import منه
// (مبدأ العزل الكامل المعتمد من أول المشروع — نفس فلسفة باقي fleet-*.js).
export function toggleNav(titleEl) {
  const items = titleEl.nextElementSibling;
  const isOpen = items.classList.contains('open');
  titleEl.classList.toggle('open', !isOpen);
  items.classList.toggle('open', !isOpen);
}

export function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  const opening = !sidebar.classList.contains('mobile-open');
  sidebar.classList.toggle('mobile-open', opening);
  document.getElementById('sidebarBackdrop')?.classList.toggle('show', opening);
}

export function closeMobileSidebar() {
  document.querySelector('.sidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebarBackdrop')?.classList.remove('show');
}

// ── تصنيف أخطاء مركزي (§10 بند 3) ──
// يفرّق بين: خطأ شبكة غير مؤكد (العملية ممكن تكون نجحت)، رفض عمل حقيقي من
// RPC (رسالة عربية واضحة من fleet_settle_invoice/fleet_void_invoice...)،
// وأي خطأ تاني غير متوقع. لا فشل صامت — كل استدعاء لازم يمر من هنا.
export function classifyAndShowError(e, context = '') {
  const msg = e?.message || String(e);
  console.error(`[fleet]${context ? ' ' + context : ''}:`, e);
  if (/انقطع الاتصال/.test(msg)) {
    toast(msg, 'warn'); // حالة معلَّقة صريحة، مش فشل مؤكد
    return 'uncertain';
  }
  toast(msg, 'err');
  return 'failed';
}

// غلاف موحَّد لأي عملية كتابة مالية (إصدار/تسوية/إلغاء) — يضمن إن كل خطأ
// يمر من التصنيف المركزي، وإن نجاح الواجهة ما يتفعّلش إلا بعد رد فعلي
// من الـbackend (§3 بند 13 — لا نجاح وهمي).
export async function guardedCall(fn, context = '') {
  try {
    const result = await fn();
    return { ok: true, result };
  } catch (e) {
    const status = classifyAndShowError(e, context);
    return { ok: false, status, error: e };
  }
}
