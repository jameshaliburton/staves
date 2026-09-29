import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const home=readFileSync(new URL('../home.js',import.meta.url),'utf8');

test('failed account polling clears stale availability without replacing focused controls',async()=>{
  const nodes=new Map();
  for(const id of ['#account-model-state','#account-model-note','#account-last-check','#account-version','#sidebar-status','#connection-status']) nodes.set(id,{textContent:'',dataset:{}});
  const focused={id:'retry-status'};
  const document={activeElement:focused,querySelector:id=>nodes.get(id)};
  let fail=false;
  const context=vm.createContext({document,Date,isHostedWorkspace:false,requestJson:async()=>{if(fail)throw new Error('Offline');return {version:'1',model:{status:'ready'}};}});
  const paint=home.slice(home.indexOf('function paintAccountStatus()'),home.indexOf('const colors='));
  const poll=home.slice(home.indexOf('let statusPending='),home.indexOf('async function loadConfig'));
  vm.runInContext('let workspaceStatus=null,statusChecked=null;'+paint+poll,context);
  await vm.runInContext('status()',context);
  assert.equal(nodes.get('#account-model-state').textContent,'Interview model available');
  fail=true;
  await vm.runInContext('status()',context);
  assert.equal(nodes.get('#account-model-state').textContent,'Status unavailable');
  assert.equal(nodes.get('#sidebar-status').textContent,'Status unavailable');
  assert.equal(nodes.get('#account-model-state').dataset.available,'false');
  assert.equal(document.activeElement,focused);
  assert.match(nodes.get('#account-last-check').textContent,/Last checked/);
});

test('the Review tab keeps its way back: focus mode is for talking, not for review',()=>{
 const source=readFileSync(new URL('../onboarding.js',import.meta.url),'utf8');
 const start=source.indexOf('function paintFocusedInterview(');
 // just the first two statements: the condition and the class it toggles
 const script=source.slice(start,source.indexOf('if(!active)return;',start))+'}';
 const body={classes:new Set(),classList:{toggle(name,on){on?body.classes.add(name):body.classes.delete(name);}}};
 const context=vm.createContext({document:{body,querySelector:()=>null},$:()=>null,
  conversationOpen:true,IV:{board:'b'},state:{name:'b'},focusedInterview:false,stavesTab:'discuss'});
 vm.runInContext(script,context);
 context.paintFocusedInterview();
 assert.equal(body.classes.has('interview-focus'),true,'talking gets the focused conversation');
 context.stavesTab='review';
 context.paintFocusedInterview();
 assert.equal(body.classes.has('interview-focus'),false,'review does not, so the tabs that lead back stay visible');
});
