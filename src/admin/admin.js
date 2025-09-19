import { $, esc, ensureLayout, requireAdmin, db, State, toast } from '../core.js';

/* ---------------------------------------------------------
 * Admin · LocalMate 대시보드 (+ Web3 메이트 승인/해제)
 * - Firestore: agents (대기/전체 목록)
 * - Users: users/{uid}.walletAddress 조회
 * - On-chain: PawMate.mateok(address) / mateno(address)
 * --------------------------------------------------------- */

/* ========== 공통 유틸 ========== */
function labelStatus(s){
  switch(String(s||'').toLowerCase()){
    case 'approved': return '승인됨';
    case 'rejected': return '거절됨';
    case 'pending': default: return '대기중';
  }
}

async function fetchUserWalletAddress(uid) {
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    return userDoc.exists ? userDoc.data().walletAddress || null : null;
  } catch (e) {
    console.error(`[admin] Error fetching wallet for ${uid}:`, e);
    return null;
  }
}

/* 행 렌더링 (메이트 승인/해제 버튼 추가) */
function rowHtml(id, d, walletAddress = null){
  const img = d.photoURL || 'https://placehold.co/80x60?text=IMG';
  const name = d.displayName || '(이름 없음)';
  const city = d.city || '';
  const topic = d.topic || '';
  const status = d.status || 'pending';
  const when = (d.updatedAt && d.updatedAt.toDate) ? d.updatedAt.toDate().toLocaleString() : '';
  const uid = d.ownerUid || id;
  const displayWallet = walletAddress ? `지갑: ${esc(walletAddress.slice(0, 6))}...${esc(walletAddress.slice(-4))}` : '지갑 주소 없음';

  const mateBtnDisabled = walletAddress ? '' : 'disabled';

  return `
  <div class="row" data-id="${esc(id)}" data-uid="${esc(uid)}" data-wallet-address="${esc(walletAddress || '')}" style="align-items:center;gap:12px">
    <img src="${esc(img)}" alt="" style="width:80px;height:60px;object-fit:cover;border-radius:10px"/>
    <div class="col" style="flex:1;min-width:0">
      <div class="row" style="align-items:center;gap:8px">
        <strong>${esc(name)}</strong>
        <span class="pill">${esc(labelStatus(status))}</span>
      </div>
      <div class="muted small">${esc(city)} • ${esc(topic||'주제없음')}</div>
      <div class="muted small">UID: ${esc(uid)} • ${esc(when)}</div>
      <div class="muted small">${displayWallet}</div>
    </div>
    <div class="row gap">
      <button class="btn small outline act-approve" ${status==='approved'?'disabled':''}>승인</button>
      <button class="btn small outline act-reject" ${status==='rejected'?'disabled':''}>거절</button>
      <button class="btn small outline act-open">프로필 열기</button>
      <button class="btn small outline act-copy-wallet" ${!walletAddress ? 'disabled' : ''}>지갑 복사</button>
      <button class="btn small primary act-mate-approve" ${mateBtnDisabled}>메이트 승인</button>
      <button class="btn small danger outline act-mate-revoke" ${mateBtnDisabled}>메이트 해제</button>
    </div>
  </div>`;
}

/* ========== 인증/관리자 폴백 ========== */
async function fallbackIsAdmin(user){
  if (!user) return false;
  try {
    await user.getIdToken(true);
    const t = await user.getIdTokenResult();
    if (t?.claims?.admin === true) return true;
  } catch(_) {}
  try {
    const s = await db.collection('users').doc(user.uid).get();
    if (s.exists && (s.data()?.role === 'admin')) return true;
  } catch(_) {}
  return false;
}

/* 필요 시 관리자 확인 (레이스 방지) */
async function waitForAuthAndAdmin(timeoutMs=15000){
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const u = (window.firebase?.auth && window.firebase.auth().currentUser) || null;
    if (u) {
      if (State?.isAdmin === true) return true;
      const ok = await fallbackIsAdmin(u);
      if (ok) { if (State) State.isAdmin = true; return true; }
      return false;
    }
    await new Promise(r=>setTimeout(r, 120));
  }
  return false;
}

/* ========== 데이터 로딩 ========== */
async function fetchPending(){
  const list = $('#pending-list');
  list.innerHTML = '<div class="muted small">로딩 중…</div>';
  try{
    const snap = await db.collection('agents')
      .where('status','==','pending')
      .orderBy('updatedAt','desc')
      .limit(100)
      .get();

    const agentsWithWallets = await Promise.all(snap.docs.map(async doc => {
      const agentData = doc.data();
      const walletAddress = await fetchUserWalletAddress(agentData.ownerUid || doc.id);
      return { id: doc.id, data: agentData, walletAddress: walletAddress };
    }));

    list.innerHTML = snap.empty ? '<div class="muted small">승인 대기 항목이 없습니다.</div>' : 
      agentsWithWallets.map(item => rowHtml(item.id, item.data, item.walletAddress)).join('');
  }catch(e){
    console.error('[admin] fetchPending error', e);
    list.innerHTML = '<div class="muted small">로드 오류: 인덱스가 필요하면 콘솔 지시에 따라 생성하세요.</div>';
  }
}

async function fetchAll(){
  const list = $('#all-list');
  list.innerHTML = '<div class="muted small">로딩 중…</div>';
  try{
    const snap = await db.collection('agents')
      .orderBy('updatedAt','desc')
      .limit(100)
      .get();

    const agentsWithWallets = await Promise.all(snap.docs.map(async doc => {
      const agentData = doc.data();
      const walletAddress = await fetchUserWalletAddress(agentData.ownerUid || doc.id);
      return { id: doc.id, data: agentData, walletAddress: walletAddress };
    }));

    list.innerHTML = snap.empty ? '<div class="muted small">등록된 에이전트가 없습니다.</div>' : 
      agentsWithWallets.map(item => rowHtml(item.id, item.data, item.walletAddress)).join('');
  }catch(e){
    console.error('[admin] fetchAll error', e);
    list.innerHTML = '<div class="muted small">로드 오류</div>';
  }
}

/* Firestore 상태 변경 */
async function setStatus(id, next){
  try{
    const adminUid = (window.firebase?.auth && window.firebase.auth().currentUser?.uid) || State?.user?.uid || null;
    const ref = db.collection('agents').doc(id);
    const F = window.firebase.firestore.FieldValue;
    const payload = {
      status: String(next),
      updatedAt: F.serverTimestamp()
    };
    if (next === 'approved'){
      payload.approvedAt = F.serverTimestamp();
      payload.approvedBy = adminUid || null;
    }else if (next === 'rejected'){
      payload.rejectedAt = F.serverTimestamp();
      payload.rejectedBy = adminUid || null;
    }
    await ref.set(payload, { merge:true });
  }catch(e){
    console.error('[admin] setStatus error', e);
    throw e;
  }
}

/* ========== Web3 헬퍼: PawMate 연결 ========== */
async function web3SwitchToChain(){
  const CHAIN = (window.CONFIG && window.CONFIG.chain) || { chainId: 204, rpcUrl: '' };
  if (!window.ethereum) throw new Error('지갑이 필요합니다 (MetaMask 등).');
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x' + Number(CHAIN.chainId).toString(16) }]
    });
  } catch (e) {
    if (e && e.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x' + Number(CHAIN.chainId).toString(16),
          chainName: (window.CONFIG?.chain?.network) || 'opBNB Mainnet',
          nativeCurrency: { name:'BNB', symbol:'BNB', decimals:18 },
          rpcUrls: [(window.CONFIG?.chain?.rpcUrl) || 'https://opbnb-mainnet-rpc.bnbchain.org'],
          blockExplorerUrls: ['https://opbnbscan.com/']
        }]
      });
    } else {
      throw e;
    }
  }
}

async function getSigner(){
  if (!window.ethereum) throw new Error('지갑이 필요합니다 (MetaMask 등).');
  if (!window.ethers) throw new Error('ethers 라이브러리가 필요합니다.');
  const provider = new window.ethers.BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  try { await web3SwitchToChain(); } catch(_) {}
  return provider.getSigner();
}

function getPawMateMeta(){
  const meta = window.CONFIG?.onchain?.PawMate;
  if (!meta || !meta.address || !meta.abi) throw new Error('PawMate 컨트랙트 설정 누락 (config.js 확인)');
  return meta;
}

async function getPawMate(){
  const meta = getPawMateMeta();
  const signer = await getSigner();
  return new window.ethers.Contract(meta.address, meta.abi, signer);
}

/* ========== Web3: 메이트 승인/해제 ========== */
async function approveMate(mateAddressFromList = null) {
  const mateAddressInput = $('#mate-address-input');
  const mateApprovalStatus = $('#mate-approval-status');
  const mateAddress = (mateAddressFromList || (mateAddressInput?.value || '').trim());

  if (mateApprovalStatus) mateApprovalStatus.textContent = '';

  if (!mateAddress) { toast('메이트 지갑 주소를 입력해주세요.'); return; }
  if (!window.ethers) { toast('ethers 라이브러리를 찾을 수 없습니다.'); return; }
  if (!window.ethereum) { toast('이더리움 지갑을 찾을 수 없습니다.'); return; }
  if (!window.ethers.isAddress(mateAddress)) { toast('유효한 지갑 주소가 아닙니다.'); return; }

  try {
    const c = await getPawMate();
    toast(`메이트 승인 트랜잭션 전송 중... (${mateAddress})`);
    if (mateApprovalStatus) mateApprovalStatus.textContent = '메이트 승인 트랜잭션 전송 중…';

    const tx = await c.mateok(mateAddress);
    await tx.wait();

    toast(`메이트 ${mateAddress} 승인 완료!`);
    if (mateApprovalStatus) mateApprovalStatus.textContent = `메이트 ${mateAddress} 승인 완료!`;
    if (mateAddressInput) mateAddressInput.value = '';
  } catch (error) {
    console.error('[admin] approveMate error:', error);
    toast(`메이트 승인 실패: ${error.message || error}`);
    if (mateApprovalStatus) mateApprovalStatus.textContent = `메이트 승인 실패: ${error.message || error}`;
  }
}

async function revokeMate(mateAddressFromList = null) {
  const mateAddressInput = $('#mate-address-input');
  const mateApprovalStatus = $('#mate-approval-status');
  const mateAddress = (mateAddressFromList || (mateAddressInput?.value || '').trim());

  if (mateApprovalStatus) mateApprovalStatus.textContent = '';

  if (!mateAddress) { toast('메이트 지갑 주소를 입력해주세요.'); return; }
  if (!window.ethers) { toast('ethers 라이브러리를 찾을 수 없습니다.'); return; }
  if (!window.ethereum) { toast('이더리움 지갑을 찾을 수 없습니다.'); return; }
  if (!window.ethers.isAddress(mateAddress)) { toast('유효한 지갑 주소가 아닙니다.'); return; }

  try {
    const c = await getPawMate();
    toast(`메이트 해제 트랜잭션 전송 중... (${mateAddress})`);
    if (mateApprovalStatus) mateApprovalStatus.textContent = '메이트 해제 트랜잭션 전송 중…';

    const tx = await c.mateno(mateAddress);
    await tx.wait();

    toast(`메이트 ${mateAddress} 해제 완료!`);
    if (mateApprovalStatus) mateApprovalStatus.textContent = `메이트 ${mateAddress} 해제 완료!`;
    if (mateAddressInput) mateAddressInput.value = '';
  } catch (error) {
    console.error('[admin] revokeMate error:', error);
    toast(`메이트 해제 실패: ${error.message || error}`);
    if (mateApprovalStatus) mateApprovalStatus.textContent = `메이트 해제 실패: ${error.message || error}`;
  }
}

/* ========== 버튼 바인딩 ========== */
function bindActions(){
  document.addEventListener('click', async (e)=>{
    const row = e.target.closest('[data-id]'); 
    const isRowTarget = !!row;
    const id = isRowTarget ? row.getAttribute('data-id') : null;
    const walletAddress = isRowTarget ? row.getAttribute('data-wallet-address') : null;

    if (e.target.classList.contains('act-approve')){
      try {
        await setStatus(id, 'approved');
        toast('승인 처리 완료');
        await Promise.all([fetchPending(), fetchAll()]);
      } catch (err) {
        toast(`승인 실패: ${err.message || err}`);
      }
    } else if (e.target.classList.contains('act-reject')){
      try {
        await setStatus(id, 'rejected');
        toast('거절 처리 완료');
        await Promise.all([fetchPending(), fetchAll()]);
      } catch (err) {
        toast(`거절 실패: ${err.message || err}`);
      }
    } else if (e.target.classList.contains('act-open')){
      location.href = 'localmate.html#'+encodeURIComponent(id);
    } else if (e.target.classList.contains('act-copy-wallet')){
      if (walletAddress) {
        navigator.clipboard.writeText(walletAddress).then(() => {
          toast('지갑 주소 복사 완료!');
        }).catch(err => {
          console.error('Failed to copy wallet address:', err);
          toast('지갑 주소 복사 실패.');
        });
      }
    } else if (e.target.classList.contains('act-mate-approve')){
      if (!walletAddress) { toast('지갑 주소가 없습니다.'); return; }
      try {
        await approveMate(walletAddress);
      } catch (err) {
        toast(`메이트 승인 실패: ${err.message || err}`);
      }
    } else if (e.target.classList.contains('act-mate-revoke')){
      if (!walletAddress) { toast('지갑 주소가 없습니다.'); return; }
      try {
        await revokeMate(walletAddress);
      } catch (err) {
        toast(`메이트 해제 실패: ${err.message || err}`);
      }
    }
  });

  $('#btn-refresh')?.addEventListener('click', ()=> Promise.all([fetchPending(), fetchAll()]));
  $('#approve-mate-button')?.addEventListener('click', ()=> approveMate());
  $('#revoke-mate-button')?.addEventListener('click', ()=> revokeMate());
}

/* ========== 엔트리 ========== */
(async function(){
  await ensureLayout('admin.html');

  // 관리자 보호게이트 (강제)
  const ok = await waitForAuthAndAdmin(8000);
  if (!ok) {
    // requireAdmin()이 라우팅/알림을 처리하도록 시도
    try { await requireAdmin(); } catch(_) {}
    // 계속 진행하되, 관리자 아니면 버튼 클릭 시 권한 부족으로 실패
  }

  bindActions();
  await Promise.all([fetchPending(), fetchAll()]);
})();
