import {decodeIssue,encodeIssue,issueNumbersOverlap} from './domain.ts';

/** Issue lists for tournament stages are user-selected, not inferred from issue master. */
export function addStageIssueCodes(existing:readonly string[], incoming:readonly string[]):string[]{
 const result=[...existing];
 for(const code of incoming){
  decodeIssue(code);
  if(result.includes(code))continue; // Adding an already selected issue is harmless.
  const overlapping=result.find(x=>issueNumbersOverlap(x,code));
  if(overlapping)throw new Error(`選択した号が重複しています（${overlapping}と${code}）。通常号と合併号を同時に指定できません。`);
  result.push(code);
 }
 return result.sort();
}

/** Batch selection expands regular issues, including across the year boundary.
 * A combined issue can be added individually; ranges intentionally never invent a combined issue.
 */
export function regularIssueRange(start:string,end:string):string[]{
 const a=decodeIssue(start),b=decodeIssue(end);
 if(a.combined||b.combined)throw new Error('範囲指定の開始号と終了号は通常号を選択してください。');
 if(start>end)throw new Error('範囲の終了号は開始号以降にしてください。');
 const length=(b.year-a.year)*55+b.first-a.first+1;
 if(length>220)throw new Error('一度に追加できる号は220件までです。');
 const result:string[]=[];
 for(let y=a.year;y<=b.year;y++){
  const from=y===a.year?a.first:1,to=y===b.year?b.first:55;
  for(let n=from;n<=to;n++)result.push(encodeIssue(y,n));
 }
 return result;
}

export function validateStageSelection(qualifier:readonly string[],final:readonly string[]):void{
 const all=addStageIssueCodes([],qualifier);
 addStageIssueCodes(all,final); // cross-stage overlap check
}
