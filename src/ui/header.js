// /src/ui/header.js — 상단 헤더 렌더 + 로그인 상태 반영 + 보호 링크 처리
(function () {
  const root = document.getElementById("app-header");
  if (!root) return;

  // 간단 헤더 마크업
  root.innerHTML = `
    <header class="header container" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div class="row" style="align-items:center;gap:10px">
        <img src="/images/logo.png" alt="LocaMate" width="28" height="28" />
        <strong>LocaMate</strong>
      </div>
      <nav class="row" style="gap:12px">
        <a href="/index.html" class="link">홈</a>
        <a id="lnk-localmate" href="/localmate.html" class="link">로컬메이트 콘솔</a>
        <span class="muted small" id="auth-state">게스트</span>
        <button id="btn-login" class="btn small">로그인</button>
        <button id="btn-logout" class="btn small outline" style="display:none">로그아웃</button>
      </nav>
    </header>
  `;

  const lnkConsole = document.getElementById("lnk-localmate");
  const btnLogin = document.getElementById("btn-login");
  const btnLogout = document.getElementById("btn-logout");
  const authState = document.getElementById("auth-state");

  if (!window.firebase) {
    console.error("[header] Firebase 먼저 로드 필요");
    return;
  }
  if (!window.AuthUI) {
    console.error("[header] AuthUI가 로드되지 않았습니다. /src/auth-ui.js 를 포함하세요.");
    return;
  }

  const auth = firebase.auth();

  // 링크 보호: 클릭 시 로그인 상태 확정 → 이동
  lnkConsole.addEventListener("click", (e) => {
    e.preventDefault();
    const href = lnkConsole.getAttribute("href") || "/localmate.html";
    AuthUI.ensureAuthThenNavigate(href);
  });

  // 로그인/로그아웃 버튼
  btnLogin.addEventListener("click", () => {
    // 로그인 후 돌아올 기본 경로는 현재 페이지
    AuthUI.signIn(location.pathname + location.search);
  });
  btnLogout.addEventListener("click", () => AuthUI.signOut());

  // 헤더 상태 반영
  auth.onAuthStateChanged((u) => {
    if (u) {
      const name = u.displayName || u.email || u.phoneNumber || (u.uid || "").slice(0, 8) + "…";
      authState.textContent = name;
      btnLogin.style.display = "none";
      btnLogout.style.display = "inline-flex";
    } else {
      authState.textContent = "게스트";
      btnLogin.style.display = "inline-flex";
      btnLogout.style.display = "none";
    }
  });
})();
