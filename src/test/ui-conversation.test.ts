import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {APP2_JS} from '../app2.js';
function functionSource(name:string,next:string){return APP2_JS.slice(APP2_JS.indexOf('async function '+name+'('),APP2_JS.indexOf(next,APP2_JS.indexOf('async function '+name+'(')));}
function fixture(){
 const nodes=new Map<string,{textContent:string;innerHTML:string;disabled:boolean;value:string}>();
 const $=(key:string)=>{if(!nodes.has(key))nodes.set(key,{textContent:'',innerHTML:'',disabled:false,value:''});return nodes.get(key);};
 const writes:unknown[]=[];
 let resolveReply:(value:unknown)=>void=()=>{};
 const reply=new Promise(resolve=>{resolveReply=resolve;});
 const context=vm.createContext({$,AbortSignal,Date,encodeURIComponent,localStorage:{getItem:()=>null},state:{name:'board-a'},IV:{},renderLines:()=>{},paintInterviewState:()=>{},cardsHtml:()=>'',toast:()=>{},load:async()=>{},fetch:async(url:string,init:{body:string})=>{if(url.startsWith('./interview'))return reply;writes.push({url,body:JSON.parse(init.body)});return {ok:true};}});
 vm.runInContext(functionSource('sessionOp','async function retryInterview')+functionSource('say','function renderLines'),context);
 return {context,writes,resolveReply};
}
test('pending reply remains in its captured board and scope after switching',async()=>{
 const f=fixture();vm.runInContext("IV={board:'board-a',job:'board',lines:[],cards:[],busy:false};original=IV;pending=say('Question');",f.context);
 await new Promise(resolve=>setImmediate(resolve));
 vm.runInContext("IV={board:'board-a',job:'job-b',lines:[],cards:[],busy:false};",f.context);
 f.resolveReply({ok:true,json:async()=>({engine:'model',reply:'Board reply',cards:[{name:'Board card'}]})});
 await f.context.pending;
 assert.equal(vm.runInContext('IV.lines.length',f.context),0);
 assert.equal(vm.runInContext('original.lines.at(-1).text',f.context),'Board reply');
 assert.equal(vm.runInContext('original.cards[0].name',f.context),'Board card');
 assert.match(JSON.stringify(f.writes),/"about":"board"/);
});
test('rapid second send is not silently consumed',async()=>{
 const f=fixture();vm.runInContext("IV={board:'board-a',job:'board',lines:[],cards:[],busy:false};pending=say('First');second=say('Second');",f.context);
 await f.context.second;assert.equal(vm.runInContext('IV.lines.length',f.context),1);
 f.resolveReply({ok:true,json:async()=>({engine:'model',reply:'Reply',cards:[]})});await f.context.pending;
});
test('failed card persistence does not mark the suggestion accepted',async()=>{
 const context=vm.createContext({IV:{cards:[{ops:[{}]}]},sessionOp:async()=>{throw new Error('offline');},paintInterviewState:()=>{},toast:()=>{},$:()=>({innerHTML:''}),cardsHtml:()=>''});
 vm.runInContext(functionSource('acceptCard','async function say'),context);await vm.runInContext('acceptCard(0)',context);
 assert.equal(vm.runInContext('IV.cards[0].accepted',context),undefined);
 assert.equal(vm.runInContext('IV.cards[0].pending',context),false);
 assert.equal(vm.runInContext('IV.cards[0].error',context),'offline');
});
test('failed shared form save retains entered values and offers retry',async()=>{
 const nodes=new Map<string,Record<string,unknown>>();
 const classes={add:()=>{},remove:()=>{}};
 const node=(key:string)=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',disabled:false,isConnected:true,classList:classes,dataset:{},focus:()=>{}});return nodes.get(key)!;};
 const value={dataset:{k:'notes'},value:'Keep this carefully written evidence',type:'textarea'};
 const context=vm.createContext({$:node,$$:()=>[value],document:{activeElement:null},setTimeout:()=>{},esc:(v:unknown)=>String(v)});
 vm.runInContext(APP2_JS.slice(APP2_JS.indexOf('let sheetReturnFocus'),APP2_JS.indexOf('function sheetJob')),context);
 vm.runInContext("sheet('Implementation',[['notes','Evidence',null,'Original','area']],async()=>{throw new Error('Network unavailable');});",context);
 const form=node('.sheet');await (form.onsubmit as (event:{preventDefault:()=>void})=>Promise<void>)({preventDefault:()=>{}});
 assert.equal(value.value,'Keep this carefully written evidence');
 assert.equal(node('#sh-ok').textContent,'Retry save');
 assert.equal(node('#sh-ok').disabled,false);
 assert.equal(node('#sheet-error').textContent,'Network unavailable');
 assert.match(String(node('#veil').innerHTML),/role="dialog"/);
 assert.match(String(node('#veil').innerHTML),/label for="sheet-field-0"/);
});
test('dictation never sends on pauses or recognition restart; only explicit finish sends',()=>{
 const sent:string[]=[];const input={value:''};let recognizer:FakeRecognition;
 class FakeRecognition{onresult:(event:unknown)=>void=()=>{};onend:()=>void=()=>{};onerror:(event:unknown)=>void=()=>{};start(){}stop(){}constructor(){recognizer=this;}}
 const context=vm.createContext({IV:{draft:'',busy:false},window:{SpeechRecognition:FakeRecognition},navigator:{language:'en'},$:()=>input,paintInterviewState:()=>{},stopSpeaking:()=>{},say:(text:string)=>sent.push(text)});
 const start=APP2_JS.indexOf('function stopDictation('),end=APP2_JS.indexOf('function keyGate(',start);
 vm.runInContext(APP2_JS.slice(start,end),context);vm.runInContext('toggleMic()',context);
 const result=Object.assign([{transcript:'Here is my first thought.'}],{isFinal:true});recognizer!.onresult({results:[result]});recognizer!.onend();
 assert.equal(sent.length,0);assert.equal(input.value,'Here is my first thought.');
 const next=Object.assign([{transcript:'And another important thing.'}],{isFinal:true});recognizer!.onresult({results:[next]});
 assert.equal(sent.length,0);vm.runInContext('finishVoiceTurn()',context);
 assert.deepEqual(sent,['Here is my first thought. And another important thing.']);
});
test('new replies do not pull a reader away from older messages',()=>{
 const sc={scrollTop:40,clientHeight:300,getBoundingClientRect:()=>({top:50})};const latest={hidden:true};
 const context=vm.createContext({IV:{followLatest:false},$:(selector:string)=>selector==='#ivscroll'?sc:selector==='#iv-latest'?latest:{lastElementChild:{getBoundingClientRect:()=>({bottom:900})}}});
 vm.runInContext(APP2_JS.slice(APP2_JS.indexOf('function scrollInterviewLatest('),APP2_JS.indexOf('async function sessionOp')),context);
 vm.runInContext('scrollInterviewLatest()',context);assert.equal(sc.scrollTop,40);assert.equal(latest.hidden,false);
 vm.runInContext('scrollInterviewLatest(true)',context);assert.equal(sc.scrollTop,614);assert.equal(latest.hidden,true);
});
test('suggestion action describes actual operation rather than model card type',()=>{
 const context=vm.createContext({});vm.runInContext(APP2_JS.slice(APP2_JS.indexOf('function cardAction('),APP2_JS.indexOf('async function revealAccepted')),context);
 assert.equal(vm.runInContext("cardAction({type:'task',ops:[{t:'updateJob',id:'a',patch:{gate:{}}}]})",context),'Update job');
 assert.equal(vm.runInContext("cardAction({type:'gate',ops:[{t:'job',job:{id:'a',parent:'b'}}]})",context),'Add task');
});
test('acknowledged card save remains accepted when board refresh fails',async()=>{
 const context=vm.createContext({IV:{board:'b',cards:[{ops:[{}]}]},state:{name:'b'},fetch:async()=>({ok:true}),load:async()=>{throw new Error('refresh offline');},encodeURIComponent,paintInterviewState:()=>{},toast:()=>{},$:()=>({innerHTML:''}),cardsHtml:()=>''});
 vm.runInContext(functionSource('sessionOp','async function retryInterview')+functionSource('acceptCard','async function say'),context);await vm.runInContext('acceptCard(0)',context);
 assert.equal(vm.runInContext('IV.cards[0].accepted',context),true);
 assert.match(vm.runInContext('IV.refreshError',context),/Saved, but/);
});
test('pending response cannot speak when its conversation has closed',async()=>{
 const f=fixture();f.context.speak=()=>{throw new Error('Must not speak while hidden');};
 f.context.$=()=>({classList:{contains:()=>false},innerHTML:'',value:''});
 vm.runInContext("IV={board:'board-a',job:'board',lines:[],cards:[],busy:false,speak:true};pending=say('First');",f.context);
 f.resolveReply({ok:true,json:async()=>({engine:'model',reply:'Reply',cards:[]})});await f.context.pending;
 assert.equal(vm.runInContext('IV.error',f.context),'');
});

test('card acceptance sends its captured preconditions and retains stale suggestions',async()=>{
 const sent:unknown[]=[];
 const card={ops:[{t:'updateJob',id:'j',patch:{name:'Model'}}],preconditions:[{version:1,snapshot:'old'}]};
 const context=vm.createContext({IV:{board:'work',cards:[card]},state:{name:'work'},encodeURIComponent,load:async()=>{},fetch:async(_url:string,init:{body:string})=>{sent.push(JSON.parse(init.body));return{ok:false,text:async()=> 'This suggestion is stale'};},paintInterviewState:()=>{},toast:()=>{},$:()=>({innerHTML:''}),cardsHtml:()=>''});
 vm.runInContext(functionSource('sessionOp','async function retryInterview')+functionSource('acceptCard','async function say'),context);
 await vm.runInContext('acceptCard(0)',context);
 assert.deepEqual(sent,[{ops:card.ops,preconditions:card.preconditions}]);
 assert.equal(vm.runInContext('IV.cards[0].gone',context),undefined);
 assert.equal(vm.runInContext('IV.cards[0].accepted',context),undefined);
 assert.equal(vm.runInContext('IV.cards[0].error',context),'This suggestion is stale');
});

test('failed card writes show a sentence: out-of-date suggestions, gateway JSON and local stacks never print raw',()=>{
 const context=vm.createContext({JSON});
 vm.runInContext(functionSource('sessionOp','async function retryInterview'),context);
 const message=(status:number,body:string)=>vm.runInContext('opFailureMessage',context)(status,body);
 assert.equal(message(409,JSON.stringify({error:'This suggestion is stale: the affected work changed.'})),'This suggestion is out of date. Ask Staves to suggest it again.');
 assert.equal(message(500,'{"error":"Could not complete this request. Please try again."}'),'Could not complete this request. Please try again.');
 assert.equal(message(500,'Error: Suggestion preconditions must match every operation.\n    at validate (proposals.js:1:1)'),'Suggestion preconditions must match every operation.');
 assert.equal(message(400,''),'Could not save');
 assert.equal(message(400,'{"other":1}'),'Could not save');
});
test('an out-of-date card keeps its add button and says so instead of JSON',async()=>{
 const card={ops:[{t:'job',job:{id:'j'}}],preconditions:[{version:1,snapshot:'old'}]};
 const context=vm.createContext({JSON,IV:{board:'work',cards:[card]},state:{name:'work'},encodeURIComponent,load:async()=>{},fetch:async()=>({ok:false,status:409,text:async()=>JSON.stringify({error:'This suggestion is stale'})}),paintInterviewState:()=>{},toast:()=>{},$:()=>({innerHTML:''}),cardsHtml:()=>''});
 vm.runInContext(functionSource('sessionOp','async function retryInterview')+functionSource('acceptCard','async function say'),context);
 await vm.runInContext('acceptCard(0)',context);
 assert.equal(vm.runInContext('IV.cards[0].error',context),'This suggestion is out of date. Ask Staves to suggest it again.');
 assert.equal(vm.runInContext('IV.cards[0].accepted',context),undefined);
});
