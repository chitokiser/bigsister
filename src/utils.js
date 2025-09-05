/* utils.js — 공용 헬퍼 & 상수 (ESM) */
'use strict';

/* DOM 헬퍼 */
export const $  = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

/* UI */
export const toast = (m) => alert(m);
export const fmt   = (n) => new Intl.NumberFormat('ko-KR').format(Number(n || 0));
export const esc   = (s) => (s || "").replace(/[&<>'"`]/g, (m) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;", "`": "&#96;"
}[m]));

/* 문자열/숫자 유틸 */
export function nl2br(s) { return (s || "").replace(/\n/g, "<br/>"); }
export function cryptoRandomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
export function short(a) { return a ? a.slice(0, 6) + "…" + a.slice(-4) : ""; }
export function getTS(x) {
  if (!x) return 0;
  if (typeof x.toMillis === 'function') return x.toMillis();        // Firestore Timestamp
  if (x?.toDate) { try { return x.toDate().getTime(); } catch(_){} }
  if (x instanceof Date) return x.getTime();
  if (typeof x === 'number') return x;
  return 0;
}

/* 라우팅 */
export function hashRoute() {
  const h = (location.hash || "#/").replace(/^#\//, "");
  return h || "home";
}
export function routeTo(name) {
  location.hash = name === "home" ? "#/" : `#/${name}`;
}

/* 체인/온체인 설정 */
export const CHAIN = {
  chainIdHex: "0xCC", // 204
  chainName: "opBNB Mainnet",
  rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  blockExplorerUrls: ["https://opbnbscan.com/"]
};

// 온체인 주소/ABI 스텁 (필요 시 실제 주소/ABI로 교체)
export const ONCHAIN = {
  TierRegistry: {
    address: "0x0000000000000000000000000000000000000000",
    abi: [{ "inputs":[{"internalType":"address","name":"user","type":"address"}],
            "name":"levelOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],
            "stateMutability":"view","type":"function"}]
  },
  TravelEscrow: {
    address: "0x0000000000000000000000000000000000000000",
    abi: [
      {"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"orderId","type":"bytes32"},{"indexed":false,"internalType":"address","name":"payer","type":"address"},{"indexed":false,"internalType":"address","name":"agent","type":"address"},{"indexed":false,"internalType":"address","name":"token","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"Book","type":"event"},
      {"inputs":[{"internalType":"bytes32","name":"orderId","type":"bytes32"},{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"address","name":"agent","type":"address"}],"name":"book","outputs":[],"stateMutability":"nonpayable","type":"function"}
    ]
  },
  BET: { address: "0x0000000000000000000000000000000000000000" }
};
