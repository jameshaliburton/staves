import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateXML } from "xmllint-wasm";
import { fold, type Entry, type Op } from "../ops.js";
import { toStavesDocument, type StavesDocument } from "../format.js";
import { toMermaid } from "../mermaid.js";
import { toBPMN } from "../bpmn.js";

const root = new URL("../../", import.meta.url);
const example: StavesDocument = JSON.parse(readFileSync(new URL("spec/examples/support-triage.staves.json", root), "utf8"));
const library = async () => {
  const lib = await import(new URL("design/editor/library.mjs", root).href) as { examples: { id: string }[]; exampleOps: (id: string) => Op[] };
  return lib.examples.map(e => toStavesDocument(fold(lib.exampleOps(e.id).map((op, i): Entry => ({ op, seq: i + 1, by: "test", at: "2026-09-23T10:00:00.000Z" })))));
};
const xsd = ["BPMN20.xsd", "Semantic.xsd", "BPMNDI.xsd", "DC.xsd", "DI.xsd"].map(fileName => ({ fileName, contents: readFileSync(new URL(`src/test/fixtures/bpmn/${fileName}`, root), "utf8") }));
async function assertValidBPMN(xml: string, label: string) {
  const result = await validateXML({ xml: [{ fileName: `${label}.bpmn`, contents: xml }], schema: [xsd[0]], preload: xsd.slice(1) });
  assert.ok(result.valid, `${label}: ${result.errors.map(e => e.message).join("\n")}`);
}

test("mermaid: tracks are subgraphs, jobs are nodes, handoffs carry what passes, a gate sits with who answers for it", () => {
  const chart = toMermaid(example);
  assert.match(chart, /^flowchart LR\n/);
  for (const t of example.tracks) assert.match(chart, new RegExp(`subgraph t\\d+\\["${t.name}"\\]`));
  assert.match(chart, /j\d+ -->\|"Ticket"\| j\d+/);
  assert.match(chart, /-\.->\|"no help-centre article matches"\|/);
  const lead = chart.slice(chart.indexOf('["Support lead"]'), chart.indexOf("end", chart.indexOf('["Support lead"]')));
  assert.match(lead, /g\d+\{"nothing leaves without a cited source"\}/, "the gate is drawn on the support lead's track");
  assert.match(chart, /g\d+ -->\|"Reply"\|/, "what a gated job hands on leaves from its gate");
  assert.match(chart, /Sources: 4 read from code · 1 from interviews · 1 of 5 confirmed by a person/);
  assert.match(chart, /red = sources disagree \(1\)/);
  assert.match(chart, /class j\d+ disputed/);
});

test("mermaid: tasks fold into their job, and what people typed cannot break the chart", () => {
  const doc: StavesDocument = { staves: "0.1", id: "b", title: "b", stance: "as-is",
    tracks: [{ id: "p", name: 'The "A" team #1', kind: "person" }],
    artifacts: [{ id: "x", name: "<b>x</b>", kind: "data" }],
    jobs: [
      { id: "a", name: "Job A", track: "p", inputs: [], outputs: [] },
      { id: "a1", name: "Task of A", parent: "a", track: "p", inputs: [], outputs: ["x"] },
      { id: "b", name: "Job B", track: "p", inputs: ["x"], outputs: [] },
    ] };
  const chart = toMermaid(doc);
  assert.ok(!chart.includes("Task of A"), "tasks are folded into their job");
  assert.match(chart, /j0 -->\|"#lt;b#gt;x#lt;\/b#gt;"\| j1/, "a task's handoff is drawn from its job");
  assert.match(chart, /\["The #quot;A#quot; team #35;1"\]/);
});

test("bpmn: every export validates against the BPMN 2.0 schema", async () => {
  const docs = [example, ...await library()];
  for (const doc of docs) await assertValidBPMN(toBPMN(doc), doc.id);
});

test("bpmn: the mapping in spec/MAPPINGS.md", () => {
  const xml = toBPMN(example);
  assert.match(xml, /isExecutable="false"/);
  assert.match(xml, /<bpmn:lane id="Lane_agent-triage" name="Triage agent">/);
  assert.match(xml, /<bpmn:participant id="Participant_customer" name="Customer" \/>/, "an outside track is its own pool");
  assert.match(xml, /<bpmn:messageFlow [^>]*name="Ticket" sourceRef="Participant_customer" targetRef="Task_answer"/);
  assert.match(xml, /<bpmn:serviceTask id="Task_answer" name="Answer the question">/);
  assert.match(xml, /<bpmn:userTask id="Task_escalate" name="Take over the ticket">/);
  assert.match(xml, /<bpmn:userTask id="Decision_escalate" name="Decide: nothing leaves without a cited source">/, "a gate is a user task for whoever answers for it");
  assert.match(xml, /<bpmn:exclusiveGateway id="Gateway_answer">/, "exits leave through a gateway");
  assert.match(xml, /<bpmn:sequenceFlow [^>]*name="no help-centre article matches" sourceRef="Gateway_answer" targetRef="Task_escalate"/);
  assert.match(xml, /<bpmn:dataObjectReference [^>]*name="Draft answer"/);
  assert.match(xml, /<staves:provenance method="interview" by="role:support-lead"[^>]*confirmed="true"/);
  assert.match(xml, /Sources disagree about gate\./);
  assert.match(xml, /<bpmndi:BPMNShape id="Shape_Task_answer" bpmnElement="Task_answer">/, "it opens drawn");
});

test("bpmn: a job with tasks is a sub-process with its own page, and ids BPMN cannot hold are made safe", async () => {
  const doc: StavesDocument = { staves: "0.1", id: "9 lives", title: "Nine & <lives>", stance: "as-is",
    tracks: [{ id: "1st", name: "First", kind: "system" }, { id: "p", name: "Person", kind: "person" }],
    artifacts: [{ id: "x", name: "X", kind: "data" }],
    jobs: [
      { id: "a:b", name: "Composite", track: "1st", inputs: [], outputs: [] },
      { id: "t1", name: "First task", parent: "a:b", track: "1st", inputs: [], outputs: ["x"], loop: { to: "t1", limit: 3 } },
      { id: "c", name: "After", track: "p", inputs: ["x"], outputs: [], exits: [{ condition: "done", target: "stop" }] },
    ] };
  const xml = toBPMN(doc);
  await assertValidBPMN(xml, "safe-ids");
  assert.match(xml, /<bpmn:subProcess id="SubProcess_a_b" name="Composite">/);
  assert.match(xml, /<bpmndi:BPMNPlane id="Plane_SubProcess_a_b" bpmnElement="SubProcess_a_b">/);
  assert.match(xml, /<bpmn:standardLoopCharacteristics loopMaximum="3" \/>/);
  assert.match(xml, /sourceRef="SubProcess_a_b" targetRef="Task_c"/, "a task's handoff leaves from its sub-process");
  assert.match(xml, /<bpmn:endEvent id="End_c_stop" name="done">/);
  assert.match(xml, /name="Nine &amp; &lt;lives&gt;"/);
});
