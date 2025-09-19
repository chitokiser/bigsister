// src/pages/my.js
// PawMate · 마이페이지 컨트롤러
// 요구사항: bid 값, 내가 구매한 바우처, 내가 발행한 바우처, 바우처 id별 구매자 리스트,
//          나의 수당 / 수당 인출, 컨트랙트 PAW 잔고, 나의 PAW 잔고, 나의 매출

(function () {
  'use strict';

  // ────────────────────────────────────────────────────────────
  // DOM 헬퍼
  // ────────────────────────────────────────────────────────────
  function $(s, el) { return (el || document).querySelector(s); }
  function text(el, v) { if (el) el.textContent = (v == null ? '' : String(v)); }
  function show(el, on) { if (el) el.style.display = (on ? '' : 'none'); }
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[m]);
}


  const els = {
    myAuth: $('#my-auth'),
    myAddr: $('#my-addr'),
    bidLatest: $('#bid-latest'),
    myPay: $('#my-pay'),
    btnWithdraw: $('#btn-withdraw'),
    cPaw: $('#c-paw'),
    mePaw: $('#me-paw'),
    mySales: $('#my-sales'),
    sumStatus: $('#summary-status'),

    // 사용 전
    unusedTbody: $('#unused-tbody'), unusedEmpty: $('#unused-empty'), unusedCount: $('#unused-count'),
    // 내가 구매
    purchasedTbody: $('#purchased-tbody'), purchasedEmpty: $('#purchased-empty'), purchasedCount: $('#purchased-count'),
    // 내가 발행
    voucherTbody: $('#voucher-tbody'), voucherEmpty: $('#voucher-empty'), issuedCount: $('#issued-count'),
  };

  // ────────────────────────────────────────────────────────────
  // Web3 연결
  // ────────────────────────────────────────────────────────────
  async function getSigner() {
    if (!window.ethereum) throw new Error('지갑이 필요합니다 (MetaMask 등).');
    if (typeof ethers === 'undefined') throw new Error('ethers 라이브러리가 필요합니다.');
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    const CHAIN = window.CONFIG?.chain || { chainId: 204, network: 'opBNB Mainnet', rpcUrl: 'https://opbnb-mainnet-rpc.bnbchain.org' };
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + Number(CHAIN.chainId).toString(16) }] });
    } catch (e) {
      if (e && e.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x' + Number(CHAIN.chainId || 204).toString(16),
            chainName: CHAIN.network || 'opBNB Mainnet',
            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
            rpcUrls: [CHAIN.rpcUrl || 'https://opbnb-mainnet-rpc.bnbchain.org'],
            blockExplorerUrls: ['https://opbnbscan.com/']
          }]
        });
      }
    }
    return provider.getSigner();
  }

  function getPawMateMeta() {
    const meta = window.CONFIG?.onchain?.PawMate;
    if (!meta || !meta.address || !meta.abi) throw new Error('PawMate 컨트랙트 메타 누락 (config.js 확인)');
    return meta;
  }

  async function getPawMate() {
    const meta = getPawMateMeta();
    const signer = await getSigner();
    return new ethers.Contract(meta.address, meta.abi, signer);
  }

  // ────────────────────────────────────────────────────────────
  // 토큰 메타 & 금액 포맷
  // ────────────────────────────────────────────────────────────
  async function readPawMeta(contract) {
    const pawAddr = await contract.paw();
    const signer = await getSigner();
    const erc = new ethers.Contract(
      pawAddr,
      [
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
        "function balanceOf(address) view returns (uint256)"
      ],
      signer
    );
    const [sym, dec] = await Promise.all([
      erc.symbol().catch(()=> 'PAW'),
      erc.decimals()
    ]);
    return { sym, dec: Number(dec), erc, pawAddr };
  }

  function fmtAmountWei(wei, dec = 18) {
    try {
      const s = ethers.formatUnits(wei, dec);
      return s.replace(/\.?0+$/,'');
    } catch { return String(wei); }
  }

  // ────────────────────────────────────────────────────────────
  // 동적 배열 길이 추정: public 배열 getter만 있는 경우를 위한 탐색
  // getElem(i) 가 유효할 때는 값, 범위 밖이면 throw → 이를 이용해 길이를 찾음
  // ────────────────────────────────────────────────────────────
  async function probeLength(getElem, maxCap = 4096) {
    // 1) 지수 탐색으로 상한선 찾기
    let lastOk = -1;
    let i = 0;
    let step = 1;
    while (true) {
      try {
        const v = await getElem(i);
        // 정상
        lastOk = i;
        step *= 2;
        i = (i === 0 ? 1 : i + step);
        if (i >= maxCap) break;
      } catch (_) {
        break;
      }
    }
    // 실패 지점 상한
    let lo = Math.max(0, lastOk + 1);
    let hi = Math.min(maxCap, i);
    if (lastOk < 0) {
      // 인덱스 0도 실패 → 빈 배열
      return 0;
    }
    // 2) 이분 탐색으로 최초 실패 인덱스 찾기
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      try {
        await getElem(mid);
        lo = mid + 1;
      } catch (_) {
        hi = mid;
      }
    }
    return lo; // length
  }

  // ────────────────────────────────────────────────────────────
  // 표 렌더링
  // ────────────────────────────────────────────────────────────
  function rowPurchased(bid, priceHuman, owner, status, tsStr) {
    return `
      <tr>
        <td class="addr">${escHtml(String(bid))}</td>
        <td>${escHtml(priceHuman)}</td>
        <td class="addr">${escHtml(String(owner))}</td>
        <td>${escHtml(status)}</td>
        <td>${escHtml(tsStr || '')}</td>
      </tr>
    `;
  }

  function rowIssued(bid, priceHuman, buyersHtml, createdStr) {
    return `
      <tr>
        <td class="addr">${escHtml(String(bid))}</td>
        <td>${escHtml(priceHuman)}</td>
        <td>${buyersHtml}</td>
        <td>${escHtml(createdStr || '')}</td>
      </tr>
    `;
  }

  // ────────────────────────────────────────────────────────────
  // 메인 로드
  // ────────────────────────────────────────────────────────────
  async function load() {
    // Firebase 사용자 표시(옵션)
    const u = window.firebase?.auth?.().currentUser || null;
    text(els.myAuth, u ? (u.email || '로그인됨') : '비로그인');

    const c = await getPawMate();
    const signer = await getSigner();
    const me = await signer.getAddress();
    text(els.myAddr, me);

    const { sym, dec, erc } = await readPawMeta(c);

    // 요약: bid(다음 발급 id), mypay(me), g1(), g2(me), mysales(me)
    try {
      const nextBid = await c.bid();
      text(els.bidLatest, String(nextBid));
    } catch (_) { text(els.bidLatest, '-'); }

    try {
      const mp = await c.mypay(me);
      text(els.myPay, `${fmtAmountWei(mp, dec)} ${sym}`);
    } catch (_) { text(els.myPay, '-'); }

    try {
      const cp = await c.g1();
      text(els.cPaw, `${fmtAmountWei(cp, dec)} ${sym}`);
    } catch (_) { text(els.cPaw, '-'); }

    try {
      const bal = await erc.balanceOf(me);
      text(els.mePaw, `${fmtAmountWei(bal, dec)} ${sym}`);
    } catch (_) { text(els.mePaw, '-'); }

    try {
      const ms = await c.mysales(me);
      text(els.mySales, `${fmtAmountWei(ms, dec)} ${sym}`);
    } catch (_) { text(els.mySales, '-'); }

    // 버튼: 수당 인출
    if (els.btnWithdraw) {
      els.btnWithdraw.onclick = async function () {
        els.btnWithdraw.disabled = true;
        text(els.sumStatus, '인출 트랜잭션 전송 중…');
        try {
          const tx = await c.withdraw();
          await tx.wait();
          text(els.sumStatus, '인출 완료');
          // 값 갱신
          const mp2 = await c.mypay(me);
          text(els.myPay, `${fmtAmountWei(mp2, dec)} ${sym}`);
          const cp2 = await c.g1();
          text(els.cPaw, `${fmtAmountWei(cp2, dec)} ${sym}`);
          const bal2 = await erc.balanceOf(me);
          text(els.mePaw, `${fmtAmountWei(bal2, dec)} ${sym}`);
        } catch (e) {
          console.error('[my] withdraw error', e);
          text(els.sumStatus, `인출 실패: ${e?.message || e}`);
        } finally {
          els.btnWithdraw.disabled = false;
        }
      };
    }

    // ── 내가 구매한 바우처(myv) & 사용 전/완료 분리
    let purchasedRows = [];
    let unusedRows = [];
    try {
      const getMyvAt = (idx) => c.myv(me, idx); // public getter: myv(address,uint256) → uint256
      const len = await probeLength(getMyvAt, 2048);
      for (let i = 0; i < len; i++) {
        const bid = await getMyvAt(i);
        const v = await c.vouchers(bid);
        const priceHuman = `${fmtAmountWei(v.price, dec)} ${sym}`;
        const created = v.createdAt ? new Date(Number(v.createdAt)*1000) : null;
        const createdStr = created ? created.toLocaleString() : '';

        // 상태: mybuy(me,bid) 가 true면 "사용 전", false면 "완료"
        let status = '완료';
        try {
          const still = await c.mybuy(me, bid);
          status = still ? '사용 전' : '완료';
        } catch (_) {}

        const row = rowPurchased(bid, priceHuman, v.owner, status, createdStr);
        purchasedRows.push(row);
        if (status === '사용 전') unusedRows.push(row);
      }
    } catch (e) {
      console.warn('[my] purchased list skipped:', e);
    }

    els.purchasedTbody.innerHTML = purchasedRows.join('');
    text(els.purchasedCount, purchasedRows.length ? `(${purchasedRows.length})` : '');
    show(els.purchasedEmpty, purchasedRows.length === 0);

    els.unusedTbody.innerHTML = unusedRows.join('');
    text(els.unusedCount, unusedRows.length ? `(${unusedRows.length})` : '');
    show(els.unusedEmpty, unusedRows.length === 0);

    // ── 내가 발행한 바우처(mypub) + 바우처별 구매자(mybuyer)
    let issuedRows = [];
    try {
      const getMypubAt = (idx) => c.mypub(me, idx); // public getter: mypub(address,uint256) → uint256
      const len = await probeLength(getMypubAt, 2048);
      for (let i = 0; i < len; i++) {
        const bid = await getMypubAt(i);
        const v = await c.vouchers(bid);
        const priceHuman = `${fmtAmountWei(v.price, dec)} ${sym}`;
        const created = v.createdAt ? new Date(Number(v.createdAt)*1000) : null;
        const createdStr = created ? created.toLocaleString() : '';

        // 구매자 나열
        const getBuyerAt = (j) => c.mybuyer(bid, j); // public getter: mybuyer(uint256,uint256) → address
        let buyers = [];
        try {
          const blen = await probeLength(getBuyerAt, 2048);
          for (let j = 0; j < blen; j++) {
            const addr = await getBuyerAt(j);
            buyers.push(String(addr));
          }
        } catch (e) {
          console.warn('[my] buyers skipped for bid', String(bid), e);
        }
        const buyersHtml = buyers.length
          ? buyers.map(b => `<div class="addr">${escHtml(b)}</div>`).join('')
          : '<span class="muted">구매자 없음</span>';

        issuedRows.push(rowIssued(bid, priceHuman, buyersHtml, createdStr));
      }
    } catch (e) {
      console.warn('[my] issued list skipped:', e);
    }

    els.voucherTbody.innerHTML = issuedRows.join('');
    text(els.issuedCount, issuedRows.length ? `(${issuedRows.length})` : '');
    show(els.voucherEmpty, issuedRows.length === 0);
  }

  // ────────────────────────────────────────────────────────────
  // 부팅
  // ────────────────────────────────────────────────────────────
  function boot() {
    const root = document.getElementById('my-page');
    if (!root) return;

    if (window.firebase?.auth) {
      firebase.auth().onAuthStateChanged(function () {
        load().catch(err => {
          console.error('[my] load error:', err);
          text(els.sumStatus, '로드 오류: ' + (err?.message || err));
        });
      });
    }
    // 최초 한 번
    load().catch(err => {
      console.error('[my] first load error:', err);
      text(els.sumStatus, '로드 오류: ' + (err?.message || err));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
