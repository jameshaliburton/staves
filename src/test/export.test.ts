import test from 'node:test';
import assert from 'node:assert/strict';
import {fold,type Entry,type Op} from '../ops.js';
import {workflowExport,exportMarkdown,exportPrompt,exportSvg,exportN8n} from '../export.js';
const ops:Op[]=[
 {t:'board',id:'test',title:'Help someone decide',goal:'A supported decision'},
 {t:'track',track:{id:'person',name:'Reviewer',kind:'person'}},
 {t:'artifact',artifact:{id:'result',name:'Result',kind:'document'}},
 {t:'job',job:{id:'a',name:'Prepare',track:'person',inputs:[],outputs:['result'],status:'confirmed',provenance:{source:'human',by:'test'},gate:{rule:'Ask for approval',accountable:'person'}}},
 {t:'job',job:{id:'task',name:'Check facts',parent:'a',track:'person',inputs:[],outputs:[],status:'draft',provenance:{source:'human',by:'test'}}},
 {t:'job',job:{id:'b',name:'Receive',track:'person',inputs:['result'],outputs:[],status:'confirmed',provenance:{source:'human',by:'test'}}},
 {t:'ask',question:{id:'q',about:'a',text:'Who decides?',askedBy:'human',at:'2026-09-08',status:'raised'}},
 {t:'comment',comment:{id:'note',about:'a',by:'human',text:'Keep the approval step',at:'2026-09-08'}},
 {t:'comment',comment:{id:'transcript',about:'a',by:'human',text:'[interview] Private transcript',at:'2026-09-08'}}
];
const board=fold(ops.map((op,i):Entry=>({op,seq:i+1,by:'test',at:'2026-09-08'})));
test('scoped export includes nested work and names omitted handoff boundaries',()=>{
 const packet=workflowExport(board,9,{jobIds:['a']});
 assert.deepEqual(packet.board.jobs.map(j=>j.id),['a','task']);
 assert.equal(packet.boundaries[0].targetId,'b');
 assert.equal(packet.board.jobs[0].gate?.accountable,'person');
 assert.equal(packet.board.questions[0].id,'q');
 assert.equal(packet.source.revision,9);
 assert.deepEqual(packet.board.comments.map(c=>c.id),['note']);
 assert.equal(packet.omitted.transcripts,1);
});
test('all export formats preserve the assignment without mutating the design',()=>{
 const before=JSON.stringify(board),packet=workflowExport(board,9,{purpose:'prototype',unknowns:'ask-first',constraints:'Use mock delivery only'});
 assert.match(exportPrompt(packet),/Build a reviewable prototype/);
 assert.match(exportPrompt(packet),/Ask before resolving unknown/);
 assert.match(exportMarkdown(packet),/Use mock delivery only/);
 assert.match(exportSvg(packet),/<svg/);
 const draft=JSON.parse(exportN8n(packet));assert.equal(draft.active,false);assert.deepEqual(draft.connections,{});assert.ok(draft.nodes.every((n:{type:string})=>n.type==='n8n-nodes-base.stickyNote'));
 assert.match(draft.nodes[0].parameters.content,/NOT EXECUTABLE/);
 assert.equal(JSON.stringify(board),before);
});
test('export rejects missing scopes rather than silently widening them',()=>{
 assert.throws(()=>workflowExport(board,9,{jobIds:['missing']}),/not available/);
 assert.throws(()=>workflowExport(board,9,{jobIds:[]}),/at least one/);
});


test('an offline prompt permits snapshot review without claiming live board access', () => {
 const prompt = exportPrompt(workflowExport(board, 9));
 assert.doesNotMatch(prompt, /If you cannot reach the board, say so and stop/);
 assert.match(prompt, /snapshot only/);
});
