// ╔══════════════════════════════════════════════════════════╗
// ║  fleet-router.js — راوتر بسيط بالـhash، بدون فريمورك      ║
// ╚══════════════════════════════════════════════════════════╝

const routes = {};
let defaultRoute = 'dashboard';

export function registerRoute(name, renderFn) {
  routes[name] = renderFn;
}

export function navigate(name, params = {}) {
  const qs = new URLSearchParams(params).toString();
  window.location.hash = name + (qs ? '?' + qs : '');
}

async function _render() {
  const raw = window.location.hash.slice(1) || defaultRoute;
  const [name, qs] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const main = document.getElementById('fleetMain');
  if (!main) return;
  const fn = routes[name] || routes[defaultRoute];
  if (!fn) {
    main.innerHTML = '<div class="fleet-loading">الصفحة غير موجودة</div>';
    return;
  }
  main.innerHTML = '<div class="fleet-loading">جاري التحميل...</div>';
  try {
    await fn(params, main);
  } catch (e) {
    console.error('[fleet-router]', e);
    main.innerHTML = `<div class="fleet-card" style="color:var(--red)">حدث خطأ أثناء تحميل الصفحة: ${e.message}</div>`;
  }
}

export function initRouter(defaultRouteName = 'dashboard') {
  defaultRoute = defaultRouteName;
  window.addEventListener('hashchange', _render);
  _render();
}
