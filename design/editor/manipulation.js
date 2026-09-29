/* Canvas manipulation uses the existing design operations and role-change review. */
(() => {
  let dragged = null;
  let destination = null;
  let frame=0, pointer=null, geometry=null, highlighted=null, hoverId=null, hoverSince=0, dragImage=null;
  const landing=document.createElement('div');landing.className='canvas-landing';landing.setAttribute('aria-hidden','true');document.body.append(landing);
  const announcement=document.createElement('div');announcement.className='drag-announcement';announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');document.body.append(announcement);
  function geometryFor(el){if(!geometry)geometry=new Map();if(!geometry.has(el))geometry.set(el,el.getBoundingClientRect());return geometry.get(el);}
  function resetDrag(){if(dragged?.element)dragged.element.classList.remove('drag-source');dragged=null;pointer=null;cancelAnimationFrame(frame);frame=0;geometry=null;hoverId=null;dragImage?.remove();dragImage=null;clearDrop();document.body.classList.remove('moving-canvas-job');}

  let previewTimer = null;
  let hideTimer = null;
  const marker = document.createElement('div');
  marker.className = 'canvas-insertion';
  marker.setAttribute('aria-hidden', 'true');
  marker.innerHTML = '<span></span>';
  document.body.append(marker);
  const preview = document.createElement('aside');
  preview.className = 'job-preview';
  preview.setAttribute('aria-label', 'Job preview');
  document.body.append(preview);

  function dismissPreview() {
    clearTimeout(previewTimer);
    clearTimeout(hideTimer);
    if (preview.classList.contains('open')) preview.classList.remove('open');
  }
  function clearDrop() {
    destination=null;marker.classList.remove('show');landing.classList.remove('show');
    highlighted?.classList.remove('combine-target');highlighted=null;
  }
  function modalOpen() {
    return Boolean(document.querySelector('#veil.show, #iv.show, #rv.show, #wz.show, #help.show'));
  }
  function showPreview(clip) {
    const item = job(clip.dataset.job);
    if (!item || dragged || modalOpen() || document.body.classList.contains('canvas-navigating')) return;
    const tasks = kids(item.id);
    preview.innerHTML = '<header><strong>' + esc(item.name) + '</strong><small>' + esc(trackOf(item)?.name || '') + '</small>'+(['planned','in-progress'].includes(item.implementation?.state)?'<small>'+esc(item.implementation.state==='planned'?'Planned work':'Implementation in progress')+'</small>':'')+'</header>'
      + (item.outcome ? '<p>' + esc(item.outcome) + '</p>' : '')
      + (tasks.length ? '<ul>' + tasks.slice(0, 3).map(task => '<li>' + ei('task') + '<span>' + esc(task.name) + '</span></li>').join('') + '</ul>' : '')
      + '<footer><span>' + (tasks.length ? tasks.length + (tasks.length === 1 ? ' task' : ' tasks') : 'No tasks added') + '</span><button type="button">Inspect</button></footer>';
    preview.querySelector('button').onclick = () => { dismissPreview(); select(item.id, item.parent ? 'task' : 'job'); };
    preview.classList.add('open');
    positionCanvasPopover(preview,clip);
  }
  preview.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  preview.addEventListener('mouseleave', () => { hideTimer = setTimeout(dismissPreview, 120); });
  document.addEventListener('mouseover', event => {
    if(event.target.closest?.('.canvas-tasks')){dismissPreview();clearTimeout(previewTimer);return;}
    const clip = event.target.closest?.('#tracks .clip[data-job]');
    if (!clip || clip.contains(event.relatedTarget)) return;
    clip.removeAttribute('title');
    clearTimeout(previewTimer); clearTimeout(hideTimer);
    previewTimer = setTimeout(() => showPreview(clip), 650);
  });
  document.addEventListener('focusin', event => {
    if(event.target.closest?.('.canvas-tasks')){dismissPreview();return;}
    const clip=event.target.closest?.('#tracks .clip[data-job]:not(.folder-proxy)');
    if(clip){clearTimeout(hideTimer);showPreview(clip);}
  });
  document.addEventListener('focusout',event=>{if(!preview.contains(event.relatedTarget)&&!event.target.closest?.('.clip')?.contains(event.relatedTarget))hideTimer=setTimeout(dismissPreview,180);});
  document.addEventListener('mouseout', event => {
    if(event.target.closest?.('.canvas-tasks')){dismissPreview();clearTimeout(previewTimer);return;}
    const clip = event.target.closest?.('#tracks .clip[data-job]');
    if (!clip || clip.contains(event.relatedTarget)) return;
    clip.removeAttribute('title');
    clearTimeout(previewTimer);
    hideTimer = setTimeout(dismissPreview, 180);
  });
  for (const name of ['wheel', 'scroll']) document.addEventListener(name, dismissPreview, {capture: true, passive: true});
  document.addEventListener('pointerdown', event => { if (!preview.contains(event.target)) dismissPreview(); }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { dismissPreview(); clearDrop(); } });
  for(const el of document.querySelectorAll('#veil,#iv,#rv,#wz,#help'))new MutationObserver(()=>{if(modalOpen())dismissPreview();}).observe(el,{attributes:true,attributeFilter:['class']});

  function dropLocation(event) {
    const lane=event.target.closest?.('#tracks .track .lane');
    if(!lane||!dragged)return null;
    const trackId=lane.closest('.track').dataset.track;
    const taskHit=event.target.closest('.canvas-task[data-task]');
    const hit=taskHit||event.target.closest('.clip[data-job]');
    const targetId=hit&&(hit.dataset.task||hit.dataset.job);
    if(targetId&&targetId!==dragged.id){
      const target=job(targetId),rect=geometryFor(hit);
      if(!target)return null;
      const relative=taskHit?(event.clientY-rect.top)/rect.height:(event.clientX-rect.left)/rect.width;
      if(relative>.25&&relative<.75){
        if(hoverId!==targetId){hoverId=targetId;hoverSince=performance.now();}
        const ready=performance.now()-hoverSince>450;
        if(dragged.task&&!target.parent)return {kind:'add-task',trackId,target:targetId,element:hit,ready:true};
        if(Boolean(target.parent)===dragged.task)return {kind:dragged.task?'group-tasks':'combine',trackId,target:targetId,element:hit,ready};
      }else hoverId=null;
      if(dragged.task&&target.parent)return {kind:'task-insert',target:targetId,side:relative<.5?'before':'after',x:rect.left,y:relative<.5?rect.top-4:rect.bottom+4,width:rect.width,height:3};
    }else hoverId=null;
    if(dragged.task)return null;
    const clips=[...lane.querySelectorAll(':scope > .clip[data-job]')].filter(el=>el.dataset.job!==dragged.id&&!el.classList.contains('ghost')).sort((a,b)=>geometryFor(a).left-geometryFor(b).left);
    const next=clips.find(el=>event.clientX<geometryFor(el).left+geometryFor(el).width/2);
    const reference=next||clips.at(-1),side=next?'before':'after';const bounds=reference&&geometryFor(reference),laneBounds=geometryFor(lane);
    return {kind:'insert',trackId,target:reference?.dataset.job,side,x:bounds?(side==='before'?bounds.left-7:bounds.right+7):laneBounds.left+20,y:laneBounds.top+20,height:64};
  }
  function paintDrop(next) {
    const old=destination;if(old&&next&&old.kind===next.kind&&old.target===next.target&&old.trackId===next.trackId&&old.side===next.side&&old.ready===next.ready&&old.x===next.x&&old.y===next.y)return;destination=next;
    if(!next){clearDrop();return;}
    if(highlighted&&highlighted!==next.element){highlighted.classList.remove('combine-target');highlighted=null;}
    if(next.element){
      marker.classList.remove('show');landing.classList.remove('show');highlighted=next.element;
      const label=next.kind==='add-task'?'Release to add task to this job':next.ready?(next.kind==='group-tasks'?'Release to create a job with these tasks':'Release to group these jobs'):'Hold to group · move to an edge to reorder';
      highlighted.dataset.dropLabel=label;highlighted.classList.add('combine-target');
      if(old?.target!==next.target||old?.ready!==next.ready)announcement.textContent=label;
      return;
    }
    const name=job(next.target)?.name;const label=(next.kind==='task-insert'?'Place task ':'Move job ')+(name?next.side+' “'+name+'”':'to '+(track(next.trackId)?.name||'track'));
    marker.style.left=next.x+'px';marker.style.top=next.y+'px';marker.style.height=next.height+'px';marker.style.width=(next.width||3)+'px';marker.querySelector('span').textContent=label;marker.classList.add('show');
    landing.style.cssText='left:'+(next.x+7)+'px;top:'+next.y+'px;width:'+Math.min(dragged.width,180)+'px;height:'+Math.min(next.height,64)+'px';landing.classList.toggle('show',next.kind==='insert');
    if(old?.target!==next.target||old?.side!==next.side)announcement.textContent=label;
  }
  function dragFrame(){
    frame=0;if(!dragged||!pointer)return;
    const scroller=document.querySelector('#tls');
    if(scroller){const r=scroller.getBoundingClientRect();if(pointer.clientY>r.top&&pointer.clientY<r.bottom){const dx=pointer.clientX>r.right-48?10:pointer.clientX<r.left+48?-10:0;if(dx){scroller.scrollLeft+=dx;geometry=null;}}}
    paintDrop(dropLocation(pointer));frame=requestAnimationFrame(dragFrame);
  }
  async function placeJob(id, targetTrack, referenceId, side) {
    const item = job(id), role = track(targetTrack);
    if (!item || !role || role.removed) throw new Error('The job or destination is no longer available.');
    if (referenceId && (!job(referenceId) || referenceId === id)) throw new Error('Choose another job to place beside.');
    const placement = referenceId ? {[side]: referenceId} : {};
    if (item.track !== targetTrack && ['person:agent', 'agent:person'].includes(trackOf(item)?.kind + ':' + role.kind)) {
      await inspectTransfer(id, targetTrack, null, placement);
      return;
    }
    const operations = [];
    if (item.track !== targetTrack) operations.push({t: 'updateJob', id, patch: {track: targetTrack}});
    if (referenceId) operations.push({t: 'reorder', id, [side]: referenceId});
    if (operations.length) { await checkedOp(operations); select(id, 'job'); }
  }
  function choosePlacement(id, targetId) {
    const item = job(id), target = job(targetId);
    if (!item || !target) return;
    const veil = $('#veil');
    veil.innerHTML = '<div class="sheet placement-sheet" role="dialog" aria-modal="true" aria-labelledby="placement-title"><div class="sh" id="placement-title">Place or group jobs</div><div class="sb"><div class="placement-pair"><span>' + esc(item.name) + '<small>' + esc(trackOf(item)?.name || '') + '</small></span>' + ei('arrows-left-right') + '<span>' + esc(target.name) + '<small>' + esc(trackOf(target)?.name || '') + '</small></span></div><div class="placement-actions"><button class="bt" data-place="before">Move to ' + esc(trackOf(target)?.name || 'track') + ', before</button><button class="bt" data-place="after">Move to ' + esc(trackOf(target)?.name || 'track') + ', after</button><button class="bt" id="placement-epic">Group under an outcome</button></div><p class="hint">Moving before or after also assigns the job to the destination role. An epic groups jobs under a shared outcome, keeping each job and role intact.</p><p class="placement-error" role="alert"></p></div><div class="sf"><button class="bt q" id="placement-cancel">Cancel</button></div></div>';
    veil.classList.add('show');
    veil.querySelectorAll('[data-place]').forEach(button => button.onclick = async () => {
      button.disabled=true;
      try { const side=button.dataset.place;const review=item.track!==target.track&&['person:agent','agent:person'].includes(trackOf(item)?.kind+':'+trackOf(target)?.kind);if(review)closeSheet();await placeJob(id,target.track,targetId,side);if(!review)closeSheet(); }
      catch(error){if(veil.contains(button))veil.querySelector('.placement-error').textContent=error.message;else toast(error.message);}
      finally{button.disabled=false;}
    });
    $('#placement-epic').onclick = () => { closeSheet(); state.multi = new Set([id, targetId]); editEpic(); };
    $('#placement-cancel').onclick = closeSheet;
    veil.onkeydown = event => { if (event.key === 'Escape') closeSheet(); };
    $('#placement-cancel').focus();
  }
  document.addEventListener('dragstart',event=>{
    const element=event.target.closest?.('#tracks .canvas-task[data-task],#tracks .clip[data-job]');
    const id=element&&(element.dataset.task||element.dataset.job),item=job(id);if(!item)return;
    dismissPreview();clearDrop();geometry=new Map();hoverId=null;
    dragged={id,task:!!item.parent,element,width:element.getBoundingClientRect().width};
    event.dataTransfer.setData('text/plain',(item.parent?'task:':'job:')+id);event.dataTransfer.effectAllowed='move';
    dragImage=document.createElement('div');dragImage.className='canvas-drag-image';dragImage.textContent=item.name;document.body.append(dragImage);event.dataTransfer.setDragImage(dragImage,24,20);
    document.body.classList.add('moving-canvas-job');setTimeout(()=>{if(dragged?.id===id)element.classList.add('drag-source');},0);
    announcement.textContent='Moving '+item.name;
  },true);
  document.addEventListener('dragover',event=>{
    if(!dragged)return;
    if(!event.target.closest?.('#tracks .lane')){pointer=null;clearDrop();return;}
    event.preventDefault();event.stopImmediatePropagation();
    pointer={target:event.target,clientX:event.clientX,clientY:event.clientY};event.dataTransfer.dropEffect='move';if(!frame)frame=requestAnimationFrame(dragFrame);
  },true);
  document.addEventListener('drop',async event=>{
    if(!dragged)return;
    const next=dropLocation(event),id=dragged.id;resetDrag();if(!next)return;
    event.preventDefault();event.stopImmediatePropagation();
    try{
      if(next.kind==='group-tasks'){if(next.ready)window.combineTasksIntoJob(id,next.target);else await checkedOp([{t:'reorder',id,[event.clientY<next.element.getBoundingClientRect().top+next.element.offsetHeight/2?'before':'after']:next.target}]);return;}
      if(next.kind==='combine'){if(next.ready)choosePlacement(id,next.target);else await placeJob(id,next.trackId,next.target,event.clientX<next.element.getBoundingClientRect().left+next.element.offsetWidth/2?'before':'after');return;}
      if(next.kind==='task-insert')await checkedOp([{t:'reorder',id,[next.side]:next.target}]);
      else if(next.kind==='add-task')await checkedOp([{t:'updateJob',id,patch:{parent:next.target}}]);
      else await placeJob(id,next.trackId,next.target,next.side);
      requestAnimationFrame(()=>{const el=[...document.querySelectorAll('[data-job],[data-task]')].find(e=>(e.dataset.task||e.dataset.job)===id);el?.classList.add('drop-landed');setTimeout(()=>el?.classList.remove('drop-landed'),650);});
      announcement.textContent='Move saved';
    }catch(error){toast(error.message);announcement.textContent='Move failed: '+error.message;}
  },true);
  document.addEventListener('dragend',resetDrag);
  document.addEventListener('scroll',()=>{geometry=null;},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&dragged){resetDrag();announcement.textContent='Move cancelled';}},true);
})();
