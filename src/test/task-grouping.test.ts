import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../store.js';
import type {Job} from '../model.js';

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'staves-grouping-'));
  const store = new Store(dir);
  const jobs: Job[] = [
    {id:'first',name:'First job',track:'human',inputs:[],outputs:[],provenance:{source:'human'},status:'confirmed'},
    {id:'second',name:'Second job',track:'agent',inputs:[],outputs:[],provenance:{source:'human'},status:'confirmed'},
    {id:'a',name:'Research',parent:'first',track:'human',inputs:['brief'],outputs:['notes'],provenance:{source:'human'},status:'confirmed'},
    {id:'b',name:'Summarize',parent:'second',track:'agent',inputs:['notes'],outputs:['summary'],provenance:{source:'human'},status:'confirmed'},
  ];
  await store.append('work',jobs.map(job=>({t:'job',job})), 'human');
  return {store,dir,jobs};
}
test('one undo restores both collected tasks and redo recreates the same job', async () => {
  const {store,dir,jobs}=await fixture();
  try {
    await store.append('work',[{t:'collect',id:'new',name:'Result',track:'agent',into:['a','b']}],'human');
    const grouped=JSON.parse(JSON.stringify((await store.board('work')).jobs));
    for(let cycle=0;cycle<2;cycle++) {
      await store.undo('work'); assert.deepEqual((await store.board('work')).jobs,jobs);
      await store.redo('work'); assert.deepEqual(JSON.parse(JSON.stringify((await store.board('work')).jobs)),grouped);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('undo does not overwrite subsequent agent edits to collected tasks', async () => {
  const {store,dir}=await fixture();
  try {
    await store.append('work',[{t:'collect',id:'new',name:'Result',track:'agent',into:['a','b']}],'human');
    await store.append('work',[{t:'updateJob',id:'a',patch:{name:'New research'}}],'agent');
    await assert.rejects(store.undo('work'),/Grouped tasks changed/);
    assert.equal((await store.board('work')).jobs.find(j=>j.id==='a')?.name,'New research');
    assert.ok((await store.board('work')).jobs.some(j=>j.id==='new'));
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('redo does not overwrite changes made after ungrouping', async () => {
  const {store,dir}=await fixture();
  try {
    await store.append('work',[{t:'collect',id:'new',name:'Result',track:'agent',into:['a','b']}],'human');
    await store.undo('work');
    await store.append('work',[{t:'updateJob',id:'a',patch:{track:'agent'}}],'agent');
    await assert.rejects(store.redo('work'),/Grouped tasks changed/);
    assert.equal((await store.board('work')).jobs.find(j=>j.id==='a')?.track,'agent');
    assert.ok(!(await store.board('work')).jobs.some(j=>j.id==='new'));
  } finally {await rm(dir,{recursive:true,force:true});}
});
