import {db} from '../server/db.js';
import {handle,method,send,fail,requireUser} from '../server/http.js';
export default async function(req,res){await handle(res,async()=>{
 method(req,'GET');const u=await requireUser(req);const c=await db();
 const q=new URL(req.url,'https://example.invalid').searchParams;const year=q.get('year'),offset=Number(q.get('offset')||0);
 if(!Number.isSafeInteger(offset)||offset<0||offset>100000||year&&!/^\d{4}$/.test(year))fail(400,'検索条件が正しくありません。');
 const filter=year?'AND substr(i.code,1,4)=?':'';const args=year?[u.id,year,20,offset]:[u.id,20,offset];
 const list=(await c.execute({sql:`SELECT i.code,s.total_error,s.place,i.results_published_at FROM issue_scores s JOIN issues i ON i.code=s.issue_code WHERE s.user_id=? AND i.results_published_at IS NOT NULL ${filter} ORDER BY i.code DESC LIMIT ? OFFSET ?`,args})).rows;
 send(res,200,{history:list,nextOffset:list.length===20?offset+20:null});
})}
