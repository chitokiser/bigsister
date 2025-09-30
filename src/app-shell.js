// src/app-shell.js
(() => {
  'use strict';

  const PARTIALS_BASE = window.LM_PARTIALS_BASE || 'partials/';
  const $header = document.getElementById('app-header');
  const $footer = document.getElementById('app-footer');
  const BRAND_URL = 'https://puppi.netlify.app';

  // partial 로드 (없으면 fallback)
  async function inject(el, url, fallbackHTML) {
    if (!el) return;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      el.innerHTML = await res.text();
    } catch {
      el.innerHTML = fallbackHTML();
    }
  }

  // ────────────────────────────────────────────────────────────
  // Fallback Header / Footer
  // ────────────────────────────────────────────────────────────
  const fallbackHeader = () => `
    <header class="header">
      <div class="container inner">
        <!-- 로고: puppi.netlify.app 로 이동 -->
        <a class="brand" href="${BRAND_URL}" title="Puppi 홈으로 이동" target="_self" rel="noopener">
          <img src="./assets/paw120x120.png" class="logo-30" alt="PawMate" style="border-radius:50%;"/>
          <strong>PawMate</strong>
        </a>

        <!-- 데스크톱 내비게이션 -->
        <nav class="desktop-only">
          <a href="index.html" class="btn link">홈</a>
          <a href="search.html" class="btn link">검색</a>
          <a href="agents.html" class="btn link">메이트</a>
          <a href="items.html" class="btn link">상품</a>
          <a href="about.html" class="btn link">소개</a>
        </nav>

        <div id="nav-auth" class="desktop-only"></div>

        <!-- 모바일 메뉴 버튼 -->
        <button id="btn-open-nav" class="btn subtle mobile-only"
          aria-controls="nav-drawer" aria-expanded="false" aria-label="메뉴 열기">☰</button>
      </div>
    </header>

    <!-- 모바일 드로어 -->
    <div id="nav-drawer" class="nav-links" role="dialog" aria-modal="true"
         aria-labelledby="nav-title" aria-hidden="true" tabindex="-1" inert>
      <div class="drawer">
        <div class="row between center">
          <div id="nav-title" class="title">메뉴</div>
          <button id="btn-close-nav" class="btn subtle" aria-label="닫기">✕</button>
        </div>
        <nav class="list" id="nav-drawer-list">
          <a class="list-item" href="index.html">홈</a>
          <a class="list-item" href="search.html">검색</a>
          <a class="list-item" href="agents.html">메이트</a>
          <a class="list-item" href="items.html">상품</a>
          <a class="list-item" href="about.html">소개</a>
        </nav>
        <hr/>
        <div id="nav-auth-mobile" class="row gap"></div>
      </div>
    </div>
  `;

  const fallbackFooter = () => `
    <footer class="container muted" style="padding:24px 0;opacity:.85">
      © ${new Date().getFullYear()} PawMate
    </footer>
  `;

  // ────────────────────────────────────────────────────────────
  // 헤더 주입 후 보정: 로고 강제 링크 고정
  // ────────────────────────────────────────────────────────────
  function forceBrandLink(url = BRAND_URL) {
    const header = document.getElementById('app-header');
    if (!header) return;

    // 1) 가장 흔한 패턴: <a class="brand">…</a>
    let brand = header.querySelector('a.brand');

    // 2) 만약 <div class="brand">처럼 a가 아닌 경우 a로 교체
    if (!brand) {
      const maybe = header.querySelector('.brand');
      if (maybe && maybe.tagName !== 'A') {
        const a = document.createElement('a');
        a.className = maybe.className;
        a.innerHTML = maybe.innerHTML;
        a.href = url;
        a.target = '_self';
        a.rel = 'noopener';
        maybe.replaceWith(a);
        brand = a;
      }
    }

    if (brand) {
      // 속성 강제 세팅
      brand.setAttribute('href', url);
      brand.setAttribute('target', '_self');
      brand.setAttribute('rel', 'noopener');

      // 다른 스크립트가 preventDefault 하는 경우 대비: capture 단계에서 강제 이동
      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        window.location.assign(url);
      };
      brand.addEventListener('click', handler, true); // capture
    }
  }

  // ────────────────────────────────────────────────────────────
  // A11y + 동작
  // ────────────────────────────────────────────────────────────
  function setupNavA11y() {
    const panel    = document.getElementById('nav-drawer');
    const openBtn  = document.getElementById('btn-open-nav');
    const closeBtn = document.getElementById('btn-close-nav');
    const list     = document.getElementById('nav-drawer-list');
    if (!panel || !openBtn || !closeBtn) return;

    const open = () => {
      panel.removeAttribute('inert');
      panel.setAttribute('aria-hidden', 'false');
      openBtn.setAttribute('aria-expanded', 'true');
      closeBtn.focus();
    };
    const close = () => {
      panel.setAttribute('inert', '');
      panel.setAttribute('aria-hidden', 'true');
      openBtn.setAttribute('aria-expanded', 'false');
      openBtn.focus();
    };

    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);

    // 바깥 영역 클릭 시 닫기
    panel.addEventListener('click', e => { if (e.target === panel) close(); });

    // ESC 로 닫기
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    // 모바일 드로어에서 링크 클릭하면 닫기
    if (list) {
      list.addEventListener('click', e => {
        const a = e.target.closest('a');
        if (a && a.href) close();
      });
    }
  }

  // ────────────────────────────────────────────────────────────
  // 로그인 버튼 렌더 (폼은 별도 login.html)
  // ────────────────────────────────────────────────────────────
  function renderAuth(user) {
    const desktop = document.getElementById('nav-auth');
    const mobile  = document.getElementById('nav-auth-mobile');
    const views = [desktop, mobile].filter(Boolean);

    const signedOut = (isMobile) =>
      `<a class="btn ${isMobile ? '' : 'subtle'}" href="login.html">로그인</a>`;

    const signedIn = (u, isMobile) => {
      const name = u?.displayName || (u?.email ? u.email.split('@')[0] : '사용자');
      const photo = u?.photoURL || 'https://placehold.co/28x28';
      return `
        <div class="row center gap">
          <img src="${photo}" alt="${name}" width="28" height="28" style="border-radius:50%"/>
          <a class="btn subtle" href="agent.html">내 프로필</a>
          <button id="btn-logout${isMobile ? '-m' : ''}" class="btn subtle">로그아웃</button>
        </div>`;
    };

    if (!views.length) return;

    if (window.firebase && firebase.auth) {
      const auth = firebase.auth();
      views.forEach(v => v.innerHTML = user ? signedIn(user, v === mobile) : signedOut(v === mobile));
      const doSignOut = () => auth.signOut().catch(console.error);
      const d = document.getElementById('btn-logout');
      const m = document.getElementById('btn-logout-m');
      if (d) d.addEventListener('click', doSignOut);
      if (m) m.addEventListener('click', doSignOut);
    } else {
      views.forEach(v => v.innerHTML = signedOut(v === mobile));
    }
  }

  function watchAuth() {
    if (window.firebase && firebase.auth) {
      firebase.auth().onAuthStateChanged(user => renderAuth(user));
    } else {
      renderAuth(null);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Init
  // ────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    await inject($header, PARTIALS_BASE + 'header.html', fallbackHeader);
    await inject($footer, PARTIALS_BASE + 'footer.html', fallbackFooter);

    // ▼ 주입 직후 로고 링크 강제
    forceBrandLink(BRAND_URL);

    setupNavA11y();
    watchAuth();
  });
})();
