import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../onboarding.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function workValues('),source.indexOf('function saveWorkDraft(')),context);
const item={id:'task',name:'Research',parent:'job',track:'team',trigger:'event',triggerNote:'When a brief arrives',inputs:['brief'],outputs:['report'],checks:[{rule:'Sources verified',onFail:'Ask owner'}]};
test('unchanged editor values produce no operations',()=>{assert.deepEqual(JSON.parse(JSON.stringify(context.workPatch(item,context.workValues(item)))),{});});
test('editing name preserves trigger, outputs and structured checks',()=>{const values={...context.workValues(item),name:'Research vendors'};assert.deepEqual(JSON.parse(JSON.stringify(context.workPatch(item,values))),{name:'Research vendors'});});
test('editing another field does not overwrite a concurrent model update',()=>{const baseline=context.workValues(item),values={...baseline,name:'Research suppliers'};const updated={...item,trigger:'clock'};assert.deepEqual(JSON.parse(JSON.stringify(context.workPatch(updated,values,baseline))),{name:'Research suppliers'});});
test('changed checks keep existing on-failure behavior',()=>{const values={...context.workValues(item),checks:'Sources verified\nOwner reviews'};assert.deepEqual(JSON.parse(JSON.stringify(context.workPatch(item,values))).checks,[{rule:'Sources verified',onFail:'Ask owner'},{rule:'Owner reviews'}]);});
test('blank task names are rejected without a write',()=>{assert.throws(()=>context.workPatch(item,{...context.workValues(item),name:'  '}),/name/);});
function saveHarness(){
 let current={...item},writes=[],reviews=[];
 const form={dataset:{baseline:JSON.stringify(context.workValues(current))},elements:{track:{value:current.track}}},status={};
 const c=vm.createContext({state:{name:'test'},job:()=>current,trackOf:()=>({kind:'person'}),track:()=>({kind:'agent'}),$:selector=>selector==='#work-form'?form:status,workPatch:context.workPatch,workDraftKey:id=>'test:'+id,op:async ops=>{writes.push(...ops);current={...current,...ops[0].patch};},inspectTransfer:async(id,to)=>reviews.push({id,to})});
 vm.runInContext("let workSave=Promise.resolve(),workEditorId='task';const workDrafts=new Map();function captureWorkDraft(){}",c);
 vm.runInContext(source.slice(source.indexOf('function saveWorkDraft('),source.indexOf('function openWorkEditor(')),c);
 const setDraft=values=>{c.values=values;c.baseline=JSON.parse(form.dataset.baseline);vm.runInContext("workDrafts.set('test:task',{values,baseline})",c);};
 return {c,form,writes,reviews,setDraft,update:patch=>{current={...current,...patch};}};
}
test('successive saves rebase acknowledged fields before an agent update',async()=>{
 const h=saveHarness();const first={...context.workValues(item),name:'Research vendors'};h.setDraft(first);await h.c.saveWorkDraft();assert.equal(JSON.parse(h.form.dataset.baseline).name,'Research vendors');
 h.update({name:'Agent corrected name'});h.setDraft({...first,beneficiary:'Buyer'});await h.c.saveWorkDraft();assert.deepEqual(JSON.parse(JSON.stringify(h.writes.at(-1).patch)),{beneficiary:'Buyer'});
});
test('role review preserves other edits and does not claim reassignment was saved',async()=>{
 const h=saveHarness();h.setDraft({...context.workValues(item),name:'Research vendors',track:'agent'});await assert.rejects(()=>h.c.saveWorkDraft(),/Review the role change/);assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0].patch)),{name:'Research vendors'});assert.deepEqual(h.reviews,[{id:'task',to:'agent'}]);assert.equal(h.form.elements.track.value,'team');
});
