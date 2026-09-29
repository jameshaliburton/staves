import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../store.js";
import { saveAssessmentRequest, getAssessment } from "../assessment-store.js";
import { saveDevelopmentLink } from "../development-store.js";
import { developmentOptionsSchema } from "../development.js";
import { designHistory } from "../design-history.js";
import { captureGitContext } from "../git-context.js";

const git = { source: "local-git" as const, observedAt: "2026-09-14T12:00:00Z", repository: { origin: "https://example.com/team/repo.git" }, branch: "feat/review", head: "a".repeat(40), unborn: false, worktree: true, dirty: { tracked: 1, untracked: 0, isDirty: true }, base: { ref: "main", commit: "b".repeat(40), isAncestorOfHead: true } };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(path.join(tmpdir(), "staves-development-"));t.after(() => rm(dir,{recursive:true,force:true}));
  const store = new Store(dir);
  await store.append("work", [{t:"board",id:"work",title:"Design"},{t:"track",track:{id:"owner",name:"Owner",kind:"person"}},{t:"job",job:{id:"review",name:"Review",track:"owner",inputs:[],outputs:[],status:"draft",provenance:{source:"human"}}}],"human");
  return store;
}
test("Git links preserve exact request and commit without accepting or implementing work",async t=>{
  const store=await fixture(t);const request=await saveAssessmentRequest(store,"work",{},"human");
  const record=await saveDevelopmentLink(store,"work",{git,requestId:request.id,pullRequest:{url:"https://example.com/team/repo/pull/7",state:"open",checkedAt:git.observedAt}},"agent:local");
  assert.equal(record.evidence,"development-report");assert.equal(record.recordedBy,"agent:local");assert.equal(record.options.git.head,git.head);
  assert.equal((await getAssessment(store,"work",request.id)).development[0].id,record.id);
  const board=await store.board("work");assert.equal(board.jobs[0].implementation,undefined);assert.equal(board.jobs[0].status,"draft");
  assert.equal((await designHistory(store,"work")).nodes[0].development[0].options.pullRequest?.state,"open");
});
test("reported merge requires full commit and check time; unsafe URLs and dirty contradictions reject",()=>{
  assert.equal(developmentOptionsSchema.safeParse({git,pullRequest:{url:"https://example.com/pull/7",state:"merged"}}).success,false);
  assert.equal(developmentOptionsSchema.safeParse({git,pullRequest:{url:"https://token@example.com/pull/7",state:"unknown"}}).success,false);
  assert.equal(developmentOptionsSchema.safeParse({git:{...git,repository:{origin:"https://token@example.com/team/repo"}}}).success,false);
  assert.equal(developmentOptionsSchema.safeParse({git:{...git,dirty:{...git.dirty,isDirty:false}}}).success,false);
  assert.equal(developmentOptionsSchema.safeParse({git,pullRequest:{url:"https://example.com/pull/7",state:"merged",mergeCommit:"c".repeat(40),checkedAt:git.observedAt}}).success,true);
});
test("links are immutable, actor is authoritative and refresh preserves history",async t=>{
  const store=await fixture(t);const first=await saveDevelopmentLink(store,"work",{git},"agent:local");
  await assert.rejects(store.append("work",[{t:"removeComment",id:`development:${first.id}`}],"human"),/immutable/);
  await assert.rejects(saveDevelopmentLink(store,"work",{git,supersedes:first.id},"agent:local"),/newer/);
  const next=await saveDevelopmentLink(store,"work",{git:{...git,observedAt:"2026-09-14T12:01:00Z",head:"c".repeat(40)},supersedes:first.id},"agent:local");
  assert.equal(next.options.supersedes,first.id);assert.equal((await store.board("work")).comments.filter(c=>c.development).length,2);
  await assert.rejects(saveDevelopmentLink(store,"work",{git,requestId:"missing"},"agent:local"),/existing/);
});
test("real local capture matches the persisted Git schema",async()=>{
  const context=await captureGitContext(process.cwd());assert.equal(developmentOptionsSchema.safeParse({git:context}).success,true);
});
