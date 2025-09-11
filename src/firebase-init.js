// /src/firebase-init.js — Firebase + App Check (Compat; DOM-ready & robust)
(function () {
  'use strict';

  // 필수 SDK 확인
  if (!window.firebase) {
    console.error('[firebase-init] Firebase SDK가 먼저 로드되어야 합니다.');
    return;
  }
  if (!firebase.appCheck) {
    console.error('[firebase-init] app-check-compat SDK가 필요합니다. firebase-app-check-compat.js를 포함하세요.');
    return;
  }

  // 설정 확보 + storageBucket 정규화
  var RAW = window.FB_CONFIG || window.firebaseConfig || null;
  if (!RAW) {
    console.error('[firebase-init] 프로젝트 설정(FB_CONFIG / firebaseConfig)을 찾지 못했습니다.');
    return;
  }
  function normBucket(sb, projectId) {
    if (!sb && projectId) return projectId + '.appspot.com';
    if (!sb) return '';
    var s = String(sb).trim();
    if (/^gs:\/\//i.test(s)) s = s.replace(/^gs:\/\//i, '');
    if (!/\./.test(s)) s = s + '.appspot.com';
    return s;
  }
  var cfg = Object.assign({}, RAW);
  cfg.storageBucket = normBucket(cfg.storageBucket, cfg.projectId);
  window.firebaseConfig = cfg;
  window.FB_CONFIG = cfg;

  // App 인스턴스
  var app = (firebase.apps && firebase.apps.length) ? firebase.app() : firebase.initializeApp(cfg);

  // DOM 준비 + head/body 보장
  function domReady() {
    return new Promise((resolve) => {
      const done = () => resolve();
      if (typeof document === 'undefined') return done();
      if (document.readyState === 'complete' || document.readyState === 'interactive') return done();
      document.addEventListener('DOMContentLoaded', done, { once: true });
      window.addEventListener('load', done, { once: true });
    });
  }
  async function ensureContainers() {
    if (typeof document === 'undefined') return;
    if (!document.documentElement) return; // 극히 예외
    if (!document.head) {
      const h = document.createElement('head');
      document.documentElement.insertBefore(h, document.body || null);
    }
    if (!document.body) {
      const b = document.createElement('body');
      document.documentElement.appendChild(b);
    }
  }

  // 디버그 토큰(고정 문자열 > auto(true) > localStorage)
  (function applyDebugTokenPref() {
    try {
      const qs = new URLSearchParams(location.search);
      const p = qs.get('appcheck');
      if (p && p.startsWith('token:')) {
        const tok = p.slice(6).trim();
        if (tok.length > 20) window.FIREBASE_APPCHECK_DEBUG_TOKEN = tok;
      } else if (p === 'debug') {
        window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      }

      // 고정 문자열 우선
      if (typeof window.FIREBASE_APPCHECK_DEBUG_TOKEN === 'string' && window.FIREBASE_APPCHECK_DEBUG_TOKEN.length > 20) {
        try { localStorage.removeItem('FIREBASE_APPCHECK_DEBUG_TOKEN'); } catch(_) {}
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = window.FIREBASE_APPCHECK_DEBUG_TOKEN;
        console.warn('[firebase-init] AppCheck DEBUG(token) 활성화');
        return;
      }

      // 없으면 localStorage
      let ls = '';
      try { ls = localStorage.getItem('FIREBASE_APPCHECK_DEBUG_TOKEN') || ''; } catch(_) {}
      if (!self.FIREBASE_APPCHECK_DEBUG_TOKEN && ls) {
        if (ls === 'true') {
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
          console.warn('[firebase-init] AppCheck DEBUG(auto) 활성화 (localStorage)');
        } else if (ls.length > 20) {
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = ls;
          console.warn('[firebase-init] AppCheck DEBUG(token) 활성화 (localStorage)');
        }
      }

      // 로컬 + siteKey 없음 → auto 디버그
      const HOST = location.hostname;
      const isLocal = (HOST === 'localhost' || HOST.startsWith('127.0.0.1'));
      const hasSiteKey = !!(window.firebaseConfig?.appCheckSiteKey || window.FB_APP_CHECK_SITE_KEY);
      if (isLocal && !hasSiteKey && !self.FIREBASE_APPCHECK_DEBUG_TOKEN) {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        console.warn('[firebase-init] 로컬 + siteKey 없음 → DEBUG(auto) 강제');
      }
    } catch (e) {
      console.warn('[firebase-init] 디버그 토큰 설정 경고:', e && (e.message || e));
    }
  })();

  // 활성화 (디버그면 reCAPTCHA 최소화: 'unused' 사용)
  const SITE_KEY =
    (window.firebaseConfig && window.firebaseConfig.appCheckSiteKey) ||
    window.FB_APP_CHECK_SITE_KEY || '';

  const isDebug = !!self.FIREBASE_APPCHECK_DEBUG_TOKEN;
  const effectiveSiteKey = String(isDebug ? 'unused' : (SITE_KEY || '')).trim();

  async function activateAndVerify() {
    await domReady();
    await ensureContainers();
    // rAF 한 틱 더 대기 → 일부 환경에서 head가 늦게 생기는 케이스 방지
    await new Promise(r => requestAnimationFrame(r));

    if (!effectiveSiteKey) {
      console.warn('[firebase-init] Site Key 미설정 + 디버그 아님 → AppCheck 활성화 불가.');
      return false;
    }

    try {
      firebase.appCheck().activate(effectiveSiteKey, true);
      console.log('[firebase-init] AppCheck activate 호출됨 (key:', (effectiveSiteKey === 'unused' ? 'unused' : 'provided'), ')');
    } catch (e) {
      console.error('[firebase-init] AppCheck activate 실패:', e && (e.message || e));
      return false;
    }

    // 초기 토큰 재시도 (최대 5회)
    for (let i = 0; i < 5; i++) {
      try {
        const t = await firebase.appCheck().getToken(true);
        if (t && t.token) {
          console.log('[firebase-init] AppCheck token 확보 OK (prefix):', String(t.token).slice(0, 12) + '…');
          return true;
        }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 250 + i * 250));
    }
    console.error('[firebase-init] AppCheck token 획득 실패');
    return false;
  }

  window.whenAppCheckReady = activateAndVerify();

  // 외부에서 호출
  window.ensureAppCheck = async function ensureAppCheck() {
    const ok = await window.whenAppCheckReady;
    if (!ok) { console.warn('[appcheck] getToken 실패: AppCheck not activated'); return null; }
    try {
      const t = await firebase.appCheck().getToken(true);
      console.log('[appcheck] token OK', String(t?.token || '').slice(0, 12) + '…');
      return t;
    } catch (e) {
      console.warn('[appcheck] getToken 실패:', e && (e.message || e));
      return null;
    }
  };

  // Storage 루트 ref
  window.getBucketRef = function getBucketRef() {
    const bucket = (firebase.app().options && firebase.app().options.storageBucket) || window.firebaseConfig?.storageBucket;
    return bucket ? firebase.storage().refFromURL('gs://' + bucket) : firebase.storage().ref();
  };

  // Auth는 App Check 이후(권장)
  window.whenAppCheckReady.then(function (ok) {
    try {
      if (!ok) return;
      if (firebase.auth) {
        const a = firebase.auth();
        if (a && a.setPersistence) a.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(){});
        a.languageCode = 'ko';
      }
    } catch (e) {
      console.warn('[firebase-init] Auth 설정 경고:', e && (e.message || e));
    }
  });

  // 로그
  const HOST = location.hostname;
  console.log('[firebase-init] ready:', {
    projectId: cfg.projectId,
    storageBucket: cfg.storageBucket,
    isLocal: (HOST === 'localhost' || HOST.startsWith('127.0.0.1'))
  });
})();
