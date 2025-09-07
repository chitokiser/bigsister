import { $, toast, ensureLayout, db, State, esc } from '../core.js';

function isIndexError(err){ if(!err) return false; const msg=String(err.message||''); return (err.code===9)||(msg.includes('requires an index'))||(msg.includes('FAILED_PRECONDITION')); }

function buildAgentCard(d, isMine, ownerId){
  const badge=isMine ? '<span class="pill" style="margin-left:6px">내 프로필</span>' : (d.status==='approved'?'':'<span class="pill" style="margin-left:6px">'+esc(labelStatus(d.status))+'</span>');
  const img=d.photoURL||'https://placehold.co/300x200?text=Local+Mate';
  let bio=(d.bio||'').split('\n')[0]; if(bio.length>80) bio=bio.slice(0,77)+'…';
  return `
  <div class="card">
    <img src="${esc(img)}" alt="" style="width:100%;height:160px;object-fit:cover;border-radius:12px"/>
    <div class="col" style="gap:6px;margin-top:8px">
      <div class="row" style="align-items:center"><strong>${esc(d.displayName||'로컬 메이트')}</strong>${badge}</div>
      <div class="muted small">${esc(d.city||'')}</div>
      <div class="muted small">${esc(bio)}</div>
      <div class="row gap wrap" style="margin-top:8px">
        <a class="btn outline small" href="search.html?owner=${encodeURIComponent(ownerId)}&kind=product">상품 보기</a>
        <a class="btn subtle small"  href="search.html?owner=${encodeURIComponent(ownerId)}&kind=post">블로그 보기</a>
      </div>
    </div>
  </div>`;
}
function labelStatus(s){ return (s==='applied')?'신청':(s==='approved')?'승인':(s==='rejected')?'반려':'초안'; }

async function renderNotices(){
  const nl = $('#notice-list'); if(!nl) return;
  try{
    const snap = await db.collection('notices').orderBy('ts','desc').limit(10).get();
    nl.innerHTML = snap.empty ? '<div class="muted small">등록된 공지가 없습니다.</div>' :
      snap.docs.map(d => {
        const x=d.data()||{};
        return `<div class="row"><strong>${esc(x.title||'')}</strong><div class="muted small">${esc(x.body||'')}</div></div>`;
      }).join('');
  }catch(e){ nl.innerHTML='<div class="muted small">공지 불러오기 오류</div>'; }
}

async function renderFeaturedAgents(){
  const grid = $('#agent-grid'), rgrid = $('#region-grid');
  if(grid) grid.innerHTML='<div class="muted small">로딩 중…</div>'; if(rgrid) rgrid.innerHTML='';

  let docs = [];
  // 1차
  try{
    const snap=await db.collection('agents').where('status','==','approved').orderBy('updatedAt','desc').limit(20).get();
    docs = snap.empty ? [] : snap.docs.slice();
  }catch(e1){
    // 2차
    try{
      const snap2=await db.collection('agents').orderBy('updatedAt','desc').limit(20).get();
      docs = snap2.empty ? [] : snap2.docs.slice();
    }catch(e2){
      // 3차
      const snap3=await db.collection('agents').limit(20).get();
      docs = snap3.empty ? [] : snap3.docs.slice();
    }
  }

  // 내 프로필 병합
  if(State.user){
    try{
      const my = await db.collection('agents').doc(State.user.uid).get();
      if (my.exists && !docs.some(d=>d.id===my.id)) docs.unshift(my);
    }catch(e){}
  }

  if(grid){
    grid.innerHTML = docs.length
      ? docs.map(doc => buildAgentCard(doc.data()||{}, State.user && doc.id===State.user.uid, doc.id)).join('')
      : '<div class="muted small">표시할 로컬 메이트가 아직 없습니다. localmate.html에서 지역 소개 카드를 저장해 보세요.</div>';
  }

  // 지역 집계
  if(rgrid && docs.length){
    const map={};
    docs.forEach(doc=>{
      const d=doc.data()||{}; const key=(d.city||'기타').trim()||'기타';
      map[key] = map[key] || {count:0,sample:d}; map[key].count++;
    });
    const top = Object.keys(map).map(k=>({city:k, count:map[k].count, sample:map[k].sample}))
                  .sort((a,b)=>b.count-a.count).slice(0,6);
    rgrid.innerHTML = top.map(x=>{
      const img = (x.sample && x.sample.photoURL) || 'https://placehold.co/300x200?text='+encodeURIComponent(x.city);
      return `<div class="card"><img src="${esc(img)}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:12px"/><div class="row spread" style="margin-top:8px"><strong>${esc(x.city)}</strong><span class="pill">${x.count}</span></div></div>`;
    }).join('');
  }
}

(async function(){
  await ensureLayout('index.html');
  await Promise.all([renderNotices(), renderFeaturedAgents()]);
})();
