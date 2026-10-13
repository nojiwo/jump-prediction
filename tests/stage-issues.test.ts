import test from 'node:test';
import assert from 'node:assert/strict';
import {addStageIssueCodes,regularIssueRange,validateStageSelection} from '../src/core/stage-issues.ts';

test('複数号を追加して発行順に整列・重複追加しない',()=>{
 assert.deepEqual(addStageIssueCodes(['20264300'],['20264200','20264300','20264500']),['20264200','20264300','20264500']);
});
test('通常号と合併号の重複を禁止',()=>{
 assert.throws(()=>addStageIssueCodes(['20264200'],['20264243']),/重複/);
 assert.throws(()=>addStageIssueCodes(['20264243'],['20264300']),/重複/);
});
test('通常号の範囲指定は端点を含み年越しを許す',()=>{
 assert.deepEqual(regularIssueRange('20264200','20264400'),['20264200','20264300','20264400']);
 assert.deepEqual(regularIssueRange('20265500','20270100'),['20265500','20270100']);
});
test('逆順・合併号の範囲・過大範囲を禁止',()=>{
 assert.throws(()=>regularIssueRange('20264400','20264200'),/開始/);
 assert.throws(()=>regularIssueRange('20264243','20264400'),/通常号/);
 assert.throws(()=>regularIssueRange('20260100','20300100'),/220/);
});
test('予選と本戦間の号重複も検出',()=>{
 assert.doesNotThrow(()=>validateStageSelection(['20264200'],['20264344']));
 assert.throws(()=>validateStageSelection(['20264243'],['20264300']),/重複/);
});
