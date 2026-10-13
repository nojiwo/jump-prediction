import {db} from '../server/db.js';
import {handle,method,send,fail,requireUser} from '../server/http.js';
export default async function(req,res){await handle(res,async()=>{
 method(req,'GET');await requireUser(req);const code=new URL(req.url,'https://local.invalid').searchParams.get('issue')||'';
 if(!/^\d{8}$/.test(code))fail(400,'号番号が正しくありません。');
 const c=await db();const issue=(await c.execute({sql:'SELECT cutoff_at FROM issues WHERE code=?',args:[code]})).rows[0];
 if(!issue)fail(404,'号が見つかりません。');
 if(Date.parse(issue.cutoff_at)>Date.now())fail(403,'予想受付の締切後に公開されます。');
 const works=(await c.execute({sql:'SELECT f.work_id,w.title,f.color FROM issue_frozen_works f JOIN works w ON w.id=f.work_id WHERE f.issue_code=? ORDER BY f.initial_position',args:[code]})).rows;
 const predicts=(await c.execute({sql:'SELECT p.id,u.username,p.user_id,p.first_submitted_at FROM predictions p JOIN users u ON u.id=p.user_id WHERE p.issue_code=? ORDER BY p.first_submitted_at,p.user_id',args:[code]})).rows;
 const order=[];for(const p of predicts){const rows=(await c.execute({sql:'SELECT work_id FROM prediction_items WHERE prediction_id=? ORDER BY predicted_rank',args:[p.id]})).rows;order.push({username:p.username,userId:p.user_id,firstSubmittedAt:p.first_submitted_at,order:rows.map(x=>x.work_id)})}
 send(res,200,{issue:code,works,participants:order});
})}
