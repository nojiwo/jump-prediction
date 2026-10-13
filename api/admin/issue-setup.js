import {closeExpiredIssues} from '../../server/lifecycle.js';
import {db} from '../../server/db.js';
import {handle,method,body,send,fail,requireUser,requireAdmin,checkOrigin,now} from '../../server/http.js';
const n=s=>Number(s.slice(4,6)), max=s=>Number(s.slice(6,8))||n(s);
function conflicts(code,rows){return rows.filter(x=>{
   for(const ref of [x.start_issue_code,x.end_issue_code,x.issue_code].filter(Boolean)){
     if(ref===code||ref.slice(0,4)!==code.slice(0,4))continue;
     if(n(ref)<=max(code)&&n(code)<=max(ref))return true;
   }
   return false;
})}
async function candidate(client,code){
 const workRows=(await client.execute('SELECT id,title FROM works ORDER BY id')).rows;
 const periods=(await client.execute('SELECT work_id,start_issue_code,end_issue_code FROM serialization_periods')).rows;
 const shots=(await client.execute('SELECT work_id,issue_code FROM oneshot_issues')).rows;
 const overrides=(await client.execute({sql:'SELECT work_id,inclusion,color FROM issue_work_overrides WHERE issue_code=?',args:[code]})).rows;
 const colors=new Map(overrides.map(x=>[x.work_id,x]));
 const selected=workRows.filter(w=>{
   const auto=periods.some(p=>p.work_id===w.id&&p.start_issue_code<=code&&(!p.end_issue_code||p.end_issue_code>=code))||shots.some(p=>p.work_id===w.id&&p.issue_code===code);
   const over=colors.get(w.id)?.inclusion;
   // A work on planned hiatus stays visible in the admin editor so the
   // administrator can undo or revise its hiatus setting. It is excluded
   // only when freezing the actual prediction-eligible snapshot.
   return over==='include'||over==='planned_hiatus'||(auto&&over!=='exclude');
 }).map(w=>({...w,color:colors.get(w.id)?.color||'none',inclusion:colors.get(w.id)?.inclusion||'auto'}));
 return {selected,overrides,invalid:conflicts(code,[...periods,...shots])};
}
export default async function(req,res){await handle(res,async()=>{
 const user=await requireUser(req);requireAdmin(user);const client=await db();
 await closeExpiredIssues(client);
 const input=req.method==='GET'?{code:new URL(req.url,'https://local.invalid').searchParams.get('code')}:await body(req);
 const code=String(input.code||'');if(!/^\d{8}$/.test(code))fail(400,'号番号が必要です。');
 const issue=(await client.execute({sql:'SELECT * FROM issues WHERE code=?',args:[code]})).rows[0];
 if(!issue)fail(404,'ジャンプ号が見つかりません。');
 if(req.method==='GET'){const data=await candidate(client,code);return send(res,200,{issue,...data,conflictCount:data.invalid.length})}
 method(req,'POST');checkOrigin(req);
 if(input.action==='save'){
   if(issue.status!=='planned')fail(403,'受付開始後は予定設定を変更できません。');
   const colors=Array.isArray(input.colors)?input.colors:[];
   const plannedHiatus=Array.isArray(input.plannedHiatus)?input.plannedHiatus:[];
   if(colors.length>60||plannedHiatus.length>60)fail(400,'入力件数が多すぎます。');
   const lead=colors.filter(x=>x.color==='lead');
   if(lead.length!==1||colors.some(x=>!/^\d{4}$/.test(x.workId)||!['lead','center'].includes(x.color)))fail(400,'巻頭カラーを1作品、センターカラーを必要に応じて設定してください。');
   const available=(await candidate(client,code)).selected.map(x=>x.id);
   if([...colors.map(x=>x.workId),...plannedHiatus].some(id=>!available.includes(id)))fail(400,'カラー・休載対象に予想対象外作品が含まれています。');
   if(new Set(colors.map(x=>x.workId)).size!==colors.length || new Set(plannedHiatus).size!==plannedHiatus.length)fail(400,'作品を重複して指定できません。');
   if(colors.some(x=>plannedHiatus.includes(x.workId)))fail(400,'予定休載の作品はカラーに指定できません。');
   const ids=new Set([...colors.map(x=>x.workId),...plannedHiatus]);
   const tx=await client.transaction('write');
   try{
      await tx.execute({sql:'DELETE FROM issue_work_overrides WHERE issue_code=?',args:[code]});
      for(const id of ids){const color=colors.find(x=>x.workId===id)?.color||'none';await tx.execute({sql:'INSERT INTO issue_work_overrides(issue_code,work_id,inclusion,color) VALUES(?,?,?,?)',args:[code,id,plannedHiatus.includes(id)?'planned_hiatus':'auto',color]})}
      await tx.execute({sql:'UPDATE issues SET plan_reviewed_at=?,updated_at=? WHERE code=?',args:[input.confirmed===true?now():null,now(),code]});
      await tx.commit();
   }catch(e){await tx.rollback();throw e}
   return send(res,200,{ok:true,reviewed:input.confirmed===true});
 }
 if(input.action==='open'){
   if(issue.status!=='planned')fail(409,'準備中の号だけ受付開始できます。');
   if(!issue.plan_reviewed_at||Date.parse(String(issue.cutoff_at))<=Date.now()||!issue.release_at)fail(409,'必要情報の確認、締切または発売日を確認してください。');
   const {selected,invalid}=await candidate(client,code);
   const available=selected.filter(w=>w.inclusion!=='planned_hiatus');
   if(!available.length||invalid.length)fail(409,'予想対象作品がないか、連載情報と合併号に矛盾があります。');
   if(available.filter(w=>w.color==='lead').length!==1)fail(409,'巻頭カラーは予想対象から1作品指定してください。');
   const previous=(await client.execute({sql:'SELECT code FROM issues WHERE code<? ORDER BY release_at DESC LIMIT 8',args:[code]})).rows.map(x=>x.code);
   const historical=previous.length?(await client.execute({sql:`SELECT issue_code,work_id,actual_rank FROM actual_order_items WHERE issue_code IN (${previous.map(()=>'?').join(',')})`,args:previous})).rows:[];
   function mean(id){const seen=historical.filter(x=>x.work_id===id);return seen.length?seen.reduce((a,b)=>a+Number(b.actual_rank),0)/seen.length:Number.POSITIVE_INFINITY}
   const priority=c=>c==='lead'?0:c==='center'?1:2;
   available.sort((a,b)=>priority(a.color)-priority(b.color)||mean(a.id)-mean(b.id)||a.id.localeCompare(b.id));
   const tx=await client.transaction('write');
   try{
     const check=await tx.execute("SELECT code FROM issues WHERE status='open'");
     if(check.rows.length)fail(409,'受付中のジャンプ号があります。');
     const flag=await tx.execute({sql:"SELECT status,plan_reviewed_at FROM issues WHERE code=?",args:[code]});
     if(flag.rows[0]?.status!=='planned'||!flag.rows[0]?.plan_reviewed_at)fail(409,'受付開始条件が変わりました。');
     for(let i=0;i<available.length;i++)await tx.execute({sql:'INSERT INTO issue_frozen_works(issue_code,work_id,initial_position,color) VALUES(?,?,?,?)',args:[code,available[i].id,i+1,available[i].color]});
     await tx.execute({sql:"UPDATE issues SET status='open',opened_at=?,updated_at=? WHERE code=?",args:[now(),now(),code]});
     await tx.commit();
   }catch(e){await tx.rollback();throw e}
   return send(res,200,{ok:true,open:true,count:available.length});
 }
 fail(400,'不明な操作です。');
})}
