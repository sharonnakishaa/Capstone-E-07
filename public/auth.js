// Status login bersama untuk semua halaman EPEN. Gaya tombol .auth-btn ada di /epen.css.
// Pakai: <script src="/auth.js"></script>, lalu EpenAuth.renderWidget(el) dan EpenAuth.ready.then(user => ...).
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const style = document.createElement('style');
  style.textContent = `
    .auth-widget{display:flex;align-items:center;gap:8px;flex-shrink:0;min-width:0}
    .auth-name{font-size:13px;font-weight:700;color:var(--muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    @media (max-width:720px){.auth-name{display:none}}
  `;
  document.head.appendChild(style);

  let user = null;
  const ready = fetch('/api/auth/me', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : { user: null }))
    .then(j => (user = j.user || null))
    .catch(() => null);

  function loginUrl() {
    return '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  }

  function renderWidget(el) {
    if (!el) return;
    ready.then(u => {
      el.className = 'auth-widget';
      if (u) {
        el.innerHTML = `<span class="auth-name" title="${esc(u.email)}">${esc(u.full_name)}</span>
          <button type="button" class="auth-btn">Keluar</button>`;
        el.querySelector('button').addEventListener('click', logout);
      } else {
        el.innerHTML = `<a class="auth-btn" href="${esc(loginUrl())}">Masuk</a>`;
      }
    });
  }

  window.EpenAuth = {
    get user() { return user; },
    ready,
    loginUrl,
    logout,
    renderWidget,
  };
})();
