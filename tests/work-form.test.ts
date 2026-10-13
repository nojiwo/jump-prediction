import test from 'node:test';
import assert from 'node:assert/strict';
import {changeWorkKind} from '../src/core/work-form.ts';

test('serial -> oneshot keeps a usable issue without manual touching of the issue picker',()=>{
 const edited=changeWorkKind({kind:'serial' as const,periods:[{start_issue_code:'20264200',end_issue_code:null}],oneShots:[]},'oneshot');
 assert.equal(edited.kind,'oneshot');
 assert.deepEqual(edited.oneShots,['20264200']);
});

test('oneshot -> serial restores at least one period',()=>{
 const edited=changeWorkKind({kind:'oneshot' as const,oneShots:['20260304'],periods:[]},'serial');
 assert.equal(edited.kind,'serial');
 assert.deepEqual(edited.periods,[{start_issue_code:'20260304',end_issue_code:null}]);
});

test('changing kind twice does not lose existing serialization history',()=>{
 const original={kind:'serial' as const,periods:[{start_issue_code:'20260100',end_issue_code:'20262500'},{start_issue_code:'20264000',end_issue_code:null}],oneShots:[] as string[]};
 const switched=changeWorkKind(changeWorkKind(original,'oneshot'),'serial');
 assert.deepEqual(switched.periods,original.periods);
});

test('switch to same kind retains current form unchanged',()=>{
 const original={kind:'oneshot' as const,oneShots:['20264300']};
 assert.equal(changeWorkKind(original,'oneshot'),original);
});
