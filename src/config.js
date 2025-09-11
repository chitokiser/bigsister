/* src/config.js
 * Firebase / Web3 환경설정 — 반드시 index.html에서 firebase-init.js보다 먼저 로드
 * IIFE로 전역(window.*)에 안전 주입
 */
(function () {
  'use strict';

  // ────────────────────────────────────────────────────────────
  // 0) 환경 감지 & URL 파라미터
  //    - ?appcheck=debug     → 디버그 토큰 자동발급(true)
  //    - ?appcheck=token:XYZ → 해당 디버그 토큰 문자열 지정
  //    - ?brand=LocaMate     → 브랜드 오버라이드
  // ────────────────────────────────────────────────────────────
  var qs = new URLSearchParams(location.search);
  var HOST = location.hostname;
  var isLocal = (HOST === 'localhost' || HOST === '127.0.0.1');
  var appcheckParam = qs.get('appcheck');   // 'debug' | 'token:xxxxx'
  var brandParam = qs.get('brand');

  // ────────────────────────────────────────────────────────────
  // 1) Firebase 웹앱 구성 (콘솔 > 프로젝트 설정 > 일반)
  //    - appCheckSiteKey: reCAPTCHA Enterprise Site Key(공개키). 없으면 '' 유지.
  // ────────────────────────────────────────────────────────────
  const FIREBASE = {
    apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
    authDomain: "puppi-d67a1.firebaseapp.com",
    projectId: "puppi-d67a1",
    storageBucket: "puppi-d67a1.firebasestorage.app",
    messagingSenderId: "552900371836",
    appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
    measurementId: "G-9TZ81RW0PL",
    // ⬇️ reCAPTCHA Enterprise Site Key(공개키) 넣으면 프로덕션에서 사용
    appCheckSiteKey: "6LduZMErAAAAAJHFSyn2sQMusMCrjFOpQ0YrrbHz" // 예: "AAAAA-BBBBB-CCCCC-DDDDD"
  };

  // ────────────────────────────────────────────────────────────
  // 2) 체인/RPC 설정 (opBNB Mainnet)
  // ────────────────────────────────────────────────────────────
  const CHAIN = {
    chainId: 204,
    chainIdHex: "0xCC",
    chainName: "opBNB Mainnet",
    rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    blockExplorerUrls: ["https://opbnbscan.com/"]
  };

  // ────────────────────────────────────────────────────────────
  // 3) 온체인 컨트랙트(필요 시 주소/ABI 주입)
  // ────────────────────────────────────────────────────────────
  const ONCHAIN = {
    BET: { address: "" },
    TravelEscrow: { address: "0x0000000000000000000000000000000000000000", abi: [] }
  };

  // ────────────────────────────────────────────────────────────
  // 4) 티어 기준
  // ────────────────────────────────────────────────────────────
  const TIER = { 1: 1, 2: 100, 3: 1000 };

  // ────────────────────────────────────────────────────────────
  // 5) App Check 디버그 플래그 주입(선택)
  //    - firebase-init.js가 다음 전역을 읽어 활성화:
  //      • window.FB_APP_CHECK_SITE_KEY
  //      • window.FB_APP_CHECK_DEBUG (true | 디버그 토큰 문자열)
  //      • window.FIREBASE_APPCHECK_DEBUG_TOKEN (true | 토큰 문자열)
  // ────────────────────────────────────────────────────────────
  // Site Key → init에서 우선 사용
  window.FB_APP_CHECK_SITE_KEY = FIREBASE.appCheckSiteKey || '';

  // URL 파라미터로 디버그 제어
  if (appcheckParam === 'debug') {
    // 새로고침 시 콘솔에 디버그 토큰이 출력되며, init이 자동 처리
    window.FB_APP_CHECK_DEBUG = true;
    window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    console.warn('[config] AppCheck DEBUG(auto) — URL 파라미터에 의해 활성화됨');
  } else if (appcheckParam && appcheckParam.startsWith('token:')) {
    // 고정 디버그 토큰 문자열 직접 사용
    var token = appcheckParam.slice('token:'.length).trim();
    if (token.length > 20) {
      window.FB_APP_CHECK_DEBUG = token;
      window.FIREBASE_APPCHECK_DEBUG_TOKEN = token;
      console.warn('[config] AppCheck DEBUG(token) — URL 파라미터 토큰 사용');
    }
  }
  // 필요 시 로컬에서 상시 디버그:
  // if (isLocal && !appcheckParam) {
  //   window.FB_APP_CHECK_DEBUG = true;
  //   window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  // }

  // ────────────────────────────────────────────────────────────
  // 6) 전역 주입 (앱 코드가 참조)
  // ────────────────────────────────────────────────────────────
  window.firebaseConfig = FIREBASE; // 핵심(레거시 포함)
  window.FB_CONFIG = FIREBASE;
  window.CONFIG = { firebase: FIREBASE, chain: CHAIN, onchain: ONCHAIN, tierThresholds: TIER };

  window.APP_CONFIG = Object.assign({}, window.APP_CONFIG, {
    chain: { chainId: CHAIN.chainId, rpcUrl: (CHAIN.rpcUrls && CHAIN.rpcUrls[0]) || "", network: CHAIN.chainName },
    brand: brandParam || (window.APP_CONFIG && window.APP_CONFIG.brand) || "LocaMate",
    onchain: ONCHAIN,
    tierThresholds: TIER
  });

  window.LM_PARTIALS_BASE = "partials/";

  // ────────────────────────────────────────────────────────────
  // 7) 빠른 점검 로그
  // ────────────────────────────────────────────────────────────
  try {
    if (!window.firebaseConfig || !window.firebaseConfig.apiKey) {
      console.error("[config] firebaseConfig 누락 또는 apiKey 비어 있음.");
    }
    if (!/\.appspot\.com$/i.test(String(window.firebaseConfig.storageBucket || ''))) {
      console.warn("[config] storageBucket 형식이 일반적이지 않습니다:", window.firebaseConfig.storageBucket);
    }
    console.log("[config] firebaseConfig ready:", {
      projectId: FIREBASE.projectId,
      storageBucket: FIREBASE.storageBucket,
      appCheckSiteKeySet: Boolean(FIREBASE.appCheckSiteKey),
      isLocal: isLocal
    });
  } catch (_) {}
})();
