let closeTrackStack=()=>{};
let activeTrackStack=null;
/* Track folders are local presentation state, never board operations. */
function trackGroupPreferences(){
  try{return JSON.parse(localStorage.getItem('staves:track-groups:'+state.name)||'{}');}catch{return {};}
}
function setTrackGroup(kind,collapsed){
  const preferences=trackGroupPreferences();preferences[kind]=collapsed;
  try{localStorage.setItem('staves:track-groups:'+state.name,JSON.stringify(preferences));}catch{}
  timeline();
}
function groupTracks(){
  const restore=activeTrackStack?{...activeTrackStack,triggerFocused:document.activeElement===activeTrackStack.trigger,focusIndex:[...activeTrackStack.menu.querySelectorAll('button')].indexOf(document.activeElement),scroll:activeTrackStack.menu.scrollTop}:null;
  closeTrackStack();
  const root=$('#tracks'),preferences=trackGroupPreferences();
  hoveredJob=null;hoveredJobs=null;
  const positions=new Map([...root.querySelectorAll('.clip[data-job]')].map(clip=>[clip.dataset.job,parseFloat(clip.style.left)||0]));
  function taskPosition(item){
    const seen=new Set();
    while(item&&!seen.has(item.id)){
      if(positions.has(item.id))return positions.get(item.id);
      seen.add(item.id);item=job(item.parent);
    }
    return X0;
  }
  const rows=[...root.querySelectorAll('.track[data-track]')];
  const groups=new Map();
  rows.forEach(row=>{const kind=track(row.dataset.track)?.kind;if(!trackPalette[kind])return;if(!groups.has(kind))groups.set(kind,[]);groups.get(kind).push(row);});
  for(const [kind,members] of groups){
    const palette=trackPalette[kind],collapsed=Boolean(preferences[kind]);
    const group=document.createElement('div');group.className='track-folder'+(collapsed?' collapsed':'');group.dataset.group=kind;
    group.style.setProperty('--type-color',palette.color);group.style.setProperty('--type-tint',palette.tint);
    const header=document.createElement('button');header.className='folder-heading';header.type='button';header.setAttribute('aria-expanded',String(!collapsed));header.setAttribute('aria-label',(collapsed?'Expand ':'Collapse ')+palette.label);
    header.innerHTML='<span class="folder-chevron">'+(collapsed?'›':'⌄')+'</span><strong>'+palette.label+'</strong><small>'+members.length+'</small>';
    header.onclick=e=>{e.stopPropagation();setTrackGroup(kind,!collapsed);};group.append(header);
    root.insertBefore(group,members[0]);
    // Keep type families together without changing the board's role order.
    let previous=group;members.forEach(row=>{previous.after(row);previous=row;});
    if(!collapsed)continue;
    const lane=document.createElement('div');lane.className='folder-lane';group.append(lane);
    const items=[];
    members.forEach(row=>{
      row.querySelectorAll('.clip[data-job]').forEach(clip=>items.push({clip,job:job(clip.dataset.job),left:parseFloat(clip.style.left)||0}));
      row.remove();
    });
    // Include tasks assigned to these roles even when their parent is elsewhere.
    const ids=new Set(items.map(item=>item.job.id));
    live().filter(j=>j.parent&&job(j.parent)?.track!==j.track&&members.some(row=>row.dataset.track===j.track)&&!ids.has(j.id)).forEach(j=>{
      const clip=document.createElement('div');clip.className='clip';clip.dataset.job=j.id;
      items.push({clip,job:j,left:taskPosition(j)});
    });
    items.sort((a,b)=>a.left-b.left);
    const stacks=[];
    items.forEach(item=>{let stack=stacks.at(-1);if(!stack||item.left>=stack.left+100){stack={left:item.left,items:[]};stacks.push(stack);}stack.items.push(item);});
    for(const stack of stacks){
      const bundle=document.createElement('div');bundle.className='folder-stack';bundle.style.left=stack.left+'px';
      const trigger=document.createElement('button');trigger.type='button';trigger.className='folder-stack-trigger';trigger.textContent=stack.items.length===1?stack.items[0].job.name:stack.items.length+(stack.items.every(i=>i.job.parent)?' tasks':stack.items.every(i=>!i.job.parent)?' jobs':' items');trigger.setAttribute('aria-label',stack.items.map(i=>i.job.name+' — '+(trackOf(i.job)?.name||'')).join('; '));
      const menu=document.createElement('div');menu.className='folder-stack-menu';menu.id='stack-'+kind+'-'+stacks.indexOf(stack);menu.setAttribute('role','group');menu.setAttribute('aria-label',palette.label+' in this stack');trigger.setAttribute('aria-controls',menu.id);
      stack.items.forEach((item,index)=>{
        const proxy=item.clip;proxy.className='clip folder-proxy';proxy.removeAttribute('style');proxy.style.left=stack.left+'px';proxy.style.top=(32+Math.min(index,2)*3)+'px';proxy.replaceChildren();proxy.draggable=false;proxy.tabIndex=-1;proxy.setAttribute('aria-hidden','true');proxy.onclick=null;proxy.onmousedown=null;proxy.ondragstart=null;lane.append(proxy);
        const choice=document.createElement('button');choice.type='button';choice.innerHTML='<span>'+esc(item.job.name)+'</span><small>'+esc(trackOf(item.job)?.name||'')+'</small>';
        choice.onclick=e=>{e.stopPropagation();const preferences=trackGroupPreferences();preferences[kind]=false;const parent=item.job.parent&&job(item.job.parent);if(parent)preferences[trackOf(parent)?.kind]=false;try{localStorage.setItem('staves:track-groups:'+state.name,JSON.stringify(preferences));}catch{}timeline();select(item.job.id,item.job.parent?'task':'job');requestAnimationFrame(()=>root.querySelector('.clip[data-job="'+CSS.escape(item.job.parent||item.job.id)+'"]')?.scrollIntoView({block:'nearest',inline:'nearest'}));};
        choice.onmouseenter=choice.onfocus=()=>{hoveredJobs=null;hoveredJob=item.job.id;paintConnections();};
        choice.onmouseleave=choice.onblur=()=>{hoveredJob=null;hoveredJobs=new Set(stack.items.map(i=>i.job.id));paintConnections();};menu.append(choice);
      });
      const stackKey=kind+':'+stack.items.map(i=>i.job.id).join(',');
      const dismiss=(returnFocus=false)=>{activeTrackStack=null;bundle.classList.remove('open');menu.classList.remove('open');trigger.setAttribute('aria-expanded','false');menu.remove();hoveredJobs=null;hoveredJob=null;paintConnections();if(returnFocus&&trigger.isConnected)trigger.focus();};
      trigger.onclick=e=>{e.stopPropagation();if(bundle.classList.contains('open')){dismiss();return;}closeTrackStack();bundle.classList.add('open');menu.classList.add('open');trigger.setAttribute('aria-expanded','true');document.body.append(menu);positionCanvasPopover(menu,trigger);closeTrackStack=dismiss;activeTrackStack={key:stackKey,menu,trigger};};
      trigger.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.stopPropagation();}if(e.key==='ArrowDown'){e.preventDefault();e.stopPropagation();if(!bundle.classList.contains('open'))trigger.click();menu.querySelector('button')?.focus();}};
      bundle.onmouseenter=bundle.onfocusin=()=>{hoveredJob=null;hoveredJobs=new Set(stack.items.map(i=>i.job.id));paintConnections();};bundle.onmouseleave=()=>{if(!bundle.classList.contains('open')){hoveredJobs=null;paintConnections();}};
      menu.onkeydown=bundle.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dismiss(true);}else if(e.key==='Enter'||e.key===' '){e.stopPropagation();}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();const options=[...menu.querySelectorAll('button')],i=options.indexOf(document.activeElement);options[(i+(e.key==='ArrowDown'?1:options.length-1))%options.length]?.focus();}};
      bundle.append(trigger);lane.append(bundle);
      if(restore?.key===stackKey){trigger.click();menu.scrollTop=restore.scroll;if(restore.triggerFocused)trigger.focus();if(restore.focusIndex>=0)menu.querySelectorAll('button')[restore.focusIndex]?.focus();}

    }
    if(!items.length){const empty=document.createElement('span');empty.className='folder-empty';empty.textContent='No work assigned';lane.append(empty);}
  }
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    root.querySelectorAll('.wires .w').forEach(path=>{
      const from=job(path.dataset.from),to=job(path.dataset.to);
      const kind=from&&trackOf(from)?.kind;
      if(kind&&preferences[kind]&&to&&kind===trackOf(to)?.kind)path.style.display='none';
    });
    minimap();
  }));
}

const minimapBeforeGroups=minimap;
minimap=function(){
  minimapBeforeGroups();
  const root=$('#tracks'),dots=[...document.querySelectorAll('#mm .d')];
  if(!root)return;
  [...root.querySelectorAll('.clip:not(.ghost)')].forEach((clip,index)=>{
    if(!dots[index]||!clip.closest('.track-folder'))return;
    const row=clip.closest('.track-folder');
    dots[index].style.left=((clip.offsetLeft+200)*220/(root.scrollWidth||1))+'px';
    dots[index].style.top=((row.offsetTop+clip.offsetTop)*64/(root.scrollHeight||1)+2)+'px';
  });
};

document.addEventListener('pointerdown',e=>{if(!e.target.closest('.folder-stack,.folder-stack-menu'))closeTrackStack();},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.folder-stack-menu.open')){e.preventDefault();e.stopImmediatePropagation();closeTrackStack(true);}},true);
for(const name of ['scroll','resize'])window.addEventListener(name,event=>{if(!event.target.closest?.('.folder-stack-menu'))closeTrackStack();},{capture:true,passive:true});
