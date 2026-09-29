import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=await readFile(new URL('../connections.js',import.meta.url),'utf8');
function harness(){
  const jobs=[{id:'sender',outputs:[]},{id:'receiver',inputs:[]}];
  const operations=[];
  const sandbox={crypto:webcrypto,state:{board:{artifacts:[{id:'existing',name:'Report',kind:'document'}]}},job:id=>jobs.find(j=>j.id===id),checkedOp:async ops=>operations.push(...ops)};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);
  return {sandbox,operations};
}
test('creating an identically named output preserves separate identity',async()=>{
  const {sandbox,operations}=harness();
  await vm.runInContext("connectionDraft={fromId:'sender',toId:'receiver',artifact:'new',name:'Report',kind:'document',start:'keep',check:'',failure:'',separate:true};applyConnection()",sandbox);
  const created=operations.find(o=>o.t==='artifact');assert.ok(created);assert.notEqual(created.artifact.id,'existing');
  assert.equal(operations.find(o=>o.id==='receiver').patch.inputs[0],created.artifact.id);
});
test('existing output is reused only by explicit identity',async()=>{
  const {sandbox,operations}=harness();
  await vm.runInContext("connectionDraft={fromId:'sender',toId:'receiver',artifact:'existing',name:'Report',start:'keep',check:'',failure:''};applyConnection()",sandbox);
  assert.ok(!operations.some(o=>o.t==='artifact'));
  assert.equal(operations.find(o=>o.id==='receiver').patch.inputs[0],'existing');
});
test('missing selected output rejects without saving a connection',async()=>{
  const {sandbox,operations}=harness();
  await assert.rejects(vm.runInContext("connectionDraft={fromId:'sender',toId:'receiver',artifact:'deleted',name:'Report',start:'keep'};applyConnection()",sandbox),/no longer available/);
  assert.equal(operations.length,0);
});
test('multiple recipients share one output and keep independent start conditions',async()=>{
  const {sandbox,operations}=harness();
  const jobs=[{id:'sender',outputs:[]},{id:'first',inputs:[],trigger:'hand'},{id:'second',inputs:['prior'],trigger:'chain'}];sandbox.job=id=>jobs.find(j=>j.id===id);
  await vm.runInContext("connectionDraft={fromId:'sender',recipients:[{id:'first',start:'event',check:'Has evidence',failure:'Return for revision'},{id:'second',start:'keep',check:'',failure:''}],artifact:'new',name:'Brief',kind:'document'};applyConnection()",sandbox);
  assert.equal(operations.filter(o=>o.t==='artifact').length,1);
  const first=operations.find(o=>o.id==='first').patch,second=operations.find(o=>o.id==='second').patch;
  assert.equal(first.inputs[0],second.inputs[1]);assert.equal(first.trigger,'event');assert.equal(second.trigger,undefined);assert.equal(first.checks[0].onFail,'Return for revision');assert.equal(second.checks,undefined);
});
test('invalid recipient aborts the whole batch without writes',async()=>{
  const {sandbox,operations}=harness();
  await assert.rejects(vm.runInContext("connectionDraft={fromId:'sender',recipients:[{id:'receiver',start:'keep'},{id:'missing',start:'event'}],artifact:'new',name:'Brief',kind:'document'};applyConnection()",sandbox),/no longer available/);
  assert.equal(operations.length,0);
});
test('recipient groups preserve job/task distinction and exclude sender',()=>{
  const {sandbox}=harness();sandbox.state.board.jobs=[{id:'parent',name:'Parent'},{id:'task',name:'Task',parent:'parent'},{id:'other',name:'Other'},{id:'removed',removed:true}];
  const groups=vm.runInContext("connectionRecipientGroups('task')",sandbox);
  assert.equal(groups[0].parent.id,'parent');assert.deepEqual(Array.from(groups[0].items,j=>j.id),['parent']);assert.equal(groups.length,2);
});
test('opening a queue performs no operations and preserves recipient identities',()=>{
  const {sandbox,operations}=harness();vm.runInContext('drawConnectionWizard=()=>{};beginConnectionQueue("sender",["receiver"])',sandbox);
  assert.equal(operations.length,0);assert.equal(vm.runInContext('connectionDraft.recipients[0].id',sandbox),'receiver');assert.equal(vm.runInContext('connectionDraft.step',sandbox),1);
});
