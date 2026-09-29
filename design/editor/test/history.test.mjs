import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../history.js',import.meta.url),'utf8');
function harness(pending){
  const nodes=new Map();const make=()=>({hidden:true,setAttribute(){},append(){},after(){},focus(){},addEventListener(){},classList:{add(){},remove(){}},querySelector:key=>{if(!nodes.has(key))nodes.set(key,make());return nodes.get(key);},querySelectorAll:()=>[]});
  const panel=make(),requests=[];
  const context=vm.createContext({document:{body:make(),createElement:tag=>tag==='section'?panel:make(),querySelector:()=>make()},state:{name:'source',board:{}},render(){},URL,AbortSignal,encodeURIComponent,esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),fetch:async(url,options)=>{requests.push({url,options});if(pending)await pending;return {ok:true,json:async()=>({selectedBoard:'source',nodes:[],warnings:[]})};}});
  vm.runInContext(source,context);return {context,panel,requests};
}
const node=(id,parent)=>({id,title:id,revision:7,availability:'available',...(parent?{baseline:{pinned:true,sourceBoard:parent,capturedAt:'2026-09-14T10:00:00Z'}}:{}),assessments:[],walkthroughs:[],acceptances:[],development:[]});
test('graph preserves sibling lanes, nested parentage and finite cycles',()=>{
  const h=harness();const nodes=[node('nested','first'),node('second','source'),node('source'),node('first','source')];
  const graph=h.context.historyGraphModel({nodes,selectedBoard:'nested'});
  assert.equal(graph.nodes[0].id,'source');assert.ok(graph.nodes.findIndex(n=>n.id==='first')<graph.nodes.findIndex(n=>n.id==='nested'));
  assert.equal(graph.nodes.find(n=>n.id==='second').baseline.sourceBoard,'source');
  assert.equal(h.context.historyGraphModel({nodes:[node('a','b'),node('b','a')]}).nodes.length,2);
});
test('milestones retain exact revision and report data without conflating code and design',()=>{
  const h=harness(),n=node('source');n.assessments=[{id:'req',at:'2026-09-14T10:00:00Z',intent:'assess',sourceRevision:3,returns:[{at:'2026-09-14T11:00:00Z',status:'stale',tests:[]}]}];n.development=[{recordedAt:'2026-09-14T12:00:00Z',designRevision:5,options:{git:{branch:'feature',head:'abc'},pullRequest:{state:'merged'}}}];
  const g=h.context.historyGraphModel({nodes:[n]});
  assert.equal(g.events.find(e=>e.kind==='report').revision,3);assert.equal(g.events.find(e=>e.kind==='report').detail.status,'stale');
  assert.match(g.events.find(e=>e.kind==='git').label,/reported/);assert.equal(g.events.find(e=>e.kind==='head').revision,7);
});
test('opening is read-only and closing suppresses outstanding response',async()=>{
  let finish;const pending=new Promise(resolve=>finish=resolve),h=harness(pending);let paints=0;h.context.paintHistoryGraph=()=>paints++;
  const opening=h.context.openDesignHistory();assert.equal(h.panel.hidden,false);h.context.closeDesignHistory();finish();await opening;
  assert.equal(paints,0);assert.equal(h.panel.hidden,true);assert.equal(h.requests[0].options.method,undefined);
});
test('history is a nonmodal dock and cannot write or navigate on milestone selection',()=>{
  assert.match(source,/createElement\('section'\)/);assert.doesNotMatch(source,/showModal|method:\s*['"]POST/);
  assert.match(source,/aria-expanded/);assert.match(source,/history-open/);
  const select=source.slice(source.indexOf('function selectHistoryEvent'),source.indexOf('async function compareHistoryDesign'));
  assert.doesNotMatch(select,/location\.(href|assign)\s*=/);
  const css=readFileSync(new URL('../history.css',import.meta.url),'utf8');assert.match(css,/body\.history-open #ws/);
});
test('unsafe repository links remain inert and labels are escaped',()=>{
  const h=harness();for(const url of ['javascript:alert(1)','data:text/html,x','https://user:secret@example.com'])assert.equal(h.context.designHistorySafeUrl(url),null);
  assert.doesNotMatch(h.context.historyLink('javascript:alert(1)','<script>x</script>'),/<a|<script>/);
});
test('legacy baselines have unresolved markers instead of claiming an immutable capture',()=>{
  const h=harness(),legacy=node('legacy');legacy.baseline={pinned:false,sourceBoard:'missing'};
  const event=h.context.historyGraphModel({nodes:[legacy]}).events[0];assert.equal(event.kind,'legacy');assert.equal(event.label,'Unpinned source');
});
