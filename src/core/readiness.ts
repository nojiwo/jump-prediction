import type {Color,IssueCode,WorkId} from './domain.ts';

/** The server must re-evaluate this immediately before its transactional OPEN action. */
export interface AcceptanceReadiness {
  issueCode:IssueCode;
  releaseAt:string;
  cutoffAt:string;
  now:string;
  reviewedAt:string|null; // explicit admin confirmation of plan, including "no planned hiatus"
  plannedWorks:readonly {workId:WorkId;color:Color}[];
  conflictingWorkReferences:readonly string[]; // unregistered normal/combined edition mismatches
  anotherIssueOpen:boolean;
}
export function checkAcceptanceReadiness(input:AcceptanceReadiness): {ready:boolean;errors:string[]} {
  const errors:string[]=[];
  if(!/^\d{8}$/.test(input.issueCode)) errors.push('号コードが不正です');
  const release=Date.parse(input.releaseAt),cutoff=Date.parse(input.cutoffAt),now=Date.parse(input.now);
  if(!Number.isFinite(release)) errors.push('発売日が未登録です');
  if(!Number.isFinite(cutoff)) errors.push('締め切りが未登録です');
  if(!Number.isFinite(now)) errors.push('現在時刻が不正です');
  if(Number.isFinite(release)&&Number.isFinite(cutoff)&&cutoff>=release) errors.push('締め切りは発売日より前にしてください');
  if(Number.isFinite(cutoff)&&Number.isFinite(now)&&cutoff<=now) errors.push('締め切りを過ぎているため開始できません');
  if(!input.reviewedAt) errors.push('カラー・休載を含む掲載予定情報が未確認です');
  if(!input.plannedWorks.length) errors.push('予想対象作品がありません');
  const ids=input.plannedWorks.map(x=>x.workId);
  if(new Set(ids).size!==ids.length) errors.push('予想対象作品が重複しています');
  const leads=input.plannedWorks.filter(x=>x.color==='lead');
  if(leads.length!==1) errors.push('巻頭カラーを1作品指定してください');
  if(input.conflictingWorkReferences.length) errors.push(`作品の号指定に矛盾があります：${input.conflictingWorkReferences.join('、')}`);
  if(input.anotherIssueOpen) errors.push('別の号で予想受付中です');
  return {ready:errors.length===0,errors};
}
