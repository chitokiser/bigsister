/* src/config.js
 * Firebase / Web3 환경설정 —— 반드시 index.html에서 app.js보다 먼저 로드하세요.
 * 아래 값들은 실제 프로젝트 값으로 채워져 있습니다.
 * (이 파일은 IIFE로 전역 변수들을 안전하게 주입합니다.)
 */
(function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────────
   * 1) Firebase 웹 앱 구성 (Firebase 콘솔 > 프로젝트 설정 > 일반)
   *    ※ storageBucket 은 보통 "<project-id>.appspot.com" 형식입니다.
   * ────────────────────────────────────────────────────────────── */
  var FIREBASE = {
    apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
    authDomain: "puppi-d67a1.firebaseapp.com",
    projectId: "puppi-d67a1",
    storageBucket: "puppi-d67a1.appspot.com", // ← 콘솔 표기대로 교정
    messagingSenderId: "552900371836",
    appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
    measurementId: "G-9TZ81RW0PL"
  };

  /* ──────────────────────────────────────────────────────────────
   * 2) 체인/RPC 설정 (opBNB Mainnet)
   *    - app.js는 APP_CONFIG.chain.chainId / rpcUrl / network 를 사용합니다.
   * ────────────────────────────────────────────────────────────── */
  var CHAIN = {
    chainId: 204,
    chainIdHex: "0xCC",                     // 204
    chainName: "opBNB Mainnet",
    rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    blockExplorerUrls: ["https://opbnbscan.com/"]
  };

  /* ──────────────────────────────────────────────────────────────
   * 3) 온체인 컨트랙트 (필요 시 주소/ABI 주입)
   * ────────────────────────────────────────────────────────────── */
  var ONCHAIN = {
    BET: { address: "" }, // ERC20 토큰 주소 (없으면 티어 계산 데모 모드)
    TravelEscrow: {
      address: "0x0000000000000000000000000000000000000000",
      abi: [] // 실제 배포 시 ABI 넣기
    }
  };

  /* ──────────────────────────────────────────────────────────────
   * 4) 티어 기준 (보유량 → 티어) — 필요 시 조정
   * ────────────────────────────────────────────────────────────── */
  var TIER = { 1: 1, 2: 100, 3: 1000 };

  /* ──────────────────────────────────────────────────────────────
   * 5) 전역 주입 (레거시/신규 호환)
   *    - 우리 app.js는 window.FB_CONFIG 와 window.APP_CONFIG 를 사용합니다.
   *    - 다른 코드에서 window.CONFIG 를 사용할 수도 있으므로 함께 주입합니다.
   * ────────────────────────────────────────────────────────────── */
  // 레거시/권장: app.js가 읽는 키
  window.FB_CONFIG = FIREBASE;
  window.APP_CONFIG = Object.assign({}, window.APP_CONFIG, {
    chain: {
      chainId: CHAIN.chainId,
      rpcUrl: (CHAIN.rpcUrls && CHAIN.rpcUrls[0]) || "",
      network: CHAIN.chainName
    },
    brand: window.APP_CONFIG && window.APP_CONFIG.brand || "Local Mate",
    onchain: ONCHAIN,
    tierThresholds: TIER
  });

  // 추가 호환: 일부 코드가 CONFIG를 참조할 수 있으므로 그대로도 노출
  window.CONFIG = {
    firebase: FIREBASE,
    chain: CHAIN,
    onchain: ONCHAIN,
    tierThresholds: TIER
  };

  /* ──────────────────────────────────────────────────────────────
   * 6) 빠른 유효성 점검 (콘솔 경고)
   * ────────────────────────────────────────────────────────────── */
  try {
    if (!window.FB_CONFIG || !window.FB_CONFIG.apiKey) {
      console.error("[config] Firebase apiKey가 비어 있습니다. src/config.js를 확인하세요.");
    } else if (!/^AIza[0-9A-Za-z_\-]+$/.test(window.FB_CONFIG.apiKey)) {
      console.warn("[config] Firebase apiKey 형식이 일반적이지 않습니다. 콘솔에서 복사한 값을 그대로 사용하세요.");
    }
    if (!window.APP_CONFIG || !window.APP_CONFIG.chain || !window.APP_CONFIG.chain.rpcUrl) {
      console.warn("[config] 체인 RPC URL이 비어 있습니다. 온체인 기능이 필요하면 rpcUrl을 설정하세요.");
    }
    if (FIREBASE.storageBucket && !/\.appspot\.com$/.test(FIREBASE.storageBucket)) {
      console.warn("[config] storageBucket이 일반 형식과 다릅니다. 보통 '<project-id>.appspot.com' 입니다.");
    }
  } catch (e) {
    // no-op
  }
})();
