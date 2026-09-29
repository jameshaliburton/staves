import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardsFromModel, modelFlow } from '../interviewer.js';
import { fold, type Entry, type Op } from '../ops.js';
const initial: Op[] = [
  {t:'board', id:'b', title:'Vendor bids'},
  {t:'track',track:{id:'team',name:'Team',kind:'person'}},
  {t:'job',job:{id:'invite',name:'Vendors invited',track:'team',status:'draft',provenance:{source:'agent',by:'test'},inputs:[],outputs:['brief']}},
  {t:'job',job:{id:'research',name:'Research vendors',track:'team',parent:'invite',status:'draft',provenance:{source:'agent',by:'test'},inputs:['criteria'],outputs:['candidates']}},
  {t:'job',job:{id:'network',name:'Ask network',track:'team',parent:'invite',status:'draft',provenance:{source:'agent',by:'test'},inputs:[],outputs:[]}},
];
const entries = (ops: Op[]): Entry[] => ops.map((op, i) => ({op,seq:i+1,by:'test',at:'2026-09-08'}));
const board=fold(entries(initial));
test('late upstream outcome collects existing tasks without duplicating or stripping their links',()=>{
 const quote='We research and ask our network, then shortlist vendors before inviting bids.';
 const card=cardsFromModel([{type:'job',name:'Vendors shortlisted',who:'Team',collectTasks:['research','network'],before:'invite',quote,confidence:'said'}],board,quote)[0];
 const result=fold(entries([...initial,...card.ops]));
 const outcome=result.jobs.find(j=>j.name==='Vendors shortlisted')!;
 assert.ok(outcome); assert.equal(result.jobs.length,4);
 const task=result.jobs.find(j=>j.id==='research')!;
 assert.equal(task.parent,outcome.id); assert.deepEqual(task.inputs,['criteria']); assert.deepEqual(task.outputs,['candidates']);
 assert.equal(result.jobs.find(j=>j.id==='network')?.parent,outcome.id);
 assert.ok(outcome.order! < (result.jobs.find(j=>j.id==='invite')?.order ?? 0));
 assert.deepEqual(outcome.inputs,[]);
});
test('emission order never creates handoff edges',()=>{
 const cards=cardsFromModel(['A','B'].map(name=>({type:'job',name,who:'Team'})),board);
 const jobs=cards.flatMap(c=>c.ops).filter(o=>o.t==='job');
 assert.equal(jobs.length,2); for(const op of jobs) assert.deepEqual(op.job.inputs,[]);
});
test('same-response parent can receive a moved task and explicit output evidence can connect a job',()=>{
 const quote='The invitation brief goes to the vendor. Research belongs to the new shortlist outcome.';
 const cards=cardsFromModel([{type:'job',name:'Shortlist',who:'Team'}, {type:'move',target:'research',job:'Shortlist',name:'Move research',quote,confidence:'said'}, {type:'job',name:'Proposal prepared',who:'Team',inputs:['brief'],quote,confidence:'said'}],board,quote);
 const result=fold(entries([...initial,...cards.flatMap(c=>c.ops)]));
 assert.equal(result.jobs.find(j=>j.id==='research')?.parent,result.jobs.find(j=>j.name==='Shortlist')?.id);
 assert.deepEqual(result.jobs.find(j=>j.name==='Proposal prepared')?.inputs,['brief']);
});
test('ambiguous, hypothetical and invalid structural references do not execute',()=>{
 for(const extra of [{collectTasks:['missing']},{before:'research'},{before:'missing'},{inputs:['invented']},{collectTasks:['invite']}]) {
  assert.deepEqual(cardsFromModel([{type:'job',name:'X',quote:'Earlier work',confidence:'said',...extra}],board,'Earlier work')[0].ops,[]);
 }
 assert.deepEqual(cardsFromModel([{type:'move',target:'research',job:'invite',quote:'Maybe research belongs here',confidence:'said'}],board,'Maybe research belongs here')[0].ops,[]);
});
test('model receives nonlinear reconciliation and automatic reflection guidance',async()=>{
 await modelFlow(board,[],'Earlier we shortlist vendors',async(system,user)=>{
  assert.match(system,/Conversation order is not workflow order/);
  assert.match(system,/collectTasks/);
  assert.match(system,/silently reconcile/i);
  assert.match(user,/"inputs":\["criteria"\]/);
  return JSON.stringify({reply:'Who participates?',cards:[]});
 });
});
test('reflection can reconcile earlier person evidence without requiring it to be repeated',async()=>{
 const earlier='Research and network recommendations produce the shortlist before invitations.';
 let parsedOps: Op[]=[];
 const turn=await modelFlow(board,[{who:'person',text:earlier}], 'Reflect on the workflow', async()=>JSON.stringify({reply:'The shortlist belongs before invitations.',cards:[{type:'job',name:'Shortlist ready',who:'Team',collectTasks:['research','network'],before:'invite',quote:earlier,confidence:'said'}]}));
 parsedOps=turn.cards.flatMap(c=>c.ops);
 assert.equal(parsedOps.filter(o=>o.t==='updateJob').length,2);
 assert.ok(parsedOps.some(o=>o.t==='reorder'));
 assert.deepEqual(cardsFromModel([{type:'job',name:'Shortlist ready',collectTasks:['research'],quote:earlier,confidence:'said'}],board,'Reflect on the workflow')[0].ops,[]);
});
