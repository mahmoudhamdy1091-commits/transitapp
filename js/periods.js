// ╔══════════════════════════════════════════════════════════╗
// ║  periods.js — Unified Period Date Math                   ║
// ║  Transit Management System                               ║
// ╚══════════════════════════════════════════════════════════╝
// مصدر واحد لحساب نطاقات الفترات (from/to) — كان مكرراً حرفياً
// في 6 شاشات (tx/opex/activity/reports/trial+ledger/journal).
// دالة نقية: تحسب التواريخ فقط بلا أي أثر على DOM.
// كل شاشة تحتفظ بآثارها الجانبية (الأزرار + المُحمّل) وتنادي هذه.
//
// weekStart: 'sun' (افتراضي — الأحد→السبت) أو 'sat' (السبت→الجمعة).
//   ميزان المراجعة ودفتر الأستاذ يستخدمان 'sat' (سلوكهما الأصلي).
// الصيغة محليّة بالظبط مثل الكود القديم لتفادي انزياح المنطقة الزمنية.

function getPeriodDates(period, { weekStart = 'sun' } = {}) {
  const pad    = n => String(n).padStart(2, '0');
  const toDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const now    = new Date();
  const yr     = now.getFullYear();

  if (period === 'today') {
    const t = toDate(now);
    return { from: t, to: t };
  }

  if (period === 'week') {
    if (weekStart === 'sat') {
      // السبت → الجمعة
      const day = now.getDay();
      const sat = new Date(now); sat.setDate(now.getDate() - ((day + 1) % 7));
      const fri = new Date(sat); fri.setDate(sat.getDate() + 6);
      return { from: toDate(sat), to: toDate(fri) };
    }
    // الأحد → السبت
    const sun = new Date(now); sun.setDate(now.getDate() - now.getDay());
    const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
    return { from: toDate(sun), to: toDate(sat) };
  }

  if (period === 'month') {
    return { from: `${yr}-${pad(now.getMonth()+1)}-01`, to: toDate(new Date(yr, now.getMonth()+1, 0)) };
  }

  if (period === 'lastmonth') {
    const lm  = new Date(yr, now.getMonth()-1, 1);
    const lme = new Date(yr, now.getMonth(), 0);
    return { from: `${lm.getFullYear()}-${pad(lm.getMonth()+1)}-01`, to: toDate(lme) };
  }

  if (period === '3months') {
    const f = new Date(now); f.setMonth(f.getMonth() - 3);
    return { from: toDate(f), to: toDate(now) };
  }

  if (period === 'year') {
    return { from: `${yr}-01-01`, to: `${yr}-12-31` };
  }

  if (period === 'lastyear') {
    return { from: `${yr-1}-01-01`, to: `${yr-1}-12-31` };
  }

  return { from: null, to: null };
}
