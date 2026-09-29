import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../home.js',import.meta.url),'utf8');

test('deleting a board requires explicit confirmation and focuses Cancel',async()=>{
  const nodes=new Map(['.close','#manage-cancel','#manage-confirm','#manage-error'].map(id=>[id,{focus(){this.focused=true;}}]));
  const requests=[];
  const dialog={querySelector:id=>nodes.get(id),showModal(){this.open=true;},close(){this.open=false;}};
  const context=vm.createContext({dialog,workspaceData:{boards:[{id:'a',title:'A <board>'}],templates:[]},crypto:{randomUUID:()=> 'request'},escapeHtml:value=>value.replaceAll('<','&lt;'),requestJson:async(...args)=>requests.push(args),load:async()=>{},focusHeading(){}});
  vm.runInContext(source.slice(source.indexOf('function manageBoard('),source.indexOf('let setup={}')),context);
  vm.runInContext("manageBoard('a','delete')",context);
  assert.equal(requests.length,0);assert.equal(nodes.get('#manage-cancel').focused,true);
  assert.match(dialog.innerHTML,/cannot be undone/);
  nodes.get('#manage-cancel').onclick();assert.equal(requests.length,0);
  vm.runInContext("manageBoard('a','delete')",context);
  await nodes.get('#manage-confirm').onclick({currentTarget:nodes.get('#manage-confirm')});
  assert.equal(requests.length,1);
  assert.equal(requests[0][0],'./workspace-api/boards?board=a');
  assert.equal(requests[0][1].method,'DELETE');
  assert.equal(JSON.parse(requests[0][1].body).confirm,true);
});
