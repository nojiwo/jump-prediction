/** Keep issue references valid when an administrator changes the work kind. */
export type WorkKind = 'serial' | 'oneshot';
export type SerialPeriod = {start_issue_code:string;end_issue_code:string|null};
export function changeWorkKind<T extends {
 kind:WorkKind;
 periods?:SerialPeriod[];
 oneShots?:string[];
}>(work:T, nextKind:WorkKind, fallbackIssue='20264300'):T {
 if(work.kind===nextKind)return work;
 if(nextKind==='oneshot'){
  const issue=work.oneShots?.[0] || work.periods?.[0]?.start_issue_code || fallbackIssue;
  return {...work,kind:'oneshot',oneShots:[issue]};
 }
 const start=work.periods?.[0]?.start_issue_code || work.oneShots?.[0] || fallbackIssue;
 return {...work,kind:'serial',periods:work.periods?.length?work.periods:[{start_issue_code:start,end_issue_code:null}]};
}
