// ╔══════════════════════════════════════════════════════════════════════╗
// ║  print.js — Unified Print Module · Transit Cars Management System   ║
// ║  v3 — Fixed: single renderer · scoped CSS · no DOCTYPE in div       ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// ── ARCHITECTURE ──────────────────────────────────────────────────────
//   renderPrint(fragment, title) — SINGLE renderer used by ALL functions
//   Opens an isolated print window so:
//   • @page rules work correctly (real document context)
//   • CSS scoped to .print-root never leaks to app
//   • Google Fonts load once from <head> of real document
//   • window.print() targets the right document
//
// ── COMPATIBILITY ALIASES (kept so all existing callers never break) ───
//   openPrintOverlay(html, title) → renderPrint(html, title)
//   closePrintOverlay()           → closes print window if open
//   printDocument(html, title)    → renderPrint(html, title)
//
// ── DEPENDENCIES ──────────────────────────────────────────────────────
//   state, apiGetAll, apiGet, ensureCache  → core.js
//   fmt(), el()                            → utils.js
//   getPartnerDealBalance()                → engine.js
//   loadDealStatement()                    → settings module
//   sendWhatsappInvoice()                  → utils/whatsapp
//   window._ledger*, window._dealStatement*→ set by caller modules
//   toast()                                → utils.js
// ══════════════════════════════════════════════════════════════════════

'use strict';

// ─── Keep reference to last print window for closePrintOverlay ────────
let _printWin = null;

// ════════════════════════════════════════════════════════════
// PRINT_CSS — Single scoped stylesheet for ALL documents
// Scoped to .print-root — zero leakage to app
// Table-based layout only — no grid/flex in structural elements
// @page defined ONCE at top level — not inside @media print
// ════════════════════════════════════════════════════════════
const PRINT_CSS = `
/* ── @page — single global definition ──────────────────── */
@page           { size: A4 portrait;  margin: 14mm 12mm; orphans: 3; widows: 3; }
@page landscape { size: A4 landscape; margin: 12mm 10mm; }

/* ── Scoped reset ───────────────────────────────────────── */
.print-root *, .print-root *::before, .print-root *::after {
  box-sizing: border-box; margin: 0; padding: 0;
}
.print-root {
  font-family: 'Cairo', Arial, sans-serif;
  color: #1a1a1a; font-size: 12px; direction: rtl;
  background: #fff; line-height: 1.5;
}
.print-page { max-width: 740px; margin: 0 auto; padding: 24px 28px; }

/* ══ HEADER — table layout (stable in all print engines) ══ */
.doc-header {
  display: table; width: 100%; table-layout: fixed;
  border-bottom: 3px solid #1a1a1a;
  padding-bottom: 14px; margin-bottom: 20px; border-collapse: collapse;
}
.doc-header-right {
  display: table-cell; text-align: right; vertical-align: top; width: 55%;
}
.doc-header-left {
  display: table-cell; text-align: left; vertical-align: top; width: 45%;
}
.doc-logo        { width: 72px; height: 72px; border-radius: 14px; display: block; margin-bottom: 8px; }
.doc-company     { font-size: 18px; font-weight: 800; }
.doc-company-sub { font-size: 11px; color: #888; margin-top: 2px; }
.doc-title       { font-size: 22px; font-weight: 800; }
.doc-subtitle    { font-size: 12px; color: #666; margin-top: 3px; }
.doc-ref         { font-size: 13px; font-weight: 700; color: #3C3834; margin-top: 4px; font-family: monospace, 'Cairo', Arial; }

/* ══ INFO GRID — 2-column table ════════════════════════════ */
.info-grid {
  display: table; width: 100%; table-layout: fixed;
  border-spacing: 8px 0; border-collapse: separate; margin-bottom: 18px;
}
.info-cell {
  display: table-cell; background: #f8f9fa; border-radius: 6px;
  padding: 10px 14px; border: 1px solid #eee; vertical-align: top; width: 50%;
}
.info-cell-title {
  font-size: 10px; font-weight: 700; color: #888;
  text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;
}
.info-row {
  display: table; width: 100%; table-layout: fixed;
  padding: 3px 0; font-size: 11px; border-bottom: 1px solid #eee;
}
.info-row:last-child { border-bottom: none; }
.info-lbl { display: table-cell; color: #666; width: 55%; }
.info-val { display: table-cell; font-weight: 600; color: #1a1a1a; text-align: left; width: 45%; }

/* ══ TABLES ════════════════════════════════════════════════ */
.print-root table {
  width: 100%; border-collapse: collapse; margin: 10px 0;
  font-size: 11px; table-layout: fixed;
}
.print-root thead              { display: table-header-group; }
.print-root thead tr           { background: #1a1a1a; color: #fff; }
.print-root thead th           { padding: 8px 10px; text-align: right; font-weight: 700; font-size: 11px; word-break: break-word; }
.print-root tbody              { display: table-row-group; }
.print-root tbody tr           { border-bottom: 1px solid #eee; page-break-inside: avoid; }
.print-root tbody tr:nth-child(even) { background: #fafafa; }
.print-root tbody td           { padding: 7px 10px; vertical-align: middle; word-break: break-word; }
.print-root tfoot              { display: table-footer-group; }
.print-root tfoot tr           { background: #f0f0f0; font-weight: 700; }
.print-root tfoot td           { padding: 8px 10px; border-top: 2px solid #1a1a1a; }
.print-root .num, .print-root td.num, .print-root th.num {
  text-align: left; font-family: monospace, 'Cairo', Arial; direction: ltr;
}

/* ══ KPI ROW — table layout ════════════════════════════════ */
.kpi-row {
  display: table; width: 100%; table-layout: fixed;
  border-spacing: 8px 0; border-collapse: separate; margin: 12px 0;
}
.kpi-cell {
  display: table-cell; background: #f8f9fa; border-radius: 6px;
  padding: 10px 14px; border-right: 3px solid #3C3834; vertical-align: top;
}
.kpi-label { font-size: 10px; color: #666; margin-bottom: 3px; }
.kpi-val   { font-size: 15px; font-weight: 700; font-family: monospace, 'Cairo', Arial; }

/* ══ SUMMARY ROW — table layout ════════════════════════════ */
.summary-row {
  display: table; width: 100%; table-layout: fixed;
  border-spacing: 8px 0; border-collapse: separate; margin-bottom: 14px;
}
.s-cell       { display: table-cell; background: #f8f9fa; border-radius: 8px; padding: 10px 16px; vertical-align: top; }
.s-cell-label { font-size: 10px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
.s-cell-val   { font-size: 15px; font-weight: 900; margin-top: 3px; font-family: monospace, 'Cairo', Arial; }

/* ══ TOTAL BOX ══════════════════════════════════════════════ */
.total-wrap   { text-align: left; margin-bottom: 20px; }
.total-box    { display: inline-block; background: #1a1a1a; color: #fff; border-radius: 10px; padding: 16px 24px; min-width: 240px; text-align: center; }
.total-label  { font-size: 11px; color: #aaa; margin-bottom: 3px; }
.total-amount { font-size: 24px; font-weight: 900; font-family: monospace, 'Cairo', Arial; }
.total-cur    { font-size: 12px; color: #aaa; margin-top: 2px; }
.total-sub    { display: table; width: 100%; table-layout: fixed; font-size: 11px; color: #aaa; padding: 3px 0; border-top: 1px solid #444; margin-top: 6px; padding-top: 6px; }

/* ══ SIGNATURE ROW — table layout ══════════════════════════ */
.sig-row {
  display: table; width: 100%; table-layout: fixed;
  border-spacing: 24px 0; border-collapse: separate; margin-top: 28px;
}
.sig-cell {
  display: table-cell; text-align: center; padding-top: 40px;
  border-top: 1px solid #ccc; font-size: 11px; color: #888; vertical-align: top;
}

/* ══ UTILITY ════════════════════════════════════════════════ */
.section-title { font-size: 13px; font-weight: 700; color: #1a1a1a; margin: 16px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #3C3834; page-break-after: avoid; }
.notes-box     { background: #f8f9fa; border-radius: 8px; padding: 12px 16px; margin-bottom: 18px; }
.notes-title   { font-size: 10px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
.doc-footer    { text-align: center; font-size: 10px; color: #999; margin-top: 24px; padding-top: 10px; border-top: 1px solid #eee; }
.contact-badge { display: inline-block; border-radius: 4px; padding: 2px 8px; font-size: 10px; font-weight: 700; margin-right: 6px; }
.c-green { color: #16a34a; } .c-red  { color: #dc2626; }
.c-blue  { color: #2563eb; } .c-amber{ color: #3C3834; }
.c-ok    { font-size: 11px; color: #16a34a; }
.no-print { /* hidden in print */ }
/* إخفاء أزرار الإجراءات والـ ctx menu عند الطباعة */
.btn-ctx-menu { display: none !important; }
/* تعريف CSS variables للطباعة (fallback من var(--x) ) */
.print-root { --green:#16a34a; --red:#dc2626; --blue:#2563eb; --accent:#3C3834;
              --cyan:#0891b2; --purple:#7c3aed; --amber:#3C3834; --text2:#57534E;
              --text3:#9ca3af; --card2:#f9fafb; --border:#e5e7eb; }

/* ════════════════════════════════════════════════════════════
   @media print — Chrome/Firefox final overrides
   ════════════════════════════════════════════════════════════ */
@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .no-print { display: none !important; }
  .print-page { max-width: 100%; padding: 0; margin: 0; }
  .print-root { font-size: 11px; }
  .print-root table { font-size: 10px; table-layout: fixed; width: 100%; }
  .print-root tr    { page-break-inside: avoid; }
  .print-root thead { display: table-header-group; }
  .print-root tfoot { display: table-footer-group; }
  .kpi-row, .info-grid, .summary-row { border-spacing: 4px 0; }
  .sig-row  { border-spacing: 16px 0; }
  .total-box, .notes-box, .sig-row, .doc-header { page-break-inside: avoid; }
  .section-title { page-break-after: avoid; }
  .print-root tbody tr:nth-child(even) { background: #fafafa !important; }
}
`;

// ════════════════════════════════════════════════════════════
// CORE: renderPrint — SINGLE renderer for ALL documents
// ════════════════════════════════════════════════════════════

function renderPrint(fragment, title) {
  const win = window.open('', '_blank', 'width=860,height=700,scrollbars=yes');
  if (!win) { _renderOverlay(fragment, title); return; }
  _printWin = win;
  win.document.open();
  win.document.write('<!DOCTYPE html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>' + (title||'طباعة') + '</title>\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">\n<style>\n' + PRINT_CSS + '\n</style>\n</head>\n<body>\n<div class="print-root">\n<div class="no-print" style="text-align:center;padding:12px;background:#f8f9fa;border-bottom:2px solid #e5e7eb">\n<button onclick="window.print()" style="background:#1a1a1a;color:#fff;border:none;padding:9px 28px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:\'Cairo\',Arial,sans-serif;margin-left:8px">\u{1F5A8}\uFE0F \u0637\u0628\u0627\u0639\u0629</button>\n<button onclick="window.close()" style="background:#f1f1f1;color:#333;border:1px solid #ddd;padding:9px 20px;border-radius:8px;font-size:13px;cursor:pointer;font-family:\'Cairo\',Arial,sans-serif">\u2715 \u0625\u063A\u0644\u0627\u0642</button>\n</div>\n<div class="print-page">\n' + fragment + '\n</div>\n</div>\n</body>\n</html>');
  win.document.close();
  win.focus();
}

function _renderOverlay(fragment, title) {
  const o = document.getElementById('printOverlay');
  const b = document.getElementById('printOverlayBody');
  const t = document.getElementById('printOverlayTitle');
  if (!o || !b) { alert('\u064A\u0631\u062C\u0649 \u0627\u0644\u0633\u0645\u0627\u062D \u0628\u0627\u0644\u0646\u0648\u0627\u0641\u0630 \u0627\u0644\u0645\u0646\u0628\u062B\u0642\u0629 \u0644\u0625\u062A\u0645\u0627\u0645 \u0627\u0644\u0637\u0628\u0627\u0639\u0629'); return; }
  if (t) t.textContent = title || '\u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u0637\u0628\u0627\u0639\u0629';
  b.innerHTML = '<style>.print-root{all:initial;font-family:\'Cairo\',Arial,sans-serif;direction:rtl}' + PRINT_CSS + '</style><div class="print-root"><div class="print-page">' + fragment + '</div></div>';
  o.style.display = 'block';
  document.body.style.overflow = 'hidden';
}

// ── Compatibility aliases ─────────────────────────────────
function openPrintOverlay(html, title)  { renderPrint(html, title); }
function closePrintOverlay()            { if (_printWin) { try { _printWin.close(); } catch(e){} _printWin = null; } const o = document.getElementById('printOverlay'); if (o) o.style.display = 'none'; document.body.style.overflow = ''; }
function printDocument(html, title)     { renderPrint(html, title); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePrintOverlay(); });

// PRINT_STYLES alias for any legacy reference
const PRINT_STYLES = PRINT_CSS;

// ════════════════════════════════════════════════════════════
// SECTION 2 — Shared document header builder
// ════════════════════════════════════════════════════════════
function docHeader(title, subtitle, fileNo) {
  return `
  <div class="doc-header">
    <div class="doc-header-right">
      <img class="doc-logo" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMDAgMjAwIiB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEzNSUiIHkyPSIxMzUlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6IzFDMTkxNyIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMyQzI5MjYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImxpbmUiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgICBzdHlsZT0ic3RvcC1jb2xvcjojNzg3MTZDO3N0b3Atb3BhY2l0eTowIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMjAlIiAgc3R5bGU9InN0b3AtY29sb3I6I0M4QzRCQTtzdG9wLW9wYWNpdHk6MSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjgwJSIgIHN0eWxlPSJzdG9wLWNvbG9yOiNGOUY4RjY7c3RvcC1vcGFjaXR5OjEiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojRjlGOEY2O3N0b3Atb3BhY2l0eTowLjMiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9Imdsb3ciIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgICBzdHlsZT0ic3RvcC1jb2xvcjojNDQ0MDNDO3N0b3Atb3BhY2l0eTowIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iNTAlIiAgc3R5bGU9InN0b3AtY29sb3I6IzZCNjU2MDtzdG9wLW9wYWNpdHk6MC4zIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3R5bGU9InN0b3AtY29sb3I6IzQ0NDAzQztzdG9wLW9wYWNpdHk6MCIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxmaWx0ZXIgaWQ9InNvZnQiPgogICAgICA8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIwLjgiLz4KICAgIDwvZmlsdGVyPgogICAgPGZpbHRlciBpZD0iZ2xvdy1maWx0ZXIiPgogICAgICA8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIyIiByZXN1bHQ9ImJsdXIiLz4KICAgICAgPGZlQ29tcG9zaXRlIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9ImJsdXIiIG9wZXJhdG9yPSJvdmVyIi8+CiAgICA8L2ZpbHRlcj4KICA8L2RlZnM+CgogIDwhLS0g2K7ZhNmB2YrYqSAtLT4KICA8cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgcng9IjM4IiByeT0iMzgiIGZpbGw9InVybCgjYmcpIi8+CgogIDwhLS0g2KrZiNmH2Kwg2K7ZgdmK2YEg2YHZiiDYp9mE2YXZhtiq2LXZgSAtLT4KICA8ZWxsaXBzZSBjeD0iMTAwIiBjeT0iOTUiIHJ4PSI3NSIgcnk9IjUwIiBmaWxsPSIjNDQ0MDNDIiBvcGFjaXR5PSIwLjE1Ii8+CgogIDwhLS0g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCiAgICAgICDYp9mE2LTYp9it2YbYqSDYqNiu2Lcg2YjYp9it2K8g2YXYqti12YQKICAgICAgINin2YTYrti3INmK2KjYr9ijINmF2YYg2KfZhNmK2LPYp9ixINmI2YrYtNmD2YQg2KfZhNi02KfYrdmG2KkKICAgICAgINir2YUg2YrYqtit2YjZhCDZhNit2LHZiNmBIFRJQwogIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkCAtLT4KCiAgPCEtLSDYrti3INin2YTYs9ix2LnYqSDYrtmE2YEg2KfZhNi02KfYrdmG2KkgKG1vdGlvbiBsaW5lcykgLS0+CiAgPGxpbmUgeDE9IjE0IiB5MT0iODEiIHgyPSIzNCIgeTI9IjgxIiBzdHJva2U9IiM0NDQwM0MiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8bGluZSB4MT0iMTAiIHkxPSI4OSIgeDI9IjM0IiB5Mj0iODkiIHN0cm9rZT0iIzNDMzgzNCIgc3Ryb2tlLXdpZHRoPSIxIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8bGluZSB4MT0iMTYiIHkxPSI5NyIgeDI9IjM0IiB5Mj0iOTciIHN0cm9rZT0iIzQ0NDAzQyIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgoKICA8IS0tINin2YTYtNin2K3ZhtipIOKAlCDYrti3INmI2KfYrdivINmF2KrYtdmEIC0tPgogIDwhLS0g2KfZhNmF2LPYp9ixINin2YTZg9in2YXZhCDZhNmE2LTYp9it2YbYqSAtLT4KICA8cGF0aCBkPSIKICAgIE0gMzQgOTcKICAgIEwgMzQgNzAKICAgIEwgMTAwIDcwCiAgICBMIDEwMCA1OAogICAgTCAxMjggNTgKICAgIEwgMTQwIDcwCiAgICBMIDE1NSA3MAogICAgTCAxNTUgNzYKICAgIEwgMTYwIDc2CiAgICBMIDE2MCA5NwogICAgTCAxNTUgOTcKICAgIE0gMzQgOTcKICAgIEwgMTU1IDk3CiAgIgogICAgZmlsbD0ibm9uZSIKICAgIHN0cm9rZT0idXJsKCNsaW5lKSIKICAgIHN0cm9rZS13aWR0aD0iMi4yIgogICAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogICAgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIKICAvPgoKICA8IS0tINiq2YHYp9i12YrZhCDYp9mE2LTYp9it2YbYqSDYr9in2K7ZhNmK2KkgLS0+CiAgPCEtLSDZgdin2LXZhCDYp9mE2YPYp9io2YrZhtipINmI2KfZhNi12YbYr9mI2YIgLS0+CiAgPGxpbmUgeDE9IjEwMCIgeTE9IjcwIiB4Mj0iMTAwIiB5Mj0iOTciIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC43Ii8+CgogIDwhLS0g2LLYrNin2Kwg2KfZhNmD2KfYqNmK2YbYqSAtLT4KICA8cGF0aCBkPSJNIDEwNSA2MyBMIDEyOCA2MyBMIDEzOCA3MyBMIDEwNSA3MyBaIgogICAgZmlsbD0iIzJDMjkyNiIgb3BhY2l0eT0iMC42Ii8+CiAgPHBhdGggZD0iTSAxMDUgNjMgTCAxMjggNjMgTCAxMzggNzMgTCAxMDUgNzMgWiIKICAgIGZpbGw9Im5vbmUiIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxIiBvcGFjaXR5PSIwLjUiLz4KCiAgPCEtLSDZhdi12KjYp9itINij2YXYp9mF2YogLS0+CiAgPHJlY3QgeD0iMTU2IiB5PSI4MiIgd2lkdGg9IjUiIGhlaWdodD0iNyIgcng9IjIiIGZpbGw9IiNGOUY4RjYiIG9wYWNpdHk9IjAuOSIvPgogIDwhLS0g2KPYtNi52Kkg2KfZhNiz2LHYudipINmF2YYg2KfZhNmF2LXYqNin2K0gLS0+CiAgPGxpbmUgeDE9IjE2MSIgeTE9IjgzIiB4Mj0iMTcwIiB5Mj0iNzkiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC43Ii8+CiAgPGxpbmUgeDE9IjE2MSIgeTE9Ijg2IiB4Mj0iMTcyIiB5Mj0iODUiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC42Ii8+CiAgPGxpbmUgeDE9IjE2MSIgeTE9Ijg5IiB4Mj0iMTcwIiB5Mj0iOTIiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC41Ii8+CgogIDwhLS0g2YXYtdio2KfYrSDYrtmE2YHZiiAtLT4KICA8cmVjdCB4PSIzMCIgeT0iODIiIHdpZHRoPSI1IiBoZWlnaHQ9IjciIHJ4PSIyIiBmaWxsPSIjQzAzOTJCIiBvcGFjaXR5PSIwLjgiLz4KCiAgPCEtLSDYp9mE2LnYrNmE2KfYqiDigJQg2KzYstihINmF2YYg2KfZhNiu2Lcg2KfZhNmF2KrYtdmEIC0tPgogIDwhLS0g2LnYrNmE2Kkg2K7ZhNmB2YrYqSDYo9mI2YTZiSAtLT4KICA8Y2lyY2xlIGN4PSI1NSIgY3k9Ijk3IiByPSIxMSIgZmlsbD0iIzFDMTkxNyIgc3Ryb2tlPSIjQzhDNEJBIiBzdHJva2Utd2lkdGg9IjEuOCIvPgogIDxjaXJjbGUgY3g9IjU1IiBjeT0iOTciIHI9IjUuNSIgZmlsbD0iIzJDMjkyNiIvPgogIDxjaXJjbGUgY3g9IjU1IiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINi52KzZhNipINiu2YTZgdmK2Kkg2KvYp9mG2YrYqSAtLT4KICA8Y2lyY2xlIGN4PSI4MiIgY3k9Ijk3IiByPSIxMSIgZmlsbD0iIzFDMTkxNyIgc3Ryb2tlPSIjQzhDNEJBIiBzdHJva2Utd2lkdGg9IjEuOCIvPgogIDxjaXJjbGUgY3g9IjgyIiBjeT0iOTciIHI9IjUuNSIgZmlsbD0iIzJDMjkyNiIvPgogIDxjaXJjbGUgY3g9IjgyIiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINi52KzZhNipINij2YXYp9mF2YrYqSAtLT4KICA8Y2lyY2xlIGN4PSIxNDAiIGN5PSI5NyIgcj0iMTEiIGZpbGw9IiMxQzE5MTciIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxLjgiLz4KICA8Y2lyY2xlIGN4PSIxNDAiIGN5PSI5NyIgcj0iNS41IiBmaWxsPSIjMkMyOTI2Ii8+CiAgPGNpcmNsZSBjeD0iMTQwIiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINin2YTYtNin2LPZitmHIC0tPgogIDxsaW5lIHgxPSIzNCIgeTE9IjEwNiIgeDI9IjE2MiIgeTI9IjEwNiIgc3Ryb2tlPSIjNTc1MzRFIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgoKICA8IS0tIOKVkOKVkOKVkCDYrti3INmB2KfYtdmEIOKVkOKVkOKVkCAtLT4KICA8bGluZSB4MT0iMzAiIHkxPSIxMTgiIHgyPSIxNzAiIHkyPSIxMTgiIHN0cm9rZT0idXJsKCNnbG93KSIgc3Ryb2tlLXdpZHRoPSIxIi8+CgogIDwhLS0g4pWQ4pWQ4pWQINit2LHZiNmBIFRJQyDilZDilZDilZAgLS0+CiAgPHRleHQgeD0iMTAwIiB5PSIxNTEiCiAgICBmb250LWZhbWlseT0iJ1RyZWJ1Y2hldCBNUycsICdDZW50dXJ5IEdvdGhpYycsIEZ1dHVyYSwgc2Fucy1zZXJpZiIKICAgIGZvbnQtc2l6ZT0iMjgiCiAgICBmb250LXdlaWdodD0iNzAwIgogICAgZmlsbD0iI0Y5RjhGNiIKICAgIHRleHQtYW5jaG9yPSJtaWRkbGUiCiAgICBsZXR0ZXItc3BhY2luZz0iMTAiCiAgICBzdHlsZT0iZm9udC1zdHJldGNoOmNvbmRlbnNlZCI+VElDPC90ZXh0PgoKICA8IS0tIOKVkOKVkOKVkCDYp9mE2YbYtSDYp9mE2LXYutmK2LEg4pWQ4pWQ4pWQIC0tPgogIDx0ZXh0IHg9IjEwMCIgeT0iMTcyIgogICAgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIgogICAgZm9udC1zaXplPSI4LjUiCiAgICBmaWxsPSIjQThBNDlDIgogICAgdGV4dC1hbmNob3I9Im1pZGRsZSIKICAgIGxldHRlci1zcGFjaW5nPSIyLjUiPlRSQU5TSVQgSU5URVJOQVRJT05BTCBDTy48L3RleHQ+CgogIDwhLS0g2YbZgtin2Lcg2LPYsdi52Kkg2KrYstmK2YbZitipIC0tPgogIDxjaXJjbGUgY3g9IjE4IiBjeT0iODQiIHI9IjEuMiIgZmlsbD0iIzQ0NDAzQyIgb3BhY2l0eT0iMC44Ii8+CiAgPGNpcmNsZSBjeD0iMTMiIGN5PSI5MSIgcj0iMC45IiBmaWxsPSIjM0MzODM0IiBvcGFjaXR5PSIwLjYiLz4KICA8Y2lyY2xlIGN4PSIyMCIgY3k9Ijk5IiByPSIxLjIiIGZpbGw9IiM0NDQwM0MiIG9wYWNpdHk9IjAuOCIvPgoKPC9zdmc+Cg==" alt="TIC">
      <div class="doc-company">Transit International Company</div>
      <div class="doc-company-sub" style="margin-top:4px;color:#999">تاريخ الطباعة: ${new Date().toLocaleDateString('en-GB')}</div>
    </div>
    <div class="doc-header-left">
      <div class="doc-title">${title}</div>
      ${subtitle ? `<div class="doc-subtitle">${subtitle}</div>` : ''}
      ${fileNo   ? `<div class="doc-ref"># ${fileNo}</div>` : ''}
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════
// SECTION 3 — printInvoice (reads live DOM #invoice-print-area)
// ════════════════════════════════════════════════════════════
function printInvoice() {
  const content = el('invoice-print-area')?.innerHTML;
  if (!content) return;
  renderPrint(content, 'فاتورة بيع');
}

// ════════════════════════════════════════════════════════════
// SECTION 4 — Sale Invoice
// ════════════════════════════════════════════════════════════
async function reprintInvoice(invNo, fn) {
  try {
    await ensureCache();
    let data = state.allSales.filter(s => s.file_no === fn && s.inv_no === invNo);
    if (!data.length) {
      data = await apiGetAll('sales', { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${fn}`, inv_no:`eq.${invNo}` });
    }
    if (!data?.length) { toast('لم يتم إيجاد بيانات الفاتورة','err'); return; }
    const s = data[0];
    const vehicles = state.allVehicles.filter(v => v.file_no === fn);
    const items = data.map(d => {
      const v = vehicles.find(v => v.vin === d.vin);
      return { vin:d.vin||'', model:v?.model||v?.vehicle_type||'', plate:v?.plate||'', color:v?.color||'', engine:v?.engine_size||'', year:v?.year||'', price:+d.sale_price||0, vnote:d.notes||'', purchasePrice:+v?.purchase_price||0 };
    });
    printSaleInvoice({ invNo, customer:s.customer, date:s.sale_date, fn, notes:s.notes||'', items, total:items.reduce((t,i)=>t+i.price,0) });
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

function printSaleInvoice({ invNo, customer, date, fn, notes, items, total, extraCharges = [], grandTotal = null }) {
  const companyName    = 'Transit International Company';
  const companyNameAr  = 'ترانزيت إنترناشيونال';
  const companyAddress = 'Kuwait · الكويت';
  const finalTotal     = grandTotal != null ? grandTotal : total;

  const itemsHtml = items.map((item, i) => `
    <tr>
      <td style="text-align:center">${i+1}</td>
      <td><div style="font-weight:600">${item.model||'—'}</div><div style="font-size:11px;color:#666">${item.color||''}${item.year?' · '+item.year:''}</div></td>
      <td style="direction:ltr;text-align:center;font-family:monospace;font-size:12px">${item.vin||'—'}</td>
      <td style="direction:ltr;text-align:center;font-family:monospace">${item.plate||'—'}</td>
      <td style="text-align:center">${item.engine?item.engine+' L':'—'}</td>
      <td class="num">${item.price.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    </tr>`).join('');

  const subtotalRow = extraCharges.length > 0 ? `
    <tr style="background:#f0f0f0;font-weight:600">
      <td colspan="5" style="text-align:right;padding:8px 12px;color:#555">مجموع السيارات / Vehicles Subtotal</td>
      <td class="num">${total.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    </tr>` : '';

  const extraRowsHtml = extraCharges.map(c => `
    <tr style="background:#fff8ec">
      <td style="text-align:center;color:#3C3834;font-size:11px">+</td>
      <td colspan="4" style="color:#3C3834;font-weight:600;padding:8px 12px">${c.desc}<span style="font-size:10px;background:#F0EEE9;color:#3C3834;padding:1px 7px;border-radius:10px;margin-right:8px;font-weight:700">مصروف إضافي</span></td>
      <td class="num c-amber">${c.amount.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    </tr>`).join('');

  const fragment = `
  <div class="doc-header">
    <div class="doc-header-right">
      <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMDAgMjAwIiB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEzNSUiIHkyPSIxMzUlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6IzFDMTkxNyIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMyQzI5MjYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImxpbmUiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgICBzdHlsZT0ic3RvcC1jb2xvcjojNzg3MTZDO3N0b3Atb3BhY2l0eTowIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMjAlIiAgc3R5bGU9InN0b3AtY29sb3I6I0M4QzRCQTtzdG9wLW9wYWNpdHk6MSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjgwJSIgIHN0eWxlPSJzdG9wLWNvbG9yOiNGOUY4RjY7c3RvcC1vcGFjaXR5OjEiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojRjlGOEY2O3N0b3Atb3BhY2l0eTowLjMiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9Imdsb3ciIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgICBzdHlsZT0ic3RvcC1jb2xvcjojNDQ0MDNDO3N0b3Atb3BhY2l0eTowIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iNTAlIiAgc3R5bGU9InN0b3AtY29sb3I6IzZCNjU2MDtzdG9wLW9wYWNpdHk6MC4zIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3R5bGU9InN0b3AtY29sb3I6IzQ0NDAzQztzdG9wLW9wYWNpdHk6MCIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxmaWx0ZXIgaWQ9InNvZnQiPgogICAgICA8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIwLjgiLz4KICAgIDwvZmlsdGVyPgogICAgPGZpbHRlciBpZD0iZ2xvdy1maWx0ZXIiPgogICAgICA8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIyIiByZXN1bHQ9ImJsdXIiLz4KICAgICAgPGZlQ29tcG9zaXRlIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9ImJsdXIiIG9wZXJhdG9yPSJvdmVyIi8+CiAgICA8L2ZpbHRlcj4KICA8L2RlZnM+CgogIDwhLS0g2K7ZhNmB2YrYqSAtLT4KICA8cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgcng9IjM4IiByeT0iMzgiIGZpbGw9InVybCgjYmcpIi8+CgogIDwhLS0g2KrZiNmH2Kwg2K7ZgdmK2YEg2YHZiiDYp9mE2YXZhtiq2LXZgSAtLT4KICA8ZWxsaXBzZSBjeD0iMTAwIiBjeT0iOTUiIHJ4PSI3NSIgcnk9IjUwIiBmaWxsPSIjNDQ0MDNDIiBvcGFjaXR5PSIwLjE1Ii8+CgogIDwhLS0g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCiAgICAgICDYp9mE2LTYp9it2YbYqSDYqNiu2Lcg2YjYp9it2K8g2YXYqti12YQKICAgICAgINin2YTYrti3INmK2KjYr9ijINmF2YYg2KfZhNmK2LPYp9ixINmI2YrYtNmD2YQg2KfZhNi02KfYrdmG2KkKICAgICAgINir2YUg2YrYqtit2YjZhCDZhNit2LHZiNmBIFRJQwogIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkCAtLT4KCiAgPCEtLSDYrti3INin2YTYs9ix2LnYqSDYrtmE2YEg2KfZhNi02KfYrdmG2KkgKG1vdGlvbiBsaW5lcykgLS0+CiAgPGxpbmUgeDE9IjE0IiB5MT0iODEiIHgyPSIzNCIgeTI9IjgxIiBzdHJva2U9IiM0NDQwM0MiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8bGluZSB4MT0iMTAiIHkxPSI4OSIgeDI9IjM0IiB5Mj0iODkiIHN0cm9rZT0iIzNDMzgzNCIgc3Ryb2tlLXdpZHRoPSIxIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8bGluZSB4MT0iMTYiIHkxPSI5NyIgeDI9IjM0IiB5Mj0iOTciIHN0cm9rZT0iIzQ0NDAzQyIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgoKICA8IS0tINin2YTYtNin2K3ZhtipIOKAlCDYrti3INmI2KfYrdivINmF2KrYtdmEIC0tPgogIDwhLS0g2KfZhNmF2LPYp9ixINin2YTZg9in2YXZhCDZhNmE2LTYp9it2YbYqSAtLT4KICA8cGF0aCBkPSIKICAgIE0gMzQgOTcKICAgIEwgMzQgNzAKICAgIEwgMTAwIDcwCiAgICBMIDEwMCA1OAogICAgTCAxMjggNTgKICAgIEwgMTQwIDcwCiAgICBMIDE1NSA3MAogICAgTCAxNTUgNzYKICAgIEwgMTYwIDc2CiAgICBMIDE2MCA5NwogICAgTCAxNTUgOTcKICAgIE0gMzQgOTcKICAgIEwgMTU1IDk3CiAgIgogICAgZmlsbD0ibm9uZSIKICAgIHN0cm9rZT0idXJsKCNsaW5lKSIKICAgIHN0cm9rZS13aWR0aD0iMi4yIgogICAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogICAgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIKICAvPgoKICA8IS0tINiq2YHYp9i12YrZhCDYp9mE2LTYp9it2YbYqSDYr9in2K7ZhNmK2KkgLS0+CiAgPCEtLSDZgdin2LXZhCDYp9mE2YPYp9io2YrZhtipINmI2KfZhNi12YbYr9mI2YIgLS0+CiAgPGxpbmUgeDE9IjEwMCIgeTE9IjcwIiB4Mj0iMTAwIiB5Mj0iOTciIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC43Ii8+CgogIDwhLS0g2LLYrNin2Kwg2KfZhNmD2KfYqNmK2YbYqSAtLT4KICA8cGF0aCBkPSJNIDEwNSA2MyBMIDEyOCA2MyBMIDEzOCA3MyBMIDEwNSA3MyBaIgogICAgZmlsbD0iIzJDMjkyNiIgb3BhY2l0eT0iMC42Ii8+CiAgPHBhdGggZD0iTSAxMDUgNjMgTCAxMjggNjMgTCAxMzggNzMgTCAxMDUgNzMgWiIKICAgIGZpbGw9Im5vbmUiIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxIiBvcGFjaXR5PSIwLjUiLz4KCiAgPCEtLSDZhdi12KjYp9itINij2YXYp9mF2YogLS0+CiAgPHJlY3QgeD0iMTU2IiB5PSI4MiIgd2lkdGg9IjUiIGhlaWdodD0iNyIgcng9IjIiIGZpbGw9IiNGOUY4RjYiIG9wYWNpdHk9IjAuOSIvPgogIDwhLS0g2KPYtNi52Kkg2KfZhNiz2LHYudipINmF2YYg2KfZhNmF2LXYqNin2K0gLS0+CiAgPGxpbmUgeDE9IjE2MSIgeTE9IjgzIiB4Mj0iMTcwIiB5Mj0iNzkiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC43Ii8+CiAgPGxpbmUgeDE9IjE2MSIgeTE9Ijg2IiB4Mj0iMTcyIiB5Mj0iODUiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC42Ii8+CiAgPGxpbmUgeDE9IjE2MSIgeTE9Ijg5IiB4Mj0iMTcwIiB5Mj0iOTIiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC41Ii8+CgogIDwhLS0g2YXYtdio2KfYrSDYrtmE2YHZiiAtLT4KICA8cmVjdCB4PSIzMCIgeT0iODIiIHdpZHRoPSI1IiBoZWlnaHQ9IjciIHJ4PSIyIiBmaWxsPSIjQzAzOTJCIiBvcGFjaXR5PSIwLjgiLz4KCiAgPCEtLSDYp9mE2LnYrNmE2KfYqiDigJQg2KzYstihINmF2YYg2KfZhNiu2Lcg2KfZhNmF2KrYtdmEIC0tPgogIDwhLS0g2LnYrNmE2Kkg2K7ZhNmB2YrYqSDYo9mI2YTZiSAtLT4KICA8Y2lyY2xlIGN4PSI1NSIgY3k9Ijk3IiByPSIxMSIgZmlsbD0iIzFDMTkxNyIgc3Ryb2tlPSIjQzhDNEJBIiBzdHJva2Utd2lkdGg9IjEuOCIvPgogIDxjaXJjbGUgY3g9IjU1IiBjeT0iOTciIHI9IjUuNSIgZmlsbD0iIzJDMjkyNiIvPgogIDxjaXJjbGUgY3g9IjU1IiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINi52KzZhNipINiu2YTZgdmK2Kkg2KvYp9mG2YrYqSAtLT4KICA8Y2lyY2xlIGN4PSI4MiIgY3k9Ijk3IiByPSIxMSIgZmlsbD0iIzFDMTkxNyIgc3Ryb2tlPSIjQzhDNEJBIiBzdHJva2Utd2lkdGg9IjEuOCIvPgogIDxjaXJjbGUgY3g9IjgyIiBjeT0iOTciIHI9IjUuNSIgZmlsbD0iIzJDMjkyNiIvPgogIDxjaXJjbGUgY3g9IjgyIiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINi52KzZhNipINij2YXYp9mF2YrYqSAtLT4KICA8Y2lyY2xlIGN4PSIxNDAiIGN5PSI5NyIgcj0iMTEiIGZpbGw9IiMxQzE5MTciIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxLjgiLz4KICA8Y2lyY2xlIGN4PSIxNDAiIGN5PSI5NyIgcj0iNS41IiBmaWxsPSIjMkMyOTI2Ii8+CiAgPGNpcmNsZSBjeD0iMTQwIiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINin2YTYtNin2LPZitmHIC0tPgogIDxsaW5lIHgxPSIzNCIgeTE9IjEwNiIgeDI9IjE2MiIgeTI9IjEwNiIgc3Ryb2tlPSIjNTc1MzRFIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgoKICA8IS0tIOKVkOKVkOKVkCDYrti3INmB2KfYtdmEIOKVkOKVkOKVkCAtLT4KICA8bGluZSB4MT0iMzAiIHkxPSIxMTgiIHgyPSIxNzAiIHkyPSIxMTgiIHN0cm9rZT0idXJsKCNnbG93KSIgc3Ryb2tlLXdpZHRoPSIxIi8+CgogIDwhLS0g4pWQ4pWQ4pWQINit2LHZiNmBIFRJQyDilZDilZDilZAgLS0+CiAgPHRleHQgeD0iMTAwIiB5PSIxNTEiCiAgICBmb250LWZhbWlseT0iJ1RyZWJ1Y2hldCBNUycsICdDZW50dXJ5IEdvdGhpYycsIEZ1dHVyYSwgc2Fucy1zZXJpZiIKICAgIGZvbnQtc2l6ZT0iMjgiCiAgICBmb250LXdlaWdodD0iNzAwIgogICAgZmlsbD0iI0Y5RjhGNiIKICAgIHRleHQtYW5jaG9yPSJtaWRkbGUiCiAgICBsZXR0ZXItc3BhY2luZz0iMTAiCiAgICBzdHlsZT0iZm9udC1zdHJldGNoOmNvbmRlbnNlZCI+VElDPC90ZXh0PgoKICA8IS0tIOKVkOKVkOKVkCDYp9mE2YbYtSDYp9mE2LXYutmK2LEg4pWQ4pWQ4pWQIC0tPgogIDx0ZXh0IHg9IjEwMCIgeT0iMTcyIgogICAgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIgogICAgZm9udC1zaXplPSI4LjUiCiAgICBmaWxsPSIjQThBNDlDIgogICAgdGV4dC1hbmNob3I9Im1pZGRsZSIKICAgIGxldHRlci1zcGFjaW5nPSIyLjUiPlRSQU5TSVQgSU5URVJOQVRJT05BTCBDTy48L3RleHQ+CgogIDwhLS0g2YbZgtin2Lcg2LPYsdi52Kkg2KrYstmK2YbZitipIC0tPgogIDxjaXJjbGUgY3g9IjE4IiBjeT0iODQiIHI9IjEuMiIgZmlsbD0iIzQ0NDAzQyIgb3BhY2l0eT0iMC44Ii8+CiAgPGNpcmNsZSBjeD0iMTMiIGN5PSI5MSIgcj0iMC45IiBmaWxsPSIjM0MzODM0IiBvcGFjaXR5PSIwLjYiLz4KICA8Y2lyY2xlIGN4PSIyMCIgY3k9Ijk5IiByPSIxLjIiIGZpbGw9IiM0NDQwM0MiIG9wYWNpdHk9IjAuOCIvPgoKPC9zdmc+Cg==" alt="TIC" style="width:52px;height:52px;border-radius:10px;display:block;margin-bottom:6px">
      <div class="doc-company">${companyName}</div>
      <div class="doc-company-sub">${companyAddress}</div>
    </div>
    <div class="doc-header-left">
      <div class="doc-title">INVOICE</div>
      <div class="doc-subtitle">فاتورة بيع</div>
      <div class="doc-ref"># ${invNo}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-cell">
      <div class="info-cell-title">بيانات العميل / Bill To</div>
      <div class="info-row"><span class="info-lbl">العميل / Customer</span><span class="info-val">${customer}</span></div>
      <div class="info-row"><span class="info-lbl">رقم الملف / File No</span><span class="info-val">${fn||'—'}</span></div>
    </div>
    <div class="info-cell">
      <div class="info-cell-title">بيانات الفاتورة / Invoice Details</div>
      <div class="info-row"><span class="info-lbl">رقم الفاتورة / No</span><span class="info-val c-amber">${invNo}</span></div>
      <div class="info-row"><span class="info-lbl">التاريخ / Date</span><span class="info-val">${new Date(date).toLocaleDateString('en-GB',{year:'numeric',month:'long',day:'numeric'})}</span></div>
      <div class="info-row"><span class="info-lbl">عدد السيارات</span><span class="info-val">${items.length}</span></div>
      ${extraCharges.length>0?`<div class="info-row"><span class="info-lbl">مصاريف إضافية</span><span class="info-val c-amber">${extraCharges.length} بند</span></div>`:''}
    </div>
  </div>

  <table>
    <colgroup><col style="width:36px"><col style="width:25%"><col style="width:22%"><col style="width:12%"><col style="width:10%"><col style="width:15%"></colgroup>
    <thead><tr>
      <th>#</th><th>السيارة / Vehicle</th><th>رقم الشاصي / VIN</th><th>اللوحة / Plate</th><th>الحجم / Engine</th><th style="text-align:left">السعر / Price</th>
    </tr></thead>
    <tbody>${itemsHtml}${subtotalRow}${extraRowsHtml}</tbody>
  </table>

  <div class="total-wrap">
    <div class="total-box">
      <div class="total-label">الإجمالي / Total Amount</div>
      <div class="total-amount">${finalTotal.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
      <div class="total-cur">KWD / د.ك</div>
      ${extraCharges.length>0?`<div class="total-sub"><span>قيمة السيارات</span><span>${total.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div><div class="total-sub"><span>مصاريف إضافية</span><span>${(finalTotal-total).toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>`:''}
    </div>
  </div>

  ${notes?`<div class="notes-box"><div class="notes-title">ملاحظات / Notes</div><p style="color:#444;line-height:1.6">${notes}</p></div>`:''}

  <div class="sig-row">
    <div class="sig-cell">توقيع البائع / Seller Signature</div>
    <div class="sig-cell">توقيع المشتري / Buyer Signature</div>
  </div>

  <div class="doc-footer">${companyName} · ${companyAddress} · شكراً لتعاملكم معنا · Thank you for your business</div>`;

  renderPrint(fragment, `فاتورة ${invNo}`);

  setTimeout(() => {
    if (confirm('إرسال الفاتورة عبر واتساب؟')) {
      const phone = prompt('رقم واتساب العميل (مثال: 96512345678)\nاتركه فارغاً لاختيار يدوي:','');
      if (phone !== null) sendWhatsappInvoice({ invNo, customer, date, fn, notes, items, total, extraCharges, grandTotal, phone });
    }
  }, 800);
}

// ════════════════════════════════════════════════════════════
// SECTION 5 — Payout Voucher
// ════════════════════════════════════════════════════════════
async function printPayoutVoucher(payoutId) {
  try {
    const pArr = await apiGetAll('partner_payouts', { select:'*', id:`eq.${payoutId}` });
    const p = pArr?.[0];
    if (!p) { toast('لم يُعثر على بيانات الصرف','err'); return; }

    const poArr = await apiGetAll('purchase_orders', { select:'supplier,po_date,total_purchase', system_type:`eq.${state.system}`, file_no:`eq.${p.file_no}` });
    const deal  = poArr?.[0];
    let dealSummary = null;
    try { dealSummary = await getPartnerDealBalance(p.file_no, p.partner, state.system); } catch(e) { console.warn('getPartnerDealBalance:', e.message); }
    const fmt2 = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:2});
    const typeColor = { 'استرداد رأس مال':'#2563eb','توزيع أرباح':'#16a34a','رأس مال + أرباح':'#7c3aed','سلفة':'#3C3834' };
    const color = typeColor[p.payout_type] || '#1a1a1a';

    const dealBreakdown = dealSummary ? `
    <div class="notes-box" style="margin-bottom:20px">
      <div class="notes-title">ملخص الصفقة — ملف ${p.file_no}</div>
      <div class="kpi-row">
        <div class="kpi-cell"><div class="kpi-label">رأس المال</div><div class="kpi-val c-blue">${fmt2(dealSummary._totalCost)} KWD</div></div>
        <div class="kpi-cell" style="border-color:#dc2626"><div class="kpi-label">المصاريف</div><div class="kpi-val c-red">${fmt2(dealSummary._totalExp)} KWD</div></div>
        <div class="kpi-cell" style="border-color:#16a34a"><div class="kpi-label">المبيعات</div><div class="kpi-val c-green">${fmt2(dealSummary._totalSales)} KWD</div></div>
      </div>
      <div class="kpi-row" style="margin-top:6px">
        <div class="kpi-cell" style="border-color:#2563eb"><div class="kpi-label">رأس المال المدفوع</div><div class="kpi-val c-blue">${fmt2(dealSummary.capitalPaid)} KWD</div></div>
        <div class="kpi-cell" style="border-color:${dealSummary.profit>=0?'#16a34a':'#dc2626'}"><div class="kpi-label">الربح المستحق</div><div class="kpi-val ${dealSummary.profit>=0?'c-green':'c-red'}">${fmt2(Math.abs(dealSummary.profit))} KWD</div></div>
        <div class="kpi-cell" style="border-color:#3C3834"><div class="kpi-label">المسحوبات السابقة</div><div class="kpi-val c-amber">${fmt2(dealSummary.totalWithdrawn)} KWD</div></div>
      </div>
    </div>` : '';

    const splitRows = [];
    if (+p.capital_amount) splitRows.push(`<tr><td>رأس مال مُسترد</td><td class="num c-blue">${(+p.capital_amount).toLocaleString('en-US',{minimumFractionDigits:2})} KWD</td></tr>`);
    if (+p.profit_amount)  splitRows.push(`<tr><td>أرباح موزعة</td><td class="num c-green">${(+p.profit_amount).toLocaleString('en-US',{minimumFractionDigits:2})} KWD</td></tr>`);
    if (+p.advance_amount) splitRows.push(`<tr><td>سلفة</td><td class="num c-amber">${(+p.advance_amount).toLocaleString('en-US',{minimumFractionDigits:2})} KWD</td></tr>`);

    const fragment = `
    ${docHeader('سند صرف شريك', '', p.pay_id||payoutId)}
    ${dealBreakdown}

    <div class="info-grid">
      <div class="info-cell">
        <div class="info-cell-title">بيانات الشريك</div>
        <div class="info-row"><span class="info-lbl">اسم الشريك</span><span class="info-val">${p.partner||'—'}</span></div>
        <div class="info-row"><span class="info-lbl">رقم الملف</span><span class="info-val">${p.file_no||'—'}</span></div>
        ${deal?`<div class="info-row"><span class="info-lbl">المورد</span><span class="info-val">${deal.supplier||'—'}</span></div>`:''}
      </div>
      <div class="info-cell">
        <div class="info-cell-title">بيانات الدفع</div>
        <div class="info-row"><span class="info-lbl">التاريخ</span><span class="info-val">${p.pay_date||'—'}</span></div>
        <div class="info-row"><span class="info-lbl">طريقة الدفع</span><span class="info-val">${p.pay_method||'—'}</span></div>
        ${p.document?`<div class="info-row"><span class="info-lbl">رقم المستند</span><span class="info-val">${p.document}</span></div>`:''}
      </div>
    </div>

    <div class="total-wrap" style="text-align:center">
      <div class="total-box">
        <div class="total-label">المبلغ الإجمالي</div>
        <div class="total-amount">${(+p.amount).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
        <div class="total-cur">KWD — دينار كويتي</div>
        <div style="margin-top:8px"><span style="background:${color};color:#fff;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700">${p.payout_type||'صرف'}</span></div>
      </div>
    </div>

    ${splitRows.length>1?`<table style="margin-bottom:20px"><thead><tr><th colspan="2">تفاصيل التوزيع</th></tr></thead><tbody>${splitRows.join('')}</tbody></table>`:''}
    ${p.notes?`<div class="notes-box" style="background:#F0EEE9;border:1px solid #C8C4BA"><div class="notes-title" style="color:#3C3834">ملاحظات</div><div>${p.notes}</div></div>`:''}

    <div class="sig-row">
      <div class="sig-cell">توقيع المستلم (الشريك)<div style="font-size:12px;color:#1a1a1a;margin-top:4px">${p.partner||''}</div></div>
      <div class="sig-cell">توقيع المُصدِر</div>
    </div>
    <div class="doc-footer">تم إنشاؤه بتاريخ ${new Date().toLocaleDateString('en-GB')} · Transit International Company</div>`;

    renderPrint(fragment, `سند صرف — ${p.pay_id||payoutId}`);
  } catch(e) { toast('خطأ في الطباعة: '+e.message,'err'); }
}

// ════════════════════════════════════════════════════════════
// SECTION 6 — Purchase Order
// ════════════════════════════════════════════════════════════
async function printPurchaseOrder(fileNo) {
  try {
    const sys = state.system;
    const [poArr, vehicles, partners, payments, expenses] = await Promise.all([
      apiGetAll('purchase_orders', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('vehicles',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('partners_master', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('payments',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, order:'pay_date.asc' }),
      apiGetAll('expenses',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, order:'exp_date.asc' }),
    ]);
    const po        = poArr?.[0] || {};
    // ✅ فلترة: استثناء الملغية (voided) من الأرقام
    const notVoided = r => r.post_status !== 'voided';
    const totalPaid = (payments||[]).filter(notVoided).reduce((s,p)=>s+(+p.amount||0),0);
    const totalExp  = (expenses||[]).filter(notVoided).reduce((s,e)=>s+(+e.amount||0),0);
    const remaining = (+po.total_purchase||0) - totalPaid;
    const fmt2 = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:2});

    const vehicleRows  = (vehicles||[]).map((v,i) => `<tr>
      <td style="text-align:center;font-weight:700">${i+1}</td>
      <td style="overflow:hidden;text-overflow:ellipsis">${v.vehicle_type||'—'} ${v.model||''}</td>
      <td style="direction:ltr;font-family:monospace;font-size:10px;font-weight:700;overflow:hidden">${v.vin||'—'}</td>
      <td style="direction:ltr;white-space:nowrap">${v.plate||'—'}</td>
      <td style="overflow:hidden;text-overflow:ellipsis">${v.color||'—'}</td>
      <td style="text-align:center;white-space:nowrap">${v.engine_size?v.engine_size+' L':'—'}</td>
      <td style="text-align:center">${v.year||'—'}</td>
      <td class="num c-amber">${fmt2(v.purchase_price)}</td>
    </tr>`).join('');
    const paymentRows  = (payments||[]).map(p => `<tr><td style="font-size:10px;color:#2563eb;font-weight:700">${p.ref_no||'—'}</td><td>${p.payer||'—'}</td><td class="num c-green">${fmt2(p.amount)}</td><td>${p.pay_method||'—'}</td><td style="direction:ltr">${p.document||'—'}</td><td>${p.pay_date||'—'}</td></tr>`).join('');
    const expenseRows  = (expenses||[]).map(e => `<tr><td style="font-size:10px;color:#dc2626;font-weight:700">${e.ref_no||'—'}</td><td>${e.description||'—'}</td><td>${e.exp_type||'—'}</td><td class="num c-red">${fmt2(e.amount)}</td><td>${e.pay_method||'—'}</td><td>${e.exp_date||e.expense_date||'—'}</td></tr>`).join('');
    const partnerRows  = (partners||[]).map(p => { const paid=(payments||[]).filter(pm=>pm.payer===p.partner&&notVoided(pm)).reduce((s,pm)=>s+(+pm.amount||0),0); const due=(+po.total_purchase||0)*(+p.share_percent||0)/100; return `<tr><td style="font-weight:700">${p.partner}</td><td style="text-align:center">${p.share_percent}%</td><td class="num c-blue">${fmt2(due)}</td><td class="num c-green">${fmt2(paid)}</td><td class="num ${(due-paid)>0.01?'c-red':'c-green'}" style="font-weight:700">${fmt2(due-paid)}</td></tr>`; }).join('');

    const fragment = `
    ${docHeader('سند شراء', 'Purchase Order', fileNo)}
    <div class="kpi-row">
      <div class="kpi-cell"><div class="kpi-label">قيمة الصفقة</div><div class="kpi-val c-amber">${fmt2(po.total_purchase)} KWD</div></div>
      <div class="kpi-cell" style="border-color:#16a34a"><div class="kpi-label">المدفوع للمورد</div><div class="kpi-val c-green">${fmt2(totalPaid)} KWD</div></div>
      <div class="kpi-cell" style="border-color:${remaining>0?'#dc2626':'#16a34a'}"><div class="kpi-label">المتبقي</div><div class="kpi-val ${remaining>0?'c-red':'c-green'}">${fmt2(remaining)} KWD</div></div>
      <div class="kpi-cell" style="border-color:#7c3aed"><div class="kpi-label">المصاريف</div><div class="kpi-val" style="color:#7c3aed">${fmt2(totalExp)} KWD</div></div>
    </div>
    <div class="info-grid">
      <div class="info-cell">
        <div class="info-row"><span class="info-lbl">رقم الملف</span><span class="info-val c-amber">${po.file_no||'—'}</span></div>
        <div class="info-row"><span class="info-lbl">المورد</span><span class="info-val">${po.supplier||'—'}</span></div>
        <div class="info-row"><span class="info-lbl">رقم PO</span><span class="info-val" style="direction:ltr">${po.po_no||'—'}</span></div>
        <div class="info-row"><span class="info-lbl">تاريخ الصفقة</span><span class="info-val">${po.po_date||'—'}</span></div>
        <div class="info-row"><span class="info-lbl">الحالة</span><span class="info-val">${po.status||'—'}</span></div>
      </div>
      <div class="info-cell">
        <div class="info-row"><span class="info-lbl">عدد السيارات</span><span class="info-val">${(vehicles||[]).length} سيارة</span></div>
        <div class="info-row"><span class="info-lbl">عدد الشركاء</span><span class="info-val">${(partners||[]).length} شريك</span></div>
        <div class="info-row"><span class="info-lbl">عدد الدفعات</span><span class="info-val">${(payments||[]).length} دفعة</span></div>
        <div class="info-row"><span class="info-lbl">عدد المصاريف</span><span class="info-val">${(expenses||[]).length} بند</span></div>
        <div class="info-row"><span class="info-lbl">تاريخ الطباعة</span><span class="info-val">${new Date().toLocaleDateString('en-GB')}</span></div>
      </div>
    </div>
    <div class="section-title">📦 السيارات / Vehicles</div>
    <table style="table-layout:fixed;width:100%"><colgroup><col style="width:4%"><col style="width:22%"><col style="width:15%"><col style="width:10%"><col style="width:7%"><col style="width:8%"><col style="width:6%"><col style="width:12%"></colgroup>
      <thead><tr><th style="text-align:center">#</th><th>النوع / الموديل</th><th>رقم الشاصي (VIN)</th><th>اللوحة</th><th>اللون</th><th style="text-align:center">الحجم</th><th style="text-align:center">السنة</th><th style="text-align:left">سعر الشراء</th></tr></thead>
      <tbody>${vehicleRows}</tbody>
      <tfoot><tr><td colspan="7"><strong>إجمالي قيمة الشراء</strong></td><td class="num c-amber"><strong>${fmt2(po.total_purchase)} KWD</strong></td></tr></tfoot>
    </table>
    ${partners?.length?`<div class="section-title">👥 الشركاء / Partners</div><table><thead><tr><th>الشريك</th><th>الحصة %</th><th style="text-align:left">المستحق</th><th style="text-align:left">المدفوع</th><th style="text-align:left">المتبقي</th></tr></thead><tbody>${partnerRows}</tbody></table>`:''}
    ${payments?.length?`<div class="section-title">💳 دفعات المورد / Payments</div><table><thead><tr><th>رقم الدفعة</th><th>الدافع</th><th style="text-align:left">المبلغ</th><th>طريقة الدفع</th><th>المستند</th><th>التاريخ</th></tr></thead><tbody>${paymentRows}</tbody><tfoot><tr><td colspan="2"><strong>الإجمالي المدفوع</strong></td><td class="num c-green"><strong>${fmt2(totalPaid)} KWD</strong></td><td colspan="3"></td></tr></tfoot></table>`:''}
    ${expenses?.length?`<div class="section-title">💸 المصاريف / Expenses</div><table><thead><tr><th>رقم المصروف</th><th>البيان</th><th>النوع</th><th style="text-align:left">المبلغ</th><th>طريقة الدفع</th><th>التاريخ</th></tr></thead><tbody>${expenseRows}</tbody><tfoot><tr><td colspan="3"><strong>إجمالي المصاريف</strong></td><td class="num c-red"><strong>${fmt2(totalExp)} KWD</strong></td><td colspan="2"></td></tr></tfoot></table>`:''}
    ${po.notes?`<div class="notes-box" style="background:#fffbeb;border:1px solid #fde68a"><strong>ملاحظات:</strong> ${po.notes}</div>`:''}
    <div class="sig-row">
      <div class="sig-cell">توقيع المورد<div style="font-size:12px;font-weight:700;margin-top:4px">${po.supplier||''}</div></div>
      <div class="sig-cell">توقيع المدير</div>
      <div class="sig-cell">توقيع المحاسب</div>
    </div>
    <div class="doc-footer">Transit International Company · TIC</div>`;

    renderPrint(fragment, `سند شراء — ${fileNo}`);
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

// ════════════════════════════════════════════════════════════
// SECTION 7 — Reports
// ════════════════════════════════════════════════════════════
async function printCurrentReport() {
  const type = reportState.type;
  const from = el('r-from').value;
  const to   = el('r-to').value;
  const data = reportState.data || [];
  if (!data.length) { toast('لا توجد بيانات للطباعة','err'); return; }
  const titles = { profit:'تقرير الأرباح والخسائر', sales:'تقرير المبيعات', expenses:'تقرير المصاريف', partners:'تقرير الشركاء' };
  let tableHtml = '';
  if (type==='profit') { const rows=data.map(d=>`<tr><td>${d.file}</td><td class="num c-green">${fmt(d.sales)}</td><td class="num c-red">${fmt(d.expenses)}</td><td class="num c-amber">${fmt(d.payments)}</td><td class="num ${d.profit>=0?'c-green':'c-red'}">${fmt(d.profit)}</td></tr>`).join(''); const tot=data.reduce((s,d)=>s+d.profit,0); tableHtml=`<table><thead><tr><th>الملف</th><th style="text-align:left">مبيعات</th><th style="text-align:left">مصاريف</th><th style="text-align:left">دفعات مورد</th><th style="text-align:left">صافي ربح</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td><strong>الإجمالي</strong></td><td></td><td></td><td></td><td class="num ${tot>=0?'c-green':'c-red'}"><strong>${fmt(tot)}</strong></td></tr></tfoot></table>`; }
  else if (type==='sales') { tableHtml=`<table><thead><tr><th>التاريخ</th><th>الملف</th><th>VIN</th><th>العميل</th><th style="text-align:left">السعر</th></tr></thead><tbody>${data.map(s=>`<tr><td>${s.sale_date||''}</td><td>${s.file_no||''}</td><td style="direction:ltr">${s.vin||''}</td><td>${s.customer||''}</td><td class="num c-green">${fmt(s.sale_price)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="4"><strong>الإجمالي</strong></td><td class="num c-green"><strong>${fmt(data.reduce((s,r)=>s+(+r.sale_price||0),0))}</strong></td></tr></tfoot></table>`; }
  else if (type==='expenses') { tableHtml=`<table><thead><tr><th>التاريخ</th><th>الملف</th><th>البيان</th><th>النوع</th><th style="text-align:left">المبلغ</th></tr></thead><tbody>${data.map(e=>`<tr><td>${e.exp_date||e.expense_date||e.created_at?.split('T')[0]||''}</td><td>${e.file_no||''}</td><td>${e.description||''}</td><td>${e.category||e.exp_type||''}</td><td class="num c-red">${fmt(e.amount)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="4"><strong>الإجمالي</strong></td><td class="num c-red"><strong>${fmt(data.reduce((s,r)=>s+(+r.amount||0),0))}</strong></td></tr></tfoot></table>`; }
  else if (type==='partners') { tableHtml=`<table><thead><tr><th>التاريخ</th><th>الملف</th><th>الشريك</th><th>النوع</th><th style="text-align:left">المبلغ</th></tr></thead><tbody>${data.map(p=>`<tr><td>${p.pay_date||''}</td><td>${p.file_no||''}</td><td>${p.partner||''}</td><td>${p.payout_type||''}</td><td class="num c-amber">${fmt(p.amount)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="4"><strong>الإجمالي</strong></td><td class="num c-amber"><strong>${fmt(data.reduce((s,r)=>s+(+r.amount||0),0))}</strong></td></tr></tfoot></table>`; }
  renderPrint(`${docHeader(titles[type],`من ${from} إلى ${to}`,'')}${tableHtml}<div class="doc-footer">Transit International Company · ${titles[type]} · ${from} — ${to}</div>`, titles[type]);
}

function printTrialBalance() {
  const data = trialState.data || [];
  if (!data.length) { toast('لا توجد بيانات','err'); return; }
  const lbl = { asset:'أصول',liability:'التزامات',equity:'حقوق ملكية',revenue:'إيرادات',cogs:'تكلفة',expense:'مصروفات',other:'أخرى',customer:'عميل',supplier:'مورد',partner:'شريك',custodian:'عهدة' };
  const rows = data.map(c => { const b=c.dr-c.cr; return `<tr><td style="color:#3C3834;font-weight:700;font-family:monospace">${c.code||'—'}</td><td>${c.name}</td><td>${lbl[c.type]||c.type}</td><td class="num c-green">${fmt(c.dr)}</td><td class="num c-red">${fmt(c.cr)}</td><td class="num ${b>=0?'c-green':'c-red'}">${fmt(Math.abs(b))} ${b>0?'مدين':b<0?'دائن':'صفر'}</td></tr>`; }).join('');
  const sD=data.reduce((s,c)=>s+c.dr,0), sC=data.reduce((s,c)=>s+c.cr,0), sB=sD-sC;
  renderPrint(`${docHeader('ميزان المراجعة','Trial Balance','')}<table><colgroup><col style="width:80px"><col><col style="width:80px"><col style="width:14%"><col style="width:14%"><col style="width:16%"></colgroup><thead><tr><th>الكود</th><th>اسم الحساب</th><th>النوع</th><th style="text-align:left">مدين</th><th style="text-align:left">دائن</th><th style="text-align:left">الرصيد</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="3"><strong>الإجمالي (${data.length} حساب)</strong></td><td class="num c-green"><strong>${fmt(sD)}</strong></td><td class="num c-red"><strong>${fmt(sC)}</strong></td><td class="num ${sB>=0?'c-green':'c-red'}"><strong>${fmt(Math.abs(sB))} ${sB>0?'مدين':sB<0?'دائن':'✓ متوازن'}</strong></td></tr></tfoot></table><div class="doc-footer">Transit International Company · ميزان المراجعة · ${new Date().toLocaleDateString('en-GB')}</div>`, 'ميزان المراجعة');
}

function printVehiclesReport() {
  const list = vrState.filtered || vrState.all;
  if (!list.length) { toast('لا توجد بيانات','err'); return; }
  const rows = list.map(v => `<tr><td>${v._code}</td><td>${v.file_no||'—'}</td><td>${v._supplier}</td><td>${v.vehicle_type||'—'}</td><td>${v.model||'—'}</td><td>${v.year||'—'}</td><td style="direction:ltr">${v.vin||'—'}</td><td style="direction:ltr">${v.plate||'—'}</td><td>${v.color||'—'}</td><td>${v.engine_size||'—'}</td><td class="num">${(+v.purchase_price||0).toLocaleString('en-US',{minimumFractionDigits:2})}</td><td>${v.license_expiry||'—'}</td><td>${v._sold?'مباع':'في المخزن'}</td><td>${v._warehouse||'—'}</td><td>${v._saleInfo?.customer||'—'}</td></tr>`).join('');
  renderPrint(`${docHeader('تقرير السيارات','Vehicles Report','')}<table style="font-size:9px"><thead><tr><th>الكود</th><th>الملف</th><th>المورد</th><th>النوع</th><th>الموديل</th><th>السنة</th><th>VIN</th><th>اللوحة</th><th>اللون</th><th>الحجم</th><th style="text-align:left">السعر</th><th>انتهاء الرخصة</th><th>الحالة</th><th>المخزن</th><th>العميل</th></tr></thead><tbody>${rows}</tbody></table><div class="doc-footer">Transit International Company · تقرير السيارات · ${new Date().toLocaleDateString('en-GB')}</div>`, 'تقرير السيارات');
}

// ════════════════════════════════════════════════════════════
// SECTION 8 — Partner Statement (reads live DOM)
// ════════════════════════════════════════════════════════════
function printPartnerStatement() {
  const content = document.getElementById('partnerStatementContent');
  if (!content) return;
  renderPrint(`${docHeader('كشف حساب شريك','Partner Statement','')}${content.innerHTML}`, 'كشف حساب شريك');
}

// ════════════════════════════════════════════════════════════
// SECTION 9 — Journal Voucher
// ════════════════════════════════════════════════════════════
async function printJournalVoucher(entryNo, entryType, fileNo, amount, date, title) {
  try {
    const lines = entryNo ? await apiGet('journal_entries', { select:'account_code,account_name,dr_amount,cr_amount,description', system_type:`eq.${state.system}`, entry_no:`eq.${entryNo}`, order:'id.asc' }) : [];
    const lbl = { purchase:'سند شراء',sale:'سند بيع',collection:'سند تحصيل',expense:'سند مصروف',payment:'سند دفع',payout:'سند صرف شريك',journal:'قيد يومية' };
    const vTitle = lbl[entryType] || 'سند قيد';
    const pDate  = new Date().toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'});
    const vDate  = date ? new Date(date).toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'}) : '—';
    const tDr    = (lines||[]).reduce((s,l)=>s+(+l.dr_amount||0),0);
    const tCr    = (lines||[]).reduce((s,l)=>s+(+l.cr_amount||0),0);
    const linesHtml = (lines||[]).map((l,i) => `<tr><td style="text-align:center;color:#666;font-size:11px">${i+1}</td><td style="font-family:monospace;font-weight:700">${l.account_code||'—'}</td><td>${l.account_name||'—'}</td><td style="font-size:11px;color:#666">${l.description||'—'}</td><td class="num c-green">${+l.dr_amount>0?(+l.dr_amount).toLocaleString('en-US',{minimumFractionDigits:3}):'—'}</td><td class="num c-red">${+l.cr_amount>0?(+l.cr_amount).toLocaleString('en-US',{minimumFractionDigits:3}):'—'}</td></tr>`).join('');
    const fragment = `
    ${docHeader(vTitle, '', entryNo||'—')}
    <div class="info-grid">
      <div class="info-cell">
        <div class="info-row"><span class="info-lbl">رقم السند</span><span class="info-val c-amber" style="font-family:monospace">${entryNo||'—'}</span></div>
        <div class="info-row"><span class="info-lbl">نوع العملية</span><span class="info-val">${vTitle}</span></div>
        <div class="info-row"><span class="info-lbl">تاريخ العملية</span><span class="info-val">${vDate}</span></div>
      </div>
      <div class="info-cell">
        <div class="info-row"><span class="info-lbl">رقم الملف</span><span class="info-val" style="font-family:monospace">${fileNo||'—'}</span></div>
        <div class="info-row"><span class="info-lbl">البيان</span><span class="info-val">${title||'—'}</span></div>
        <div class="info-row"><span class="info-lbl">تاريخ الطباعة</span><span class="info-val">${pDate}</span></div>
      </div>
    </div>
    <table><colgroup><col style="width:32px"><col style="width:80px"><col><col><col style="width:15%"><col style="width:15%"></colgroup>
      <thead><tr><th>#</th><th>كود الحساب</th><th>اسم الحساب</th><th>البيان</th><th style="text-align:left">مدين (Dr)</th><th style="text-align:left">دائن (Cr)</th></tr></thead>
      <tbody>${linesHtml||`<tr><td colspan="6" style="text-align:center;color:#888;padding:20px">لا توجد تفاصيل — المبلغ الإجمالي: ${amount?.toLocaleString?.('en-US',{minimumFractionDigits:3})||'—'}</td></tr>`}</tbody>
      <tfoot><tr><td colspan="4" style="text-align:right;font-weight:700">الإجمالي</td><td class="num c-green">${tDr.toLocaleString('en-US',{minimumFractionDigits:3})}</td><td class="num c-red">${tCr.toLocaleString('en-US',{minimumFractionDigits:3})}</td></tr></tfoot>
    </table>
    <div class="total-wrap">
      <div class="total-box">
        <div class="total-label">إجمالي القيد / Total</div>
        <div class="total-amount">${(tDr||amount||0).toLocaleString('en-US',{minimumFractionDigits:3})}</div>
        <div class="total-cur">KWD / د.ك</div>
        ${Math.abs(tDr-tCr)<0.01?'<div class="c-ok">✓ القيد متوازن</div>':'<div style="color:#f87171;font-size:11px">⚠ القيد غير متوازن</div>'}
      </div>
    </div>
    <div class="sig-row">
      <div class="sig-cell">المحاسب / Accountant</div>
      <div class="sig-cell">المراجع / Reviewer</div>
      <div class="sig-cell">المدير / Manager</div>
    </div>
    <div class="doc-footer">Transit International Company · ${pDate} · رقم السند: ${entryNo||'—'}</div>`;
    renderPrint(fragment, `${vTitle} — ${entryNo}`);
  } catch(e) { toast('خطأ في طباعة القيد: '+e.message,'err'); }
}


// ════════════════════════════════════════════════════════════
// SECTION 10b — buildPrintTable: بناء جدول طباعة نظيف
// المدخلات: عنوان، ملف، أعمدة [{label, key, width, align, format}]، بيانات []
// ════════════════════════════════════════════════════════════
function buildPrintTable(title, fileNo, columns, rows, totalsRow = null) {
  const totalWidth = columns.reduce((s, c) => s + (c.w || 1), 0);
  const colgroup = columns.map(c =>
    `<col style="width:${((c.w||1)/totalWidth*100).toFixed(1)}%">`
  ).join('');

  const thead = columns.map(c =>
    `<th style="text-align:${c.align||'right'}">${c.label}</th>`
  ).join('');

  const tbody = rows.map((row, i) => {
    const cells = columns.map(c => {
      const val = c.format ? c.format(row, i) : (row[c.key] ?? '—');
      const align = c.align || 'right';
      const style = c.mono ? 'font-family:monospace;direction:ltr;' : '';
      return `<td style="text-align:${align};${style}">${val}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  const tfoot = totalsRow ? `<tfoot><tr>${
    columns.map((c, i) => {
      const val = totalsRow[i] ?? '';
      return `<td style="text-align:${c.align||'right'};font-weight:700">${val}</td>`;
    }).join('')
  }</tr></tfoot>` : '';

  return `${docHeader(title, 'ملف: ' + fileNo, '')}
  <table>
    <colgroup>${colgroup}</colgroup>
    <thead><tr>${thead}</tr></thead>
    <tbody>${tbody}</tbody>
    ${tfoot}
  </table>
  <div class="doc-footer">Transit International Company · ${title} · ${fileNo} · ${new Date().toLocaleDateString('en-GB')}</div>`;
}



// ════════════════════════════════════════════════════════════
// SECTION 14 — printDealSummary (ملخص الصفقة الكامل)
// ════════════════════════════════════════════════════════════
async function printDealSummary(fn) {
  try {
    // ✅ قراءة من المصدر الموحد — لا طلبات جديدة
    const d = state.currentDealData;
    if (!d || d.fn !== fn) {
      toast('يرجى فتح تاب الملخص أولاً', 'err');
      return;
    }

    const { vehicles, payments, expenses, sales, collections, partners, payouts, po } = d;
    const totalPurchase  = +(po.total_purchase) || (vehicles||[]).reduce((s,v)=>s+(+v.purchase_price||0),0);
    const postedPay      = (payments||[]).filter(isPosted);
    const postedExp      = (expenses||[]).filter(isPosted).filter(r=>r.post_status!=='voided');
    const postedSal      = (sales||[]).filter(isPosted).filter(r=>r.post_status!=='voided');
    const postedCol      = (collections||[]).filter(isPosted).filter(r=>r.post_status!=='voided');
    const postedPout     = (payouts||[]).filter(isPosted);

    const totalPaid      = postedPay.reduce((s,p)=>s+(+p.amount||0),0);
    const totalExp       = postedExp.reduce((s,e)=>s+(+e.amount||0),0);
    const totalSalesRaw  = postedSal.reduce((s,s2)=>s+(+s2.sale_price||0),0);
    const totalCollected = postedCol.filter(c=>c.paid_date).reduce((s,c)=>s+(+c.amount||0),0);
    const totalPending   = postedCol.filter(c=>!c.paid_date).reduce((s,c)=>s+(+c.amount||0),0);
    const totalSales     = postedCol.length > 0 ? postedCol.reduce((s,c)=>s+(+c.amount||0),0) : totalSalesRaw;
    const fullCost       = totalPurchase + totalExp;
    const profit         = totalSales - fullCost;
    const margin         = totalSales > 0 ? Math.round(profit/totalSales*100) : 0;
    const remaining      = totalPurchase - totalPaid;
    const soldVins       = new Set(postedSal.map(s=>s.vin));
    const totalV         = (vehicles||[]).length;
    const soldV          = soldVins.size;
    const pDate          = new Date().toLocaleDateString('en-GB');

    const f2 = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:3});
    const pRow = (label, val, bold=false, color='') =>
      `<tr ${bold?'style="font-weight:700;background:#f8f9fa"':''}>
        <td style="padding:7px 12px;color:#6b7280;font-size:12px">${label}</td>
        <td style="padding:7px 12px;text-align:left;font-family:monospace;font-size:12px;${color?'color:'+color:''};${bold?'font-weight:700':''}">${val}</td>
      </tr>`;

    // ── KPI Cards — نفس شكل الداشبورد ──
    const mkKpi = (label, icon, val, sub, color) =>
      '<div style="background:#fff;border:1px solid #e4e0d8;border-radius:8px;padding:10px 12px;border-right:3px solid ' + color + '">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
      '<span style="font-size:10px;color:#78716c;font-weight:600">' + label + '</span>' +
      '<span style="font-size:13px">' + icon + '</span>' +
      '</div>' +
      '<div style="font-family:monospace;font-size:16px;font-weight:700;color:' + color + ';margin-bottom:3px">' + val + '</div>' +
      '<div style="font-size:10px;color:#a8a49c">' + sub + '</div>' +
      '</div>';

    const kpis = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0">
      ${mkKpi('تكلفة الشراء',       '📋', f2(totalPurchase), `+ ${f2(totalExp)} مصاريف = ${f2(fullCost)}`,                          '#1d4ed8')}
      ${mkKpi('المصاريف',           '💸', f2(totalExp),       `${(expenses||[]).filter(isPosted).length} بند مصروف`,                  '#c0392b')}
      ${mkKpi('التكلفة الكاملة',    '🏷️', f2(fullCost),       'شراء + مصاريف',                                                        '#44403c')}
      ${mkKpi('المبيعات',           '💹', f2(totalSales),     `${soldV} من ${totalV} سيارة · ${Math.round(soldV/Math.max(totalV,1)*100)}%`, '#15803d')}
      ${mkKpi('صافي الربح',         profit>=0?'📈':'📉', f2(Math.abs(profit)), `${profit>=0?'ربح':'خسارة'} · هامش ${margin}%`,       profit>=0?'#15803d':'#c0392b')}
      ${mkKpi('غير محصّل',          '⏳', f2(totalPending),   totalPending>0?'فواتير مستحقة من العملاء':'✅ كل شيء محصّل',             totalPending>0?'#d97706':'#15803d')}
      ${mkKpi('المدفوع للمورد',     '💳', f2(totalPaid),      `من ${f2(totalPurchase)}`,                                              '#0e7490')}
      ${mkKpi('المتبقي للمورد',     remaining>0?'⚠️':'✅', f2(Math.abs(remaining)), remaining>0?'يحتاج سداد':'مسدد كامل',            remaining>0?'#c0392b':'#15803d')}
      ${mkKpi('مقبوض فعلاً',        '💰', f2(totalCollected), `من ${f2(totalSales)} إجمالي الفواتير`,                                '#6d28d9')}
    </div>`;

    // ── جدول المالية ──
    const finTable = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div>
        <div class="section-title">💰 التكاليف والمبيعات</div>
        <table style="width:100%;border-collapse:collapse">
          ${pRow('تكلفة الشراء', f2(totalPurchase)+' KWD', false, '#2563eb')}
          ${pRow('المصاريف', f2(totalExp)+' KWD', false, '#dc2626')}
          ${pRow('التكلفة الكاملة', f2(fullCost)+' KWD', true)}
          ${pRow('المبيعات', f2(totalSales)+' KWD', false, '#16a34a')}
          ${pRow('مقبوض فعلاً', f2(totalCollected)+' KWD', false, '#16a34a')}
          ${totalPending > 0 ? pRow('⏳ منتظر تحصيل', f2(totalPending)+' KWD', false, '#d97706') : ''}
          ${pRow('صافي الربح', (profit>=0?'+':'-')+f2(Math.abs(profit))+' KWD', true, profit>=0?'#16a34a':'#dc2626')}
        </table>
      </div>
      <div>
        <div class="section-title">🚛 المخزون والمدفوعات</div>
        <table style="width:100%;border-collapse:collapse">
          ${pRow('إجمالي السيارات', totalV+' سيارة')}
          ${pRow('مباعة', soldV+' سيارة', false, '#16a34a')}
          ${pRow('في المخزن', (totalV-soldV)+' سيارة', false, '#2563eb')}
          <tr><td colspan="2" style="padding:4px 0"><hr style="border:none;border-top:1px solid #e5e7eb"></td></tr>
          ${pRow('المدفوع للمورد', f2(totalPaid)+' KWD', false, '#16a34a')}
          ${pRow('المتبقي للمورد', f2(Math.abs(remaining))+' KWD', remaining>0, remaining>0?'#dc2626':'#16a34a')}
          ${pRow('صرف الشركاء', f2(postedPout.reduce((s,p)=>s+(+p.amount||0),0))+' KWD')}
        </table>
      </div>
    </div>`;

    // ── بطاقات الشركاء المفصّلة ──
    const isOpen = (totalV - soldV) > 0;
    const partnersTable = (partners||[]).length > 0 ? (partners||[]).map(p => {
      const share       = +p.share_percent||0;
      const capitalIn   = (payments||[]).filter(px=>isPosted(px)&&px.payer===p.partner).reduce((s,px)=>s+(+px.amount||0),0);
      const liability   = totalPurchase*(share/100);
      const remaining_  = Math.max(liability - capitalIn, 0);
      const profitShare = profit*(share/100);
      const totalOut    = (payouts||[]).filter(px=>isPosted(px)&&px.partner===p.partner).reduce((s,px)=>s+(+px.amount||0),0);
      const netDue      = capitalIn + profitShare - totalOut;
      const pc          = profitShare >= 0 ? '#15803d' : '#c0392b';
      const nc          = netDue >= 0 ? '#15803d' : '#c0392b';
      const rows = (label, val, bold, color) =>
        '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px;border-bottom:1px solid #f0ede8">' +
        '<span style="color:#57534e">' + label + '</span>' +
        '<span style="font-family:monospace;font-weight:' + (bold?'700':'500') + ';color:' + (color||'#1c1917') + '">' + val + '</span>' +
        '</div>';

      let html = '<div style="border:1px solid #e4e0d8;border-radius:10px;margin-bottom:14px;overflow:hidden">';

      // header
      html += '<div style="background:#1C1917;color:#F9F8F6;padding:10px 16px;display:flex;justify-content:space-between;align-items:center">'
            + '<span style="font-size:14px;font-weight:700">' + p.partner + '</span>'
            + '<span style="font-size:12px;background:#44403C;padding:3px 12px;border-radius:10px">' + share + '%</span>'
            + '</div>';

      // two cols
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0">';

      // رأس المال
      html += '<div style="padding:12px 14px;border-left:1px solid #e4e0d8;border-bottom:1px solid #e4e0d8">'
            + '<div style="font-size:10px;color:#78716c;font-weight:700;margin-bottom:8px;letter-spacing:1px">رأس المال</div>'
            + rows('حصته في التكلفة', f2(liability),  false, '#1d4ed8')
            + rows('دفع فعلاً',        f2(capitalIn),  false, '#15803d')
            + rows('المتبقي عليه',     remaining_ > 0.01 ? f2(remaining_)+' ⚠️' : 'صفر ✅', true, remaining_>0.01?'#c0392b':'#15803d')
            + '</div>';

      // الربح
      html += '<div style="padding:12px 14px;border-bottom:1px solid #e4e0d8">'
            + '<div style="font-size:10px;color:#78716c;font-weight:700;margin-bottom:8px;letter-spacing:1px">الربح / الخسارة</div>'
            + rows('إجمالي المبيعات', f2(totalSales), false, '#15803d')
            + rows('التكلفة الكاملة', f2(fullCost),   false, '#c0392b')
            + rows('حصته (' + share + '%)', (profitShare>=0?'+':'') + f2(profitShare), true, pc)
            + '</div>';

      html += '</div>';

      // تنبيه صفقة مفتوحة
      if (isOpen) {
        html += '<div style="background:#fef9ec;border-top:1px solid #e4e0d8;padding:8px 14px;font-size:11px;color:#92400e">'
              + '⚠️ الصفقة مفتوحة — ' + (totalV-soldV) + ' سيارة في المخزن · الأرقام ستتغير عند اكتمال المبيعات'
              + '</div>';
      }

      // المستحق النهائي
      html += '<div style="background:#f9f8f6;padding:12px 16px;border-top:1px solid #e4e0d8">'
            + '<div style="font-size:10px;color:#78716c;margin-bottom:6px">المستحق = رأس مال مدفوع + حصة الربح − مسحوبات</div>'
            + '<div style="font-size:11px;color:#57534e;font-family:monospace;margin-bottom:10px">'
            + f2(capitalIn) + ' + (' + f2(profitShare) + ') − ' + f2(totalOut) + ' = <strong>' + f2(Math.abs(netDue)) + '</strong>'
            + '</div>'
            + (totalOut > 0 ? '<div style="font-size:11px;color:#57534e;margin-bottom:8px">تم الصرف: <span style="font-family:monospace;color:#d97706;font-weight:600">' + f2(totalOut) + '</span></div>' : '')
            + '<div style="display:flex;justify-content:space-between;align-items:center">'
            + '<span style="font-size:12px;font-weight:700;color:#1c1917">المستحق' + (isOpen?' (تقديري)':'') + ':</span>'
            + '<span style="font-size:20px;font-weight:700;font-family:monospace;color:' + nc + '">' + f2(Math.abs(netDue)) + ' ' + (netDue>=0?'↑':'↓') + '</span>'
            + '</div>'
            + '</div>';

      html += '</div>';
      return html;
    }).join('') : '';

    // ── بيانات الصفقة ──
    const dealInfo = `
    <div class="section-title">📋 بيانات الصفقة</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
      <colgroup><col style="width:50%"><col style="width:50%"></colgroup>
      <tbody>
        <tr>
          <td style="padding:6px 12px;font-size:11px;color:#6b7280">رقم الملف</td>
          <td style="padding:6px 12px;font-size:12px;font-weight:700;color:#3C3834;font-family:monospace">${fn}</td>
        </tr>
        <tr style="background:#f8f9fa">
          <td style="padding:6px 12px;font-size:11px;color:#6b7280">المورد</td>
          <td style="padding:6px 12px;font-size:12px">${po.supplier||'—'}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px;font-size:11px;color:#6b7280">تاريخ الصفقة</td>
          <td style="padding:6px 12px;font-size:12px;font-family:monospace">${po.po_date||'—'}</td>
        </tr>
        <tr style="background:#f8f9fa">
          <td style="padding:6px 12px;font-size:11px;color:#6b7280">الحالة</td>
          <td style="padding:6px 12px;font-size:12px;font-weight:700">${po.status||'—'}</td>
        </tr>
      </tbody>
    </table>`;

    const html = `${docHeader('ملخص الصفقة', fn, fn)}
    ${dealInfo}
    ${kpis}
    ${finTable}
    ${partnersTable}
    <div class="doc-footer">Transit International Company · ملخص الصفقة · ${fn} · ${pDate}</div>`;

    renderPrint(html, `ملخص الصفقة — ${fn}`);

  } catch(e) { toast('خطأ في الطباعة: '+e.message, 'err'); }
}

// ════════════════════════════════════════════════════════════
// SECTION 10c — Tab Print Functions (جداول نظيفة بدون ⋮)
// ════════════════════════════════════════════════════════════

// ── السيارات ──
function printVehiclesTab(data, fn) {
  // soldVins من state.currentSales — نفس المصدر اللي بيستخدمه الجدول على الشاشة
  const soldVins = new Set((state.currentSales||[]).map(s=>s.vin).filter(Boolean));
  const cols = [
    {label:'#',            w:0.4, align:'center', format:(_,i)=>i+1},
    {label:'الكود',        w:1.8, format:(v,i)=>`${fn}-V${String(i+1).padStart(2,'0')}`},
    {label:'VIN',          w:1.8, mono:true, align:'left', format:v=>v.vin||'—'},
    {label:'النوع',        w:1.2, format:v=>v.vehicle_type||'—'},
    {label:'الموديل',      w:1.2, format:v=>v.model||'—'},
    {label:'السنة',        w:0.7, align:'center', format:v=>v.year||'—'},
    {label:'اللوحة',       w:1.0, mono:true, align:'left', format:v=>v.plate||'—'},
    {label:'اللون',        w:0.8, format:v=>v.color||'—'},
    {label:'الحجم',        w:0.7, align:'center', format:v=>v.engine_size||'—'},
    {label:'سعر الشراء',   w:1.2, mono:true, align:'left', format:v=>(+v.purchase_price||0).toLocaleString('en-US',{minimumFractionDigits:3})},
    {label:'الحالة',       w:0.9, align:'center', format:v=>soldVins.has(v.vin)?'مباع':'في المخزن'},
  ];
  renderPrint(buildPrintTable('السيارات', fn, cols, data||[],
    ['', `الإجمالي: ${(data||[]).length} سيارة`, '', '', '', '', '', '', '',
     (data||[]).reduce((s,v)=>s+(+v.purchase_price||0),0).toLocaleString('en-US',{minimumFractionDigits:3})+' KWD', '']),
    `السيارات — ${fn}`);
}

// ── الدفعات ──
function printPaymentsTab(data, fn) {
  const active = (data||[]).filter(p=>p.post_status!=='voided');
  const cols = [
    {label:'#',              w:0.4, align:'center', format:(_,i)=>i+1},
    {label:'رقم الدفعة',    w:2.2, mono:true, format:p=>p.ref_no||'—'},
    {label:'الدافع',         w:1.5, format:p=>p.payer||'—'},
    {label:'المبلغ',         w:1.3, mono:true, align:'left', format:p=>(+p.amount||0).toLocaleString('en-US',{minimumFractionDigits:3})},
    {label:'طريقة الدفع',   w:1.0, format:p=>p.pay_method||'—'},
    {label:'المستند',        w:1.0, mono:true, format:p=>p.document||'—'},
    {label:'التاريخ',        w:1.0, mono:true, format:p=>p.pay_date||'—'},
    {label:'ملاحظات',        w:1.5, format:p=>p.notes||'—'},
  ];
  const total = active.reduce((s,p)=>s+(+p.amount||0),0);
  renderPrint(buildPrintTable('دفعات المورد', fn, cols, active,
    ['', `الإجمالي (${active.length} دفعة)`, '',
     total.toLocaleString('en-US',{minimumFractionDigits:3})+' KWD', '', '', '', '']),
    `دفعات المورد — ${fn}`);
}

// ── المصاريف ──
function printExpensesTab(data, fn) {
  const active = (data||[]).filter(e=>e.post_status!=='voided');
  const cols = [
    {label:'#',            w:0.4, align:'center', format:(_,i)=>i+1},
    {label:'رقم المصروف', w:2.0, mono:true, format:e=>e.ref_no||'—'},
    {label:'الوصف',        w:2.0, format:e=>e.description||'—'},
    {label:'النوع',        w:1.0, format:e=>e.exp_type||'—'},
    {label:'المبلغ',       w:1.3, mono:true, align:'left', format:e=>(+e.amount||0).toLocaleString('en-US',{minimumFractionDigits:3})},
    {label:'طريقة الدفع', w:1.0, format:e=>e.pay_method||'—'},
    {label:'التاريخ',      w:1.0, mono:true, format:e=>e.exp_date||e.expense_date||'—'},
  ];
  const total = active.reduce((s,e)=>s+(+e.amount||0),0);
  renderPrint(buildPrintTable('المصاريف', fn, cols, active,
    ['', `الإجمالي (${active.length} مصروف)`, '', '',
     total.toLocaleString('en-US',{minimumFractionDigits:3})+' KWD', '', '']),
    `المصاريف — ${fn}`);
}

// ── المبيعات ──
function printSalesTab(invoices, total, fn) {
  const invList = Object.values(invoices||{});
  const cols = [
    {label:'#',              w:0.4, align:'center', format:(_,i)=>i+1},
    {label:'رقم الفاتورة',  w:2.5, mono:true, format:inv=>inv.inv_no||'—'},
    {label:'العميل',         w:2.0, format:inv=>inv.customer||'—'},
    {label:'VINs',           w:2.5, mono:true, align:'left', format:inv=>(inv.items||[]).map(i=>i.vin||'—').join(' · ')},
    {label:'عدد السيارات',  w:0.9, align:'center', format:inv=>(inv.items||[]).length},
    {label:'الإجمالي',       w:1.5, mono:true, align:'left', format:inv=>(inv.items||[]).reduce((s,i)=>s+(+i.sale_price||0),0).toLocaleString('en-US',{minimumFractionDigits:3})},
  ];
  renderPrint(buildPrintTable('المبيعات', fn, cols, invList,
    ['', `الإجمالي (${invList.length} فاتورة)`, '', '',
     invList.length, (total||0).toLocaleString('en-US',{minimumFractionDigits:3})+' KWD']),
    `المبيعات — ${fn}`);
}

// ── التحصيلات ──
function printCollectionsTab(data, fn) {
  const active = (data||[]).filter(c=>c.post_status!=='voided');
  const cols = [
    {label:'#',              w:0.4, align:'center', format:(_,i)=>i+1},
    {label:'رقم التحصيل',   w:2.0, mono:true, format:c=>c.ref_no||'—'},
    {label:'رقم الفاتورة',  w:1.8, mono:true, format:c=>c.inv_no||'—'},
    {label:'العميل',         w:1.5, format:c=>c.customer||'—'},
    {label:'المبلغ',         w:1.3, mono:true, align:'left', format:c=>(+c.amount||0).toLocaleString('en-US',{minimumFractionDigits:3})},
    {label:'طريقة الدفع',   w:1.0, format:c=>c.pay_method||'—'},
    {label:'الاستحقاق',      w:1.0, mono:true, format:c=>c.due_date||'—'},
    {label:'تاريخ الدفع',   w:1.0, mono:true, format:c=>c.paid_date||'—'},
    {label:'الحالة',         w:0.9, align:'center', format:c=>c.paid_date?'محصّل':'مستحق'},
  ];
  const totalPaid = active.filter(c=>c.paid_date).reduce((s,c)=>s+(+c.amount||0),0);
  renderPrint(buildPrintTable('التحصيلات', fn, cols, active,
    ['', `الإجمالي (${active.length})`, '',
     '', totalPaid.toLocaleString('en-US',{minimumFractionDigits:3})+' KWD محصّل', '', '', '', '']),
    `التحصيلات — ${fn}`);
}

// ── صرف الشركاء ──
function printPayoutsTab(data, fn) {
  const cols = [
    {label:'#',            w:0.4, align:'center', format:(_,i)=>i+1},
    {label:'رقم الصرف',   w:2.0, mono:true, format:p=>p.pay_id||'—'},
    {label:'الشريك',       w:1.5, format:p=>p.partner||'—'},
    {label:'نوع الصرف',   w:1.5, format:p=>p.payout_type||'—'},
    {label:'المبلغ',       w:1.3, mono:true, align:'left', format:p=>(+p.amount||0).toLocaleString('en-US',{minimumFractionDigits:3})},
    {label:'طريقة الدفع', w:1.0, format:p=>p.pay_method||'—'},
    {label:'التاريخ',      w:1.0, mono:true, format:p=>p.pay_date||'—'},
    {label:'ملاحظات',      w:1.5, format:p=>p.notes||'—'},
  ];
  const total = (data||[]).reduce((s,p)=>s+(+p.amount||0),0);
  renderPrint(buildPrintTable('صرف الشركاء', fn, cols, data||[],
    ['', `الإجمالي (${(data||[]).length})`, '', '',
     total.toLocaleString('en-US',{minimumFractionDigits:3})+' KWD', '', '', '']),
    `صرف الشركاء — ${fn}`);
}

// ════════════════════════════════════════════════════════════
// SECTION 10 — printSection (generic section printer)
// ════════════════════════════════════════════════════════════
function printSection(title, subtitle, tableHtml, summaryHtml='') {
  // ✅ حذف عناصر no-print (أزرار Excel/PDF وأزرار الـ ctx menu) من HTML قبل الطباعة
  const tmp = document.createElement('div');
  tmp.innerHTML = tableHtml;
  tmp.querySelectorAll('.no-print, .btn-ctx-menu').forEach(el => el.remove());
  // حذف العمود الأخير الفارغ (عمود الـ ⋮) من الـ header والـ footer
  tmp.querySelectorAll('th:last-child:empty, td:last-child:empty').forEach(el => el.remove());
  const cleanHtml = tmp.innerHTML;
  renderPrint(`${docHeader(title,subtitle,'')}${summaryHtml}${cleanHtml}<div class="doc-footer">تم الإنشاء بتاريخ ${new Date().toLocaleDateString('en-GB')} · Transit International Company</div>`, title);
}

// ════════════════════════════════════════════════════════════
// SECTION 11 — _jPrint helper (unchanged)
// ════════════════════════════════════════════════════════════
function _jPrint(btn) {
  const p = btn.closest('.j-entry-actions') || btn.parentElement;
  printJournalVoucher(p.dataset.eno||'', p.dataset.etype||'', p.dataset.fno||'', parseFloat(p.dataset.amt)||0, p.dataset.date||'', p.dataset.etitle||'');
}

// ════════════════════════════════════════════════════════════
// SECTION 12 — Contact Ledger Statement
// ════════════════════════════════════════════════════════════
function printLedgerStatement() {
  const contactName = window._ledgerContactName || '—';
  const contactType = window._ledgerContactType || '';
  const allEntries  = window._ledgerAllEntries  || [];
  const fileFilter  = el('ledger-file-filter')?.value || '';
  const opening     = !fileFilter ? (window._ledgerOpening || 0) : 0;
  const fmt2        = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:2});
  const typeLabels  = { customer:'عميل',supplier:'مورد',partner:'شريك',custodian:'عهدة' };
  const typeColors  = { customer:'#2563eb',supplier:'#3C3834',partner:'#7c3aed',custodian:'#0891b2' };
  const color = typeColors[contactType] || '#1a1a1a';
  let list    = fileFilter ? allEntries.filter(e => e.file_no===fileFilter) : allEntries;
  let running = opening;
  const totalDebit  = list.reduce((s,e)=>s+(+e.debit||0),0)  + (opening>0?opening:0);
  const totalCredit = list.reduce((s,e)=>s+(+e.credit||0),0) + (opening<0?Math.abs(opening):0);
  const finalBal    = opening + list.reduce((s,e)=>s+(+e.debit||0)-(+e.credit||0),0);
  let rows = '';
  if (opening!==0) rows+=`<tr style="background:#f8f9fa;font-weight:700"><td>—</td><td colspan="2">رصيد افتتاحي</td><td class="num c-green">${opening>0?fmt2(opening):'—'}</td><td class="num c-red">${opening<0?fmt2(Math.abs(opening)):'—'}</td><td class="num" style="font-weight:700">${fmt2(Math.abs(opening))}</td></tr>`;
  list.forEach(e => { running+=(+e.debit||0)-(+e.credit||0); const desc=(e.desc||e.description||'—').replace(/<[^>]+>/g,''); rows+=`<tr style="background:${running<0?'#fff5f5':''}"><td style="white-space:nowrap">${e.date||e.entry_date||'—'}</td><td style="font-size:11px;line-height:1.6">${e.type?`<strong>[${e.type}]</strong> `:''} ${desc}</td><td style="font-family:monospace;font-size:11px;color:#666">${e.file_no||'—'}</td><td class="num c-green">${+e.debit?fmt2(e.debit):'—'}</td><td class="num c-red">${+e.credit?fmt2(e.credit):'—'}</td><td class="num" style="font-weight:700;color:${running>=0?'#16a34a':'#dc2626'}">${fmt2(Math.abs(running))}</td></tr>`; });
  const pDate = new Date().toLocaleDateString('en-GB');
  const fragment = `
  <div class="doc-header">
    <div class="doc-header-right"><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMDAgMjAwIiB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEzNSUiIHkyPSIxMzUlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6IzFDMTkxNyIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMyQzI5MjYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImxpbmUiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgICBzdHlsZT0ic3RvcC1jb2xvcjojNzg3MTZDO3N0b3Atb3BhY2l0eTowIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMjAlIiAgc3R5bGU9InN0b3AtY29sb3I6I0M4QzRCQTtzdG9wLW9wYWNpdHk6MSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjgwJSIgIHN0eWxlPSJzdG9wLWNvbG9yOiNGOUY4RjY7c3RvcC1vcGFjaXR5OjEiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojRjlGOEY2O3N0b3Atb3BhY2l0eTowLjMiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9Imdsb3ciIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgICBzdHlsZT0ic3RvcC1jb2xvcjojNDQ0MDNDO3N0b3Atb3BhY2l0eTowIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iNTAlIiAgc3R5bGU9InN0b3AtY29sb3I6IzZCNjU2MDtzdG9wLW9wYWNpdHk6MC4zIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3R5bGU9InN0b3AtY29sb3I6IzQ0NDAzQztzdG9wLW9wYWNpdHk6MCIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxmaWx0ZXIgaWQ9InNvZnQiPgogICAgICA8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIwLjgiLz4KICAgIDwvZmlsdGVyPgogICAgPGZpbHRlciBpZD0iZ2xvdy1maWx0ZXIiPgogICAgICA8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIyIiByZXN1bHQ9ImJsdXIiLz4KICAgICAgPGZlQ29tcG9zaXRlIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9ImJsdXIiIG9wZXJhdG9yPSJvdmVyIi8+CiAgICA8L2ZpbHRlcj4KICA8L2RlZnM+CgogIDwhLS0g2K7ZhNmB2YrYqSAtLT4KICA8cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgcng9IjM4IiByeT0iMzgiIGZpbGw9InVybCgjYmcpIi8+CgogIDwhLS0g2KrZiNmH2Kwg2K7ZgdmK2YEg2YHZiiDYp9mE2YXZhtiq2LXZgSAtLT4KICA8ZWxsaXBzZSBjeD0iMTAwIiBjeT0iOTUiIHJ4PSI3NSIgcnk9IjUwIiBmaWxsPSIjNDQ0MDNDIiBvcGFjaXR5PSIwLjE1Ii8+CgogIDwhLS0g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCiAgICAgICDYp9mE2LTYp9it2YbYqSDYqNiu2Lcg2YjYp9it2K8g2YXYqti12YQKICAgICAgINin2YTYrti3INmK2KjYr9ijINmF2YYg2KfZhNmK2LPYp9ixINmI2YrYtNmD2YQg2KfZhNi02KfYrdmG2KkKICAgICAgINir2YUg2YrYqtit2YjZhCDZhNit2LHZiNmBIFRJQwogIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkCAtLT4KCiAgPCEtLSDYrti3INin2YTYs9ix2LnYqSDYrtmE2YEg2KfZhNi02KfYrdmG2KkgKG1vdGlvbiBsaW5lcykgLS0+CiAgPGxpbmUgeDE9IjE0IiB5MT0iODEiIHgyPSIzNCIgeTI9IjgxIiBzdHJva2U9IiM0NDQwM0MiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8bGluZSB4MT0iMTAiIHkxPSI4OSIgeDI9IjM0IiB5Mj0iODkiIHN0cm9rZT0iIzNDMzgzNCIgc3Ryb2tlLXdpZHRoPSIxIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8bGluZSB4MT0iMTYiIHkxPSI5NyIgeDI9IjM0IiB5Mj0iOTciIHN0cm9rZT0iIzQ0NDAzQyIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgoKICA8IS0tINin2YTYtNin2K3ZhtipIOKAlCDYrti3INmI2KfYrdivINmF2KrYtdmEIC0tPgogIDwhLS0g2KfZhNmF2LPYp9ixINin2YTZg9in2YXZhCDZhNmE2LTYp9it2YbYqSAtLT4KICA8cGF0aCBkPSIKICAgIE0gMzQgOTcKICAgIEwgMzQgNzAKICAgIEwgMTAwIDcwCiAgICBMIDEwMCA1OAogICAgTCAxMjggNTgKICAgIEwgMTQwIDcwCiAgICBMIDE1NSA3MAogICAgTCAxNTUgNzYKICAgIEwgMTYwIDc2CiAgICBMIDE2MCA5NwogICAgTCAxNTUgOTcKICAgIE0gMzQgOTcKICAgIEwgMTU1IDk3CiAgIgogICAgZmlsbD0ibm9uZSIKICAgIHN0cm9rZT0idXJsKCNsaW5lKSIKICAgIHN0cm9rZS13aWR0aD0iMi4yIgogICAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogICAgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIKICAvPgoKICA8IS0tINiq2YHYp9i12YrZhCDYp9mE2LTYp9it2YbYqSDYr9in2K7ZhNmK2KkgLS0+CiAgPCEtLSDZgdin2LXZhCDYp9mE2YPYp9io2YrZhtipINmI2KfZhNi12YbYr9mI2YIgLS0+CiAgPGxpbmUgeDE9IjEwMCIgeTE9IjcwIiB4Mj0iMTAwIiB5Mj0iOTciIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC43Ii8+CgogIDwhLS0g2LLYrNin2Kwg2KfZhNmD2KfYqNmK2YbYqSAtLT4KICA8cGF0aCBkPSJNIDEwNSA2MyBMIDEyOCA2MyBMIDEzOCA3MyBMIDEwNSA3MyBaIgogICAgZmlsbD0iIzJDMjkyNiIgb3BhY2l0eT0iMC42Ii8+CiAgPHBhdGggZD0iTSAxMDUgNjMgTCAxMjggNjMgTCAxMzggNzMgTCAxMDUgNzMgWiIKICAgIGZpbGw9Im5vbmUiIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxIiBvcGFjaXR5PSIwLjUiLz4KCiAgPCEtLSDZhdi12KjYp9itINij2YXYp9mF2YogLS0+CiAgPHJlY3QgeD0iMTU2IiB5PSI4MiIgd2lkdGg9IjUiIGhlaWdodD0iNyIgcng9IjIiIGZpbGw9IiNGOUY4RjYiIG9wYWNpdHk9IjAuOSIvPgogIDwhLS0g2KPYtNi52Kkg2KfZhNiz2LHYudipINmF2YYg2KfZhNmF2LXYqNin2K0gLS0+CiAgPGxpbmUgeDE9IjE2MSIgeTE9IjgzIiB4Mj0iMTcwIiB5Mj0iNzkiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC43Ii8+CiAgPGxpbmUgeDE9IjE2MSIgeTE9Ijg2IiB4Mj0iMTcyIiB5Mj0iODUiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC42Ii8+CiAgPGxpbmUgeDE9IjE2MSIgeTE9Ijg5IiB4Mj0iMTcwIiB5Mj0iOTIiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC41Ii8+CgogIDwhLS0g2YXYtdio2KfYrSDYrtmE2YHZiiAtLT4KICA8cmVjdCB4PSIzMCIgeT0iODIiIHdpZHRoPSI1IiBoZWlnaHQ9IjciIHJ4PSIyIiBmaWxsPSIjQzAzOTJCIiBvcGFjaXR5PSIwLjgiLz4KCiAgPCEtLSDYp9mE2LnYrNmE2KfYqiDigJQg2KzYstihINmF2YYg2KfZhNiu2Lcg2KfZhNmF2KrYtdmEIC0tPgogIDwhLS0g2LnYrNmE2Kkg2K7ZhNmB2YrYqSDYo9mI2YTZiSAtLT4KICA8Y2lyY2xlIGN4PSI1NSIgY3k9Ijk3IiByPSIxMSIgZmlsbD0iIzFDMTkxNyIgc3Ryb2tlPSIjQzhDNEJBIiBzdHJva2Utd2lkdGg9IjEuOCIvPgogIDxjaXJjbGUgY3g9IjU1IiBjeT0iOTciIHI9IjUuNSIgZmlsbD0iIzJDMjkyNiIvPgogIDxjaXJjbGUgY3g9IjU1IiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINi52KzZhNipINiu2YTZgdmK2Kkg2KvYp9mG2YrYqSAtLT4KICA8Y2lyY2xlIGN4PSI4MiIgY3k9Ijk3IiByPSIxMSIgZmlsbD0iIzFDMTkxNyIgc3Ryb2tlPSIjQzhDNEJBIiBzdHJva2Utd2lkdGg9IjEuOCIvPgogIDxjaXJjbGUgY3g9IjgyIiBjeT0iOTciIHI9IjUuNSIgZmlsbD0iIzJDMjkyNiIvPgogIDxjaXJjbGUgY3g9IjgyIiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINi52KzZhNipINij2YXYp9mF2YrYqSAtLT4KICA8Y2lyY2xlIGN4PSIxNDAiIGN5PSI5NyIgcj0iMTEiIGZpbGw9IiMxQzE5MTciIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxLjgiLz4KICA8Y2lyY2xlIGN4PSIxNDAiIGN5PSI5NyIgcj0iNS41IiBmaWxsPSIjMkMyOTI2Ii8+CiAgPGNpcmNsZSBjeD0iMTQwIiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINin2YTYtNin2LPZitmHIC0tPgogIDxsaW5lIHgxPSIzNCIgeTE9IjEwNiIgeDI9IjE2MiIgeTI9IjEwNiIgc3Ryb2tlPSIjNTc1MzRFIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgoKICA8IS0tIOKVkOKVkOKVkCDYrti3INmB2KfYtdmEIOKVkOKVkOKVkCAtLT4KICA8bGluZSB4MT0iMzAiIHkxPSIxMTgiIHgyPSIxNzAiIHkyPSIxMTgiIHN0cm9rZT0idXJsKCNnbG93KSIgc3Ryb2tlLXdpZHRoPSIxIi8+CgogIDwhLS0g4pWQ4pWQ4pWQINit2LHZiNmBIFRJQyDilZDilZDilZAgLS0+CiAgPHRleHQgeD0iMTAwIiB5PSIxNTEiCiAgICBmb250LWZhbWlseT0iJ1RyZWJ1Y2hldCBNUycsICdDZW50dXJ5IEdvdGhpYycsIEZ1dHVyYSwgc2Fucy1zZXJpZiIKICAgIGZvbnQtc2l6ZT0iMjgiCiAgICBmb250LXdlaWdodD0iNzAwIgogICAgZmlsbD0iI0Y5RjhGNiIKICAgIHRleHQtYW5jaG9yPSJtaWRkbGUiCiAgICBsZXR0ZXItc3BhY2luZz0iMTAiCiAgICBzdHlsZT0iZm9udC1zdHJldGNoOmNvbmRlbnNlZCI+VElDPC90ZXh0PgoKICA8IS0tIOKVkOKVkOKVkCDYp9mE2YbYtSDYp9mE2LXYutmK2LEg4pWQ4pWQ4pWQIC0tPgogIDx0ZXh0IHg9IjEwMCIgeT0iMTcyIgogICAgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIgogICAgZm9udC1zaXplPSI4LjUiCiAgICBmaWxsPSIjQThBNDlDIgogICAgdGV4dC1hbmNob3I9Im1pZGRsZSIKICAgIGxldHRlci1zcGFjaW5nPSIyLjUiPlRSQU5TSVQgSU5URVJOQVRJT05BTCBDTy48L3RleHQ+CgogIDwhLS0g2YbZgtin2Lcg2LPYsdi52Kkg2KrYstmK2YbZitipIC0tPgogIDxjaXJjbGUgY3g9IjE4IiBjeT0iODQiIHI9IjEuMiIgZmlsbD0iIzQ0NDAzQyIgb3BhY2l0eT0iMC44Ii8+CiAgPGNpcmNsZSBjeD0iMTMiIGN5PSI5MSIgcj0iMC45IiBmaWxsPSIjM0MzODM0IiBvcGFjaXR5PSIwLjYiLz4KICA8Y2lyY2xlIGN4PSIyMCIgY3k9Ijk5IiByPSIxLjIiIGZpbGw9IiM0NDQwM0MiIG9wYWNpdHk9IjAuOCIvPgoKPC9zdmc+Cg==" alt="TIC" style="width:44px;height:44px;border-radius:9px;display:block;margin-bottom:5px"><div class="doc-company">Transit International Company</div><div class="doc-company-sub" style="margin-top:4px">تاريخ الطباعة: ${pDate}</div></div>
    <div class="doc-header-left">
      <div class="doc-title">كشف حساب</div>
      <span class="contact-badge" style="background:${color};color:#fff">${typeLabels[contactType]||contactType}</span>
      <div style="font-size:18px;font-weight:900;margin-top:6px">${contactName}</div>
      ${fileFilter?`<div class="doc-subtitle">ملف: ${fileFilter}</div>`:''}
    </div>
  </div>
  <div class="kpi-row">
    <div class="kpi-cell"><div class="kpi-label">إجمالي المدين</div><div class="kpi-val c-green">${fmt2(totalDebit)}</div></div>
    <div class="kpi-cell" style="border-color:#dc2626"><div class="kpi-label">إجمالي الدائن</div><div class="kpi-val c-red">${fmt2(totalCredit)}</div></div>
    <div class="kpi-cell" style="border-color:${finalBal>=0?'#16a34a':'#dc2626'}"><div class="kpi-label">الرصيد الحالي</div><div class="kpi-val ${finalBal>=0?'c-green':'c-red'}">${fmt2(Math.abs(finalBal))} ${finalBal>=0?'مدين':'دائن'}</div></div>
    <div class="kpi-cell" style="border-color:#888"><div class="kpi-label">عدد الحركات</div><div class="kpi-val">${list.length}</div></div>
  </div>
  <table><colgroup><col style="width:80px"><col><col style="width:70px"><col style="width:13%"><col style="width:13%"><col style="width:14%"></colgroup>
    <thead><tr><th>التاريخ</th><th>البيان</th><th>الملف</th><th style="text-align:left">مدين</th><th style="text-align:left">دائن</th><th style="text-align:left">الرصيد</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="3">الإجمالي</td><td class="num c-green">${fmt2(totalDebit)}</td><td class="num c-red">${fmt2(totalCredit)}</td><td class="num ${finalBal>=0?'c-green':'c-red'}">${fmt2(Math.abs(finalBal))} ${finalBal>=0?'مدين':'دائن'}</td></tr></tfoot>
  </table>
  <div class="sig-row"><div class="sig-cell">توقيع المحاسب</div><div class="sig-cell">توقيع المدير</div></div>
  <div class="doc-footer">Transit International Company · تم الإنشاء بتاريخ ${pDate}</div>`;
  renderPrint(fragment, `كشف حساب — ${contactName}`);
}

// ════════════════════════════════════════════════════════════
// SECTION 13 — Deal Statement
// ════════════════════════════════════════════════════════════
async function printDealStatement(fileNo) {
  let d = window._dealStatementData;
  if (fileNo && (!d || d.fn!==fileNo)) {
    toast('⏳ جاري تحميل كشف الصفقة...', 'ok');
    try { await loadDealStatement(fileNo, state.system); d=window._dealStatementData; }
    catch(e) { toast('خطأ: '+e.message,'err'); return; }
  }
  if (!d) { toast('افتح كشف الصفقة أولاً','err'); return; }
  const {fn,deal,entries,totalPurchase,totalPaid,totalExp,totalSales,totalColl,profit} = d;
  let running = 0;
  const rows = entries.map(e => { if(e._pl){if(e.debit>0)running+=e.debit;if(e.credit>0)running-=e.credit;} return `<tr><td>${e.date||'—'}</td><td>${e.type}${!e._pl?' *':''}</td><td><b>${e.desc}</b>${e.extra?`<br><small>${e.extra}</small>`:''}</td><td>${e.party}</td><td class="num c-green">${e.debit>0?e.debit.toLocaleString('en-US',{minimumFractionDigits:2}):'—'}</td><td class="num c-red">${e.credit>0?e.credit.toLocaleString('en-US',{minimumFractionDigits:2}):'—'}</td><td class="num" style="font-weight:700;color:${e._pl?(running>=0?'#16a34a':'#dc2626'):'#aaa'}">${e._pl?Math.abs(running).toLocaleString('en-US',{minimumFractionDigits:2}):'—'}</td></tr>`; }).join('');
  const fragment = `
  <div class="doc-header">
    <div class="doc-header-right"><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMDAgMjAwIiB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEzNSUiIHkyPSIxMzUlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6IzFDMTkxNyIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMyQzI5MjYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImxpbmUiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgICBzdHlsZT0ic3RvcC1jb2xvcjojNzg3MTZDO3N0b3Atb3BhY2l0eTowIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMjAlIiAgc3R5bGU9InN0b3AtY29sb3I6I0M4QzRCQTtzdG9wLW9wYWNpdHk6MSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjgwJSIgIHN0eWxlPSJzdG9wLWNvbG9yOiNGOUY4RjY7c3RvcC1vcGFjaXR5OjEiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojRjlGOEY2O3N0b3Atb3BhY2l0eTowLjMiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9Imdsb3ciIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgICBzdHlsZT0ic3RvcC1jb2xvcjojNDQ0MDNDO3N0b3Atb3BhY2l0eTowIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iNTAlIiAgc3R5bGU9InN0b3AtY29sb3I6IzZCNjU2MDtzdG9wLW9wYWNpdHk6MC4zIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3R5bGU9InN0b3AtY29sb3I6IzQ0NDAzQztzdG9wLW9wYWNpdHk6MCIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxmaWx0ZXIgaWQ9InNvZnQiPgogICAgICA8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIwLjgiLz4KICAgIDwvZmlsdGVyPgogICAgPGZpbHRlciBpZD0iZ2xvdy1maWx0ZXIiPgogICAgICA8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIyIiByZXN1bHQ9ImJsdXIiLz4KICAgICAgPGZlQ29tcG9zaXRlIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9ImJsdXIiIG9wZXJhdG9yPSJvdmVyIi8+CiAgICA8L2ZpbHRlcj4KICA8L2RlZnM+CgogIDwhLS0g2K7ZhNmB2YrYqSAtLT4KICA8cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgcng9IjM4IiByeT0iMzgiIGZpbGw9InVybCgjYmcpIi8+CgogIDwhLS0g2KrZiNmH2Kwg2K7ZgdmK2YEg2YHZiiDYp9mE2YXZhtiq2LXZgSAtLT4KICA8ZWxsaXBzZSBjeD0iMTAwIiBjeT0iOTUiIHJ4PSI3NSIgcnk9IjUwIiBmaWxsPSIjNDQ0MDNDIiBvcGFjaXR5PSIwLjE1Ii8+CgogIDwhLS0g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCiAgICAgICDYp9mE2LTYp9it2YbYqSDYqNiu2Lcg2YjYp9it2K8g2YXYqti12YQKICAgICAgINin2YTYrti3INmK2KjYr9ijINmF2YYg2KfZhNmK2LPYp9ixINmI2YrYtNmD2YQg2KfZhNi02KfYrdmG2KkKICAgICAgINir2YUg2YrYqtit2YjZhCDZhNit2LHZiNmBIFRJQwogIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkCAtLT4KCiAgPCEtLSDYrti3INin2YTYs9ix2LnYqSDYrtmE2YEg2KfZhNi02KfYrdmG2KkgKG1vdGlvbiBsaW5lcykgLS0+CiAgPGxpbmUgeDE9IjE0IiB5MT0iODEiIHgyPSIzNCIgeTI9IjgxIiBzdHJva2U9IiM0NDQwM0MiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8bGluZSB4MT0iMTAiIHkxPSI4OSIgeDI9IjM0IiB5Mj0iODkiIHN0cm9rZT0iIzNDMzgzNCIgc3Ryb2tlLXdpZHRoPSIxIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8bGluZSB4MT0iMTYiIHkxPSI5NyIgeDI9IjM0IiB5Mj0iOTciIHN0cm9rZT0iIzQ0NDAzQyIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgoKICA8IS0tINin2YTYtNin2K3ZhtipIOKAlCDYrti3INmI2KfYrdivINmF2KrYtdmEIC0tPgogIDwhLS0g2KfZhNmF2LPYp9ixINin2YTZg9in2YXZhCDZhNmE2LTYp9it2YbYqSAtLT4KICA8cGF0aCBkPSIKICAgIE0gMzQgOTcKICAgIEwgMzQgNzAKICAgIEwgMTAwIDcwCiAgICBMIDEwMCA1OAogICAgTCAxMjggNTgKICAgIEwgMTQwIDcwCiAgICBMIDE1NSA3MAogICAgTCAxNTUgNzYKICAgIEwgMTYwIDc2CiAgICBMIDE2MCA5NwogICAgTCAxNTUgOTcKICAgIE0gMzQgOTcKICAgIEwgMTU1IDk3CiAgIgogICAgZmlsbD0ibm9uZSIKICAgIHN0cm9rZT0idXJsKCNsaW5lKSIKICAgIHN0cm9rZS13aWR0aD0iMi4yIgogICAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogICAgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIKICAvPgoKICA8IS0tINiq2YHYp9i12YrZhCDYp9mE2LTYp9it2YbYqSDYr9in2K7ZhNmK2KkgLS0+CiAgPCEtLSDZgdin2LXZhCDYp9mE2YPYp9io2YrZhtipINmI2KfZhNi12YbYr9mI2YIgLS0+CiAgPGxpbmUgeDE9IjEwMCIgeTE9IjcwIiB4Mj0iMTAwIiB5Mj0iOTciIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC43Ii8+CgogIDwhLS0g2LLYrNin2Kwg2KfZhNmD2KfYqNmK2YbYqSAtLT4KICA8cGF0aCBkPSJNIDEwNSA2MyBMIDEyOCA2MyBMIDEzOCA3MyBMIDEwNSA3MyBaIgogICAgZmlsbD0iIzJDMjkyNiIgb3BhY2l0eT0iMC42Ii8+CiAgPHBhdGggZD0iTSAxMDUgNjMgTCAxMjggNjMgTCAxMzggNzMgTCAxMDUgNzMgWiIKICAgIGZpbGw9Im5vbmUiIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxIiBvcGFjaXR5PSIwLjUiLz4KCiAgPCEtLSDZhdi12KjYp9itINij2YXYp9mF2YogLS0+CiAgPHJlY3QgeD0iMTU2IiB5PSI4MiIgd2lkdGg9IjUiIGhlaWdodD0iNyIgcng9IjIiIGZpbGw9IiNGOUY4RjYiIG9wYWNpdHk9IjAuOSIvPgogIDwhLS0g2KPYtNi52Kkg2KfZhNiz2LHYudipINmF2YYg2KfZhNmF2LXYqNin2K0gLS0+CiAgPGxpbmUgeDE9IjE2MSIgeTE9IjgzIiB4Mj0iMTcwIiB5Mj0iNzkiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC43Ii8+CiAgPGxpbmUgeDE9IjE2MSIgeTE9Ijg2IiB4Mj0iMTcyIiB5Mj0iODUiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC42Ii8+CiAgPGxpbmUgeDE9IjE2MSIgeTE9Ijg5IiB4Mj0iMTcwIiB5Mj0iOTIiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC41Ii8+CgogIDwhLS0g2YXYtdio2KfYrSDYrtmE2YHZiiAtLT4KICA8cmVjdCB4PSIzMCIgeT0iODIiIHdpZHRoPSI1IiBoZWlnaHQ9IjciIHJ4PSIyIiBmaWxsPSIjQzAzOTJCIiBvcGFjaXR5PSIwLjgiLz4KCiAgPCEtLSDYp9mE2LnYrNmE2KfYqiDigJQg2KzYstihINmF2YYg2KfZhNiu2Lcg2KfZhNmF2KrYtdmEIC0tPgogIDwhLS0g2LnYrNmE2Kkg2K7ZhNmB2YrYqSDYo9mI2YTZiSAtLT4KICA8Y2lyY2xlIGN4PSI1NSIgY3k9Ijk3IiByPSIxMSIgZmlsbD0iIzFDMTkxNyIgc3Ryb2tlPSIjQzhDNEJBIiBzdHJva2Utd2lkdGg9IjEuOCIvPgogIDxjaXJjbGUgY3g9IjU1IiBjeT0iOTciIHI9IjUuNSIgZmlsbD0iIzJDMjkyNiIvPgogIDxjaXJjbGUgY3g9IjU1IiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINi52KzZhNipINiu2YTZgdmK2Kkg2KvYp9mG2YrYqSAtLT4KICA8Y2lyY2xlIGN4PSI4MiIgY3k9Ijk3IiByPSIxMSIgZmlsbD0iIzFDMTkxNyIgc3Ryb2tlPSIjQzhDNEJBIiBzdHJva2Utd2lkdGg9IjEuOCIvPgogIDxjaXJjbGUgY3g9IjgyIiBjeT0iOTciIHI9IjUuNSIgZmlsbD0iIzJDMjkyNiIvPgogIDxjaXJjbGUgY3g9IjgyIiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINi52KzZhNipINij2YXYp9mF2YrYqSAtLT4KICA8Y2lyY2xlIGN4PSIxNDAiIGN5PSI5NyIgcj0iMTEiIGZpbGw9IiMxQzE5MTciIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxLjgiLz4KICA8Y2lyY2xlIGN4PSIxNDAiIGN5PSI5NyIgcj0iNS41IiBmaWxsPSIjMkMyOTI2Ii8+CiAgPGNpcmNsZSBjeD0iMTQwIiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINin2YTYtNin2LPZitmHIC0tPgogIDxsaW5lIHgxPSIzNCIgeTE9IjEwNiIgeDI9IjE2MiIgeTI9IjEwNiIgc3Ryb2tlPSIjNTc1MzRFIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgoKICA8IS0tIOKVkOKVkOKVkCDYrti3INmB2KfYtdmEIOKVkOKVkOKVkCAtLT4KICA8bGluZSB4MT0iMzAiIHkxPSIxMTgiIHgyPSIxNzAiIHkyPSIxMTgiIHN0cm9rZT0idXJsKCNnbG93KSIgc3Ryb2tlLXdpZHRoPSIxIi8+CgogIDwhLS0g4pWQ4pWQ4pWQINit2LHZiNmBIFRJQyDilZDilZDilZAgLS0+CiAgPHRleHQgeD0iMTAwIiB5PSIxNTEiCiAgICBmb250LWZhbWlseT0iJ1RyZWJ1Y2hldCBNUycsICdDZW50dXJ5IEdvdGhpYycsIEZ1dHVyYSwgc2Fucy1zZXJpZiIKICAgIGZvbnQtc2l6ZT0iMjgiCiAgICBmb250LXdlaWdodD0iNzAwIgogICAgZmlsbD0iI0Y5RjhGNiIKICAgIHRleHQtYW5jaG9yPSJtaWRkbGUiCiAgICBsZXR0ZXItc3BhY2luZz0iMTAiCiAgICBzdHlsZT0iZm9udC1zdHJldGNoOmNvbmRlbnNlZCI+VElDPC90ZXh0PgoKICA8IS0tIOKVkOKVkOKVkCDYp9mE2YbYtSDYp9mE2LXYutmK2LEg4pWQ4pWQ4pWQIC0tPgogIDx0ZXh0IHg9IjEwMCIgeT0iMTcyIgogICAgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIgogICAgZm9udC1zaXplPSI4LjUiCiAgICBmaWxsPSIjQThBNDlDIgogICAgdGV4dC1hbmNob3I9Im1pZGRsZSIKICAgIGxldHRlci1zcGFjaW5nPSIyLjUiPlRSQU5TSVQgSU5URVJOQVRJT05BTCBDTy48L3RleHQ+CgogIDwhLS0g2YbZgtin2Lcg2LPYsdi52Kkg2KrYstmK2YbZitipIC0tPgogIDxjaXJjbGUgY3g9IjE4IiBjeT0iODQiIHI9IjEuMiIgZmlsbD0iIzQ0NDAzQyIgb3BhY2l0eT0iMC44Ii8+CiAgPGNpcmNsZSBjeD0iMTMiIGN5PSI5MSIgcj0iMC45IiBmaWxsPSIjM0MzODM0IiBvcGFjaXR5PSIwLjYiLz4KICA8Y2lyY2xlIGN4PSIyMCIgY3k9Ijk5IiByPSIxLjIiIGZpbGw9IiM0NDQwM0MiIG9wYWNpdHk9IjAuOCIvPgoKPC9zdmc+Cg==" alt="TIC" style="width:44px;height:44px;border-radius:9px;display:block;margin-bottom:5px"><div class="doc-company">Transit International Company</div><div class="doc-company-sub">${new Date().toLocaleDateString('en-GB')}</div></div>
    <div class="doc-header-left"><div class="doc-title">كشف الصفقة</div><div class="doc-ref"># ${fn}</div><div class="doc-subtitle">المورد: ${deal.supplier||'—'} · تاريخ: ${deal.po_date||'—'}</div></div>
  </div>
  <div class="kpi-row">
    <div class="kpi-cell" style="border-color:#2563eb"><div class="kpi-label">تكلفة الشراء</div><div class="kpi-val c-blue">${totalPurchase.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi-cell" style="border-color:#0891b2"><div class="kpi-label">المدفوع</div><div class="kpi-val" style="color:#0891b2">${totalPaid.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi-cell" style="border-color:#dc2626"><div class="kpi-label">المصاريف</div><div class="kpi-val c-red">${totalExp.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi-cell" style="border-color:#16a34a"><div class="kpi-label">المبيعات</div><div class="kpi-val c-green">${totalSales.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi-cell" style="border-color:#16a34a"><div class="kpi-label">المحصّل</div><div class="kpi-val c-green">${totalColl.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi-cell" style="border-color:${profit>=0?'#16a34a':'#dc2626'}"><div class="kpi-label">صافي الربح</div><div class="kpi-val ${profit>=0?'c-green':'c-red'}">${Math.abs(profit).toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
  </div>
  <table>
    <thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>الطرف</th><th style="text-align:left">مدين</th><th style="text-align:left">دائن</th><th style="text-align:left">الرصيد</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="doc-footer">Transit International Company · كشف الصفقة · ${fn}</div>`;
  renderPrint(fragment, `كشف الصفقة — ${fn}`);
}

// ════════════════════════════════════════════════════════════
// SECTION 14 — Contact Statement (Operations)
// ════════════════════════════════════════════════════════════
function printContactStatement() {
  const name    = csState.contactName;
  const content = el('cs-table')?.innerHTML || '';
  const kpis    = el('cs-kpis')?.innerHTML  || '';
  printSection(`كشف حساب — ${name}`, `نظام ${state.system}`, kpis + content);
}
