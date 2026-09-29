import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../store.js';
import {fold, type Op} from '../ops.js';
import {designConversationContext, validateDesignConversationOperation} from '../design-conversation.js';
import {walkthroughBasis} from '../walkthrough-record.js';
import {modelFlow, interviewTurn} from '../interviewer.js';

function intention(scope: string, text: string): Op {
  return {t:'comment',comment:{id:`design-conversation:${scope}`,about:scope,by:'human',text,designConversation:{version:1,scope,intention:text}}};
}
const initial: Op[] = [{t:'board',id:'workflow',title:'Workflow'}, {t:'track',track:{id:'p',name:'Owner',kind:'person'}}, {t:'job',job:{id:'review',name:'Review request',track:'p',inputs:[],outputs:[],status:'draft',provenance:{source:'human'}}}];
function fixture() {return fold(initial.map((op,seq)=>({op,seq:seq+1,at:'',by:'human'})));}

test('working intention persists by scope without changing the assessed design', async () => {
  const dir=await mkdtemp(join(tmpdir(),'staves-conversation-'));
  try {
    const store=new Store(dir);await store.append('workflow',initial,'human');
    const before=walkthroughBasis(await store.board('workflow'));
    await store.append('workflow',[intention('board','Reduce unnecessary waiting'),intention('review','Keep exceptions with a person')],'human');
    const restored=await new Store(dir).board('workflow');
    assert.equal(walkthroughBasis(restored),before);
    assert.equal(JSON.parse(designConversationContext(restored)).length,1);
    assert.equal(JSON.parse(designConversationContext(restored,'review')).length,2);
    await store.append('workflow',[intention('board','')],'human');
    assert.deepEqual(JSON.parse(designConversationContext(await store.board('workflow'))),[]);
    assert.equal((await store.entries('workflow')).filter(e=>e.op.t==='comment').length,3,'earlier intention remains in the append-only history');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('scope, identity and review boundaries are validated',()=>{
  const board=fixture();
  assert.throws(()=>validateDesignConversationOperation(board,intention('missing','Aim'),'human'),/scope/);
  const wrong=intention('board','Aim');if(wrong.t==='comment')wrong.comment.about='review';
  assert.throws(()=>validateDesignConversationOperation(board,wrong,'human'),/identity/);
  assert.throws(()=>validateDesignConversationOperation(board,intention('board','Aim'),'agent:coder'),/human review/);
  assert.doesNotThrow(()=>validateDesignConversationOperation(board,intention('board','Aim'),'agent:coder',true));
});

test('both model scopes receive the saved intention without granting implementation authority', async()=>{
  const board=fixture();for(const scope of ['board','review']) {const op=intention(scope,scope==='board'?'Reduce waiting':'Retain human approval');if(op.t==='comment')board.comments.push(op.comment);}
  let prompt='';const complete=async(system:string,user:string)=>{prompt=system+'\n'+user;return JSON.stringify({reply:'Which exception matters most?',cards:[],done:false,checkpoint:{state:'collect',reason:'Clarify the exception'}});};
  await modelFlow(board,[],'Help me',complete);assert.match(prompt,/Reduce waiting/);assert.doesNotMatch(prompt,/Retain human approval/);assert.match(prompt,/not evidence of implementation/);
  await interviewTurn(board,board.jobs[0],[],'Help me',complete);assert.match(prompt,/Reduce waiting/);assert.match(prompt,/Retain human approval/);
});

test('undo cannot bypass working intention review or restore a mismatched identity', () => {
  const board = fixture();
  const saved = intention('board', 'Reduce waiting');
  if (saved.t !== 'comment') throw new Error('Expected comment');
  board.comments.push(saved.comment);
  const remove: Op = {t:'revert', of:'save', entity:'comment', id:saved.comment.id, prior:null};
  assert.throws(() => validateDesignConversationOperation(board, remove, 'agent:coder'), /human review/);
  assert.doesNotThrow(() => validateDesignConversationOperation(board, remove, 'human'));
  const restore: Op = {...remove, prior:{...saved.comment, id:'wrong'}};
  assert.throws(() => validateDesignConversationOperation(board, restore, 'human'), /identity/);
  restore.prior = saved.comment;
  assert.throws(() => validateDesignConversationOperation(fixture(), restore, 'agent:coder'), /human review/);
  assert.doesNotThrow(() => validateDesignConversationOperation(fixture(), restore, 'human'));
});

test('standalone validates intention against each evolving batch and rejects overwrite atomically', async () => {
  const memory = new Map<string, string>();
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{getItem:(key:string)=>memory.get(key)??null, setItem:(key:string,value:string)=>memory.set(key,value)}});
  const browser = {fetch:globalThis.fetch};
  Object.defineProperty(globalThis, 'window', {configurable:true,value:browser});
  try {
    await import('../standalone.js');
    const post = (ops: Op[]) => browser.fetch('./op?board=workflow', {method:'POST',body:JSON.stringify(ops)});
    await post([...initial, intention('review', 'Keep exceptions with a person')]);
    const board = await (await browser.fetch('./board.json?board=workflow')).json();
    assert.equal(board.comments[0].designConversation.intention, 'Keep exceptions with a person');
    const before = JSON.stringify([...memory]);
    await assert.rejects(post([intention('board', 'Reduce waiting'), {t:'comment',comment:{id:'design-conversation:board',about:'board',by:'human',text:'overwrite'}}]), /ordinary comment/);
    assert.equal(JSON.stringify([...memory]), before);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
