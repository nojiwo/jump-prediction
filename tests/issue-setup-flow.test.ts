import test from 'node:test';
import assert from 'node:assert/strict';
import {persistIssueSetup, type IssueSetupForm} from '../src/core/issue-setup-flow.ts';

const setup:IssueSetupForm={code:'20264300',lead:'0001',centers:['0003'],hiatus:['0002'],confirmed:true,conflictCount:0};

test('opening intake first saves the exact visible color/hiatus settings',async()=>{
 const calls:{path:string;method:string;payload:any}[]=[];
 await persistIssueSetup(async(path,method,payload)=>{calls.push({path,method,payload})},setup,true);
 assert.equal(calls.length,2);
 assert.deepEqual(calls.map(x=>x.payload.action),['save','open']);
 assert.deepEqual(calls[0].payload.colors,[{workId:'0001',color:'lead'},{workId:'0003',color:'center'}]);
 assert.deepEqual(calls[0].payload.plannedHiatus,['0002']);
 assert.equal(calls[0].payload.confirmed,true);
 assert.equal(calls[1].payload.code,'20264300');
});

test('a failed save never opens prediction intake',async()=>{
 let count=0;
 await assert.rejects(persistIssueSetup(async()=>{count++;throw new Error('save rejected')},setup,true),/save rejected/);
 assert.equal(count,1);
});

test('saving settings alone does not open intake',async()=>{
 const actions:string[]=[];
 await persistIssueSetup(async(_path,_method,payload:any)=>{actions.push(payload.action)},setup,false);
 assert.deepEqual(actions,['save']);
});

test('unconfirmed, conflicting or contradictory forms cannot start intake',async()=>{
 for(const incorrect of [{...setup,confirmed:false},{...setup,conflictCount:1},{...setup,hiatus:['0001']}]){
  let invoked=false;
  await assert.rejects(persistIssueSetup(async()=>{invoked=true},incorrect,true));
  assert.equal(invoked,false);
 }
});
