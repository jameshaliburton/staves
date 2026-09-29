import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {emptyBoard} from '../../../dist/model.js';
import {walkthroughBasis} from '../../../dist/walkthrough-record.js';
const source=readFileSync(new URL('../rehearsal.js',import.meta.url),'utf8');
function harness(board){
 const nodes=new Map(),removed=[];
 const node=()=>({hidden:true,disabled:false,innerHTML:'',textContent:'',addEventListener(){},setAttribute(){},classList:{remove(...values){removed.push(...values);}}});
 const panel=node();
 const context=vm.createContext({state:{name:board.id,board},document:{createElement:()=>panel,body:{append(){},classList:{remove(...values){removed.push(...values);}}}},$:selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);},$$:()=>[],render(){},timeline(){},structuredClone,esc:String});
 vm.runInContext(source.slice(source.indexOf('/* Scenarios preview')),context);
 return {context,panel,nodes,removed};
}
test('scenario uses a nonmodal panel and compares authoritative design semantics',()=>{
 const board=emptyBoard('test');const h=harness({...board,handoffs:[],findings:[],scorecard:{},proposalsList:[]});
 assert.equal(h.context.caseBoardSignature(),walkthroughBasis(board));
 assert.equal(h.panel.hidden,true);
 assert.doesNotMatch(source.slice(source.indexOf('/* Scenarios preview')),/showModal\(/);
});
test('a design edit invalidates the preview and disables saving',()=>{
 const board=emptyBoard('test'),h=harness(board);
 vm.runInContext("casePanel.hidden=false;caseBoard='test';caseSignature=caseBoardSignature();casePreview={steps:[],questions:[],waits:[]};",h.context);
 board.goal='Changed after preview';h.context.caseSync();
 assert.equal(vm.runInContext('casePreview',h.context),null);
 assert.equal(h.nodes.get('#case-save').disabled,true);
 assert.match(h.nodes.get('#case-result').innerHTML,/design changed/);
});
test('switching boards closes the panel and invalidates outstanding requests',()=>{
 const h=harness(emptyBoard('first'));
 vm.runInContext("casePanel.hidden=false;caseBoard='first';caseRequest=4;",h.context);
 h.context.state.name='second';h.context.caseSync();
 assert.equal(h.panel.hidden,true);
 assert.equal(vm.runInContext('caseRequest',h.context),5);
});
