

/* ---------- 0) Helpers ---------- */
function getTS(x){
  if (!x) return 0;
  if (typeof x.toMillis === 'function') return x.toMillis();
  if (x instanceof Date) return x.getTime();
  if (typeof x === 'number') return x;
  return 0;
}

const $  = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
const toast = (m) => alert(m);
const fmt = (n) => new Intl.NumberFormat('ko-KR').format(n);
function esc(s){
  return (s||"").replace(/[&<>'"`]/g, m=>({ 
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", "\"":