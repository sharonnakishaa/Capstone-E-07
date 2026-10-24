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
    .idle-note{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:1000;width:min(460px,calc(100vw - 32px));
      display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--surface);color:var(--text);
      border:2px solid var(--line);border-radius:10px;box-shadow:var(--sh-lg);font-size:13.5px;line-height:1.45}
    .idle-note.warn{border-color:var(--ink-waspada)}
    .idle-note p{margin:0;flex:1}
    .idle-note strong{color:var(--text-strong)}
    .idle-note .btn{height:34px;padding:0 12px;font-size:13px;flex-shrink:0}
  `;
  document.head.appendChild(style);

  let user = null;
  let idleMs = 30 * 60 * 1000; // ditimpa idle_timeout_sec dari server
  const ready = fetch('/api/auth/me', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : { user: null }))
    .then(j => {
      if (j.idle_timeout_sec) idleMs = j.idle_timeout_sec * 1000;
      return (user = j.user || null);
    })
    .catch(() => null);

  function loginUrl() {
    return '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
  }

  // Masih memakai password sementara: semua aksi pengelola ditolak server, jadi langsung arahkan
  // ke langkah ganti password di halaman login (lalu kembali ke halaman ini).
  ready.then(u => { if (u && u.must_change_password) location.replace(loginUrl()); });

  /* KELUAR OTOMATIS SAAT TIDAK AKTIF — dashboard dipakai di komputer lab bersama.
     Server yang menentukan (lib/auth.ts, SESSION_IDLE_SEC); bagian ini memberi peringatan, mengirim ping
     aktivitas ke /api/auth/me, dan keluar lebih dulu supaya layar tidak menampilkan akun yang sudah habis.
     Waktu aktivitas dibagi lewat localStorage, jadi aktif di satu tab = aktif di semua tab. */
  const ACTIVITY_KEY = 'epen-last-activity';
  const PING_KEY     = 'epen-last-ping';
  const IDLE_FLAG    = 'epen-idle-logout';
  const PING_EVERY_MS = 60 * 1000;
  const WARN_BEFORE_MS = 60 * 1000;
  const store = {
    get(k) { try { return Number(localStorage.getItem(k)) || 0; } catch (e) { return 0; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} },
  };
  let localActivity = Date.now(), localPing = Date.now(), lastMark = 0, note = null, loggingOut = false;

  function showNote(html, kind, withButton) {
    if (!note) {
      note = document.createElement('div');
      note.setAttribute('role', 'status');
      document.body.appendChild(note);
    }
    note.className = 'idle-note' + (kind ? ' ' + kind : '');
    note.innerHTML = `<p>${html}</p>${withButton ? '<button type="button" class="btn">Tetap masuk</button>' : ''}`;
    note.querySelector('button')?.addEventListener('click', () => markActivity(true));
  }
  function hideNote() { note?.remove(); note = null; }

  function markActivity(force) {
    const now = Date.now();
    if (!force && now - lastMark < 5000) return; // cukup dicatat tiap 5 detik
    lastMark = localActivity = now;
    store.set(ACTIVITY_KEY, now);
    // Ping paling sering sekali per menit (dari tab mana pun) untuk memperbarui sesi di server
    if (force || now - Math.max(localPing, store.get(PING_KEY)) >= PING_EVERY_MS) {
      localPing = now;
      store.set(PING_KEY, now);
      fetch('/api/auth/me', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then(j => { if (j && !j.user) location.reload(); }) // sesi sudah dicabut/habis di server
        .catch(() => {});
    }
    if (note && note.classList.contains('warn')) hideNote();
  }

  async function idleLogout() {
    if (loggingOut) return;
    loggingOut = true;
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    try { sessionStorage.setItem(IDLE_FLAG, '1'); } catch (e) {}
    location.reload();
  }

  function checkIdle() {
    const idle = Date.now() - Math.max(localActivity, store.get(ACTIVITY_KEY));
    if (idle >= idleMs) return idleLogout();
    if (idle >= idleMs - WARN_BEFORE_MS) {
      const left = Math.ceil((idleMs - idle) / 1000);
      showNote(`Tidak ada aktivitas. Sesi pengelola <strong>${esc(user.full_name)}</strong> berakhir dalam <strong>${left} detik</strong>.`, 'warn', true);
    } else if (note && note.classList.contains('warn')) {
      hideNote(); // ada aktivitas di tab lain
    }
  }

  ready.then(u => {
    // Baru saja dikeluarkan otomatis: beri tahu sekali (siapa pun yang duduk di depan komputer)
    let wasIdle = false;
    try { wasIdle = sessionStorage.getItem(IDLE_FLAG) === '1'; sessionStorage.removeItem(IDLE_FLAG); } catch (e) {}
    if (wasIdle && !u) {
      showNote(`Sesi pengelola berakhir otomatis setelah ${Math.round(idleMs / 60000)} menit tidak aktif.`, null, false);
      setTimeout(hideNote, 8000);
    }

    if (!u || u.must_change_password) return;
    // Membuka halaman = aktivitas; panggilan /api/auth/me di atas sudah memperbarui sesi di server
    const now = Date.now();
    localActivity = localPing = now;
    store.set(ACTIVITY_KEY, now);
    store.set(PING_KEY, now);
    for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) {
      addEventListener(ev, () => markActivity(false), { passive: true, capture: true });
    }
    setInterval(checkIdle, 1000);
  });

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
