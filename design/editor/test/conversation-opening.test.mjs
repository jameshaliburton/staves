import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../onboarding.js',import.meta.url),'utf8');
function fixture(available=true){
 const calls=[];const session={board:'a',job:'board',lines:[],cards:[]};
 const context=vm.createContext({IV:session,state:{name:'a',presence:[]},conversationOpen:true,localStorage:{getItem:()=>available?'fixture-key':null},ask:async(...args)=>calls.push(args)});
 const start=source.indexOf('function startDesignConversation('),end=source.indexOf('function conversationStarterPrompts(',start);
 assert.ok(start>=0,'conversation entry must have an explicit opening transition');
 vm.runInContext(source.slice(start,end),context);return {context,calls,session};
}
test('a connected empty conversation asks the model once with explicit scope and no graph writing',async()=>{
 const {context,calls,session}=fixture();await context.startDesignConversation();await context.startDesignConversation();
 assert.equal(calls.length,1);assert.equal(calls[0][1],session);assert.equal(calls[0][2].opening,true);assert.equal(calls[0][2].assessment,true);assert.equal(calls[0][2].focus,'board');assert.match(calls[0][0],/one.*question/i);
});
test('returning history, busy sessions and missing model never generate duplicate openings',async()=>{
 const {context,calls,session}=fixture();session.lines=[{who:'interviewer',text:'Existing question'}];await context.startDesignConversation();session.lines=[];session.busy=true;await context.startDesignConversation();assert.equal(calls.length,0);
 const absent=fixture(false);await absent.context.startDesignConversation();assert.equal(absent.calls.length,0);
});
