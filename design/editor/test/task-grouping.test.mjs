import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {fold} from '../../../dist/ops.js';
const source = await readFile(new URL('../task-grouping.js', import.meta.url), 'utf8');
function harness() {
  const jobs = [
    {id:'parent-a', name:'First job', track:'human', inputs:[], outputs:[]},
    {id:'parent-b', name:'Second job', track:'agent', inputs:[], outputs:[]},
    {id:'a', name:'Research', parent:'parent-a', track:'human', inputs:['brief'], outputs:['research'], trigger:'event'},
    {id:'b', name:'Summarize', parent:'parent-b', track:'agent', inputs:['research'], outputs:['summary'], gate:{rule:'Review'}},
  ];
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {value:'', disabled:false, isConnected:true, dataset:{}, classList:{add(){}}, focus(){}, querySelector(){return element('sheet');}});
    return elements.get(id);
  };
  const calls = [], notices = [];
  const sandbox = {window:{}, document:{activeElement:null}, crypto:webcrypto,
    state:{name:'test', multi:new Set(), board:{jobs}}, job:id=>jobs.find(j=>j.id===id),
    trackOf:j=>({id:j.track,name:j.track}), $:element, esc:value=>value,
    toast:message=>notices.push(message), closeSheet(){}, select(){}, checkedOp:async ops=>calls.push(JSON.parse(JSON.stringify(ops)))};
  vm.createContext(sandbox); vm.runInContext(source,sandbox);
  return {jobs, elements, sandbox, calls, notices, open:()=>sandbox.window.combineTasksIntoJob('a','b'), save:()=>element('#task-group-save').onclick()};
}
test('opening or cancelling combine does not mutate tasks', () => {
  const h = harness(); const before=structuredClone(h.jobs); h.open();
  assert.match(h.elements.get('#veil').innerHTML, /Create job with 2 tasks/);
  h.elements.get('#task-group-cancel').onclick();
  assert.deepEqual(h.jobs,before); assert.equal(h.calls.length,0);
});
test('combining performs one collect and retains task IDs, roles and handoffs', async () => {
  const h=harness(); h.open(); h.elements.get('#task-group-name').value='  Shared result  '; await h.save();
  assert.equal(h.calls.length,1); assert.equal(h.calls[0].length,1);
  const op=h.calls[0][0]; assert.equal(op.t,'collect'); assert.equal(op.name,'Shared result'); assert.equal(op.track,'agent');
  const entries=[...h.jobs.map(job=>({t:'job',job})),op].map((op,seq)=>({op,seq,id:String(seq),at:'2026-09-09',by:'human'}));
  const board=fold(entries);
  for(const task of h.jobs.filter(j=>j.parent)) {
    assert.deepEqual(board.jobs.find(j=>j.id===task.id),{...task,parent:op.id,replacedBy:undefined});
  }
  assert.equal(board.jobs.length,5);
});
test('blank name and stale placements block writes', async () => {
  const h=harness(); h.open(); await h.save(); assert.equal(h.calls.length,0);
  h.elements.get('#task-group-name').value='Result'; h.jobs[2].parent='parent-b'; await h.save();
  assert.equal(h.calls.length,0); assert.match(h.elements.get('#task-group-error').textContent,/moved/);
});
test('board switches and removed tasks block writes', async () => {
  for(const change of [h=>h.sandbox.state.name='other',h=>h.jobs[2].removed=true]) {
    const h=harness(); h.open(); h.elements.get('#task-group-name').value='Result'; change(h); await h.save(); assert.equal(h.calls.length,0);
  }
});
test('rejects self, non-task, ancestor/descendant and circular parent grouping', () => {
  for(const setup of [h=>h.jobs[2].parent='b', h=>h.jobs[3].parent='a', h=>h.jobs[0].parent='a', h=>delete h.jobs[2].parent]) {
    const h=harness(); setup(h); h.open(); assert.equal(h.elements.size,0); assert.equal(h.notices.length,1);
  }
  const h=harness(); h.sandbox.window.combineTasksIntoJob('a','a'); assert.equal(h.elements.size,0);
});
test('failed save keeps the confirmation open and supports retry', async () => {
  const h=harness(); h.sandbox.checkedOp=async()=>{throw new Error('Save failed');}; h.open();
  h.elements.get('#task-group-name').value='Result'; await h.save();
  assert.equal(h.elements.get('#task-group-error').textContent,'Save failed');
  assert.equal(h.elements.get('#task-group-save').disabled,false);
  assert.equal(h.elements.get('#veil').dataset.saving,undefined);
});
