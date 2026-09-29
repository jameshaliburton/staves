import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { streamCodexResponse } from '../codex-bridge.mjs';

function transport(finish){
  const child=new EventEmitter();child.stdout=new PassThrough();child.killed=false;
  child.kill=()=>{child.killed=true;};
  const event=value=>child.stdout.write(JSON.stringify(value)+'\n');
  child.stdin=new Writable({write(chunk,_encoding,done){
    const request=JSON.parse(chunk.toString());
    if(request.method==='initialize')queueMicrotask(()=>event({id:request.id,result:{}}));
    if(request.method==='thread/start')queueMicrotask(()=>event({id:request.id,result:{thread:{id:'isolated'}}}));
    if(request.method==='turn/start')queueMicrotask(()=>{event({id:request.id,result:{turn:{id:'turn'}}});finish(event,child);});
    done();
  }});
  return child;
}

test('Codex adapter forwards actual model deltas and closes ephemeral process',async()=>{
  const child=transport(event=>{
    event({method:'item/agentMessage/delta',params:{delta:'{"reply":"Hello'}});
    event({method:'item/agentMessage/delta',params:{delta:' there","cards":[]}'}});
    event({method:'turn/completed',params:{turn:{status:'completed'}}});
  });
  const updates=[];
  const result=await streamCodexResponse('system','user',text=>updates.push(text),'/tmp',()=>child);
  assert.deepEqual(updates,['{"reply":"Hello','{"reply":"Hello there","cards":[]}']);
  assert.equal(result,updates[1]);assert.equal(child.killed,true);
});

test('Codex adapter rejects failed turns without manufacturing a completed answer',async()=>{
  const child=transport(event=>event({method:'turn/completed',params:{turn:{status:'failed',error:{message:'Usage unavailable'}}}}));
  const updates=[];
  await assert.rejects(streamCodexResponse('system','user',text=>updates.push(text),'/tmp',()=>child),/Usage unavailable/);
  assert.deepEqual(updates,[]);assert.equal(child.killed,true);
});
