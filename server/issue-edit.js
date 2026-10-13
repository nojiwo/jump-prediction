/** Magazine metadata and deadline modifications. All comparisons use UTC instants.
 * Tokyo does not observe daylight saving time (UTC+09:00).
 */
import {fail} from './http.js';
const TOKYO=9*60*60*1000;
export function parseInstant(value,label){
  if(typeof value!=='string'|| !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value))fail(400,`${label}はタイムゾーンを付けて指定してください。`);
  const t=Date.parse(value);
  if(!Number.isFinite(t))fail(400,`${label}の日時が正しくありません。`);
  return new Date(t).toISOString();
}
/** Original cutoff week: Monday 00:00 JST through Sunday 23:59:59 JST. */
export function originalWeekLastInstant(cutoff){
  const shifted=new Date(Date.parse(cutoff)+TOKYO);
  const mondayBased=(shifted.getUTCDay()+6)%7;
  const utcMs=Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate()+6-mondayBased,23,59,59)-TOKYO;
  return new Date(utcMs).toISOString();
}
export function planIssueChange(current,input,at=Date.now()){
  const release=input.release_at===undefined?String(current.release_at):parseInstant(input.release_at,'発売日時');
  const cutoff=input.cutoff_at===undefined?String(current.cutoff_at):parseInstant(input.cutoff_at,'締切日時');
  const releaseChanged=release!==current.release_at,cutoffChanged=cutoff!==current.cutoff_at;
  if(Date.parse(cutoff)>=Date.parse(release))fail(400,'締切は発売日時より前に指定してください。');
  if(!releaseChanged&&!cutoffChanged)fail(400,'変更する項目がありません。');
  if(current.status==='closed'){
    if(cutoffChanged)fail(409,'受付終了後に締切を変更することはできません。');
    return {release,cutoff,planReviewedAt:current.plan_reviewed_at,manuallyEdited:Number(current.cutoff_manually_edited)||0};
  }
  if(current.status==='open'){
    if(cutoffChanged){
      if(at>=Date.parse(current.cutoff_at))fail(409,'締切後に受付を再開・延長することはできません。');
      if(Date.parse(cutoff)<=Date.parse(current.cutoff_at))fail(409,'受付開始後の締切変更は延長のみ可能です。');
      if(at>Date.parse(originalWeekLastInstant(current.cutoff_at))||Date.parse(cutoff)>Date.parse(originalWeekLastInstant(current.cutoff_at)))fail(409,'締切は元の締切週の日曜日23:59:59まで延長できます。');
    }
    return {release,cutoff,planReviewedAt:current.plan_reviewed_at,manuallyEdited:cutoffChanged?1:Number(current.cutoff_manually_edited)||0};
  }
  if(current.status!=='planned')fail(409,'不明な受付状態です。');
  if(Date.parse(cutoff)<=at)fail(409,'準備中の号は未来の締切日時を設定してください。');
  return {release,cutoff,planReviewedAt:null,manuallyEdited:cutoffChanged?1:Number(current.cutoff_manually_edited)||0};
}
