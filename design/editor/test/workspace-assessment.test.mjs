import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../onboarding.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function createWorkAssessmentScheduler('),source.indexOf('function workAssessmentContext(')),context);
function harness(){
 let active={session:{},id:'a',key:'a:1'},held=false,id=0;const timers=new Map(),calls=[];
 const scheduler=context.createWorkAssessmentScheduler({current:()=>active,blocked:()=>held,run:c=>calls.push(c),setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:id=>timers.delete(id)});
 return {scheduler,calls,timers,setActive:value=>active=value,get active(){return active;},hold:value=>held=value,tick:()=>{const entry=timers.entries().next().value;if(entry){timers.delete(entry[0]);entry[1]();}}};
}
test('rapid context navigation assesses only the settled selection',()=>{
 const h=harness();h.scheduler.schedule();h.setActive({...h.active,id:'b',key:'b:1'});h.scheduler.schedule();assert.equal(h.timers.size,1);h.tick();assert.deepEqual(h.calls.map(c=>c.id),['b']);
});
test('typing, busy or paused work can defer assessment without losing pending context',()=>{
 const h=harness();h.hold(true);h.scheduler.schedule();h.tick();assert.equal(h.calls.length,0);h.hold(false);h.tick();assert.equal(h.calls.length,1);
});
test('repaints and returning to unchanged context never repeat the assessment',()=>{
 const h=harness();h.scheduler.schedule();h.tick();h.scheduler.schedule();assert.equal(h.timers.size,0);const first=h.active;h.setActive({...first,id:'b',key:'b:1'});h.scheduler.schedule();h.tick();h.setActive(first);h.scheduler.schedule();assert.equal(h.timers.size,0);assert.equal(h.calls.length,2);
});
test('a saved context change is assessed once, separate conversations remain independent',()=>{
 const h=harness();h.scheduler.schedule();h.tick();h.setActive({...h.active,key:'a:2'});h.scheduler.schedule();h.tick();h.setActive({...h.active,session:{}});h.scheduler.schedule();h.tick();assert.equal(h.calls.length,3);
});
test('closing chat cancels pending assessment and does not change session draft or transcript',()=>{
 const h=harness();const session=h.active.session;session.draft='Still writing';session.lines=[{text:'Existing conversation'}];h.scheduler.schedule();h.setActive(null);h.tick();assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);assert.equal(session.draft,'Still writing');assert.equal(session.lines.length,1);
});
test('model assessment uses pinned focus, preserves draft and never auto-applies cards',async()=>{
 const writes=[],requests=[];let autoApplied=false;
 const session={board:'board',job:'root',focusJob:'a',lines:[{who:'person',text:'Earlier answer'}],cards:[],draft:'Unsent thought'};
 const c=vm.createContext({IV:session,ask:null,AbortController,AbortSignal,Date,JSON,proposeSuggestions:async()=>{},localStorage:{getItem:()=>null},interviewActivity:()=>'understand',paintInterviewState:()=>{},paintStreamingReply:()=>{},scrollInterviewLatest:()=>{},renderLines:()=>{},$:()=>null,cardsHtml:()=>'',sessionOp:async(s,ops)=>writes.push(...ops),fetch:async(url,options)=>{requests.push(JSON.parse(options.body));session.focusJob='b';return {};},readInterviewResponse:async()=>({reply:'Assessment from the model',engine:'model',cards:[{ops:[]}]}),autoBuildEnabled:()=>true,applyInterviewBatch:async()=>{autoApplied=true;}});
 vm.runInContext(source.slice(source.indexOf('ask=async function('),source.indexOf('function autoBuildEnabled(')),c);
 await c.ask('Assess current context',session,{assessment:true,focus:'a'});
 assert.equal(requests[0].job,'a');assert.equal(session.draft,'Unsent thought');assert.equal(session.lines.length,2);assert.equal(session.lines[0].text,'Earlier answer');assert.equal(writes.length,1);assert.equal(writes[0].comment.by,'interviewer');assert.equal(autoApplied,false);
 // Retrying the assessment keeps its original context, even after navigating away.
 await c.ask(session.lastSaid,session);assert.equal(requests[1].job,'a');
});
