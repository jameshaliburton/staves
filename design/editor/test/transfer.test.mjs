import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../transfer.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf("  $('#transfer-accept').onclick"),source.indexOf("  veil.querySelector('.transfer-sheet').onkeydown"));
test('retry accepts the already-created role proposal rather than creating another',async()=>{
  const elements=new Map();const view={seq:null};let proposals=0,accepts=0;
  const sandbox={view,plan:{jobId:'a',toTrack:'agent',basis:'current'},placement:{},supersedes:null,state:{name:'test'},veil:{dataset:{}},transferView:view,
    $:selector=>{if(!elements.has(selector))elements.set(selector,{disabled:false,isConnected:true,textContent:''});return elements.get(selector);},
    transferUrl:()=>'/handover',transferRequest:async()=>{proposals++;return {seq:17};},checkedOp:async ops=>{assert.equal(ops[0].seq,17);if(++accepts===1)throw new Error('Temporary error');},closeSheet:()=>{},toast:()=>{}};
  vm.createContext(sandbox);vm.runInContext(handler,sandbox);
  await elements.get('#transfer-accept').onclick();
  assert.equal(view.seq,17);assert.equal(elements.get('#transfer-accept').disabled,false);
  await elements.get('#transfer-accept').onclick();
  assert.equal(proposals,1);assert.equal(accepts,2);assert.equal(sandbox.veil.dataset.saving,undefined);
});
