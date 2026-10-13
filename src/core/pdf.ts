/** Pure, escaped HTML print layout for the three administrator PDF reports.
 * The browser's print-to-PDF feature is used; no report data leaves the browser.
 * All pages repeat identifying information and table headers.
 */
export type ReportType='works'|'issue'|'tournament';
export type ReportSize='A4'|'16:9';
export type ReportUser={user_id:string;username:string;place:number;total_error:number;errors?:Record<string,number>};
export type WorkLine={id:string;title:string;actualRank:number};
export type TournamentLine={user_id:string;username:string;place:number|null;total:number|null;disqualified:boolean;cells:Record<string,number|null>;unsubmittedIssues?:string[]};
export type ReportData=
 |{type:'works';issue:string;works:WorkLine[];users:ReportUser[];scopeLabel?:string}
 |{type:'issue';issue:string;rankings:ReportUser[];scopeLabel?:string}
 |{type:'tournament';title:string;codes:string[];rows:TournamentLine[];asOf:string|null};
export type PrintOptions={size:ReportSize;worksColumns?:number;worksRows?:number;rankingRowsPerColumn?:number;tournamentColumns?:number;tournamentRows?:number};
export function escapeHtml(value:unknown):string {return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));}
export function chunk<T>(rows:readonly T[],max:number):T[][]{if(!Number.isInteger(max)||max<1||max>500)throw new Error('invalid page size');const x:T[][]=[];for(let i=0;i<rows.length;i+=max)x.push(rows.slice(i,i+max));return x.length?x:[[]];}
export function issueText(code:string):string{if(!/^\d{8}$/.test(code))return code;const last=Number(code.slice(6));return `${code.slice(0,4)}年${Number(code.slice(4,6))}${last?`・${last}合併`:''}号`;}
export function pagedReport(data:ReportData,opts:PrintOptions):{title:string;pages:string[]}{
 const td=(v:unknown,tag:'td'|'th'='td')=>`<${tag}>${escapeHtml(v)}</${tag}>`;
 const table=(head:string,rows:string)=>`<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
 const pages:string[]=[];
 let title='';
 if(data.type==='works'){
  title=`${issueText(data.issue)} 作品別採点表`;
  const columns=chunk(data.users,opts.worksColumns??8),workGroups=chunk(data.works,opts.worksRows??24);
  for(const [ci,users] of columns.entries())for(const [ri,works] of workGroups.entries()){
   const heading=`<tr>${td('掲載順','th')}${td('作品','th')}${users.map(u=>td(u.username,'th')).join('')}</tr>`;
   const lines=works.map(w=>`<tr>${td(w.actualRank)}${td(w.title)}${users.map(u=>td(u.errors?.[w.id]??'—')).join('')}</tr>`).join('');
   // The total always means the user's *entire issue score*, not a page subtotal.
   const totals=`<tr class="totals"><th colspan="2">合計（全作品）</th>${users.map(u=>td(u.total_error,'th')).join('')}</tr>`;
   pages.push(`<div class="page-note">${escapeHtml(data.scopeLabel||'全参加者')}／${users.length}人／作品 ${ri*(opts.worksRows??24)+1}〜${ri*(opts.worksRows??24)+works.length}／列 ${ci+1}組</div>${table(heading,lines+totals)}`);
  }
 }else if(data.type==='issue'){
  title=`${issueText(data.issue)} 号別順位表`;
  const per=opts.rankingRowsPerColumn??10;
  const sheets=chunk(data.rankings,3*per);
  for(const [si,users] of sheets.entries()){
   const groups=[0,1,2].map(i=>users.slice(i*per,(i+1)*per));
   const sub=groups.map((g,i)=>`<div class="third">${table('<tr><th>順位</th><th>ユーザー名</th><th>得点</th></tr>',g.map(u=>`<tr>${td(u.place)}${td(u.username)}${td(u.total_error)}</tr>`).join('')||'<tr><td colspan="3">—</td></tr>')}</div>`).join('');
   pages.push(`<div class="page-note">${escapeHtml(data.scopeLabel||'全参加者')}／${data.rankings.length}人／${si*3*per+1}〜${Math.min((si+1)*3*per,data.rankings.length)}位の掲載枠</div><div class="three">${sub}</div>`);
  }
 }else{
  title=data.title;
  const colGroups=chunk(data.codes,opts.tournamentColumns??6),rowGroups=chunk(data.rows,opts.tournamentRows??22);
  for(const [ci,codes] of colGroups.entries())for(const [ri,users] of rowGroups.entries()){
   const heading=`<tr><th>順位</th><th>ユーザー名</th>${codes.map(c=>td(issueText(c),'th')).join('')}<th>累計</th></tr>`;
   const lines=users.map(u=>`<tr>${td(u.disqualified?'失格':u.place??'—')}${td(u.username)}${codes.map(c=>td(u.unsubmittedIssues?.includes(c)?'未提出':u.cells[c]??'—')).join('')}${td(u.total??'—')}</tr>`).join('');
   pages.push(`<div class="page-note">${data.asOf?`集計時点：${escapeHtml(issueText(data.asOf))}`:'集計対象：公開済みの範囲'}／参加者 ${ri*(opts.tournamentRows??22)+1}〜${ri*(opts.tournamentRows??22)+users.length}／号の列 ${ci+1}組</div>${table(heading,lines)}`);
  }
 }
 return {title,pages};
}
export function renderPdfHtml(data:ReportData,opts:PrintOptions):string{
 const {title,pages}=pagedReport(data,opts);
 const size=opts.size==='16:9'?'13.333in 7.5in':'A4 landscape';
 return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
 @page{size:${size};margin:9mm}*{box-sizing:border-box}body{margin:0;background:white;color:#111;font-family:-apple-system,BlinkMacSystemFont,'Yu Gothic','Hiragino Kaku Gothic ProN',sans-serif}
 .toolbar{padding:12px 16px;border-bottom:1px solid #111}.toolbar button{padding:8px 14px;background:white;border:1px solid #111;cursor:pointer}
 .page{padding:16px;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}
 .report-title{display:flex;justify-content:space-between;gap:10px;align-items:baseline;margin:0 0 12px}.report-title h1{font-size:16pt;margin:0}.report-title span{font-size:9pt;white-space:nowrap}
 .page-note{font-size:9pt;margin:0 0 8px}table{border-collapse:collapse;width:100%;font-size:8pt;table-layout:fixed}th,td{border:1px solid #111;padding:4px 5px;vertical-align:middle;overflow-wrap:anywhere}th{font-weight:750;text-align:left}
 thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}.totals{font-weight:750}.three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.third{min-width:0}
 @media print{.toolbar{display:none}.page{padding:0}}@media screen{body{background:#ddd}.page{max-width:1300px;margin:20px auto;background:#fff;box-shadow:0 3px 15px #0002;min-height:300px}}
 </style></head><body><div class="toolbar"><button onclick="window.print()">印刷・PDFとして保存</button> <button onclick="window.close()">閉じる</button></div>${pages.map((body,i)=>`<section class="page"><div class="report-title"><h1>${escapeHtml(title)}</h1><span>${i+1} / ${pages.length} ページ</span></div>${body}</section>`).join('')}</body></html>`;
}
