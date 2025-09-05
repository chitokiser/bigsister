/* auth-wallet.js — 지갑 연결/티어 조회 (ESM) */
'use strict';

import { $, toast, short, CHAIN } from './utils.js';

function getState() {
  const S = (window.App?.State) || (window.State) || {};
  return {
    user: S.user || null,
    wallet: S.wallet || null,
    tier: Number(S.tier || 0),
    provider: S.provider || null,
    signer: S.signer || null
  };
}
function setState(patch) {
  const base = (window.App?.State) || (window.State) || {};
  const next = { ...base, ...patch };
  if (window.App) window.App.State = next;
  else window.State = next;
  return next;
}

async function ensureChain(provider) {
  const ethereum = window.ethereum;
  if (!ethereum) return;

  let net = null;
  try { net = await provider.getNetwork(); } catch (_) {}

  if (!net || Number(net.chainId) !== parseInt(CHAIN.chainIdHex, 16)) {
    try {
      await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.chainIdHex }] });
    } catch (switchErr) {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: CHAIN.chainIdHex,
          chainName: CHAIN.chainName,
          rpcUrls: CHAIN.rpcUrls,
          nativeCurrency: CHAIN.nativeCurrency,
          blockExplorerUrls: CHAIN.blockExplorerUrls
        }]
      });
    }
  }
}

export async function connectWallet() {
  if (!window.ethereum) { toast("지갑이 없습니다. MetaMask 등을 설치하세요."); return; }

  const provider = new ethers.BrowserProvider(window.ethereum);
  await ensureChain(provider);
  await provider.send("eth_requestAccounts", []);
  const signer  = await provider.getSigner();
  const wallet  = await signer.getAddress();

  setState({ provider, signer, wallet });

  const btn = $("#btn-wallet");
  if (btn) btn.textContent = short(wallet);

  // 티어 (데모: 0 유지)
  const tier = await getTier(wallet).catch(() => 0);
  setState({ tier });

  const pill = $("#tier-pill");
  if (pill) { pill.textContent = `티어: ${tier}`; pill.classList.remove("hidden"); }

  // 로그인되어 있다면 users/{uid}.wallet 업데이트
  try {
    const u = getState().user;
    const db = window.App?.db || (firebase?.firestore && firebase.firestore());
    if (u && db) {
      await db.collection("users").doc(u.uid).set({ wallet }, { merge: true });
    }
  } catch (e) {
    console.warn("failed to persist wallet:", e?.message || e);
  }
}

export async function getTier(address) {
  try {
    if (!address) return 0;
    // 실제 온체인 로직 연결 시 구현
    return 0;
  } catch (e) {
    console.warn("getTier error:", e?.message || e);
    return 0;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $("#btn-wallet")?.addEventListener("click", connectWallet);
});
