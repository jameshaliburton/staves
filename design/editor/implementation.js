/* Implementation progress is distinct from approval of the workflow description. */
const implementationLabels={unknown:'Not yet assessed',planned:'Planned', 'in-progress':'In progress',implemented:'Implemented'};
function editImplementation(id){
  const item=job(id);if(!item)return;
  sheet('Implementation progress',[
    ['state','What is implemented?',null,item.implementation?.state||'unknown',null,Object.entries(implementationLabels).map(([value,label])=>[value,'ph-rectangle',label])],
    ['note','Evidence or remaining work (optional)','What exists, what is missing, and what needs checking',item.implementation?.note||'','area'],
    ['meaning','This describes implementation progress. Accepting a workflow description does not mark it implemented.',null,null,'note']
  ],v=>checkedOp([{t:'updateJob',id,patch:{implementation:{state:v.state||'unknown',note:v.note||undefined}}}]),'ph-pencil-simple');
}
function paintImplementation(){
  $('#implementation-state')?.remove();
  const item=job(state.sel);if(!item)return;
  const row=document.createElement('div');row.id='implementation-state';
  const button=eb(implementationLabels[item.implementation?.state]||implementationLabels.unknown,'pencil-simple',()=>editImplementation(item.id));
  button.setAttribute('aria-label','Implementation: '+button.textContent);
  const label=document.createElement('small');label.textContent='Implementation';row.append(label,button);$('#sh').append(row);
  if(item.implementation?.note)button.title=item.implementation.note;
}
const renderBeforeImplementation=render;
render=function(){renderBeforeImplementation();paintImplementation();};
