/* app.js — Firebase 초기화 + 로그인 상태 관리 + 최초 렌더 진입점 */
'use strict';

import { $, $$, toast, esc, routeTo, hashRoute } from './utils.js';
import { renderRoute, refreshHome, refreshMy, refreshAgentState, renderAgentPipes, renderAdmin } from './features.js';

/* 1) Firebase 초기화 (compat) — 반드시 여기서 수행 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
  authDomain: "puppi-d67a1.firebaseapp.com",
  projectId: "puppi-d67a1",
  storageBucket: "puppi-d67a1.appspot.com",
  messagingSenderId: "552900371836",
  appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
  measurementId: "G-9TZ81RW0PL"
};

if (!firebase.apps?.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}

const auth    = firebase.auth();
const db      = firebase.firestore();
const storage = firebase.storage();

/* 2) 전역 App 컨테이너 */
window.App = window.App || {};
window.App.db = db;
window.App.storage = storage;
window.App.auth = auth;

// UI 헬퍼 노출(선택)
window.App.$ = $;
window.App.$$ = $$;
window.App.toast = toast;
window.App.esc = esc;

// 전역 상태
window.App.State = {
  user: null,
  wallet: null,
  tier: 0,
  agentDoc: null,
  provider: null,
  signer: null,
  isAdmin: false
};

/* 3) Admin 판별: 이메일 화이트리스트 + users/{uid}.role === 'admin' */
const ADMIN_EMAILS = new Set(["daguri75@gmail.com"]); // 필요 시 추가

async function computeIsAdmin(u) {
  if (!u) return false;
  if (ADMIN_EMAILS.has((u.email || "").toLowerCase())) return true;
  try {
    const doc = await db.collection('users').doc(u.uid).get();
    return doc.exists && doc.data()?.role === 'admin';
  } catch (_) { return false; }
}

function setAdminUI(isAdmin) {
  window.App.State.isAdmin = !!isAdmin;
  $$('[data-admin-only]').forEach(el => el.classList.toggle('hidden', !isAdmin));
}

/* 4) 로그인/로그아웃 핸들러 */
$("#btn-google")?.addEventListener("click", async () => {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const res = await auth.signInWithPopup(provider);
    const u = res.user;
    await db.collection("users").doc(u.uid).set({
      uid: u.uid,
      email: u.email || null,
      displayName: u.displayName || null,
      photo: u.photoURL || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    if (e?.code !== 'auth/cancelled-popup-request' && e?.code !== 'auth/popup-closed-by-user') {
      console.error(e);
      toast("로그인 실패: " + (e.message || e.code || e));
    }
  }
});
$("#btn-logout")?.addEventListener("click", () => auth.signOut());

/* 5) 로그인 상태 변경 시 UI/데이터 동기화 */
auth.onAuthStateChanged(async (u) => {
  window.App.State.user = u || null;

  // 헤더 버튼/아바타
  $("#btn-google")?.classList.toggle("hidden", !!u);
  $("#btn-logout")?.classList.toggle("hidden", !u);
  $("#user-photo")?.classList.toggle("hidden", !u);
  if (u?.photoURL) { $("#user-photo").src = u.photoURL; }

  // Admin 표시
  const admin = await computeIsAdmin(u);
  setAdminUI(admin);

  // 라우팅/화면 업데이트
  await refreshAgentState();
  if (location.hash === "" || location.hash === "#/") routeTo("home");
  await refreshHome();
  await refreshMy();
  if (hashRoute() === "agent") renderAgentPipes();
  if (hashRoute() === "admin") renderAdmin();
});

/* 6) 최초 진입 시 라우트 반영 */
document.addEventListener('DOMContentLoaded', () => {
  renderRoute();
  refreshHome().catch(()=>{ /* 초기 로드 중 DB 지연 대비 */ });
});
