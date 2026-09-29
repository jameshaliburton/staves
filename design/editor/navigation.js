/* Viewing modes change the presentation, never the work model. */
const trackPalette = {
  person: {color:'#8c593b', tint:'#f8f1eb', label:'People'},
  agent: {color:'#3d6a63', tint:'#edf5f2', label:'Agents'},
  system: {color:'#576c90', tint:'#eff2f8', label:'Systems'},
  outside: {color:'#7c688f', tint:'#f4eff7', label:'External'},
};
let editorMode = 'design';
// Geometry stays in CSS pixels. Only horizontal spacing and disclosure change.
let detailZoom = 1;
let showCanvasTasks = false;
const detailLevel = () => detailZoom < .65 ? 'outcomes' : detailZoom < 1.4 ? 'jobs' : 'tasks';
let selectedEpic = null;
const viewbar = document.createElement('div');
viewbar.className = 'editor-viewbar';
const modes = document.createElement('div'); modes.className='editor-modes'; modes.setAttribute('aria-label','Workflow view');
for (const [key,label,icon] of [['outcomes','Compact','stack'],['jobs','Jobs','job'],['tasks','Tasks','task']]) {
  const button = eb(label,icon,()=>{showCanvasTasks=false;canvasZoom({outcomes:.4,jobs:1,tasks:1.7}[key]);}); button.dataset.mode=key; modes.append(button);
}
viewbar.append(modes);
const legend = document.createElement('div'); legend.className='track-legend';
for (const p of Object.values(trackPalette)) { const item=document.createElement('span');item.style.setProperty('--type-color',p.color);item.textContent=p.label;legend.append(item); }
viewbar.append(legend);
let connectionVisibility='all';
let hoveredJob=null;
let hoveredJobs=null;
const connectionControl=document.createElement('select');
connectionControl.className='connection-visibility';connectionControl.setAttribute('aria-label','Connection visibility');
for(const [value,label] of [['focus','Connections: on focus'],['all','Connections: show all'],['none','Connections: hidden']]){const option=document.createElement('option');option.value=value;option.textContent=label;connectionControl.append(option);}
connectionControl.value=connectionVisibility;
connectionControl.onchange=()=>{connectionVisibility=connectionControl.value;paintConnections();};viewbar.append(connectionControl);
function paintConnections(){
  document.body.dataset.connections=connectionVisibility;
  const focus=hoveredJob||(typeof state.sel==='string'?state.sel:null);
  $$('.wires .w').forEach(path=>path.classList.toggle('context-wire',Boolean(hoveredJobs?hoveredJobs.has(path.dataset.from)!==hoveredJobs.has(path.dataset.to):focus&&(path.dataset.from===focus||path.dataset.to===focus))));
}
// Hover provides orientation; full prose belongs in the explicit inspector.
peekOn=function(){};

const epicAction=eb('New epic','add',()=>editEpic()); viewbar.append(epicAction);
$('#tl').insertBefore(viewbar,$('#tls'));

const epicFocus=document.createElement('div');epicFocus.id='epic-focus';$('#tl').insertBefore(epicFocus,$('#tls'));
const fitButton=$('button[data-tip="fit"]');
fitButton.innerHTML=ei('arrows-in-simple')+'<span>Fit</span>';fitButton.classList.add('labelled-control');fitButton.setAttribute('aria-label','Fit workflow');fitButton.title='Fit the whole workflow';fitButton.removeAttribute('data-tip');
const fullButton=$('button[data-tip="full screen (F)"]');
fullButton.innerHTML=ei('corners-out')+'<span>Full screen</span>';fullButton.classList.add('labelled-control');fullButton.setAttribute('aria-label','Full screen');fullButton.title='Toggle full screen · F';fullButton.removeAttribute('data-tip');
const zoomReadout=document.createElement('span');zoomReadout.id='zoom-readout';zoomReadout.setAttribute('aria-label','Zoom level');fitButton.before(zoomReadout);
function paintNavigation(){
  modes.querySelectorAll('button').forEach(b=>{b.classList.toggle('active',b.dataset.mode===detailLevel());b.setAttribute('aria-pressed',String(b.dataset.mode===detailLevel()));});
  document.body.dataset.editorMode=editorMode;
  $('#tracks').style.zoom='1';$('#tracks').style.transform='none';
  document.body.dataset.detail=detailLevel();
  zoomReadout.textContent=Math.round(detailZoom*100)+'%';
  paintConnections();
  fullButton.querySelector('span').textContent=$('#ws').classList.contains('full')?'Exit full screen':'Full screen';
  fullButton.setAttribute('aria-label',fullButton.querySelector('span').textContent);
  $$('.track[data-track]').forEach(row=>{
    const t=track(row.dataset.track),p=trackPalette[t?.kind];if(!p)return;
    row.style.setProperty('--type-color',p.color);row.style.setProperty('--type-tint',p.tint);
    row.querySelectorAll('.clip').forEach(c=>c.style.setProperty('--c',p.color));
    const header=row.querySelector('.h');if(header)header.title=t.name+' · '+p.label;
  });
  const epic=state.board?.regions.find(r=>r.id===selectedEpic&&!r.removed);
  epicFocus.replaceChildren();
  if(epic&&editorMode!=='epics'){
    const label=document.createElement('span');label.textContent=epic.name;epicFocus.append(label,eb('Show all jobs','close',()=>{selectedEpic=null;paintNavigation();}));
  }
  $$('.clip[data-job]').forEach(c=>c.classList.toggle('outside-epic',Boolean(epic&&!epic.members.includes(c.dataset.job))));
  
}
function editEpic(id){
  const current=state.board.regions.find(r=>r.id===id), members=new Set(current?.members||state.multi);
  const veil=$('#veil');veil.innerHTML='<div class="sheet epic-sheet" role="dialog" aria-modal="true" aria-labelledby="epic-title"><div class="sh" id="epic-title">'+(current?'Edit epic':'New epic')+'</div><div class="sb"><label for="epic-name">What larger outcome do these jobs deliver?</label><input id="epic-name" placeholder="For example, resolve a customer’s request"><p class="hint">Choose the jobs that contribute to this outcome.</p><div id="epic-members"></div><p id="epic-error" role="alert"></p></div><div class="sf"><button class="bt q" id="epic-cancel">Cancel</button><button class="bt acc" id="epic-save">Save epic</button></div></div>';
  $('#epic-name').value=current?.name||'';
  for(const j of live().filter(j=>!j.parent)){const label=document.createElement('label');label.className='epic-choice';const check=document.createElement('input');check.type='checkbox';check.checked=members.has(j.id);check.onchange=()=>check.checked?members.add(j.id):members.delete(j.id);label.append(check);const text=document.createElement('span');text.textContent=j.name;const who=document.createElement('small');who.textContent=trackOf(j)?.name||'';label.append(text,who);$('#epic-members').append(label);}
  if(current){const remove=eb('Ungroup epic — keep all jobs','stack',async()=>{try{await checkedOp([{t:'removeRegion',id:current.id}]);selectedEpic=null;closeSheet();}catch(e){$('#epic-error').textContent=e.message;}});veil.querySelector('.sf').prepend(remove);}
  veil.classList.add('show');$('#epic-cancel').onclick=closeSheet;$('#epic-save').onclick=async()=>{
    const name=$('#epic-name').value.trim();if(!name||!members.size){$('#epic-error').textContent='Name the outcome and choose at least one job.';return;}
    try{await checkedOp([{t:'region',region:{...current,id:current?.id||'epic-'+Date.now(),name,color:current?.color||'#637898',members:[...members]}}]);closeSheet();paintNavigation();}catch(e){$('#epic-error').textContent=e.message;}
  };$('#epic-name').focus();
}
// Existing phase/region labels open the same editable epic grouping.
sheetRegion=editEpic;
function canvasZoom(next,clientX){
  const pane=$('#tls'),rect=pane.getBoundingClientRect();
  const header=200,x=Math.max(header,clientX==null?pane.clientWidth/2:clientX-rect.left);
  const previous=detailZoom;
  detailZoom=Math.max(.15,Math.min(2.5,next));
  const world=(pane.scrollLeft+x-header)/previous;
  state.zoom=1;
  dismissNavigationPeek();
  timeline();
  pane.scrollLeft=Math.max(0,world*detailZoom-x+header);
  requestAnimationFrame(minimap);
}
zoom=d=>canvasZoom(detailZoom+d*.1);
fit=async()=>{
  const pane=$('#tls');
  const bounds=()=>Math.max(200,...$$('#tracks .clip[data-job]:not(.folder-proxy),#tracks .folder-stack').map(c=>c.getBoundingClientRect().right-pane.getBoundingClientRect().left+pane.scrollLeft));
  // Measure the collision-adjusted layout, including summary stacks and fixed headers.
  const settled=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  canvasZoom(1);pane.scrollLeft=0;await settled();
  for(let attempt=0;attempt<12&&bounds()>pane.clientWidth-16&&detailZoom>.15;attempt++){
    canvasZoom(Math.max(.15,detailZoom*Math.min(.9,(pane.clientWidth-216)/Math.max(1,bounds()-200))));pane.scrollLeft=0;await settled();
  }
  if(bounds()>pane.clientWidth-16)toast('Minimum readable size reached. Scroll horizontally to see the remaining work.');
  requestAnimationFrame(minimap);
};
// Native add/reorder menus use the same horizontal coordinate model.
colAt=(event,lane)=>Math.max(0,Math.round((event.clientX-lane.getBoundingClientRect().left-X0)/(COL*detailZoom)));
let navigationPeekTimer;
function dismissNavigationPeek(){clearTimeout(peekT);$('#peek').classList.remove('show');document.body.classList.add('canvas-navigating');clearTimeout(navigationPeekTimer);navigationPeekTimer=setTimeout(()=>document.body.classList.remove('canvas-navigating'),450);}
$('#tls').addEventListener('scroll',dismissNavigationPeek,{passive:true});
$('#tls').addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();canvasZoom(detailZoom*Math.exp(-e.deltaY*.008),e.clientX,e.clientY);},{passive:false});
let gestureScale=1;
$('#tls').addEventListener('gesturestart',e=>{e.preventDefault();gestureScale=detailZoom;},{passive:false});
$('#tls').addEventListener('gesturechange',e=>{e.preventDefault();canvasZoom(gestureScale*e.scale,e.clientX,e.clientY);},{passive:false});
const activeTouches=new Map();let pinchDistance=null;
$('#tls').addEventListener('pointerdown',e=>{if(e.pointerType==='touch'){activeTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});$('#tls').setPointerCapture(e.pointerId);}});
$('#tls').addEventListener('pointermove',e=>{if(e.pointerType!=='touch'||!activeTouches.has(e.pointerId))return;const previous=activeTouches.get(e.pointerId);activeTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(activeTouches.size===1){e.preventDefault();$('#tls').scrollLeft-=e.clientX-previous.x;$('#tls').scrollTop-=e.clientY-previous.y;return;}if(activeTouches.size!==2)return;const[a,b]=[...activeTouches.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(pinchDistance){e.preventDefault();canvasZoom(detailZoom*distance/pinchDistance,(a.x+b.x)/2,(a.y+b.y)/2);}pinchDistance=distance;},{passive:false});
for(const type of ['pointerup','pointercancel'])window.addEventListener(type,e=>{activeTouches.delete(e.pointerId);pinchDistance=null;});
const originalFullTimeline=fullTimeline;
fullTimeline=function(){originalFullTimeline();paintNavigation();};
const navigationTimeline=timeline;
timeline=function(){
  state.zoom=1;
  navigationTimeline();
  // Core timeline reserves a sticky stage row but currently supplies no stage content.
  // Leaving it in place paints a blank strip over jobs whenever the canvas scrolls.
  const stageRow=$('#tracks > .stages');
  if(stageRow&&!stageRow.textContent.trim()&&!stageRow.querySelector('.lane > *'))stageRow.remove();
  const width=Math.max(54,Math.round(208*detailZoom));
  const columns=state.board.columns||{};
  $$('.track .lane').forEach(lane=>{
    let right=0;
    [...lane.querySelectorAll('.clip[data-job]')].sort((a,b)=>{const items=[...lane.querySelectorAll('.clip[data-job]')];const explicit=items.some(c=>job(c.dataset.job)?.order!=null);const A=job(a.dataset.job),B=job(b.dataset.job);return explicit?((A?.order??state.board.jobs.indexOf(A))-(B?.order??state.board.jobs.indexOf(B))):((columns[a.dataset.job]||0)-(columns[b.dataset.job]||0));}).forEach(c=>{
      const j=job(c.dataset.job);
      if(!j)return;
      c.style.left=Math.max(X0+(columns[j.id]||0)*COL*detailZoom,right)+'px';
      c.style.width=width+'px';
      c.title=j.name;
      c.tabIndex=0;
      c.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.stopPropagation();if(e.target!==c)return;e.preventDefault();select(j.id,'job');}};
      const output=c.querySelector('.port'),input=c.querySelector('.port-in');
      if(input){input.title='Receives an output';input.setAttribute('aria-label','Receives an output');}
      if(output){output.title='Drag to connect an output, or press Enter';output.tabIndex=0;output.setAttribute('role','button');output.setAttribute('aria-label','Connect output from '+j.name);output.onclick=e=>{e.stopPropagation();if(e.detail===0)connectPicker(j.id);};output.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();connectPicker(j.id);}};}
      c.onmouseenter=()=>{hoveredJob=j.id;paintConnections();};
      c.onmouseleave=()=>{hoveredJob=null;paintConnections();};
      c.onfocus=()=>{hoveredJob=j.id;paintConnections();};
      c.onblur=()=>{hoveredJob=null;paintConnections();};
      c.setAttribute('aria-label',j.name);
      right=c.offsetLeft+width+14;
      if(showCanvasTasks||detailLevel()==='tasks'){
        const tasks=kids(j.id);
        const strip=document.createElement('div');strip.className='canvas-tasks';
        tasks.forEach(task=>{
          const button=document.createElement('button');button.className='canvas-task';
          button.dataset.task=task.id;button.setAttribute('aria-label','Inspect task: '+task.name);button.textContent=task.name;button.title=task.name+' · '+(trackOf(task)?.name||'Unassigned');button.draggable=true;button.style.borderLeft='3px solid '+(trackPalette[trackOf(task)?.kind]?.color||'#ccc');
          button.ondragstart=e=>{e.stopPropagation();e.dataTransfer.setData('text/plain','task:'+task.id);};
          button.onclick=e=>{e.stopPropagation();sheetTask(task.id);};
          button.ondblclick=e=>{e.stopPropagation();sheetTask(task.id);};
          strip.append(button);
        });
        const add=eb('Add task','add',()=>addTask(j.id));add.onclick=e=>{e.stopPropagation();addTask(j.id);};strip.append(add);c.append(strip);
          strip.onmousedown=e=>e.stopPropagation();
          const row=lane.closest('.track');row.style.setProperty('height',Math.max(parseFloat(row.style.height)||0,110+tasks.length*36)+'px','important');
      }
    });
    lane.querySelectorAll('.beat').forEach((beat,i)=>beat.style.left=(X0+(i+1)*COL*detailZoom-12)+'px');
  });
  const worldWidth=Math.max($('#tls').clientWidth,...$$('.clip[data-job]').map(c=>c.offsetLeft+c.offsetWidth+240));
  $('#tracks').style.width=worldWidth+'px';
  groupTracks();decorate();paintNavigation();selbar();
  requestAnimationFrame(()=>{
    // Epics remain explicit spans over their actual members at every detail level.
    $$('.region').forEach(region=>region.classList.add('epic-span'));
    const visibleHandoffs=(state.board.handoffs||[]).filter(h=>{
      const a=[...document.querySelectorAll('.clip[data-job]')].find(c=>c.dataset.job===h.from);
      const b=[...document.querySelectorAll('.clip[data-job]')].find(c=>c.dataset.job===h.to);
      return a?.offsetParent&&b?.offsetParent;
    });
    $$('.wires .w').forEach((path,i)=>{const h=visibleHandoffs[i];if(h){path.dataset.from=h.from;path.dataset.to=h.to;}});
    paintConnections();
  });
};
const navigationRender=render;
render=function(){navigationRender();paintNavigation();};
const navigationReady=setInterval(()=>{if(state.board){clearInterval(navigationReady);timeline();}},100);
