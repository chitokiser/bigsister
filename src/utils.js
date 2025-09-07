/* utils.js — 공통 유틸 & Firebase 초기화 (ESM) */
'use strict';

/* ===== 0) 환경설정 로드 =====
 * index.html에서 먼저 로드되는 ./src/config.js 가 window.APP_CONFIG 로 값을 넣어줍니다.
 * 예시:
 * window.APP_CONFIG = {
 *   firebase: { apiKey:"...", authDomain:"...", projectId:"...", ... },
 *   adminEmails: ["you@example.com"],
 *   chain: { chainId: 11155111, network: "sepolia", rpcUrl: "https://rpc.sepolia.org" },
 *   onchain: { BET:{address:"0x..."}, TravelEscrow:{ address:"0x...", abi:[...] } }
 * };
 */
export const CONFIG = (typeof window !== 'undefined' && window.APP_CONFIG) ? window.APP_CONFIG : {};

// 체인/온체인 설정을 안전하게 export (← auth-wallet.js 가 CHAIN 을 import 합니다)
export const CHAIN = CONFIG.chain || {
  chainId: 11155111,           // default: sepolia
  network: 'sepolia',
  rpcUrl: 'https://rpc.sepolia.org',
};
export const ONCHAIN = CONFIG.onchain || {
  BET: { address: null },
  TravelEscrow: { address: null, abi: [] }
};
export const ADMIN_EMAILS = new Set((CONFIG.adminEmails || []).map(s => String(s).toLowerCase()));

/* ===== 1) Firebase 초기화 (compat SDK) ===== */
if (!window.firebase) {
  throw new Error('[utils] firebase compat SDK 가 로드되지 않았습니다. index.html 스크립트 순서를 확인하세요.');
}
if (!firebase.apps || firebase.apps.length === 0) {
  if (!CONFIG.firebase) {
    throw new Error('[utils] APP_CONFIG.firebase 가 비어 있습니다. ./src/config.js 를 확인하세요.');
  }
  firebase.initializeApp(CONFIG.firebase);
}
export const app = firebase.app();
export const auth = firebase.auth();
export const db = firebase.firestore();
export const storage = firebase.storage();

/* ===== 2) 전역 State (싱글톤) ===== */
function ensureAppShell(){
  const A = (window.App ||= {});
  A.State ||= {
    user: null,
    isAdmin: false,
    wallet: null,
    signer: null,
    tier: null,
    agentDoc: null,
  };
  // 외부에서 쓰기 좋게 노출
  A.db = db; A.auth = auth; A.storage = storage;
  return A.State;
}
export const State = ensureAppShell();

/* ===== 3) DOM/문자열 유틸 ===== */
export const $  = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

export const toast = (m) => (window.App?.toast ? window.App.toast(m) : alert(m));
export const esc = (s) => (s ?? '').replace(/[&<>'"`]/g, m => ({
  '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;','`':'&#96;'
}[m]));
export const nl2br = (s) => esc(s).replace(/\n/g, '<br/>');

export const fmt = (n) => {
  const v = Number(n || 0);
  return isFinite(v) ? v.toLocaleString('ko-KR') : '0';
};

export const cryptoRandomId = (len = 12) => {
  const a = new Uint8Array(len);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.from(a, x => (x % 36).toString(36)).join('');
};

export const getTS = (x) => {
  if (!x) return 0;
  if (typeof x.toMillis === 'function') return x.toMillis();
  if (x?.toDate) { try { return x.toDate().getTime(); } catch(_){} }
  if (x instanceof Date) return x.getTime();
  if (typeof x === 'number') return x;
  return 0;
};

/* ===== 4) 라우팅 도우미 (선택) ===== */
export const hashRoute = () => (location.hash || '#').replace(/^#\/?/, '') || 'home';
export const routeTo = (name) => { location.hash = name === 'home' ? '#/' : `#/${name}`; };

/* ===== 5) 관리자 판별 헬퍼 ===== */
export async function computeIsAdmin(user){
  if (!user) return false;
  try {
    const tok = await user.getIdTokenResult(true);
    if (tok?.if (claims) claims.admin = == true) return true;
  } catch(_) { /* noop */ }
  const email = (user.email || '').toLowerCase();
  return ADMIN_EMAILS.has(email);
}