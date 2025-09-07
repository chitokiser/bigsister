/* chain.js — 체인/티어/지갑 (ESM) */
'use strict';
import { State, CONFIG, CHAIN, ONCHAIN, $, toast, isValidAddress } from './utils.js';

import { db } from './utils.js'; // agentWalletById에서 사용

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

export function setTierPill(tier) {
  State.tier = tier||0;
  const el = $('#tier-pill');
  if (!el) return;
  if (State.tier > 0) { el.textContent = `티어: ${State.tier}`; el.classList.remove('hidden'); } 
  else { el.textContent = '티어: -'; el.classList.add('hidden'); }
}

export async function getTier(walletAddr){
  if (!walletAddr) return 0;
  const betAddr = ONCHAIN?.BET?.address || "";
  if (!isValidAddress(betAddr)) { setTierPill(1); return 1; } // BET 주소 없으면 데모 정책: Tier 1

  const { ethers } = window;
  if (!ethers) return 0;
  const provider = window.ethereum
    ? new ethers.BrowserProvider(window.ethereum)
    : (CHAIN.rpcUrl ? new ethers.JsonRpcProvider(CHAIN.rpcUrl) : null);
  if (!provider) return 0;

  const erc = new ethers.Contract(betAddr, ERC20_ABI, provider);
  let decimals = 18;
  try { decimals = Number(await erc.decimals()); } catch(_) {}

  let bal = 0;
  try {
    const raw = await erc.balanceOf(walletAddr);
    bal = Number(window.ethers.formatUnits(raw, decimals));
  } catch(e) { console.warn('BET balance 조회 실패:', e); }

  const th = (window.CONFIG?.tierThresholds)||{1:1,2:100,3:1000};
  let tier = 0;
  if (bal >= (th[3]??Infinity)) tier = 3;
  else if (bal >= (th[2]??Infinity)) tier = 2;
  else if (bal >= (th[1]??1)) tier = 1;

  setTierPill(tier);
  return tier;
}

export async function connectWallet(){
  if (!window.ethereum){ toast('메타마스크 등 지갑을 설치해 주세요.'); return; }
  try{
    const accounts = await window.ethereum.request({ method:'eth_requestAccounts' });
    const wallet = accounts?.[0];
    if (!wallet) { toast('지갑 연결 취소'); return; }

    // 체인 스위치
    const targetHex = '0x'+Number(CHAIN.chainId||0).toString(16);
    try{
      const cur = await window.ethereum.request({ method:'eth_chainId' });
      if (cur?.toLowerCase() !== targetHex.toLowerCase()){
        await window.ethereum.request({ method:'wallet_switchEthereumChain', params:[{chainId: targetHex}] });
      }
    }catch(e){
      try{
        await window.ethereum.request({
          method:'wallet_addEthereumChain',
          params:[{ 
            chainId: targetHex, 
            chainName: CHAIN.network||'Custom', 
            rpcUrls:[CHAIN.rpcUrl].filter(Boolean),
            nativeCurrency:{ name:'ETH', symbol:'ETH', decimals:18 } 
          }]
        });
      }catch(_){/* 무시 */}
    }

    // signer
    const { ethers } = window;
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();

    State.wallet = wallet;
    State.signer = signer;
    const btn = $('#btn-wallet'); if (btn) btn.textContent = `연결됨: ${wallet.slice(0,6)}…${wallet.slice(-4)}`;

    try { await getTier(wallet); } catch(_) {}
    toast('지갑 연결 완료');
  }catch(e){
    console.error(e);
    toast('지갑 연결 실패: ' + (e?.message||e));
  }
}

export async function agentWalletById(agentId){
  if(!agentId) return null;
  const doc = await db.collection('agents').doc(agentId).get();
  return doc.exists ? (doc.data().wallet || null) : null;
}
