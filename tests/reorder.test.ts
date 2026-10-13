import test from 'node:test';
import assert from 'node:assert/strict';
import {moveRankedItem} from '../src/core/reorder.ts';

test('mobile touch reorder preserves every work exactly once and does not mutate source',()=>{
  const before=['0001','0002','0003','0004'];
  const after=moveRankedItem(before,0,3);
  assert.deepEqual(after,['0002','0003','0004','0001']);
  assert.deepEqual(before,['0001','0002','0003','0004']);
  assert.deepEqual(moveRankedItem(after,3,0),before);
});

test('invalid touch destinations do not corrupt ranking order',()=>{
  const before=['0001','0002','0003'];
  for(const [from,to] of [[-1,0],[0,10],[2,2],[Number.NaN,1],[1,1.5]]){
    assert.deepEqual(moveRankedItem(before,from,to),before);
  }
});
