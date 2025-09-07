// /src/ui/header-loader.js
(async function () {
  const mount = document.getElementById("app-header");
  if (!mount) return;

  try {
    const res = await fetch("/header.html", { cache: "no-cache" });
    mount.innerHTML = await res.text();
  } catch (e) {
    console.error("[header-loader] header.html 로드 실패:", e);
    return;
  }

  if (!window.firebase) return console.error("[header-loader] Firebase 먼저 로드 필요");
  if (!window.AuthUI)   return console.error("[header-loader] /src/auth-ui.js 를 포함하세요.");

  const auth = firebase.auth();
  const lnkConsole = mount.querySelector('a[href="/localmate.html"]');
  const btnLogin   = mount.querySelector("#btn-login");
  const btnLogout  = mount.querySelector("#btn-logout");
  const authState  = mount.querySelector("#auth-state");

  // 콘솔 링크: 로그인 보장 후 이동
  lnkConsole?.addEventListener("click", (e) => {
    e.preventDefault();
    AuthUI.ensureAuthThenNavigate("/localmate.html");
  });

  // 로그인/로그아웃
  btnLogin?.addEventListener("click", () => AuthUI.signIn(location.pathname + location.search));
  btnLogout?.addEventListener("click", () => AuthUI.signOut());

  // 상태 표시
  auth.onAuthStateChanged((u) => {
    if (u) {
      authState.textContent = u.displayName || u.email || u.phoneNumber || (u.uid || "").slice(0, 8) + "…";
      btnLogin.style.display = "none";
      btnLogout.style.display = "inline-flex";
    } else {
      authState.textContent = "게스트";
      btnLogin.style.display = "inline-flex";
      btnLogout.style.display = "none";
    }
  });
})();
