/** Ranking, score and publication rules shared by Vercel functions. */
import { now } from './http.js';

export const issueParts = (code) => {
  if (typeof code !== 'string' || !/^\d{8}$/.test(code)) throw new Error('invalid issue code');
  const y=Number(code.slice(0,4)), first=Number(code.slice(4,6)), end=Number(code.slice(6,8)) || first;
  if(y<2021 || first<1 || first>55 || end>55 || end<first || end>first+1) throw new Error('invalid issue code');
  return {year:y,first,end};
};

/** Be conservative: do not skip over a missing immediate successor issue. */
export function isConsecutiveIssue(prior, next) {
  const p=issueParts(prior), n=issueParts(next);
  if (p.year===n.year) return n.first===p.end+1;
  // Year rollover is only plausible near the end of the numbered publication year.
  // This avoids publishing issue 40 based only on next year's issue 1 while 41 is missing.
  return n.year===p.year+1 && n.first===1 && p.end>=50;
}

export function calculateScore(predicted, actual, frozen, sudden=[]) {
  for (const [key,list] of Object.entries({predicted,actual,frozen,sudden})) {
    if(!Array.isArray(list)||list.some(x=>typeof x!=='string')||new Set(list).size!==list.length)throw new Error(`invalid or duplicate ${key}`);
  }
  const frozenSet=new Set(frozen);
  if(sudden.some(w=>!frozenSet.has(w)))throw new Error('hiatus must be a frozen work');
  const count=new Set(frozen.filter(x=>!sudden.includes(x)));
  const p=predicted.filter(x=>count.has(x));
  const a=actual.filter(x=>count.has(x));
  if(p.length!==count.size||a.length!==count.size)throw new Error('missing scored work');
  const rank=new Map(a.map((id,i)=>[id,i+1]));
  const perWork=p.map((id,i)=>({workId:id,predictedRank:i+1,actualRank:rank.get(id),error:Math.abs(i+1-rank.get(id))}));
  return {total:perWork.reduce((t,x)=>t+x.error,0),perWork};
}
export function assignPlaces(scores){
 const sorted=[...scores].sort((a,b)=>a.total_error-b.total_error||String(a.user_id).localeCompare(String(b.user_id)));
 let last=-1,place=0;
 return sorted.map((x,i)=>{if(x.total_error!==last)place=i+1;last=x.total_error;return {...x,place}});
}

/** Compute confirmed scores against the complete *actual* order (including surprise manga). */
export async function computeIssueScores(client,code,actual,sudden){
 const frozen=(await client.execute({sql:'SELECT work_id FROM issue_frozen_works WHERE issue_code=? ORDER BY initial_position',args:[code]})).rows.map(x=>x.work_id);
 if(!frozen.length)throw new Error('issue has no frozen works');
 // Require a full actual list of all score-eligible works, while ignoring surprise additions.
 calculateScore(frozen,actual,frozen,sudden);
 const submitted=(await client.execute({sql:'SELECT p.id,p.user_id,u.username FROM predictions p JOIN users u ON u.id=p.user_id WHERE p.issue_code=? ORDER BY p.user_id',args:[code]})).rows;
 const totals=[];
 for(const p of submitted){
   const guess=(await client.execute({sql:'SELECT work_id FROM prediction_items WHERE prediction_id=? ORDER BY predicted_rank',args:[p.id]})).rows.map(x=>x.work_id);
   const result=calculateScore(guess,actual,frozen,sudden);
   totals.push({user_id:p.user_id,username:p.username,total_error:result.total});
 }
 return assignPlaces(totals);
}

/** Mark public results as soon as the directly following registered issue's release time passes.
 * This function is safe to call on score confirmation, later issue registration, cron and GET.
 * Once marked, never unpublish, including when release dates are subsequently edited.
 */
export async function publishEligibleResults(client,at=now()){
  const issues=(await client.execute({sql:'SELECT code,release_at,scores_confirmed_at,results_published_at FROM issues ORDER BY code',args:[]})).rows;
  const published=[];
  for (let i=0;i<issues.length-1;i++) {
    const a=issues[i],b=issues[i+1];
    if(a.results_published_at||!a.scores_confirmed_at||!isConsecutiveIssue(a.code,b.code)||Date.parse(b.release_at)>Date.parse(at))continue;
    const result=await client.execute({sql:'UPDATE issues SET results_published_at=?,updated_at=? WHERE code=? AND scores_confirmed_at IS NOT NULL AND results_published_at IS NULL',args:[at,at,a.code]});
    if(Number(result.rowsAffected??result.changes??0)>0)published.push(a.code);
  }
  return published;
}
