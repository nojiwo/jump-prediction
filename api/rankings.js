import {db} from '../server/db.js';
import {handle,send,fail,requireUser,method} from '../server/http.js';
import {publishEligibleResults} from '../server/results.js';
export default async function(req,res){await handle(res,async()=>{
 method(req,'GET');await requireUser(req);const c=await db();
 await publishEligibleResults(c);
 const requested=new URL(req.url,'https://local.invalid').searchParams.get('issue');
 if(requested&&!/^\d{8}$/.test(requested))fail(400,'号番号が正しくありません。');
 const known=(await c.execute({sql:'SELECT code,release_at,results_published_at FROM issues WHERE results_published_at IS NOT NULL ORDER BY release_at DESC,code DESC'})).rows;
 const code=requested||known[0]?.code;
 if(!code)return send(res,200,{issue:null,availableIssues:[],ranking:[]});
 if(!known.some(x=>x.code===code))fail(404,'この号の結果はまだ公開されていません。');
 const ranking=(await c.execute({sql:'SELECT s.place,u.username,s.total_error FROM issue_scores s JOIN users u ON u.id=s.user_id WHERE s.issue_code=? ORDER BY s.place,s.total_error,u.id',args:[code]})).rows;
 send(res,200,{issue:code,availableIssues:known.map(x=>x.code),ranking});
})}
