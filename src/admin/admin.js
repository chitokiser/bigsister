import { $, esc, ensureLayout, requireAdmin, db, State, toast } from '../core.js';

// ===== 유틸 =====
function labelStatus(s){
  switch(String(s||'').toLowerCase()){
    case 'approved': return '승인됨';
    case 'rejected': return '거절됨';
    case 'pending': default: return '대기중';
  }
}

function rowHtml(id, d){
  const img = d.photoURL || 'https://placehold.co/80x60?text=IMG';
  const name = d.displayName || '(이름 없음)';
  const city = d.city || '';
  const topic = d.topic || '';
  const status = d.status || 'pending';
  const when = (d.updatedAt && d.updatedAt.toDate) ? d.updatedAt.toDate().toLocaleString() : '';
  const uid = d.ownerUid || id;
  return `
  <div class="row" data-id="${esc(id)}" style="align-items:center;gap:12px">
    <img src="${esc(img)}" alt="" style="width:80px;height:60px;object-fit:cover;border-radius:10px"/>
    <div class="col" style="flex:1;min-width:0">
      <div class="row" style="align-items:center;gap:8px">
        <strong>${esc(name)}</strong>
        <span class="pill">${esc(labelStatus(status))}</span>
      </div>
      <div class="muted small">${esc(city)} • ${esc(topic||'주제없음')}</div>
      <div class="muted small">${esc(uid)} • ${esc(when)}</div>
    </div>
    <div class="row gap">
      <button class="btn small outline act-approve" ${status==='approved'?'disabled':''}>승인</button>
      <button class="btn small outline act-reject" ${status==='rejected'?'disabled':''}>거절</button>
      <button class="btn small outline act-open">프로필 열기</button>
    </div>
  </div>`;
}

// ===== 인증/관리자 준비 대기 (레이스 방지) =====
async function fallbackIsAdmin(user){
  if (!user) return false;
  // 1) Custom Claims
  try {
    await user.getIdToken(true);
    const t = await user.getIdTokenResult();
    if (t?.claims?.admin === true) return true;
  } catch(_) {}
  // 2) users/{uid}.role == "admin"
  try {
    const s = await db.collection('users').doc(user.uid).get();
    if (s.exists && (s.data()?.role === 'admin')) return true;
  } catch(_) {}
  return false;
}

async function waitForAuthAndAdmin(timeoutMs=15000){
  const started = Date.now();
  // ensureLayout 내 onAuthStateChanged가 State.user/State.isAdmin을 채우도록 잠시 대기
  while (Date.now() - started < timeoutMs) {
    const u = (window.firebase?.auth && window.firebase.auth().currentUser) || null;
    if (u) {
      // State.isAdmin 계산이 아직 안 끝났다면 폴백으로 직접 판정
      if (State?.isAdmin === true) return true;
      const ok = await fallbackIsAdmin(u);
      if (ok) { if (State) State.isAdmin = true; return true; }
      return false; // 로그인했는데 관리자 아님
    }
    await new Promise(r=>setTimeout(r, 120));
  }
  // 인증 자체가 안 올라옴
  return false;
}

// ===== 데이터 로딩 =====
async function fetchPending(){
  const list = $('#pending-list');
  list.innerHTML = '<div class="muted small">로딩 중…</div>';
  try{
    const snap = await db.collection('agents')
      .where('status','==','pending')
      .orderBy('updatedAt','desc')
      .limit(100)
      .get();
    list.innerHTML = snap.empty ? '<div class="muted small">승인 대기 항목이 없습니다.</div>' :
      snap.docs.map(doc => rowHtml(doc.id, doc.data()||{})).join('');
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
    list.innerHTML = snap.empty ? '<div class="muted small">등록된 에이전트가 없습니다.</div>' :
      snap.docs.map(doc => rowHtml(doc.id, doc.data()||{})).join('');
  }catch(e){
    console.error('[admin] fetchAll error', e);
    list.innerHTML = '<div class="muted small">로드 오류</div>';
  }
}

async function setStatus(id, next){
  try{
    const adminUid = (window.firebase?.auth && window.firebase.auth().currentUser?.uid) || State?.user?.uid || null;
    const ref = db.collection('agents').doc(id);
    const payload = {
      status: String(next),
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    };
    if (next === 'approved'){
      payload.approvedAt = window.firebase.firestore.FieldValue.serverTimestamp();
      payload.approvedBy = adminUid || null;
    }else if (next === 'rejected'){
      payload.rejectedAt = window.firebase.firestore.FieldValue.serverTimestamp();
      payload.rejectedBy = adminUid || null;
    }
    await ref.set(payload, { merge:true });
  }catch(e){
    console.error('[admin] setStatus error', e);
    throw e;
  }
}

function bindActions(){
  document.addEventListener('click', async (e)=>{
    const row = e.target.closest('[data-id]'); if (!row) return;
    const id = row.getAttribute('data-id');
    if (e.target.classList.contains('act-approve')){
      try {
        await setStatus(id, 'approved');
        toast('승인 처리 완료');
        await Promise.all([fetchPending(), fetchAll()]);
      } catch (err) {
        toast(`승인 실패: ${err.message || err}`);
      }
    }else if (e.target.classList.contains('act-reject')){
      try {
        await setStatus(id, 'rejected');
        toast('거절 처리 완료');
        await Promise.all([fetchPending(), fetchAll()]);
      } catch (err) {
        toast(`거절 실패: ${err.message || err}`);
      }
    }else if (e.target.classList.contains('act-open')){
      location.href = 'localmate.html#'+encodeURIComponent(id);
    }
  });
  $('#btn-refresh')?.addEventListener('click', ()=> Promise.all([fetchPending(), fetchAll()]));
}

// ===== 엔트리 =====
(async function(){
  await ensureLayout('admin.html');

  // 인증/관리자 판정이 끝난 뒤에만 게이트 실행 (레이스 방지)
  const isAdmin = await waitForAuthAndAdmin(15000);
  if (!isAdmin) {
    requireAdmin('index.html'); // 여기서 토스트 + 리다이렉트
    return;
  }

  bindActions();
  await Promise.all([fetchPending(), fetchAll()]);
})();
