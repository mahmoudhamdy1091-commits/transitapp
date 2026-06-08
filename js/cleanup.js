// ╔══════════════════════════════════════════════════════════╗
// ║  cleanup.js — أداة فحص وتصحيح البيانات القديمة (يدوي)   ║
// ║  تشغيل: افتح التطبيق وسجّل دخول، ثم نفّذ في الـ console: ║
// ║         openDataCleanupTool()                            ║
// ║  المبدأ: عرض كل سجل + تأكيد يدوي قبل أي تعديل/حذف —    ║
// ║          لا يوجد أي إجراء تلقائي بالجملة.               ║
// ╚══════════════════════════════════════════════════════════╝

const CLEANUP_TABLES = ['payments','expenses','collections','partner_payouts'];

// ── فحص ملف معيّن: مصاريف draft متبقية من النظام القديم (ref_no ينتهي بـ -E) ──
// تشغيل: inspectFileDraftLeftovers('BOX-126')
// هذه السجلات draft (لم تُرحَّل، لا قيد محاسبي مرتبط بها) — الحذف الفعلي آمن هنا
// لأنه لا يكسر أي ميزان محاسبي، على عكس حذف قيود posted.
async function inspectFileDraftLeftovers(fileNo, opts={}) {
  const sys   = state.system;
  const table = opts.table || 'expenses';
  const suffix = opts.suffix || '-E';

  toast(`🔍 جاري فحص ${table} لملف ${fileNo}...`, 'ok');
  // نجلب كل سجلات الملف بصرف النظر عن الحالة أولاً — لتشخيص الحالة الفعلية لـ"معلق"
  const allForFile = await apiGetAll(table, {
    select: '*', system_type: `eq.${sys}`, file_no: `eq.${fileNo}`,
  });
  console.log(`[cleanup] كل سجلات ${table} لملف ${fileNo} (${allForFile.length}) — لاحظ عمود post_status:`);
  console.table(allForFile.map(r => ({ id:r.id, ref_no:r.ref_no, pay_id:r.pay_id, amount:r.amount, post_status:r.post_status, created_at:r.created_at })));

  const NOT_POSTED = new Set(['draft','pending_edit','pending_void','pending']);
  const pending = allForFile.filter(r => NOT_POSTED.has(r.post_status) || !r.post_status);
  const matchesSuffix = (r) => (r.ref_no||'').endsWith(suffix) || (r.pay_id||'').endsWith(suffix);
  let rows = pending.filter(matchesSuffix);
  let suffixMatched = true;
  // لو الفلتر باللاحقة لم يُطابق شيئاً، اعرض كل السجلات غير المرحّلة لمراجعتها يدوياً
  if (!rows.length && pending.length) { rows = pending; suffixMatched = false; }

  let html = `<div style="max-height:75vh;overflow:auto;font-size:13px;line-height:1.7">`;
  html += `<h3>🗑️ مخلّفات draft من النظام القديم — ${table} — ملف ${fileNo}</h3>`;
  if (suffixMatched) {
    html += `<p style="color:var(--text-dim)">سجلات بحالة <code>draft</code> و<code>ref_no</code>/<code>pay_id</code> ينتهي بـ "${suffix}" — ناتجة عن تعديلات بالنظام القديم، لم تُرحَّل محاسبياً (لا قيد JE مرتبط)، لذا حذفها لا يكسر أي ميزان. راجع كل سجل وأكِّد يدوياً.</p>`;
  } else if (rows.length) {
    html += `<p style="color:#f59e0b">⚠️ لم يُطابق أي سجل اللاحقة "${suffix}" — المعروض أدناه <b>كل</b> سجلات draft لهذا الملف (${rows.length}) لمراجعتها يدوياً وتحديد الصحيح من الخطأ. افحص عمود ref_no/pay_id في الجدول المطبوع بالـ console أيضاً.</p>`;
  }

  if (!rows.length) {
    html += `<p style="color:var(--green)">✅ لا توجد سجلات مطابقة.</p>`;
  } else {
    rows.forEach(r => {
      html += `<div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin:6px 0">
        <code>${fmtRow(r)}</code><br>
        <code style="color:var(--text-dim)">ref_no: ${r.ref_no||'—'} | created_at: ${r.created_at}</code><br>
        <div style="margin-top:6px;display:flex;gap:6px">
          <button class="btn btn-sm btn-danger" onclick="_cleanupDeleteDraft('${table}','${r.id}',this)">🗑️ حذف نهائي (draft فقط)</button>
        </div>
      </div>`;
    });
    html += `<p style="margin-top:10px;color:var(--text-dim)">إجمالي السجلات المعروضة: ${rows.length}</p>`;
  }
  html += `</div>`;

  let overlay = document.getElementById('cleanupToolOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'cleanupToolOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `<div style="background:var(--card,#1e1e1e);border-radius:12px;padding:18px;max-width:900px;width:100%;position:relative">
      <button onclick="document.getElementById('cleanupToolOverlay').remove()" style="position:absolute;top:10px;left:10px" class="btn btn-sm btn-secondary">✕ إغلاق</button>
      <div id="cleanupToolBody"></div>
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }
  document.getElementById('cleanupToolBody').innerHTML = html;
}

// حذف فعلي — يُسمح به فقط لسجلات draft (غير مرحّلة، بلا قيد محاسبي)
async function _cleanupDeleteDraft(tbl, id, btn) {
  try {
    const rows = await apiGetAll(tbl, { select:'*', id:`eq.${id}` });
    const record = rows?.[0];
    if (!record) { toast('السجل غير موجود (ربما حُذف بالفعل)','warn'); btn.textContent='غير موجود'; btn.disabled=true; return; }
    const DELETABLE = new Set(['draft','pending_edit','pending_void','pending']);
    if (record.post_status && !DELETABLE.has(record.post_status)) {
      toast(`⛔ السجل بحالة "${record.post_status}" — الحذف الفعلي ممنوع لسجلات مرحّلة (posted/voided) لأنها مرتبطة بقيود محاسبية`,'err');
      return;
    }
    if (!confirm(`⚠️ حذف نهائي (لا رجعة) للسجل #${id} من ${tbl}:\n\n${fmtRow(record)}\n\nمتابعة؟`)) return;

    btn.disabled = true; btn.textContent = '...جارٍ الحذف';
    const res = await fetch(`${SB_URL}/rest/v1/${tbl}?id=eq.${id}`, { method:'DELETE', headers: headers() });
    if (!res.ok) { const t = await res.text().catch(()=>''); throw new Error(`${res.status}: ${t}`); }

    await logAudit('DELETE_DRAFT_LEFTOVER', tbl, record.file_no, record, null, `حذف يدوي لمخلّف draft من النظام القديم — ref_no=${record.ref_no||'—'}`);
    toast(`✅ تم حذف #${id}`, 'ok');
    btn.textContent = '✅ تم الحذف';
  } catch(e) {
    toast('فشل الحذف: ' + e.message, 'err');
    btn.disabled = false; btn.textContent = 'إعادة المحاولة';
  }
}

// ── 1. دفعات/تحصيلات/مصاريف مكررة (voided + draft لنفس العملية تقريباً) ──
// معيار التكرار: نفس file_no + نفس amount (±0.01) + تاريخ إنشاء قريب (≤ 48 ساعة)
// وأحد السجلين voided والآخر draft (أو كلاهما draft/voided لنفس القيمة)
function findDuplicates(rows) {
  const out = [];
  const sorted = [...rows].sort((a,b)=> new Date(a.created_at) - new Date(b.created_at));
  for (let i=0;i<sorted.length;i++){
    for (let j=i+1;j<sorted.length;j++){
      const a = sorted[i], b = sorted[j];
      if (a.file_no !== b.file_no) continue;
      if (Math.abs((+a.amount||0)-(+b.amount||0)) > 0.01) continue;
      const tA = new Date(a.created_at).getTime(), tB = new Date(b.created_at).getTime();
      if (Math.abs(tB-tA) > 48*3600*1000) continue;
      const statuses = [a.post_status, b.post_status].sort().join('+');
      if (statuses === 'draft+voided' || statuses === 'draft+draft' || statuses === 'voided+voided') {
        out.push({ a, b, reason: `تطابق file_no=${a.file_no} ، amount=${a.amount} ، فرق الوقت ${Math.round(Math.abs(tB-tA)/60000)} دقيقة ، الحالات: ${statuses}` });
      }
    }
  }
  return out;
}

// ── 2. partner_payouts المُنشأة تلقائياً (علامة في notes) ──
function findAutoPayouts(rows) {
  return rows.filter(r => (r.notes||'').includes('مسجّلة تلقائياً من دفعات المورد'));
}

// ── 3. سجلات pending_void معلّقة لأكثر من N يوم بدون تنفيذ ──
function findStalePendingVoid(rows, days=7) {
  const cutoff = Date.now() - days*24*3600*1000;
  return rows.filter(r => r.post_status === 'pending_void' && new Date(r.created_at).getTime() < cutoff);
}

function fmtRow(r) {
  return `#${r.id} | ${r.file_no||'—'} | ${r.amount||r.sale_price||0} ج.م | ${r.post_status} | ${r.created_at} | ${r.notes||r.description||r.partner||r.payer||r.customer||''}`;
}

async function _loadAuditData(sys) {
  const data = {};
  for (const tbl of CLEANUP_TABLES) {
    data[tbl] = await apiGetAll(tbl, { select:'*', system_type:`eq.${sys}` });
  }
  return data;
}

// ── واجهة عرض التقرير + التصحيح اليدوي ──
async function openDataCleanupTool() {
  const sys = state.system;
  toast('🔍 جاري فحص البيانات...', 'ok');
  const data = await _loadAuditData(sys);

  const dupSets   = {};
  const autoSets  = {};
  const staleSets = {};
  for (const tbl of CLEANUP_TABLES) {
    dupSets[tbl]  = findDuplicates(data[tbl]);
    staleSets[tbl] = findStalePendingVoid(data[tbl]);
  }
  autoSets['partner_payouts'] = findAutoPayouts(data['partner_payouts']);

  let html = `<div style="max-height:75vh;overflow:auto;font-size:13px;line-height:1.7">`;
  html += `<h3>📋 تقرير فحص البيانات — نظام ${sys}</h3>`;
  html += `<p style="color:var(--text-dim)">كل سجل يحتاج تأكيداً يدوياً منفصلاً قبل أي تعديل أو حذف. لا شيء يُنفَّذ تلقائياً.</p>`;

  // 1) المكررات
  html += `<h4>1️⃣ سجلات مكررة محتملة (voided/draft لنفس العملية)</h4>`;
  let any1 = false;
  for (const tbl of CLEANUP_TABLES) {
    for (const d of dupSets[tbl]) {
      any1 = true;
      const gid = `dup_${tbl}_${d.a.id}_${d.b.id}`;
      html += `<div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin:6px 0">
        <b>${tbl}</b> — ${d.reason}<br>
        <code>أ) ${fmtRow(d.a)}</code><br>
        <code>ب) ${fmtRow(d.b)}</code><br>
        <div style="margin-top:6px;display:flex;gap:6px">
          <button class="btn btn-sm btn-secondary" onclick="_cleanupVoidRecord('${tbl}','${d.a.id}',this)">عكس (Void) أ بقيد عكسي</button>
          <button class="btn btn-sm btn-secondary" onclick="_cleanupVoidRecord('${tbl}','${d.b.id}',this)">عكس (Void) ب بقيد عكسي</button>
          <span style="color:var(--text-dim)">— القرار يدوي بالكامل: راجع التفاصيل قبل الضغط</span>
        </div>
      </div>`;
    }
  }
  if (!any1) html += `<p style="color:var(--green)">✅ لا يوجد تكرار مكتشف وفق المعايير الحالية.</p>`;

  // 2) صرف الشركاء التلقائي
  html += `<h4>2️⃣ صرف شركاء أُنشئ تلقائياً من دفعات الموردين</h4>`;
  if (autoSets['partner_payouts'].length) {
    autoSets['partner_payouts'].forEach(r => {
      html += `<div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin:6px 0">
        <code>${fmtRow(r)}</code><br>
        <div style="margin-top:6px;display:flex;gap:6px">
          <button class="btn btn-sm btn-secondary" onclick="_cleanupVoidRecord('partner_payouts','${r.id}',this)">عكس (Void) بقيد عكسي</button>
        </div>
      </div>`;
    });
  } else {
    html += `<p style="color:var(--green)">✅ لا توجد سجلات صرف شركاء مُعلَّمة كـ"تلقائي".</p>`;
  }

  // 3) pending_void معلقة
  html += `<h4>3️⃣ طلبات إلغاء (pending_void) معلّقة أكثر من 7 أيام</h4>`;
  let any3 = false;
  for (const tbl of CLEANUP_TABLES) {
    staleSets[tbl].forEach(r => {
      any3 = true;
      html += `<div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin:6px 0">
        <b>${tbl}</b><br>
        <code>${fmtRow(r)}</code><br>
        <div style="margin-top:6px;display:flex;gap:6px">
          <button class="btn btn-sm btn-secondary" onclick="_cleanupApproveVoid('${tbl}','${r.id}',this)">تنفيذ الإلغاء الآن (موافقة متأخرة)</button>
          <button class="btn btn-sm btn-secondary" onclick="_cleanupRejectVoid('${tbl}','${r.id}',this)">رفض الطلب وإعادته إلى posted</button>
        </div>
      </div>`;
    });
  }
  if (!any3) html += `<p style="color:var(--green)">✅ لا توجد طلبات إلغاء معلّقة أكثر من 7 أيام.</p>`;

  html += `</div>`;

  let overlay = document.getElementById('cleanupToolOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'cleanupToolOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `<div style="background:var(--card,#1e1e1e);border-radius:12px;padding:18px;max-width:900px;width:100%;position:relative">
      <button onclick="document.getElementById('cleanupToolOverlay').remove()" style="position:absolute;top:10px;left:10px" class="btn btn-sm btn-secondary">✕ إغلاق</button>
      <div id="cleanupToolBody"></div>
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }
  document.getElementById('cleanupToolBody').innerHTML = html;
}

// ── إجراءات التصحيح — كل واحدة تطلب تأكيداً صريحاً وتسجل في audit_log ──

async function _cleanupVoidRecord(tbl, id, btn) {
  const typeMap = { payments:'payment', expenses:'expense', collections:'collection', partner_payouts:'payout' };
  const type = typeMap[tbl];
  if (!confirm(`⚠️ سيتم عكس السجل #${id} من ${tbl} بقيد محاسبي عكسي (لن يُحذف). متابعة؟`)) return;
  try {
    btn.disabled = true; btn.textContent = '...جارٍ التنفيذ';
    const rows = await apiGetAll(tbl, { select:'*', id:`eq.${id}` });
    const record = rows?.[0];
    if (!record) { toast('السجل غير موجود','err'); return; }
    if (record.post_status === 'voided') { toast('السجل مُلغى بالفعل','warn'); btn.textContent='تم الإلغاء مسبقاً'; return; }
    await voidTransaction(type, record);
    toast(`✅ تم عكس السجل #${id}`, 'ok');
    btn.textContent = '✅ تم العكس';
  } catch(e) {
    toast('فشل العكس: ' + e.message, 'err');
    btn.disabled = false; btn.textContent = 'إعادة المحاولة';
  }
}

async function _cleanupApproveVoid(tbl, id, btn) {
  if (!confirm(`⚠️ سيتم تنفيذ طلب الإلغاء المعلّق للسجل #${id} في ${tbl} الآن (قيد عكسي + post_status=voided). متابعة؟`)) return;
  const typeMap = { payments:'payment', expenses:'expense', collections:'collection', partner_payouts:'payout' };
  try {
    btn.disabled = true; btn.textContent = '...جارٍ التنفيذ';
    const rows = await apiGetAll(tbl, { select:'*', id:`eq.${id}` });
    const record = rows?.[0];
    if (!record || record.post_status !== 'pending_void') { toast('السجل لم يعد في حالة pending_void','warn'); return; }
    // force=true يتجاوز فحص وضع الـ draft وينفذ القيد العكسي فوراً (انظر إصلاح engine.js:28)
    await voidTransaction(typeMap[tbl], record, true);
    toast(`✅ تم تنفيذ الإلغاء للسجل #${id}`, 'ok');
    btn.textContent = '✅ تم التنفيذ';
  } catch(e) {
    toast('فشل التنفيذ: ' + e.message, 'err');
    btn.disabled = false; btn.textContent = 'إعادة المحاولة';
  }
}

async function _cleanupRejectVoid(tbl, id, btn) {
  if (!confirm(`سيتم رفض طلب الإلغاء وإعادة السجل #${id} إلى الحالة "posted" بدون أي قيد. متابعة؟`)) return;
  try {
    btn.disabled = true; btn.textContent = '...جارٍ التنفيذ';
    const rows = await apiGetAll(tbl, { select:'*', id:`eq.${id}` });
    const record = rows?.[0];
    await apiPatch(tbl, { id:`eq.${id}` }, { post_status:'posted', notes: `${(record?.notes||'').replace(/\| طلب إلغاء بتاريخ.*$/,'').trim()} | رُفض طلب الإلغاء يدوياً بتاريخ ${today()}` });
    await logAudit('VOID_REJECTED', tbl, record?.file_no, record, null, `رفض طلب إلغاء معلّق — #${id}`);
    toast(`✅ تم رفض الطلب وإعادة السجل #${id} إلى posted`, 'ok');
    btn.textContent = '✅ تم الرفض';
  } catch(e) {
    toast('فشل: ' + e.message, 'err');
    btn.disabled = false; btn.textContent = 'إعادة المحاولة';
  }
}
