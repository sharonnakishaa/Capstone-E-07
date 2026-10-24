// Status login bersama untuk semua halaman EPEN. Gaya tombol .auth-btn ada di /epen.css.
// Pakai: <script src="/auth.js"></script>, lalu EpenAuth.renderWidget(el) dan EpenAuth.ready.then(user => ...).
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const style = document.createElement('style');
  style.textContent = `
    .auth-widget{display:flex;align-items:center;gap:8px;flex-shrink:0;min-width:0}
    .auth-name{font-size:13px;font-weight:700;color:var(--muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none}
    a.auth-name:hover{color:var(--text-strong);text-decoration:underline;text-underline-offset:3px}
    .auth-btn svg{flex-shrink:0}
    @media (max-width:720px){.auth-name,.auth-link-label{display:none}.auth-manage{width:40px;padding:0}}
    @media (max-width:420px){.auth-logout-label{display:none}.auth-logout{width:40px;padding:0}}
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
        // Tautan Kelola Alat hanya untuk pengelola, dan tidak perlu di halaman pengelola (sudah ada tab)
        const manage = ['/devices.html', '/accounts.html'].includes(location.pathname) ? '' :
          `<a class="auth-btn auth-manage" href="/devices.html" title="Kelola Alat" aria-label="Kelola Alat">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span class="auth-link-label">Kelola Alat</span>
          </a>`;
        // Di layar sempit tombol Keluar jadi ikon saja supaya topbar tetap satu baris
        // Nama membuka akun sendiri (ganti password) di Kelola Akun
        el.innerHTML = `${manage}<a class="auth-name" href="/accounts.html#password" title="${esc(u.email)} — akun saya">${esc(u.full_name)}</a>
          <button type="button" class="auth-btn auth-logout" aria-label="Keluar" title="Keluar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span class="auth-logout-label">Keluar</span>
          </button>`;
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
