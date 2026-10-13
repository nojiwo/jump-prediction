import test from 'node:test';
import assert from 'node:assert/strict';
import {chunk,pagedReport,renderPdfHtml,type ReportData} from '../src/core/pdf.ts';
const opts={size:'A4' as const};
test('issue report prints all 74 entrants in sheets of three 10-row tables, never truncating after 30',()=>{
 const rankings=Array.from({length:74},(_,i)=>({user_id:`u${i}`,username:`利用者${i+1}`,place:i+1,total_error:i+2}));
 const data:ReportData={type:'issue',issue:'20264200',rankings};
 const result=pagedReport(data,opts);
 assert.equal(result.pages.length,3);
 assert.equal((result.pages[0].match(/<table>/g)||[]).length,3);
 assert.equal((result.pages[1].match(/<table>/g)||[]).length,3);
 assert.ok(!result.pages[0].includes('利用者31</td>'));
 assert.match(result.pages[1],/利用者31<\/td>/);
 assert.match(result.pages.at(-1)!,/利用者74<\/td>/);
 const html=renderPdfHtml(data,opts);
 assert.match(html,/3 \/ 3 ページ/);
 assert.equal((html.match(/class="page"/g)||[]).length,3);
});
test('works report repeats headings, rank-error cells and full issue totals when users exceed the column limit',()=>{
 const users=Array.from({length:21},(_,i)=>({user_id:`u${i}`,username:`参加者${i+1}`,place:i+1,total_error:i*4,errors:{'0001':i,'0002':0}}));
 const data:ReportData={type:'works',issue:'20264200',scopeLabel:'予選参加者',works:[{id:'0001',title:'作品A',actualRank:1},{id:'0002',title:'作品B',actualRank:2}],users};
 const out=pagedReport(data,{...opts,worksColumns:8});
 assert.equal(out.pages.length,3);
 assert.ok(out.pages[0].includes('合計（全作品）'));
 assert.ok(out.pages[2].includes('参加者21'));
 assert.ok(!out.pages[0].includes('参加者21'));
 assert.match(renderPdfHtml(data,opts),/予選参加者/);
});
test('large works sheets paginate BOTH works rows and user columns, without changing totals',()=>{
 const data:ReportData={type:'works',issue:'20264200',works:Array.from({length:51},(_,i)=>({id:String(i+1).padStart(4,'0'),title:`作品${i}`,actualRank:i+1})),users:Array.from({length:11},(_,i)=>({user_id:`u${i}`,username:`name${i}`,place:i+1,total_error:i,errors:{}}))};
 const out=pagedReport(data,{...opts,worksColumns:8,worksRows:24});
 assert.equal(out.pages.length,6);
 assert.ok(out.pages[5].includes('作品50'));
});
test('tournament report repeats headings by user page and issue group; DQ shown distinctly',()=>{
 const codes=Array.from({length:9},(_,i)=>`2026${String(i+30).padStart(2,'0')}00`);
 const rows=Array.from({length:32},(_,i)=>({user_id:`u${i}`,username:`エントリー${i+1}`,place:i+1,total:i*10,disqualified:i===30,cells:Object.fromEntries(codes.map(c=>[c,i]))}));
 const data:ReportData={type:'tournament',title:'第4回大会・予選',codes,rows,asOf:codes.at(-1)!};
 const out=pagedReport(data,{...opts,tournamentColumns:6,tournamentRows:22});
 assert.equal(out.pages.length,4);
 assert.ok(out.pages.some(x=>x.includes('失格')));
 assert.match(renderPdfHtml(data,opts),/2026年38号/);
});
test('export document escapes untrusted usernames, titles and scope labels',()=>{
 const data:ReportData={type:'issue',issue:'20264200',scopeLabel:'<img src=x onerror=alert(1)>',rankings:[{user_id:'x',username:'<script>alert(1)</script>',place:1,total_error:12}]};
 const html=renderPdfHtml(data,opts);
 assert.ok(!html.includes('<script>'));
 assert.ok(!html.includes('<img src=x'));
 assert.match(html,/&lt;script&gt;/);
 assert.throws(()=>chunk([1,2],0));
});
test('DQ tournament PDF retains prior earned points, marks missed issue and blanks only later issues',()=>{
 const codes=['20264000','20264100','20264200'];
 const data:ReportData={type:'tournament',title:'DQテスト',codes,asOf:codes[2],rows:[
  {user_id:'u1',username:'失格者',place:null,total:8,disqualified:true,
   cells:{'20264000':8,'20264100':null,'20264200':null},unsubmittedIssues:['20264100']}
 ]};
 const page=pagedReport(data,{size:'A4',tournamentColumns:3}).pages[0];
 assert.match(page,/<td>失格<\/td><td>失格者<\/td><td>8<\/td><td>未提出<\/td><td>—<\/td><td>8<\/td>/);
});
