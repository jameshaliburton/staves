/* Connections are shared artifacts: the wizard edits the design, never executes it. */
let cancelConnectionDrag = null;
let connectionDraft = null;
const connectionStarts = {keep:'Leave the start unchanged',event:'When the output arrives',hand:'When a person is ready',chain:'When the sending job finishes'};
function connectionPair(from, to) {
  return '<div class="connection-route"><div>'+ei(trackOf(from)?.kind||'job')+'<small>'+esc(trackOf(from)?.name||'Sender')+'</small><b>'+esc(from.name)+'</b></div>'+ei('arrow-right')+'<div>'+ei(trackOf(to)?.kind||'job')+'<small>'+esc(trackOf(to)?.name||'Receiver')+'</small><b>'+esc(to.name)+'</b></div></div>';
}
startConnect = function(fromId, event) {
  cancelConnectionDrag?.();
  const tracks = $('#tracks'), svg = tracks?.querySelector('svg.wires');
  const source = [...document.querySelectorAll('.clip[data-job]')].find(el=>el.dataset.job===fromId);
  if (!svg || !source || !job(fromId) || fromId.startsWith('focus:')) return;
  const path = document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('class','rubber'); svg.append(path);
  const preview = document.createElement('div'); preview.className='connection-peek'; preview.setAttribute('role','status'); document.body.append(preview);
  const [ax,ay]=portXY(source,'out'); let target=null;
  tracks.classList.add('connecting'); state.connectMode=fromId; document.body.style.cursor='crosshair';
  clearTimeout(peekT); $('#peek').classList.remove('show');
  function cleanup() {
    document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',release);
    document.removeEventListener('keydown',key,true); window.removeEventListener('blur',cleanup);
    target?.classList.remove('target'); path.remove(); preview.remove(); tracks.classList.remove('connecting');
    document.body.style.cursor=''; state.connectMode=null; cancelConnectionDrag=null;
  }
  function move(e) {
    const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest('.clip[data-job]');
    target?.classList.remove('target'); target=hit && hit.dataset.job!==fromId && !hit.dataset.job.startsWith('focus:') && job(hit.dataset.job) ? hit : null;
    const r=tracks.getBoundingClientRect();
    const [bx,by]=target?portXY(target,'in'):[(e.clientX-r.left)/state.zoom,(e.clientY-r.top)/state.zoom];
    path.setAttribute('d',wirePath(ax,ay,bx,by));
    if (target) {
      target.classList.add('target');
      const from=job(fromId),to=job(target.dataset.job),output=(from.outputs||[]).map(id=>state.board.artifacts.find(a=>a.id===id)).filter(Boolean);
      const signature=target.dataset.job;
      if(preview.dataset.target!==signature){preview.dataset.target=signature;preview.innerHTML='<small>CONNECT JOBS</small>'+connectionPair(from,to)+'<div class="connection-peek-result">'+ei('connect')+'<span>'+(output.length===1?'<b>'+esc(output[0].name)+'</b> becomes an input.':output.length?'Choose which output becomes an input.':'Define what changes hands.')+'</span></div><footer>Release to review the handoff · Esc cancels</footer>';}
      preview.hidden=false;
    } else {preview.hidden=true;preview.dataset.target='';}
    preview.style.left=Math.max(12,Math.min(window.innerWidth-preview.offsetWidth-12,e.clientX+24))+'px';
    preview.style.top=Math.max(12,Math.min(window.innerHeight-preview.offsetHeight-12,e.clientY+24))+'px';
  }
  function release(e) {move(e);const to=target?.dataset.job;cleanup();if(to)sheetHandoff(fromId,to);}
  function key(e) {if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cleanup();}}
  document.addEventListener('mousemove',move); document.addEventListener('mouseup',release);
  document.addEventListener('keydown',key,true); window.addEventListener('blur',cleanup);cancelConnectionDrag=cleanup;
  if(event)move(event);
};
function beginConnectionQueue(fromId, ids=[]) {
  const from=job(fromId);if(!from)return;
  const artifact=(from.outputs||[]).find(id=>state.board.artifacts.some(a=>a.id===id));
  connectionDraft={fromId,recipients:ids.map(id=>({id,start:'keep',check:'',failure:''})),step:ids.length?1:0,index:0,artifact:artifact||'new',name:'',kind:'document'};
  drawConnectionWizard();
}
connectPicker = function(id){cancelConnectionDrag?.();beginConnectionQueue(id);};
sheetHandoff = function(fromId,toId){cancelConnectionDrag?.();if(fromId!==toId&&job(toId))beginConnectionQueue(fromId,[toId]);};
function connectionRecipientGroups(fromId){
  const available=state.board.jobs.filter(j=>!j.removed&&!j.id.startsWith('focus:'));
  const descendants=(id,seen=new Set())=>available.filter(j=>j.parent===id&&!seen.has(j.id)).flatMap(j=>[j,...descendants(j.id,new Set([...seen,j.id]))]);
  return available.filter(j=>!j.parent||!available.some(parent=>parent.id===j.parent)).map(parent=>({parent,items:[parent,...descendants(parent.id,new Set([parent.id]))].filter(j=>j.id!==fromId)})).filter(g=>g.items.length);
}
function connectionRecipientSummary(r){const to=job(r.id);return '<b>'+esc(to?.name||'Unavailable recipient')+'</b><small>'+esc(r.start==='keep'?'Supporting information · start unchanged':connectionStarts[r.start]||connectionStarts.keep)+(r.check?' · Check: '+esc(r.check):'')+(r.failure?' · If it fails: '+esc(r.failure):'')+'</small>';}
function drawConnectionWizard(){
  const d=connectionDraft,from=job(d.fromId);if(!from)return;
  const veil=$('#veil'),artifacts=state.board.artifacts||[],selected=artifacts.find(a=>a.id===d.artifact),r=d.recipients[d.index],to=r&&job(r.id),artName=selected?.name||d.name||'New output';
  const title=['Who needs this output?','What changes hands?','How is it received?','Review connections'][d.step];
  let content='';
  if(d.step===0){content='<p class="hint">Select jobs or tasks. Selecting a job does not select its tasks.</p>'+connectionRecipientGroups(d.fromId).map(g=>'<fieldset class="connection-recipient-group"><legend>'+esc(g.parent.name)+'</legend>'+g.items.map(j=>'<label class="connection-recipient '+(j.parent?'child':'')+'"><input type="checkbox" data-recipient="'+esc(j.id)+'"'+(d.recipients.some(r=>r.id===j.id)?' checked':'')+'><span>'+esc(j.name)+'<small>'+esc(j.parent?'Task':trackOf(j)?.name||'Job')+'</small></span></label>').join('')+'</fieldset>').join('');}
  if(d.step===1){content='<p class="hint">One output from '+esc(from.name)+' will be shared with '+d.recipients.length+' recipient'+(d.recipients.length===1?'':'s')+'.</p><label for="connection-artifact">Output to share</label><select id="connection-artifact"><option value="new">Create an output…</option>'+artifacts.map(a=>'<option value="'+esc(a.id)+'"'+(a.id===d.artifact?' selected':'')+'>'+esc(a.name)+'</option>').join('')+'</select>'+(d.artifact==='new'?'<label for="connection-name">Output name</label><input id="connection-name" value="'+esc(d.name)+'" placeholder="e.g. A sourced review brief"><label for="connection-kind">Output type</label><select id="connection-kind">'+['document','data','decision','message','record','instruction','measure','other'].map(k=>'<option'+(k===d.kind?' selected':'')+'>'+k+'</option>').join('')+'</select>':'');
    if(d.artifact==='new'&&artifacts.some(a=>a.name.trim().toLowerCase()===d.name.trim().toLowerCase()))content+='<label class="connection-recipient"><input id="connection-separate" type="checkbox"'+(d.separate?' checked':'')+'><span>Create a separate output with this name<small>To reuse the existing output, select it above.</small></span></label>';
  }
  if(d.step===2){content='<nav class="connection-queue" aria-label="Recipients">'+d.recipients.map((item,i)=>'<button class="bt q" data-queue="'+i+'"'+(i===d.index?' aria-current="step"':'')+'>'+ (i+1)+'. '+esc(job(item.id)?.name||'Unavailable')+'</button>').join('')+'</nav><div class="connection-queue-heading"><b>Recipient '+(d.index+1)+' of '+d.recipients.length+'</b><button class="bt q" id="connection-remove">Remove recipient</button></div>'+(to?connectionPair(from,to):'<p>This recipient is no longer available. Remove it to continue.</p>')+'<div class="connection-output">'+ei('file-text')+'<b>'+esc(artName)+'</b></div><label for="connection-start">What does receiving this output do?</label><select id="connection-start">'+Object.entries(connectionStarts).map(([v,label])=>'<option value="'+v+'"'+(r.start===v?' selected':'')+'>'+esc(v==='keep'?'Provides information · keep the current start condition':label)+'</option>').join('')+'</select><label for="connection-check">Check on receipt <small>optional</small></label><input id="connection-check" value="'+esc(r.check)+'" placeholder="What must be true before this can be used?"><label for="connection-failure">If the check fails <small>optional</small></label><input id="connection-failure" value="'+esc(r.failure)+'" placeholder="What happens instead?">'+(d.recipients.length>1?'<button class="bt q connection-copy" id="connection-copy">Use these settings for all recipients</button>':'');}
  if(d.step===3){content='<div class="connection-output">'+ei('file-text')+'<b>'+esc(artName)+'</b></div><div class="connection-review-source">'+esc(from.name)+'<small>shares this output with</small></div><div class="connection-review-list">'+d.recipients.map((item,i)=>'<div>'+ei('arrow-right')+'<span>'+connectionRecipientSummary(item)+'</span><button class="bt q" data-edit-recipient="'+i+'">Edit</button></div>').join('')+'</div><p class="hint">Creates '+d.recipients.length+' connection'+(d.recipients.length===1?'':'s')+' in the workflow design. Nothing is executed.</p>';}
  veil.innerHTML='<div class="sheet connection-sheet" role="dialog" aria-modal="true" aria-labelledby="connection-title"><header class="connection-header"><div><small>CONNECT OUTPUT</small><h2 id="connection-title">'+title+'</h2></div><button id="connection-close" class="ib" aria-label="Close connection wizard">'+ei('close')+'</button></header><nav class="connection-steps" aria-label="Connection steps">'+['Recipients','Output','Configure','Review'].map((name,i)=>'<span class="'+(i===d.step?'active':'')+'"'+(i===d.step?' aria-current="step"':'')+'><i>'+(i+1)+'</i>'+name+'</span>').join('')+'</nav><div class="connection-body">'+content+'<p id="connection-error" class="connection-error" role="alert"></p></div><footer class="connection-footer"><button class="bt q" id="connection-back">'+(d.step?'Back':'Cancel')+'</button><span></span><button class="bt acc" id="connection-next">'+(d.step===3?'Create '+d.recipients.length+' connection'+(d.recipients.length===1?'':'s'):d.step===2&&d.index<d.recipients.length-1?'Next recipient':'Continue')+'</button></footer></div>';
  veil.classList.add('show');$('#connection-close').onclick=closeSheet;
  $('#connection-back').onclick=()=>{saveConnectionFields();if(d.step===2&&d.index>0)d.index--;else if(d.step)d.step--;else{closeSheet();return;}drawConnectionWizard();};
  veil.querySelectorAll('[data-recipient]').forEach(el=>el.onchange=()=>{if(el.checked)d.recipients.push({id:el.dataset.recipient,start:'keep',check:'',failure:''});else d.recipients=d.recipients.filter(r=>r.id!==el.dataset.recipient);});
  $('#connection-artifact')?.addEventListener('change',()=>{saveConnectionFields();drawConnectionWizard();});
  $('#connection-remove')?.addEventListener('click',()=>{d.recipients.splice(d.index,1);d.index=Math.max(0,Math.min(d.index,d.recipients.length-1));if(!d.recipients.length)d.step=0;drawConnectionWizard();});
  $('#connection-copy')?.addEventListener('click',()=>{saveConnectionFields();const current=d.recipients[d.index];d.recipients.forEach(item=>Object.assign(item,{start:current.start,check:current.check,failure:current.failure}));$('#connection-copy').textContent='Settings copied to all recipients';});
  veil.querySelectorAll('[data-queue],[data-edit-recipient]').forEach(el=>el.onclick=()=>{saveConnectionFields();d.index=Number(el.dataset.queue??el.dataset.editRecipient);d.step=2;drawConnectionWizard();});
  $('#connection-next').onclick=async()=>{
    saveConnectionFields();let error='';
    if(!d.recipients.length)error='Select at least one recipient.';
    if(d.step===1&&d.artifact==='new'&&!d.name)error='Give the shared output a name.';
    if(d.step===1&&d.artifact==='new'&&!d.separate&&artifacts.some(a=>a.name.trim().toLowerCase()===d.name.toLowerCase())){drawConnectionWizard();error='Choose the existing output above, or confirm that this is a separate output.';}
    if(d.step===2&&r.failure&&!r.check)error='Describe the check before defining what happens if it fails.';
    if(error){$('#connection-error').textContent=error;return;}
    if(d.step<3){if(d.step===2&&d.index<d.recipients.length-1)d.index++;else{d.step++;if(d.step===2)d.index=0;}drawConnectionWizard();return;}
    const button=$('#connection-next');veil.dataset.saving='true';veil.querySelectorAll('button').forEach(b=>b.disabled=true);button.textContent='Creating…';
    try{await applyConnection();delete veil.dataset.saving;closeSheet();toast('Connections saved in the design');}catch(e){delete veil.dataset.saving;drawConnectionWizard();$('#connection-error').textContent=e.message;}
  };
  veil.querySelector('.connection-sheet').onkeydown=e=>{if(e.key!=='Tab')return;const controls=[...veil.querySelectorAll('button:not(:disabled),input,select')].filter(x=>x.offsetParent!==null),first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}};
  $('#connection-close').focus();
}
function saveConnectionFields(){const d=connectionDraft;for(const key of ['artifact','name','kind']){const el=$('#connection-'+key);if(el)d[key]=el.value.trim();}for(const key of ['start','check','failure']){const el=$('#connection-'+key);if(el&&d.recipients[d.index])d.recipients[d.index][key]=el.value.trim();}if($('#connection-separate'))d.separate=$('#connection-separate').checked;}
function connectionOperations(d){
  const from=job(d.fromId),recipients=d.recipients||[{id:d.toId,start:d.start,check:d.check,failure:d.failure}];
  if(!from||from.removed||!recipients.length||recipients.some(r=>!job(r.id)||job(r.id).removed||r.id===d.fromId))throw new Error('A job is no longer available. Reopen the connection.');
  if(recipients.some(r=>r.failure&&!r.check))throw new Error('Describe the check before defining what happens if it fails.');
  const existing=d.artifact==='new'?undefined:state.board.artifacts.find(a=>a.id===d.artifact);
  if(d.artifact==='new'&&!d.name.trim())throw new Error('Give the shared output a name.');
  if(d.artifact!=='new'&&!existing)throw new Error('This output is no longer available. Choose another output.');
  const id=existing?.id||'artifact-'+crypto.randomUUID(),ops=[];
  if(!existing)ops.push({t:'artifact',artifact:{id,name:d.name,kind:d.kind}});
  if(!(from.outputs||[]).includes(id))ops.push({t:'updateJob',id:from.id,patch:{outputs:[...(from.outputs||[]),id]}});
  for(const r of recipients){const to=job(r.id),patch={};if(!(to.inputs||[]).includes(id))patch.inputs=[...(to.inputs||[]),id];if(r.start&&r.start!=='keep')patch.trigger=r.start;if(r.check&&!(to.checks||[]).some(c=>c.rule===r.check&&c.onFail===(r.failure||undefined)))patch.checks=[...(to.checks||[]),{rule:r.check,...(r.failure?{onFail:r.failure}:{})}];if(Object.keys(patch).length)ops.push({t:'updateJob',id:to.id,patch});}
  return ops;
}
async function applyConnection(){const ops=connectionOperations(connectionDraft);if(ops.length)await checkedOp(ops);}
