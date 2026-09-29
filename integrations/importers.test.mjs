import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'staves-importers-'));
await build({stdin:{contents:'export * from "./integrations/figma/model.ts";export * from "./integrations/miro/import.ts";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:join(dir,'model.mjs')});
const {parsePacket,layoutPacket,importToMiro}=await import(pathToFileURL(join(dir,'model.mjs')).href);
process.on('exit',()=>{});test.after(()=>rm(dir,{recursive:true,force:true}));
const packet={schema:'staves.workflow-handoff',schemaVersion:1,source:{boardId:'a',revision:3},request:{},omitted:{},warnings:[],boundaries:[],handoffs:[{from:'j',to:'t'}],board:{id:'a',title:'A',jobs:[{id:'j',name:'Job',track:'p',inputs:[],outputs:[]},{id:'t',name:'Task',parent:'j',track:'a',inputs:[],outputs:[]}],tracks:[{id:'p',name:'Person',kind:'person'},{id:'a',name:'Agent',kind:'agent'}],questions:[]}};
test('importers preserve cross-role nested work and reject cyclic hierarchy',()=>{
 const p=parsePacket(JSON.stringify(packet)),rows=layoutPacket(p);assert.equal(rows[0].cells[0].column,rows[1].cells[0].column);assert.equal(rows[1].cells[0].work[0].parent,'j');
 const bad=structuredClone(packet);bad.board.jobs[0].parent='t';assert.throws(()=>parsePacket(JSON.stringify(bad)),/circular/);
});
test('Miro importer joins created destination IDs and cleans up only its own items after failure',async()=>{
 let i=0;const edges=[],removed=[];const board={createShape:async()=>({id:String(++i)}),createConnector:async p=>{edges.push(p);return{id:String(++i)};},remove:async item=>removed.push(item.id)};
 const result=await importToMiro(JSON.stringify(packet),board);assert.equal(edges[0].start.item,result.mapping.j);assert.equal(edges[0].end.item,result.mapping.t);assert.equal(removed.length,0);
 const failed={...board,createConnector:async()=>{throw new Error('Rejected connection');}};await assert.rejects(importToMiro(JSON.stringify(packet),failed),/Created items were removed/);assert.ok(removed.length>0);assert.ok(removed.every(id=>!result.items.some(item=>item.id===id)));
});
