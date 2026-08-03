// ╔══════════════════════════════════════════════════════════╗
// ║  utils.js — UI Helpers · Modal · Toast · Format         ║
// ║  Transit Management System                               ║
// ╚══════════════════════════════════════════════════════════╝
// لا تعديلات على المنطق — نقل حرفي من app.js

// ════════════════════════════════════════
// UI HELPERS — showDashboard, hideAllViews, navActive
// ════════════════════════════════════════
// ════════════════════════════════════════
// EXPORT BUTTONS (shared across all tabs)
// ════════════════════════════════════════
// ── مخزن مؤقت لبيانات التصدير ──
window._exportStore = window._exportStore || {};

// ── شعار الشركة (TIC) — مستخدم في الفواتير والمستندات المطبوعة ──
export const TIC_LOGO_URI = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMDAgMjAwIiB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEzNSUiIHkyPSIxMzUlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6IzFDMTkxNyIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMyQzI5MjYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImxpbmUiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgICBzdHlsZT0ic3RvcC1jb2xvcjojNzg3MTZDO3N0b3Atb3BhY2l0eTowIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMjAlIiAgc3R5bGU9InN0b3AtY29sb3I6I0M4QzRCQTtzdG9wLW9wYWNpdHk6MSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjgwJSIgIHN0eWxlPSJzdG9wLWNvbG9yOiNGOUY4RjY7c3RvcC1vcGFjaXR5OjEiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojRjlGOEY2O3N0b3Atb3BhY2l0eTowLjMiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9Imdsb3ciIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgICBzdHlsZT0ic3RvcC1jb2xvcjojNDQ0MDNDO3N0b3Atb3BhY2l0eTowIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iNTAlIiAgc3R5bGU9InN0b3AtY29sb3I6IzZCNjU2MDtzdG9wLW9wYWNpdHk6MC4zIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3R5bGU9InN0b3AtY29sb3I6IzQ0NDAzQztzdG9wLW9wYWNpdHk6MCIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxmaWx0ZXIgaWQ9InNvZnQiPgogICAgICA8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIwLjgiLz4KICAgIDwvZmlsdGVyPgogICAgPGZpbHRlciBpZD0iZ2xvdy1maWx0ZXIiPgogICAgICA8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIyIiByZXN1bHQ9ImJsdXIiLz4KICAgICAgPGZlQ29tcG9zaXRlIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9ImJsdXIiIG9wZXJhdG9yPSJvdmVyIi8+CiAgICA8L2ZpbHRlcj4KICA8L2RlZnM+CgogIDwhLS0g2K7ZhNmB2YrYqSAtLT4KICA8cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgcng9IjM4IiByeT0iMzgiIGZpbGw9InVybCgjYmcpIi8+CgogIDwhLS0g2KrZiNmH2Kwg2K7ZgdmK2YEg2YHZiiDYp9mE2YXZhtiq2LXZgSAtLT4KICA8ZWxsaXBzZSBjeD0iMTAwIiBjeT0iOTUiIHJ4PSI3NSIgcnk9IjUwIiBmaWxsPSIjNDQ0MDNDIiBvcGFjaXR5PSIwLjE1Ii8+CgogIDwhLS0g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCiAgICAgICDYp9mE2LTYp9it2YbYqSDYqNiu2Lcg2YjYp9it2K8g2YXYqti12YQKICAgICAgINin2YTYrti3INmK2KjYr9ijINmF2YYg2KfZhNmK2LPYp9ixINmI2YrYtNmD2YQg2KfZhNi02KfYrdmG2KkKICAgICAgINir2YUg2YrYqtit2YjZhCDZhNit2LHZiNmBIFRJQwogIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkCAtLT4KCiAgPCEtLSDYrti3INin2YTYs9ix2LnYqSDYrtmE2YEg2KfZhNi02KfYrdmG2KkgKG1vdGlvbiBsaW5lcykgLS0+CiAgPGxpbmUgeDE9IjE0IiB5MT0iODEiIHgyPSIzNCIgeTI9IjgxIiBzdHJva2U9IiM0NDQwM0MiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8bGluZSB4MT0iMTAiIHkxPSI4OSIgeDI9IjM0IiB5Mj0iODkiIHN0cm9rZT0iIzNDMzgzNCIgc3Ryb2tlLXdpZHRoPSIxIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8bGluZSB4MT0iMTYiIHkxPSI5NyIgeDI9IjM0IiB5Mj0iOTciIHN0cm9rZT0iIzQ0NDAzQyIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgoKICA8IS0tINin2YTYtNin2K3ZhtipIOKAlCDYrti3INmI2KfYrdivINmF2KrYtdmEIC0tPgogIDwhLS0g2KfZhNmF2LPYp9ixINin2YTZg9in2YXZhCDZhNmE2LTYp9it2YbYqSAtLT4KICA8cGF0aCBkPSIKICAgIE0gMzQgOTcKICAgIEwgMzQgNzAKICAgIEwgMTAwIDcwCiAgICBMIDEwMCA1OAogICAgTCAxMjggNTgKICAgIEwgMTQwIDcwCiAgICBMIDE1NSA3MAogICAgTCAxNTUgNzYKICAgIEwgMTYwIDc2CiAgICBMIDE2MCA5NwogICAgTCAxNTUgOTcKICAgIE0gMzQgOTcKICAgIEwgMTU1IDk3CiAgIgogICAgZmlsbD0ibm9uZSIKICAgIHN0cm9rZT0idXJsKCNsaW5lKSIKICAgIHN0cm9rZS13aWR0aD0iMi4yIgogICAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogICAgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIKICAvPgoKICA8IS0tINiq2YHYp9i12YrZhCDYp9mE2LTYp9it2YbYqSDYr9in2K7ZhNmK2KkgLS0+CiAgPCEtLSDZgdin2LXZhCDYp9mE2YPYp9io2YrZhtipINmI2KfZhNi12YbYr9mI2YIgLS0+CiAgPGxpbmUgeDE9IjEwMCIgeTE9IjcwIiB4Mj0iMTAwIiB5Mj0iOTciIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC43Ii8+CgogIDwhLS0g2LLYrNin2Kwg2KfZhNmD2KfYqNmK2YbYqSAtLT4KICA8cGF0aCBkPSJNIDEwNSA2MyBMIDEyOCA2MyBMIDEzOCA3MyBMIDEwNSA3MyBaIgogICAgZmlsbD0iIzJDMjkyNiIgb3BhY2l0eT0iMC42Ii8+CiAgPHBhdGggZD0iTSAxMDUgNjMgTCAxMjggNjMgTCAxMzggNzMgTCAxMDUgNzMgWiIKICAgIGZpbGw9Im5vbmUiIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxIiBvcGFjaXR5PSIwLjUiLz4KCiAgPCEtLSDZhdi12KjYp9itINij2YXYp9mF2YogLS0+CiAgPHJlY3QgeD0iMTU2IiB5PSI4MiIgd2lkdGg9IjUiIGhlaWdodD0iNyIgcng9IjIiIGZpbGw9IiNGOUY4RjYiIG9wYWNpdHk9IjAuOSIvPgogIDwhLS0g2KPYtNi52Kkg2KfZhNiz2LHYudipINmF2YYg2KfZhNmF2LXYqNin2K0gLS0+CiAgPGxpbmUgeDE9IjE2MSIgeTE9IjgzIiB4Mj0iMTcwIiB5Mj0iNzkiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC43Ii8+CiAgPGxpbmUgeDE9IjE2MSIgeTE9Ijg2IiB4Mj0iMTcyIiB5Mj0iODUiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC42Ii8+CiAgPGxpbmUgeDE9IjE2MSIgeTE9Ijg5IiB4Mj0iMTcwIiB5Mj0iOTIiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC41Ii8+CgogIDwhLS0g2YXYtdio2KfYrSDYrtmE2YHZiiAtLT4KICA8cmVjdCB4PSIzMCIgeT0iODIiIHdpZHRoPSI1IiBoZWlnaHQ9IjciIHJ4PSIyIiBmaWxsPSIjQzAzOTJCIiBvcGFjaXR5PSIwLjgiLz4KCiAgPCEtLSDYp9mE2LnYrNmE2KfYqiDigJQg2KzYstihINmF2YYg2KfZhNiu2Lcg2KfZhNmF2KrYtdmEIC0tPgogIDwhLS0g2LnYrNmE2Kkg2K7ZhNmB2YrYqSDYo9mI2YTZiSAtLT4KICA8Y2lyY2xlIGN4PSI1NSIgY3k9Ijk3IiByPSIxMSIgZmlsbD0iIzFDMTkxNyIgc3Ryb2tlPSIjQzhDNEJBIiBzdHJva2Utd2lkdGg9IjEuOCIvPgogIDxjaXJjbGUgY3g9IjU1IiBjeT0iOTciIHI9IjUuNSIgZmlsbD0iIzJDMjkyNiIvPgogIDxjaXJjbGUgY3g9IjU1IiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINi52KzZhNipINiu2YTZgdmK2Kkg2KvYp9mG2YrYqSAtLT4KICA8Y2lyY2xlIGN4PSI4MiIgY3k9Ijk3IiByPSIxMSIgZmlsbD0iIzFDMTkxNyIgc3Ryb2tlPSIjQzhDNEJBIiBzdHJva2Utd2lkdGg9IjEuOCIvPgogIDxjaXJjbGUgY3g9IjgyIiBjeT0iOTciIHI9IjUuNSIgZmlsbD0iIzJDMjkyNiIvPgogIDxjaXJjbGUgY3g9IjgyIiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINi52KzZhNipINij2YXYp9mF2YrYqSAtLT4KICA8Y2lyY2xlIGN4PSIxNDAiIGN5PSI5NyIgcj0iMTEiIGZpbGw9IiMxQzE5MTciIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxLjgiLz4KICA8Y2lyY2xlIGN4PSIxNDAiIGN5PSI5NyIgcj0iNS41IiBmaWxsPSIjMkMyOTI2Ii8+CiAgPGNpcmNsZSBjeD0iMTQwIiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINin2YTYtNin2LPZitmHIC0tPgogIDxsaW5lIHgxPSIzNCIgeTE9IjEwNiIgeDI9IjE2MiIgeTI9IjEwNiIgc3Ryb2tlPSIjNTc1MzRFIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgoKICA8IS0tIOKVkOKVkOKVkCDYrti3INmB2KfYtdmEIOKVkOKVkOKVkCAtLT4KICA8bGluZSB4MT0iMzAiIHkxPSIxMTgiIHgyPSIxNzAiIHkyPSIxMTgiIHN0cm9rZT0idXJsKCNnbG93KSIgc3Ryb2tlLXdpZHRoPSIxIi8+CgogIDwhLS0g4pWQ4pWQ4pWQINit2LHZiNmBIFRJQyDilZDilZDilZAgLS0+CiAgPHRleHQgeD0iMTAwIiB5PSIxNTEiCiAgICBmb250LWZhbWlseT0iJ1RyZWJ1Y2hldCBNUycsICdDZW50dXJ5IEdvdGhpYycsIEZ1dHVyYSwgc2Fucy1zZXJpZiIKICAgIGZvbnQtc2l6ZT0iMjgiCiAgICBmb250LXdlaWdodD0iNzAwIgogICAgZmlsbD0iI0Y5RjhGNiIKICAgIHRleHQtYW5jaG9yPSJtaWRkbGUiCiAgICBsZXR0ZXItc3BhY2luZz0iMTAiCiAgICBzdHlsZT0iZm9udC1zdHJldGNoOmNvbmRlbnNlZCI+VElDPC90ZXh0PgoKICA8IS0tIOKVkOKVkOKVkCDYp9mE2YbYtSDYp9mE2LXYutmK2LEg4pWQ4pWQ4pWQIC0tPgogIDx0ZXh0IHg9IjEwMCIgeT0iMTcyIgogICAgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIgogICAgZm9udC1zaXplPSI4LjUiCiAgICBmaWxsPSIjQThBNDlDIgogICAgdGV4dC1hbmNob3I9Im1pZGRsZSIKICAgIGxldHRlci1zcGFjaW5nPSIyLjUiPlRSQU5TSVQgSU5URVJOQVRJT05BTCBDTy48L3RleHQ+CgogIDwhLS0g2YbZgtin2Lcg2LPYsdi52Kkg2KrYstmK2YbZitipIC0tPgogIDxjaXJjbGUgY3g9IjE4IiBjeT0iODQiIHI9IjEuMiIgZmlsbD0iIzQ0NDAzQyIgb3BhY2l0eT0iMC44Ii8+CiAgPGNpcmNsZSBjeD0iMTMiIGN5PSI5MSIgcj0iMC45IiBmaWxsPSIjM0MzODM0IiBvcGFjaXR5PSIwLjYiLz4KICA8Y2lyY2xlIGN4PSIyMCIgY3k9Ijk5IiByPSIxLjIiIGZpbGw9IiM0NDQwM0MiIG9wYWNpdHk9IjAuOCIvPgoKPC9zdmc+Cg==";

export function exportBtns(csvFn, printFn) {
  if (typeof csvFn !== 'function' || typeof printFn !== 'function') {
    console.error('exportBtns: csvFn/printFn يجب أن تكونا functions، لا نصوصاً');
    return '';
  }
  const key = '_exp_' + Math.random().toString(36).slice(2);
  window._exportStore[key] = { csv: csvFn, print: printFn };
  // على الموبايل: نضيف زر مشاركة إذا كان Web Share API متاحاً
  const isMobile = window.innerWidth <= 640;
  const canShare = isMobile && !!navigator.share && !!navigator.canShare;
  const shareBtn = canShare
    ? `<button class="btn btn-sm btn-secondary btn-share-mobile" onclick="_runExport('${key}','share')" style="color:var(--purple)">📤 إرسال</button>`
    : '';
  return `<div class="no-print export-btns-wrap" style="display:flex;gap:6px;margin-bottom:10px;justify-content:flex-end">
    <button class="btn btn-sm btn-secondary" onclick="_runExport('${key}','csv')" style="color:var(--green)">⬇️ Excel</button>
    <button class="btn btn-sm btn-secondary" onclick="_runExport('${key}','print')" style="color:var(--blue)">🖨️ PDF</button>
    ${shareBtn}
  </div>`;
}

export function _runExport(key, type) {
  const entry = window._exportStore?.[key];
  if (!entry) { toast('انتهت صلاحية الزر — أعد تحميل الجدول', 'err'); return; }
  if (type === 'share') { _shareCSV(entry.csv); return; }
  try { entry[type]?.(); }
  catch(e) { toast('خطأ: ' + e.message, 'err'); }
}

// ── مشاركة ملف CSV عبر Web Share API (واتساب / إيميل / تلغرام ...) ──
export async function _shareCSV(csvFn) {
  try {
    // ① نولّد الـ CSV أولاً (يُخزَّن في window._lastExportBlob)
    csvFn();
    const blob     = window._lastExportBlob;
    const filename = window._lastExportFilename || 'export.csv';
    if (!blob) { toast('تعذّر إنشاء الملف', 'err'); return; }

    const file = new File([blob], filename, { type: blob.type });

    // ② نحاول المشاركة عبر Web Share API
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: filename.replace(/\.\w+$/, ''),
        text:  'تصدير من تطبيق Transit International',
        files: [file],
      });
    } else {
      // fallback: تحميل مباشر (الملف اتحمّل فعلاً في الخطوة ①)
      toast('تم التحميل — يمكنك الآن مشاركة الملف يدوياً', 'ok');
    }
  } catch(e) {
    if (e.name !== 'AbortError') {
      console.warn('Web Share failed:', e.message);
      toast('تم تحميل الملف', 'ok');
    }
  }
}


export function showDashboard() {
  sessionStorage.setItem('tm_last_view','dashboard');
  hideAllViews();
  el('dashboardView').style.display = 'block';
  el('topBarTitle').textContent    = 'لوحة التحكم';
  navActive('nav-dashboard');
  state.currentFileNo = null;
  if (!dashState.from) setDashPeriod(30);
  else loadDashboard();
}

export function toggleNav(titleEl) {
  const items = titleEl.nextElementSibling;
  const isOpen = items.classList.contains('open');
  titleEl.classList.toggle('open', !isOpen);
  items.classList.toggle('open', !isOpen);
}

export function navActive(id) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (id) { const e = document.getElementById(id); if (e) e.classList.add('active'); }
}

export function setMobNav(btn) {
  document.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

export function showView(viewId) {
  const map = {
    'dashboardView': () => showDashboard(),
    'contactsView':  () => showContacts(),
    'journalView':   () => showJournal(),
    'reportsView':   () => showReports(),
  };
  if (map[viewId]) map[viewId]();
  else { hideAllViews(); const e = el(viewId); if(e) e.style.display=''; }
}

export function hideAllViews() {
  // ✅ استعلام ديناميكي بدل array يدوي — أي view جديد (div مباشر جوه
  // .content-area باسم منتهٍ بـ "View") يتخفي تلقائياً، من غير تعديل هنا.
  // [id$="View"] يستثني عناصر زي #approvalDetailModal (sibling مش view).
  document.querySelectorAll('.content-area > div[id$="View"]').forEach(e => {
    e.style.display    = 'none';
    e.style.opacity    = '';
    e.style.transform  = '';
    e.style.transition = '';
  });
  // تطبيق صلاحيات المستخدم عند كل تنقل
  if (typeof applyRoleRestrictions === 'function') applyRoleRestrictions();
}

// ════════════════════════════════════════
// MODAL DIRTY TRACKING — تحذير بيانات غير محفوظة
// ════════════════════════════════════════
const _modalDirty  = new Map();
const _modalSaving = new Set();

export function openModal(id) {
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

export async function closeModal(id) {
  if (_modalDirty.get(id) && !_modalSaving.has(id)) {
    const ok = await confirmAsync('⚠️ بيانات غير محفوظة', 'توجد بيانات غير محفوظة — هل تريد الخروج بدون حفظ؟', true);
    if (!ok) return;
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

export function markSaving(id) { _modalSaving.add(id); }

// ✅ اختبار فقط — _modalDirty خاص بهذه الوحدة (module-private)، ما فيش طريقة
// تانية لضبطه من سويت الانحدار headless (addEventListener الحقيقي بتاع تتبّع
// الـdirty مش قابل للتفعيل في بيئة الاختبار — راجع scripts/_headless-app-env.js).
// بتُختبَر هنا نفس فرع القرار الحقيقي جوه closeModal، بس التحضير المسبق لحالة
// "dirty" بيتم مباشرة بدل محاكاة حدث input/change كامل عبر DOM حقيقي غير متاح.
export function __setModalDirtyForTest(id, val) { _modalDirty.set(id, val); }

// ════════════════════════════════════════
// SUBMIT GUARD — منع تنفيذ نفس الأمر مرتين عند ضغط الزر أكثر من مرة
// ════════════════════════════════════════
const _submitInFlight = new Set();
export function guardSubmit(btn, fn) {
  const key = btn?.id || fn.name;
  if (_submitInFlight.has(key)) return;
  _submitInFlight.add(key);
  if (btn) btn.disabled = true;
  Promise.resolve(fn()).finally(() => {
    _submitInFlight.delete(key);
    if (btn) btn.disabled = false;
  });
}

// ════════════════════════════════════════
// CORE UTILS
// ════════════════════════════════════════
export function el(id) { return document.getElementById(id); }

export function fmt(n, decimals=2) {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString('en-GB', { year:'numeric', month:'short', day:'numeric' });
}

// وقت فقط (ساعة:دقيقة) — يُستخدم بجانب fmtDate لإظهار وقت تسجيل العملية الفعلي
export function fmtTime(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date)) return '';
  return date.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}

export function today() {
  return new Date().toISOString().split('T')[0];
}

export function statusClass(s) {
  if (!s) return 'open';
  if (s === 'OPEN') return 'open';
  if (s === 'IN PROGRESS') return 'progress';
  if (s === 'CLOSED') return 'closed';
  return 'open';
}

export function emptyHTML(icon, msg) {
  return `<div class="empty-state"><div class="e-icon">${icon}</div><p>${msg}</p></div>`;
}

export function errHTML(msg) {
  return `<div class="alert alert-err" style="margin:16px">⚠️ ${msg}</div>`;
}

export function showFieldErr(elId, msg) {
  const e = el(elId);
  e.textContent = '⚠️ ' + msg;
  e.style.display = 'flex';
}

export function showErr(id, msg) {
  el(id).innerHTML = `<div class="alert alert-err" style="margin:16px">⚠️ ${msg}</div>`;
}

// ════════════════════════════════════════
// TOAST
// ════════════════════════════════════════
let toastTimer;
export function toast(msg, type='ok') {
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
export function animateCount(el, targetStr, color) {
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
export function setLoading(id, msg='جاري التحميل...') {
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
export function switchView(showId, title, sub='') {
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

// ── ROLES & PERMISSIONS: نُقلت ROLES/_currentRole/can() إلى permissions.js (Phase 1) ──

// ── ⋮ CONTEXT MENU: نُقل محرك القائمة وكل بُناتها إلى context-menus.js (Phase 1) ──

// ════════════════════════════════════════
// CONFIRM DIALOG — تأكيد الإجراء
// ════════════════════════════════════════
export function confirmAction(title, msg, onConfirm, danger = true) {
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
// CONFIRM (async) — نسخة Promise من confirmAction، لاستبدال confirm()/alert()
// الأصلية المتزامنة (بديل حقيقي — بلا حجب لخيط التنفيذ، وقابل للاختبار الآلي
// بعكس confirm() الأصلية). تُبنى فوق showConfirm نفسها بلا أي تعديل عليها —
// الـ45 نداء الحالي لـshowConfirm/confirmAction يفضلوا يشتغلوا بالضبط زي ما هما.
// ✅ زرار "إلغاء" في confirmDeleteModal (index.html) ما بيبعتش أي إشارة "اتلغى"
// حاليًا (بيقفل المودال بس) — بنلف عليه هنا مؤقتًا لكل نداء (نفس أسلوب
// showConfirm نفسها مع زرار التأكيد: onclick يُعاد كتابته من جديد في كل نداء،
// بلا أي آلية طابور — نداءان متتاليان بلا انتظار الأول ممكن يتضاربوا، بس ده
// نفس القيد الموجود أصلاً في showConfirm، مش قيد جديد)
export function confirmAsync(title, msg, danger = true, okLabel = null) {
  return new Promise(resolve => {
    if (typeof showConfirm !== 'function') { resolve(false); return; }
    showConfirm(title, msg, () => resolve(true));
    const okBtn = document.getElementById('confirmDeleteOkBtn');
    if (okBtn) {
      okBtn.textContent = okLabel || (danger ? '⚠️ تأكيد' : '✅ تأكيد');
      okBtn.style.background = danger ? 'var(--red)' : 'var(--green)';
    }
    const cancelBtn = document.getElementById('confirmDeleteCancelBtn');
    if (cancelBtn) {
      cancelBtn.onclick = () => { closeModal('confirmDeleteModal'); resolve(false); };
    }
  });
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── CTX MENU REGISTRY + BUILDERS: نُقلت كلها إلى context-menus.js (Phase 1) ──

// ── window bridge: تعريض الدوال للاستخدام من classic scripts وسمات onclick ──
Object.assign(window, {
  exportBtns, _runExport, _shareCSV, showDashboard, toggleNav, navActive, setMobNav,
  showView, hideAllViews, openModal, closeModal, markSaving, guardSubmit, el,
  fmt, fmtDate, fmtTime, today, statusClass, emptyHTML, errHTML, showFieldErr,
  showErr, toast, animateCount, setLoading, switchView, confirmAction, confirmAsync, loadScript,
  TIC_LOGO_URI,
});
