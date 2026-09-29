import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('./workspace.js',import.meta.url),'utf8');
const resizeSource=source.slice(source.indexOf('// The sidebar owns one remembered width'));
function fixture(saved=600){
  const listeners={},attributes={},properties={},storage=new Map([['staves:conversation-width',String(saved)]]);
  const handle={setAttribute:(key,value)=>attributes[key]=value,addEventListener:(key,fn)=>listeners[key]=fn,setPointerCapture:()=>{}};
  const context=vm.createContext({document:{createElement:()=>handle,body:{append:()=>{},classList:{add:()=>{},remove:()=>{}}},documentElement:{style:{setProperty:(key,value)=>properties[key]=value}}},window:{innerWidth:1400,addEventListener:()=>{}},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},requestAnimationFrame:()=>{},minimap:()=>{}});
  vm.runInContext(resizeSource,context);
  return {context,listeners,attributes,properties,storage};
}
test('sidebar restores remembered width and clamps to viewport without losing preference',()=>{
  const f=fixture();assert.equal(f.properties['--staves-conversation-width'],'600px');
  f.context.window.innerWidth=800;vm.runInContext('applyConversationWidth()',f.context);assert.equal(f.attributes['aria-valuenow'],'500');
  f.context.window.innerWidth=1400;vm.runInContext('applyConversationWidth()',f.context);assert.equal(f.attributes['aria-valuenow'],'600');
});
test('keyboard width controls and pointer drag obey bounds and persist',()=>{
  const f=fixture();const key=key=>f.listeners.keydown({key,preventDefault(){},stopPropagation(){}});
  key('ArrowLeft');assert.equal(f.storage.get('staves:conversation-width'),'620');
  key('End');assert.equal(f.attributes['aria-valuenow'],'850');
  key('Home');assert.equal(f.attributes['aria-valuenow'],'320');
  f.listeners.pointerdown({button:0,pointerId:1,clientX:1000,preventDefault(){}});
  f.listeners.pointermove({pointerId:1,clientX:700});assert.equal(f.attributes['aria-valuenow'],'620');
  f.listeners.pointerup();f.listeners.pointermove({pointerId:1,clientX:500});assert.equal(f.attributes['aria-valuenow'],'620');
});
