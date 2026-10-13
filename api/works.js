import {db} from '../server/db.js';
import {handle,method,body,send,fail,currentUser,requireUser,requireAdmin,checkOrigin,now} from '../server/http.js';
const validCode = s => /^\d{8}$/.test(s) && Number(s.slice(0,4))>=2021 &&
  +s.slice(4,6)>=1 && +s.slice(4,6)<=55 && (s.slice(6)==='00'||(+s.slice(6)===+s.slice(4,6)+1&&+s.slice(6)<=55));
export default async function(req,res){await handle(res,async()=>{
  const c=await db();const user=await requireUser(req);
  if(req.method==='GET'){
    const out=await c.execute('SELECT id,title,kind FROM works ORDER BY id');
    if(!['owner','admin'].includes(user.role))return send(res,200,{works:out.rows});
    const periods=(await c.execute('SELECT work_id,start_issue_code,end_issue_code FROM serialization_periods ORDER BY start_issue_code')).rows;
    const shots=(await c.execute('SELECT work_id,issue_code FROM oneshot_issues')).rows;
    return send(res,200,{works:out.rows.map(w=>({...w,periods:periods.filter(p=>p.work_id===w.id),oneShots:shots.filter(o=>o.work_id===w.id).map(o=>o.issue_code)}))});
  }
  method(req,'POST');checkOrigin(req);requireAdmin(user);const v=await body(req);
  const title=String(v.title||'').trim(),kind=v.kind;
  if(!title||title.length>140||!['serial','oneshot'].includes(kind))fail(400,'作品名または種別が不正です。');
  let periods=kind==='serial'?v.periods||[]:[],oneShots=kind==='oneshot'?v.oneShots||[]:[];
  if(!Array.isArray(periods)||!Array.isArray(oneShots)||periods.length>30||oneShots.length>60)fail(400,'掲載期間の形式が正しくありません。');
  if(kind==='serial'&&periods.length===0 || kind==='oneshot'&&oneShots.length===0)fail(400,'連載期間または掲載号を指定してください。');
  for(const p of periods){if(!validCode(p.start)||p.end&&!validCode(p.end)||p.end&&p.start>p.end)fail(400,'連載期間の号番号が正しくありません。')}
  for(const code of oneShots)if(!validCode(code))fail(400,'読み切り掲載号が正しくありません。');
  // Prevent overlapping serialization intervals within the same work.
  const sorted=[...periods].sort((a,b)=>a.start.localeCompare(b.start));
  for(let i=1;i<sorted.length;i++)if(!sorted[i-1].end||sorted[i-1].end>=sorted[i].start)fail(400,'同じ作品の連載期間が重複しています。');
  let id=String(v.id||'');if(id&&!/^\d{4}$/.test(id))fail(400,'作品IDは4桁で指定してください。');
  const existing=v.id && (await c.execute({sql:'SELECT id FROM works WHERE id=?',args:[id]})).rows.length>0;
  if(!id){const nums=(await c.execute('SELECT id FROM works ORDER BY id DESC LIMIT 1')).rows;id=String((nums.length?Number(nums[0].id):0)+1).padStart(4,'0')}
  const timestamp=now();const statements=[];
  if(existing){statements.push({sql:'UPDATE works SET title=?,kind=?,updated_at=? WHERE id=?',args:[title,kind,timestamp,id]});statements.push({sql:'DELETE FROM serialization_periods WHERE work_id=?',args:[id]});statements.push({sql:'DELETE FROM oneshot_issues WHERE work_id=?',args:[id]})}
  else statements.push({sql:'INSERT INTO works(id,title,kind,created_at,updated_at) VALUES(?,?,?,?,?)',args:[id,title,kind,timestamp,timestamp]});
  for(const p of periods)statements.push({sql:'INSERT INTO serialization_periods(work_id,start_issue_code,end_issue_code) VALUES(?,?,?)',args:[id,p.start,p.end||null]});
  for(const code of [...new Set(oneShots)])statements.push({sql:'INSERT INTO oneshot_issues(work_id,issue_code) VALUES(?,?)',args:[id,code]});
  try{await c.batch(statements,'write')}catch(e){if(String(e.message).includes('UNIQUE'))fail(409,'作品IDが重複しています。');throw e}
  send(res,200,{ok:true,id});
})}
