import {parsePacket,layoutPacket,isOpenQuestion} from '../figma/model';
interface Item {id:string}
export interface MiroBoard {
  createShape(props:{shape:'round_rectangle'|'rectangle';content:string;x:number;y:number;width:number;height:number;style:Record<string,string|number>}):Promise<Item>;
  createConnector(props:{shape:'elbowed';start:{item:string};end:{item:string}}):Promise<Item>;
  remove(item:Item):Promise<void>;
}
const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Call from an installed Miro Web SDK app after an explicit import action. */
export async function importToMiro(json:string,board:MiroBoard,progress:(message:string)=>void=()=>{}) {
 const packet=parsePacket(json),created:Item[]=[],mapping=new Map<string,string>();
 const labels:string[]=[];
 try {
  let y=0;
  const shape=async(content:string,x:number,sy:number,width=320,height=240,color='#ffffff')=>{
   if(content.length>=6000)throw new Error('A note exceeds Miro’s text limit. Export a smaller description.');
   const item=await board.createShape({shape:'round_rectangle',content,x,y:sy,width,height,style:{fillColor:color,borderColor:'#a8b0bb',borderWidth:1,color:'#252832',fontSize:14,textAlign:'left',textAlignVertical:'top'}});created.push(item);return item;
  };
  await shape('<p><strong>'+escapeHtml(packet.board.title)+'</strong></p><p>'+escapeHtml(packet.source.boardId)+' · revision '+packet.source.revision+'</p><p>Design snapshot. Changes in Miro do not sync back. The accompanying JSON preserves complete semantics.</p>',0,-300,460,230,'#edf1f8');
  for(const row of layoutPacket(packet)) {
   await shape('<p><strong>'+escapeHtml(row.track.name)+'</strong></p><p>'+escapeHtml(row.track.kind)+'</p>',0,y,210,150,'#f1f3f7');
   let height=260;
   for(const cell of row.cells){let offset=0;for(const job of cell.work){
    const text='<p><strong>'+escapeHtml(job.name)+'</strong></p><p>'+escapeHtml(job.parent?'Task of '+job.parent:'Job')+' · '+escapeHtml(job.id)+'</p><p>'+escapeHtml(job.outcome||'Outcome not described')+'</p><p>For: '+escapeHtml(job.beneficiary||'Unknown')+'</p><p>Implementation: '+escapeHtml(job.implementation?.state||'unknown')+'</p>';
    const item=await shape(text,360+cell.column*360,y+offset);mapping.set(job.id,item.id);offset+=270;progress('Imported '+mapping.size+' of '+packet.board.jobs.length+' jobs and tasks');
   }height=Math.max(height,offset);}
   y+=height+80;
  }
  for(const link of packet.handoffs){const from=mapping.get(link.from),to=mapping.get(link.to);if(from&&to){created.push(await board.createConnector({shape:'elbowed',start:{item:from},end:{item:to}}));}else labels.push('Dependency outside scope: '+link.from+' → '+link.to);}
  for(const question of packet.board.questions.filter(isOpenQuestion))labels.push('Open question ['+(question.about||'board')+']: '+question.text);
  for(const job of packet.board.jobs){if(job.gate&&typeof job.gate==='object'){labels.push('Decision ['+job.id+']: '+JSON.stringify(job.gate));}if(job.checks)labels.push('Checks ['+job.id+']: '+JSON.stringify(job.checks));}
  for(const boundary of packet.boundaries)labels.push('Boundary ['+boundary.jobId+']: '+boundary.relation+' → '+boundary.label);
  for(const region of packet.board.regions||[])labels.push('Epic '+(region.name||region.id)+': '+region.members.join(', '));
  for(const [i,label] of labels.entries())await shape('<p>'+escapeHtml(label)+'</p>',360+(i%3)*360,y+Math.floor(i/3)*260,320,240,'#fff7e8');
  return {boardId:packet.source.boardId,revision:packet.source.revision,items:created,mapping:Object.fromEntries(mapping)};
 }catch(error){let remaining=0;for(const item of created.reverse()){try{await board.remove(item);}catch{remaining++;}}throw new Error((error instanceof Error?error.message:'Import failed')+(remaining?' '+remaining+' partial items could not be removed; inspect the destination board before retrying.':' Created items were removed.'));}
}
