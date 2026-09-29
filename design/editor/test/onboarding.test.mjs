import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../onboarding.js',import.meta.url),'utf8');

test('interview renders genuine reply chunks before the final result across split network frames',async()=>{
 const context=vm.createContext({TextDecoder,Error,JSON});
 vm.runInContext(source.slice(source.indexOf('async function readInterviewResponse('),source.indexOf('function paintStreamingReply(')),context);
 const chunks=['{"type":"reply","text":"Hel','lo"}\n{"type":"reply","text":"Hello again"}\n','{"type":"complete","reply":"Hello again","cards":[]}\n'];
 let next=0;const seen=[];
 const response=new Response(new ReadableStream({pull(controller){if(next<chunks.length)controller.enqueue(new TextEncoder().encode(chunks[next++]));else controller.close();}}),{headers:{'content-type':'application/x-ndjson'}});
 const result=await context.readInterviewResponse(response,text=>seen.push(text));
 assert.deepEqual(seen,['Hello','Hello again']);assert.equal(result.reply,'Hello again');
});
test('interrupted streams report failure rather than treating a partial reply as saved',async()=>{
 const context=vm.createContext({TextDecoder,Error,JSON});
 vm.runInContext(source.slice(source.indexOf('async function readInterviewResponse('),source.indexOf('function paintStreamingReply(')),context);
 const response=new Response('{"type":"reply","text":"A partial reply"}\n',{headers:{'content-type':'application/x-ndjson'}});
 await assert.rejects(()=>context.readInterviewResponse(response,()=>{}),/interrupted/);
});

test('automatic building applies new work and staves\u2019 own drafts, and leaves questions and edits alone',async()=>{
 const posts=[],reverts=[];const session={board:'test',cards:[]};
 const context=vm.createContext({state:{name:'test'},IV:session,proposeSuggestions:async()=>{},crypto:{randomUUID:()=> 'batch'},fetch:async(url,options)=>{if(url.includes('board.json'))return {ok:true,json:async()=>({jobs:[],tracks:[],artifacts:[]})};if(options){posts.push(JSON.parse(options.body));return {ok:true};}return {ok:true,json:async()=>[{id:'a',by:'interview-build-batch',op:{t:'track',track:{id:'role'}}},{id:'unrelated',by:'human'},{id:'b',by:'interview-build-batch',op:{t:'job',job:{id:'new'}}}]};},load:async()=>{},toast:()=>{},sessionOp:async(s,ops)=>reverts.push(...ops),$:()=>({innerHTML:''}),cardsHtml:()=>'',paintInterviewState:()=>{}});
 vm.runInContext(source.slice(source.indexOf('async function applyInterviewBatch('),source.indexOf('// Adding a node')),context);
 /* An inferred card lands now: the board draws it as staves' guess, so the queue is no longer what
    keeps it honest. A question carries nothing, and anything marked auto:false -- every edit and
    removal -- still waits for the person. The server gives every card its preconditions, so a draft
    arrives with them just as an answer does. */
 const cards=[{name:'Added work',confidence:'said',preconditions:[{version:1,signature:'basis'}],ops:[{t:'job',job:{id:'new'}}]},{name:'Open question',confidence:'asked',ops:[{t:'removeJob',id:'old'}]},{name:'Assumption',confidence:'implied',preconditions:[{version:1,signature:'basis'}],ops:[{t:'job',job:{id:'guess'}}]},{name:'Rename it',confidence:'said',auto:false,preconditions:[{version:1,signature:'basis'}],ops:[{t:'updateJob',id:'new',patch:{name:'Other'}}]}];
 await context.applyInterviewBatch(session,cards);assert.equal(posts[0].ops.length,2,'the answer and the draft both land');assert.equal(posts[0].preconditions.length,2);assert.deepEqual(posts[0].ops.map(o=>o.job?.id),['new','guess']);assert.equal(cards[0].accepted,true);assert.equal(cards[2].accepted,true,'the draft is on the board');assert.equal(cards[1].accepted,undefined,'a question is not a change');assert.equal(cards[3].accepted,undefined,'an edit still waits for the person');
 await context.undoInterviewBatch(session);assert.deepEqual(JSON.parse(JSON.stringify(reverts)),[{t:'revert',of:'b',entity:'job',id:'new',prior:null},{t:'revert',of:'a',entity:'track',id:'role',prior:null}]);assert.equal(session.lastBuild.undone,true);
});

test('undo restores edited jobs and removed child tasks through the real board reducer',async()=>{
 const {fold}=await import('../../../dist/ops.js');
 const original=[{t:'board',id:'b',title:'Test'},{t:'track',track:{id:'p',name:'Person',kind:'person'}},{t:'job',job:{id:'j',name:'Original',track:'p',inputs:[],outputs:[]}},{t:'job',job:{id:'task',name:'Child',parent:'j',track:'p',inputs:[],outputs:[]}}];
 const makeEntries=ops=>ops.map((op,i)=>({id:String(i),seq:i+1,at:'2026-09-08',by:'human',op}));
 const before=fold(structuredClone(makeEntries(original)));
 const operations=[{t:'updateJob',id:'j',patch:{name:'Changed'}},{t:'removeJob',id:'j'}];let saved;
 const session={board:'b',lastBuild:{actor:'batch',before,cards:[]}};
 const context=vm.createContext({IV:session,fetch:async()=>({ok:true,proposeSuggestions:async()=>{},json:async()=>operations.map((op,i)=>({id:'change'+i,by:'batch',op}))}),sessionOp:async(s,ops)=>{saved=JSON.parse(JSON.stringify(ops));},toast:()=>{},$:()=>({innerHTML:''}),cardsHtml:()=>'',paintInterviewState:()=>{}});
 vm.runInContext(source.slice(source.indexOf('async function undoInterviewBatch('),source.indexOf('// Adding a node')),context);
 await context.undoInterviewBatch(session);
 const restored=fold(makeEntries([...original,...operations,...saved]));
 assert.equal(restored.jobs.find(j=>j.id==='j').name,'Original');assert.equal(restored.jobs.find(j=>j.id==='j').removed,undefined);assert.equal(restored.jobs.find(j=>j.id==='task').removed,undefined);
});


test('pause stops input and resume reissues only an interrupted turn',async()=>{
 let aborted=0,restarted=0;const session={busy:true,lastSaid:'Keep this answer',requestController:{abort(){aborted++;}}};
 const context=vm.createContext({IV:session,stopDictation:()=>{},stopSpeaking:()=>{},paintInterviewState:()=>{},$:()=>({focus(){}}),ask:async(text,s)=>{assert.equal(text,'Keep this answer');assert.equal(s,session);restarted++;},autoBuildEnabled:()=>false});
 vm.runInContext(source.slice(source.indexOf('async function toggleInterviewPause('),source.indexOf('const paintBeforePause')),context);
 await context.toggleInterviewPause();assert.equal(session.paused,true);assert.equal(aborted,1);assert.equal(restarted,0);
 session.busy=false;await context.toggleInterviewPause();assert.equal(session.paused,false);assert.equal(restarted,1);
 await context.toggleInterviewPause();await context.toggleInterviewPause();assert.equal(restarted,1);
});

test('canvas feedback distinguishes new work, edits and removals without animating initial or unchanged nodes',()=>{
 const context=vm.createContext({Map,JSON});vm.runInContext(source.slice(source.indexOf('function canvasNodeChanges('),source.indexOf('let canvasFeedbackBoard')),context);
 const node={id:'j',name:'Invite vendors',track:'team',inputs:[],outputs:[]};
 const initial=context.canvasNodeChanges(null,[node]);assert.equal(initial.added.length,0);
 const unchanged=context.canvasNodeChanges(initial.next,[{...node}]);assert.equal(unchanged.added.length+unchanged.updated.length+unchanged.removed.length,0);
 const changed=context.canvasNodeChanges(initial.next,[{...node,name:'Vendors understand the brief'},{id:'task',parent:'j',name:'Discuss questions'}]);assert.deepEqual([...changed.updated],['j']);assert.deepEqual([...changed.added],['task']);
 const removed=context.canvasNodeChanges(changed.next,[{...node,name:'Vendors understand the brief'}]);assert.deepEqual([...removed.removed],['task']);
});


test('activity selection persists per board without changing automatic building',()=>{
 const storage=new Map(),session={board:'a',busy:false};let paints=0;
 const context=vm.createContext({IV:session,localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},paintInterviewState:()=>paints++});
 vm.runInContext(source.slice(0,source.indexOf('function paintInterviewActivities')),context);
 assert.equal(context.interviewActivity(),'understand');
 context.setInterviewActivity('friction');assert.equal(context.interviewActivity(),'friction');
 session.board='b';assert.equal(context.interviewActivity(),'understand');
 context.setInterviewActivity('opportunities');assert.equal(storage.has('staves:auto-build:b'),false);
 session.busy=true;context.setInterviewActivity('check');assert.equal(context.interviewActivity(),'opportunities');
 session.busy=false;context.setInterviewActivity('invalid');assert.equal(context.interviewActivity(),'opportunities');assert.equal(paints,2);
});


test('automatic batches carry server preconditions and never mark rejected writes as applied',async()=>{
 const session={board:'test'},posts=[];
 const context=vm.createContext({state:{name:'test'},IV:session,crypto:{randomUUID:()=> 'batch'},fetch:async(url,options)=>{if(!options)return {ok:true,json:async()=>({jobs:[]})};posts.push(JSON.parse(options.body));return {ok:false};}});
 vm.runInContext(source.slice(source.indexOf('async function applyInterviewBatch('),source.indexOf('async function undoInterviewBatch(')),context);
 const stale={name:'Rename',confidence:'said',ops:[{t:'updateJob',id:'j',patch:{name:'Old rename'}}],preconditions:[{version:1,signature:'old'}]};
 await context.applyInterviewBatch(session,[stale]);assert.equal(posts.length,1);assert.equal(stale.accepted,undefined);assert.ok(stale.error);assert.equal(session.lastBuild,undefined);
 const legacy={name:'Legacy',confidence:'said',ops:[{t:'updateJob',id:'j',patch:{name:'Legacy'}}]};
 await context.applyInterviewBatch(session,[legacy]);assert.equal(posts.length,1);assert.match(legacy.error,/refreshing/);
});


test('automatic building holds a section whose required role is still awaiting review',async()=>{
 const session={board:'test'},posts=[];
 const context=vm.createContext({state:{name:'test'},IV:session,fetch:async(url,options)=>{if(options)posts.push(options);return {ok:true,json:async()=>({jobs:[],tracks:[],artifacts:[]})};}});
 vm.runInContext(source.slice(source.indexOf('async function applyInterviewBatch('),source.indexOf('async function undoInterviewBatch(')),context);
 const job={name:'New outcome',confidence:'said',ops:[{t:'job',job:{id:'new',track:'pending-role',inputs:[],outputs:[]}}],preconditions:[{}]};
 const role={name:'Role',confidence:'said',auto:false,ops:[{t:'track',track:{id:'pending-role'}}],preconditions:[{}]};
 await context.applyInterviewBatch(session,[role,job]);assert.equal(posts.length,0);assert.equal(job.accepted,undefined);assert.match(job.error,/awaiting review/);
});

test('adding a job carries each pulled-in role its own precondition and skips roles already applied',async()=>{
 const sent=[];
 const role={name:'Reviewer',ops:[{t:'track',track:{id:'role'}}],preconditions:['role-basis']};
 const record={name:'Other job',ops:[{t:'artifact',artifact:{id:'record'}},{t:'job',job:{id:'other',track:'role',inputs:[],outputs:['record']}}],preconditions:['record-basis','other-basis']};
 const job={name:'Job',ops:[{t:'job',job:{id:'j',track:'role',inputs:['record'],outputs:[]}}],preconditions:['job-basis']};
 const session={board:'b',cards:[role,record,job]};
 const context=vm.createContext({IV:session,state:{name:'b',board:{tracks:[],artifacts:[],jobs:[]}},proposeSuggestions:async()=>{},$:()=>null,cardsHtml:()=>'',acceptCard:async i=>{const c=session.cards[i];sent.push({ops:c.ops.map(o=>o.t+':'+(o.track||o.artifact||o.job).id),preconditions:c.preconditions});c.accepted=true;c.gone=true;}});
 vm.runInContext(source.slice(source.indexOf('// Adding a node'),source.indexOf('async function toggleInterviewPause(')),context);
 await context.acceptCard(2);
 assert.deepEqual(JSON.parse(JSON.stringify(sent[0])),{ops:['track:role','artifact:record','job:j'],preconditions:['role-basis','record-basis','job-basis']});
 assert.equal(role.accepted,true);assert.equal(record.accepted,undefined);
 // Role applied on its own first: the job no longer re-sends it, and a second attempt uses the card's original operations.
 const again={name:'Later job',ops:[{t:'job',job:{id:'k',track:'role',inputs:[],outputs:[]}}],preconditions:['k-basis']};
 session.cards=[{...role,accepted:true},again];context.state.board.tracks=[];
 await context.acceptCard(1);await context.acceptCard(1);
 assert.deepEqual(JSON.parse(JSON.stringify(sent.slice(1))),[{ops:['job:k'],preconditions:['k-basis']},{ops:['job:k'],preconditions:['k-basis']}]);
 const pending={...role,accepted:undefined},onBoard={name:'Existing role job',ops:[{t:'job',job:{id:'m',track:'role',inputs:[],outputs:[]}}],preconditions:['m-basis']};
 session.cards=[pending,onBoard];context.state.board.tracks=[{id:'role'}];
 await context.acceptCard(1);
 assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))),{ops:['job:m'],preconditions:['m-basis']});
});

test('a board with roles but no jobs is not empty, so the start card never hides its roles',()=>{
 const context=vm.createContext({state:{}});
 vm.runInContext(source.slice(source.indexOf('function isEmptyWorkflow('),source.indexOf('async function beginWorkflowInterview(')),context);
 context.state.board={jobs:[],tracks:[]};assert.equal(context.isEmptyWorkflow(),true);
 context.state.board={jobs:[],tracks:[{id:'t',name:'Tax advisor',kind:'outside',removed:true}]};assert.equal(context.isEmptyWorkflow(),true);
 context.state.board={jobs:[],tracks:[{id:'t',name:'Tax advisor',kind:'outside'}]};assert.equal(context.isEmptyWorkflow(),false);
 context.state.board={jobs:[{id:'j',removed:true}],tracks:[{id:'t',name:'Tax advisor',kind:'outside'}]};assert.equal(context.isEmptyWorkflow(),false);
});

test('an applied assumption says Applied, not review before adding',()=>{
 const session={cards:[{name:'Tax advisor',confidence:'implied',ops:[{t:'track',track:{id:'t'}}]},{name:'External legal counsel',confidence:'implied',accepted:true,gone:true,ops:[{t:'track',track:{id:'l'}}]}]};
 const context=vm.createContext({IV:session,esc:s=>String(s),cardsHtml:null});
 vm.runInContext(source.slice(source.indexOf('function compactAction('),source.indexOf('function inspectInterviewChange(')),context);
 const [pending,applied]=context.cardsHtml().split('<div class="compact-change">').slice(1);
 assert.match(pending,/Assumption · review before adding/);assert.doesNotMatch(pending,/Applied/);
 assert.match(applied,/Applied/);assert.doesNotMatch(applied,/review before adding/);
});

test('the request carries the chosen activity and this browser’s model, not fixed defaults',async()=>{
 const sent=[];const saved={'staves:activity:b':'friction','staves:provider':'openai','staves:model':'gpt-5','staves:key':'sk-test'};
 const session={board:'b',job:'board',lines:[],cards:[],busy:false,speak:false,pendingLine:null};
 const context=vm.createContext({
  IV:session,state:{name:'b',board:{comments:[],jobs:[],tracks:[],artifacts:[]}},
  localStorage:{getItem:k=>saved[k]??null,setItem(k,v){saved[k]=v;}},
  fetch:async(url,options)=>{sent.push({url,body:JSON.parse(options.body)});return {ok:true,headers:{get:()=>'application/json'},json:async()=>({engine:'model',reply:'ok',cards:[]})};},
  AbortSignal:{any:()=>undefined,timeout:()=>undefined},AbortController,Date,JSON,Object,
  $:()=>null,$$:()=>[],sessionOp:async()=>{},readInterviewResponse:async r=>r.json(),
  paintInterviewState(){},paintStreamingReply(){},scrollInterviewLatest(){},renderLines(){},cardsHtml:()=>'',
  speak(){},toast(){},globalThis:{},autoBuildEnabled:()=>false,applyInterviewBatch:async()=>{},
  INTERVIEW_ACTIVITIES:{understand:1,check:1,friction:1,opportunities:1},
  proposeSuggestions:async()=>{},
  document:{addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},append(){},querySelector:()=>null}),body:{append(){}}},
  window:{addEventListener(){}},setTimeout,clearTimeout,
 });
 vm.runInContext(source.slice(source.indexOf('function interviewActivity('),source.indexOf('function setInterviewActivity('))
  +source.slice(source.indexOf('ask=async function'),source.indexOf('function autoBuildEnabled(')),context);
 await context.ask('what about tax?',session,{});
 const interview=sent.find(s=>String(s.url).includes('interview'));
 assert.ok(interview,'the interview request was made');
 assert.equal(interview.body.mode,'friction','the activity the person chose');
 assert.equal(interview.body.provider,'openai','their provider, so the key goes to the right vendor');
 assert.equal(interview.body.model,'gpt-5');
});

test('a suggestion waits on the board, and is answered there',async()=>{
 const posted=[];let proposals=[];
 const session={board:'b',job:'board',cards:[],lines:[]};
 const context=vm.createContext({
  IV:session,state:{name:'b'},JSON,Object,Date,console,
  fetch:async(url,options)=>{
   if(String(url).includes('/proposals'))return {ok:true,json:async()=>proposals};
   posted.push({url:String(url),body:JSON.parse(options.body)});
   return {ok:true,json:async()=>({ok:true,seqs:[11,12]})};
  },
  $:()=>null,cardsHtml:()=>'',paintInterviewState(){},toast(){},
 });
 vm.runInContext(source.slice(source.indexOf('async function proposeSuggestions('),source.indexOf('// Adding a node')),context);

 session.cards=[
  {type:'who',name:'Tax advisor',quote:'we use a tax adviser',confidence:'implied',ops:[{t:'track',track:{id:'t1'}}],preconditions:[{version:1,snapshot:'s'}]},
  {type:'job',name:'Already applied',accepted:true,gone:true,ops:[{t:'job',job:{id:'j'}}]},
 ];
 await context.proposeSuggestions(session);
 const write=posted.find(p=>p.url.includes('propose=1'));
 assert.ok(write,'it is written to the board, not kept in the tab');
 assert.equal(write.body.ops.length,1,'only what is still waiting on you');
 assert.equal(write.body.suggestions[0].quote,'we use a tax adviser','with the words it came from');
 assert.equal(write.body.suggestions[0].confidence,'implied');
 assert.equal(session.cards[0].seq,11,'and the card now points at its proposal');

 // coming back: the cards are rebuilt from the board, where a collaborator or an agent can see them
 proposals=[{seq:11,by:'interviewer',op:{t:'track',track:{id:'t1'}},proposalBasis:{version:1,snapshot:'s'},
   suggestion:{name:'Tax advisor',quote:'we use a tax adviser',confidence:'implied',type:'who'}}];
 const returning={board:'b',job:'board',cards:[],lines:[]};
 await context.recallSuggestions(returning);
 assert.equal(returning.cards.length,1);
 assert.equal(returning.cards[0].name,'Tax advisor');
 assert.equal(returning.cards[0].seq,11);
 assert.equal(JSON.stringify(returning.cards[0].preconditions),JSON.stringify([{version:1,snapshot:'s'}]));
});
