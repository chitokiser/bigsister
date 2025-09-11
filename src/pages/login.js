// src/pages/login.js
(() => {
  'use strict';

  if (!window.firebase || !window.firebaseConfig) {
    alert('Firebase 설정을 찾지 못했습니다. src/config.js 로드 순서를 확인하세요.');
    throw new Error('firebaseConfig missing');
  }

  const app   = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.firebaseConfig);
  const auth  = firebase.auth();

  // 로그인 지속성: 탭을 닫아도 유지
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(console.warn);

  // UI
  const $ = (id) => document.getElementById(id);
  const msg = (t, isErr=false) => {
    const el = $('msg'); if (!el) return;
    el.style.color = isErr ? '#ef4444' : 'var(--muted)';
    el.textContent = t || '';
  };

  // 다음 페이지 이동
  const params = new URLSearchParams(location.search);
  const NEXT = params.get('next') ? decodeURIComponent(params.get('next')) : 'index.html';
  const goNext = () => location.href = NEXT;

  // ── Google 로그인
  $('btn-google').addEventListener('click', async () => {
    msg('Google 계정으로 로그인 중…');
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await auth.signInWithPopup(provider);
      msg('로그인 성공! 이동합니다…');
      goNext();
    } catch (e) {
      // 팝업이 차단되면 redirect로 재시도
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
        try {
          await auth.signInWithRedirect(provider);
        } catch (e2) {
          msg('Google 로그인 실패: ' + (e2.message || e2), true);
        }
      } else {
        msg('Google 로그인 실패: ' + (e.message || e), true);
      }
    }
  });

  // ── Email/Password
  async function signInEmail() {
    const email = $('email').value.trim();
    const pw    = $('password').value;
    if (!email || pw.length < 6) { msg('이메일/비밀번호를 확인하세요.', true); return; }
    msg('로그인 중…');
    try {
      await auth.signInWithEmailAndPassword(email, pw);
      msg('로그인 성공! 이동합니다…');
      goNext();
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        msg('가입되지 않은 이메일입니다. "회원가입"을 사용하세요.', true);
      } else if (e.code === 'auth/wrong-password') {
        msg('비밀번호가 올바르지 않습니다.', true);
      } else if (e.code === 'auth/too-many-requests') {
        msg('시도 횟수가 많습니다. 잠시 후 다시 시도하세요.', true);
      } else {
        msg('로그인 오류: ' + (e.message || e), true);
      }
    }
  }
  async function signUpEmail() {
    const email = $('email').value.trim();
    const pw    = $('password').value;
    if (!email || pw.length < 6) { msg('이메일/비밀번호(6자 이상)를 입력하세요.', true); return; }
    msg('계정 생성 중…');
    try {
      await auth.createUserWithEmailAndPassword(email, pw);
      msg('가입 완료! 로그인 상태로 이동합니다…');
      goNext();
    } catch (e) {
      if (e.code === 'auth/email-already-in-use') {
        msg('이미 가입된 이메일입니다. "로그인"을 사용하세요.', true);
      } else if (e.code === 'auth/invalid-email') {
        msg('이메일 형식을 확인하세요.', true);
      } else {
        msg('회원가입 오류: ' + (e.message || e), true);
      }
    }
  }
  async function resetPw() {
    const email = $('email').value.trim();
    if (!email) { msg('재설정 메일을 보낼 이메일을 입력하세요.', true); return; }
    msg('재설정 메일 발송 중…');
    try {
      await auth.sendPasswordResetEmail(email);
      msg('재설정 메일을 보냈습니다. 메일함을 확인하세요.');
    } catch (e) {
      msg('재설정 오류: ' + (e.message || e), true);
    }
  }

  $('btn-signin').addEventListener('click', signInEmail);
  $('btn-signup').addEventListener('click', signUpEmail);
  $('btn-reset').addEventListener('click', resetPw);

  // Redirect 로그인 결과 처리(팝업 차단 대응)
  auth.getRedirectResult().then((res) => {
    if (res && res.user) {
      msg('로그인 성공! 이동합니다…'); goNext();
    }
  }).catch((e) => {
    msg('로그인 오류: ' + (e.message || e), true);
  });

  // 이미 로그인 상태면 즉시 리다이렉트
  auth.onAuthStateChanged((u) => { if (u) goNext(); });
})();
