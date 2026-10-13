import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAcceptanceReadiness} from '../src/core/readiness.ts';
const base={issueCode:'20264000',releaseAt:'2026-09-14T00:00:00+09:00',cutoffAt:'2026-09-10T00:00:00+09:00',now:'2026-09-08T18:00:00+09:00',reviewedAt:'2026-09-08T17:00:00Z',plannedWorks:[{workId:'0001',color:'lead' as const},{workId:'0002',color:'none' as const}],conflictingWorkReferences:[],anotherIssueOpen:false};
test('can open only when required issue fields and plan are confirmed',()=>{
  assert.deepEqual(checkAcceptanceReadiness(base),{ready:true,errors:[]});
  const missing=checkAcceptanceReadiness({...base,reviewedAt:null,conflictingWorkReferences:['2026年2号'],anotherIssueOpen:true});
  assert.equal(missing.ready,false);assert.equal(missing.errors.length,3);
  assert.equal(checkAcceptanceReadiness({...base,cutoffAt:'2026-09-07T00:00:00+09:00'}).ready,false);
  assert.equal(checkAcceptanceReadiness({...base,plannedWorks:[]}).ready,false);
});
