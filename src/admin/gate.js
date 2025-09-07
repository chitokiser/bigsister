// /src/admin/gate.js — Admin 전용 가드 (compat)
(function () {
  if (!window.firebase) {
    console.error("[admin/gate] Firebase SDK가 먼저 로드되어야 합니다.");
    return;
  }

  const auth = firebase.auth();
  const db = firebase.firestore();

  async function waitForUser() {
    // 이미 있으면 즉시 반환
    if (auth.currentUser) return auth.currentUser;
    // redirect 결과 흡수(에러 무시)
    try { await auth.getRedirectResult(); } catch (_) {}
    return await new Promise((resolve) => {
      const unsub = auth.onAuthStateChanged((u) => { unsub(); resolve(u || null); });
    });
  }

  function showNoAccess() {
    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      position: "fixed", inset: 0, background: "rgba(0,0,0,.6)",
      display: "grid", placeItems: "center", zIndex: 99999
    });
    wrap.innerHTML = `
      <div style="background:#111;color:#eee;padding:24px;border-radius:16px;width:min(460px,92%);box-shadow:0 8px 30px rgba(0,0,0,.5)">
        <div style="font-size:18px;font-weight:700;margin-bottom:8px">접근 권한이 없습니다</div>
        <div class="muted" style="margin-bottom:16px">운영자 권한이 있는 계정으로 다시 로그인하세요.</div>
        <div class="row" style="display:flex;gap:8px;justify-content:flex-end">
          <button id="btn-admin-relogin" class="btn" style="background:#4f46e5;border:0;color:#fff;border-radius:8px">다른 계정으로 로그인</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    document.getElementById("btn-admin-relogin").addEventListener("click", () => {
      if (!window.AuthUI) return alert("Auth 모듈이 로드되지 않았습니다.");
      AuthUI.signIn(location.pathname + location.search);
    });
  }

  async function isAdminByDoc(uid) {
    try {
      const snap = await db.collection("users").doc(uid).get();
      return snap.exists && snap.data()?.role === "admin";
    } catch (e) {
      console.warn("[admin/gate] users doc 확인 실패:", e?.message || e);
      return false;
    }
  }

  async function requireAdmin() {
    // 1) 로그인 보장
    const user = await waitForUser();
    if (!user) {
      if (!window.AuthUI) throw new Error("NO_AUTH");
      await AuthUI.signIn(location.pathname + location.search);
      throw new Error("NO_AUTH");
    }

    // 2) 토큰 강제 새로고침(커스텀 클레임 반영)
    let claims = {};
    try {
      claims = (await user.getIdTokenResult(true)).claims || {};
    } catch (e) {
      console.warn("[admin/gate] getIdTokenResult 실패:", e?.message || e);
    }
    if (claims.admin === true) return user;

    // 3) users/{uid}.role == "admin" 도 허용
    if (await isAdminByDoc(user.uid)) return user;

    // 4) 둘 다 아니면 접근 거부(오버레이, 리다이렉트는 하지 않음)
    showNoAccess();
    throw new Error("NO_ADMIN");
  }

  // 전역 노출
  window.AdminGate = { requireAdmin };
})();
