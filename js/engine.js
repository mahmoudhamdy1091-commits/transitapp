// ╔══════════════════════════════════════════════════════════╗
// ║  engine.js — JE Manager · Migration · Import Wizard     ║
// ║           Double Entry Posting Engine · PWA · Init      ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝
  { code:'2100', name:'ذمم الموردين',            type:'التزامات'    },
  { code:'2200', name:'مصاريف مستحقة',          type:'التزامات'    },
  { code:'2300', name:'ضرائب مستحقة',           type:'التزامات'    },
  { code:'2400', name:'حسابات الشركاء',         type:'التزامات'    },
  { code:'3100', name:'رأس المال',              type:'حقوق الملكية'},
  { code:'3200', name:'الأرباح المبقاة',        type:'حقوق الملكية'},
  { code:'4100', name:'إيرادات المبيعات',       type:'إيرادات'     },
  { code:'4200', name:'إيرادات أخرى',          type:'إيرادات'     },
  { code:'5100', name:'تكلفة المخزون المباع',   type:'تكلفة'       },
  { code:'6100', name:'مصروف رواتب',           type:'مصروفات'     },
  { code:'6200', name:'مصروف إيجارات',         type:'مصروفات'     },
  { code:'6300', name:'مصروف عمولات',          type:'مصروفات'     },
  { code:'6400', name:'مصروف نظافة',           type:'مصروفات'     },
  { code:'6500', name:'مصروف ضيافة',           type:'مصروفات'     },
  { code:'6600', name:'مصروفات حكومية',        type:'مصروفات'     },
  { code:'6700', name:'مصروفات أخرى',          type:'مصروفات'     },
];

function showJEManager() {
  hideAllViews();
  el('jeManagerView').style.display = 'block';
  el('topBarTitle').textContent  = '📝 دفتر القيود';
  el('topBarSub').textContent    = `نظام ${state.system}`;
  navActive('nav-je-manager');
  sessionStorage.setItem('tm_last_view','je-manager');
  setJEMgrPeriod('month');
}

function setJEMgrPeriod(period) {
  jeMgrState.period = period;
  document.querySelectorAll('[id^="je-period-"]').forEach(b => b.classList.remove('active'));
  el('je-period-'+period)?.classList.add('active');
  const customWrap = el('je-custom-dates');
  if (period === 'custom') { if (customWrap) customWrap.style.display='flex'; return; }
  if (customWrap) customWrap.style.display = 'none';
  const pad = n => String(n).padStart(2,'0');
  const now = new Date(), yr = now.getFullYear();
  let from, to;
  if (period === 'month') {
    from = `${yr}-${pad(now.getMonth()+1)}-01`;
    const last = new Date(yr, now.getMonth()+1, 0);
    to   = `${last.getFullYear()}-${pad(last.getMonth()+1)}-${pad(last.getDate())}`;
  } else if (period === 'lastmonth') {
    const lm = new Date(yr, now.getMonth()-1, 1), lme = new Date(yr, now.getMonth(), 0);
    from = `${lm.getFullYear()}-${pad(lm.getMonth()+1)}-01`;
    to   = `${lme.getFullYear()}-${pad(lme.getMonth()+1)}-${pad(lme.getDate())}`;
  } else if (period === 'year')  { from=`${yr}-01-01`; to=`${yr}-12-31`; }
  else if (period === 'all')     { from='2000-01-01'; to='2099-12-31'; }
  if (el('je-from')) el('je-from').value = from || '';
  if (el('je-to'))   el('je-to').value   = to   || '';
  jeMgrState.from = from; jeMgrState.to = to;
  loadJEManager();
}

async function loadJEManager() {
  const wrap = el('je-mgr-table');
  if (!wrap) return;
  const from = el('je-from')?.value || jeMgrState.from;
  const to   = el('je-to')?.value   || jeMgrState.to;
  jeMgrState.from = from; jeMgrState.to = to;
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري تحميل القيود...</div>';
  if (el('je-mgr-kpis')) el('je-mgr-kpis').innerHTML = '';
  if (el('je-balance-banner')) el('je-balance-banner').innerHTML = '';
  if (el('je-mgr-sub')) el('je-mgr-sub').textContent = `${from} — ${to} · نظام ${state.system}`;

  try {
    const params = {
      select:      '*',
      system_type: `eq.${state.system}`,
      order:       'entry_date.desc,entry_no.desc',
    };
    if (from) params['entry_date'] = `gte.${from}`;
    // Supabase: can't use two conditions on same field in params object — build URL manually
    let url = `${SB_URL}/rest/v1/journal_entries?system_type=eq.${encodeURIComponent(state.system)}&order=entry_date.desc,entry_no.desc&select=*`;
    if (from) url += `&entry_date=gte.${encodeURIComponent(from)}`;
    if (to)   url += `&entry_date=lte.${encodeURIComponent(to+'T23:59:59')}`;
    url += `&limit=2000`;
    let res  = await fetch(url, { headers: headers() });
    if (res.status === 401) {
      const ok = await refreshAccessToken();
      if (!ok) { wrap.innerHTML = errHTML('انتهت الجلسة — يرجى تسجيل الدخول مجدداً'); return; }
      res = await fetch(url, { headers: headers() });
    }
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();
    jeMgrState.allEntries = rows || [];

    // تجميع بـ entry_no
    const grouped = {};
    (rows||[]).forEach(r => {
      const no = r.entry_no || `SINGLE-${r.id}`;
      if (!grouped[no]) grouped[no] = { no, date:r.entry_date, desc:r.description, file_no:r.file_no, ref_table:r.ref_table, lines:[], totalDr:0, totalCr:0, isManual: r.ref_table==='manual' || !r.ref_table };
      grouped[no].lines.push(r);
      grouped[no].totalDr += +r.dr_amount||0;
      grouped[no].totalCr += +r.cr_amount||0;
    });
    jeMgrState.grouped = grouped;

    // KPIs
    const totalDr  = (rows||[]).reduce((s,r)=>s+(+r.dr_amount||0),0);
    const totalCr  = (rows||[]).reduce((s,r)=>s+(+r.cr_amount||0),0);
    const diff     = Math.abs(totalDr-totalCr);
    const entCount = Object.keys(grouped).length;
    const manualCount = Object.values(grouped).filter(g=>g.isManual).length;
    const autoCount   = entCount - manualCount;

    if (el('je-mgr-kpis')) el('je-mgr-kpis').innerHTML = [
      ['إجمالي القيود', entCount, 'var(--text)'],
      ['🤖 تلقائي', autoCount, 'var(--blue)'],
      ['✍️ يدوي', manualCount, 'var(--purple)'],
      ['إجمالي مدين', fmt(totalDr), 'var(--green)'],
      ['إجمالي دائن', fmt(totalCr), 'var(--red)'],
      ['الفرق', diff<0.01?'✓ متوازن':fmt(diff), diff<0.01?'var(--green)':'var(--red)'],
    ].map(([l,v,c])=>`<div class="j-kpi"><div class="j-kpi-label">${l}</div><div class="j-kpi-val" style="color:${c}">${v}</div></div>`).join('');

    // Balance banner
    if (el('je-balance-banner')) {
      if (diff < 0.01) {
        el('je-balance-banner').innerHTML = `<div style="background:var(--green-dim);border:1px solid var(--green);border-radius:var(--radius-sm);padding:8px 14px;font-size:12px;font-weight:700;color:var(--green)">✅ القيود متوازنة — مدين = دائن = ${fmt(totalDr)}</div>`;
      } else {
        // حساب القيود غير المتوازنة
        const unbalanced = Object.values(jeMgrState.grouped).filter(g => Math.abs(g.totalDr-g.totalCr)>0.01);
        el('je-balance-banner').innerHTML = `
          <div style="background:var(--red-dim);border:2px solid var(--red);border-radius:var(--radius-sm);padding:10px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div style="flex:1;min-width:200px">
              <div style="font-size:12px;font-weight:700;color:var(--red)">❌ فرق ${fmt(diff)} بين المدين والدائن — يؤثر على ميزان المراجعة!</div>
              <div style="font-size:11px;color:var(--text2);margin-top:3px">${unbalanced.length} قيد غير متوازن — السبب: فشل جزئي أثناء الترحيل أو الإدخال</div>
            </div>
            <button class="btn btn-sm" onclick="fixUnbalancedEntries()" style="background:var(--red);color:#fff;border:none;font-weight:700;white-space:nowrap">🔧 إصلاح تلقائي</button>
            <button class="btn btn-secondary btn-sm" onclick="showUnbalancedDetail()" style="white-space:nowrap">🔍 تفاصيل</button>
          </div>`;
      }
    }

    renderJEManagerTable();
  } catch(e) {
    wrap.innerHTML = errHTML('خطأ: '+e.message);
    console.error(e);
  }
}

function renderJEManagerTable() {
  const wrap     = el('je-mgr-table');
  if (!wrap) return;
  const srcFilter = el('je-filter-source')?.value || '';
  const search    = (el('je-filter-search')?.value||'').trim().toLowerCase();

  let entries = Object.values(jeMgrState.grouped);

  // فلتر المصدر
  if (srcFilter === 'manual') {
    entries = entries.filter(g => g.isManual);
  } else if (srcFilter === 'auto') {
    entries = entries.filter(g => !g.isManual);
  } else if (srcFilter) {
    entries = entries.filter(g => g.ref_table === srcFilter);
  }

  // فلتر البحث
  if (search) {
    entries = entries.filter(g =>
      (g.no||'').toLowerCase().includes(search) ||
      (g.desc||'').toLowerCase().includes(search) ||
      (g.file_no||'').toLowerCase().includes(search) ||
      g.lines.some(l => (l.account_name||'').toLowerCase().includes(search) || (l.account_code||'').toLowerCase().includes(search))
    );
  }

  if (!entries.length) {
    wrap.innerHTML = emptyHTML('📝','لا توجد قيود في هذه الفترة');
    return;
  }

  const srcLabels = {
    purchase_orders:'شراء', sales:'بيع', collections:'تحصيل',
    payments:'دفعة مورد', expenses:'مصروف', partner_payouts:'صرف شريك',
    operating_expenses:'مصروف تشغيلي', manual:'يدوي', reversal:'قيد عكسي',
  };
  const srcColors = {
    purchase_orders:'var(--accent)', sales:'var(--green)', collections:'var(--blue)',
    payments:'var(--cyan)', expenses:'var(--red)', partner_payouts:'var(--purple)',
    operating_expenses:'var(--purple)', manual:'var(--text)', reversal:'var(--text2)',
  };
  const isAdmin = state.userRole === 'admin';

  const rows = entries.map(g => {
    const balanced = Math.abs(g.totalDr - g.totalCr) < 0.01;
    const srcLabel = srcLabels[g.ref_table] || (g.isManual?'يدوي':'تلقائي');
    const srcColor = srcColors[g.ref_table] || 'var(--text2)';
    const balIcon  = balanced ? '<span style="color:var(--green);font-weight:700">✓</span>' : '<span style="color:var(--red);font-weight:700">!</span>';

    const linesHtml = g.lines.map(l => `
      <tr style="background:var(--card2)">
        <td style="padding:5px 12px 5px 28px;font-size:11px">
          <span class="mono" style="color:var(--text2)">${l.account_code||'—'}</span>
        </td>
        <td style="padding:5px 12px;font-size:11px;color:var(--text2)">${l.account_name||'—'}</td>
        <td style="padding:5px 12px;text-align:left;font-family:var(--mono);font-size:11px;color:var(--green)">${+l.dr_amount>0?fmt(l.dr_amount):'—'}</td>
        <td style="padding:5px 12px;text-align:left;font-family:var(--mono);font-size:11px;color:var(--red)">${+l.cr_amount>0?fmt(l.cr_amount):'—'}</td>
        <td></td>
      </tr>`).join('');

    const editBtn = (g.isManual && isAdmin)
      ? `<button class="btn btn-secondary btn-sm" onclick="openEditJEModal('${g.no}')" title="تعديل">✏️</button>`
      : '';
    const delBtn  = isAdmin
      ? `<button class="btn btn-sm" onclick="deleteJEEntry('${g.no}')" title="حذف" style="background:var(--red-dim);color:var(--red);border:1px solid var(--red)">🗑</button>`
      : '';

    return `
      <tr class="je-entry-row" onclick="toggleJELines(this)" style="cursor:pointer">
        <td style="padding:10px 12px">
          <div style="font-size:11px;font-weight:700;font-family:var(--mono);color:var(--accent)">${g.no}</div>
          <div style="font-size:10px;color:var(--text2);margin-top:1px">${g.date||'—'}</div>
        </td>
        <td style="padding:10px 12px">
          <div style="font-size:12px;font-weight:600">${g.desc||'—'}</div>
          ${g.file_no?`<div style="font-size:10px;color:var(--text2);margin-top:1px">ملف: ${g.file_no}</div>`:''}
        </td>
        <td style="padding:10px 12px">
          <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:${srcColor}22;color:${srcColor}">${srcLabel}</span>
        </td>
        <td style="padding:10px 12px;text-align:left;font-family:var(--mono);font-size:12px;font-weight:700;color:var(--green)">${fmt(g.totalDr)}</td>
        <td style="padding:10px 12px;text-align:left;font-family:var(--mono);font-size:12px;font-weight:700;color:var(--red)">${fmt(g.totalCr)}</td>
        <td style="padding:10px 12px;text-align:center">${balIcon}</td>
        <td style="padding:10px 12px;white-space:nowrap;display:flex;gap:4px">${editBtn}${delBtn}</td>
      </tr>
      <tr class="je-lines-row" style="display:none">
        <td colspan="7" style="padding:0;background:var(--card2)">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:var(--card);border-bottom:1px solid var(--border)">
              <th style="padding:5px 12px 5px 28px;font-size:10px;color:var(--text3);text-align:right">الكود</th>
              <th style="padding:5px 12px;font-size:10px;color:var(--text3);text-align:right">الحساب</th>
              <th style="padding:5px 12px;font-size:10px;color:var(--green);text-align:left">مدين</th>
              <th style="padding:5px 12px;font-size:10px;color:var(--red);text-align:left">دائن</th>
              <th></th>
            </tr></thead>
            <tbody>${linesHtml}</tbody>
          </table>
        </td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div style="font-size:11px;color:var(--text2);margin-bottom:6px">${entries.length} قيد · اضغط على أي صف لعرض الأسطر</div>
    <div style="overflow-x:auto">
    <table class="data-table" style="min-width:700px">
      <thead><tr>
        <th>رقم القيد</th>
        <th>البيان</th>
        <th>المصدر</th>
        <th style="text-align:left;color:var(--green)">مدين</th>
        <th style="text-align:left;color:var(--red)">دائن</th>
        <th style="text-align:center">توازن</th>
        <th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
}

function showUnbalancedDetail() {
  const unbalanced = Object.values(jeMgrState.grouped).filter(g => Math.abs(g.totalDr-g.totalCr)>0.01);
  if (!unbalanced.length) { toast('✅ لا توجد قيود غير متوازنة','ok'); return; }

  const rows = unbalanced.map(g => {
    const diff = g.totalDr - g.totalCr;
    // ✅ Audit fix: escaping احترازي على الحقول النصية قبل الحقن في innerHTML
    const esc = v => String(v||'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<tr style="background:var(--red-dim)">
      <td class="mono" style="color:var(--accent);font-weight:700;padding:8px 12px">${esc(g.no)}</td>
      <td style="padding:8px 12px;font-size:11px">${esc(g.desc)}</td>
      <td style="padding:8px 12px;font-size:11px">${esc(g.ref_table||'manual')}</td>
      <td style="padding:8px 12px;font-size:11px">${esc(g.file_no)}</td>
      <td class="mono" style="padding:8px 12px;color:var(--green)">${fmt(g.totalDr)}</td>
      <td class="mono" style="padding:8px 12px;color:var(--red)">${fmt(g.totalCr)}</td>
      <td class="mono" style="padding:8px 12px;font-weight:700;color:var(--red)">${diff>0?'+':''}${fmt(diff)}</td>
    </tr>`;
  }).join('');

  // ✅ Audit fix: showConfirm تستخدم textContent فتُهرّب HTML — نستخدم showConfirmHtml
  // لعرض الجدول بشكل صحيح مع الحفاظ على escaping الحقول النصية أعلاه
  showConfirmHtml(
    `🔍 ${unbalanced.length} قيد غير متوازن`,
    `<div style="overflow-x:auto;max-height:300px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--card2)">
          <th style="padding:7px 10px;text-align:right">القيد</th>
          <th style="padding:7px 10px;text-align:right">البيان</th>
          <th style="padding:7px 10px;text-align:right">المصدر</th>
          <th style="padding:7px 10px;text-align:right">الملف</th>
          <th style="padding:7px 10px;text-align:left;color:var(--green)">مدين</th>
          <th style="padding:7px 10px;text-align:left;color:var(--red)">دائن</th>
          <th style="padding:7px 10px;text-align:left">الفرق</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="margin-top:10px;font-size:11px;color:var(--text2)">اضغط "إصلاح" لحذف هذه القيود وإعادة ترحيل بياناتها</div>`,
    () => fixUnbalancedEntries()
  );
}
async function fixUnbalancedEntries() {
  const unbalanced = Object.values(jeMgrState.grouped).filter(g => Math.abs(g.totalDr-g.totalCr)>0.01);
  if (!unbalanced.length) { toast('✅ لا توجد قيود غير متوازنة','ok'); return; }

  const sys = state.system;
  toast(`⏳ جاري إصلاح ${unbalanced.length} قيد...`,'ok');

  let fixed = 0, failed = 0;

  for (const g of unbalanced) {
    try {
      // حذف القيد الناقص
      const delRes = await fetch(
        `${SB_URL}/rest/v1/journal_entries?entry_no=eq.${encodeURIComponent(g.no)}&system_type=eq.${encodeURIComponent(sys)}`,
        { method:'DELETE', headers: headers() }
      );
      if (!delRes.ok && delRes.status !== 404) throw new Error('فشل الحذف');

      // إعادة توليد القيد من المصدر الأصلي
      if (g.ref_table && g.ref_table !== 'manual') {
        const refTable = g.ref_table;
        const fileNo   = g.file_no;

        // جلب السجل الأصلي
        if (refTable === 'purchase_orders' && fileNo) {
          const data = await apiGetAll('purchase_orders', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
          const d = data?.[0];
          if (d && +d.total_purchase > 0)
            await je_purchase({ sys, date:d.po_date||today(), amount:+d.total_purchase, fileNo:d.file_no, supplier:d.supplier||'' });

        } else if (refTable === 'payments' && fileNo) {
          // جلب كل الدفعات لهذا الملف وإعادة قيدها
          const data = await apiGetAll('payments', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
          for (const p of (data||[]).filter(isPosted)) {
            if (+p.amount > 0)
              await je_payment({ sys, date:p.pay_date||today(), amount:+p.amount, fileNo:p.file_no, supplierName:p.supplier||'', payerName:p.payer||'', method:p.pay_method||'تحويل بنكي' });
          }

        } else if (refTable === 'sales' && fileNo) {
          const data = await apiGetAll('sales', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
          // ✅ A01 COGS fix: جلب تكاليف السيارات لهذا الملف مرة واحدة
          const _vData = await apiGetAll('vehicles', { select:'vin,purchase_price', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
          const _vCost = {};
          (_vData||[]).forEach(v => { if (v.vin) _vCost[v.vin] = +v.purchase_price || 0; });
          const byInv = {};
          (data||[]).filter(isPosted).forEach(s => {
            const k=`${s.file_no}__${s.inv_no||s.id}`;
            if(!byInv[k]) byInv[k]={...s,total:0,cogs:0};
            byInv[k].total += +s.sale_price||0;
            byInv[k].cogs  += _vCost[s.vin] || 0;
          });
          for (const s of Object.values(byInv)) {
            if (s.total > 0)
              await je_sale({ sys, date:s.sale_date||today(), amount:s.total, cost:s.cogs, fileNo:s.file_no, customer:s.customer||'', invNo:s.inv_no||'' });
          }

        } else if (refTable === 'collections' && fileNo) {
          const data = await apiGetAll('collections', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
          for (const c of (data||[]).filter(c=>isPosted(c)&&c.paid_date)) {
            if (+c.amount > 0)
              await je_collection({ sys, date:c.paid_date, amount:+c.amount, fileNo:c.file_no, customer:c.customer||'', invNo:c.inv_no||'', method:c.pay_method||'تحويل بنكي' });
          }

        } else if (refTable === 'expenses' && fileNo) {
          const data = await apiGetAll('expenses', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
          for (const e of (data||[]).filter(isPosted)) {
            if (+e.amount > 0)
              await je_expense({ sys, date:e.exp_date||today(), amount:+e.amount, fileNo:e.file_no, desc:e.description||'مصروف', expType:e.exp_type||'أخرى', method:e.pay_method||'نقد' });
          }

        } else if (refTable === 'partner_payouts' && fileNo) {
          const data = await apiGetAll('partner_payouts', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
          for (const p of (data||[]).filter(isPosted)) {
            if (+p.amount > 0)
              await je_payout({ sys, date:p.pay_date||today(), amount:+p.amount, fileNo:p.file_no, partner:p.partner||'', method:p.pay_method||'نقد' });
          }

        } else if (refTable === 'operating_expenses') {
          const data = await apiGetAll('operating_expenses', { select:'*', system_type:`eq.${sys}` });
          for (const o of (data||[])) {
            if (+o.amount > 0)
              await je_opex({ sys, date:o.exp_date||today(), amount:+o.amount, expType:o.exp_type||'أخرى', desc:o.description||'', method:o.pay_method||'نقد', refNo:o.ref_no||null });
          }
        }
      }
      fixed++;
    } catch(e) {
      failed++;
      console.warn(`Fix failed for ${g.no}:`, e.message);
    }
  }

  const msg = failed > 0
    ? `⚠️ تم إصلاح ${fixed} قيد — فشل ${failed}. شغّل الترحيل الكامل لو المشكلة مستمرة.`
    : `✅ تم إصلاح ${fixed} قيد بنجاح`;
  toast(msg, failed > 0 ? 'warn' : 'ok');
  await loadJEManager();
}
function toggleJELines(row) {
  const next = row.nextElementSibling;
  if (!next || !next.classList.contains('je-lines-row')) return;
  const isHidden = next.style.display === 'none' || !next.style.display;
  next.style.display = isHidden ? 'table-row' : 'none';
  row.style.background = isHidden ? 'var(--accent-dim)' : '';
}

// ═══ إنشاء / تعديل قيد يدوي ═══

let _jeLines = []; // أسطر القيد الحالية في الموديل

function openNewJEModal() {
  jeMgrState.editEntryNo = null;
  _jeLines = [
    { acc:'', name:'', dr:0, cr:0 },
    { acc:'', name:'', dr:0, cr:0 },
  ];
  el('je-modal-title').textContent  = '📝 قيد محاسبي جديد';
  el('je-edit-entry-no').value      = '';
  el('je-date').value               = today();
  el('je-file-no').value            = '';
  el('je-desc').value               = '';
  el('je-submit-btn').textContent   = '💾 حفظ القيد';
  el('jeError').style.display       = 'none';
  renderJELines();
  openModal('jeModal');
}

function openEditJEModal(entryNo) {
  const group = jeMgrState.grouped[entryNo];
  if (!group) { toast('القيد غير موجود','err'); return; }
  if (!group.isManual) { toast('⚠️ لا يمكن تعديل القيود التلقائية — راجع العملية الأصلية','warn'); return; }
  jeMgrState.editEntryNo = entryNo;
  _jeLines = group.lines.map(l => ({ acc: l.account_code||'', name: l.account_name||'', dr: +l.dr_amount||0, cr: +l.cr_amount||0 }));
  el('je-modal-title').textContent  = `✏️ تعديل قيد — ${entryNo}`;
  el('je-edit-entry-no').value      = entryNo;
  el('je-date').value               = (group.date||'').split('T')[0];
  el('je-file-no').value            = group.file_no || '';
  el('je-desc').value               = group.desc    || '';
  el('je-submit-btn').textContent   = '💾 حفظ التعديل';
  el('jeError').style.display       = 'none';
  renderJELines();
  openModal('jeModal');
}

function renderJELines() {
  const tbody = el('je-lines-body');
  if (!tbody) return;
  tbody.innerHTML = _jeLines.map((line, i) => {
    const suggestions = JE_ACCOUNT_SUGGESTIONS.map(s =>
      `<option value="${s.code}" data-name="${s.name}">${s.code} — ${s.name}</option>`
    ).join('');
    return `<tr id="je-line-${i}">
      <td style="padding:4px 6px">
        <div style="position:relative">
          <input list="je-acc-list-${i}" type="text" value="${line.acc}"
            placeholder="1110" style="width:90px;background:var(--card2);border:1px solid var(--border);border-radius:4px;padding:5px 8px;color:var(--text);font-family:var(--mono);font-size:12px"
            oninput="onJEAccInput(${i},this.value)" onchange="onJEAccChange(${i},this.value)">
          <datalist id="je-acc-list-${i}">${suggestions}</datalist>
        </div>
      </td>
      <td style="padding:4px 6px">
        <input type="text" value="${line.name}" placeholder="اسم الحساب"
          style="width:100%;min-width:160px;background:var(--card2);border:1px solid var(--border);border-radius:4px;padding:5px 8px;color:var(--text);font-family:'Cairo',sans-serif;font-size:12px"
          oninput="_jeLines[${i}].name=this.value">
      </td>
      <td style="padding:4px 6px">
        <input type="number" value="${line.dr||''}" placeholder="0.00" min="0" step="0.01"
          style="width:110px;background:var(--card2);border:1px solid var(--green);border-radius:4px;padding:5px 8px;color:var(--green);font-family:var(--mono);font-size:12px;text-align:left"
          oninput="_jeLines[${i}].dr=parseFloat(this.value)||0;_jeLines[${i}].cr=0;updateJETotals()">
      </td>
      <td style="padding:4px 6px">
        <input type="number" value="${line.cr||''}" placeholder="0.00" min="0" step="0.01"
          style="width:110px;background:var(--card2);border:1px solid var(--red);border-radius:4px;padding:5px 8px;color:var(--red);font-family:var(--mono);font-size:12px;text-align:left"
          oninput="_jeLines[${i}].cr=parseFloat(this.value)||0;_jeLines[${i}].dr=0;updateJETotals()">
      </td>
      <td style="padding:4px 6px;text-align:center">
        ${_jeLines.length > 2 ? `<button onclick="removeJELine(${i})" class="btn btn-sm" style="background:var(--red-dim);color:var(--red);border:none;padding:3px 8px;font-size:11px">✕</button>` : ''}
      </td>
    </tr>`;
  }).join('');
  updateJETotals();
}

function addJELine() {
  _jeLines.push({ acc:'', name:'', dr:0, cr:0 });
  renderJELines();
}

function removeJELine(i) {
  if (_jeLines.length <= 2) return;
  _jeLines.splice(i, 1);
  renderJELines();
}

function onJEAccInput(i, val) {
  _jeLines[i].acc = val;
  // auto-fill name from suggestions
  const match = JE_ACCOUNT_SUGGESTIONS.find(s => s.code === val.trim());
  if (match) {
    _jeLines[i].name = match.name;
    // update name input
    const row  = el(`je-line-${i}`);
    const ninp = row?.querySelectorAll('input[type="text"]')[1];
    if (ninp) ninp.value = match.name;
  }
}

function onJEAccChange(i, val) {
  _jeLines[i].acc = val.trim();
  const match = JE_ACCOUNT_SUGGESTIONS.find(s => s.code === val.trim());
  if (match && !_jeLines[i].name) {
    _jeLines[i].name = match.name;
    const row  = el(`je-line-${i}`);
    const ninp = row?.querySelectorAll('input[type="text"]')[1];
    if (ninp) ninp.value = match.name;
  }
}

function updateJETotals() {
  const totalDr = _jeLines.reduce((s,l)=>s+(+l.dr||0),0);
  const totalCr = _jeLines.reduce((s,l)=>s+(+l.cr||0),0);
  const diff    = Math.abs(totalDr-totalCr);
  if (el('je-total-dr')) el('je-total-dr').textContent = fmt(totalDr);
  if (el('je-total-cr')) el('je-total-cr').textContent = fmt(totalCr);
  const ind = el('je-balance-indicator');
  if (ind) {
    if (totalDr===0 && totalCr===0) { ind.style.display='none'; return; }
    ind.style.display = 'block';
    if (diff < 0.01) {
      ind.style.background = 'var(--green-dim)';
      ind.style.border     = '1px solid var(--green)';
      ind.style.color      = 'var(--green)';
      ind.textContent      = `✅ القيد متوازن — مدين = دائن = ${fmt(totalDr)}`;
    } else {
      ind.style.background = 'var(--red-dim)';
      ind.style.border     = '1px solid var(--red)';
      ind.style.color      = 'var(--red)';
      ind.textContent      = `❌ غير متوازن — مدين: ${fmt(totalDr)} · دائن: ${fmt(totalCr)} · فرق: ${fmt(diff)}`;
    }
  }
}

async function submitJE() {
  const date    = el('je-date').value;
  const desc    = el('je-desc').value.trim();
  const fileNo  = el('je-file-no').value.trim() || null;
  const entryNo = el('je-edit-entry-no').value || null;
  const errEl   = el('jeError');

  // قراءة القيم من الـ inputs (لأن _jeLines قد لا يتحدث لحظياً مع كل keypress)
  document.querySelectorAll('#je-lines-body tr').forEach((row, i) => {
    const inputs = row.querySelectorAll('input');
    if (inputs.length >= 4) {
      if (_jeLines[i]) {
        _jeLines[i].acc  = inputs[0].value.trim();
        _jeLines[i].name = inputs[1].value.trim();
        _jeLines[i].dr   = parseFloat(inputs[2].value) || 0;
        _jeLines[i].cr   = parseFloat(inputs[3].value) || 0;
      }
    }
  });

  errEl.style.display = 'none';
  if (!date) { showFieldErr('jeError','يرجى تحديد التاريخ'); return; }
  if (!desc) { showFieldErr('jeError','يرجى كتابة بيان القيد'); return; }

  const validLines = _jeLines.filter(l => l.acc || l.name || l.dr || l.cr);
  if (validLines.length < 2) { showFieldErr('jeError','يجب أن يكون في القيد سطران على الأقل'); return; }

  const totalDr = validLines.reduce((s,l)=>s+(+l.dr||0),0);
  const totalCr = validLines.reduce((s,l)=>s+(+l.cr||0),0);
  if (Math.abs(totalDr-totalCr) > 0.01) {
    showFieldErr('jeError',`❌ القيد غير متوازن — مدين: ${fmt(totalDr)} · دائن: ${fmt(totalCr)} · فرق: ${fmt(Math.abs(totalDr-totalCr))}`);
    return;
  }
  if (totalDr <= 0) { showFieldErr('jeError','المبالغ يجب أن تكون أكبر من صفر'); return; }

  const btn = el('je-submit-btn');
  btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...';

  try {
    // لو تعديل: احذف القيود القديمة بنفس entry_no أولاً
    if (entryNo) {
      const delRes = await fetch(`${SB_URL}/rest/v1/journal_entries?entry_no=eq.${encodeURIComponent(entryNo)}&system_type=eq.${encodeURIComponent(state.system)}`, {
        method: 'DELETE', headers: headers(),
      });
      if (!delRes.ok && delRes.status !== 404) throw new Error('فشل حذف القيد القديم');
    }

    // إنشاء رقم قيد جديد
    const no = entryNo || await _jeNo(state.system);

    // إدراج الأسطر
    for (const l of validLines) {
      const row = {
        system_type:  state.system,
        entry_no:     no,
        entry_date:   date,
        account_code: l.acc  || null,
        account_name: l.name || null,
        dr_amount:    +l.dr  || 0,
        cr_amount:    +l.cr  || 0,
        description:  desc,
        ref_table:    'manual',
        ref_id:       null,
        file_no:      fileNo,
        post_status:  'posted',
        posted_at:    new Date().toISOString(),
      };
      const r = await fetch(`${SB_URL}/rest/v1/journal_entries`, {
        method:'POST', headers:{...headers(),'Prefer':'return=minimal'}, body:JSON.stringify(row),
      });
      if (!r.ok) throw new Error(`فشل إدراج السطر: ${await r.text()}`);
    }

    await logAudit(entryNo?'UPDATE':'INSERT','journal_entries', fileNo, null, { entry_no:no, desc, totalDr, totalCr });
    closeModal('jeModal');
    toast(`✅ تم ${entryNo?'تعديل':'حفظ'} القيد ${no}`, 'ok');
    await loadJEManager();
  } catch(e) {
    showFieldErr('jeError','خطأ: '+e.message);
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = entryNo ? '💾 حفظ التعديل' : '💾 حفظ القيد';
  }
}

async function deleteJEEntry(entryNo) {
  const group = jeMgrState.grouped[entryNo];
  if (!group) return;
  const isManual = group.isManual;
  const warnTxt  = isManual
    ? `هل تريد حذف القيد اليدوي "${entryNo}" نهائياً؟\nهذا الإجراء لا يمكن التراجع عنه.`
    : `⚠️ تحذير: هذا قيد تلقائي مرتبط بعملية "${group.ref_table||'غير محدد'}".\n\nحذف القيد لن يحذف العملية الأصلية، لكنه سيؤثر على ميزان المراجعة ودفتر الأستاذ.\n\nهل أنت متأكد من الحذف؟`;

  showConfirm(`حذف القيد ${entryNo}`, warnTxt, async () => {
    try {
      const delRes = await fetch(
        `${SB_URL}/rest/v1/journal_entries?entry_no=eq.${encodeURIComponent(entryNo)}&system_type=eq.${encodeURIComponent(state.system)}`,
        { method:'DELETE', headers: headers() }
      );
      if (!delRes.ok && delRes.status !== 404) throw new Error('فشل الحذف: '+await delRes.text());
      await logAudit('DELETE','journal_entries', group.file_no||null, { entry_no:entryNo, desc:group.desc, totalDr:group.totalDr }, null);
      toast(`✅ تم حذف القيد ${entryNo}`,'ok');
      await loadJEManager();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

// ════════════════════════════════════════════════════════
// HISTORICAL DATA MIGRATION — ترحيل البيانات التاريخية
// ════════════════════════════════════════════════════════

function openMigrationModal() {
  const inp = el('mig-confirm-input');
  if (inp) inp.value = '';
  if (el('mig-pre-run'))  el('mig-pre-run').style.display  = 'block';
  if (el('mig-progress')) el('mig-progress').style.display = 'none';
  if (el('mig-footer'))   el('mig-footer').style.display   = 'flex';
  if (el('mig-pre-error')) el('mig-pre-error').style.display = 'none';
  if (el('mig-system-label')) el('mig-system-label').textContent = state.system;
  if (el('mig-close-btn'))    el('mig-close-btn').style.display = 'inline-flex';
  openModal('migrationModal');
}

function _migLog(msg, type='info') {
  const log = el('mig-log');
  if (!log) return;
  const color = type==='ok'?'var(--green)':type==='err'?'var(--red)':type==='warn'?'var(--accent)':'var(--text2)';
  log.innerHTML += `<div style="color:${color}">${msg}</div>`;
  log.scrollTop = log.scrollHeight;
}

function _migProgress(pct, label) {
  if (el('mig-progress-bar'))  el('mig-progress-bar').style.width = pct + '%';
  if (el('mig-step-label'))    el('mig-step-label').textContent   = label;
}

async function runMigration() {
  const confirm = el('mig-confirm-input')?.value?.trim();
  if (confirm !== 'MIGRATE') {
    if (el('mig-pre-error')) { el('mig-pre-error').style.display='block'; el('mig-pre-error').textContent='اكتب MIGRATE بالأحرف الكبيرة للتأكيد'; }
    return;
  }
  // Switch UI
  if (el('mig-pre-run'))    el('mig-pre-run').style.display    = 'none';
  if (el('mig-progress'))   el('mig-progress').style.display   = 'block';
  if (el('mig-footer'))     el('mig-footer').style.display     = 'none';
  if (el('mig-close-btn'))  el('mig-close-btn').style.display  = 'none';
  if (el('mig-status-text')) el('mig-status-text').textContent = '⚡ جاري الترحيل — لا تغلق النافذة...';
  if (el('mig-log')) el('mig-log').innerHTML = '';

  const sys = state.system;
  let created = 0, skipped = 0, errors = 0;
  let firstError = null; // لتسجيل أول خطأ للتشخيص

  try {
    // ── PRE-FLIGHT: تحقق من صلاحية الكتابة قبل البدء ──
    _migProgress(2, 'فحص الصلاحيات...');
    const testRow = {
      system_type: sys, entry_no: '__TEST__', entry_date: today(),
      account_code: '9999', account_name: 'اختبار', dr_amount: 0, cr_amount: 0,
      description: 'اختبار ترحيل', ref_table: '__test__', post_status: 'draft',
    };
    const testRes = await fetch(`${SB_URL}/rest/v1/journal_entries`, {
      method: 'POST',
      headers: { ...headers(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(testRow),
    });
    if (!testRes.ok) {
      const errBody = await testRes.text().catch(() => testRes.statusText);
      const hint = testRes.status === 403
        ? 'خطأ صلاحيات (403) — تحقق من RLS policies في Supabase'
        : testRes.status === 401
        ? 'انتهت الجلسة — سجّل خروج ودخول مجدداً'
        : `خطأ ${testRes.status}`;
      throw new Error(`فشل اختبار الصلاحيات: ${hint}\nالتفاصيل: ${errBody.slice(0,200)}`);
    }
    // احذف سطر الاختبار
    await fetch(
      `${SB_URL}/rest/v1/journal_entries?entry_no=eq.__TEST__&system_type=eq.${encodeURIComponent(sys)}`,
      { method: 'DELETE', headers: headers() }
    );
    _migLog('✅ الصلاحيات سليمة — بدء الترحيل', 'ok');

    // ── الخطوة 1: حذف كل القيود التلقائية ──
    _migProgress(5, 'الخطوة 1/8: حذف القيود التلقائية القديمة...');
    _migLog(`🗑 حذف القيود التلقائية لنظام ${sys}...`);

    // حذف القيود التلقائية (ref_table موجود وليس manual)
    const delRes = await fetch(
      `${SB_URL}/rest/v1/journal_entries?system_type=eq.${encodeURIComponent(sys)}&ref_table=neq.manual&ref_table=not.is.null`,
      { method:'DELETE', headers: headers() }
    );
    if (!delRes.ok && delRes.status !== 404) {
      const delErr = await delRes.text().catch(() => delRes.statusText);
      throw new Error(`فشل حذف القيود القديمة (${delRes.status}): ${delErr.slice(0,200)}`);
    }

    // حذف القيود بدون ref_table (قديمة جداً — ما عدا اليدوية)
    const delRes2 = await fetch(
      `${SB_URL}/rest/v1/journal_entries?system_type=eq.${encodeURIComponent(sys)}&ref_table=is.null&entry_no=not.like.MAN*`,
      { method:'DELETE', headers: headers() }
    );
    if (!delRes2.ok && delRes2.status !== 404) {
      const del2Err = await delRes2.text().catch(() => delRes2.statusText);
      _migLog(`⚠️ حذف القيود القديمة (بدون ref_table): ${delRes2.status} — ${del2Err.slice(0,100)}`, 'warn');
    } else {
      _migLog('✅ تم مسح القيود التلقائية القديمة', 'ok');
    }

    // جلب كل البيانات
    _migProgress(10, 'الخطوة 2/8: جلب بيانات الصفقات...');
    const [deals, payments, expenses, sales, collections, payouts, opexItems] = await Promise.all([
      apiGetAll('purchase_orders',   { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('payments',          { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('expenses',          { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('sales',             { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('collections',       { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('partner_payouts',   { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('operating_expenses',{ select:'*', system_type:`eq.${sys}` }),
    ]);

    const total = (deals?.length||0)+(payments?.length||0)+(expenses?.length||0)+
                  (sales?.length||0)+(collections?.length||0)+(payouts?.length||0)+(opexItems?.length||0);
    _migLog(`📊 إجمالي السجلات: ${total} سجل`);
    let done = 0;
    const tick = () => { done++; _migProgress(10+Math.round(done/total*85), `${done}/${total} سجل`); };

    // مساعد ترحيل آمن مع تسجيل أول خطأ
    const safe = async (label, fn) => {
      try { await fn(); created++; tick(); }
      catch(e) {
        errors++;
        tick();
        _migLog(`⚠️ ${label}: ${e.message}`, 'warn');
        if (!firstError) firstError = `${label}: ${e.message}`;
      }
    };

    // ── الخطوة 3: صفقات الشراء ──
    _migProgress(12, 'الخطوة 3/8: قيود الشراء...');
    _migLog(`📋 ${(deals||[]).filter(isPosted).length} صفقة شراء...`);
    for (const d of (deals||[]).filter(isPosted)) {
      if (!d.total_purchase||!+d.total_purchase) { skipped++; tick(); continue; }
      await safe(`شراء ${d.file_no}`, () => je_purchase({ sys, date:d.po_date||today(), amount:+d.total_purchase, fileNo:d.file_no, supplier:d.supplier||'' }));
    }

    // ── الخطوة 4: الدفعات ──
    _migProgress(24, 'الخطوة 4/8: قيود الدفعات...');
    _migLog(`💳 ${(payments||[]).filter(isPosted).length} دفعة مورد...`);
    for (const p of (payments||[]).filter(isPosted)) {
      if (!p.amount||!+p.amount) { skipped++; tick(); continue; }
      await safe(`دفعة ${p.pay_id||p.id}`, () => je_payment({ sys, date:p.pay_date||today(), amount:+p.amount, fileNo:p.file_no, supplierName:p.supplier||'', payerName:p.payer||'', method:p.pay_method||'تحويل بنكي' }));
    }

    // ── الخطوة 5: المبيعات ──
    _migProgress(38, 'الخطوة 5/8: قيود المبيعات...');
    const _allVehicles = await apiGetAll('vehicles', { select:'vin,purchase_price,file_no', system_type:`eq.${sys}` });
    const _vinCostMap = {};
    (_allVehicles||[]).forEach(v => { if (v.vin) _vinCostMap[v.vin] = +v.purchase_price || 0; });
    const salesByInv = {};
    (sales||[]).filter(isPosted).forEach(s => {
      const k = `${s.file_no}__${s.inv_no||s.id}`;
      if (!salesByInv[k]) salesByInv[k] = { ...s, total:0, cogs:0 };
      salesByInv[k].total += +s.sale_price||0;
      salesByInv[k].cogs  += _vinCostMap[s.vin] || 0;
    });
    _migLog(`🤝 ${Object.keys(salesByInv).length} فاتورة بيع...`);
    for (const s of Object.values(salesByInv)) {
      if (!s.total) { skipped++; done++; continue; }
      await safe(`بيع ${s.inv_no||s.id}`, () => je_sale({ sys, date:s.sale_date||today(), amount:s.total, cost:s.cogs, fileNo:s.file_no, customer:s.customer||'', invNo:s.inv_no||'' }));
    }

    // ── الخطوة 6: التحصيلات ──
    _migProgress(54, 'الخطوة 6/8: قيود التحصيلات المدفوعة...');
    const paidCols = (collections||[]).filter(c => isPosted(c) && c.paid_date);
    _migLog(`💰 ${paidCols.length} تحصيل مدفوع...`);
    for (const c of paidCols) {
      if (!c.amount||!+c.amount) { skipped++; tick(); continue; }
      await safe(`تحصيل ${c.ref_no||c.id}`, () => je_collection({ sys, date:c.paid_date, amount:+c.amount, fileNo:c.file_no, customer:c.customer||'', invNo:c.inv_no||'', method:c.pay_method||'تحويل بنكي' }));
    }
    const pendingCount = (collections||[]).filter(c=>isPosted(c)&&!c.paid_date).length;
    if (pendingCount>0) _migLog(`ℹ️ ${pendingCount} تحصيل منتظر — سيُضاف قيده عند الدفع`, 'warn');

    // ── الخطوة 7: المصاريف ──
    _migProgress(68, 'الخطوة 7/8: قيود المصاريف...');
    _migLog(`💸 ${(expenses||[]).filter(isPosted).length} مصروف + ${(payouts||[]).filter(isPosted).length} صرف شريك...`);
    for (const e of (expenses||[]).filter(isPosted)) {
      if (!e.amount||!+e.amount) { skipped++; tick(); continue; }
      await safe(`مصروف ${e.ref_no||e.id}`, () => je_expense({ sys, date:e.exp_date||today(), amount:+e.amount, fileNo:e.file_no, desc:e.description||e.category||'مصروف', expType:e.exp_type||e.category||'أخرى', method:e.pay_method||'نقد' }));
    }
    for (const p of (payouts||[]).filter(isPosted)) {
      if (!p.amount||!+p.amount) { skipped++; tick(); continue; }
      await safe(`صرف ${p.pay_id||p.id}`, () => je_payout({ sys, date:p.pay_date||today(), amount:+p.amount, fileNo:p.file_no, partner:p.partner||'', method:p.pay_method||'نقد' }));
    }

    // ── الخطوة 8: المصاريف التشغيلية ──
    _migProgress(84, 'الخطوة 8/8: قيود المصاريف التشغيلية...');
    _migLog(`💼 ${(opexItems||[]).length} مصروف تشغيلي...`);
    for (const o of (opexItems||[])) {
      if (!o.amount||!+o.amount) { skipped++; tick(); continue; }
      await safe(`OPEX ${o.ref_no||o.id}`, () => je_opex({ sys, date:o.exp_date||today(), amount:+o.amount, expType:o.exp_type||'أخرى', desc:o.description||'', method:o.pay_method||'نقد', refNo:o.ref_no||null }));
    }

    // ── النتيجة النهائية ──
    _migProgress(100, errors === 0 ? 'اكتمل الترحيل ✅' : `اكتمل مع ${errors} خطأ ⚠️`);
    if (el('mig-status-text')) el('mig-status-text').textContent = errors === 0
      ? `✅ اكتمل الترحيل — ${created} قيد جديد`
      : `⚠️ اكتمل مع أخطاء — ${created} نجح / ${errors} فشل`;
    _migLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    _migLog(`✅ تم إنشاء: ${created} قيد`, 'ok');
    if (skipped>0) _migLog(`⏭ تجاهل:    ${skipped} (مبلغ صفر)`, 'warn');
    if (errors>0)  {
      _migLog(`❌ أخطاء:    ${errors}`, 'err');
      if (firstError) _migLog(`أول خطأ: ${firstError}`, 'err');
    }
    _migLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    if (created > 0) _migLog(`📊 اذهب إلى: دفتر القيود أو ميزان المراجعة للتحقق`, 'ok');
    else             _migLog(`⚠️ لم يُنشأ أي قيد — راجع رسائل الخطأ أعلاه`, 'err');

    // زر إغلاق + تحديث
    if (el('mig-footer')) el('mig-footer').innerHTML =
      `<button class="btn btn-primary" onclick="closeModal('migrationModal');loadJEManager();invalidateCache()">✅ إغلاق وتحديث</button>`;
    if (el('mig-footer')) el('mig-footer').style.display = 'flex';
    if (el('mig-close-btn')) el('mig-close-btn').style.display = 'inline-flex';
    invalidateCache();
    await logAudit('MIGRATION','journal_entries',null,null,{ sys, created, skipped, errors, total });

  } catch(e) {
    _migProgress(100, '❌ حدث خطأ أثناء الترحيل');
    _migLog(`❌ خطأ: ${e.message}`, 'err');
    if (el('mig-status-text')) el('mig-status-text').textContent = '❌ توقف الترحيل بسبب خطأ';
    if (el('mig-footer')) el('mig-footer').innerHTML =
      `<button class="btn btn-secondary" onclick="closeModal('migrationModal')">إغلاق</button>
       <button class="btn btn-primary" onclick="runMigration()">🔄 إعادة المحاولة</button>`;
    if (el('mig-footer')) el('mig-footer').style.display = 'flex';
    console.error('Migration error:', e);
  }
}

// ════════════════════════════════════════════════════════
// WAREHOUSES MODULE — المخازن والتحويلات المخزنية
// ════════════════════════════════════════════════════════

const whState = {
  warehouses:  [],   // قائمة المخازن (أسماء فريدة)
  transfers:   [],   // كل التحويلات
  allTransfers:[],   // نسخة كاملة للفلترة
};

// ── العرض الرئيسي ──
function showWarehouses() {
  hideAllViews();
  el('warehousesView').style.display = 'block';
  el('topBarTitle').textContent      = '🏪 المخازن';
  el('topBarSub').textContent        = `نظام ${state.system}`;
  navActive('nav-warehouses');
  sessionStorage.setItem('tm_last_view','warehouses');
  loadWarehouses();
}

async function loadWarehouses() {
  const sys = state.system;
  try {
    // جلب كل التحويلات
    const transfers = await apiGetAll('stock_locations', {
      select:'*', system_type:`eq.${sys}`, order:'transfer_date.desc,id.desc'
    });
    whState.transfers    = transfers || [];
    whState.allTransfers = transfers || [];

    // جلب أسماء المخازن الفريدة
    whState.warehouses = [...new Set((transfers||[]).map(t=>t.location_name).filter(Boolean))];

    // جلب المبيعات والسيارات للحالة
    await ensureCache();
    const soldVins = new Set((state.allSales||[]).filter(isPosted).map(s=>s.vin).filter(Boolean));

    renderWhKpis(transfers, soldVins);
    renderWhCards(transfers, soldVins);
    renderWhTransfersTable(transfers, soldVins);
  } catch(e) {
    if(el('wh-cards')) el('wh-cards').innerHTML = errHTML('خطأ: '+e.message);
  }
}

function renderWhKpis(transfers, soldVins) {
  const total    = transfers.length;
  const sold     = transfers.filter(t => soldVins.has(t.vin)).length;
  const inStock  = total - sold;
  const whs      = new Set(transfers.map(t=>t.location_name).filter(Boolean)).size;
  if (el('wh-kpis')) el('wh-kpis').innerHTML = [
    ['🏪 المخازن',    whs,     'var(--purple)'],
    ['🚗 إجمالي محوّل', total, 'var(--blue)'],
    ['📦 في المخزن',  inStock, 'var(--accent)'],
    ['✅ مباع',       sold,    'var(--green)'],
  ].map(([l,v,c])=>`<div class="j-kpi"><div class="j-kpi-label">${l}</div><div class="j-kpi-val" style="color:${c};font-size:20px;font-weight:900">${v}</div></div>`).join('');
}

function renderWhCards(transfers, soldVins) {
  const wrap = el('wh-cards');
  if (!wrap) return;
  if (!transfers.length) {
    wrap.innerHTML = emptyHTML('🏪','لا توجد مخازن أو تحويلات بعد');
    return;
  }

  // تجميع بالمخزن
  const byWh = {};
  transfers.forEach(t => {
    const wh = t.location_name || 'غير محدد';
    if (!byWh[wh]) byWh[wh] = [];
    byWh[wh].push(t);
  });

  wrap.innerHTML = Object.entries(byWh).map(([wh, vins]) => {
    const total   = vins.length;
    const sold    = vins.filter(t => soldVins.has(t.vin)).length;
    const inStock = total - sold;
    const pct     = total > 0 ? Math.round(sold/total*100) : 0;

    const rows = vins.map(t => {
      const isSold = soldVins.has(t.vin);
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);gap:8px">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          <span style="font-size:16px">${isSold?'✅':'🚗'}</span>
          <div style="min-width:0">
            <div style="font-size:11px;font-family:monospace;color:var(--text);direction:ltr;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.vin||'—'}</div>
            <div style="font-size:10px;color:var(--text2)">${t.model||''} · ملف: ${t.file_no||'—'}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:${isSold?'var(--green-dim)':'var(--accent-dim)'};color:${isSold?'var(--green)':'var(--accent)'}">${isSold?'مباع':'في المخزن'}</span>
          <button class="btn btn-sm" onclick="openViewer('${t.file_no}')" title="فتح الصفقة" style="padding:2px 7px;font-size:10px">📂</button>
          <button class="btn btn-sm" onclick="deleteTransfer(${t.id},'${t.vin}')" title="حذف التحويل" style="padding:2px 7px;font-size:10px;background:var(--red-dim);color:var(--red)">🗑</button>
        </div>
      </div>`;
    }).join('');

    return `<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:14px;font-weight:900">🏪 ${wh}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${total} سيارة · ${inStock} في المخزن · ${sold} مباع</div>
        </div>
        <div style="text-align:left">
          <div style="font-size:18px;font-weight:900;color:${inStock>0?'var(--accent)':'var(--green)'}">${inStock}</div>
          <div style="font-size:10px;color:var(--text2)">متاح</div>
        </div>
      </div>
      <div style="padding:4px 0;height:6px;background:var(--card2)">
        <div style="height:100%;width:${pct}%;background:var(--green);transition:width .4s"></div>
      </div>
      <div style="padding:8px 14px;max-height:280px;overflow-y:auto">${rows}</div>
      <div style="padding:8px 14px;border-top:1px solid var(--border);display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="openNewTransferModal('${wh}')">➕ إضافة سيارات</button>
        <button class="btn btn-secondary btn-sm" onclick="exportWhCard('${wh}')">📥 تصدير</button>
      </div>
    </div>`;
  }).join('');
}

function renderWhTransfersTable(transfers, soldVins) {
  const wrap = el('wh-transfers-table');
  if (!wrap) return;
  if (!transfers.length) { wrap.innerHTML = emptyHTML('📋','لا توجد تحويلات'); return; }

  const rows = transfers.map(t => {
    const isSold = soldVins.has(t.vin);
    return `<tr>
      <td class="mono text-muted" style="font-size:11px">${t.transfer_date||'—'}</td>
      <td><span style="font-weight:700;color:var(--purple)">${t.location_name||'—'}</span></td>
      <td class="mono text-amber" style="cursor:pointer;font-weight:700" onclick="openViewer('${t.file_no}')">${t.file_no||'—'}</td>
      <td class="mono" style="direction:ltr;font-size:11px">${t.vin||'—'}</td>
      <td>${t.model||'—'}</td>
      <td class="mono text-muted" style="font-size:11px">${t.transfer_ref||'—'}</td>
      <td><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:${isSold?'var(--green-dim)':'var(--accent-dim)'};color:${isSold?'var(--green)':'var(--accent)'}">${isSold?'✅ مباع':'📦 في المخزن'}</span></td>
      <td style="font-size:11px;color:var(--text2)">${t.notes||'—'}</td>
      <td>
        <button class="btn btn-sm" onclick="openViewer('${t.file_no}')" style="padding:2px 8px;font-size:10px">📂</button>
        <button class="btn btn-sm" onclick="deleteTransfer(${t.id},'${t.vin}')" style="padding:2px 8px;font-size:10px;background:var(--red-dim);color:var(--red);border:1px solid var(--red)">🗑</button>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<div style="overflow-x:auto">
    <table class="data-table">
      <thead><tr>
        <th>التاريخ</th><th>المخزن</th><th>الملف</th><th>VIN</th>
        <th>الموديل</th><th>المستند</th><th>الحالة</th><th>ملاحظات</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function filterWhTransfers() {
  const q = (el('wh-search')?.value||'').toLowerCase().trim();
  const filtered = q
    ? whState.allTransfers.filter(t =>
        (t.vin||'').toLowerCase().includes(q) ||
        (t.location_name||'').toLowerCase().includes(q) ||
        (t.file_no||'').toLowerCase().includes(q) ||
        (t.model||'').toLowerCase().includes(q)
      )
    : whState.allTransfers;
  const soldVins = new Set((state.allSales||[]).filter(isPosted).map(s=>s.vin).filter(Boolean));
  renderWhTransfersTable(filtered, soldVins);
}

// ── إدارة المخازن ──
async function openManageWarehousesModal() {
  await refreshWhList();
  openModal('manageWarehousesModal');
}

async function refreshWhList() {
  const sys    = state.system;
  const data   = await apiGetAll('stock_locations', { select:'location_name', system_type:`eq.${sys}` });
  const names  = [...new Set((data||[]).map(t=>t.location_name).filter(Boolean))];
  whState.warehouses = names;
  const wrap = el('wh-list-manage');
  if (!wrap) return;
  if (!names.length) { wrap.innerHTML = `<div style="color:var(--text2);font-size:12px;text-align:center;padding:16px">لا توجد مخازن بعد</div>`; return; }
  wrap.innerHTML = names.map(n => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;background:var(--card2)">
      <span style="font-weight:600">🏪 ${n}</span>
      <button class="btn btn-sm" onclick="deleteWarehouse('${n.replace(/'/g,"\\'")}',this)" style="background:var(--red-dim);color:var(--red);border:1px solid var(--red);padding:2px 8px;font-size:11px">🗑 حذف</button>
    </div>`).join('');
  // تحديث قائمة select في موديل التحويل
  refreshWhSelect();
}

function refreshWhSelect() {
  const sel = el('st-location');
  if (!sel) return;
  sel.innerHTML = `<option value="">اختر المخزن...</option>` +
    whState.warehouses.map(n=>`<option value="${n}">${n}</option>`).join('');
}

async function addWarehouse() {
  const name = el('new-wh-name')?.value?.trim();
  if (!name) { if(el('whManageError')){el('whManageError').style.display='block';el('whManageError').textContent='أدخل اسم المخزن';} return; }
  if (whState.warehouses.includes(name)) { if(el('whManageError')){el('whManageError').style.display='block';el('whManageError').textContent='المخزن موجود بالفعل';} return; }
  whState.warehouses.push(name);
  if (el('new-wh-name')) el('new-wh-name').value = '';
  if (el('whManageError')) el('whManageError').style.display='none';
  // حفظ المخزن في localStorage كاسم محجوز
  const key = `wh_names_${state.system}`;
  const saved = JSON.parse(localStorage.getItem(key)||'[]');
  if (!saved.includes(name)) { saved.push(name); localStorage.setItem(key, JSON.stringify(saved)); }
  refreshWhList();
  toast(`✅ تم إضافة مخزن "${name}"`,'ok');
}

async function deleteWarehouse(name) {
  // تحقق إن مفيش سيارات في المخزن
  const inWh = whState.allTransfers.filter(t=>t.location_name===name);
  if (inWh.length>0) { toast(`⚠️ المخزن فيه ${inWh.length} سيارة — احذفها أولاً`,'warn'); return; }
  whState.warehouses = whState.warehouses.filter(n=>n!==name);
  const key = `wh_names_${state.system}`;
  const saved = JSON.parse(localStorage.getItem(key)||'[]');
  localStorage.setItem(key, JSON.stringify(saved.filter(n=>n!==name)));
  refreshWhList();
  toast(`✅ تم حذف مخزن "${name}"`,'ok');
}

// ── تحويل مخزني جديد ──
let _stSelectedVins = new Set();

async function openNewTransferModal(prefillWh='') {
  // تحديث قائمة المخازن — دمج DB + localStorage
  const sys  = state.system;
  const key  = `wh_names_${state.system}`;
  const dbWh = whState.warehouses;
  const lsWh = JSON.parse(localStorage.getItem(key)||'[]');
  whState.warehouses = [...new Set([...dbWh,...lsWh])];
  refreshWhSelect();

  if (el('st-location') && prefillWh) el('st-location').value = prefillWh;
  if (el('st-date'))    el('st-date').value    = today();
  if (el('st-file-no')) el('st-file-no').value = '';
  if (el('st-ref'))     el('st-ref').value     = '';
  if (el('st-notes'))   el('st-notes').value   = '';
  if (el('st-vehicles-list')) el('st-vehicles-list').innerHTML = `<div style="color:var(--text2);font-size:12px;text-align:center;padding:10px">أدخل رقم الصفقة أولاً</div>`;
  if (el('stError'))    el('stError').style.display = 'none';
  _stSelectedVins = new Set();
  updateSelectedCount();
  openModal('stockTransferModal');
}

async function loadVehiclesForTransfer(fileNo) {
  const fn = fileNo.trim().toUpperCase();
  if (fn.length < 3) return;
  const wrap = el('st-vehicles-list');
  if (!wrap) return;
  wrap.innerHTML = '<div style="text-align:center;padding:10px;font-size:12px;color:var(--text2)">جاري التحميل...</div>';
  try {
    const [vehicles, sales, existing] = await Promise.all([
      apiGetAll('vehicles',       { select:'*',          system_type:`eq.${state.system}`, file_no:`eq.${fn}` }),
      apiGetAll('sales',          { select:'vin',        system_type:`eq.${state.system}`, file_no:`eq.${fn}` }),
      apiGetAll('stock_locations',{ select:'vin,location_name', system_type:`eq.${state.system}`, file_no:`eq.${fn}` }),
    ]);
    const soldVins    = new Set((sales||[]).map(s=>s.vin).filter(Boolean));
    const transferMap = {};
    (existing||[]).forEach(t => { transferMap[t.vin] = t.location_name; });
    if (!vehicles?.length) { wrap.innerHTML = `<div style="color:var(--red);font-size:12px;text-align:center;padding:10px">لم يُعثر على سيارات في هذه الصفقة</div>`; return; }
    _stSelectedVins = new Set();
    wrap.innerHTML = (vehicles||[]).map(v => {
      const isSold     = soldVins.has(v.vin);
      const inWh       = transferMap[v.vin];
      const disabled   = isSold ? 'opacity:0.4;pointer-events:none' : '';
      const badge      = isSold
        ? `<span style="font-size:10px;color:var(--green);font-weight:700">✅ مباع</span>`
        : inWh
          ? `<span style="font-size:10px;color:var(--purple);font-weight:700">🏪 ${inWh}</span>`
          : `<span style="font-size:10px;color:var(--text2)">المخزن الرئيسي</span>`;
      return `<label style="display:flex;align-items:center;gap:8px;padding:7px 4px;cursor:pointer;border-bottom:1px solid var(--border);${disabled}">
        <input type="checkbox" value="${v.vin}" ${isSold?'disabled':''} onchange="toggleVinSelect(this)"
          style="width:16px;height:16px;accent-color:var(--purple);flex-shrink:0">
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-family:monospace;direction:ltr;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.vin||'—'}</div>
          <div style="font-size:10px;color:var(--text2)">${v.model||''} ${v.year||''} ${v.color||''}</div>
        </div>
        ${badge}
      </label>`;
    }).join('');
  } catch(e) {
    wrap.innerHTML = errHTML('خطأ: '+e.message);
  }
}

function toggleVinSelect(chk) {
  if (chk.checked) _stSelectedVins.add(chk.value);
  else             _stSelectedVins.delete(chk.value);
  updateSelectedCount();
}

function selectAllVehicles(select) {
  el('st-vehicles-list')?.querySelectorAll('input[type="checkbox"]:not([disabled])').forEach(c => {
    c.checked = select;
    if (select) _stSelectedVins.add(c.value);
    else        _stSelectedVins.delete(c.value);
  });
  updateSelectedCount();
}

function updateSelectedCount() {
  if (el('st-selected-count')) el('st-selected-count').textContent = `${_stSelectedVins.size} سيارة محددة`;
}

async function submitStockTransfer() {
  const location = el('st-location')?.value?.trim();
  const date     = el('st-date')?.value;
  const fileNo   = el('st-file-no')?.value?.trim().toUpperCase();
  const ref      = el('st-ref')?.value?.trim();
  const notes    = el('st-notes')?.value?.trim();
  if (!location) { showFieldErr('stError','اختر المخزن'); return; }
  if (!date)     { showFieldErr('stError','أدخل تاريخ التحويل'); return; }
  if (!fileNo)   { showFieldErr('stError','أدخل رقم الصفقة'); return; }
  if (_stSelectedVins.size === 0) { showFieldErr('stError','اختر سيارة واحدة على الأقل'); return; }

  const btn = document.querySelector('#stockTransferModal .btn-primary');
  if (btn) { btn.disabled=true; btn.textContent='⏳ جاري الحفظ...'; }

  try {
    // جلب بيانات السيارات المحددة
    const vehicles = await apiGetAll('vehicles', { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${fileNo}` });
    const vinMap   = {};
    (vehicles||[]).forEach(v => { if(v.vin) vinMap[v.vin]=v; });

    const inserts = [..._stSelectedVins].map(vin => ({
      system_type:    state.system,
      location_name:  location,
      vin:            vin,
      file_no:        fileNo,
      model:          vinMap[vin]?.model || null,
      transfer_date:  date,
      transfer_ref:   ref || null,
      notes:          notes || null,
      transferred_by: state.user?.email || null,
    }));

    // batch insert
    const res = await fetch(`${SB_URL}/rest/v1/stock_locations`, {
      method:'POST',
      headers:{ ...headers(), 'Prefer':'return=minimal' },
      body: JSON.stringify(inserts),
    });
    if (!res.ok) throw new Error(await res.text());

    await logAudit('INSERT','stock_locations', fileNo, null, { location, vins:[..._stSelectedVins], date });
    toast(`✅ تم تحويل ${_stSelectedVins.size} سيارة إلى ${location}`,'ok');
    closeModal('stockTransferModal');
    await loadWarehouses();
    // تحديث تبويب السيارات لو مفتوح
    if (state.currentFileNo === fileNo && state.currentTab === 1) loadVehiclesTab(fileNo, state.system);
  } catch(e) {
    showFieldErr('stError','خطأ: '+e.message);
    if (btn) { btn.disabled=false; btn.textContent='🚛 تأكيد التحويل'; }
  }
}

async function deleteTransfer(id, vin) {
  showConfirm(`حذف تحويل`, `هل تريد حذف تحويل السيارة ${vin}؟\nسيُعاد احتسابها في المخزن الرئيسي.`, async () => {
    try {
      await apiDelete('stock_locations', { id:`eq.${id}` });
      toast('✅ تم حذف التحويل','ok');
      await loadWarehouses();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

async function exportWhCard(whName) {
  const rows = whState.allTransfers.filter(t=>t.location_name===whName);
  const soldVins = new Set((state.allSales||[]).filter(isPosted).map(s=>s.vin).filter(Boolean));
  const csvRows = rows.map(t=>[t.vin||'—',t.model||'—',t.file_no||'—',t.transfer_date||'—',t.transfer_ref||'—',soldVins.has(t.vin)?'مباع':'في المخزن',t.notes||'']);
  exportCSV(['VIN','الموديل','الملف','تاريخ التحويل','المستند','الحالة','ملاحظات'],csvRows,`مخزن_${whName}`);
}

// ── إضافة عمود المخزن في تبويب السيارات ──
const _origLoadVehiclesTab = loadVehiclesTab;
async function loadVehiclesTab(fn, sys) {
  try {
    const [data, locations] = await Promise.all([
      apiGetAll('vehicles',       { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('stock_locations',{ select:'vin,location_name', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
    ]);
    state.currentVehicles = data || [];
    const soldVins   = new Set((state.currentSales||[]).map(s=>s.vin));
    const locMap     = {};
    (locations||[]).forEach(t => { locMap[t.vin] = t.location_name; });

    if (!data?.length) { el('vehiclesTable').innerHTML = emptyHTML('🚗','لا توجد سيارات'); return; }
    el('vehiclesTable').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>الكود</th><th>VIN</th><th>النوع</th><th>الموديل</th>
          <th>السنة</th><th>اللوحة</th><th>اللون</th><th>الحجم</th>
          <th>سعر الشراء</th><th>انتهاء الرخصة</th><th>الموقع</th><th>الحالة</th><th></th>
        </tr></thead>
        <tbody>${(data||[]).map((v,i)=>{
          const code    = `${fn}-V${String(i+1).padStart(2,'0')}`;
          const expired = v.license_expiry && new Date(v.license_expiry) < new Date();
          const isSold  = soldVins.has(v.vin);
          const loc     = locMap[v.vin];
          const locBadge = loc
            ? `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:var(--purple-dim);color:var(--purple);cursor:pointer" onclick="showWarehouses()" title="في مخزن ${loc}">🏪 ${loc}</span>`
            : `<span style="font-size:10px;color:var(--text2)">المخزن الرئيسي</span>`;
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
            <td>${locBadge}</td>
            <td><span class="badge ${isSold?'badge-closed':'badge-open'}">${isSold?'مباع':'في المخزن'}</span></td>
            <td style="display:flex;gap:4px">
              <button class="btn btn-secondary btn-sm" onclick="openEditVehicleModal(${v.id})">✏️</button>
              <button class="btn btn-sm" onclick="openNewTransferModal();setTimeout(()=>{if(el('st-file-no')){el('st-file-no').value='${fn}';loadVehiclesForTransfer('${fn}');}},300)" title="تحويل لمخزن" style="background:var(--purple-dim);color:var(--purple);border:1px solid var(--purple);padding:3px 7px;font-size:11px">🚛</button>
            </td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
  } catch(e) { el('vehiclesTable').innerHTML = errHTML(e.message); }
}

// ════════════════════════════════════════════════════════
// CONTACT STATEMENT — كشف حساب من القيود المحاسبية
// ════════════════════════════════════════════════════════

const csState = { contactName:'', contactType:'', entries:[] };

// تُستدعى من قائمة جهات الاتصال أو أي مكان آخر
async function showContactStatement(contactName, contactType) {
  hideAllViews();
  el('contactStatementView').style.display = 'block';
  navActive('nav-contacts');
  csState.contactName = contactName;
  csState.contactType = contactType || '';

  const typeLabel = { customer:'عميل', supplier:'مورد', partner:'شريك', custodian:'عهدة' };
  const icon      = { customer:'👤', supplier:'🏭', partner:'🤲', custodian:'🗝' };
  el('topBarTitle').textContent = `📋 كشف حساب`;
  el('topBarSub').textContent   = `${icon[contactType]||'👤'} ${contactName} · نظام ${state.system}`;
  el('cs-title').textContent    = `📋 كشف حساب — ${contactName}`;
  el('cs-sub').textContent      = `${typeLabel[contactType]||''} · نظام ${state.system} · من القيود المحاسبية`;

  await loadContactStatement();
}

async function loadContactStatement() {
  const wrap = el('cs-table');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري تحميل كشف الحساب...</div>';
  if (el('cs-kpis')) el('cs-kpis').innerHTML = '';

  const sys  = state.system;
  const name = csState.contactName;
  if (!name) return;

  try {
    // جلب كل القيود التي تحمل contact_name = اسم الطرف
    const url = `${SB_URL}/rest/v1/journal_entries?system_type=eq.${encodeURIComponent(sys)}&contact_name=eq.${encodeURIComponent(name)}&post_status=eq.posted&order=entry_date.asc,entry_no.asc&select=*&limit=5000`;
    const res  = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();
    csState.entries = rows || [];

    if (!rows?.length) {
      // محاولة بحث بـ account_name (للبيانات القديمة قبل الـ migration)
      const url2 = `${SB_URL}/rest/v1/journal_entries?system_type=eq.${encodeURIComponent(sys)}&account_name=like.*${encodeURIComponent(name)}*&post_status=eq.posted&order=entry_date.asc,entry_no.asc&select=*&limit=5000`;
      const res2  = await fetch(url2, { headers: headers() });
      const rows2 = res2.ok ? await res2.json() : [];
      csState.entries = rows2 || [];
      if (!rows2?.length) {
        wrap.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2)">
          <div style="font-size:36px;margin-bottom:10px">📋</div>
          <div style="font-size:14px;font-weight:700;margin-bottom:6px">لا توجد قيود باسم "${name}"</div>
          <div style="font-size:12px">شغّل الترحيل التاريخي من دفتر القيود لتحديث البيانات</div>
          <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="showJEManager();setTimeout(openMigrationModal,300)">⚡ ترحيل البيانات</button>
        </div>`;
        return;
      }
    }

    const entries = csState.entries;

    // حساب الأرصدة — المدين يزيد الرصيد، الدائن ينقصه
    let running = 0;
    let totalDr = 0, totalCr = 0;

    const tableRows = entries.map(r => {
      const dr = +r.dr_amount || 0;
      const cr = +r.cr_amount || 0;
      running += dr - cr;
      totalDr += dr;
      totalCr += cr;

      const srcLabels = {
        purchase_orders:'شراء', sales:'بيع', collections:'تحصيل',
        payments:'دفعة مورد', expenses:'مصروف',
        partner_payouts:'صرف شريك', operating_expenses:'مصروف تشغيلي', manual:'يدوي',
      };
      const srcColors = {
        purchase_orders:'var(--accent)', sales:'var(--green)',
        collections:'var(--blue)', payments:'var(--cyan)',
        expenses:'var(--red)', partner_payouts:'var(--purple)',
        operating_expenses:'var(--purple)', manual:'var(--text)',
      };
      const src      = r.ref_table || 'manual';
      const srcLabel = srcLabels[src] || src;
      const srcColor = srcColors[src] || 'var(--text2)';
      const balColor = running > 0 ? 'var(--green)' : running < 0 ? 'var(--red)' : 'var(--text2)';
      const balLabel = running > 0 ? 'مدين' : running < 0 ? 'دائن' : 'تسوية';

      return `<tr>
        <td class="mono text-muted" style="font-size:11px;white-space:nowrap">${(r.entry_date||'').split('T')[0]}</td>
        <td><span style="font-size:11px;font-weight:700;font-family:monospace;color:var(--accent)">${r.entry_no||'—'}</span></td>
        <td><span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:${srcColor}22;color:${srcColor}">${srcLabel}</span></td>
        <td style="font-size:11px;max-width:220px">${r.description||'—'}</td>
        <td class="mono text-muted" style="font-size:11px">${r.file_no||'—'}</td>
        <td class="mono text-green" style="text-align:left;font-weight:700">${dr>0?fmt(dr):'—'}</td>
        <td class="mono text-red"   style="text-align:left;font-weight:700">${cr>0?fmt(cr):'—'}</td>
        <td style="text-align:left;white-space:nowrap">
          <span class="mono" style="font-weight:900;color:${balColor}">${fmt(Math.abs(running))}</span>
          <span style="font-size:10px;color:${balColor};margin-right:4px">${balLabel}</span>
        </td>
      </tr>`;
    }).join('');

    const balance    = totalDr - totalCr;
    const balColor   = balance > 0 ? 'var(--green)' : balance < 0 ? 'var(--red)' : 'var(--text2)';
    const balLabel   = balance > 0 ? 'مدين' : balance < 0 ? 'دائن' : 'متوازن';

    // KPIs
    if (el('cs-kpis')) el('cs-kpis').innerHTML = [
      ['إجمالي مدين',   fmt(totalDr),         'var(--green)'],
      ['إجمالي دائن',   fmt(totalCr),         'var(--red)'],
      ['الرصيد الختامي', fmt(Math.abs(balance))+'  '+balLabel, balColor],
      ['عدد القيود',    entries.length,        'var(--blue)'],
    ].map(([l,v,c])=>`<div class="j-kpi"><div class="j-kpi-label">${l}</div><div class="j-kpi-val" style="color:${c};font-size:18px;font-weight:900">${v}</div></div>`).join('');

    wrap.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text2);display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">
          <span>📋 كشف حساب: <strong style="color:var(--text)">${name}</strong> · ${entries.length} حركة</span>
          <span style="font-weight:700;color:${balColor}">الرصيد: ${fmt(Math.abs(balance))} ${balLabel}</span>
        </div>
        <div style="overflow-x:auto">
          <table class="data-table" style="min-width:700px">
            <thead><tr>
              <th>التاريخ</th><th>رقم القيد</th><th>النوع</th><th>البيان</th><th>الملف</th>
              <th style="color:var(--green);text-align:left">مدين</th>
              <th style="color:var(--red);text-align:left">دائن</th>
              <th style="text-align:left">الرصيد</th>
            </tr></thead>
            <tbody>${tableRows}</tbody>
            <tfoot style="background:var(--card2)">
              <tr>
                <td colspan="5" style="padding:10px 16px;font-weight:700">الإجمالي</td>
                <td class="mono text-green" style="padding:10px 16px;font-weight:900;text-align:left">${fmt(totalDr)}</td>
                <td class="mono text-red"   style="padding:10px 16px;font-weight:900;text-align:left">${fmt(totalCr)}</td>
                <td style="padding:10px 16px;font-weight:900;color:${balColor};text-align:left">
                  ${fmt(Math.abs(balance))} <span style="font-size:11px">${balLabel}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>`;

  } catch(e) {
    wrap.innerHTML = errHTML('خطأ: '+e.message);
    console.error(e);
  }
}

function printContactStatement() {
  const name    = csState.contactName;
  const content = el('cs-table')?.innerHTML || '';
  const kpis    = el('cs-kpis')?.innerHTML  || '';
  printSection(`كشف حساب — ${name}`, `نظام ${state.system}`, kpis + content);
}

function exportContactStatementCSV() {
  const rows = csState.entries.map(r => [
    (r.entry_date||'').split('T')[0], r.entry_no||'—',
    r.ref_table||'—', r.description||'—', r.file_no||'—',
    +r.dr_amount||0, +r.cr_amount||0,
  ]);
  exportCSV(['التاريخ','رقم القيد','النوع','البيان','الملف','مدين','دائن'], rows, `كشف_${csState.contactName}`);
}

// تُستدعى من صفحة جهات الاتصال عند الضغط على الطرف
function showPartnerStatement(name) {
  showContactStatement(name, 'partner');
}

// ════════════════════════════════════════════════════════
// IMPORT WIZARD — استيراد بيانات تاريخية من Excel
// ════════════════════════════════════════════════════════

const IMPORT_SCHEMAS = {
  deals: {
    label: 'الصفقات', table: 'purchase_orders',
    cols: [
      { key:'file_no',        label:'رقم الملف *',       req:true,  example:'BOX-001'     },
      { key:'po_date',        label:'تاريخ الصفقة *',    req:true,  example:'2024-01-15'  },
      { key:'supplier',       label:'المورد *',           req:true,  example:'شركة المعادن'},
      { key:'total_purchase', label:'إجمالي الشراء *',   req:true,  example:'100000'      },
      { key:'po_no',          label:'رقم أمر الشراء',    req:false, example:'PO-2024-001' },
      { key:'status',         label:'الحالة',            req:false, example:'OPEN'        },
      { key:'notes',          label:'ملاحظات',           req:false, example:''            },
    ],
    fixed: { post_status:'posted' },
  },
  vehicles: {
    label: 'السيارات', table: 'vehicles',
    cols: [
      { key:'file_no',        label:'رقم الملف *',       req:true,  example:'BOX-001'     },
      { key:'vin',            label:'رقم الشاصي VIN *',  req:true,  example:'1HGBH41JX'   },
      { key:'model',          label:'الموديل *',         req:true,  example:'Toyota Camry'},
      { key:'year',           label:'سنة الصنع',         req:false, example:'2022'        },
      { key:'color',          label:'اللون',             req:false, example:'أبيض'        },
      { key:'vehicle_type',   label:'نوع المركبة',       req:false, example:'سيدان'       },
      { key:'purchase_price', label:'سعر الشراء',        req:false, example:'20000'       },
      { key:'engine_size',    label:'حجم المحرك',        req:false, example:'2000'        },
      { key:'plate',          label:'رقم اللوحة',        req:false, example:''            },
    ],
    fixed: {},
  },
  payments: {
    label: 'الدفعات', table: 'payments',
    cols: [
      { key:'file_no',    label:'رقم الملف *',   req:true,  example:'BOX-001'        },
      { key:'payer',      label:'الدافع *',       req:true,  example:'الصندوق'        },
      { key:'amount',     label:'المبلغ *',       req:true,  example:'50000'          },
      { key:'pay_date',   label:'تاريخ الدفع *', req:true,  example:'2024-01-20'     },
      { key:'pay_method', label:'طريقة الدفع',   req:false, example:'تحويل بنكي'     },
      { key:'document',   label:'رقم المستند',   req:false, example:'CHQ-001'        },
      { key:'notes',      label:'ملاحظات',       req:false, example:''               },
    ],
    fixed: { post_status:'posted' },
  },
  sales: {
    label: 'المبيعات', table: 'sales',
    cols: [
      { key:'file_no',    label:'رقم الملف *',     req:true,  example:'BOX-001'        },
      { key:'inv_no',     label:'رقم الفاتورة *',  req:true,  example:'INV-BOX-001-001'},
      { key:'sale_date',  label:'تاريخ البيع *',   req:true,  example:'2024-02-10'     },
      { key:'customer',   label:'العميل *',         req:true,  example:'أحمد محمد'     },
      { key:'vin',        label:'رقم الشاصي',      req:false, example:'1HGBH41JX'      },
      { key:'model',      label:'الموديل',         req:false, example:'Toyota Camry'   },
      { key:'sale_price', label:'سعر البيع *',      req:true,  example:'25000'         },
      { key:'pay_method', label:'طريقة الدفع',     req:false, example:'آجل'            },
    ],
    fixed: { post_status:'posted' },
  },
  expenses: {
    label: 'المصاريف', table: 'expenses',
    cols: [
      { key:'file_no',     label:'رقم الملف *',    req:true,  example:'BOX-001'       },
      { key:'exp_date',    label:'تاريخ المصروف *',req:true,  example:'2024-01-25'    },
      { key:'description', label:'البيان *',        req:true,  example:'شحن ونقل'     },
      { key:'amount',      label:'المبلغ *',        req:true,  example:'500'           },
      { key:'exp_type',    label:'نوع المصروف',    req:false, example:'شحن'           },
      { key:'vendor',      label:'المورد',          req:false, example:'شركة الشحن'   },
      { key:'pay_method',  label:'طريقة الدفع',    req:false, example:'نقد'           },
    ],
    fixed: { post_status:'posted' },
  },
  collections: {
    label: 'التحصيلات', table: 'collections',
    cols: [
      { key:'file_no',    label:'رقم الملف *',       req:true,  example:'BOX-001'        },
      { key:'inv_no',     label:'رقم الفاتورة *',    req:true,  example:'INV-BOX-001-001'},
      { key:'customer',   label:'العميل *',           req:true,  example:'أحمد محمد'     },
      { key:'amount',     label:'المبلغ *',           req:true,  example:'25000'          },
      { key:'due_date',   label:'تاريخ الاستحقاق',   req:false, example:'2024-03-01'     },
      { key:'paid_date',  label:'تاريخ الدفع الفعلي',req:false, example:'2024-03-05'     },
      { key:'pay_method', label:'طريقة الدفع',       req:false, example:'تحويل بنكي'    },
    ],
    fixed: { post_status:'posted' },
  },
};

const importState = { type: null, step: 1, parsedRows: [], file: null };

function showImportWizard() {
  hideAllViews();
  el('importWizardView').style.display = 'block';
  el('topBarTitle').textContent = '📥 استيراد بيانات';
  el('topBarSub').textContent   = `نظام ${state.system}`;
  navActive('nav-import');
  setImportStep(1);
}

function setImportStep(n) {
  importState.step = n;
  for (let i=1; i<=4; i++) {
    const panel = el(`imp-panel-${i}`);
    if (panel) panel.style.display = i===n ? 'block' : 'none';
    const step  = el(`imp-step-${i}`);
    if (step) {
      step.classList.remove('active','done');
      if (i===n) step.classList.add('active');
      else if (i<n) step.classList.add('done');
    }
  }
}

function selectImportType(type) {
  importState.type = type;
  const schema = IMPORT_SCHEMAS[type];
  document.querySelectorAll('.imp-type-card').forEach(c => c.classList.remove('active'));
  el(`itype-${type}`)?.classList.add('active');
  const btn = el('imp-next-1');
  if (btn) { btn.disabled=false; btn.textContent=`التالي ← Template ${schema.label}`; }

  // تحضير Step 2
  if (el('imp-template-title')) el('imp-template-title').textContent = `Template ${schema.label}`;
  if (el('imp-cols-list')) {
    el('imp-cols-list').innerHTML = schema.cols.map(c =>
      `<div style="padding:2px 0"><span style="color:${c.req?'var(--red)':'var(--text2)'};font-weight:700;font-family:monospace;margin-left:8px">${c.key}</span>
       <span>${c.label}</span>
       ${c.req?'<span style="color:var(--red);font-size:10px"> (مطلوب)</span>':''}
       <span style="color:var(--text2);font-size:10px"> — مثال: ${c.example}</span>
      </div>`
    ).join('');
  }
}

function downloadImportTemplate() {
  const type = importState.type;
  if (!type) return;
  const schema = IMPORT_SCHEMAS[type];

  // بناء CSV template
  const headers = schema.cols.map(c => c.key).join(',');
  const example = schema.cols.map(c => `"${c.example}"`).join(',');
  const csv = '\uFEFF' + headers + '\n' + example + '\n';

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
  a.download = `template_${type}_${state.system}.csv`;
  a.click();
  toast(`✅ تم تنزيل template_${type}.csv`,'ok');
}

function handleImportDrop(event) {
  event.preventDefault();
  el('imp-drop-zone').style.borderColor = 'var(--border)';
  const file = event.dataTransfer.files[0];
  if (file) processImportFile(file);
}

function handleImportFile(input) {
  const file = input.files[0];
  if (file) processImportFile(file);
}

function processImportFile(file) {
  importState.file = file;
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx','xls','csv'].includes(ext)) {
    el('imp-file-status').innerHTML = `<span style="color:var(--red)">❌ نوع الملف غير مدعوم — استخدم xlsx أو csv</span>`;
    return;
  }
  el('imp-file-status').innerHTML = `<span style="color:var(--green)">✅ ${file.name} (${(file.size/1024).toFixed(1)} KB)</span>`;
  const btn = el('imp-parse-btn');
  if (btn) btn.disabled = false;
}

async function parseImportFile() {
  const file = importState.file;
  const type = importState.type;
  if (!file || !type) return;

  const schema = IMPORT_SCHEMAS[type];
  const btn    = el('imp-parse-btn');
  btn.disabled = true; btn.textContent = '⏳ جاري التحليل...';

  try {
    const rows = await readFileAsRows(file);
    if (!rows || rows.length < 2) throw new Error('الملف فارغ أو لا يحتوي على بيانات');

    const headerRow   = rows[0].map(h => String(h||'').trim());
    const dataRows    = rows.slice(1).filter(r => r.some(v => v !== null && v !== ''));
    const schemaKeys  = schema.cols.map(c => c.key);

    // تحقق الأعمدة المطلوبة
    const missingReq  = schema.cols.filter(c => c.req && !headerRow.includes(c.key));
    if (missingReq.length) throw new Error(`أعمدة مطلوبة غير موجودة: ${missingReq.map(c=>c.key).join(', ')}`);

    // تحويل الصفوف لـ objects
    const parsed = dataRows.map((row, i) => {
      const obj = { system_type: state.system, ...schema.fixed };
      headerRow.forEach((h, idx) => {
        if (schemaKeys.includes(h)) {
          let val = row[idx];
          if (val === null || val === undefined || val === '') val = null;
          else val = String(val).trim();
          obj[h] = val;
        }
      });
      return obj;
    });

    // تحقق الأعمدة المطلوبة في البيانات
    const errors = [];
    parsed.forEach((row, i) => {
      schema.cols.filter(c=>c.req).forEach(c => {
        if (!row[c.key]) errors.push(`سطر ${i+2}: ${c.key} فارغ`);
      });
    });

    importState.parsedRows = parsed;
    setImportStep(4);
    renderImportPreview(parsed, errors, schema);
  } catch(e) {
    el('imp-file-status').innerHTML = `<span style="color:var(--red)">❌ خطأ: ${e.message}</span>`;
  } finally {
    btn.disabled = false; btn.textContent = 'التالي ← مراجعة البيانات';
  }
}

async function readFileAsRows(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    if (ext === 'csv') {
      reader.onload = e => {
        const text = e.target.result;
        const rows = text.split('\n').filter(l=>l.trim()).map(line => {
          // parse CSV with quotes
          const result=[], re=/("([^"]*)"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g;
          let m;
          const simple = line.split(',');
          return simple.map(v => v.replace(/^"|"$/g,'').trim() || null);
        });
        resolve(rows);
      };
      reader.readAsText(file, 'utf-8');
    } else {
      reader.onload = e => {
        try {
          const XLSX = window.XLSX;
          if (!XLSX) { reject(new Error('مكتبة XLSX غير محملة — استخدم CSV')); return; }
          const wb   = XLSX.read(e.target.result, {type:'array'});
          const ws   = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws, {header:1, defval:null});
          resolve(data);
        } catch(err) { reject(err); }
      };
      reader.readAsArrayBuffer(file);
    }
    reader.onerror = reject;
  });
}

function renderImportPreview(parsed, errors, schema) {
  const wrap = el('imp-preview-wrap');
  if (!wrap) return;

  const validRows = errors.length === 0 ? parsed : parsed.filter((_,i) => {
    return !errors.some(e => e.startsWith(`سطر ${i+2}:`));
  });

  const errHtml = errors.length ? `
    <div style="background:var(--red-dim);border:1px solid var(--red);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:12px;max-height:150px;overflow-y:auto">
      <div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:6px">⚠️ ${errors.length} خطأ في البيانات:</div>
      ${errors.slice(0,20).map(e=>`<div style="font-size:11px;color:var(--red)">${e}</div>`).join('')}
      ${errors.length>20?`<div style="font-size:11px;color:var(--text2)">... و ${errors.length-20} خطأ آخر</div>`:''}
    </div>` : '';

  const previewCols = schema.cols.slice(0,6);
  const tableRows   = parsed.slice(0,10).map(row => `<tr>${previewCols.map(c=>`<td style="padding:6px 10px;font-size:11px;border-bottom:1px solid var(--border)">${row[c.key]||'—'}</td>`).join('')}</tr>`).join('');

  wrap.innerHTML = `
    ${errHtml}
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;margin-bottom:10px">
        📊 معاينة البيانات — ${parsed.length} صف
        ${errors.length?`<span style="color:var(--red);font-size:11px"> (${errors.length} سطر فيه أخطاء)</span>`:'<span style="color:var(--green);font-size:11px"> ✅ كل البيانات صحيحة</span>'}
      </div>
      <div style="overflow-x:auto;max-height:240px;overflow-y:auto;margin-bottom:12px">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--card2)">${previewCols.map(c=>`<th style="padding:6px 10px;font-size:11px;text-align:right">${c.label}</th>`).join('')}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        ${parsed.length>10?`<div style="font-size:11px;color:var(--text2);padding:6px 10px">... و ${parsed.length-10} صف آخر</div>`:''}
      </div>
    </div>

    <div style="background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:14px;font-size:12px">
      ⚠️ سيتم إدراج <strong>${validRows.length} صف</strong> في جدول <strong>${schema.table}</strong> لنظام <strong>${state.system}</strong>
      — العملية لا يمكن التراجع عنها بسهولة
    </div>

    <div style="display:flex;gap:8px">
      <button class="btn btn-secondary" onclick="setImportStep(3)">← رجوع</button>
      <button class="btn btn-primary" onclick="runImport()" style="background:var(--accent);border-color:var(--accent)">
        ⚡ استيراد ${validRows.length} سجل
      </button>
    </div>
    <div id="imp-run-progress" style="margin-top:12px"></div>`;
}

async function runImport() {
  const type   = importState.type;
  const schema = IMPORT_SCHEMAS[type];
  const rows   = importState.parsedRows;
  const sys    = state.system;

  const prog  = el('imp-run-progress');
  const btn   = el('imp-preview-wrap')?.querySelector('.btn-primary');
  if (btn) { btn.disabled=true; btn.textContent='⏳ جاري الاستيراد...'; }

  let inserted=0, failed=0;
  const BATCH = 50;

  prog.innerHTML = `<div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px 14px">
    <div style="height:8px;background:var(--border);border-radius:6px;overflow:hidden;margin-bottom:6px">
      <div id="imp-prog-bar" style="height:100%;background:var(--accent);border-radius:6px;transition:width .3s;width:0%"></div>
    </div>
    <div id="imp-prog-label" style="font-size:11px;color:var(--text2)">0 / ${rows.length}</div>
  </div>`;

  for (let i=0; i<rows.length; i+=BATCH) {
    const batch = rows.slice(i, i+BATCH);
    try {
      const res = await fetch(`${SB_URL}/rest/v1/${schema.table}`, {
        method: 'POST',
        headers: { ...headers(), 'Prefer':'return=minimal' },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        const err = await res.text();
        console.warn(`Batch ${i}-${i+BATCH} failed:`, err);
        failed += batch.length;
      } else {
        inserted += batch.length;
      }
    } catch(e) { failed += batch.length; }

    const pct = Math.round((i+BATCH)/rows.length*100);
    if (el('imp-prog-bar')) el('imp-prog-bar').style.width = Math.min(pct,100)+'%';
    if (el('imp-prog-label')) el('imp-prog-label').textContent = `${Math.min(i+BATCH,rows.length)} / ${rows.length} · نجح: ${inserted}${failed?` · فشل: ${failed}`:''}`;
  }

  // النتيجة
  const ok = failed===0;
  prog.innerHTML += `
    <div style="background:${ok?'var(--green-dim)':'var(--accent-dim)'};border:1px solid ${ok?'var(--green)':'var(--accent)'};border-radius:var(--radius-sm);padding:12px 14px;margin-top:10px">
      <div style="font-size:13px;font-weight:700;color:${ok?'var(--green)':'var(--accent)'}">
        ${ok?'✅ اكتمل الاستيراد بنجاح':'⚠️ اكتمل مع أخطاء'}
      </div>
      <div style="font-size:12px;margin-top:4px">
        ✅ تم إدراج: <strong>${inserted}</strong>
        ${failed?` · ❌ فشل: <strong>${failed}</strong>`:''}
      </div>
    </div>
    <div style="margin-top:10px;display:flex;gap:8px">
      <button class="btn btn-primary" onclick="runPostImportMigration()">⚡ توليد القيود المحاسبية</button>
      <button class="btn btn-secondary" onclick="selectImportType('${type}');setImportStep(3)">📥 استيراد ملف آخر</button>
      <button class="btn btn-secondary" onclick="showDashboard()">🏠 الداشبورد</button>
    </div>`;

  invalidateCache();
  await logAudit('IMPORT', schema.table, null, null, { type, inserted, failed, system:sys });
}

async function runPostImportMigration() {
  toast('⏳ جاري توليد القيود للبيانات المستوردة...','ok');
  openMigrationModal();
  setTimeout(() => {
    if (el('mig-confirm-input')) el('mig-confirm-input').value = 'MIGRATE';
  }, 400);
}
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

// ════════════════════════════════════════════════════════════════
// REVERSAL ENGINE — إلغاء العمليات بقيد عكسي
// المبدأ:
//   1. يُضيف قيد عكسي (Dr↔Cr معكوسة) بتاريخ اليوم
//   2. يضع post_status='voided' على السجل التشغيلي
//   3. لا يُحذف أي بيانات — كل شيء يبقى في التاريخ
// ════════════════════════════════════════════════════════════════

async function voidTransaction(type, record) {
  const sys     = state.system;
  const today_  = today();
  const amount  = +record.amount || +record.sale_price || 0;

  if (!amount || amount <= 0) throw new Error('المبلغ صفر — لا يوجد قيد لعكسه');

  // ── بناء أسطر القيد العكسي حسب نوع العملية ──
  let reversalLines = [];
  let reversalDesc  = '';
  let refTable      = 'reversal';

  if (type === 'payment') {
    // القيد الأصلي: Dr 2100 ذمم موردين / Cr 1110|1120 نقد|بنك
    // العكس:        Dr 1110|1120 / Cr 2100
    const cashAcc = (record.pay_method||'') === 'نقد' ? '1110' : '1120';
    const cashNm  = (record.pay_method||'') === 'نقد' ? 'النقد' : 'البنك';
    const sup     = record.supplier || record.payer || 'مورد';
    reversalDesc  = `عكس دفعة ${record.ref_no||record.pay_id||''} — ${sup} — ملف ${record.file_no}`;
    reversalLines = [
      { acc: cashAcc, name: cashNm,           dr: amount, cr: 0,      contact: null },
      { acc: '2100',  name: 'ذمم الموردين',   dr: 0,      cr: amount, contact: sup  },
    ];

  } else if (type === 'expense') {
    // القيد الأصلي: Dr 6xxx / Cr 1110|1120
    // العكس:        Dr 1110|1120 / Cr 6xxx
    const eAcc    = EXPENSE_ACCOUNT_MAP[record.exp_type||record.category] || '6500';
    const cashAcc = (record.pay_method||'') === 'نقد' ? '1110' : '1120';
    const cashNm  = (record.pay_method||'') === 'نقد' ? 'النقد' : 'البنك';
    reversalDesc  = `عكس مصروف ${record.ref_no||''} — ${record.description||''} — ملف ${record.file_no}`;
    reversalLines = [
      { acc: cashAcc, name: cashNm,                         dr: amount, cr: 0,      contact: null },
      { acc: eAcc,    name: record.exp_type || 'مصروف',     dr: 0,      cr: amount, contact: null },
    ];

  } else if (type === 'collection') {
    // القيد الأصلي: Dr 1110|1120 / Cr 1200 ذمم عملاء
    // العكس:        Dr 1200 / Cr 1110|1120
    const cashAcc = (record.pay_method||'') === 'نقد' ? '1110' : '1120';
    const cashNm  = (record.pay_method||'') === 'نقد' ? 'النقد' : 'البنك';
    const cust    = record.customer || 'عميل';
    reversalDesc  = `عكس تحصيل ${record.ref_no||''} — ${cust} — فاتورة ${record.inv_no||''}`;
    reversalLines = [
      { acc: '1200',  name: 'ذمم العملاء', dr: amount, cr: 0,      contact: cust },
      { acc: cashAcc, name: cashNm,         dr: 0,      cr: amount, contact: null },
    ];

  } else if (type === 'payout') {
    // القيد الأصلي: Dr 2400 حسابات شركاء / Cr 1110|1120
    // العكس:        Dr 1110|1120 / Cr 2400
    const cashAcc = (record.pay_method||'') === 'نقد' ? '1110' : '1120';
    const cashNm  = (record.pay_method||'') === 'نقد' ? 'النقد' : 'البنك';
    reversalDesc  = `عكس صرف شريك ${record.pay_id||record.ref_no||''} — ${record.partner||''} — ملف ${record.file_no}`;
    reversalLines = [
      { acc: cashAcc, name: cashNm,                dr: amount, cr: 0,      contact: null            },
      { acc: '2400',  name: 'حسابات الشركاء',     dr: 0,      cr: amount, contact: record.partner  },
    ];

  } else {
    throw new Error(`نوع العملية "${type}" غير مدعوم في الإلغاء`);
  }

  // ── 1. تسجيل القيد العكسي ──
  await postDoubleEntry({
    sys,
    date:      today_,
    fileNo:    record.file_no || null,
    refTable:  'reversal',
    refId:     record.id || null,
    desc:      reversalDesc,
    lines:     reversalLines,
  });

  // ── 2. وضع post_status = 'voided' على السجل التشغيلي ──
  const tableMap = {
    payment:    'payments',
    expense:    'expenses',
    collection: 'collections',
    payout:     'partner_payouts',
  };
  const tableName = tableMap[type];
  if (tableName && record.id) {
    await apiPatch(tableName, { id:`eq.${record.id}` }, {
      post_status: 'voided',
      notes: `${record.notes ? record.notes + ' | ' : ''}مُلغى بتاريخ ${today_}`,
    });
  }

  // ── 3. تسجيل في audit_log ──
  await logAudit(
    'VOID', tableName, record.file_no,
    record, { reversal_desc: reversalDesc, voided_at: today_ },
    `إلغاء بقيد عكسي: ${reversalDesc}`
  );

  invalidateCache();
}

async function _jeNo(sys) {
  try {
    const r = await apiGet('journal_entries',{select:'id',system_type:`eq.${sys}`,order:'id.desc',limit:1});
    return `JE-${new Date().getFullYear()}-${String((r?.[0]?.id||0)+1).padStart(5,'0')}`;
  } catch(e) { return `JE-${Date.now()}`; }
}

async function postDoubleEntry({sys, date, fileNo, refTable, refId, desc, lines}) {
  if (!lines || !lines.length) { console.warn('postDoubleEntry: no lines'); return; }
  const dr = lines.reduce((s,l)=>s+(+l.dr||0),0);
  const cr = lines.reduce((s,l)=>s+(+l.cr||0),0);
  if (Math.abs(dr-cr)>0.01) {
    const msg = `قيد غير متوازن: مدين=${dr.toFixed(2)} دائن=${cr.toFixed(2)} — ${desc}`;
    console.error(msg);
    throw new Error(msg);
  }
  const no      = await _jeNo(sys);
  const now     = new Date().toISOString();
  const inserts = lines.map(l => ({
    system_type:  sys,
    entry_no:     no,
    entry_date:   date || today(),
    account_code: l.acc     || null,
    account_name: l.name    || null,
    contact_name: l.contact || null,
    dr_amount:    +l.dr  || 0,
    cr_amount:    +l.cr  || 0,
    description:  l.desc || desc,
    ref_table:    refTable || null,
    ref_id:       refId    || null,
    file_no:      fileNo   || null,
    post_status:  'posted',
    posted_at:    now,
  }));

  // ── Batch insert: كل الأسطر في request واحد — إما كلها أو لا شيء ──
  const res = await fetch(`${SB_URL}/rest/v1/journal_entries`, {
    method:  'POST',
    headers: { ...headers(), 'Prefer': 'return=minimal' },
    body:    JSON.stringify(inserts),   // array = batch
  });

  if (!res.ok) {
    const body = await res.text().catch(()=>'');
    // محاولة حذف أي سطر تسرّب بنفس entry_no (حماية من التكرار)
    try {
      await fetch(`${SB_URL}/rest/v1/journal_entries?entry_no=eq.${encodeURIComponent(no)}&system_type=eq.${encodeURIComponent(sys)}`,
        { method:'DELETE', headers: headers() });
    } catch(_) {}
    throw new Error(`فشل تسجيل القيد "${desc}" — ${res.status}: ${body}`);
  }
}

// شراء: مخزون Dr / مورد Cr
async function je_purchase({sys,date,amount,fileNo,supplier}) {
  if(!amount||amount<=0) return;
  await postDoubleEntry({sys,date,fileNo,refTable:'purchase_orders',desc:`شراء — ملف ${fileNo} — ${supplier}`,lines:[
    {acc:'1300', name:getAccountName('1300'),  dr:amount, cr:0,      contact:null     },
    {acc:'2100', name:`ذمم الموردين`,           dr:0,      cr:amount, contact:supplier },
  ]});
}

// بيع: عميل Dr / إيراد Cr
async function je_sale({sys,date,amount,cost,fileNo,customer,invNo}) {
  if(!amount||amount<=0) return;
  const lines = [
    {acc:'1200', name:`ذمم العملاء`,        dr:amount, cr:0,     contact:customer, desc:`فاتورة ${invNo}`},
    {acc:'4100', name:getAccountName('4100'), dr:0,    cr:amount, contact:null,     desc:`فاتورة ${invNo}`},
  ];
  if (cost>0) {
    lines.push({acc:'5100', name:'تكلفة المخزون المباع', dr:cost, cr:0,    contact:null});
    lines.push({acc:'1300', name:'المخزون — سيارات',     dr:0,    cr:cost, contact:null});
  }
  await postDoubleEntry({sys,date,fileNo,refTable:'sales',desc:`بيع فاتورة ${invNo} — ${customer} — ملف ${fileNo}`,lines});
}

// تحصيل: نقد Dr / عميل Cr
async function je_collection({sys,date,amount,fileNo,customer,invNo,method}) {
  if(!amount||amount<=0) return;
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'collections',desc:`تحصيل ${invNo} — ${customer} — ملف ${fileNo}`,lines:[
    {acc:cashAcc, name:cashNm,           dr:amount, cr:0,     contact:null     },
    {acc:'1200',  name:`ذمم العملاء`,    dr:0,      cr:amount, contact:customer },
  ]});
}

// دفعة مورد: مورد Dr / نقد Cr
async function je_payment({sys,date,amount,fileNo,supplier,supplierName,payer,payerName,method}) {
  if(!amount||amount<=0) return;
  const sup      = supplier || supplierName || 'مورد';
  const payerStr = payer || payerName || sup;
  const cashAcc  = method==='نقد'?'1110':'1120';
  const cashNm   = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'payments',desc:`دفعة للمورد ${sup} بواسطة ${payerStr} — ملف ${fileNo}`,lines:[
    {acc:'2100',  name:`ذمم الموردين`, dr:amount, cr:0,     contact:sup  },
    {acc:cashAcc, name:cashNm,         dr:0,      cr:amount, contact:null },
  ]});
}

// مصروف: مصروف Dr / نقد Cr
async function je_expense({sys,date,amount,fileNo,desc,expType,method}) {
  if(!amount||amount<=0) return;
  const eAcc     = EXPENSE_ACCOUNT_MAP[expType]||'6500';
  const cashAcc  = method==='نقد'?'1110':'1120';
  const cashNm   = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'expenses',desc:`${desc} — ملف ${fileNo||'عام'}`,lines:[
    {acc:eAcc,    name:expType||'مصروف', dr:amount, cr:0,     contact:null},
    {acc:cashAcc, name:cashNm,           dr:0,      cr:amount, contact:null},
  ]});
}

// صرف شريك: شريك Dr / نقد Cr
async function je_payout({sys,date,amount,fileNo,partner,method}) {
  if(!amount||amount<=0) return;
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'partner_payouts',desc:`صرف شريك ${partner} — ملف ${fileNo}`,lines:[
    {acc:'2400',  name:`حسابات الشركاء`, dr:amount, cr:0,     contact:partner },
    {acc:cashAcc, name:cashNm,           dr:0,      cr:amount, contact:null    },
  ]});
}

// مصروف تشغيلي: مصروف Dr / نقد Cr
async function je_opex({sys,date,amount,expType,desc,method,refNo}) {
  if(!amount||amount<=0) return;
  const OPEX_ACC_MAP = {
    'رواتب':'6100','إيجارات':'6200','عمولات':'6300',
    'نظافة':'6400','ضيافة':'6500','مصروفات حكومية':'6600','أخرى':'6700',
  };
  const eAcc    = OPEX_ACC_MAP[expType] || '6700';
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo:null,refTable:'operating_expenses',refId:refNo||null,
    desc:`مصروف تشغيلي: ${desc||expType}`,lines:[
    {acc:eAcc,    name:`مصروف تشغيلي — ${expType||'أخرى'}`, dr:amount, cr:0,     contact:null},
    {acc:cashAcc, name:cashNm,                               dr:0,      cr:amount, contact:null},
  ]});
}
let _pwaInstallPrompt = null;
