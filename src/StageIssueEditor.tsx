import {useState} from 'react';
import {decodeIssue,encodeIssue,issueChoices} from './core/domain';
import {addStageIssueCodes,regularIssueRange} from './core/stage-issues';

const fmtIssue=(code:string)=>{const o=decodeIssue(code);return `${o.year}年${o.first}${o.combined?'・'+o.last+'合併':''}号`};
const years=()=>Array.from({length:Math.max(7,new Date().getFullYear()+4-2021)},(_,i)=>2021+i);
function IssueSelect({value,onChange,regularOnly=false,label}:{value:string;onChange:(v:string)=>void;regularOnly?:boolean;label:string}){
 const p=decodeIssue(value);
 return <div className="stage-issue-select" role="group" aria-label={label}>
  <select aria-label={`${label}・年`} value={p.year} onChange={e=>onChange(encodeIssue(Number(e.target.value),p.first,p.combined?p.last:undefined))}>
   {years().map(year=><option key={year} value={year}>{year}年</option>)}
  </select>
  <select aria-label={`${label}・号`} value={value.slice(4)} onChange={e=>onChange(`${p.year}${e.target.value}`)}>
   {issueChoices(p.year).filter(x=>!regularOnly||!decodeIssue(x.code).combined).map(c=><option key={c.code} value={c.code.slice(4)}>{c.label}</option>)}
  </select>
 </div>;
}
/** Controlled editor. All changes stay local until the enclosing tournament form is saved. */
export function StageIssueEditor({label,value,onChange,disabled=false}:{label:string;value:string[];onChange:(v:string[])=>void;disabled?:boolean}){
 const [single,setSingle]=useState('20264200');
 const [first,setFirst]=useState('20264200');
 const [last,setLast]=useState('20264500');
 const [error,setError]=useState('');
 const add=(incoming:string[])=>{try{onChange(addStageIssueCodes(value,incoming));setError('')}catch(e){setError((e as Error).message)}};
 return <fieldset className="stage-issues" disabled={disabled}>
  <legend>{label}（{value.length}号）</legend>
  <p className="meta">未登録の将来号・合併号も選択できます。追加だけでは保存されません。</p>
  <div className="stage-issue-controls">
   <IssueSelect label={`${label}の追加`} value={single} onChange={setSingle}/>
   <button type="button" className="secondary compact" onClick={()=>add([single])}>1号追加</button>
  </div>
  <div className="stage-issue-range">
   <IssueSelect label="範囲の開始" value={first} onChange={setFirst} regularOnly/>
   <span aria-hidden="true">〜</span>
   <IssueSelect label="範囲の終了" value={last} onChange={setLast} regularOnly/>
  </div>
  <button type="button" className="secondary compact" onClick={()=>{try{add(regularIssueRange(first,last))}catch(e){setError((e as Error).message)}}}>範囲でまとめて追加</button>
  {error&&<p className="status-note" role="alert">{error}</p>}
  <div className="stage-chips" aria-label={`${label}の対象号一覧`}>
   {!value.length?<p className="meta">対象号は未選択です。</p>:value.map(code=><span key={code} className="stage-chip">{fmtIssue(code)}<button aria-label={`${fmtIssue(code)}を除外`} type="button" onClick={()=>{onChange(value.filter(x=>x!==code));setError('')}}>×</button></span>)}
  </div>
 </fieldset>;
}
