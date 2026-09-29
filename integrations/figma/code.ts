/// <reference path="./figma-api.d.ts" />
import { parsePacket,layoutPacket,isOpenQuestion,metadataChunks,type Packet,type Work } from './model';

const palette:Record<string,string>={person:'#8c593b',team:'#8c593b',agent:'#3d6a63',system:'#576c90',outside:'#7c688f'};
function paint(hex:string):Paint{return{type:'SOLID',color:{r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255}};}
function tag(node:ImportNode,packet:Packet,kind:string,id:string,data:unknown){node.setPluginData('staves.kind',kind);node.setPluginData('staves.id',id);node.setPluginData('staves.board',packet.source.boardId);node.setPluginData('staves.revision',String(packet.source.revision));const chunks=metadataChunks(data);node.setPluginData('staves.dataParts',String(chunks.length));chunks.forEach((chunk,i)=>node.setPluginData('staves.data.'+i,chunk));}
function frame(parent:ImportFrame|ImportFigma['currentPage'],name:string,x:number,y:number,width:number,height:number,fill='#ffffff'):ImportFrame{const node=figma.createFrame();parent.appendChild(node);node.name=name;node.x=x;node.y=y;node.resize(width,height);node.fills=[paint(fill)];node.strokes=[];node.clipsContent=false;return node;}
function text(parent:ImportFrame,value:string,x:number,y:number,width:number,size=13,color='#303541',bold=false):ImportText{const node=figma.createText();parent.appendChild(node);node.name=value.split('\n')[0].slice(0,100);node.fontName={family:'Inter',style:bold?'Semi Bold':'Regular'};node.fontSize=size;node.lineHeight={unit:'PERCENT',value:145};node.characters=value;node.resize(width,1);node.textAutoResize='HEIGHT';node.fills=[paint(color)];node.x=x;node.y=y;return node;}
function workCard(parent:ImportFrame,packet:Packet,work:Work,x:number,y:number):ImportFrame {
  const role=packet.board.tracks.find(t=>t.id===work.track)!;
  const node=frame(parent,(work.parent?'Task / ':'Job / ')+work.name,x,y,260,100);node.cornerRadius=8;node.strokes=[paint(palette[role.kind]||'#626976')];node.strokeWeight=1.5;
  let cy=14;const label=text(node,work.parent?'TASK · '+role.name:'JOB · '+role.name,14,cy,232,10,palette[role.kind]||'#626976',true);cy+=label.height+8;
  const title=text(node,work.name,14,cy,232,17,'#252832',true);cy+=title.height+10;
  if(work.parent){const parentName=packet.board.jobs.find(j=>j.id===work.parent)?.name||work.parent;const p=text(node,'Part of '+parentName,14,cy,232,11,'#626976');cy+=p.height+8;}
  if(work.outcome){const outcome=text(node,work.outcome,14,cy,232,13);cy+=outcome.height+10;}
  if(work.beneficiary){const beneficiary=text(node,'For '+work.beneficiary,14,cy,232,11,'#626976');cy+=beneficiary.height+8;}
  const progress=text(node,'Description: '+(work.status||'unknown')+'\nImplementation: '+(work.implementation?.state||'unknown'),14,cy,232,10,'#626976');cy+=progress.height+14;
  node.resize(260,cy);tag(node,packet,work.parent?'task':'job',work.id,work);return node;
}
export async function importPacket(packet:Packet):Promise<ImportFrame>{
  if(figma.editorType!=='figma')throw new Error('Open a Figma Design file. FigJam import is not supported by this version.');
  await Promise.all([figma.loadFontAsync({family:'Inter',style:'Regular'}),figma.loadFontAsync({family:'Inter',style:'Semi Bold'})]);
  const rows=layoutPacket(packet);const width=Math.max(960,240+Math.max(1,...rows.flatMap(r=>r.cells.map(c=>c.column+1)))*300);
  const origin=figma.viewport.center;const root=frame(figma.currentPage,packet.board.title+' · Staves r'+packet.source.revision,origin.x,origin.y,width,300,'#fafbfc');
  try{
    tag(root,packet,'board',packet.source.boardId,{source:packet.source,request:packet.request,omitted:packet.omitted,warnings:packet.warnings});
    let y=32;const title=text(root,packet.board.title,32,y,width-64,30,'#252832',true);y+=title.height+10;
    const subtitle=text(root,'Staves · '+packet.source.boardId+' · revision '+packet.source.revision+'\n'+(packet.board.goal||'Human outcome not described'),32,y,width-64,13,'#626976');y+=subtitle.height+24;
    const position=new Map<string,{x:number;y:number;width:number;height:number}>();
    for(const row of rows){
      const lane=frame(root,'Role / '+row.track.name,24,y,width-48,120,'#ffffff');tag(lane,packet,'track',row.track.id,row.track);
      text(lane,row.track.name,16,16,166,16,palette[row.track.kind]||'#626976',true);text(lane,row.track.kind,16,46,166,11,'#626976');
      let maxHeight=120;
      for(const cell of row.cells){let cy=16;for(const work of cell.work){const card=workCard(lane,packet,work,200+cell.column*300,cy);position.set(work.id,{x:24+card.x,y:y+card.y,width:card.width,height:card.height});cy+=card.height+16;}maxHeight=Math.max(maxHeight,cy);}
      lane.resize(width-48,maxHeight);y+=maxHeight+12;
    }
    const links=frame(root,'Handoffs — static editable lines',0,0,width,1);links.fills=[];root.insertChild(0,links);
    for(const [index,handoff] of packet.handoffs.entries()){
      const a=position.get(handoff.from),b=position.get(handoff.to);if(!a||!b)continue;
      const ax=a.x+a.width,ay=a.y+a.height/2,bx=b.x,by=b.y+b.height/2;
      const edge=figma.createLine();links.appendChild(edge);edge.name=(packet.board.artifacts?.find(a=>a.id===handoff.artifact)?.name||handoff.kind||'Handoff')+' / '+handoff.from+' → '+handoff.to;edge.resize(Math.max(1,Math.hypot(bx-ax,by-ay)),0);edge.x=ax;edge.y=ay;edge.rotation=-Math.atan2(by-ay,bx-ax)*180/Math.PI;edge.strokes=[paint('#98a3ac')];edge.strokeWeight=1;edge.opacity=.65;tag(edge,packet,'handoff',String(index),handoff);
    }
    const annotations=[
      ...packet.board.questions.filter(isOpenQuestion).map(q=>({kind:'question',id:q.id,title:'Open question · '+(packet.board.jobs.find(j=>j.id===q.about)?.name||q.about||'Workflow'),body:q.text,data:q})),
      ...packet.boundaries.map((b,i)=>({kind:'boundary',id:String(i),title:'Outside scope · '+b.relation,body:(packet.board.jobs.find(j=>j.id===b.jobId)?.name||b.jobId)+' → '+b.label+' ['+b.targetId+']',data:b})),
      ...(packet.board.regions||[]).map(r=>({kind:'epic',id:r.id,title:'Epic · '+(r.name||r.id),body:r.members.map(id=>packet.board.jobs.find(j=>j.id===id)?.name||id).join('\n'),data:r})),
    ];
    for(const note of annotations){const annotation=frame(root,note.title,32,y,width-64,100,note.kind==='question'?'#fff7e7':'#f0f3f7');const h=text(annotation,note.title,16,14,width-96,13,'#5d4e31',true);const body=text(annotation,note.body,16,h.height+22,width-96,13);annotation.resize(width-64,h.height+body.height+38);tag(annotation,packet,note.kind,note.id,note.data);y+=annotation.height+12;}
    const limits=text(root,'IMPORT NOTES\nEditable design snapshot; changes here do not sync back to Staves. Handoff lines are static and do not follow moved cards. Task responsibility is shown by its track; parent job IDs and all supplied job fields remain in plugin data. Epics and out-of-scope dependencies are annotations. Answered/resolved questions are preserved in metadata, not shown as open questions.\n'+packet.warnings.join('\n'),32,y+12,width-64,11,'#626976');
    tag(limits,packet,'reference','remaining-packet-data',{artifacts:packet.board.artifacts,questions:packet.board.questions,regions:packet.board.regions,boardContext:packet.board.context,boardIntent:packet.board.intent,comments:packet.board.comments});
    root.resize(width,y+limits.height+56);figma.currentPage.selection=[root];figma.viewport.scrollAndZoomIntoView([root]);return root;
  }catch(error){root.remove();throw error;}
}
figma.showUI(__html__,{width:420,height:390,themeColors:true});
let busy=false;
figma.ui.onmessage=async(message:unknown)=>{
  if(busy||!message||typeof message!=='object'||!('type'in message)||message.type!=='import'||!('text'in message)||typeof message.text!=='string')return;
  busy=true;try{const packet=parsePacket(message.text);await importPacket(packet);figma.ui.postMessage({type:'success',message:'Imported '+packet.board.jobs.length+' editable jobs and tasks. The source board is unchanged.'});}catch(error){figma.ui.postMessage({type:'error',message:error instanceof Error?error.message:'Could not import this handoff.'});}finally{busy=false;}
};
