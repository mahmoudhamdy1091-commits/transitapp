// ╔══════════════════════════════════════════════════════════╗
// ║  tests.js — Unit Tests for Profit Calculation Logic     ║
// ║  Transit Management System                               ║
// ║                                                          ║
// ║  ✅ Audit v2: اختبارات وحدة لحسابات الأرباح             ║
// ║  كيفية التشغيل: افتح الـ console وشغّل runAllTests()   ║
// ╚══════════════════════════════════════════════════════════╝
//
// لا يُعدّل هذا الملف أي state أو بيانات — قراءة فقط
// لا يتصل بـ Supabase — يختبر المنطق المحلي فقط

// ════════════════════════════════════════
// TEST RUNNER
// ════════════════════════════════════════
const _testResults = [];

function _test(name, fn) {
  try {
    fn();
    _testResults.push({ name, passed: true });
  } catch(e) {
    _testResults.push({ name, passed: false, error: e.message });
  }
}

function _assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function _assertEq(actual, expected, label) {
  if (Math.abs(actual - expected) > 0.001) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

// ════════════════════════════════════════
// PURE PROFIT CALCULATION
// نسخة pure من منطق _doLoadCache في core.js
// لا تعتمد على state أو fetch — قابلة للاختبار
// ════════════════════════════════════════

/**
 * calcDealProfit — نفس المنطق الموجود في core.js _doLoadCache
 * @param {object} deal       - سجل purchase_orders
 * @param {Array}  vehicles   - مصفوفة vehicles للملف
 * @param {Array}  sales      - مصفوفة sales للملف (posted فقط)
 * @param {Array}  expenses   - مصفوفة expenses للملف (posted فقط)
 * @returns {object} { totalCost, totalExp, fullCost, totalSale, profit, remaining }
 */
function calcDealProfit(deal, vehicles, sales, expenses) {
  // نفس المنطق حرفياً من core.js سطر 89-101
  const totalCost  = +deal.total_purchase || vehicles.reduce((s, v) => s + (+v.purchase_price || 0), 0);
  const totalExp   = expenses.reduce((s, e) => s + (+e.amount || 0), 0);
  const totalSale  = sales.reduce((s, sv) => s + (+sv.sale_price || 0), 0);
  const fullCost   = totalCost + totalExp;
  const profit     = totalSale - fullCost;
  const remaining  = fullCost - totalSale;
  return { totalCost, totalExp, fullCost, totalSale, profit, remaining };
}

// ════════════════════════════════════════
// TESTS — حسابات الأرباح
// ════════════════════════════════════════

function runProfitTests() {

  // ── T01: صفقة مربحة بسيطة ──
  _test('T01: صفقة مربحة — شراء 100 بيع 150 مصاريف 10', () => {
    const deal     = { total_purchase: 100 };
    const vehicles = [];
    const sales    = [{ sale_price: 150 }];
    const expenses = [{ amount: 10 }];
    const r = calcDealProfit(deal, vehicles, sales, expenses);
    _assertEq(r.totalCost,  100, 'totalCost');
    _assertEq(r.totalExp,    10, 'totalExp');
    _assertEq(r.fullCost,   110, 'fullCost');
    _assertEq(r.totalSale,  150, 'totalSale');
    _assertEq(r.profit,      40, 'profit');   // 150 - 110 = 40
    _assertEq(r.remaining,  -40, 'remaining');
  });

  // ── T02: صفقة خسارة ──
  _test('T02: صفقة خسارة — شراء 200 بيع 180 مصاريف 20', () => {
    const deal     = { total_purchase: 200 };
    const vehicles = [];
    const sales    = [{ sale_price: 180 }];
    const expenses = [{ amount: 20 }];
    const r = calcDealProfit(deal, vehicles, sales, expenses);
    _assertEq(r.fullCost,  220, 'fullCost');
    _assertEq(r.totalSale, 180, 'totalSale');
    _assertEq(r.profit,    -40, 'profit');   // خسارة 40
    _assert(r.profit < 0,       'profit should be negative');
  });

  // ── T03: بدون مصاريف ──
  _test('T03: بدون مصاريف — fullCost = totalCost', () => {
    const deal     = { total_purchase: 50000 };
    const vehicles = [];
    const sales    = [{ sale_price: 60000 }];
    const expenses = [];
    const r = calcDealProfit(deal, vehicles, sales, expenses);
    _assertEq(r.totalExp,  0,      'totalExp should be 0');
    _assertEq(r.fullCost,  50000,  'fullCost = totalCost when no expenses');
    _assertEq(r.profit,    10000,  'profit');
  });

  // ── T04: total_purchase يُقدَّم من vehicles لو الـ deal لا يحمله ──
  _test('T04: totalCost من vehicles عند غياب total_purchase في deal', () => {
    const deal     = { total_purchase: 0 };   // صفر = يقع على vehicles
    const vehicles = [
      { purchase_price: 5000 },
      { purchase_price: 7000 },
      { purchase_price: 3000 },
    ];
    const sales    = [{ sale_price: 20000 }];
    const expenses = [];
    const r = calcDealProfit(deal, vehicles, sales, expenses);
    _assertEq(r.totalCost, 15000, 'totalCost from vehicles sum');
    _assertEq(r.profit,     5000, 'profit');
  });

  // ── T05: صفقة بسيارتين مبيعتين ──
  _test('T05: سيارتان مباعتان — مجموع sale_price صحيح', () => {
    const deal     = { total_purchase: 80000 };
    const vehicles = [];
    const sales    = [{ sale_price: 45000 }, { sale_price: 50000 }];
    const expenses = [{ amount: 2000 }, { amount: 3000 }];
    const r = calcDealProfit(deal, vehicles, sales, expenses);
    _assertEq(r.totalSale, 95000, 'totalSale sum');
    _assertEq(r.totalExp,   5000, 'totalExp sum');
    _assertEq(r.fullCost,  85000, 'fullCost');
    _assertEq(r.profit,    10000, 'profit');
  });

  // ── T06: صفقة لم تُباع بعد ──
  _test('T06: صفقة بدون مبيعات — profit سالب = fullCost', () => {
    const deal     = { total_purchase: 30000 };
    const vehicles = [];
    const sales    = [];
    const expenses = [{ amount: 1000 }];
    const r = calcDealProfit(deal, vehicles, sales, expenses);
    _assertEq(r.totalSale,  0,     'totalSale = 0');
    _assertEq(r.profit,    -31000, 'profit = -fullCost when no sales');
    _assertEq(r.remaining,  31000, 'remaining = fullCost');
  });

  // ── T07: قيم كسرية (ديناري كويتي — 3 خانات عشرية) ──
  _test('T07: أرقام كسرية — دقة 3 خانات عشرية', () => {
    const deal     = { total_purchase: 10000.500 };
    const vehicles = [];
    const sales    = [{ sale_price: 12500.750 }];
    const expenses = [{ amount: 250.250 }];
    const r = calcDealProfit(deal, vehicles, sales, expenses);
    _assertEq(r.fullCost,  10250.750, 'fullCost decimal');
    _assertEq(r.totalSale, 12500.750, 'totalSale decimal');
    _assertEq(r.profit,     2250.000, 'profit decimal');
  });

  // ── T08: profit + remaining يساويان صفراً دائماً ──
  _test('T08: profit + remaining = 0 دائماً', () => {
    const cases = [
      { total_purchase: 100, salePrice: 150, expAmount: 10 },
      { total_purchase: 200, salePrice: 180, expAmount: 20 },
      { total_purchase: 0,   salePrice: 0,   expAmount: 0  },
    ];
    cases.forEach((c, i) => {
      const r = calcDealProfit(
        { total_purchase: c.total_purchase },
        [],
        c.salePrice ? [{ sale_price: c.salePrice }] : [],
        c.expAmount ? [{ amount: c.expAmount }] : []
      );
      _assert(
        Math.abs(r.profit + r.remaining) < 0.001,
        `Case ${i}: profit(${r.profit}) + remaining(${r.remaining}) should equal 0`
      );
    });
  });

  // ── T09: total_purchase له أولوية على مجموع vehicles ──
  _test('T09: total_purchase يُقدَّم على vehicles عند وجوده', () => {
    const deal     = { total_purchase: 50000 };  // موجود ← يُستخدم
    const vehicles = [{ purchase_price: 10000 }, { purchase_price: 10000 }]; // يُتجاهل
    const sales    = [{ sale_price: 60000 }];
    const expenses = [];
    const r = calcDealProfit(deal, vehicles, sales, expenses);
    _assertEq(r.totalCost, 50000, 'deal.total_purchase takes priority');
    // لو استُخدم vehicles كان سيكون 20000 — الصحيح 50000
  });

  // ── T10: قيم null/undefined تُعامَل كصفر ──
  _test('T10: قيم null وundefined لا تُسبب NaN', () => {
    const deal     = { total_purchase: null };
    const vehicles = [{ purchase_price: null }, { purchase_price: undefined }];
    const sales    = [{ sale_price: null }];
    const expenses = [{ amount: undefined }];
    const r = calcDealProfit(deal, vehicles, sales, expenses);
    _assert(!isNaN(r.profit),    'profit should not be NaN');
    _assert(!isNaN(r.totalCost), 'totalCost should not be NaN');
    _assert(!isNaN(r.totalSale), 'totalSale should not be NaN');
    _assertEq(r.profit, 0, 'all nulls → profit = 0');
  });
}

// ════════════════════════════════════════
// TESTS — isPosted / isDraft (core rules)
// ════════════════════════════════════════

function runPostStatusTests() {

  // نسخة local من isPosted/isDraft لاختبارها بمعزل
  const _isPosted = row => !row.post_status || row.post_status === 'posted';
  const _isDraft  = row => row.post_status === 'draft';

  _test('T11: post_status=null → isPosted (بيانات قديمة)', () => {
    _assert(_isPosted({ post_status: null }),    'null should be posted');
    _assert(_isPosted({ post_status: undefined }),'undefined should be posted');
    _assert(_isPosted({}),                        'missing field should be posted');
  });

  _test('T12: post_status=posted → isPosted', () => {
    _assert(_isPosted({ post_status: 'posted' }), 'posted should be posted');
    _assert(!_isDraft({ post_status: 'posted' }), 'posted should not be draft');
  });

  _test('T13: post_status=draft → isDraft', () => {
    _assert(_isDraft({ post_status: 'draft' }),    'draft should be draft');
    _assert(!_isPosted({ post_status: 'draft' }), 'draft should not be posted');
  });
}

// ════════════════════════════════════════
// TEST RUNNER — runAllTests()
// ════════════════════════════════════════

function runAllTests() {
  _testResults.length = 0;

  runProfitTests();
  runPostStatusTests();

  const passed = _testResults.filter(t => t.passed).length;
  const failed = _testResults.filter(t => !t.passed).length;
  const total  = _testResults.length;

  console.group('%c[Transit Tests]', 'font-weight:bold;color:#e6930a');
  console.log(`النتيجة: ${passed}/${total} اجتازت${failed > 0 ? ` — ${failed} فشلت` : ' ✅'}`);

  _testResults.forEach(t => {
    if (t.passed) {
      console.log(`  ✅ ${t.name}`);
    } else {
      console.error(`  ❌ ${t.name}: ${t.error}`);
    }
  });

  console.groupEnd();

  if (failed > 0) {
    console.warn(`⚠️ ${failed} اختبار فشل — راجع منطق الحسابات في core.js`);
  }

  return { passed, failed, total, results: _testResults };
}

// تشغيل تلقائي عند تحميل الملف في بيئة التطوير
// في الإنتاج: شغّل runAllTests() يدوياً من الـ console
if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  window.addEventListener('load', () => {
    setTimeout(() => {
      console.log('[Transit Tests] تشغيل تلقائي في localhost...');
      runAllTests();
    }, 1000);
  });
}
