import { $, esc, toast, ensureLayout, db } from '../core.js';

function parseQuery(){
  const q = new URLSearchParams(location.search);
  return { owner: q.get('owner')||'', kind: q.get('kind')||'' };
}
function isIndexError(err){ if(!err) return false; const m=String(err.message||''); return (err.code===9)||(m.includes('requires an index'))||(m.includes('FAILED_PRECONDITION')); }

function renderItems(docs){
  const grid = $('#search-grid');
  if(!docs.length){ grid.innerHTML='<div class="muted small">검색 결과가 없습니다.</div>'; return; }
  grid.innerHTML = docs.map(doc=>{
    const d=doc.data()||{}, img=(d.images?.[0]) || 'https://placehold.co/600x360?text=No+Image';
    const right=(d.kind==='product')?((d.price!=null?d.price:'-')+' PAW'):'포스트';
    const tag=(d.tags||[]).slice(0,3).join(', ');
    return `
      <div class="card">
        <img src="${esc(img)}" style="width:100%;height:160px;object-fit:cover;border-radius:12px"/>
        <div class="col" style="gap:6px;margin-top:8px">
          <div class="row spread"><strong>${esc(d.title||'')}</strong><small class="muted">${esc(right)}</small></div>
          <div class="muted small">${esc(tag)}</div>
          <div class="muted small">${esc((d.body||'').split('\n')[0].slice(0,80))}</div>
        </div>
      </div>`;
  }).join('');
}

(async function(){
  await ensureLayout('search.html');
  const grid = $('#search-grid'); grid.innerHTML='<div class="muted small">검색 중…</div>';

  const { owner, kind } = parseQuery();

  let ref = db.collection('items');
  if (owner) ref = ref.where('ownerUid','==', owner);
  if (kind)  ref = ref.where('kind','==', kind);
  ref = ref.orderBy('ts','desc').limit(60);

  try{
    const snap = await ref.get();
    renderItems(snap.docs);
  }catch(e){
    if (isIndexError(e)){
      const q = db.collection('items'); let r=q;
      if (owner) r=r.where('ownerUid','==', owner);
      if (kind)  r=r.where('kind','==', kind);
      const s2 = await r.limit(200).get();
      const docs = s2.docs.slice().sort((a,b)=>(b.data().ts||0)-(a.data().ts||0));
      renderItems(docs);
      toast('인덱스가 없어 임시 정렬로 표시합니다. Firestore 인덱스를 생성해 주세요.');
    } else {
      console.error(e); grid.innerHTML='<div class="muted small">검색 실패</div>';
    }
  }

  $('#search-run')?.addEventListener('click', ()=> toast('텍스트 검색은 추후 확장 예정입니다.'));
})();
