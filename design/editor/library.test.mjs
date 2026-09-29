import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Store } from '../../dist/store.js';
import { examples, exampleOps, workspaceApi } from './library.mjs';

async function withStore(work) {
  const dir = await mkdtemp(join(tmpdir(), 'staves-library-'));
  try { await work(new Store(dir)); } finally { await rm(dir, { recursive: true, force: true }); }
}
async function request(store, path, method = 'GET', body) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  const response = { statusCode: 200, setHeader() {}, end(text) { this.body = JSON.parse(text); } };
  assert.equal(await workspaceApi(req, response, new URL(path, 'http://localhost'), store), true);
  return response;
}

test('four fictional examples fold with intact tasks, roles, gates and planned states', async () => {
  await withStore(async store => {
    assert.equal(examples.length, 4);
    for (const example of examples) {
      const board = await store.append(example.id, exampleOps(example.id), 'human');
      assert.ok(board.tracks.filter(track => track.kind === 'agent').length >= 2);
      assert.ok(board.tracks.some(track => track.kind === 'person'));
      assert.ok(board.goal);
      assert.equal(board.context.stance, 'to-be');
      assert.equal(example.preview.length, board.tracks.length);
      assert.equal(example.preview.reduce((sum, row) => sum + row.positions.length, 0), example.jobCount);
      assert.ok(example.preview.every(row => row.positions.every(position => position >= 0 && position <= 1)));
      const ids = new Set(board.jobs.map(job => job.id));
      const tracks = new Set(board.tracks.map(track => track.id));
      const artifacts = new Set(board.artifacts.map(artifact => artifact.id));
      assert.equal(ids.size, board.jobs.length);
      for (const job of board.jobs) {
        assert.ok(tracks.has(job.track));
        assert.equal(job.implementation.state, 'planned');
        if (job.parent) assert.ok(ids.has(job.parent));
        for (const artifact of [...job.inputs, ...job.outputs]) assert.ok(artifacts.has(artifact));
        for (const exit of job.exits || []) assert.ok(exit.target === 'stop' || ids.has(exit.target));
      }
      assert.ok(board.jobs.some(job => job.gate));
      assert.ok(board.jobs.some(job => job.checks?.length));
      assert.ok(board.questions.length);
      const firstOps = exampleOps(example.id);
      firstOps[1].context.purpose = 'mutated';
      assert.notEqual(exampleOps(example.id)[1].context.purpose, 'mutated');
    }
  });
});

test('creation is unique, path safe and starts with context for every source', async () => {
  await withStore(async store => {
    const title = '../../My workflow';
    const first = await request(store, '/workspace-api/boards', 'POST', { title, source: 'project', goal: 'Help a person decide' });
    const second = await request(store, '/workspace-api/boards', 'POST', { title, source: 'blank', goal:'Help someone choose a next step' });
    const third = await request(store, '/workspace-api/boards', 'POST', { title: 'Research', source: 'example', exampleId: 'evidence-research' });
    assert.equal(first.statusCode, 201);
    assert.notEqual(first.body.id, second.body.id);
    assert.match(first.body.id, /^[a-z0-9-]+$/);
    assert.equal(first.body.next, 'connect');assert.equal(second.body.next,'interview');assert.equal((await store.board(second.body.id)).goal,'Help someone choose a next step');
    for (const result of [first, second, third]) {
      const board = await store.board(result.body.id);
      assert.equal(board.id, result.body.id);
      assert.ok(board.context);
    }
    const listing = await request(store, '/workspace-api');
    assert.equal(listing.body.boards.length, 3);
    assert.equal(listing.body.examples.length, 4);
    assert.deepEqual(listing.body.boards.find(board => board.id === third.body.id).preview, examples.find(example => example.id === 'evidence-research').preview);
    assert.equal(listing.body.boards.find(board => board.id === third.body.id).jobs, 5);
    assert.ok(listing.body.boards.every(board => typeof board.roles === 'number' && board.revision > 0));
  });
});

test('invalid creation is rejected without leaving a board', async () => {
  await withStore(async store => {
    for (const input of [{ title: '', source: 'blank' }, { title: 'X', source: 'other' }, { title: 'X', source: 'example', exampleId: '../bad' }, { title: 'X', source: 'blank', goal: 3 }, {title:'X',source:'blank',goal:'  '}, {title:'X',source:'blank'}]) {
      assert.equal((await request(store, '/workspace-api/boards', 'POST', input)).statusCode, 400);
    }
    assert.deepEqual(await store.list(), []);
    assert.equal((await request(store, '/workspace-api/boards', 'DELETE')).statusCode, 400);
  });
});

test('support triage branches share a ready answer without routing routine work through a specialist', async () => {
  await withStore(async store => {
    const { handoffs } = await import('../../dist/derive.js');
    const board = await store.append('support', exampleOps('support-triage'), 'human');
    const job = id => board.jobs.find(job => job.id === id);
    assert.deepEqual(job('approve').inputs, ['triage']);
    assert.deepEqual(job('draft').inputs, ['triage']);
    assert.deepEqual(job('deliver').inputs, ['ready-reply']);
    assert.deepEqual(job('draft').outputs, ['ready-reply']);
    assert.deepEqual(job('approve').outputs, ['ready-reply']);
    assert.equal(board.artifacts.filter(artifact => artifact.id === 'ready-reply').length, 1);
    assert.match(job('deliver').triggerNote, /One answer is sufficient/);
    assert.deepEqual(job('approve-task-1').inputs, ['triage']);
    const edges = handoffs(board).filter(edge => !job(edge.from).parent && !job(edge.to).parent);
    assert.ok(edges.some(edge => edge.from === 'route' && edge.to === 'draft' && edge.kind === 'exit'));
    assert.ok(edges.some(edge => edge.from === 'route' && edge.to === 'approve' && edge.kind === 'exit'));
    assert.ok(edges.some(edge => edge.from === 'draft' && edge.to === 'deliver'));
    assert.ok(edges.some(edge => edge.from === 'approve' && edge.to === 'deliver'));
    assert.ok(!edges.some(edge => edge.from === 'draft' && edge.to === 'approve'));
  });
});

test('retrying an uncertain creation preserves one board, including concurrent retries', async () => {
  await withStore(async store => {
    const input = { title: 'A request that may time out', source: 'project', requestId: 'a704ca7f-a4b0-4eb8-afdd-3c2c05478b80' };
    const results = await Promise.all(Array.from({ length: 8 }, () => request(store, '/workspace-api/boards', 'POST', input)));
    assert.equal(new Set(results.map(result => result.body.id)).size, 1);
    assert.equal((await store.list()).length, 1);
    const id = results[0].body.id;
    const entries = await store.entries(id);
    await request(new Store(store.dir), '/workspace-api/boards', 'POST', input);
    assert.equal((await store.entries(id)).length, entries.length);
    assert.equal(entries.filter(entry => entry.op?.t === 'board').length, 1);
  });
});

test('explicit manual start can defer the goal while interview start cannot',async()=>{
 await withStore(async store=>{
  const manual=await request(store,'/workspace-api/boards','POST',{title:'Manual sketch',source:'blank',startMode:'manual'});
  assert.equal(manual.statusCode,201);assert.equal(manual.body.next,'canvas');
  const interview=await request(store,'/workspace-api/boards','POST',{title:'Interview',source:'blank',startMode:'interview'});
  assert.equal(interview.statusCode,400);assert.equal((await store.list()).length,1);
 });
});


test('saved templates are independent design snapshots and survive source deletion', async () => {
  await withStore(async store => {
    await store.append('source', exampleOps('support-triage'), 'human');
    await store.append('source', [{t:'comment',comment:{id:'secret',about:'board',by:'human',text:'private conversation'}},{t:'updateJob',id:'draft',patch:{sources:[{path:'secret-path'}],instructions:[{path:'prompt',text:'secret-prompt'}],boardRef:'another-board'}}], 'human');
    await store.append('source', [{t:'track',track:{id:'pending',name:'Unapproved',kind:'agent'}}], 'agent', true);
    const input = {boardId:'source',title:'My support pattern',requestId:'a704ca7f-a4b0-4eb8-afdd-3c2c05478b81'};
    const saved=await request(store,'/workspace-api/templates','POST',input);
    assert.equal(saved.statusCode,201);
    await request(store,'/workspace-api/templates','POST',input);
    const listing=(await request(store,'/workspace-api')).body;
    assert.equal(listing.boards.length,1);assert.equal(listing.templates.length,1);
    const template=await store.board(saved.body.id);
    assert.equal(template.comments.length,0);assert.equal(template.questions.length,0);
    assert.equal(template.tracks.some(track=>track.id==='pending'),false);
    assert.equal(JSON.stringify(await store.entries(saved.body.id)).includes('secret'),false);
    assert.ok(template.jobs.some(job=>job.gate));assert.ok(template.jobs.some(job=>job.parent));
    const create=()=>request(store,'/workspace-api/boards','POST',{title:'New copy',source:'template',templateId:saved.body.id});
    const first=await create(), second=await create();
    assert.equal(first.statusCode,201);assert.notEqual(first.body.id,second.body.id);
    await store.append(first.body.id,[{t:'updateJob',id:'draft',patch:{name:'Changed'}}],'human');
    assert.notEqual((await store.board(second.body.id)).jobs.find(job=>job.id==='draft').name,'Changed');
    assert.notEqual((await store.board(saved.body.id)).jobs.find(job=>job.id==='draft').name,'Changed');
    assert.equal((await request(store,'/workspace-api/boards?board=source','DELETE',{})).statusCode,400);
    assert.ok((await store.list()).includes('source'));
    assert.equal((await request(store,'/workspace-api/boards?board=source','DELETE',{confirm:true})).statusCode,200);
    assert.equal((await create()).statusCode,201);
    assert.equal((await request(store,'/workspace-api/boards?board=../escape','DELETE',{confirm:true})).statusCode,400);
    assert.equal((await request(store,'/workspace-api/templates','POST',{...input,requestId:'a704ca7f-a4b0-4eb8-afdd-3c2c05478b82',boardId:'missing'})).statusCode,404);
  });
});

test('deletion does not silently destroy dependent scenarios',async()=>{
  await withStore(async store=>{
    await store.append('base',[{t:'board',id:'base',title:'Base'}],'human');
    await store.branch('base','scenario','Scenario');
    assert.equal((await request(store,'/workspace-api/boards?board=base','DELETE',{confirm:true})).statusCode,409);
    assert.ok((await store.list()).includes('base'));
  });
});
