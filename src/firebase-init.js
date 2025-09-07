// /src/firebase-init.js — Firebase 초기화 (compat 전용)
// 반드시 localmate.js 보다 먼저 로드되게 <script defer> 순서 유지!

(function () {
  // ▶ Firebase 콘솔에서 여러분 프로젝트 설정값으로 교체하세요.
  const firebaseConfig = {
    apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
    authDomain: "puppi-d67a1.firebaseapp.com",
    projectId: "puppi-d67a1",
    storageBucket: "puppi-d67a1.appspot.com", // ← 콘솔 표기대로 교정
    messagingSenderId: "552900371836",
    appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
    measurementId: "G-9TZ81RW0PL"
  };

  if (!window.firebase) {
    console.error("[Firebase] SDK 미로딩: firebase-*-compat.js 순서를 확인하세요.");
    return;
  }

  // 단일 앱 보장
  if (firebase.apps?.length === 0) {
    firebase.initializeApp(firebaseConfig);
  } else {
    firebase.app();
  }

  const auth = firebase.auth();
  const db = firebase.firestore();
  const storage = firebase.storage();

  // 퍼시스턴스: 로컬(브라우저 탭/재방문에도 유지)
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((e) => {
    console.warn("[Auth] setPersistence 경고:", e?.message || e);
  });

  // 디버그(선택): 전역 핸들
  window.__fb = { app: firebase.app(), auth, db, storage };

  // 상태 표시(옵션): 페이지에 #agent-status가 있으면 로그인 상태 출력
  auth.onAuthStateChanged((user) => {
    const pid = firebase.app().options.projectId;
    console.log("[Auth] onAuthStateChanged:", user ? user.uid : null, "(project:", pid, ")");
    const el = document.getElementById("agent-status");
    if (el) {
      el.textContent = user
        ? `상태: 로그인 (${user.email || user.phoneNumber || user.uid.slice(0, 8)}…)`
        : "상태: 로그아웃";
    }
  });
})();
