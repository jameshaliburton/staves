import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
const navigation=readFileSync(new URL('./navigation.js',import.meta.url),'utf8');
const editor=readFileSync(new URL('./editor.js',import.meta.url),'utf8');
test('Fit uses laid-out collision bounds instead of the column count',async()=>{
  let zoom=1;
  const pane={clientWidth:1280,scrollLeft:0,getBoundingClientRect:()=>({left:0})};
  const notices=[];
  const context=vm.createContext({$:()=>pane,$$:()=>Array.from({length:7},(_,i)=>({getBoundingClientRect:()=>({right:220+(i+1)*(Math.max(54,208*zoom)+14)})})),canvasZoom:value=>{zoom=value;context.detailZoom=value;},detailZoom:1,toast:text=>notices.push(text),requestAnimationFrame:callback=>callback(),minimap:()=>{}});
  vm.runInContext(navigation.slice(navigation.indexOf('fit=async()=>{'),navigation.indexOf('// Native add/reorder')),context);
  await context.fit();
  assert.ok(220+7*(Math.max(54,208*zoom)+14)<=1280-16);
  assert.equal(notices.length,0);
});
test('Fit reports when minimum readable geometry cannot fit',async()=>{
  const pane={clientWidth:320,scrollLeft:0,getBoundingClientRect:()=>({left:0})};const notices=[];
  const context=vm.createContext({$:()=>pane,$$:()=>[{getBoundingClientRect:()=>({right:1000})}],canvasZoom:value=>context.detailZoom=value,detailZoom:1,toast:text=>notices.push(text),requestAnimationFrame:callback=>callback(),minimap:()=>{}});
  vm.runInContext(navigation.slice(navigation.indexOf('fit=async()=>{'),navigation.indexOf('// Native add/reorder')),context);await context.fit();
  assert.match(notices[0],/Minimum readable size/);
});
test('Canvas popover flips and stays inside viewport at bottom-right edge',()=>{
  const context=vm.createContext({innerWidth:800,innerHeight:600});vm.runInContext(editor.slice(editor.indexOf('function positionCanvasPopover')),context);
  const surface={style:{},offsetWidth:270,offsetHeight:200};context.positionCanvasPopover(surface,{getBoundingClientRect:()=>({left:750,top:550,bottom:580})});
  assert.equal(surface.style.left,'522px');assert.equal(surface.style.top,'342px');
});
test('A stack highlights all external handoffs and excludes internal ones',()=>{
  const edges=[['a','x'],['b','y'],['a','b'],['z','y']].map(([from,to])=>({dataset:{from,to},classList:{toggle(name,visible){this.visible=visible;}}}));
  const context=vm.createContext({document:{body:{dataset:{}}},connectionVisibility:'focus',hoveredJob:null,hoveredJobs:new Set(['a','b']),state:{sel:null},$$:()=>edges});
  vm.runInContext(navigation.slice(navigation.indexOf('function paintConnections'),navigation.indexOf('// Hover provides')),context);context.paintConnections();
  assert.deepEqual(edges.map(e=>e.classList.visible),[true,true,false,false]);
});
