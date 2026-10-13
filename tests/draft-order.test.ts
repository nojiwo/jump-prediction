import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreDraftOrder, selectedDraftPrefix} from '../src/core/draft-order.ts';

test('loading a partial prediction draft restores unselected eligible works', () => {
 const frozen=['0001','0002','0003','0004'];
 const prefix=['0003','0001'];
 assert.deepEqual(restoreDraftOrder(frozen,prefix),['0003','0001','0002','0004']);
 assert.deepEqual(selectedDraftPrefix(restoreDraftOrder(frozen,prefix),2),prefix);
});
test('empty draft restores default frozen order and rejects duplicates', () => {
 assert.deepEqual(restoreDraftOrder(['0001','0002'],[]),['0001','0002']);
 assert.deepEqual(restoreDraftOrder(['0001','0002','0001'],['0002','0002']),['0002','0001']);
});
test('actual order keeps surprising additional works, but filters sudden hiatus', () => {
 assert.deepEqual(restoreDraftOrder(['0001','0002','0003'],['0099','0003'],['0002']),['0099','0003','0001']);
});
test('sequential draft prefix preserves actual selection count', () => {
 assert.deepEqual(selectedDraftPrefix(['a','b','c'],0),[]);
 assert.deepEqual(selectedDraftPrefix(['a','b','c'],2),['a','b']);
 assert.throws(()=>selectedDraftPrefix(['a'],2));
 assert.throws(()=>selectedDraftPrefix(['a'],-1));
});
