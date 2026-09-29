import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { APP2_JS } from "../app2.js";
import { scorecard, reviewData } from "../derive.js";
import { fold } from "../ops.js";

test("effort display distinguishes absent work, missing estimates and supplied zero", () => {
  const source = APP2_JS.slice(APP2_JS.indexOf('function effortLabel('), APP2_JS.indexOf('function header('));
  const label = runInNewContext(source + ';effortLabel') as (sc: object, key: string) => string;
  assert.equal(label({}, 'humanHours'), 'Not estimated');
  assert.equal(label({humanHours: 0}, 'humanHours'), 'Not estimated');
  assert.equal(label({humanHours: 0, humanJobs: 0, humanHoursUnknown: []}, 'humanHours'), 'No work modeled');
  assert.equal(label({humanHours: 0, humanJobs: 1, humanHoursUnknown: ['review']}, 'humanHours'), 'Incomplete (1 unspecified)');
  assert.equal(label({humanHours: 0, humanJobs: 1, humanHoursUnknown: []}, 'humanHours'), '0.0');
  assert.equal(label({agentHours: 2, agentJobs: 1, agentHoursUnknown: []}, 'agentHours'), '2.0');
});

test("empty board exposes that effort has no modeled jobs", () => {
  const board = fold([]);
  const sc = scorecard(board);
  assert.equal(sc.humanJobs, 0);
  assert.equal(sc.agentJobs, 0);
});


test("review does not present an unassigned human role as measured zero effort", () => {
  const board = fold([]);
  board.tracks.push({id: 'operator', name: 'Operator', kind: 'person'});
  const fact = reviewData(board).facts.find(f => f.label === 'estimated human hours a week');
  assert.equal(fact?.value, 'No work modeled');
});
