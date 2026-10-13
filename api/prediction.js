import {randomUUID} from 'node:crypto';
import {db} from '../server/db.js';
import {handle,method,body,send,fail,requireUser,checkOrigin,now} from '../server/http.js';
export default async function(req,res){await handle(res,async()=>{
  const user=await requireUser(req),c=await db();
  if(req.method==='GET'){
    const issueCode=String(new URL(req.url,'https://local.invalid').searchParams.get('issue')||'');
    const issue=(await c.execute({sql:'SELECT code,status,cutoff_at FROM issues WHERE code=?',args:[issueCode]})).rows[0];
    if(!issue)fail(404,'対象号が見つかりません。');
    const frozen=(await c.execute({sql:'SELECT work_id,initial_position,color FROM issue_frozen_works WHERE issue_code=? ORDER BY initial_position',args:[issueCode]})).rows;
    const pred=(await c.execute({sql:'SELECT id,first_submitted_at FROM predictions WHERE issue_code=? AND user_id=?',args:[issueCode,user.id]})).rows[0];
    const formal=pred?(await c.execute({sql:'SELECT work_id FROM prediction_items WHERE prediction_id=? ORDER BY predicted_rank',args:[pred.id]})).rows.map(r=>r.work_id):null;
    const draft=(await c.execute({sql:'SELECT work_id FROM prediction_draft_items WHERE issue_code=? AND user_id=? ORDER BY selected_rank',args:[issueCode,user.id]})).rows.map(r=>r.work_id);
    const draftMeta=(await c.execute({sql:'SELECT input_mode FROM prediction_drafts WHERE issue_code=? AND user_id=?',args:[issueCode,user.id]})).rows[0];
    return send(res,200,{issue,frozen,formal,draft,draft_input_mode:draftMeta?.input_mode||null,first_submitted_at:pred?.first_submitted_at||null});
  }
  method(req,'POST');checkOrigin(req);const input=await body(req);
  const issue=String(input.issue||''),mode=String(input.mode||''),order=input.order;
  if(!['draft','submit'].includes(mode)||!/^\d{8}$/.test(issue)||!Array.isArray(order)||order.length>80||order.some(x=>typeof x!=='string'||!/^\d{4}$/.test(x))||new Set(order).size!==order.length)fail(400,'予想の形式が正しくありません。');
  const frozen=(await c.execute({sql:'SELECT work_id FROM issue_frozen_works WHERE issue_code=?',args:[issue]})).rows.map(r=>r.work_id);
  const target=new Set(frozen);
  if(!frozen.length||order.some(x=>!target.has(x))||(mode==='submit' && (order.length!==frozen.length||!frozen.every(x=>order.includes(x)))))fail(400,'予想対象の作品が一致しません。');
  const stamp=now();
  const status=(await c.execute({sql:'SELECT status,cutoff_at FROM issues WHERE code=?',args:[issue]})).rows[0];
  if(status?.status!=='open'||Date.parse(String(status.cutoff_at))<=Date.now())fail(403,'この号の予想受付は終了しています。');
  const tx=await c.transaction('write');
  try{
    const recheck=(await tx.execute({sql:'SELECT status,cutoff_at FROM issues WHERE code=?',args:[issue]})).rows[0];
    if(recheck.status!=='open'||Date.parse(String(recheck.cutoff_at))<=Date.now())fail(403,'締切を過ぎました。');
    if(mode==='draft'){
      await tx.execute({sql:`INSERT INTO prediction_drafts(issue_code,user_id,input_mode,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(issue_code,user_id) DO UPDATE SET input_mode=excluded.input_mode,updated_at=excluded.updated_at`,args:[issue,user.id,input.inputMode==='sequential'?'sequential':'drag',stamp]});
      await tx.execute({sql:'DELETE FROM prediction_draft_items WHERE issue_code=? AND user_id=?',args:[issue,user.id]});
      for(let i=0;i<order.length;i++)await tx.execute({sql:'INSERT INTO prediction_draft_items(issue_code,user_id,work_id,selected_rank) VALUES(?,?,?,?)',args:[issue,user.id,order[i],i+1]});
    }else{
      const old=(await tx.execute({sql:'SELECT id FROM predictions WHERE issue_code=? AND user_id=?',args:[issue,user.id]})).rows[0];
      let predId=old?.id||randomUUID();
      if(old)await tx.execute({sql:'UPDATE predictions SET last_submitted_at=?,last_submitted_by=? WHERE id=?',args:[stamp,user.id,predId]});
      else await tx.execute({sql:'INSERT INTO predictions(id,issue_code,user_id,first_submitted_at,last_submitted_at,last_submitted_by) VALUES(?,?,?,?,?,?)',args:[predId,issue,user.id,stamp,stamp,user.id]});
      await tx.execute({sql:'DELETE FROM prediction_items WHERE prediction_id=?',args:[predId]});
      for(let i=0;i<order.length;i++)await tx.execute({sql:'INSERT INTO prediction_items(prediction_id,work_id,predicted_rank) VALUES(?,?,?)',args:[predId,order[i],i+1]});
    }
    await tx.commit();
  }catch(e){await tx.rollback();throw e}
  send(res,200,{ok:true,mode});
})}
