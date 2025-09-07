
// /src/auth-ui.js — 공통 로그인 유틸 (compat 전용, 전역 window.AuthUI 노출)
(function () {
  if (!window.firebase) {
    console.error("[AuthUI] Firebase SDK가 먼저 로드되어야 합니다.");
    return;
  }

  const auth = firebase.auth();
  const provider = new firebase.auth.GoogleAuthProvider();

  // 로그인 유지(LOCAL)
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((e) => {
    console.warn("[Auth] setPersistence:", e?.message || e);
  });

  function waitForAuth() {
    // 현재 탭에서 '로그인 여부가 확정'될 때까지 한 번만 대기
    const cached = auth.currentUser;
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve) => {
      const unsub = auth.onAuthStateChanged((u) => {
        unsub();
        resolve(u || null);
      });
    });
  }

  async function signIn(nextHref) {
    // 로그인 후 돌아올 경로 저장
    const next =
      nextHref ||
      new URLSearchParams(location.search).get("next") ||
      location.pathname + location.search;
    sessionStorage.setItem("next_after_login", next);

    // 팝업 허용된 환경이면 popup → 아니면 redirect
    try {
      await auth.signInWithPopup(provider);
      // popup 성공 시 바로 후속 처리
      handleAfterLogin();
    } catch (e) {
      // 팝업 차단/오류 → redirect 대체
      await auth.signInWithRedirect(provider);
    }
  }

  async function signOut() {
    await auth.signOut();
    location.reload();
  }

  async function ensureAuthThenNavigate(href) {
    const u = auth.currentUser || (await waitForAuth());
    if (u) {
      location.href = href;
      return;
    }
    await signIn(href);
  }

  function handleAfterLogin() {
    // redirect/popup 결과 처리(중복 호출 OK)
    auth
      .getRedirectResult()
      .catch((e) => console.debug("[AuthUI] redirect result:", e?.message));
    const next =
      new URLSearchParams(location.search).get("next") ||
      sessionStorage.getItem("next_after_login");
    if (next) {
      sessionStorage.removeItem("next_after_login");
      // 현재와 동일 경로면 리로드만
      const now = location.pathname + location.search;
      if (now === next) {
        location.reload();
      } else {
        location.replace(next);
      }
    }
  }

  // 최초 진입 시 한 번 결과 처리
  handleAfterLogin();

  // 전역 내보내기
  window.AuthUI = { waitForAuth, signIn, signOut, ensureAuthThenNavigate };
})();
