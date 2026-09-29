import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../onboarding.js',import.meta.url),'utf8');
function helpers(extra={}){
 const storage=new Map();
 const context=vm.createContext({IV:{board:'board-a',job:'board'},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},...extra});
 vm.runInContext(source.slice(source.indexOf('function conversationLocalKey('),source.indexOf('function paintConversationWorkspace(')),context);
 return context;
}
test('drafts survive a fresh session and isolate both board and explicit node scope',()=>{
 const context=helpers();const a={board:'board-a',job:'board'},b={board:'board-a',job:'node'},other={board:'board-b',job:'board'};
 context.saveConversationLocal('draft','Board draft',a);context.saveConversationLocal('draft','Node draft',b);
 assert.equal(context.readConversationLocal('draft',{...a}),'Board draft');assert.equal(context.readConversationLocal('draft',b),'Node draft');assert.equal(context.readConversationLocal('draft',other),'');
 context.saveConversationLocal('draft','',a);assert.equal(context.readConversationLocal('draft',a),'');assert.equal(context.readConversationLocal('draft',b),'Node draft');
});
test('explicit intention saves one stable typed artifact to the captured session and clears only its draft',async()=>{
 const writes=[];const session={board:'original',job:'node'};const context=helpers({sessionOp:async(s,ops)=>writes.push({s,ops})});
 context.saveConversationLocal('intention','Draft',session);await context.saveWorkingIntention(session,'  Clarify handoffs  ');
 const [write]=JSON.parse(JSON.stringify(writes));assert.deepEqual(write.s,session);assert.equal(write.ops[0].comment.id,'design-conversation:node');assert.equal(write.ops[0].comment.about,'node');assert.deepEqual(write.ops[0].comment.designConversation,{version:1,scope:'node',intention:'Clarify handoffs'});assert.equal(context.readConversationLocal('intention',session),'');
 await assert.rejects(()=>context.saveWorkingIntention(session,'x'.repeat(2001)),/2,000/);assert.equal(writes.length,1);
});
test('workflow goal is context, never an invented user intention',()=>{
 const context=helpers();const board={goal:'Get a result',comments:[]};assert.equal(context.conversationIntention(board,'board'),'');
 board.comments=[{id:'design-conversation:board',about:'board',designConversation:{version:1,scope:'board',intention:'Explore delay'}}];assert.equal(context.conversationIntention(board,'board'),'Explore delay');assert.equal(context.conversationIntention(board,'node'),'');
});
test('return basis detects saved design edits but excludes conversation bookkeeping',()=>{
 const context=helpers();const board={goal:'Goal',jobs:[{id:'node',name:'Initial'}],tracks:[],artifacts:[],comments:[]};const initial=context.conversationBasis(board,'node');board.comments.push({text:'New turn'});assert.equal(context.conversationBasis(board,'node'),initial);board.jobs[0].name='Changed';assert.notEqual(context.conversationBasis(board,'node'),initial);
});
test('empty workflow entry opens the conversation and focuses typing',async()=>{
 let opened=0,focused=0;const context=vm.createContext({startingInterview:false,state:{board:{goal:'Goal'}},openConversation:()=>opened++,$:()=>({focus:()=>focused++}),ask:()=>assert.fail('Opening must not invoke model')});
 vm.runInContext(source.slice(source.indexOf('async function beginWorkflowInterview('),source.indexOf('function paintEmptyStart(')),context);await context.beginWorkflowInterview();assert.equal(opened,1);assert.equal(focused,1);
});
test('focus cannot schedule a model reply while conversation is closed',()=>{
 const context=vm.createContext({conversationOpen:false,workAssessments:{cancel:()=>{},schedule:()=>assert.fail('Closed chat must not invoke model')}});vm.runInContext(source.slice(source.indexOf('function scheduleWorkAssessment('),source.indexOf('function paintWorkContext(')),context);context.scheduleWorkAssessment();
});
test('close preserves automatic building and the conversation while stopping voice',()=>{
 const removed=[];const context=helpers({queueMicrotask:()=>{},state:{name:'board-a',board:{jobs:[],tracks:[],artifacts:[]}},captureConversationDraft:()=>{},$:()=>({classList:{remove:()=>{}},value:'Unsent'}),conversationPanel:{classList:{remove:()=>{}}},suspendConversationVoice:()=>{},document:{body:{classList:{remove:s=>removed.push(s)}}},focusConversationEntry:()=>{}});
 context.saveConversationLocal('draft','Unsent');context.closeDesignConversation();assert.equal(context.readConversationLocal('draft'),'Unsent');assert.ok(removed.includes('work-chat'));
});
test('reopening a mounted conversation restores focused layout and preserves explicit scope',()=>{
 const calls=[];const context=vm.createContext({queueMicrotask:()=>{},openConversation:scope=>calls.push(scope),captureConversationDraft:()=>calls.push('draft'),conversationOpen:false,IV:{board:'a',job:'job-a'},state:{name:'a'},workSpace:{hidden:true},paintFocusedInterview:()=>calls.push('focus'),paintWorkContext:()=>calls.push('context'),readConversationLocal:()=> 'last-close-basis'});
 vm.runInContext(source.slice(source.indexOf('const workOpenConversationBefore='),source.indexOf('const workRevealBefore=')),context);context.openConversation();assert.deepEqual(calls,['draft','job-a','focus','context']);assert.equal(context.IV.returnBasis,'last-close-basis');
});
test('conversation handoff preserves the exact board, scope, intention and unsent draft',()=>{
 const opened=[];let captured=0;
 const context=helpers({state:{board:{comments:[{id:'design-conversation:node',about:'node',designConversation:{version:1,scope:'node',intention:'Clarify ownership'}}]}},captureConversationDraft:()=>captured++,openHandoffExport:options=>opened.push(options)});
 context.captureConversationDraft=()=>captured++;
 context.IV={board:'qa',job:'node',draft:'Who owns this evidence?'};
 context.openConversationHandoff();
 assert.equal(captured,1);
 assert.deepEqual(JSON.parse(JSON.stringify(opened[0])),{board:'qa',jobIds:['node'],intention:'Clarify ownership',draft:'Who owns this evidence?'});
 assert.equal(context.IV.draft,'Who owns this evidence?');
});
test('whole-board conversation handoff does not invent a selected job',()=>{
 const opened=[];const context=helpers({state:{board:{comments:[]}},captureConversationDraft(){},openHandoffExport:options=>opened.push(options)});
 context.captureConversationDraft=()=>{};
 context.openConversationHandoff();
 assert.equal(opened[0].board,'board-a');assert.equal(opened[0].jobIds,undefined);
});
test('same-session return compares against the most recent close after a design edit',()=>{
 let basis='earlier-visit';const board={jobs:[{id:'node',name:'Before'}],tracks:[],artifacts:[]};const context=helpers({queueMicrotask:()=>{},state:{name:'a',board},openConversation(){},captureConversationDraft(){},conversationOpen:false,workSpace:{hidden:true},paintFocusedInterview(){},paintWorkContext(){},$:()=>null});
 context.IV={board:'a',job:'node',returnBasis:'earlier-visit'};
 vm.runInContext(source.slice(source.indexOf('const workOpenConversationBefore='),source.indexOf('const workRevealBefore=')),context);
 basis=context.conversationBasis(board,'node');context.saveConversationLocal('basis',basis);board.jobs[0].name='After';context.openConversation();assert.equal(context.IV.returnBasis,basis);assert.notEqual(context.IV.returnBasis,context.conversationBasis(board,'node'));
});
