// ╔══════════════════════════════════════════════════════════╗
// ║  journal-notes.js — ملاحظات الإدخالات في اليومية          ║
// ╚══════════════════════════════════════════════════════════╝
//
// اليومية (journal.js) بتعرض «بيان» القيد بس — ومفيش كاتب قيود بيحط فيه خانة
// «ملاحظات» بتاعة الإدخال (غير معاملات الشركاء من 2026-09-22). فحص 2026-09-29:
// ~600 ملاحظة مكتوبة في BOX+TM (دفعات، تحصيلات، مبيعات، شراء، مصروفات…) ولا
// واحدة ظاهرة في اليومية. الملف ده بيجيب الملاحظات من السجل الأصلي نفسه وقت
// العرض ويحطها سطر لوحده تحت عنوان القيد (📝) وفي كارت تفاصيل القيد — فبيغطي
// القديم كله، وأي تعديل لاحق على الملاحظة بيظهر على طول، ومفيش بيانات بتتغيّر.
//
// إضافة مستقلة عمدًا: بتراقب #journalTimeline و#jqd-body (MutationObserver)
// بدل تعديل journal.js، وبتقرا window.journalState بس. لو شكل اليومية اتغيّر
// ومالقتش العناصر، مش بتعمل حاجة (مفيش أخطاء).

// ref_table في القيد ← جدول السجل الأصلي وعمود الربط
const SOURCES = {
  payments:           { table:'payments',           key:'id' },
  collections:        { table:'collections',        key:'id' },
  expenses:           { table:'expenses',           key:'id' },
  partner_ledger:     { table:'partner_ledger',     key:'id' },
  partner_payouts:    { table:'partner_payouts',    key:'id' },
  operating_expenses: { table:'operating_expenses', key:'ref_no' },
  sales:              { table:'sales',              key:'inv_no' },
  purchase_orders:    { table:'purchase_orders',    key:'id' },
};

// نصوص بيضيفها البرنامج نفسه على الملاحظات (إلغاء/رفض/مستحق…) — مش ملاحظة المستخدم
const SYSTEM_NOTE_RE = /مُلغى بتاريخ|ملغى بتاريخ|مرفوض بتاريخ|طلب إلغاء بتاريخ|استُرد طلب الإلغاء|حُذفت من الفاتورة|باقي الفاتورة|استُهلك بالكامل|مستحق مُعاد/;
const userNote = n => [...new Set(String(n || '').split('|').map(s => s.trim()).filter(s => s && !SYSTEM_NOTE_RE.test(s)))].join(' | ');

// كاش: `${sys}|${table}|${key}` ← نص الملاحظة ('' = مفيش)
const _cache = new Map();

function _sourceOf(entry) {
  const g = entry?.raw || {};
  const src = SOURCES[g.ref_table];
  if (!src) return null;
  // قيد بيع قديم بلا ref_id (قبل post_sale_je) — رقم الفاتورة من البيان
  let val = g.ref_id;
  if (!val && g.ref_table === 'sales' && typeof window._extractInvToken === 'function') val = window._extractInvToken(entry.title);
  // قيد شراء قديم بلا ref_id — سند الشراء واحد لكل ملف
  if (!val && g.ref_table === 'purchase_orders' && g.file_no) return { table:'purchase_orders', key:'file_no', val:String(g.file_no) };
  if (!val) return null;
  return { ...src, val: String(val), fileNo: g.file_no || null };
}

async function _fetchNotes(sys, pairs) {
  // pairs: [{table,key,val,fileNo}] — نجيب الناقص بس، مجمّع لكل جدول+عمود
  // (الشراء بيتربط بالـid أو بالملف للقديم — خلطهم في استعلام واحد بيفشّله كله)
  const need = {};
  pairs.forEach(p => {
    const ck = `${sys}|${p.table}|${p.val}`;
    if (_cache.has(ck)) return;
    (need[`${p.table}|${p.key}`] = need[`${p.table}|${p.key}`] || { table:p.table, key:p.key, vals:new Set() }).vals.add(p.val);
  });
  for (const { table, key, vals } of Object.values(need)) {
    const list = [...vals];
    for (let i = 0; i < list.length; i += 60) {
      const chunk = list.slice(i, i + 60);
      try {
        const rows = await window.apiGetAll(table, {
          select: `${key},notes`, system_type: `eq.${sys}`,
          [key]: `in.(${chunk.map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(',')})`,
        });
        const byVal = {};
        (rows || []).forEach(r => { const k = String(r[key]); (byVal[k] = byVal[k] || []).push(r.notes); });
        chunk.forEach(v => _cache.set(`${sys}|${table}|${v}`, userNote((byVal[v] || []).join(' | '))));
      } catch (e) {
        console.warn('journal-notes: فشل جلب الملاحظات من', table, e.message);
        chunk.forEach(v => _cache.set(`${sys}|${table}|${v}`, ''));
      }
    }
  }
}

function _noteFor(sys, entry) {
  const src = _sourceOf(entry);
  if (!src) return '';
  const note = _cache.get(`${sys}|${src.table}|${src.val}`) || '';
  // معاملات الشركاء من 2026-09-22 بتحط الملاحظة في البيان نفسه — مانكرّرهاش
  if (note && (entry.title || '').includes(note.slice(0, 30))) return '';
  return note;
}

function _entryByNo(no) {
  return (window.journalState?.entries || []).find(e => e.entryNo === no) || null;
}

let _busy = false, _again = false;
async function _enrichTimeline() {
  if (_busy) { _again = true; return; }
  _busy = true;
  try {
    const box = document.getElementById('journalTimeline');
    const sys = window.state?.system;
    if (!box || !sys) return;
    const targets = [...box.querySelectorAll('.j-entry')]
      .map(card => ({ card, no: card.querySelector('.j-entry-actions')?.dataset?.eno }))
      .filter(t => t.no && !t.card.dataset.notesDone);
    if (!targets.length) return;
    const pairs = targets.map(t => _sourceOf(_entryByNo(t.no))).filter(Boolean);
    await _fetchNotes(sys, pairs);
    targets.forEach(({ card, no }) => {
      card.dataset.notesDone = '1';
      const note = _noteFor(sys, _entryByNo(no));
      const title = card.querySelector('.j-entry-title');
      if (!note || !title) return;
      const div = document.createElement('div');
      div.className = 'j-entry-note';
      div.style.cssText = 'font-size:12px;color:var(--text2);margin:-2px 0 5px;white-space:normal;line-height:1.5';
      div.textContent = '📝 ' + note;
      title.insertAdjacentElement('afterend', div);
    });
  } finally {
    _busy = false;
    if (_again) { _again = false; _enrichTimeline(); }
  }
}

async function _enrichDetail() {
  const body = document.getElementById('jqd-body');
  const no = document.getElementById('jqd-title')?.textContent?.trim();
  const sys = window.state?.system;
  if (!body || !no || !sys || body.querySelector('.jqd-note')) return;
  const entry = _entryByNo(no);
  const src = _sourceOf(entry);
  if (!src) return;
  await _fetchNotes(sys, [src]);
  const note = _noteFor(sys, entry);
  if (!note || body.querySelector('.jqd-note')) return;
  const div = document.createElement('div');
  div.className = 'jqd-note';
  div.style.cssText = 'background:var(--card2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px;line-height:1.6;white-space:pre-wrap';
  const label = document.createElement('div');
  label.style.cssText = 'font-size:12px;font-weight:700;color:var(--text2);margin-bottom:4px';
  label.textContent = '📝 الملاحظات';
  div.appendChild(label);
  div.appendChild(document.createTextNode(note));
  body.prepend(div);
}

function _watch(id, fn) {
  const node = document.getElementById(id);
  if (!node) return;
  let t = null;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(fn, 60); })
    .observe(node, { childList: true, subtree: true });
}

function _init() {
  _watch('journalTimeline', _enrichTimeline);
  _watch('jqd-body', _enrichDetail);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
else _init();
