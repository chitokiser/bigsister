/* src/config.js
 * Firebase/Web3 환경설정. index.html에서 app.js보다 먼저 로드해야 합니다.
 * Firebase 콘솔 > 프로젝트 설정 > 일반 > 내 앱(Web)에서 키를 복사해 넣으세요.
 */
(function () {
  'use strict';

  // ⬇⬇ 반드시 실제 값으로 교체 ⬇⬇
  const FIREBASE = {
apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
  authDomain: "puppi-d67a1.firebaseapp.com",
  projectId: "puppi-d67a1",
  storageBucket: "puppi-d67a1.firebasestorage.app" ,
  messagingSenderId: "552900371836",
  appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
  measurementId: "G-9TZ81RW0PL"
    // measurementId: "G-XXXXXXX" // 선택
  };

  // 체인/RPC가 없다면 읽기 전용은 생략 가능 (데모에선 없어도 동작)
  const CHAIN = {
chainIdHex: "0xCC", // 204

chainName: "opBNB Mainnet",

rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],

nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },

blockExplorerUrls: ["https://opbnbscan.com/"]

  };

  // 온체인 컨트랙트 주소(없으면 데모 모드로 동작)
  const ONCHAIN = {
    BET: { address: "" }, // ERC20 토큰 주소(없으면 티어=1 데모 제공)
    TravelEscrow: {
      address: "0x0000000000000000000000000000000000000000",
      abi: [] // 실제 배포 시 ABI 넣기
    }
  };

  // 온체인 보유량 → 티어 기준(단위: BET)
  const TIER = { 1: 1, 2: 100, 3: 1000 };

  // 전역 주입
  window.CONFIG = {
    firebase: FIREBASE,
    chain: CHAIN,
    onchain: ONCHAIN,
    tierThresholds: TIER,
  };

  // 안전 경고(키 미설정 시 app.js가 초기화 전에 알려줌)
  if (!window.CONFIG?.firebase?.apiKey) {
    console.error("[config] Firebase 키가 비어 있습니다. src/config.js에 실제 키를 채워 넣으세요.");
  }
})();
