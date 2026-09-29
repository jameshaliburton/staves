import { z } from 'zod';

const id = z.string().min(1).max(500);
const jobSchema = z.object({
  id, name: z.string().min(1), track: id, parent: id.optional(), order: z.number().finite().optional(),
  outcome: z.string().optional(), beneficiary: z.string().optional(), status: z.string().optional(),
  implementation: z.object({state:z.string(),note:z.string().optional()}).optional(),
  inputs:z.array(z.string()),outputs:z.array(z.string()),
}).passthrough();
export const packetSchema = z.object({
  schema:z.literal('staves.workflow-handoff'),schemaVersion:z.literal(1),
  source:z.object({boardId:id,revision:z.number().int().nonnegative()}).passthrough(),
  board:z.object({id,title:z.string(),goal:z.string().optional(),jobs:z.array(jobSchema).max(500),
    tracks:z.array(z.object({id,name:z.string(),kind:z.string()}).passthrough()).max(100),
    questions:z.array(z.object({id,about:z.string().optional(),text:z.string(),answer:z.string().optional(),status:z.string().optional()}).passthrough()).max(500),
    regions:z.array(z.object({id,name:z.string().optional(),members:z.array(id)}).passthrough()).optional(),
    artifacts:z.array(z.object({id,name:z.string()}).passthrough()).optional(),
  }).passthrough(),
  handoffs:z.array(z.object({from:id,to:id,artifact:z.string().optional(),kind:z.string().optional()}).passthrough()).max(2500),
  boundaries:z.array(z.object({jobId:id,relation:z.string(),targetId:id,label:z.string()}).passthrough()).max(2500),
  warnings:z.array(z.string()),request:z.record(z.unknown()),omitted:z.record(z.unknown()),
}).passthrough();
export type Packet=z.infer<typeof packetSchema>;
export type Work=Packet['board']['jobs'][number];
export function parsePacket(text:string):Packet {
  if(text.length>5_000_000)throw new Error('This file is too large. Export a smaller selection (maximum 5 MB).');
  let raw:unknown;try{raw=JSON.parse(text);}catch{throw new Error('This is not valid JSON. Download the JSON handoff from Staves.');}
  const result=packetSchema.safeParse(raw);
  if(!result.success)throw new Error('Expected a Staves workflow handoff, schema version 1, with at most 500 jobs/tasks. Export a new JSON handoff from Staves.');
  const p=result.data;
  const jobs=new Set<string>(),tracks=new Set<string>();
  for(const track of p.board.tracks){if(tracks.has(track.id))throw new Error('The handoff contains duplicate role IDs.');tracks.add(track.id);}
  for(const job of p.board.jobs){if(jobs.has(job.id))throw new Error('The handoff contains duplicate work IDs.');jobs.add(job.id);if(!tracks.has(job.track))throw new Error('A job refers to a role missing from this handoff.');}
  for(const job of p.board.jobs){const seen=new Set([job.id]);let parent=job.parent;while(parent&&jobs.has(parent)){if(seen.has(parent))throw new Error('The handoff contains a circular task hierarchy.');seen.add(parent);parent=p.board.jobs.find(j=>j.id===parent)?.parent;}}
  return p;
}
export function layoutPacket(packet:Packet){
  const jobs=packet.board.jobs,byId=new Map(jobs.map(j=>[j.id,j]));
  function root(job:Work):Work {let current=job;while(current.parent&&byId.has(current.parent))current=byId.get(current.parent)!;return current;}
  const roots=jobs.filter(j=>!j.parent||!byId.has(j.parent)).sort((a,b)=>(a.order??jobs.indexOf(a))-(b.order??jobs.indexOf(b)));
  const columns=new Map(roots.map((j,i)=>[j.id,i]));
  return packet.board.tracks.map(track=>({track,cells:roots.map(top=>({column:columns.get(top.id)!,root:top,work:jobs.filter(j=>j.track===track.id&&root(j).id===top.id)})).filter(cell=>cell.work.length)}));
}
export function isOpenQuestion(q:Packet['board']['questions'][number]){return !q.answer&&!['answered','done','dismissed'].includes(q.status||'');}
export function metadataChunks(value:unknown):string[]{const text=JSON.stringify(value);const chunks:string[]=[];for(let i=0;i<text.length;i+=16000)chunks.push(text.slice(i,i+16000));return chunks;}
