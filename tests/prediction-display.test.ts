import test from 'node:test';
import assert from 'node:assert/strict';
import {pickPredictionDisplayIssue} from '../src/core/prediction-display.ts';
const issue=(code:string, status:'planned'|'open'|'closed', release_at=`2026-10-${code.slice(4,6)}T00:00:00Z`)=>(
  {code,status,release_at,cutoff_at:'2026-10-01T00:00:00Z'}
);

test('the current accepting issue replaces the last closed issue',()=>{
  const issues=[issue('20264000','closed'),issue('20264300','planned'),issue('20264100','open')];
  assert.equal(pickPredictionDisplayIssue(issues)?.code,'20264100');
});

test('closed issue stays available for post-deadline comparison before next intake',()=>{
  const issues=[issue('20263900','closed'),issue('20264300','planned'),issue('20264100','closed')];
  assert.equal(pickPredictionDisplayIssue(issues)?.code,'20264100');
});

test('planned issues and no issues never become public prediction screens',()=>{
  assert.equal(pickPredictionDisplayIssue([issue('20264400','planned')]),null);
  assert.equal(pickPredictionDisplayIssue([]),null);
});

test('magazine release date, not input list order, chooses last closed issue',()=>{
  const issues=[issue('20264000','closed','2026-09-15T00:00:00Z'),issue('20264100','closed','2026-09-01T00:00:00Z')];
  assert.equal(pickPredictionDisplayIssue(issues)?.code,'20264000');
});
