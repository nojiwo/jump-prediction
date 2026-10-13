import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeIssue,decodeIssue,issueChoices,issueNumbersOverlap,eligibleWorkIds,scorePrediction,rankScores,mayPublishScore} from '../src/core/domain.ts';

test('issue format and year choices support 55 normal + 54 combined',()=>{
  assert.equal(encodeIssue(2026,2,3),'20260203');
  assert.equal(decodeIssue('20260100').first,1);
  assert.equal(issueChoices(2026).length,109);
  assert.equal(issueChoices(2026)[1].label,'1・2合併号');
  assert.throws(()=>encodeIssue(2026,55,56));
  assert.ok(issueNumbersOverlap('20260203','20260200'));
  assert.ok(issueNumbersOverlap('20260203','20260300'));
  assert.equal(issueNumbersOverlap('20260203','20260400'),false);
});

test('works are automatically selected by serial periods and one-shot issue, overrides survive',()=>{
  const selected=eligibleWorkIds('20264000',[
    {workId:'0001',startCode:'20260100',endCode:null},
    {workId:'0002',startCode:'20264100',endCode:null},
    {workId:'0003',startCode:'20262000',endCode:'20264200'}
  ],[{workId:'0004',issueCode:'20264000'}],[
    {workId:'0003',inclusion:'planned_hiatus',color:'none'},
    {workId:'0005',inclusion:'include',color:'center'}
  ]);
  assert.deepEqual(selected,['0001','0004','0005']);
});

test('unexpected one-shot is filtered and remaining actual ranks are compacted',()=>{
  const result=scorePrediction(['0001','0002','0003'],['0001','0099','0002','0003'],['0001','0002','0003']);
  assert.equal(result.total,0);
  assert.deepEqual(result.perWork.map(x=>x.actualRank),[1,2,3]);
});

test('sudden hiatus removed from both orders and kept predictions unchanged',()=>{
  const predicted=['0001','0002','0003','0004'];
  const r=scorePrediction(predicted,['0002','0004','0001'],predicted,['0003']);
  assert.equal(r.total,4);
  assert.equal(predicted.length,4);
  assert.throws(()=>scorePrediction(predicted,['0002','0001'],predicted,['0003']));
});

test('ties get competition ranks and deterministic order',()=>{
  const r=rankScores([{userId:'u4',score:60},{userId:'u3',score:50},{userId:'u2',score:50},{userId:'u1',score:20}]);
  assert.deepEqual(r.map(x=>x.place),[1,2,2,4]);
  assert.deepEqual(r.map(x=>x.userId),['u1','u2','u3','u4']);
});

test('public timing needs confirmation and next issue release threshold',()=>{
  const release='2026-10-12T00:00:00+09:00';
  assert.equal(mayPublishScore({confirmed:true,nextIssueReleaseAt:null,now:'2026-10-12T01:00:00+09:00'}),false);
  assert.equal(mayPublishScore({confirmed:false,nextIssueReleaseAt:release,now:'2026-10-12T01:00:00+09:00'}),false);
  assert.equal(mayPublishScore({confirmed:true,nextIssueReleaseAt:release,now:'2026-10-11T23:59:59+09:00'}),false);
  assert.equal(mayPublishScore({confirmed:true,nextIssueReleaseAt:release,now:'2026-10-12T00:00:00+09:00'}),true);
});
