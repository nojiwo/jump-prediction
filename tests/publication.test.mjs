import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {isConsecutiveIssue,calculateScore,assignPlaces,publishEligibleResults} from '../server/results.js';

test('publication successor rules prevent issue gaps and handle combined issues',()=>{
 assert.equal(isConsecutiveIssue('20264000','20264100'),true);
 assert.equal(isConsecutiveIssue('20264041','20264200'),true);
 assert.equal(isConsecutiveIssue('20264000','20264200'),false);
 assert.equal(isConsecutiveIssue('20265500','20270100'),true);
 assert.equal(isConsecutiveIssue('20265455','20270100'),true);
 assert.equal(isConsecutiveIssue('20264000','20270100'),false);
 assert.equal(isConsecutiveIssue('20264041','20264300'),false);
});
test('scoring ignores surprise additions and removes sudden hiatus from both sequences',()=>{
 const x=calculateScore(['0004','0001','0003','0002'],['0002','0099','0001','0004'],['0001','0002','0003','0004'],['0003']);
 assert.equal(x.total,4);
 assert.deepEqual(x.perWork.map(y=>y.predictedRank),[1,2,3]);
 assert.throws(()=>calculateScore(['0001','0002'],['0001'],['0001','0002']),/missing/);
 assert.deepEqual(assignPlaces([{user_id:'u3',total_error:6},{user_id:'u2',total_error:4},{user_id:'u1',total_error:4}]).map(y=>y.place),[1,1,3]);
});
test('publication waits for next registered immediate issue and its date',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 db.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/003_final_selection.sql',import.meta.url),'utf8'));
 const stmt=db.prepare('INSERT INTO issues(code,release_at,cutoff_at,scores_confirmed_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
 const time='2026-01-01T00:00:00.000Z';
 stmt.run('20264000','2026-10-05T00:00:00.000Z','2026-10-01T00:00:00.000Z',time,'closed',time,time);
 stmt.run('20264200','2026-10-19T00:00:00.000Z','2026-10-15T00:00:00.000Z',null,'planned',time,time);
 const client={async execute({sql,args=[]}){const q=db.prepare(sql),upper=sql.toUpperCase();if(upper.startsWith('SELECT'))return {rows:q.all(...args)};return {...q.run(...args),rows:[]}}};
 assert.deepEqual(await publishEligibleResults(client,'2026-10-20T00:00:00.000Z'),[]);
 stmt.run('20264100','2026-10-12T00:00:00.000Z','2026-10-08T00:00:00.000Z',null,'planned',time,time);
 assert.deepEqual(await publishEligibleResults(client,'2026-10-11T00:00:00.000Z'),[]);
 assert.deepEqual(await publishEligibleResults(client,'2026-10-13T00:00:00.000Z'),['20264000']);
 assert.deepEqual(await publishEligibleResults(client,'2026-10-13T00:00:00.000Z'),[]);
 db.close();
});
