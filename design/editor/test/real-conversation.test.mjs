import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../real-conversation.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(0,source.indexOf('function conversationCommand')),context);
test('composer begins at one line, grows with text, and caps overflow',()=>{
 const input={style:{},scrollHeight:18};context.sizeConversationInput(input);assert.equal(input.style.height,'24px');assert.equal(input.style.overflowY,'hidden');
 input.scrollHeight=74;context.sizeConversationInput(input);assert.equal(input.style.height,'74px');
 input.scrollHeight=240;context.sizeConversationInput(input);assert.equal(input.style.height,'160px');assert.equal(input.style.overflowY,'auto');
 input.scrollHeight=18;context.sizeConversationInput(input);assert.equal(input.style.height,'24px');
});
test('surface binds real interview operations without creating a second conversation engine',()=>{
 assert.match(source,/const paintBeforeRealConversation=paintFocusedInterview/);
 assert.match(source,/const controlsBeforeRealConversation=paintInterviewState/);
 for(const capability of ['importTranscript','showConversationQuestions','setInterviewActivity','openCaseCheck','openConversationHandoff','stopAndSketch','saveWorkingIntention','autoBuildEnabled','keySheet','toggleTalk'])assert.ok(source.includes(capability),capability);
 assert.ok(!source.includes('MutationObserver'));assert.ok(!source.includes('fetch('));assert.ok(!source.includes('IV.lines.push'));
});
test('the scope stays a direct child of the header, never inside the heading',()=>{
 const script=source.slice(source.indexOf('function placeConversationScope('),source.indexOf('// What an exchange was about'));
 vm.runInContext(script,context);
 const scope={parentElement:null};let appendedToHeader=0;
 // Stop and Close are built in the app header now, so .conversation-heading is permanently empty and a
 // rule hides it. Putting the scope inside it took the only way back out of a focused job with it.
 const heading={append(){assert.fail('the scope must not go inside the heading');}};
 const header={append(node){assert.equal(node,scope);appendedToHeader++;},querySelector(sel){return sel==='.conversation-heading'?heading:null;}};
 context.placeConversationScope(header,scope);
 assert.equal(appendedToHeader,1,'it is appended to the header itself');
 scope.parentElement=header;
 context.placeConversationScope(header,scope);
 assert.equal(appendedToHeader,1,'and is not moved again once it is there');
});
test('phone startup does not query or mutate desktop conversation controls',()=>{
 const phone=vm.createContext({window:{matchMedia:()=>({matches:true})},$:()=>assert.fail('desktop DOM must not be queried')});
 vm.runInContext(source.slice(source.indexOf('function paintRealConversation('),source.indexOf('const paintBeforeRealConversation=')),phone);
 assert.doesNotThrow(()=>phone.paintRealConversation());
});
test('closed or not-yet-mounted conversation does not dereference controls',()=>{
 const unmounted=vm.createContext({$:()=>null});
 vm.runInContext(source.slice(source.indexOf('function paintRealConversation('),source.indexOf('const paintBeforeRealConversation=')),unmounted);
 assert.doesNotThrow(()=>unmounted.paintRealConversation());
});

test('voice shutdown before board load does not inspect missing workflow data',async()=>{
 const onboarding=await readFile(new URL('../onboarding.js',import.meta.url),'utf8');
 const start=onboarding.indexOf('function paintWorkContext()');
 const end=onboarding.indexOf('function workFlowHtml',start);
 const startup=vm.createContext({state:{board:null}});
 vm.runInContext(onboarding.slice(start,end),startup);
 assert.doesNotThrow(()=>vm.runInContext('paintWorkContext()',startup));
});
test('add remaining follows the cards: hidden once nothing is left, disabled while thinking',()=>{
 vm.runInContext(source.slice(source.indexOf('function paintAcceptRemaining('),source.indexOf('function showConversationSuggestions(')),context);
 const button={hidden:false,disabled:false};const form={querySelector:selector=>selector==='.conversation-accept-remaining'?button:null};
 context.$=selector=>selector==='#iv .form'?form:null;
 context.IV={busy:false,cards:[{ops:[{t:'track'}]},{ops:[{t:'track'}],accepted:true,gone:true}]};
 context.paintAcceptRemaining();assert.equal(button.hidden,false);assert.equal(button.disabled,false);
 context.IV.busy=true;context.paintAcceptRemaining();assert.equal(button.disabled,true);
 context.IV={busy:false,cards:[{ops:[{t:'track'}],accepted:true,gone:true},{ops:[],gone:true}]};
 context.paintAcceptRemaining();assert.equal(button.hidden,true);
});

// The strip retired: the agenda in the app header reports the same five classes and carries the
// question that would move each one. paintSettledRow() is kept because the row it builds is still
// the clearest statement of who settled what, and the agenda sheet is the next place for it.
test('the settled row says who settled each class, and clicking one steers there',async()=>{
 const script=source.slice(source.indexOf('const SETTLED_LABEL='),source.indexOf('function paintRealConversation('));
 const said=[];const made=[];const node=tag=>{const n={tag,children:[],dataset:{},attributes:{},innerHTML:'',id:'',
  append(...kids){n.children.push(...kids);},remove(){n.removed=true;},
  // enough of a DOM for the row: the buttons it just wrote, and the detail line under them
  // the same button objects every call, so handlers the code attaches survive
  querySelectorAll(sel){
   if(n._html!==n.innerHTML){n._html=n.innerHTML;
    n._buttons=(n.innerHTML.match(/data-class="(\w+)"/g)||[]).map(m=>{const cls=m.match(/"(\w+)"/)[1];
     return {dataset:{class:cls},disabled:new RegExp('data-class="'+cls+'"[^>]*disabled').test(n.innerHTML)};});}
   return n._buttons;},
  querySelector(sel){return sel==='#settled-tip'?(n.detail??=node('span')):null;},
  setAttribute(k,v){n.attributes[k]=v;},toggleAttribute(k,on){if(on)n.attributes[k]='';else delete n.attributes[k];}};return n;};
 const header=node('div');
 const ops=[];
 const context=vm.createContext({
  $:selector=>selector==='#focused-interview-header'?header:(made.find(n=>n.id===selector.slice(1))||null),
  document:{createElement:tag=>{const n=node(tag);made.push(n);return n;}},
  esc:s=>String(s),toast(){},checkedOp:async o=>{ops.push(...o);},
  IV:{topics:['roles']},say(text){said.push({who:'person',text});},askAsStaves(text){said.push({who:'staves',text});},
  state:{board:{ledger:[
   {class:'roles',state:'closed',by:'human',quote:"that's all of them",summary:'8 named'},
   {class:'handoffs',state:'closed',by:'staves',quote:'nothing else was passed',summary:'4 derived'},
   {class:'exceptions',state:'untouched',summary:'no way out described'},
  ]}},
 });
 vm.runInContext(script,context);
 context.paintSettledRow();
 const row=made.find(n=>n.id==='settled-row');
 assert.ok(row,'the row is painted into the conversation header');
 assert.match(row.innerHTML,/✓.*Roles/s,'the person’s tick');
 assert.match(row.innerHTML,/◐.*Handoffs/s,'Staves’ tick is drawn differently');
 assert.match(row.innerHTML,/by-staves/,'and labelled as its own');
 // the detail is a line under the strip now, reachable by hover and by keyboard
 const roles=row.querySelectorAll('.settled-item').find(b=>b.dataset.class==='roles');
 roles.onfocus?.();
 assert.match(row.querySelector('#settled-tip').textContent,/settled by you/,'focus says who settled it');
 const handoffs=row.querySelectorAll('.settled-item').find(b=>b.dataset.class==='handoffs');
 handoffs.onmouseenter?.();
 assert.match(row.querySelector('#settled-tip').textContent,/settled by Staves/,'and that Staves settled its own');
 handoffs.onmouseleave?.();
 assert.equal(row.querySelector('#settled-tip').textContent,'','and it clears when you leave');
 assert.match(row.innerHTML,/data-class="roles"[^>]*data-live="true"/,'the class this exchange is about is ringed');
 await context.steerTo('exceptions');
 assert.match(said.at(-1).text,/exceptions/i,'it goes there');
 assert.equal(said.at(-1).who,'staves','staves asks; putting the question in the person’s mouth would make them interview themselves');
 await context.steerTo('roles');
 assert.equal(JSON.stringify(ops),'[]','clicking a settled class never writes to the board');
 assert.match(said.at(-1).text,/roles/i,'it only asks');
});
