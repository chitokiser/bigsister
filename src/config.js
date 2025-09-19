/* src/config.js 
 * Firebase / Web3 환경설정 + product.html 컨트롤러
 * (IIFE로 전역(window.*)에 안전 주입)
 */
(function () {
  'use strict';

  // ────────────────────────────────────────────────────────────
  // 0) 환경 감지 & URL 파라미터
  // ────────────────────────────────────────────────────────────
  var qs = new URLSearchParams(location.search);
  var HOST = location.hostname;
  var isLocal = (HOST === 'localhost' || HOST === '127.0.0.1');
  var appcheckParam = qs.get('appcheck');   // 'debug' | 'token:xxxxx'
  var brandParam = qs.get('brand');

  // ────────────────────────────────────────────────────────────
  // 1) Firebase 웹앱 구성
  // ────────────────────────────────────────────────────────────
  var FIREBASE = {
    apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
    authDomain: "puppi-d67a1.firebaseapp.com",
    projectId: "puppi-d67a1",
    storageBucket: "puppi-d67a1.firebasestorage.app",
    messagingSenderId: "552900371836",
    appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
    measurementId: "G-9TZ81RW0PL",
    appCheckSiteKey: "6LduZMErAAAAAJHFSyn2sQMusMCrjFOpQ0YrrbHz"
  };

  // ────────────────────────────────────────────────────────────
  // 2) 체인/RPC 설정 (opBNB Mainnet)
  // ────────────────────────────────────────────────────────────
  var CHAIN = {
    chainId: 204,
    chainIdHex: "0xCC",
    chainName: "opBNB Mainnet",
    rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    blockExplorerUrls: ["https://opbnbscan.com/"]
  };

  // ────────────────────────────────────────────────────────────
  // 3) 온체인 컨트랙트 (PawMate ABI를 실제 컨트랙트에 맞게 정리)
  // ────────────────────────────────────────────────────────────
  var ONCHAIN = {
    BET: { address: "" },
    TravelEscrow: { address: "0x0000000000000000000000000000000000000000", abi: [] },
    PawMate: {
      address: "0x105078EE5c66B3d28F1f20FAcF515c3B3e7fa588",
      abi: [
        // views
        "function paw() view returns (address)",
        "function pupbank() view returns (address)",
        "function admin() view returns (address)",
        "function staff(address) view returns (uint8)",
        "function mate(address) view returns (bool)",
        "function bid() view returns (uint256)",
        "function totalw() view returns (uint256)",
        "function pbank() view returns (address)",
        "function mypay(address) view returns (uint256)",
        "function mysales(address) view returns (uint256)",
        "function fa(address) view returns (uint256)",
        // Voucher struct accessor
        // struct Voucher { uint256 bid; uint256 price; address owner; uint256 createdAt; }
        "function vouchers(uint256) view returns (uint256 bid, uint256 price, address owner, uint256 createdAt)",
        // helpers
        "function getlevel(address user) view returns (uint256)",
        "function g1() view returns (uint256)",
        "function g2(address user) view returns (uint256)",

        // writes
        "function transferOwnership(address newAdmin)",
        "function setStaff(address account, uint8 level)",
        "function setPbank(address _pbank)",
        "function faup(address _fa)",
        "function priceup(uint256 _bid, uint256 _price)",
        "function emergencyWithdraw()",
        "function mateok(address user)",
        "function mateno(address user)",
        "function bcrate(uint256 price) returns (uint256 id)",
        "function buy(uint256 _bid)",
        "function approveVoucher(uint256 _bid)",
        "function withdraw()",
        "function payup(address user, uint256 _pay)"
      ],
      decimals: 18
    }
  };

  // ────────────────────────────────────────────────────────────
  // 4) 티어 기준
  // ────────────────────────────────────────────────────────────
  var TIER = { 1: 1, 2: 100, 3: 1000 };

  // ────────────────────────────────────────────────────────────
  // 5) App Check 디버그 플래그
  // ────────────────────────────────────────────────────────────
  window.FB_APP_CHECK_SITE_KEY = FIREBASE.appCheckSiteKey || '';
  if (appcheckParam === 'debug') {
    window.FB_APP_CHECK_DEBUG = true;
    window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    console.warn('[config] AppCheck DEBUG(auto) — URL 파라미터에 의해 활성화됨');
  } else if (appcheckParam && appcheckParam.startsWith('token:')) {
    var token = appcheckParam.slice('token:'.length).trim();
    if (token.length > 20) {
      window.FB_APP_CHECK_DEBUG = token;
      window.FIREBASE_APPCHECK_DEBUG_TOKEN = token;
      console.warn('[config] AppCheck DEBUG(token) — URL 파라미터 토큰 사용');
    }
  }

  // ────────────────────────────────────────────────────────────
  // 6) 전역 주입
  // ────────────────────────────────────────────────────────────
  window.firebaseConfig = FIREBASE;
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
  // 7) 점검 로그
  // ────────────────────────────────────────────────────────────
  try {
    if (!window.firebaseConfig || !window.firebaseConfig.apiKey) console.error("[config] firebaseConfig 누락 또는 apiKey 비어 있음.");
    if (!/(\.appspot\.com|\.firebasestorage\.app)$/i.test(String(window.firebaseConfig.storageBucket || ''))) {
      console.warn("[config] storageBucket 형식이 일반적이지 않습니다:", window.firebaseConfig.storageBucket);
    }
    console.log("[config] firebaseConfig ready:", {
      projectId: FIREBASE.projectId,
      storageBucket: FIREBASE.storageBucket,
      appCheckSiteKeySet: Boolean(FIREBASE.appCheckSiteKey),
      isLocal: isLocal
    });
  } catch (_) {}

  // ===================================================================
  // 8) Web3 도우미 (ethers v6 UMD 필요 — 페이지에서 포함)
  // ===================================================================
  window.APP = window.APP || {};
  APP.contracts = APP.contracts || {};
  APP.sc = APP.sc || {};
  APP.web3 = APP.web3 || {};

  APP.contracts.PawMate = {
    address: ONCHAIN.PawMate.address,
    abi: ONCHAIN.PawMate.abi,
    decimals: ONCHAIN.PawMate.decimals || 18
  };

  APP.web3.switchToChain = async function () {
    if (!window.ethereum) throw new Error('지갑이 필요합니다 (MetaMask 등).');
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.chainIdHex }] });
    } catch (e) {
      if (e && e.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: CHAIN.chainIdHex,
            chainName: CHAIN.chainName,
            nativeCurrency: CHAIN.nativeCurrency,
            rpcUrls: CHAIN.rpcUrls,
            blockExplorerUrls: CHAIN.blockExplorerUrls
          }]
        });
      } else {
        throw e;
      }
    }
  };

  APP.web3.getSigner = async function () {
    if (!window.ethereum) throw new Error('지갑이 필요합니다 (MetaMask 등).');
    if (typeof ethers === 'undefined') throw new Error('ethers 라이브러리가 필요합니다.');
    var provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    try { await APP.web3.switchToChain(); } catch (_) {}
    return provider.getSigner();
  };

  APP.web3.getContract = async function (name) {
    var meta = APP.contracts[name];
    if (!meta || !meta.address || !meta.abi) throw new Error("컨트랙트 메타 누락: " + name);
    var signer = await APP.web3.getSigner();
    return new ethers.Contract(meta.address, meta.abi, signer);
  };

  // ── (NEW) PAW 토큰 메타/잔고/허용량 유틸 ─────────────────────────────
  APP.sc.readPawMeta = async function() {
    const c = await APP.web3.getContract('PawMate');
    const pawAddr = await c.paw();
    const signer  = await APP.web3.getSigner();
    const erc = new ethers.Contract(
      pawAddr,
      [
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
        "function balanceOf(address) view returns (uint256)",
        "function allowance(address,address) view returns (uint256)",
        "function approve(address,uint256) returns (bool)"
      ],
      signer
    );
    const [sym, dec] = await Promise.all([erc.symbol().catch(()=> 'PAW'), erc.decimals()]);
    return { pawAddr, erc, sym, dec: Number(dec) };
  };

  // ===================================================================
  // 9) 스마트컨트랙트 래퍼
  // ===================================================================
  APP.sc.bcrate = async function (priceInput) {
    var decimals = APP.contracts.PawMate.decimals || 18;
    var price;
    if (typeof priceInput === 'bigint') {
      price = priceInput;
    } else {
      var s = String(priceInput ?? '').trim();
      if (!s) throw new Error('가격이 없습니다.');
      try {
        if (/^\d+$/.test(s) && s.length > 12) price = BigInt(s); // wei로 간주
        else price = ethers.parseUnits(s, decimals);
      } catch (e) { throw new Error('가격 형식이 올바르지 않습니다.'); }
    }

    var c = await APP.web3.getContract('PawMate');
    var tx = await c.bcrate(price);
    var receipt = await tx.wait();

    // 이벤트가 없으므로 id는 bid()-1 로 추정한다.
    let id;
    try {
      const nextBid = await c.bid();
      // ethers v6 BigInt
      id = (typeof nextBid === 'bigint') ? (nextBid - 1n) : (BigInt(nextBid) - 1n);
      id = id.toString();
    } catch (_) {
      id = undefined;
    }
    return { txHash: tx.hash, receipt: receipt, id: id };
  };

  APP.sc.buy = async function (bid) {
    var c = await APP.web3.getContract('PawMate');
    var tx = await c.buy(bid);
    var receipt = await tx.wait();
    return { txHash: tx.hash, receipt: receipt };
  };

  // ===================================================================
  // 10) 공통 유틸
  // ===================================================================
  function waitFirebaseApp() {
    return new Promise(function (res) {
      var tick = function () {
        if (window.firebase && firebase.apps && firebase.apps.length) res();
        else setTimeout(tick, 60);
      };
      tick();
    });
  }
  function resolveSelectedAddress() {
    try { return (window.ethereum && window.ethereum.selectedAddress) ? String(window.ethereum.selectedAddress).toLowerCase() : null; }
    catch (_) { return null; }
  }
  function toWeiFlexible(v, decimals) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!s) return null;
    try {
      if (/^\d+$/.test(s) && s.length > 12) return BigInt(s); // wei 가정
      return ethers.parseUnits(s, decimals);
    } catch (_) { return null; }
  }
  function stripZeros(x) {
    try { return String(x).includes('.') ? String(x).replace(/\.?0+$/,'') : String(x); } catch { return String(x); }
  }
  function toHumanPaw(x) {
    try {
      if (x == null) return null;
      var d = (APP.contracts && APP.contracts.PawMate && APP.contracts.PawMate.decimals) || 18;
      if (typeof x === 'bigint') return ethers.formatUnits(x, d);
      if (typeof x === 'number') return String(x);
      var s = String(x).trim();
      if (!s) return null;
      if (/^\d+$/.test(s) && s.length > 12) return ethers.formatUnits(BigInt(s), d); // wei로 보임
      if (/^\d+(\.\d+)?$/.test(s)) return s; // 사람이 읽는 단위(파우)
      return null;
    } catch { return null; }
  }

  // 가격/버튼 라벨 동기화(문서값 기준 — 표시용)
  function updatePriceUI(p) {
    var priceEl = document.getElementById('p-price');
    var btnBuy  = document.getElementById('btn-buy');
    var selling = !!(p && (p.saleOpen || p.selling || p.saleTx || p.saleId));
    var human   = toHumanPaw(p && (p.salePrice ?? p.price ?? p.amount));
    if (selling && human) {
      var t = stripZeros(human);
      if (priceEl) { priceEl.textContent = '가격 ' + t + ' PAW'; priceEl.classList.remove('hidden'); }
      if (btnBuy)  { btnBuy.textContent = '상품구매 (' + t + ' PAW)'; }
    } else {
      if (priceEl) priceEl.classList.add('hidden');
      if (btnBuy)  btnBuy.textContent = '상품구매';
    }
  }

  // 온체인에서 실제 price/decimals 읽어 버튼/가격 라벨 보정(정확한 표시용)
  async function decoratePriceUIOnChain(bid) {
    try {
      if (!bid) return;
      const c = await APP.web3.getContract('PawMate');
      // vouchers()로 교체
      const v = await c.vouchers(bid);
      // v.price는 BigInt
      const needWei = BigInt(v.price || 0n);
      if (needWei <= 0n) return;
      const { dec, sym } = await APP.sc.readPawMeta();
      const human = ethers.formatUnits(needWei, dec);
      const t = stripZeros(human);
      const priceEl = document.getElementById('p-price');
      const btnBuy  = document.getElementById('btn-buy');
      if (priceEl) { priceEl.textContent = '가격 ' + t + ' ' + (sym || 'PAW'); priceEl.classList.remove('hidden'); }
      if (btnBuy)  { btnBuy.textContent = '상품구매 (' + t + ' ' + (sym || 'PAW') + ')'; }
    } catch(_) {}
  }

  // ===================================================================
  // 11) product.html 컨트롤러
  // ===================================================================
  (function productPageController() {
    var root = document.getElementById('product-page');
    if (!root) return;

    var _listenersBound = false;
    var _loadedOnce = false;
    var _product = null;
    var _foundCol = 'products';
    var _busy = { queue:false, buy:false };

    function $(s, el) { return (el || document).querySelector(s); }
    function show(el, on) { if (!el) return; el.classList.toggle('hidden', !on); }
    function setStatus(msg) { var el = $('#status'); if (el) el.textContent = msg || ''; }

    function parseParams() {
      var url = new URL(location.href);
      return {
        id: url.searchParams.get('id') || url.searchParams.get('pid') || url.searchParams.get('doc') || url.searchParams.get('cid'),
        col: (url.searchParams.get('col') || '').trim()
      };
    }

    async function getProductDoc(db, id, colHint) {
      if (colHint === 'products' || colHint === 'items') {
        try { var s = await db.collection(colHint).doc(id).get(); if (s.exists) return { snap:s, col:colHint }; } catch(_){}
      }
      try { var s1 = await db.collection('products').doc(id).get(); if (s1.exists) return { snap:s1, col:'products' }; } catch(_){}
      try { var s2 = await db.collection('items').doc(id).get();    if (s2.exists) return { snap:s2, col:'items'    }; } catch(_){}
      return null;
    }

    function pickThumbField(d) {
      var c = [
        d.thumbUrl, d.thumbnail, d.thumb, d.image, d.imageUrl, d.photoURL, d.photoUrl,
        d.coverUrl, d.cover, d.pic, d.picture,
        Array.isArray(d.images) ? d.images[0] : null
      ].filter(Boolean);
      return c[0] || '';
    }

    async function resolveImageUrl(raw) {
      try {
        if (!raw) return null;
        var storage = firebase.storage();
        if (/^https?:\/\//i.test(raw)) return raw;
        if (/^gs:\/\//i.test(raw) || /^https?:\/\/firebasestorage\.googleapis\.com\//i.test(raw)) {
          try { return await storage.refFromURL(raw).getDownloadURL(); } catch(_){}
        }
        try { return await storage.ref(raw).getDownloadURL(); } catch(_){}
        if (typeof raw === 'object' && raw.fullPath) {
          try { return await storage.ref(raw.fullPath).getDownloadURL(); } catch(_){}
        }
      } catch(_){}
      return null;
    }

    async function renderBasic(p) {
      var img = document.getElementById('p-thumb');
      document.getElementById('p-title').textContent = p.title || '상품명';
      document.getElementById('p-tags').textContent = Array.isArray(p.tags) ? p.tags.map(function (t) { return '#' + t; }).join(' ') : '';
      document.getElementById('p-desc').textContent = p.summary || p.desc || p.description || '';

      var rawThumb = pickThumbField(p);
      var url = await resolveImageUrl(rawThumb);
      if (url) { img.src = url; img.classList.remove('skeleton'); }

      var link = p.body || p.link || p.url;
      if (link) { var a = document.getElementById('p-link'); a.href = link; a.classList.remove('hidden'); }
    }

    function isOwnerByAuthOrWallet(p, user) {
      var uid = user && user.uid;
      var selectedAddr = resolveSelectedAddress();
      var ownerUid = p.ownerUid || p.owner || null;
      var ownerAddr = (p.ownerAddress || p.ownerAddr || '').toLowerCase();
      var byUid = !!(uid && ownerUid && ownerUid === uid);
      var byAddr = !!(selectedAddr && ownerAddr && ownerAddr === selectedAddr);
      return byUid || byAddr;
    }

    function computeSelling(p) {
      return !!(p.saleOpen || p.selling || p.saleTx || p.saleId);
    }

    function toggleButtons(isOwner, selling, product) {
      var btnQueue = document.getElementById('btn-queue');
      var btnBuy   = document.getElementById('btn-buy');
      show(btnQueue, isOwner && !selling);
      show(btnBuy,   selling);
      setStatus(selling
        ? (product.saleId ? ('판매중 · voucherId=' + product.saleId)
           : (product.saleTx ? ('판매중 (tx=' + String(product.saleTx).slice(0,10) + '…)') : '판매중'))
        : (isOwner ? '판매를 열려면 [판매대기중]을 누르세요.' : '판매 대기중'));
      updatePriceUI(product);
    }

    function bindListeners() {
      if (_listenersBound) return;
      _listenersBound = true;

      var btnQueue = document.getElementById('btn-queue');
      var btnBuy   = document.getElementById('btn-buy');

      // 판매 오픈(bcrate)
      if (btnQueue) {
        const onQueue = async function () {
          if (_busy.queue) return;
          _busy.queue = true;
          try {
            var user = firebase.auth().currentUser;
            if (!user) { alert('로그인 후 이용하세요.'); return; }
            if (!_product) { alert('상품 정보를 먼저 불러오세요.'); return; }
            if (!isOwnerByAuthOrWallet(_product, user)) { alert('상품 등록자만 실행할 수 있습니다.'); return; }
            if (!window.ethereum || typeof ethers === 'undefined') { alert('지갑/ethers 라이브러리가 필요합니다.'); return; }

            var decimals = (APP.contracts && APP.contracts.PawMate && APP.contracts.PawMate.decimals) || 18;

            // 문서에 가격 있으면 그대로 사용 → 프롬프트 없음
            var docPriceWei = toWeiFlexible(_product.salePrice || _product.price || _product.amount, decimals);
            var priceStr = null;
            if (!docPriceWei) {
              var defaultHuman = '';
              try {
                if (_product.salePrice) defaultHuman = ethers.formatUnits(_product.salePrice, decimals);
                else if (_product.price) defaultHuman = String(_product.price);
              } catch(_) {}
              priceStr = prompt('판매 가격을 입력하세요 (예: 150)', defaultHuman || '');
              if (priceStr === null) return;
            }

            btnQueue.disabled = true;
            setStatus('트랜잭션 전송 중… 지갑에서 확인하세요.');
            try { await APP.web3.switchToChain(); } catch(_) {}

            var res = await APP.sc.bcrate(docPriceWei ?? priceStr);

            var finalWei = String(docPriceWei ?? ethers.parseUnits(String(priceStr), decimals));
            await firebase.firestore().collection(_foundCol).doc(_product.id).update({
              saleOpen: true,
              salePrice: finalWei, // wei 문자열
              saleTx: res.txHash || null,
              saleId: res.id || null,
              updatedAt: firebase.firestore().FieldValue ? firebase.firestore().FieldValue.serverTimestamp() : firebase.firestore.FieldValue.serverTimestamp()
            });

            _product.saleOpen  = true;
            _product.saleTx    = res.txHash || _product.saleTx || null;
            _product.saleId    = res.id || _product.saleId || null;
            _product.salePrice = finalWei;

            toggleButtons(true, true, _product);
            setStatus('판매중' + (res && res.txHash ? (' (tx=' + res.txHash.slice(0, 10) + '…)') : ''));
            // 온체인 가격/심볼로 라벨 보정
            if (_product.saleId) { try { await decoratePriceUIOnChain(_product.saleId); } catch(_) {} }
            alert('판매를 시작했습니다.');
          } catch (e) {
            console.error(e);
            alert('판매 시작 실패: ' + (e && e.message || e));
            setStatus('판매 시작 실패');
          } finally {
            btnQueue && (btnQueue.disabled = false);
            _busy.queue = false;
          }
        };
        btnQueue.addEventListener('click', onQueue);
      }

      // 구매(buy) — 허용량(approve) 자동 처리
      if (btnBuy) {
        const onBuy = async function () {
          if (_busy.buy) return;
          _busy.buy = true;
          try {
            if (!_product || !_product.saleId) { alert('이 상품에는 voucherId가 없습니다.'); return; }
            if (!window.ethereum || typeof ethers === 'undefined') { alert('지갑/ethers 라이브러리가 필요합니다.'); return; }
            try { await APP.web3.switchToChain(); } catch(_) {}

            btnBuy.disabled = true;
            setStatus('구매 준비 중…');

            // 온체인에서 실제 가격 조회 (voucherInfo -> vouchers로 변경)
            const c = await APP.web3.getContract('PawMate');
            const v = await c.vouchers(_product.saleId);
            const needWei = BigInt(v.price);
            if (needWei <= 0n) { alert('바우처 가격 오류'); setStatus('구매 실패'); return; }

            // 토큰 메타/잔고/허용량
            const { erc, dec, sym } = await APP.sc.readPawMeta();
            const signer = await APP.web3.getSigner();
            const me = await signer.getAddress();

            const bal = await erc.balanceOf(me);
            if (bal < needWei) {
              alert(`잔액 부족: 보유 ${ethers.formatUnits(bal, dec)} < 필요 ${ethers.formatUnits(needWei, dec)} ${sym}`);
              setStatus('구매 실패(잔액 부족)');
              return;
            }

            let allowance = await erc.allowance(me, APP.contracts.PawMate.address);
            if (allowance < needWei) {
              setStatus(`토큰 승인(approve) 중… (${ethers.formatUnits(needWei, dec)} ${sym})`);
              try {
                await erc.approve(APP.contracts.PawMate.address, needWei);
              } catch (e1) {
                // 일부 토큰은 0으로 초기화 후 다시 승인 필요
                try {
                  await erc.approve(APP.contracts.PawMate.address, 0);
                  await erc.approve(APP.contracts.PawMate.address, needWei);
                } catch (e2) {
                  console.error('approve 실패', e2);
                  alert('토큰 승인(approve)에 실패했습니다. 메타마스크에서 다시 시도하세요.');
                  setStatus('구매 실패(approve 실패)');
                  return;
                }
              }
              // 최신 허용량 다시 확인
              allowance = await erc.allowance(me, APP.contracts.PawMate.address);
              if (allowance < needWei) {
                alert('허용량이 여전히 부족합니다. 다시 시도해주세요.');
                setStatus('구매 실패(allowance 부족)');
                return;
              }
            }

            // 구매 트랜잭션
            setStatus('구매 트랜잭션 전송 중…');
            var out = await APP.sc.buy(_product.saleId);

            setStatus('구매 완료' + (out && out.txHash ? (' (tx=' + out.txHash.slice(0, 10) + '…)') : ''));
            alert('구매가 완료되었습니다.');

            try {
              var addr = me;
              await firebase.firestore().collection(_foundCol).doc(_product.id).update({
                purchased: true,
                buyerUid: (firebase.auth().currentUser && firebase.auth().currentUser.uid) || null,
                buyerAddress: addr || null,
                updatedAt: firebase.firestore().FieldValue ? firebase.firestore().FieldValue.serverTimestamp() : firebase.firestore.FieldValue.serverTimestamp()
              });
            } catch(_) {}
          } catch (e) {
            console.error(e);
            alert('구매 실패: ' + (e && e.message || e));
            setStatus('구매 실패');
          } finally {
            btnBuy && (btnBuy.disabled = false);
            _busy.buy = false;
          }
        };
        btnBuy.addEventListener('click', onBuy);
      }
    }

    async function loadAndRender() {
      await waitFirebaseApp();

      var params = parseParams();
      if (!params.id) { alert('productId 가 필요합니다. (?id=...)'); return; }

      var user = firebase.auth().currentUser;
      var authEl = document.getElementById('auth-email');
      if (authEl) authEl.textContent = user ? (user.email || '로그인됨') : '비로그인';

      var db = firebase.firestore();
      var found = await getProductDoc(db, params.id, params.col);
      if (!found) { alert('상품을 찾을 수 없습니다.'); return; }

      _product = Object.assign({ id: found.snap.id }, found.snap.data());
      _foundCol = found.col;

      await renderBasic(_product);

      var isOwner = isOwnerByAuthOrWallet(_product, user);
      var selling = computeSelling(_product);

      updatePriceUI(_product);
      toggleButtons(isOwner, selling, _product);

      // 온체인에서 실제 가격/심볼로 라벨 보정
      if (_product.saleId) { try { await decoratePriceUIOnChain(_product.saleId); } catch(_) {} }

      if (!_listenersBound) bindListeners();
    }

    function boot() {
      if (_loadedOnce) return;
      _loadedOnce = true;

      waitFirebaseApp().then(function () {
        firebase.auth().onAuthStateChanged(function () { loadAndRender().catch(console.error); });
        setTimeout(function () { loadAndRender().catch(function () {}); }, 200);
      });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  })();

})();
