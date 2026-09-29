// The board as an app: a DOM layer over the rendered SVG. Every gesture is one op to /op.
// Served by server.ts at /app.js. Plain script, no build step, no framework.
export const APP_JS = String.raw`
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const qs=new URLSearchParams(location.search);
const state={board:null,svg:'',open:(qs.get('open')||'').split(',').filter(Boolean),level:Number(qs.get('level')||1),sel:null,multi:new Set(),proposals:[],version:null,tab:'account',focus:qs.get('focus')||null,focusStack:[]};
const TRIG={event:'something arrives',chain:'the previous one ends',clock:'a schedule fires',hand:'a person gets to it'};
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const job=id=>state.board.jobs.find(j=>j.id===id), track=id=>state.board.tracks.find(t=>t.id===id), art=id=>state.board.artifacts.find(a=>a.id===id);
const live=()=>state.board.jobs.filter(j=>!j.removed);
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||('j'+Date.now());
async function op(ops){ await fetch('./op?board='+encodeURIComponent(state.board.id),{method:'POST',body:JSON.stringify(ops)}); await load(); }
function fq(){ return state.focus?'&focus='+encodeURIComponent(state.focus):''; }
function enterFocus(id){ if(state.focus) state.focusStack.push(state.focus); state.focus=id; state.sel=null; state.open=[]; state.multi.clear(); history.replaceState(null,'',location.pathname+'?board='+encodeURIComponent(qs.get('board')||'')+'&focus='+encodeURIComponent(id)); load(); }
function leaveFocus(){ state.focus=state.focusStack.pop()||null; state.sel=null; state.open=[]; history.replaceState(null,'',location.pathname+'?board='+encodeURIComponent(qs.get('board')||'')+(state.focus?'&focus='+encodeURIComponent(state.focus):'')); load(); }
async function load(){
  const name=qs.get('board')||'';
  const [b,svg,ps]=await Promise.all([fetch('./board.json?board='+name+fq()).then(r=>r.json()),fetch('./board.svg?board='+name+fq()+'&open='+state.open.join(',')+'&level='+state.level).then(r=>r.text()),fetch('./proposals?board='+name).then(r=>r.json())]);
  state.board=b; state.svg=svg; state.proposals=ps; render();
}
function render(){
  const b=state.board; document.title=b.title+' · staves';
  $('#title').innerHTML=(state.focus?'<a href="#" id="unfocus" style="color:var(--mute);font-weight:400;text-decoration:none">'+esc(state.focusStack.length?'…':'the board')+'</a> <span style="color:var(--mute)">›</span> ':'')+esc(b.title); const uf=$('#unfocus'); if(uf) uf.onclick=e=>{e.preventDefault();leaveFocus();}; $('#goal').textContent=b.goal||'';
  $$('[data-lvl]').forEach(x=>x.classList.toggle('on',Number(x.dataset.lvl)===state.level));
  const stage=$('#stage'); const sl=$('#canvas').scrollLeft, st=$('#canvas').scrollTop;
  stage.innerHTML=state.svg; $('#canvas').scrollLeft=sl; $('#canvas').scrollTop=st;
  const svg=$('svg',stage); if(svg){ svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width=svg.viewBox.baseVal.width+'px'; }
  $$('.job',stage).forEach(g=>{
    const id=g.dataset.job;
    let pt, quiet=false; g.addEventListener('mouseenter',e=>{ quiet=false; const ev={clientX:e.clientX,clientY:e.clientY}; pt=setTimeout(()=>{ if(!quiet&&!drag) peek(id,ev); },260); }); g.addEventListener('mousemove',e=>{ if($('#peek').style.display==='block') movePeek(e); }); g.addEventListener('mouseleave',()=>{ clearTimeout(pt); hidePeek(); }); g.addEventListener('mousedown',()=>{ quiet=true; clearTimeout(pt); hidePeek(); });
    g.addEventListener('click',e=>{e.stopPropagation();hidePeek(); if(e.shiftKey){state.multi.has(id)?state.multi.delete(id):state.multi.add(id); applySel();} else {state.multi.clear(); select(id);} });
    g.addEventListener('dblclick',e=>{e.stopPropagation();hidePeek(); const j=job(id); if(g.dataset.composite){ toggleOpen(id); } else if(j.parent){ state.open=state.open.filter(x=>x!==j.parent); reload(); state.sel=j.parent; } });
    g.addEventListener('mousedown',e=>{ if(e.button!==0||e.shiftKey) return; dragStart(id,e); });
  });
  $$('.track-bg',stage).forEach(r=>{ r.addEventListener('dblclick',e=>{ e.stopPropagation(); addJobOn(r.dataset.track); }); });
  if(state.plain){ const sys=new Set(b.tracks.filter(t=>t.kind==='system').map(t=>t.id)); const hidden=new Set(live().filter(j=>sys.has(j.track)).map(j=>j.id));
    $$('.job',stage).forEach(g=>{ if(sys.has(g.dataset.track)) g.style.display='none'; }); $$('path.wire',stage).forEach(p=>{ if(hidden.has(p.dataset.from)||hidden.has(p.dataset.to)) p.style.display='none'; });
    $$('.track-bg',stage).forEach(r=>{ if(sys.has(r.dataset.track)){ r.style.display='none'; const y=Number(r.getAttribute('y')); $$('text,use',stage).forEach(t=>{ const ty=Number(t.getAttribute('y')||0); if(!t.closest('.job')&&ty>=y&&ty<=y+Number(r.getAttribute('height'))+4) t.style.display='none'; }); } }); }
  applySel(); $('#app').classList.add('rail'); if(state.sel&&job(state.sel)&&!job(state.sel).removed) rail(state.sel); else { state.sel=null; boardRail(); }
  $('#empty').style.display = live().length? 'none':'grid';
  renderQueue();
  const stl=b.stale||[]; const ban=$('#stale'); ban.style.display=stl.length?'block':'none'; ban.textContent=stl.length+' job'+(stl.length>1?'s have':' has')+' code changes since described — ask the agent: re-describe what staves_stale lists';
  $$('[data-region]',stage).forEach(r=>{ r.addEventListener('dblclick',e=>{ e.stopPropagation(); addTaskIn(r.dataset.region); }); });
}
function reload(){ history.replaceState(null,'','?'+new URLSearchParams({board:state.board.id,open:state.open.join(','),level:String(state.level)}).toString().replace(/open=&/,'').replace(/&open=$/,'')); load(); }
function toggleOpen(id){ if(state.level===2){ state.level=1; state.open=live().filter(j=>j.id!==id&&live().some(x=>x.parent===j.id)).map(j=>j.id); state.sel=id; reload(); return; } state.open = state.open.includes(id)? state.open.filter(x=>x!==id) : [...state.open,id]; state.sel=id; reload(); }
function clipActions(){ const bar=$('#clipbar'); const sel=state.sel; if(!sel||state.plain){ bar.style.display='none'; return; } const g=$('.job[data-job="'+CSS.escape(sel)+'"]'); if(!g){ bar.style.display='none'; return; }
  const j=job(sel); const r=g.querySelector('rect.clip').getBoundingClientRect(); const c=$('#canvas').getBoundingClientRect();
  const kids=live().some(x=>x.parent===sel);
  bar.innerHTML=(kids?'<button data-cb="open">'+(state.open.includes(sel)?'close':'open')+'</button><button data-cb="focus">focus</button>':'')+'<button data-cb="split">split</button>'+(j.parent?'<button data-cb="out">take out</button>':'')+'<button data-cb="comment">comment</button>'+'<button data-cb="ask">ask the agent</button>';
  bar.style.display='flex'; bar.style.left=Math.max(c.left+8, r.left)+'px'; bar.style.top=(r.top-34)+'px';
  $$('[data-cb]',bar).forEach(b=>b.onclick=e=>{ e.stopPropagation(); const a=b.dataset.cb; if(a==='open') toggleOpen(sel); else if(a==='focus') enterFocus(sel); else if(a==='split') splitJob(sel); else if(a==='out') op([{t:'updateJob',id:sel,patch:{parent:null}}]); else if(a==='comment'){ state.tab='comments'; rail(sel); $('#cm-text')?.focus(); } else if(a==='ask') action('deepen',sel); }); }
function applySel(){
  const svg=$('#stage svg'); if(!svg) return; const sel=state.sel; clipActions();
  $$('.job',svg).forEach(g=>{ g.classList.toggle('sel', g.dataset.job===sel||state.multi.has(g.dataset.job)); g.classList.remove('near'); });
  $$('path.wire',svg).forEach(p=>p.classList.remove('near'));
  svg.classList.toggle('dim', !!sel && !state.multi.size);
  if(sel) $$('path.wire',svg).forEach(p=>{ if(p.dataset.from===sel||p.dataset.to===sel){ p.classList.add('near'); const o=p.dataset.from===sel?p.dataset.to:p.dataset.from; const g=$('.job[data-job="'+CSS.escape(o)+'"]',svg); if(g) g.classList.add('near'); } });
  $('#collect').classList.toggle('on', state.multi.size>=2);
  $('#collect').textContent='Collect '+state.multi.size+' into a job';
}
function select(id){ state.sel=id; $('#app').classList.add('rail'); if(id) rail(id); else boardRail(); applySel(); }
function peek(id,e){ const j=job(id); if(!j) return; const t=track(j.track); const p=$('#peek'); const pins=(state.board.findings||[]).filter(f=>f.about===id&&f.rule!=='account-missing');
  p.innerHTML='<h3>'+esc(j.name)+'</h3><div class="mut">'+esc(t?.name||'')+(j.trigger?' · starts when '+TRIG[j.trigger]:'')+'</div>'
   +(j.outcome?'<div class="k">what is different when it\'s done</div><div>'+esc(j.outcome)+'</div>':'<div class="k warn">no outcome yet — nobody has said what this achieves</div>')
   +(j.beneficiary?'<div class="k">who is waiting on it</div><div>'+esc(j.beneficiary)+'</div>':'')
   +(j.doneWhen?.length?'<div class="k">done when</div><div>'+j.doneWhen.map(esc).join(' · ')+'</div>':'')
   +(pins.length?'<div class="k warn">findings</div>'+pins.map(f=>'<div class="warnt">'+esc(f.message)+'</div>').join(''):'')
   +'<div class="k">said by</div><div class="'+(j.provenance.source==='agent'?'warnt':'sealt')+'">'+j.provenance.source+(j.provenance.by?' · '+esc(j.provenance.by):'')+(j.status==='draft'?' · unconfirmed':'')+'</div>';
  p.style.display='block'; movePeek(e); }
function movePeek(e){ const p=$('#peek'); p.style.left=Math.min(window.innerWidth-370,e.clientX+16)+'px'; p.style.top=Math.min(window.innerHeight-p.offsetHeight-12,e.clientY+16)+'px'; }
function hidePeek(){ $('#peek').style.display='none'; }
/* ---- drag a clip to another track = move ---- */
let drag=null;
function dragStart(id,e){ const g=e.currentTarget; drag={id,g,x:e.clientX,y:e.clientY,moved:false}; }
window.addEventListener('mousemove',e=>{ if(!drag) return; const dy=e.clientY-drag.y, dx=e.clientX-drag.x; if(Math.abs(dy)>6||Math.abs(dx)>6) drag.moved=true; if(drag.moved){ drag.g.style.transform='translate('+dx+'px,'+dy+'px)'; drag.g.style.opacity=.7; hidePeek(); const t=trackAt(e.clientY); $$('.track-bg').forEach(r=>r.classList.toggle('drop', r.dataset.track===t)); const rg=regionAt(e.clientX,e.clientY); $$('[data-region]').forEach(r=>r.classList.toggle('drop', r.dataset.region===rg));
    const j=job(drag.id); const lbl=$('#draglabel'); let txt='';
    if(rg&&rg!==j.parent&&rg!==drag.id) txt='join '+(job(rg)?.name||rg); else if(!rg&&j.parent&&state.open.includes(j.parent)) txt='take out of '+(job(j.parent)?.name||''); else if(t&&t!==j.track) txt='move to '+(track(t)?.name||t); else if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*2) txt='reorder'; 
    lbl.textContent=txt; lbl.style.display=txt?'block':'none'; lbl.style.left=(e.clientX+14)+'px'; lbl.style.top=(e.clientY+14)+'px'; } });
window.addEventListener('mouseup',async e=>{ if(!drag) return; const d=drag; drag=null; d.g.style.transform=''; d.g.style.opacity=''; $$('.track-bg').forEach(r=>r.classList.remove('drop')); $$('[data-region]').forEach(r=>r.classList.remove('drop')); $('#draglabel').style.display='none'; if(!d.moved) return;
  const t=trackAt(e.clientY); const j=job(d.id); if(!j) return; const region=regionAt(e.clientX,e.clientY); const patch={};
  // mostly horizontal, staying in place: reorder among siblings by where it was dropped
  const dx=e.clientX-d.x, dy=e.clientY-d.y;
  if(Math.abs(dx)>40 && Math.abs(dx)>Math.abs(dy)*2 && (region||null)===(j.parent||null)){
    const peers=$$('.job').filter(g=>g.dataset.job!==d.id && (g.dataset.parent||null)===(j.parent||null)).map(g=>({id:g.dataset.job,x:g.querySelector('rect.clip').getBoundingClientRect().left}));
    if(peers.length){ const drop=e.clientX; const rightOf=peers.filter(p=>p.x>drop).sort((a,b)=>a.x-b.x)[0]; const leftOf=peers.filter(p=>p.x<=drop).sort((a,b)=>b.x-a.x)[0];
      const o = rightOf? {t:'reorder',id:d.id,before:rightOf.id} : {t:'reorder',id:d.id,after:leftOf.id};
      if(t&&t!==j.track) await op([o,{t:'updateJob',id:d.id,patch:{track:t}}]); else await op([o]); state.sel=d.id; return; } }
  if(t&&t!==j.track) patch.track=t;
  if(region&&region!==j.parent&&region!==d.id){ patch.parent=region; }            // dropped inside an open job: joins it
  else if(!region&&j.parent&&state.open.includes(j.parent)) { patch.parent=null; }      // dragged out of its open job: leaves it
  if(Object.keys(patch).length){ await op([{t:'updateJob',id:d.id,patch}]); state.sel=d.id; } });
function regionAt(x,y){ for(const r of $$('[data-region]')){ const b=r.getBoundingClientRect(); if(x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom) return r.dataset.region; } return null; }
function trackAt(clientY){ for(const r of $$('.track-bg')){ const b=r.getBoundingClientRect(); if(clientY>=b.top&&clientY<=b.bottom) return r.dataset.track; } return null; }
/* ---- collect ---- */
$('#collect').addEventListener('click',()=>{ const ids=[...state.multi]; const kids=ids.map(job); const gated=kids.filter(k=>k.gate&&k.gate.accountable!=='rule'); const tools=kids.flatMap(k=>k.tools||[]).filter(t=>t.reach==='screen'||t.reach==='none');
  const html='<h2>Collect '+ids.length+' into a job</h2><div class="f"><label>Name</label><div class="q">what it achieves, in a few words</div><input id="c-name" placeholder="e.g. Trace the chain"></div><div class="f"><label>On</label><div class="q">who performs it</div><select id="c-track">'+state.board.tracks.filter(t=>!t.removed).map(t=>'<option value="'+t.id+'">'+esc(t.name)+' ('+t.kind+')</option>').join('')+'</select></div>'
   +(gated.length?'<div class="pinq warnbox">'+gated.map(k=>'“'+esc(k.name)+'” is where a person decides. Collecting it into an agent\'s job would swallow the gate — keep the decision on the person\'s track.').join('<br>')+'</div>':'')
   +(tools.length?'<div class="pinq">Tools an agent cannot reach: '+tools.map(t=>esc(t.name)+' ('+t.reach+')').join(', ')+'. The run stays collectable, but these become escalations.</div>':'')
   +'<button class="btn seal" id="c-go">Collect</button> <button class="btn" onclick="closeModal()">Cancel</button>';
  modal(html); $('#c-go').onclick=async()=>{ const name=$('#c-name').value.trim(); if(!name) return; const id=slug(name); closeModal(); await op([{t:'collect',id,name,track:$('#c-track').value,into:ids}]); state.multi.clear(); select(id); };
});
/* ---- add / split / rail actions ---- */
function addJobOn(trackId){ const t=track(trackId); modal('<h2>Add a job on '+esc(t.name)+'</h2><div class="f"><label>Name</label><div class="q">what it achieves, in a few words</div><input id="a-name"></div><div class="f"><label>Starts when</label><div class="q">what makes this happen</div><select id="a-trig">'+Object.entries(TRIG).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select></div><button class="btn seal" id="a-go">Add</button> <button class="btn" onclick="closeModal()">Cancel</button>');
  $('#a-go').onclick=async()=>{ const name=$('#a-name').value.trim(); if(!name) return; const id=slug(name); closeModal(); await op([{t:'job',job:{id,name,track:trackId,trigger:$('#a-trig').value,inputs:[],outputs:[],provenance:{source:'human',by:'human'},status:'confirmed'}}]); select(id); }; $('#a-name').focus(); }
function addTaskIn(parentId){ const pj=job(parentId); modal('<h2>Add a task inside “'+esc(pj.name)+'”</h2><div class="f"><label>Name</label><div class="q">what it achieves, in a few words</div><input id="k-name"></div><div class="f"><label>On</label><select id="k-track">'+state.board.tracks.filter(t=>!t.removed).map(t=>'<option value="'+t.id+'" '+(t.id===pj.track?'selected':'')+'>'+esc(t.name)+'</option>').join('')+'</select></div><button class="btn seal" id="k-go">Add</button> <button class="btn" onclick="closeModal()">Cancel</button>');
  $('#k-go').onclick=async()=>{ const name=$('#k-name').value.trim(); if(!name) return; const id=parentId+':'+slug(name); closeModal(); await op([{t:'job',job:{id,name,track:$('#k-track').value,parent:parentId,trigger:'chain',inputs:[],outputs:[],provenance:{source:'human',by:'human'},status:'confirmed'}}]); select(id); }; $('#k-name').focus(); }
function addTrack(){ modal('<h2>Add a track</h2><div class="f"><label>Name</label><div class="q">a role, an agent, a service, or an outside party</div><input id="t-name"></div><div class="f"><label>Kind</label><select id="t-kind"><option>person</option><option>agent</option><option>system</option><option>outside</option></select></div><div class="f"><label>One line</label><div class="q">what this performer is for, or what is unknown about it</div><input id="t-meta"></div><button class="btn seal" id="t-go">Add</button> <button class="btn" onclick="closeModal()">Cancel</button>');
  $('#t-go').onclick=async()=>{ const name=$('#t-name').value.trim(); if(!name) return; closeModal(); await op([{t:'track',track:{id:slug(name),name,kind:$('#t-kind').value,meta:$('#t-meta').value||undefined}}]); }; $('#t-name').focus(); }
function splitJob(id){ const j=job(id); modal('<h2>Split “'+esc(j.name)+'” into tasks</h2><div class="f"><label>Tasks</label><div class="q">one per line, in order, each named by what it achieves</div><textarea id="s-tasks" rows="6"></textarea></div><button class="btn seal" id="s-go">Split</button> <button class="btn" onclick="closeModal()">Cancel</button>');
  $('#s-go').onclick=async()=>{ const lines=$('#s-tasks').value.split('\n').map(x=>x.trim()).filter(Boolean); if(!lines.length) return; closeModal(); await op([{t:'split',id,tasks:lines.map(n=>({id:id+':'+slug(n),name:n}))}]); state.open=[...new Set([...state.open,id])]; state.sel=id; reload(); }; $('#s-tasks').focus(); }
function modal(html){ $('#modal').innerHTML='<div class="sheet">'+html+'</div>'; $('#modal').style.display='grid'; }
function closeModal(){ $('#modal').style.display='none'; }
window.closeModal=closeModal;
/* ---- rail ---- */
function fieldHtml(j,key,label,q,value,kind){
  const said=j.confirmedFields?.includes(key)?'confirmed':j.provenance.source; const empty=!value;
  const ctl=kind==='area'?'<textarea data-field="'+key+'" class="'+(empty?'empty':'')+'" placeholder="'+esc(q)+'">'+esc(value)+'</textarea>':'<input data-field="'+key+'" class="'+(empty?'empty':'')+'" value="'+esc(value)+'" placeholder="'+esc(q)+'">';
  return '<div class="f"><label>'+label+'</label><div class="q">'+esc(q)+'</div>'+ctl+'<div class="said '+(said==='confirmed'||said==='human'?'human':'')+'">'+(value?'said by '+said:'')+(value&&said!=='confirmed'?' <button class="btn seal tiny" data-confirm="'+key+'">confirm</button>':'')+'</div></div>';
}
function rail(id){ $('#rail').classList.remove('settle'); void $('#rail').offsetWidth; $('#rail').classList.add('settle');
  const j=job(id); if(!j) return; const t=track(j.track); const kids=live().filter(x=>x.parent===id); const parent=j.parent?job(j.parent):null;
  const qsOpen=state.board.questions.filter(q=>q.about===id&&!q.answer); const props=state.proposals.filter(p=>(p.op.id===id)||(p.op.job&&p.op.job.id===id)||(p.op.comment&&p.op.comment.about===id));
  const comments=state.board.comments.filter(c=>c.about===id);
  const exits=(j.exits||[]).map((e,i)=>'<div class="exit '+(e.target?'':'dangling')+'"><input data-exit="'+i+'" data-k="condition" value="'+esc(e.condition)+'"><span class="arrow">→</span><select data-exit="'+i+'" data-k="target"><option value="">nothing says where this goes</option><option value="stop" '+(e.target==='stop'?'selected':'')+'>stops</option>'+live().filter(x=>!x.parent&&x.id!==id).map(x=>'<option value="'+x.id+'" '+(e.target===x.id?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></div>').join('');
  const r=$('#rail');
  r.innerHTML='<div class="crumb"><a href="#" data-board="1">the board</a> › '+(parent?'<a href="#" data-go="'+parent.id+'">'+esc(parent.name)+'</a> › ':'')+esc(t?.name||'')+(kids.length?' · '+kids.length+' tasks · <a href="#" data-open="'+id+'">'+(state.open.includes(id)?'close':'open')+'</a>':'')+'</div>'
   +'<h2>'+esc(j.name)+'</h2><div class="who">on '+esc(t?.name||'')+(j.trigger?' · starts when '+TRIG[j.trigger]:'')+' · <span class="'+(j.provenance.source==='agent'?'warnt':'sealt')+'">'+j.provenance.source+(j.status==='draft'?', unconfirmed':'')+'</span></div>'
   +'<div class="tabs">'+['account','comments','log'].map(k=>'<span data-tab="'+k+'" class="'+(state.tab===k?'on':'')+'">'+(k==='comments'?'Comments · '+comments.length:k==='log'?'Log':'Account')+'</span>').join('')+'</div>'
   +(state.tab==='account'?accountTab(j,t,qsOpen,props,exits):state.tab==='comments'?commentsTab(id,comments):logTab(id));
  $$('[data-tab]',r).forEach(e=>e.onclick=()=>{state.tab=e.dataset.tab;rail(id);});
  $$('[data-src]',r).forEach((e,i)=>e.onclick=async()=>{ const pre=$('#src'+i,r); if(pre.style.display==='block'){ pre.style.display='none'; return; } pre.textContent='…'; pre.style.display='block'; const t=await (await fetch('./source?path='+encodeURIComponent(e.dataset.src)+(e.dataset.sym?'&symbol='+encodeURIComponent(e.dataset.sym):''))).text(); pre.textContent=t; });
  $$('[data-go]',r).forEach(e=>e.onclick=ev=>{ev.preventDefault();state.open=state.open.filter(x=>x!==e.dataset.go);state.sel=e.dataset.go;reload();});
  $$('[data-board]',r).forEach(e=>e.onclick=ev=>{ev.preventDefault();state.multi.clear();select(null);});
  $$('[data-open]',r).forEach(e=>e.onclick=ev=>{ev.preventDefault();toggleOpen(e.dataset.open);});
  $$('[data-field]',r).forEach(el=>el.addEventListener('change',async()=>{ const k=el.dataset.field; let v=el.value.trim(); const patch={}; patch[k]= k==='doneWhen'? v.split(/;|\n/).map(x=>x.trim()).filter(Boolean) : (v||undefined); await op([{t:'updateJob',id,patch}]); }));
  $$('[data-confirm]',r).forEach(el=>el.onclick=async()=>{ await op([{t:'confirmField',id,field:el.dataset.confirm,by:'human'}]); });
  $$('[data-exit]',r).forEach(el=>el.addEventListener('change',async()=>{ const ex=JSON.parse(JSON.stringify(j.exits||[])); const i=Number(el.dataset.exit); ex[i][el.dataset.k]=el.value||undefined; await op([{t:'updateJob',id,patch:{exits:ex}}]); }));
  $$('[data-act]',r).forEach(el=>el.onclick=()=>action(el.dataset.act,id,el));
  $$('[data-answer]',r).forEach(el=>el.onclick=async()=>{ const ta=$('[data-q="'+CSS.escape(el.dataset.answer)+'"]',r); const v=ta.value.trim(); if(!v) return; await op([{t:'answer',id:el.dataset.answer,answer:v,by:'human'}]); });
  $$('[data-accept]',r).forEach(el=>el.onclick=async()=>{ await op([{t:'accept',seq:Number(el.dataset.accept)}]); });
  $$('[data-reject]',r).forEach(el=>el.onclick=async()=>{ await op([{t:'reject',seq:Number(el.dataset.reject)}]); });
  $$('[data-trig]',r).forEach(el=>el.onclick=async()=>{ await op([{t:'updateJob',id,patch:{trigger:el.dataset.trig}}]); });
}
function accountTab(j,t,qsOpen,props,exits){ const id=j.id;
  const hand=(state.board.findings||[]).filter(f=>f.about===id&&f.rule==='handover');
  return (hand.length?'<div class="pinq"><div class="by">handover — until you confirm</div>'+hand.map(f=>'<div class="small" style="margin:3px 0">'+esc(f.message.replace(/^"[^"]*" moved from [^:]*: /,''))+'</div>').join('')+'<button class="btn seal tiny" data-act="confirmMove">the move stands</button></div>':'')
   +qsOpen.map(q=>'<div class="pinq"><div class="by">'+q.askedBy+' asks</div>'+esc(q.text)+'<textarea data-q="'+esc(q.id)+'" rows="2" placeholder="Answer in place. Recorded as yours."></textarea><button class="btn seal" data-answer="'+esc(q.id)+'">Answer</button></div>').join('')
   +props.map(p=>'<div class="pinq prop"><div class="by">'+esc(p.by)+' proposes</div>'+esc(propLine(p))+'<div><button class="btn seal tiny" data-accept="'+p.seq+'">Accept</button><button class="btn tiny" data-reject="'+p.seq+'">Reject</button></div></div>').join('')
   +'<div class="sect">The account</div>'
   +fieldHtml(j,'name','Name','what it achieves, in a few words',j.name)
   +fieldHtml(j,'outcome','Outcome','what is different when this is done?',j.outcome,'area')
   +fieldHtml(j,'beneficiary','For','who is waiting on it, and what do they do with it?',j.beneficiary)
   +fieldHtml(j,'doneWhen','Done when','what would you check to know it is done? (one per line)',(j.doneWhen||[]).join('\n'),'area')
   +'<div class="sect">How it runs</div>'
   +'<div class="f"><label>Starts when</label><div class="q">what makes this job happen</div><div class="trigs">'+Object.entries(TRIG).map(([k,v])=>'<button class="btn tiny '+(j.trigger===k?'on':'')+'" data-trig="'+k+'">'+v+'</button>').join('')+'</div></div>'
   +'<div class="f"><label>Takes → produces</label><div class="q">what changes hands; handoffs are drawn from these</div><div>'+(j.inputs.map(a=>'<span class="chip mut">'+esc(art(a)?.name||a)+'</span>').join('')||'<span class="mut">nothing</span>')+' <span class="mut">→</span> '+(j.outputs.map(a=>'<span class="chip">'+esc(art(a)?.name||a)+'</span>').join('')||'<span class="mut">nothing</span>')+' <button class="btn tiny" data-act="io">edit</button></div></div>'
   +'<div class="f"><label>Gate</label><div class="q">what decides here, and who answers for it</div>'+(j.gate?'<input data-field="gate.rule" value="'+esc(j.gate.rule)+'" disabled><div class="said">'+(j.gate.accountable==='rule'?'a rule decides'+(j.gate.ruleOwner?' · owner: '+esc(j.gate.ruleOwner):' · <span class="warnt">no owner named</span>'):esc(track(j.gate.accountable)?.name||'nobody')+' is accountable')+' <button class="btn tiny" data-act="gate">edit</button></div>':'<button class="btn tiny" data-act="gate">add a gate</button>')+'</div>'
   +'<div class="f"><label>Exits</label><div class="q">every way out, and where each one goes</div>'+exits+'<button class="btn tiny" data-act="exit">add an exit</button></div>'
   +'<div class="f"><label>Loops back</label><div class="q">to what, how many times, then what</div>'+(j.loop?'<div>to '+esc(job(j.loop.to)?.name||j.loop.to)+(j.loop.limit?' · up to '+j.loop.limit:' · <span class="warnt">no limit</span>')+(j.loop.then?' · then '+esc(j.loop.then):'')+' <button class="btn tiny" data-act="loop">edit</button></div>':'<button class="btn tiny" data-act="loop">add a loop</button>')+'</div>'
   +((j.instructions||[]).length?'<div class="sect">Instructions it works from</div>'+j.instructions.map((x,i)=>'<div class="f"><div class="chip" style="cursor:pointer" data-src="'+esc(x.path)+'" data-sym="'+esc(x.symbol||'')+'">'+esc(x.path)+(x.symbol?' · '+esc(x.symbol):'')+'</div>'+(x.summary?'<div class="mut small" style="margin-top:4px">'+esc(x.summary)+'</div>':'')+'<pre class="src" id="src'+i+'" style="display:none"></pre></div>').join(''):'')
   +'<div class="sect">Tools, examples, time</div>'
   +'<div class="f"><label>Tools</label><div class="q">what the performer has open, and whether an agent could reach it</div>'+(j.tools||[]).map(x=>'<div class="toolrow"><span class="chip '+(x.reach==='screen'||x.reach==='none'?'screen':'')+' '+(x.personal?'personal':'')+'">'+esc(x.name)+' · '+x.reach+'</span>'+(x.does?'<div class="mut small">returns: '+esc(x.does)+'</div>':'')+(x.limits?'<div class="mut small">leaves out: '+esc(x.limits)+'</div>':'<div class="warnt small">what it leaves out: nobody has said</div>')+'</div>').join('')+' <button class="btn tiny" data-act="tool">add</button></div>'
   +'<div class="f"><label>Examples</label><div class="q">one input as it arrived, and what it became</div>'+(j.examples||[]).map(x=>'<div class="small"><span class="chip mut">'+esc(x.in)+'</span> → <span class="chip">'+esc(x.out)+'</span>'+(x.note?' <span class="mut">'+esc(x.note)+'</span>':'')+'</div>').join('')+' <button class="btn tiny" data-act="example">add</button></div>'
   +'<div class="f"><label>Checks</label><div class="q">what this task checks, and what happens when a check fails</div>'+(j.checks||[]).map(x=>'<div class="small">'+esc(x.rule)+' <span class="mut">— on failure: '+(x.onFail?esc(x.onFail):'<span class="warnt">not said</span>')+'</span></div>').join('')+' <button class="btn tiny" data-act="check">add</button></div>'
   +'<div class="f"><label>Time</label><div class="q">the performer\'s minutes per instance, and instances a week if different from the board</div><div class="row"><input data-field="minutes" value="'+(j.minutes??'')+'" placeholder="minutes" style="width:9ch"><input data-field="perWeek" value="'+(j.perWeek??'')+'" placeholder="per week" style="width:9ch"></div></div>'
   +'<div class="acts sticky"><button class="btn seal" data-act="confirmAll">Confirm all</button><button class="btn" data-act="split">Split into tasks</button><button class="btn" data-act="deepen">Ask the agent to break this down</button>'+(j.parent?'<button class="btn" data-act="uncollect">Take out of its job</button>':'')+(live().some(x=>x.parent===id)?'<button class="btn" data-act="dissolve">Dissolve the job</button>':'')+'<button class="btn warn" data-act="remove">Remove</button></div>';
}
function propLine(p){ const o=p.op; const n=id=>job(id)?.name||id; const cur=id=>job(id)||{}; const show=v=>v===undefined?'(none)':Array.isArray(v)?v.join('; '):typeof v==='object'?JSON.stringify(v):String(v);
  if(o.t==='job'){ const c=cur(o.job.id); const diffs=['name','outcome','beneficiary','doneWhen','track','trigger'].filter(k=>JSON.stringify(c[k])!==JSON.stringify(o.job[k])); return 'redescribe “'+n(o.job.id)+'”: '+(diffs.map(k=>k+': '+show(c[k])+' → '+show(o.job[k])).join(' · ')||'no field changes'); }
  if(o.t==='updateJob'){ const c=cur(o.id); return 'change “'+n(o.id)+'”: '+Object.entries(o.patch).map(([k,v])=>k+': '+show(k==='track'?track(c[k])?.name:c[k])+' → '+show(k==='track'?track(v)?.name:v)).join(' · '); }
  if(o.t==='removeJob') return 'remove “'+n(o.id)+'”'; if(o.t==='collect') return 'collect '+o.into.map(n).join(', ')+' into “'+o.name+'” on '+(track(o.track)?.name||o.track); if(o.t==='comment') return '— '+o.comment.text; return o.t; }
function commentsTab(id,comments){ const roots=comments.filter(c=>!c.replyTo); const replies=c=>comments.filter(r=>r.replyTo===c.id);
  return roots.map(c=>'<div class="cmt"><div class="by '+(c.by==='human'?'sealt':'warnt')+'">'+esc(c.by)+(c.at?' · '+c.at.slice(0,10):'')+'</div>'+esc(c.text)+replies(c).map(r=>'<div class="reply"><div class="by warnt">'+esc(r.by)+' replies</div>'+esc(r.text)+'</div>').join('')+(c.by==='human'&&!replies(c).length?'<div class="mut small">awaiting the agent — say “discuss staves” or /mcp__staves__discuss</div>':'')+'</div>').join('')+'<div class="f"><textarea id="cm-text" rows="3" placeholder="Say it. Facts about the work go in the fields; this is for discussion."></textarea><button class="btn" data-act="comment">Comment</button></div>'; }
function logTab(id){ fetch('./log?board='+encodeURIComponent(state.board.id)+'&id='+encodeURIComponent(id)).then(r=>r.json()).then(es=>{ const el=$('#log'); if(!el) return; el.innerHTML=es.slice().reverse().map(e=>'<div class="cmt"><div class="by mut">'+esc(e.by)+' · '+esc(e.at.slice(0,16).replace('T',' '))+(e.pending?' · <span class="warnt">proposal</span>':'')+'</div>'+esc(opLine(e.op))+'</div>').join('')||'<div class="mut">nothing yet</div>'; }); return '<div id="log" class="mut">loading…</div>'; }
function opLine(o){ const n=id=>job(id)?.name||id; switch(o.t){ case 'job': return 'described “'+o.job.name+'”'; case 'updateJob': return 'changed '+Object.entries(o.patch).map(([k,v])=>k+' → '+(v===undefined?'(cleared)':JSON.stringify(v))).join(', '); case 'confirmField': return 'confirmed '+o.field; case 'confirm': return 'confirmed the whole account'; case 'answer': return 'answered: '+o.answer; case 'ask': return 'asked: '+o.question.text; case 'comment': return 'commented: '+o.comment.text; case 'split': return 'split into '+o.tasks.length+' tasks'; case 'collect': return 'collected '+o.into.length+' into “'+o.name+'”'; case 'removeJob': return 'removed'; case 'accept': return 'accepted proposal #'+o.seq; case 'reject': return 'rejected proposal #'+o.seq; default: return o.t; } }
async function action(a,id,el){ const j=job(id);
  if(a==='confirmAll') return op([{t:'confirm',id,by:'human'}]);
  if(a==='confirmMove') return op([{t:'updateJob',id,patch:{movedFrom:null}}]);
  if(a==='remove') { if(!confirm('Remove “'+j.name+'”? It is kept in the log as a tombstone.')) return; state.sel=null; return op([{t:'removeJob',id}]); }
  if(a==='split') return splitJob(id);
  if(a==='deepen') return op([{t:'ask',question:{id:'q:deepen:'+id+':'+Date.now(),about:id,askedBy:'human',text:'Break “'+j.name+'” down so a stranger could do it by hand and get the same result and the same failures: what arrives, what you open, what you look at and how far, what you look for, what you do with it, when you stop, what you do when it isn\'t there or disagrees. For every tool: what comes back, and what doesn\'t.',at:new Date().toISOString()}}]);
  if(a==='uncollect') return op([{t:'updateJob',id,patch:{parent:null}}]);
  if(a==='dissolve') return op([{t:'uncollect',id}]);
  if(a==='comment') { const v=$('#cm-text').value.trim(); if(!v) return; return op([{t:'comment',comment:{id:'c:'+Date.now(),about:id,by:'human',text:v,at:new Date().toISOString()}}]); }
  if(a==='exit') return op([{t:'updateJob',id,patch:{exits:[...(j.exits||[]),{condition:'…'}]}}]);
  if(a==='gate') { modal('<h2>Gate on “'+esc(j.name)+'”</h2><div class="f"><label>The rule</label><div class="q">in words: “no source, no claim”</div><input id="g-rule" value="'+esc(j.gate?.rule||'')+'"></div><div class="f"><label>Who answers for it</label><div class="q">a person, or a rule with a named owner</div><select id="g-acc"><option value="rule">a rule decides</option>'+state.board.tracks.filter(t=>t.kind==='person').map(t=>'<option value="'+t.id+'" '+(j.gate?.accountable===t.id?'selected':'')+'>'+esc(t.name)+'</option>').join('')+'</select></div><div class="f"><label>Rule owner</label><div class="q">if a rule decides, who owns the rule</div><input id="g-own" value="'+esc(j.gate?.ruleOwner||'')+'"></div><button class="btn seal" id="g-go">Save</button> <button class="btn" onclick="closeModal()">Cancel</button>'+(j.gate?' <button class="btn warn" id="g-rm">Remove gate</button>':''));
    $('#g-go').onclick=async()=>{ const rule=$('#g-rule').value.trim(); if(!rule) return; closeModal(); await op([{t:'updateJob',id,patch:{gate:{rule,accountable:$('#g-acc').value,ruleOwner:$('#g-own').value||undefined}}}]); }; if($('#g-rm')) $('#g-rm').onclick=async()=>{closeModal();await op([{t:'updateJob',id,patch:{gate:undefined}}]);}; return; }
  if(a==='loop') { modal('<h2>Loop from “'+esc(j.name)+'”</h2><div class="f"><label>Back to</label><select id="l-to">'+live().filter(x=>!x.parent).map(x=>'<option value="'+x.id+'" '+(j.loop?.to===x.id?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></div><div class="f"><label>Limit</label><div class="q">how many times before it stops trying</div><input id="l-lim" value="'+(j.loop?.limit||'')+'"></div><div class="f"><label>Then what</label><div class="q">where it goes when the limit is hit</div><input id="l-then" value="'+esc(j.loop?.then||'')+'"></div><button class="btn seal" id="l-go">Save</button> <button class="btn" onclick="closeModal()">Cancel</button>'+(j.loop?' <button class="btn warn" id="l-rm">Remove loop</button>':''));
    $('#l-go').onclick=async()=>{ closeModal(); await op([{t:'updateJob',id,patch:{loop:{to:$('#l-to').value,limit:Number($('#l-lim').value)||undefined,then:$('#l-then').value||undefined}}}]); }; if($('#l-rm')) $('#l-rm').onclick=async()=>{closeModal();await op([{t:'updateJob',id,patch:{loop:undefined}}]);}; return; }
  if(a==='tool') { modal('<h2>Tool on “'+esc(j.name)+'”</h2><div class="f"><label>Name</label><input id="tl-name"></div><div class="f"><label>Reach</label><div class="q">could an agent get to it?</div><select id="tl-reach"><option>api</option><option>mcp</option><option>screen</option><option>none</option></select></div><div class="f"><label>What it returns here</label><div class="q">as a person would say it: “the article intro, not the sections”</div><input id="tl-does"></div><div class="f"><label>What it leaves out</label><div class="q">characters, sections, results, timeouts, sampling — or “unknown”</div><input id="tl-lim"></div><div class="f"><label><input type="checkbox" id="tl-pers"> personal — a spreadsheet, a file, a colleague</label></div><button class="btn seal" id="tl-go">Add</button> <button class="btn" onclick="closeModal()">Cancel</button>');
    $('#tl-go').onclick=async()=>{ const name=$('#tl-name').value.trim(); if(!name) return; closeModal(); await op([{t:'updateJob',id,patch:{tools:[...(j.tools||[]),{name,reach:$('#tl-reach').value,personal:$('#tl-pers').checked||undefined,does:$('#tl-does').value||undefined,limits:$('#tl-lim').value||undefined}]}}]); }; $('#tl-name').focus(); return; }
  if(a==='example') { modal('<h2>An example for “'+esc(j.name)+'”</h2><div class="f"><label>In</label><div class="q">one input as it arrived</div><input id="ex-in"></div><div class="f"><label>Out</label><div class="q">what it became</div><input id="ex-out"></div><div class="f"><label>Note</label><input id="ex-note"></div><button class="btn seal" id="ex-go">Add</button> <button class="btn" onclick="closeModal()">Cancel</button>');
    $('#ex-go').onclick=async()=>{ const i=$('#ex-in').value.trim(), o=$('#ex-out').value.trim(); if(!i||!o) return; closeModal(); await op([{t:'updateJob',id,patch:{examples:[...(j.examples||[]),{in:i,out:o,note:$('#ex-note').value||undefined}]}}]); }; $('#ex-in').focus(); return; }
  if(a==='check') { modal('<h2>A check on “'+esc(j.name)+'”</h2><div class="f"><label>Rule</label><div class="q">what must be true: “totals foot within 1%”</div><input id="ck-rule"></div><div class="f"><label>On failure</label><div class="q">what happens — who is told, where it goes</div><input id="ck-fail"></div><button class="btn seal" id="ck-go">Add</button> <button class="btn" onclick="closeModal()">Cancel</button>');
    $('#ck-go').onclick=async()=>{ const r=$('#ck-rule').value.trim(); if(!r) return; closeModal(); await op([{t:'updateJob',id,patch:{checks:[...(j.checks||[]),{rule:r,onFail:$('#ck-fail').value||undefined}]}}]); }; $('#ck-rule').focus(); return; }
  if(a==='io') { const arts=state.board.artifacts; const box=(k)=>arts.map(a=>'<label class="chk"><input type="checkbox" name="'+k+'" value="'+a.id+'" '+((j[k]||[]).includes(a.id)?'checked':'')+'> '+esc(a.name)+' <span class="mut">'+a.kind+'</span></label>').join('');
    modal('<h2>What “'+esc(j.name)+'” takes and produces</h2><div class="row2"><div><label>Takes</label>'+box('inputs')+'</div><div><label>Produces</label>'+box('outputs')+'</div></div><div class="f"><label>New artifact</label><div class="q">something that changes hands and isn\'t listed</div><div class="row"><input id="io-new" placeholder="name"><select id="io-kind"><option>document</option><option>data</option><option>decision</option><option>message</option><option>record</option><option>instruction</option><option>measure</option><option>other</option></select><label><input type="checkbox" id="io-ext"> external</label></div></div><button class="btn seal" id="io-go">Save</button> <button class="btn" onclick="closeModal()">Cancel</button>');
    $('#io-go').onclick=async()=>{ const ops=[]; const nn=$('#io-new').value.trim(); if(nn) ops.push({t:'artifact',artifact:{id:slug(nn),name:nn,kind:$('#io-kind').value,external:$('#io-ext').checked||undefined}}); const inputs=$$('input[name=inputs]:checked').map(x=>x.value), outputs=$$('input[name=outputs]:checked').map(x=>x.value); ops.push({t:'updateJob',id,patch:{inputs,outputs}}); closeModal(); await op(ops); }; return; }
}
/* ---- the board's own rail: intent, scorecard, diff, findings, runs ---- */
const DIM={'cycle-time':'cycle time','labor-hours':'people\'s hours','error-rate':'errors','cost':'cost','throughput':'throughput','risk':'risk'};
function boardRail(){ const b=state.board; const r=$('#rail'); const sc=b.scorecard||{}, base=b.baseScorecard; const fs=(b.findings||[]).filter(f=>!(f.rule==='account-missing'&&f.severity==='warn'));
  const nwait=(state.proposals||[]).length+b.questions.filter(q=>!q.answer).length;
  const tabs=[['weak','What\'s weak · '+fs.length],['change','Change it'],['waiting','Waiting on you · '+nwait]];
  r.innerHTML='<div class="crumb">'+(b.base?'Alternative · <a href="./?board='+esc(b.base)+'">'+esc(b.base)+'</a> · '+(b.baseline?.pinned?'pinned baseline':'legacy unpinned comparison'):'the whole board')+'</div><h2>'+esc(b.title)+'</h2><div class="who">'+esc(b.goal||'')+'</div>'
   +'<div class="tabs">'+tabs.map(([k,l])=>'<span data-btab="'+k+'" class="'+(state.btab===k?'on':'')+'">'+l+'</span>').join('')+'</div>'
   +(state.btab==='weak'?weakTab(fs):state.btab==='change'?changeTab(b,sc,base):waitingList());
  $$('[data-btab]',r).forEach(e=>e.onclick=()=>{state.btab=e.dataset.btab;boardRail();});
  $$('[data-goto]',r).forEach(e=>e.onclick=()=>{ const id=e.dataset.goto; const g=$('.job[data-job="'+CSS.escape(id)+'"]'); if(g) g.scrollIntoView({block:'center',inline:'center',behavior:'smooth'}); select(id); });
  $$('[data-fix]',r).forEach(e=>e.onclick=ev=>{ ev.stopPropagation(); const fx=FIX[e.dataset.fix]; if(fx) fx.run(e.dataset.about,e.dataset.msg); });
  $$('[data-run]',r).forEach(e=>e.onclick=()=>{ state.multi=new Set((b.runs||[])[Number(e.dataset.run)].tasks); applySel(); $('#collect').click(); });
  $$('[data-act]',r).forEach(el=>el.onclick=()=>boardAction(el.dataset.act));
  $$('[data-accept]',r).forEach(el=>el.onclick=async()=>{ await op([{t:'accept',seq:Number(el.dataset.accept)}]); }); $$('[data-reject]',r).forEach(el=>el.onclick=async()=>{ await op([{t:'reject',seq:Number(el.dataset.reject)}]); });
  $$('[data-answer]',r).forEach(el=>el.onclick=async()=>{ const v=$('[data-q="'+CSS.escape(el.dataset.answer)+'"]',r).value.trim(); if(!v) return; await op([{t:'answer',id:el.dataset.answer,answer:v,by:'human'}]); });
}
const RULE_WORDS={'dangling-exit':'an exit that goes nowhere','loop-no-limit':'a loop with no limit','parked-no-limit':'a wait with no bound','watch-only':'a person who can look but not act','unread-artifact':'something written that nobody reads','shared-machinery':'machinery shared by two jobs','two-entrances':'a job that starts from two places','gate-no-owner':'a decision nobody answers for','lever-no-door':'a lever with no door','orphan':'a job connected to nothing','orphan-input':'an input nothing produces','account-missing':'a job nobody has described','over-capacity':'a person with more hours than they have','name-too-long':'a name that is a sentence','composite-unnamed':'a group nobody has named','gate-swallowed':'a decision moved into an agent\'s job','tool-unreachable':'a tool an agent can\'t reach','budget':'a job too long for its system','machinery-at-top':'machinery with no person on the far side','no-tasks':'an agent\'s job with nothing inside','tool-coverage':'a tool nobody has said the limits of','no-checks':'an output nobody checks','handover':'a job that just changed hands','jargon':'a name in the system\'s words, not the person\'s'};
function weakTab(fs){ if(!fs.length) return '<div class="mut">Nothing flagged. Every exit goes somewhere, every decision has a name, every wait has a bound.</div>';
  const groups={}; fs.forEach(f=>{(groups[f.rule]=groups[f.rule]||[]).push(f);});
  const order=Object.keys(groups).sort((a,c)=>{const sev=r=>groups[r][0].severity==='error'?0:groups[r][0].severity==='warn'?1:2; return sev(a)-sev(c)||groups[c].length-groups[a].length;});
  return '<div class="q" style="margin-bottom:10px">Each line is one clip. Click the text to go there; click the action to fix it here.</div>'+order.map(rule=>'<div class="grp"><div class="grph '+groups[rule][0].severity+'"><span class="pinno">'+groups[rule].length+'</span> '+(RULE_WORDS[rule]||rule)+'</div>'+groups[rule].map(f=>{ const fx=FIX[f.rule]; return '<div class="finding"><span></span><div><div data-goto="'+esc(f.about)+'">'+esc(f.message)+'</div>'+(fx?'<button class="btn tiny seal" data-fix="'+f.rule+'" data-about="'+esc(f.about)+'" data-msg="'+esc(f.message)+'">'+fx.label+'</button>':'')+'</div></div>'; }).join('')+'</div>').join(''); }
/* what to make from a finding */
const FIX={
 'dangling-exit':{label:'make the job it goes to', run:(id,msg)=>{ const j=job(id); const cond=(msg.match(/exits on "([^"]+)"/)||[])[1]; modal('<h2>Where does “'+esc(cond||'that exit')+'” go?</h2><div class="f"><label>A new job</label><div class="q">what the person has when it\'s handled</div><input id="fx-name" placeholder="e.g. Tell the requester it timed out"></div><div class="f"><label>On</label><select id="fx-track">'+state.board.tracks.filter(t=>!t.removed).map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join('')+'</select></div><div class="f"><label>Or an existing job</label><select id="fx-exist"><option value="">—</option><option value="stop">it just stops</option>'+live().filter(x=>!x.parent&&x.id!==id).map(x=>'<option value="'+x.id+'">'+esc(x.name)+'</option>').join('')+'</select></div><button class="btn seal" id="fx-go">Save</button> <button class="btn" onclick="closeModal()">Cancel</button>');
   $('#fx-go').onclick=async()=>{ const ex=$('#fx-exist').value, name=$('#fx-name').value.trim(); if(!ex&&!name) return; closeModal(); const ops=[]; let target=ex; if(!ex){ target=slug(name); ops.push({t:'job',job:{id:target,name,track:$('#fx-track').value,trigger:'chain',inputs:[],outputs:[],provenance:{source:'human',by:'human'},status:'confirmed'}}); } const exits=JSON.parse(JSON.stringify(j.exits||[])); const e=exits.find(x=>x.condition===cond)||exits.find(x=>!x.target); if(e) e.target=target; ops.push({t:'updateJob',id,patch:{exits}}); await op(ops); select(target==='stop'?id:target); }; }},
 'tool-unreachable':{label:'make a person\'s task for it', run:(id,msg)=>{ const j=job(id); const tool=(msg.match(/uses ([^,]+), which/)||[])[1]||'the tool'; modal('<h2>Someone reaches '+esc(tool)+'</h2><div class="f"><label>The task</label><div class="q">what the person does with it, in a few words</div><input id="fx-name" value="Look it up in '+esc(tool)+'"></div><div class="f"><label>Who</label><select id="fx-track">'+state.board.tracks.filter(t=>!t.removed&&t.kind==='person').map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join('')+'</select></div><div class="q">it becomes a task inside “'+esc(j.name)+'”, on that person\'s track — an escalation the agent hands to them</div><button class="btn seal" id="fx-go">Add</button> <button class="btn" onclick="closeModal()">Cancel</button>');
   $('#fx-go').onclick=async()=>{ const name=$('#fx-name').value.trim(); if(!name) return; closeModal(); const tid=id+':'+slug(name); const tools=(j.tools||[]).filter(t=>t.name!==tool); await op([{t:'job',job:{id:tid,name,track:$('#fx-track').value,parent:id,trigger:'hand',inputs:[],outputs:[],tools:(j.tools||[]).filter(t=>t.name===tool).map(t=>({...t,reach:t.reach})),provenance:{source:'human',by:'human'},status:'confirmed'}},{t:'updateJob',id,patch:{tools}}]); state.open=[...new Set([...state.open,id])]; state.sel=tid; reload(); }; }},
 'machinery-at-top':{label:'put it inside a job', run:(id)=>{ const j=job(id); modal('<h2>Whose job is “'+esc(j.name)+'” inside?</h2><div class="f"><label>An existing job</label><select id="fx-exist"><option value="">—</option>'+live().filter(x=>!x.parent&&x.id!==id).map(x=>'<option value="'+x.id+'">'+esc(x.name)+'</option>').join('')+'</select></div><div class="f"><label>Or a new one</label><div class="q">named by what a person has when it\'s done</div><input id="fx-name" placeholder="e.g. Deliver the report"></div><div class="f"><label>For whom</label><input id="fx-ben" placeholder="the person on the far side"></div><button class="btn seal" id="fx-go">Save</button> <button class="btn" onclick="closeModal()">Cancel</button>');
   $('#fx-go').onclick=async()=>{ const ex=$('#fx-exist').value, name=$('#fx-name').value.trim(); if(!ex&&!name) return; closeModal(); if(ex){ await op([{t:'updateJob',id,patch:{parent:ex}}]); select(ex); } else { const pid=slug(name); await op([{t:'collect',id:pid,name,track:j.track,into:[id]},{t:'updateJob',id:pid,patch:{beneficiary:$('#fx-ben').value||undefined}}]); select(pid); } }; }},
 'gate-no-owner':{label:'say who answers for it', run:(id)=>action('gate',id)},
 'parked-no-limit':{label:'bound the wait', run:(id)=>{ const j=job(id); modal('<h2>How long may “'+esc(j.name)+'” wait?</h2><div class="f"><label>Done when</label><div class="q">what ends the wait — a deadline, a nudge, an escalation</div><textarea id="fx-dw" rows="3" placeholder="e.g. answered within 2 days, else the requester is nudged; after 7 days it is closed as unanswered"></textarea></div><button class="btn seal" id="fx-go">Save</button> <button class="btn" onclick="closeModal()">Cancel</button>');
   $('#fx-go').onclick=async()=>{ const v=$('#fx-dw').value.trim(); if(!v) return; closeModal(); await op([{t:'updateJob',id,patch:{doneWhen:[...(j.doneWhen||[]),v]}}]); select(id); }; }},
 'no-checks':{label:'add a check', run:(id)=>action('check',id)},
 'no-tasks':{label:'ask the agent to break it down', run:(id)=>action('deepen',id)},
 'account-missing':{label:'describe it', run:(id)=>select(id)},
 'composite-unnamed':{label:'name it', run:(id)=>select(id)},
 'unread-artifact':{label:'make the job that reads it', run:(id,msg)=>{ const art=(msg.match(/^"([^"]+)"/)||[])[1]; const j=job(id); const aid=(j.outputs||[]).find(o=>(state.board.artifacts.find(a=>a.id===o)||{}).name===art)||j.outputs[0]; modal('<h2>Who reads “'+esc(art||'it')+'”?</h2><div class="f"><label>A new job</label><div class="q">what the person has when they\'ve read it</div><input id="fx-name" placeholder="e.g. Hear about bounces"></div><div class="f"><label>On</label><select id="fx-track">'+state.board.tracks.filter(t=>!t.removed).map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join('')+'</select></div><button class="btn seal" id="fx-go">Add</button> <button class="btn" onclick="closeModal()">Cancel</button>');
   $('#fx-go').onclick=async()=>{ const name=$('#fx-name').value.trim(); if(!name) return; closeModal(); const nid=slug(name); await op([{t:'job',job:{id:nid,name,track:$('#fx-track').value,trigger:'event',inputs:aid?[aid]:[],outputs:[],provenance:{source:'human',by:'human'},status:'confirmed'}}]); select(nid); }; }},
 'loop-no-limit':{label:'set the limit', run:(id)=>action('loop',id)},
 'handover':{label:'look at it', run:(id)=>select(id)},
 'jargon':{label:'rename it', run:(id)=>select(id)},
 'tool-coverage':{label:'say what it returns', run:(id)=>select(id)},
 'gate-swallowed':{label:'look at it', run:(id)=>select(id)},
 'orphan-input':{label:'say what produces it', run:(id)=>action('io',id)},
};
function changeTab(b,sc,base){ const intent=b.intent; const runs=b.runs||[];
  const n=(k,dec=1)=>{ const v=sc[k]??0; if(sc[k+"Unknown"]?.length) return "Incomplete"; return Number.isInteger(v)?v:v.toFixed(dec); };
  const delta=(k,lowerBetter)=>{ if(!base||sc[k+'Unknown']?.length||base[k+'Unknown']?.length) return ''; const d=(sc[k]??0)-(base[k]??0); if(Math.abs(d)<0.05) return '<span class="num mut">same</span>'; const good=(d<0)===lowerBetter; return '<span class="num '+(good?'sealt':'warnt')+'">'+(d>0?'+':'−')+(Number.isInteger(d)?Math.abs(d):Math.abs(d).toFixed(1))+(good?' better':' worse')+'</span>'; };
  const line=(label,k,lowerBetter=true)=>'<div class="scrow"><span>'+label+'</span><span class="num">'+n(k)+'</span>'+delta(k,lowerBetter)+'</div>';
  return '<div class="f"><label>1 · What are you trying to improve?</label><div class="q">pick one thing; say what must not get worse</div>'+(intent?'<div><b>'+DIM[intent.primary]+'</b>'+(intent.target?' — '+esc(intent.target):'')+'</div>'+(intent.constraints||[]).map(c=>'<div class="small mut">but not at the cost of: '+esc(c)+'</div>').join(''):'<div class="mut small">nothing chosen yet</div>')+' <button class="btn tiny" data-act="intent">'+(intent?'change':'choose')+'</button></div>'
   +'<div class="f"><label>2 · Where it stands'+(base?' — and how this alternative compares':'')+'</label><div class="q">'+(base?(b.baseline?.pinned?'Compared with pinned baseline '+esc(b.baseline.name):'Legacy unpinned comparison — the source can change'):'these numbers mean most once you compare a changed copy against this one')+'</div><div class="score">'
   +'<div class="scsub">time</div>'+line("people's hours a week",'humanHours')+line('agent hours a week','agentHours',false)
   +'<div class="scsub">judgment</div>'+line('decisions a person makes','humanDecisions',false)+line('decisions a rule makes','ruleDecisions')+line('rules nobody owns','unownedRules')
   +'<div class="scsub">loose ends</div>'+line('waits with no bound','unboundedWaits')+line('exits going nowhere','danglingExits')+line("tools an agent can't reach",'unreachableTools')+line('outputs nobody checks','uncheckedOutputs')+line('jobs not yet confirmed','unconfirmed')+'</div></div>'
   +(b.diff?'<div class="f"><label>3 · What you changed in this alternative</label>'+diffList(b.diff)+'</div>':'<div class="f"><label>3 · Try a change without touching this board</label><div class="q">create an alternative with a pinned baseline, then compare changes here</div><button class="btn tiny" data-act="scenario">Create alternative</button>'+((b.boards||[]).filter(x=>x!==b.id).length?'<div class="small" style="margin-top:6px">boards: '+(b.boards||[]).filter(x=>x!==b.id).map(x=>'<a href="./?board='+esc(x)+'">'+esc(x)+'</a>').join(' · ')+'</div>':'')+'</div>')
   +'<div class="f"><label>4 · Work an agent could take</label><div class="q">runs of a person\'s tasks that are looking things up, moving them between tools, or drafting — with no decision inside</div>'+(runs.length?runs.map((run,i)=>'<div class="run"><div>'+run.tasks.map(t=>esc(job(t)?.name||t)).join(' → ')+'</div>'+(run.blockers.length?'<div class="small warnt">an agent can\'t reach: '+run.blockers.map(esc).join(', ')+'</div>':'')+'<button class="btn seal tiny" data-run="'+i+'">gather these into one job</button></div>').join(''):'<div class="mut small">none yet — this needs the people\'s jobs broken into tasks first</div>')+'</div>'; }
state.btab='weak';
function diffValue(v){ if(v===undefined||v===null)return 'not specified'; if(Array.isArray(v))return v.length?v.map(diffValue).join(', '):'none'; if(typeof v==='object')return Object.entries(v).map(([k,x])=>k+': '+diffValue(x)).join('; '); return String(v); }
function diffList(d){ const n=j=>esc(j.name); const t=id=>esc(track(id)?.name||id); const L=[]; d.added.forEach(j=>L.push('added '+n(j))); d.removed.forEach(j=>L.push('removed '+n(j))); d.moved.forEach(m=>L.push(n(m.job)+': '+t(m.from)+' → '+t(m.to))); d.reparented.forEach(m=>L.push(n(m.job)+': '+(m.from?'out of '+esc(job(m.from)?.name||m.from):'')+(m.to?' into '+esc(job(m.to)?.name||m.to):' to the top'))); d.renamed.forEach(m=>L.push('“'+esc(m.from)+'” → “'+n(m.job)+'”')); (d.changed||[]).forEach(c=>c.fields.filter(f=>!['name','track','parent'].includes(f.field)).forEach(f=>L.push(n(c.job)+' · '+esc(f.field.replace(/([A-Z])/g,' $1').toLowerCase())+': '+esc(diffValue(f.before))+' → '+esc(diffValue(f.after))))); d.tracksAdded.forEach(tr=>L.push('new track '+esc(tr.name))); (d.tracksChanged||[]).forEach(c=>L.push('Track '+esc(c.before.name)+': '+esc(diffValue(c.before))+' → '+esc(c.after?diffValue(c.after):'removed'))); (d.artifactsChanged||[]).forEach(c=>L.push('Artifact '+esc(c.after?.name||c.before?.name)+': '+esc(c.before?diffValue(c.before):'not present')+' → '+esc(c.after?diffValue(c.after):'removed'))); (d.contextChanged||[]).forEach(c=>L.push('Board '+esc(c.field.replace(/([A-Z])/g,' $1').toLowerCase())+': '+esc(diffValue(c.before))+' → '+esc(diffValue(c.after)))); return L.length?L.map(x=>'<div class="small">'+x+'</div>').join(''):'<div class="mut small">nothing yet</div>'; }
function waitingList(){ const ps=state.proposals||[], qs2=state.board.questions.filter(q=>!q.answer); if(!ps.length&&!qs2.length) return '<div class="mut">Nothing waits on you.</div>';
  return ps.map(p=>'<div class="pinq prop"><div class="by">'+esc(p.by)+' proposes</div>'+esc(propLine(p))+'<div><button class="btn seal tiny" data-accept="'+p.seq+'">Accept</button><button class="btn tiny" data-reject="'+p.seq+'">Reject</button></div></div>').join('')+qs2.map(q=>'<div class="pinq"><div class="by">'+q.askedBy+' asks'+(q.about?' · '+esc(job(q.about)?.name||q.about):'')+'</div>'+esc(q.text)+'<textarea data-q="'+esc(q.id)+'" rows="2"></textarea><button class="btn seal tiny" data-answer="'+esc(q.id)+'">Answer</button></div>').join(''); }
async function boardAction(a){ const b=state.board;
  if(a==='intent'){ const it=b.intent||{}; modal('<h2>What a redesign is for</h2><div class="f"><label>Must improve</label><select id="in-p">'+Object.entries(DIM).map(([k,v])=>'<option value="'+k+'" '+(it.primary===k?'selected':'')+'>'+v+'</option>').join('')+'</select></div><div class="f"><label>Target</label><div class="q">in words: “halve the analyst\'s hours per lookup”</div><input id="in-t" value="'+esc(it.target||'')+'"></div><div class="f"><label>Must not make worse</label><div class="q">one per line</div><textarea id="in-c" rows="3">'+esc((it.constraints||[]).join('\n'))+'</textarea></div><button class="btn seal" id="in-go">Save</button> <button class="btn" onclick="closeModal()">Cancel</button>');
    $('#in-go').onclick=async()=>{ closeModal(); await op([{t:'setIntent',intent:{primary:$('#in-p').value,target:$('#in-t').value||undefined,constraints:$('#in-c').value.split('\n').map(x=>x.trim()).filter(Boolean)}}]); }; return; }
  if(a==='scenario'){ const name=prompt('Name the alternative (a short id, e.g. agent-assesses):'); if(!name) return; try{ const response=await fetch('./branch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base:b.id,name,title:b.title+' — '+name})}); if(!response.ok)throw new Error(await response.text()||'Could not create alternative'); location.href='./?board='+encodeURIComponent(name); }catch(error){ toast('Alternative not created: '+error.message); } }
}

/* ---- queue: proposals + questions for the whole board ---- */
function renderQueue(){ const n=state.proposals.length+state.board.questions.filter(q=>!q.answer).length; $('#queue').textContent=n?n+' waiting':''; }
$('#queue').onclick=()=>{ state.multi.clear(); state.btab='waiting'; select(null); return; const ps=state.proposals, qs2=state.board.questions.filter(q=>!q.answer);
  modal('<h2>Waiting on you</h2>'+ps.map(p=>'<div class="pinq prop"><div class="by">'+esc(p.by)+' proposes</div>'+esc(propLine(p))+'<div><button class="btn seal tiny" data-accept="'+p.seq+'">Accept</button><button class="btn tiny" data-reject="'+p.seq+'">Reject</button></div></div>').join('')+qs2.map(q=>'<div class="pinq"><div class="by">'+q.askedBy+' asks'+(q.about?' · '+esc(job(q.about)?.name||q.about):'')+'</div>'+esc(q.text)+'<textarea data-q="'+esc(q.id)+'" rows="2"></textarea><button class="btn seal tiny" data-answer="'+esc(q.id)+'">Answer</button></div>').join('')+'<button class="btn" onclick="closeModal()">Close</button>');
  $$('[data-accept]').forEach(el=>el.onclick=async()=>{closeModal();await op([{t:'accept',seq:Number(el.dataset.accept)}]);}); $$('[data-reject]').forEach(el=>el.onclick=async()=>{closeModal();await op([{t:'reject',seq:Number(el.dataset.reject)}]);});
  $$('[data-answer]').forEach(el=>el.onclick=async()=>{ const v=$('[data-q="'+CSS.escape(el.dataset.answer)+'"]').value.trim(); if(!v) return; closeModal(); await op([{t:'answer',id:el.dataset.answer,answer:v,by:'human'}]); }); };
/* ---- canvas ---- */
$('#canvas').addEventListener('click',()=>{ if(!state.multi.size) select(null); });
$('#canvas').addEventListener('scroll',()=>clipActions());
let pan=null; $('#canvas').addEventListener('mousedown',e=>{ if(e.target.closest('.job')||e.target.closest('#rail')) return; pan={x:e.clientX,y:e.clientY,l:$('#canvas').scrollLeft,t:$('#canvas').scrollTop}; });
window.addEventListener('mousemove',e=>{ if(!pan) return; $('#canvas').scrollLeft=pan.l-(e.clientX-pan.x); $('#canvas').scrollTop=pan.t-(e.clientY-pan.y); });
window.addEventListener('mouseup',()=>{ pan=null; });
$('#canvas').addEventListener('wheel',e=>{ if(!e.ctrlKey&&!e.metaKey) return; e.preventDefault(); const l=Math.max(0,Math.min(2,state.level+(e.deltaY<0?1:-1))); if(l!==state.level){state.level=l;reload();} },{passive:false});
document.addEventListener('keydown',e=>{ if(e.target.matches('input,textarea,select')) return; if(e.key==='?'){ help(); return; }
  if((e.metaKey||e.ctrlKey)&&e.key==='z'){ e.preventDefault(); fetch('./undo?board='+encodeURIComponent(qs.get('board')||''),{method:'POST'}).then(r=>r.json()).then(r=>{ if(!r.undone) alert('Nothing to undo'); }); return; }
  if((e.key==='ArrowRight'||e.key==='ArrowLeft')&&state.sel){ const w=$$('#stage path.wire').filter(p=>e.key==='ArrowRight'?p.dataset.from===state.sel:p.dataset.to===state.sel); if(w.length){ e.preventDefault(); select(e.key==='ArrowRight'?w[0].dataset.to:w[0].dataset.from); } return; }
  if(e.key==='Escape'){ state.multi.clear(); select(null); closeModal(); } if(e.key==='+'||e.key==='='){ state.level=Math.min(2,state.level+1); reload(); } if(e.key==='-'){ state.level=Math.max(0,state.level-1); reload(); } if(e.key==='Enter'&&state.sel&&job(state.sel)&&live().some(x=>x.parent===state.sel)) toggleOpen(state.sel); if(e.key===' '&&state.multi.size>=2){ e.preventDefault(); $('#collect').click(); } });
function help(){ modal('<h2>staves</h2>'
 +'<div class="row2"><div><b>Reading</b><div class="hl">hover a clip — what it achieves, for whom, who said it, and any findings</div><div class="hl">click — select; the rail opens; everything not connected dims</div><div class="hl">double-click a job — open it across its tracks; double-click a task — close back up</div><div class="hl">ctrl/⌘-scroll or + / − — overview · board · detail (every job open)</div><div class="hl">← → — walk the handoffs from the selection · Esc — release</div></div>'
 +'<div><b>Changing</b><div class="hl">drag a clip — to another track to move it; into an open job to join; out of one to leave; left/right to reorder</div><div class="hl">shift-click several, then <i>Collect n into a job</i> (or Space) — one job, named by its outcome</div><div class="hl">double-click a track — add a job; double-click an open job — add a task inside</div><div class="hl">in the rail — every field with its question; <i>confirm</i> per field; split · take out · dissolve · remove</div><div class="hl">answer questions and accept proposals where they sit, or in <i>n waiting</i></div></div></div>'
 +'<b>What the marks mean</b><div class="keyrow"><svg viewBox="0 0 16 16" width="14" height="14"><use href="#person"/></svg> a person <svg viewBox="0 0 16 16" width="14" height="14"><use href="#agent"/></svg> an agent <svg viewBox="0 0 16 16" width="14" height="14"><use href="#system"/></svg> a system <svg viewBox="0 0 16 16" width="14" height="14"><use href="#outside"/></svg> outside</div>'
 +'<div class="keyrow"><svg viewBox="0 0 12 12" width="12" height="12"><use href="#t-event"/></svg> something arrives <svg viewBox="0 0 12 12" width="12" height="12"><use href="#t-chain"/></svg> the previous one ends <svg viewBox="0 0 12 12" width="12" height="12"><use href="#t-clock"/></svg> a schedule <svg viewBox="0 0 12 12" width="12" height="12"><use href="#t-hand"/></svg> a person gets to it</div>'
 +'<div class="keyrow"><svg viewBox="0 0 14 14" width="14" height="14"><use href="#m-unconfirmed"/></svg> agent said, unconfirmed <svg viewBox="0 0 14 14" width="14" height="14"><use href="#m-loop"/></svg> loops back <svg viewBox="0 0 14 14" width="14" height="14"><use href="#m-wait"/></svg> waits for a person <svg viewBox="0 0 14 14" width="14" height="14"><use href="#m-parallel"/></svg> in parallel <svg viewBox="0 0 14 14" width="14" height="14"><use href="#m-comment"/></svg> has comments <svg viewBox="0 0 14 14" width="14" height="14"><use href="#m-stale"/></svg> code changed since described <span class="pin">1</span> a finding — see the notes under the board</div>'
 +'<div class="keyrow"><span class="notch"></span> a gate: one notch per exit; <span class="notch amber"></span> an exit that goes nowhere · dashed clip: outside our hands · faint dashed: not done today · stacked: has tasks inside</div>'
 +'<div class="keyrow">wires: solid — flows on; dashed — a person has to get to it; green — admitted through a gate; faint — rarely, or outside our hands; underneath — comes back</div>'
 +'<b>Where it lives</b><div class="hl">.staves/&lt;board&gt;.jsonl in the project — an append-only log; the board is what the log says. Agents propose, people commit. <code>npx @staves/cli</code> lists the commands.</div>'
 +'<div style="margin-top:12px"><button class="btn" onclick="closeModal()">Close</button> <span class="mut" style="font-size:11px">press ? any time</span></div>'); }
$('#help').onclick=help; $('#undo').onclick=()=>fetch('./undo?board='+encodeURIComponent(qs.get('board')||''),{method:'POST'});
$('#plain').onclick=()=>{ state.plain=!state.plain; $('#app').classList.toggle('plain',state.plain); $('#plain').textContent=state.plain?'back to the work':'for stakeholders'; if(state.plain){ state.level=0; state.multi.clear(); select(null); reload(); } };
$('#hats').onclick=async()=>{ await op([{t:'ask',question:{id:'q:hats:'+Date.now(),about:undefined,askedBy:'human',text:'Wear each role\'s hat in turn (staves_hats) and look for gaps and opportunities: what each person waits on, needs and doesn\'t get, decides without what they\'d need, can\'t check, and what an agent could take. Comment as each role; propose the changes.',at:new Date().toISOString()}}]); alert('Asked. In your agent, say “hats staves” or /mcp__staves__hats.'); };
$('#addtrack').onclick=addTrack; $$('[data-lvl]').forEach(b=>b.onclick=()=>{ state.level=Number(b.dataset.lvl); reload(); });
$('#fit').onclick=()=>{ $('#canvas').scrollLeft=0; $('#canvas').scrollTop=0; };
/* ---- live: reload when the agent writes ---- */
/* live: the daemon pushes changes and presence; fall back to polling if the stream drops */
function presence(list){ const el=$('#who'); if(!el) return; el.innerHTML=(list||[]).map(p=>'<span class="agentdot" title="'+esc(p.name)+' · connected '+esc(p.since.slice(11,16))+'">'+esc(p.name.split(' ')[0])+'</span>').join('')||'<span class="mut" title="no agent connected — in your agent, say: run staves">no agent</span>'; }
function liveFeed(){ try{ const es=new EventSource('./events'); es.addEventListener('hello',e=>{ const d=JSON.parse(e.data); state.version=d.version; presence(d.presence); }); es.addEventListener('change',()=>{ if(!document.activeElement.matches('input,textarea')) load(); }); es.addEventListener('presence',e=>presence(JSON.parse(e.data))); es.onerror=()=>{ es.close(); setTimeout(liveFeed,3000); }; }catch(e){ setInterval(async()=>{ try{ const v=await (await fetch('./version',{cache:'no-store'})).text(); if(state.version&&v!==state.version) await load(); state.version=v; }catch(e){} },1500); } }
liveFeed();
fetch('./staves-version').then(r=>r.text()).then(v=>{ $('#ver').textContent='staves '+v; });
load();
`;

export const APP_CSS = String.raw`
html,body{margin:0;height:100%;overflow:hidden}
#app{display:grid;grid-template-columns:1fr 0;grid-template-rows:auto auto 1fr;height:100%}
#app.rail{grid-template-columns:1fr 380px}
header{grid-column:1/-1;display:flex;align-items:center;gap:24px;padding:12px 24px 10px;border-bottom:1px solid var(--rule)}
header .hd{display:flex;align-items:baseline;gap:14px;min-width:0}
header .ctl button{padding:5px 8px;border:1px solid transparent;border-radius:2px;color:var(--mute)}header .ctl button:hover{color:var(--ink);border-color:var(--rule2)}
header .seg{display:inline-flex;border:1px solid var(--rule2);border-radius:2px;overflow:hidden}header .seg button{border:0;border-radius:0;padding:5px 9px}header .seg button.on{background:var(--ink);color:var(--leaf)}
header .sep{width:1px;height:16px;background:var(--rule2);margin:0 4px}
.agentdot{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--seal);margin-right:8px}.agentdot::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--seal);box-shadow:0 0 0 3px rgba(14,107,74,.14)}
#clipbar{position:fixed;z-index:15;display:none;gap:2px;background:var(--ink);padding:3px;border-radius:2px;box-shadow:3px 3px 0 rgba(20,33,28,.18)}#clipbar button{font:inherit;font-size:11px;color:var(--leaf);background:none;border:0;padding:4px 8px;cursor:pointer;border-radius:1px}#clipbar button:hover{background:rgba(247,249,247,.16)}
#draglabel{position:fixed;z-index:25;display:none;pointer-events:none;background:var(--seal);color:var(--leaf);font-size:11px;padding:4px 8px;border-radius:2px}
.emptyt{font-size:17px;font-weight:600;color:var(--ink);margin-bottom:6px}
#rail.settle{animation:settle 220ms cubic-bezier(.22,.61,.2,1)}@keyframes settle{from{opacity:.4;transform:translateX(6px)}to{opacity:1;transform:none}}
.acts.sticky{position:sticky;bottom:0;background:var(--stock);padding:12px 0 6px;margin-top:22px;border-top:1px solid var(--rule)}
header h1{margin:0;font-size:17px;font-weight:700;letter-spacing:-.015em;white-space:nowrap}
header .goal{font-size:12px;color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
header .ctl{margin-left:auto;display:flex;gap:6px;align-items:center;font-size:11px;color:var(--mute);white-space:nowrap}
header .ctl button{font:inherit;font-size:11px;background:none;cursor:pointer}
header .ctl #queue{color:var(--bistre);font-weight:500}
#app.plain .track-bg[data-track]{}
#app.plain #rail{display:none}#app.plain{grid-template-columns:1fr 0 !important}
#app.plain .job use[href^="#m-"]:not([href="#m-question"]){display:none}
#app.plain .job circle[fill="var(--bistre)"],#app.plain .job circle[fill="var(--bistre)"]+text{display:none}
#app.plain .col,#app.plain .art,#app.plain use[href^="#a-"],#app.plain .note,#app.plain .note+*,#app.plain .small{display:none}
#app.plain #stage svg>circle[fill="var(--bistre)"],#app.plain #stage svg>text[text-anchor="middle"]{display:none}
#app.plain header .ctl>*:not(#plain){display:none}
#stale{grid-column:1/-1;display:none;padding:6px 24px;font-size:12px;background:rgba(140,82,9,.08);color:var(--bistre);border-bottom:1px solid rgba(140,82,9,.25)}
#app{grid-template-rows:auto auto 1fr}
#canvas{position:relative;overflow:auto;cursor:grab}#canvas:active{cursor:grabbing}
#stage{padding:28px 40px 40px;display:inline-block;min-width:100%}
#stage svg{display:block;overflow:visible}
.job{cursor:pointer}.job rect.clip{transition:stroke-width 120ms}.job:hover rect.clip{stroke-width:2}
.job.sel rect.clip{stroke-width:2.25}.job.sel .clip-title{text-decoration:underline;text-decoration-color:var(--seal);text-underline-offset:3px}
.dim .job:not(.sel):not(.near){opacity:.32}.dim path.wire:not(.near){opacity:.18}path.wire.near{stroke:var(--ink)}
.track-bg.drop{fill:rgba(14,107,74,.10)}[data-region].drop{fill:rgba(14,107,74,.14)}
#peek{position:fixed;z-index:20;max-width:340px;background:var(--leaf);border:1px solid var(--rule2);box-shadow:5px 5px 0 rgba(20,33,28,.14);padding:12px 14px;font-size:12.5px;line-height:1.4;display:none;pointer-events:none}
#peek h3{margin:0 0 4px;font-size:13px;font-weight:600}#peek .k{color:var(--mute);font-size:11px;margin-top:6px}
.mut{color:var(--mute)}.warnt{color:var(--bistre)}.sealt{color:var(--seal)}.k.warn{color:var(--bistre)}
#rail{border-left:1px solid var(--rule);overflow-y:auto;padding:16px 20px 60px;display:none;font-size:13px}#app.rail #rail{display:block}
#rail .crumb{font-size:11px;color:var(--mute);margin-bottom:6px}
.sect{font-size:11px;color:var(--mute);letter-spacing:.02em;margin:18px 0 8px;padding-top:10px;border-top:1px solid var(--rule)}
.finding{display:grid;grid-template-columns:8px 1fr;gap:8px;padding:8px 0;border-top:1px solid var(--rule);font-size:12.5px;line-height:1.4}.finding [data-goto]{color:var(--mute);cursor:pointer}.finding [data-goto]:hover{color:var(--ink)}.finding .btn{margin-top:4px}.finding.error .pinno{background:var(--maple)}.finding.info .pinno{background:var(--mute)}
.pinno{display:inline-block;width:16px;height:16px;border-radius:8px;background:var(--bistre);color:var(--leaf);font-size:9px;font-weight:600;text-align:center;line-height:16px}
.scrow{display:grid;grid-template-columns:1fr auto auto;gap:12px;font-size:12px;padding:3px 0;border-bottom:1px solid var(--rule)}.scrow .num{font-variant-numeric:tabular-nums;min-width:3ch;text-align:right}
.run{padding:8px 0;border-top:1px solid var(--rule);font-size:12.5px}
.grp{margin:0 0 10px}.grph{font-size:12.5px;font-weight:600;padding:6px 0 2px;display:flex;gap:8px;align-items:center}.grph.error .pinno{background:var(--maple)}.grph.info .pinno{background:var(--mute)}
.scsub{font-size:11px;color:var(--mute);margin:10px 0 2px}#rail .crumb a{color:var(--seal)}
#rail h2{margin:0 0 2px;font-size:16px;font-weight:600;letter-spacing:-.01em}#rail .who{font-size:12px;color:var(--mute);margin-bottom:14px}
.f{margin:0 0 14px}.f label{display:block;font-size:12px;font-weight:600;margin-bottom:2px}.f .q{font-size:11px;color:var(--mute);margin-bottom:5px}
.f input,.f textarea,.f select,#modal input,#modal textarea,#modal select{box-sizing:border-box;font:inherit;font-size:12.5px;padding:7px 9px;border:1px solid var(--rule2);background:var(--leaf);color:var(--ink)}
.f input,.f textarea,.f select{width:100%}.f textarea{min-height:52px;resize:vertical}.f input:focus,.f textarea:focus,#modal input:focus,#modal textarea:focus{outline:0;border-color:var(--seal)}
.f .empty{border-style:dashed}.f .said{font-size:11px;color:var(--mute);margin-top:3px;display:flex;gap:8px;align-items:center;min-height:16px}.f .said.human{color:var(--seal)}
.f .row{display:flex;gap:8px}.f .row input{width:auto}
.chip{display:inline-block;font-size:11px;padding:2px 8px;border:1px solid var(--seal);border-radius:9px;margin:2px 4px 2px 0;background:var(--leaf)}
.chip.mut{border-color:var(--mute)}.chip.screen{border-style:dashed;border-color:var(--mute)}.chip.personal{border-color:var(--bistre);background:rgba(140,82,9,.08)}
.exit{display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;margin:4px 0;font-size:12px}.exit.dangling select{border-color:var(--bistre);color:var(--bistre)}.exit .arrow{color:var(--mute)}
.btn{font:inherit;font-size:11px;padding:6px 10px;border:1px solid var(--ink);background:none;color:var(--ink);cursor:pointer;margin:2px 6px 2px 0}
.btn.tiny{padding:2px 7px}.btn.seal{border-color:var(--seal);color:var(--seal)}.btn.warn{border-color:var(--bistre);color:var(--bistre)}.btn.on{background:var(--ink);color:var(--leaf)}
.btn:hover{background:var(--ink);color:var(--leaf)}.btn.seal:hover{background:var(--seal)}.btn.warn:hover{background:var(--bistre)}
.trigs{display:flex;flex-wrap:wrap;gap:2px}
.pinq{border-left:3px solid var(--bistre);padding:8px 10px;margin:0 0 12px;background:rgba(140,82,9,.06);font-size:12.5px}.pinq .by{font-size:11px;color:var(--bistre);margin-bottom:3px}
.pinq textarea{width:100%;box-sizing:border-box;margin-top:6px;font:inherit;font-size:12px;padding:6px;border:1px solid var(--rule2);background:var(--leaf)}.pinq .btn{margin-top:6px}
.pinq.prop{border-color:var(--seal);background:rgba(14,107,74,.06)}.pinq.prop .by{color:var(--seal)}.pinq.warnbox{border-color:var(--maple);background:rgba(196,22,43,.06)}
.tabs{display:flex;gap:14px;font-size:12px;margin:0 0 14px;border-bottom:1px solid var(--rule)}.tabs span{padding:6px 0;cursor:pointer;color:var(--mute);border-bottom:1px solid transparent}.tabs span.on{color:var(--ink);border-bottom-color:var(--ink)}
.cmt{padding:8px 0;border-bottom:1px solid var(--rule)}.acts{margin-top:18px;display:flex;flex-wrap:wrap}
#collect{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:20;display:none;background:var(--ink);color:var(--leaf);padding:9px 16px;font-size:12px;border-radius:2px;cursor:pointer}#collect.on{display:block}
#empty{position:absolute;inset:0;display:none;place-items:center;font-size:13px;color:var(--mute);text-align:center;line-height:1.6}#empty>div{max-width:46ch}
#modal{position:fixed;inset:0;z-index:30;display:none;place-items:center;background:rgba(238,241,238,.85)}
#modal .sheet{width:min(640px,92vw);max-height:86vh;overflow:auto;background:var(--leaf);border-top:1px solid var(--rule2);border-bottom:1px solid var(--rule2);box-shadow:5px 5px 0 rgba(20,33,28,.22);padding:22px 26px;font-size:13px}
#modal h2{margin:0 0 14px;font-size:15px}pre.src{font:11px/1.45 ui-monospace,Menlo,monospace;background:var(--paper);border:1px solid var(--rule);padding:10px;max-height:320px;overflow:auto;white-space:pre-wrap;margin:6px 0 0}.small{font-size:11px}.toolrow{margin:4px 0 6px}.reply{margin:6px 0 0 12px;padding-left:10px;border-left:2px solid var(--rule2);font-size:12.5px}.hl{font-size:12.5px;margin:4px 0 6px;line-height:1.4}.keyrow{font-size:12px;margin:6px 0;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}.keyrow svg{vertical-align:middle}.pin{display:inline-block;width:14px;height:14px;border-radius:7px;background:var(--bistre);color:var(--leaf);font-size:9px;font-weight:600;text-align:center;line-height:14px}.notch{display:inline-block;width:0;height:0;border-top:7px solid transparent;border-bottom:7px solid transparent;border-right:8px solid var(--seal)}.notch.amber{border-right-color:var(--bistre)}#modal b{display:block;margin:10px 0 4px;font-size:12px}.row2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px}.row2 label{font-weight:600;font-size:12px;display:block;margin-bottom:6px}.chk{display:block;font-weight:400;font-size:12.5px;margin:3px 0}
`;

export function appHTML(fontCss: string, tokensCss: string, svgCss: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>staves</title><style>${fontCss}${tokensCss}${svgCss}${APP_CSS}</style></head><body>
<div id="app">
<header><div class="hd"><h1 id="title"></h1><span class="goal" id="goal"></span></div>
<nav class="ctl">
  <span id="who"></span><span id="queue" title="what waits on you"></span><button id="undo" title="undo the last change (⌘Z)">undo</button>
  <span class="seg" title="how much to show"><button data-lvl="0">overview</button><button data-lvl="1">board</button><button data-lvl="2">detail</button></span>
  <button id="fit" title="fit the board to the window">fit</button>
  <button id="addtrack" title="add a performer">+ track</button>
  <span class="sep"></span>
  <button id="plain" title="the board as a domain expert should see it">for stakeholders</button>
  <button id="hats" title="ask the agent to look from each role's chair">review as each role</button>
  <button id="help" title="gestures, keys, what the marks mean (?)">?</button>
  <span id="ver" class="mut"></span>
</nav></header>
<div id="stale"></div>
<div id="canvas"><div id="stage"></div><div id="empty"><div><div class="emptyt">Nothing drawn yet.</div><div>In your agent, say <b>run staves</b>. The board draws itself here as the agent describes the work — and pushes back when it describes code instead.</div><div class="mut" style="margin-top:8px">Or start from the people: <b>+ track</b>, then double-click a track to add what someone does.</div></div></div></div>
<aside id="rail"></aside>
</div>
<div id="peek"></div><div id="clipbar"></div><div id="draglabel"></div><div id="collect"></div><div id="modal"></div>
<script src="./app.js"></script></body></html>`;
}
