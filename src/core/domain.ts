/** Pure business rules. No network and no database dependency. */
export type IssueCode = string;
export type WorkId = string;
export type InputMode = 'drag' | 'sequential';
export type StageKind = 'qualifier' | 'final';
export type Color = 'none' | 'lead' | 'center';

export interface WorkPeriod {
  workId: WorkId;
  startCode: IssueCode;
  endCode: IssueCode | null;
}
export interface OneShotIssue {
  workId: WorkId;
  issueCode: IssueCode;
}
export interface WorkOverride {
  workId: WorkId;
  inclusion: 'auto' | 'include' | 'exclude' | 'planned_hiatus';
  color: Color;
}
export interface PlacementError {
  workId: WorkId;
  predictedRank: number;
  actualRank: number;
  error: number;
}
export interface ScoringResult { total: number; perWork: PlacementError[] }

export function encodeIssue(year: number, first: number, last?: number): IssueCode {
  if (!Number.isInteger(year) || year < 2021 || year > 9999) throw new Error('invalid year');
  if (!Number.isInteger(first) || first < 1 || first > 55) throw new Error('invalid issue');
  if (last !== undefined && (last !== first + 1 || last > 55)) throw new Error('invalid combined issue');
  return `${year}${String(first).padStart(2,'0')}${String(last ?? 0).padStart(2,'0')}`;
}

export function decodeIssue(code: IssueCode): { year: number; first: number; last: number; combined: boolean } {
  if (!/^\d{8}$/.test(code)) throw new Error('invalid issue code');
  const year=Number(code.slice(0,4));
  const first=Number(code.slice(4,6));
  const rawLast=Number(code.slice(6,8));
  if (year<2021 || first<1 || first>55 || (rawLast!==0 && (rawLast!==first+1 || rawLast>55))) {
    throw new Error('invalid issue code');
  }
  return {year,first,last:rawLast||first,combined:rawLast!==0};
}

export function issueChoices(year: number): { code: IssueCode; label: string }[] {
  const result: {code: IssueCode; label: string}[]=[];
  for(let i=1;i<=55;i++) {
    result.push({code:encodeIssue(year,i),label:`${i}号`});
    if(i<55) result.push({code:encodeIssue(year,i,i+1),label:`${i}・${i+1}合併号`});
  }
  return result;
}

export function issueNumbersOverlap(a: IssueCode,b: IssueCode): boolean {
  const x=decodeIssue(a),y=decodeIssue(b);
  return x.year===y.year && x.first<=y.last && y.first<=x.last;
}

/** Candidates while issue is PLANNED. Overrides take priority over automatic selection. */
export function eligibleWorkIds(
  issueCode: IssueCode,
  periods: readonly WorkPeriod[],
  oneShots: readonly OneShotIssue[],
  overrides: readonly WorkOverride[],
): WorkId[] {
  decodeIssue(issueCode);
  const selected=new Set<WorkId>();
  for(const period of periods) {
    if(period.startCode<=issueCode && (!period.endCode || issueCode<=period.endCode)) selected.add(period.workId);
  }
  for(const shot of oneShots) {
    if(shot.issueCode===issueCode) selected.add(shot.workId);
  }
  for(const override of overrides) {
    if(override.inclusion==='include') selected.add(override.workId);
    else if(override.inclusion==='exclude'||override.inclusion==='planned_hiatus') selected.delete(override.workId);
  }
  return [...selected].sort(); // stable fallback; actual editor uses eight-issue averages
}

function unique(items: readonly string[],label: string): void {
  if(new Set(items).size!==items.length) throw new Error(`duplicate ${label}`);
}

/**
 * Scoring is performed ONLY over works frozen at the acceptance start,
 * excluding reported sudden hiatus. Unplanned actual works are ignored;
 * both orders are compacted before distance calculation.
 */
export function scorePrediction(
  predictedOrder: readonly WorkId[],
  actualOrder: readonly WorkId[],
  frozenWorkIds: readonly WorkId[],
  suddenHiatusIds: readonly WorkId[] = [],
): ScoringResult {
  unique(predictedOrder,'predicted work');
  unique(actualOrder,'actual work');
  unique(frozenWorkIds,'frozen work');
  unique(suddenHiatusIds,'sudden hiatus');
  const frozen=new Set(frozenWorkIds), hiatus=new Set(suddenHiatusIds);
  for(const w of hiatus) if(!frozen.has(w)) throw new Error(`sudden hiatus is not frozen: ${w}`);
  const target=new Set(frozenWorkIds.filter(w=>!hiatus.has(w)));
  const p=predictedOrder.filter(w=>target.has(w));
  const a=actualOrder.filter(w=>target.has(w));
  if(p.length!==target.size || a.length!==target.size) throw new Error('missing scored work');
  const actualRanks=new Map(a.map((workId,i)=>[workId,i+1]));
  const perWork=p.map((workId,i)=>{
    const actualRank=actualRanks.get(workId);
    if(actualRank===undefined) throw new Error(`missing actual work: ${workId}`);
    const predictedRank=i+1;
    return {workId,predictedRank,actualRank,error:Math.abs(predictedRank-actualRank)};
  });
  return {total:perWork.reduce((sum,w)=>sum+w.error,0),perWork};
}

/** Same points share a competition place, e.g. 1,2,2,4. userId breaks display ties. */
export function rankScores(entries: readonly { userId:string; score:number }[]):
    {userId:string;score:number;place:number}[] {
  const items=[...entries].sort((a,b)=>a.score-b.score||a.userId.localeCompare(b.userId));
  let prior:number|undefined,place=0;
  return items.map((e,i)=>{
    if(!Number.isSafeInteger(e.score)||e.score<0) throw new Error('invalid score');
    if(e.score!==prior) place=i+1;
    prior=e.score;
    return {...e,place};
  });
}

/** Determine whether a score may be displayed publicly. Never reset published flag. */
export function mayPublishScore(input:{confirmed:boolean; nextIssueReleaseAt:string|null; now:string}):boolean {
  return input.confirmed && !!input.nextIssueReleaseAt &&
    Date.parse(input.now)>=Date.parse(input.nextIssueReleaseAt);
}
