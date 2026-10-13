import {pagedReport,renderPdfHtml,type ReportData} from './core/pdf';
import {parseAnnouncement,type AnnouncementInline} from './core/announcement';
import {useEffect,useState, type FormEvent} from 'react';
import {StageIssueEditor} from './StageIssueEditor';
import {validateStageSelection} from './core/stage-issues';

// Production pages: fetch server-side authenticated data; no mock records.
async function api<T=any>(url:string,method='GET',data?:unknown):Promise<T>{
 const response=await fetch(url,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
 const result=await response.json().catch(()=>({error:'サーバーから正しい応答を取得できませんでした。'}));
 if(!response.ok)throw new Error(result.error||'通信に失敗しました。');return result as T;
}
type Tour={id:string;title:string;announced_at:string|null;archived_at?:string|null};
type Stage={id:string;kind:'qualifier'|'final';issues:string[];finalists_announced_at:string|null;finalists_saved_at?:string|null;participants?:{user_id:string;username:string}[]};
type FinalCandidateGroup={key:string;label:string;users:{id:string;username:string;rank:number|null}[]};
type TourDetail={tournament:Tour;stages:Stage[]};
type StandingRow={user_id:string;username:string;cells:Record<string,number|null>;total:number|null;disqualified:boolean;place:number|null;unsubmittedIssues:string[];disqualificationIssue:string|null};
type Standing={stage:string;codes:string[];availableAsOf:string[];asOf:string|null;rows:StandingRow[]};
type Announcement={id:string;title:string;body_json:string;status?:string;pinned:number;published_at:string|null};
type Notice={id:string;kind:string;payload:{title?:string;issue?:string};read_at:string|null;created_at:string};
type Inquiry={id:string;title:string;status:string;username?:string;updated_at:string};
type Thread={inquiry:Inquiry;messages:{id:string;body:string;sender:string;created_at:string}[]};
const stamp=(s:string)=>new Date(s).toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo'});
const issueText=(s:string)=>`${s.slice(0,4)}年${Number(s.slice(4,6))}${s.slice(6)!=='00'?`・${Number(s.slice(6))}合併`:''}号`;
function Feedback({message}:{message:string}){return message?<p role="alert" className="status-note">{message}</p>:null}

export function TournamentPage({admin=false,userId}:{admin?:boolean;userId?:string}){
 const [list,setList]=useState<Tour[]>([]),[id,setId]=useState(''),[detail,setDetail]=useState<TourDetail|null>(null);
 const [stageId,setStageId]=useState(''),[stand,setStand]=useState<Standing|null>(null),[asOf,setAsOf]=useState('');
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[title,setTitle]=useState('');
 const [qual,setQual]=useState<string[]>([]),[final,setFinal]=useState<string[]>([]);const [selectedFinal,setSelectedFinal]=useState<string[]>([]);
 const [editTitle,setEditTitle]=useState(''),[editQual,setEditQual]=useState<string[]>([]),[editFinal,setEditFinal]=useState<string[]>([]);
 const [availableUsers,setAvailableUsers]=useState<{id:string;username:string}[]>([]);
 const [searchUser,setSearchUser]=useState('');
 const [candidateGroups,setCandidateGroups]=useState<FinalCandidateGroup[]>([]),[candidateRefresh,setCandidateRefresh]=useState(0);
 const [adminSection,setAdminSection]=useState<'settings'|'qualifier'|'final'|'results'>('settings');
 const loadList=async()=>{const result=await api<{tournaments:Tour[]}>('/api/tournaments');setList(result.tournaments);setId(old=>old||result.tournaments[0]?.id||'')};
 useEffect(()=>{void loadList().catch(e=>setMessage(e.message))},[]);
 useEffect(()=>{if(!id){setDetail(null);return}let live=true;api<TourDetail>('/api/tournaments?id='+encodeURIComponent(id)).then(v=>{if(!live)return;setDetail(v);setStageId(old=>v.stages.some(s=>s.id===old)?old:v.stages[0]?.id||'');setSelectedFinal(v.stages.find(s=>s.kind==='final')?.participants?.map(p=>p.user_id)||[]);setEditTitle(v.tournament.title);setEditQual(v.stages.find(s=>s.kind==='qualifier')?.issues||[]);setEditFinal(v.stages.find(s=>s.kind==='final')?.issues||[])} ).catch(e=>setMessage(e.message));return()=>{live=false}},[id]);
 useEffect(()=>{if(!stageId)return;let live=true;api<Standing>('/api/tournaments?stage='+encodeURIComponent(stageId)+(asOf?'&asOf='+encodeURIComponent(asOf):'')).then(x=>{if(live)setStand(x)}).catch(e=>{if(live){setStand(null);setMessage(e.message)}});return()=>{live=false}},[stageId,asOf]);
 useEffect(()=>{if(!admin)return;api<{users:{id:string;username:string}[]}>('/api/admin/users?q='+encodeURIComponent(searchUser)).then(x=>setAvailableUsers(x.users)).catch(()=>{})},[searchUser,admin]);
 useEffect(()=>{const f=detail?.stages.find(x=>x.kind==='final');if(!admin||!f){setCandidateGroups([]);return}let live=true;api<{groups:FinalCandidateGroup[]}>('/api/tournaments?finalCandidates='+encodeURIComponent(f.id)).then(x=>{if(live)setCandidateGroups(x.groups)}).catch(e=>{if(live)setMessage(e.message)});return()=>{live=false}},[admin,detail?.tournament.id,candidateRefresh]);
 const run=async(payload:Record<string,unknown>,after?:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await api('/api/tournaments','POST',payload);await (after||loadList)()}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}};
 const create=async(e:FormEvent)=>{e.preventDefault();try{validateStageSelection(qual,final)}catch(e){setMessage((e as Error).message);return}const stages=[...(qual.length?[{kind:'qualifier',issues:qual}]:[]),...(final.length?[{kind:'final',issues:final}]:[])];await run({action:'create',title,stages},async()=>{const x=await api<{tournaments:Tour[]}>('/api/tournaments');setList(x.tournaments);setId(x.tournaments[0]?.id||'')})};
 const update=async(e:FormEvent)=>{e.preventDefault();if(!detail)return;
  try{validateStageSelection(editQual,editFinal)}catch(e){setMessage((e as Error).message);return}
  const stages=[...(editQual.length?[{kind:'qualifier',issues:editQual}]:[]),...(editFinal.length?[{kind:'final',issues:editFinal}]:[])];
  if(!stages.length){setMessage('予選または本戦を1つ以上指定してください。');return}
  const removing=detail.stages.some(s=>!stages.some(p=>p.kind===s.kind));
  if(!confirm(removing?'大会の区分を削除すると、該当区分の参加者も削除されます。保存しますか？':'大会の対象号を変更しますか？'))return;
  await run({action:'update',id,title:editTitle,stages,confirmStageRemoval:removing},refresh);
 };
 const refresh=async()=>{if(!id)return;setCandidateRefresh(n=>n+1);const v=await api<TourDetail>('/api/tournaments?id='+encodeURIComponent(id));setDetail(v);const f=v.stages.find(s=>s.kind==='final');setSelectedFinal(f?.participants?.map(p=>p.user_id)||[]);const nextStage=v.stages.some(s=>s.id===stageId)?stageId:v.stages[0]?.id||'';if(nextStage!==stageId){setStageId(nextStage);setAsOf('');setStand(null)}else if(nextStage){const x=await api<Standing>('/api/tournaments?stage='+encodeURIComponent(nextStage)+(asOf?'&asOf='+encodeURIComponent(asOf):''));setStand(x)}else setStand(null)};
 const target=detail?.stages.find(s=>s.id===stageId);const qualifier=detail?.stages.find(s=>s.kind==='qualifier');const finals=detail?.stages.find(s=>s.kind==='final');
 const alreadyJoined=!!qualifier?.participants?.some(p=>p.user_id===userId);
 const unsavedFinal=!!finals&&(selectedFinal.length!==(finals.participants?.length||0)||selectedFinal.some(id=>!(finals.participants||[]).some(u=>u.user_id===id)));
 const effectiveAdminSection=adminSection==='qualifier'&&!qualifier||adminSection==='final'&&!finals?'settings':adminSection;
 return <>
  {admin&&effectiveAdminSection==='settings'&&<section className="card"><h2>大会を新規登録</h2><p className="meta">対象号を年度・号番号から追加します。号マスターに未登録の将来号や合併号も選択できます。</p><form className="form-stack" onSubmit={e=>void create(e)}><label>大会名<input required maxLength={90} value={title} onChange={e=>setTitle(e.target.value)}/></label><StageIssueEditor label="予選の対象号（任意）" value={qual} onChange={setQual} disabled={busy}/><StageIssueEditor label="本戦の対象号（任意）" value={final} onChange={setFinal} disabled={busy}/><button disabled={busy||!title.trim()||!qual.length&&!final.length} className="primary full">大会を登録</button></form></section>}
  <Feedback message={message}/>
  {!list.length?<section className="card empty"><h3>{admin?'大会が登録されていません':'現在表示できる大会はありません'}</h3></section>:<>
   <section className="card"><label className="form-label">大会を選択</label><select value={id} onChange={e=>{setId(e.target.value);setStageId('');setAsOf('');setAdminSection('settings');setStand(null)}}>{list.map(t=><option key={t.id} value={t.id}>{t.title}{t.archived_at?'（保管中）':''}</option>)}</select>{detail&&<p className="meta">{detail.tournament.title}{detail.tournament.announced_at?' ・ 公開済み':' ・ 未公開'}</p>}</section>
   {detail&&<>
    {admin&&<section className="card" aria-label="大会管理メニュー"><div className="segmented"><button className={effectiveAdminSection==='settings'?'selected':''} onClick={()=>setAdminSection('settings')}>大会設定</button>{qualifier&&<button className={effectiveAdminSection==='qualifier'?'selected':''} onClick={()=>setAdminSection('qualifier')}>予選管理</button>}{finals&&<button className={effectiveAdminSection==='final'?'selected':''} onClick={()=>setAdminSection('final')}>本戦管理</button>}<button className={effectiveAdminSection==='results'?'selected':''} onClick={()=>setAdminSection('results')}>大会成績</button></div></section>}
    {admin&&effectiveAdminSection==='settings'&&<section className="card"><h2>大会設定の編集</h2><p className="meta">既存の参加者は、区分を削除しない限り維持されます。対象号には未登録の将来号も指定できます。</p><form className="form-stack" onSubmit={e=>void update(e)}><label>大会名<input value={editTitle} maxLength={90} required onChange={e=>setEditTitle(e.target.value)}/></label><StageIssueEditor label="予選対象号" value={editQual} onChange={setEditQual} disabled={busy}/><StageIssueEditor label="本戦対象号" value={editFinal} onChange={setEditFinal} disabled={busy}/><button className="primary full" disabled={busy||!editQual.length&&!editFinal.length}>大会設定を保存</button></form><div className="two-actions"><button className="secondary" disabled={busy||!!detail.tournament.archived_at} onClick={()=>{if(confirm('大会を保管しますか？'))void run({action:'archive',id},async()=>{await loadList();await refresh()})}}>大会を保管</button><button className="secondary" disabled={busy||!detail.tournament.archived_at} onClick={()=>{if(confirm('大会を復元しますか？'))void run({action:'restore',id},async()=>{await loadList();await refresh()})}}>大会を復元</button></div></section>}
    {(!admin||effectiveAdminSection==='results')&&<section className="card"><h2>大会区分</h2><div className="segmented">{detail.stages.map(st=><button key={st.id} className={stageId===st.id?'selected':''} onClick={()=>{setStageId(st.id);setAsOf('')}}>{st.kind==='qualifier'?'予選':'本戦'}</button>)}{!admin&&!finals&&<button disabled aria-label="本戦は未発表">本戦（未発表）</button>}</div>{target&&<p className="meta">対象号：{target.issues.map(issueText).join('・')}</p>}{!admin&&qualifier&&(alreadyJoined?<p className="meta">予選に参加登録済みです。</p>:<button className="primary full" disabled={busy} onClick={()=>{if(confirm('この大会の予選に参加しますか？ 自分で参加登録を取り消すことはできません。'))void run({action:'join',stageId:qualifier.id},refresh)}}>予選に参加登録する</button>)}{!admin&&finals&&!finals.finalists_announced_at&&<p className="status-note">本戦進出者はまだ発表されていません。</p>}</section>}
    {(!admin||effectiveAdminSection==='results')&&target&&(admin||target.kind!=='final'||target.finalists_announced_at)&&<section className="card"><h2>大会ランキング</h2>{target.issues.length>1&&<label>集計時点<select value={asOf||stand?.asOf||''} disabled={!stand?.availableAsOf.length} onChange={e=>setAsOf(e.target.value)}>{!stand?.availableAsOf.length&&<option value="">集計可能な号はまだありません</option>}{stand?.availableAsOf.map(x=><option value={x} key={x}>{issueText(x)}</option>)}</select></label>}<div className="scroller"><table className="wide tournament-rank-table"><thead><tr><th>順位</th><th>ユーザー名</th>{stand?.codes.map(x=><th key={x}>{issueText(x)}</th>)}<th>累計</th></tr></thead><tbody>{stand?.rows.map(r=><tr key={r.user_id}><td>{r.disqualified?'失格':r.place===null?'—':`${r.place}位`}</td><td>{r.username}</td>{stand.codes.map(c=><td key={c}>{r.unsubmittedIssues?.includes(c)?'未提出':r.cells[c]??'—'}</td>)}<td>{r.total??'—'}</td></tr>)}</tbody></table></div>{!stand?.rows.length&&<p className="meta">まだ集計できる成績がありません。</p>}</section>}
    {admin&&effectiveAdminSection==='qualifier'&&qualifier&&<section className="card"><h2>予選参加者管理</h2><p className="meta">参加者の登録と除外を管理します。対象ユーザーを確認してから確定してください。</p><h3>登録済み参加者（{qualifier.participants?.length||0}人）</h3><div className="choice-list">{qualifier.participants?.map(u=><div className="choice" key={u.user_id}><span className="grow">{u.username}</span><button className="secondary" disabled={busy} onClick={()=>{if(confirm(`${u.username} を予選参加者から除外しますか？ 大会成績にも反映されます。`))void run({action:'remove',stageId:qualifier.id,userId:u.user_id,confirmed:true},refresh)}}>除外</button></div>)}{!qualifier.participants?.length&&<p className="meta">予選参加者はまだ登録されていません。</p>}</div><div className="hairline"/><label>ユーザー検索<input placeholder="ユーザー名" value={searchUser} onChange={e=>setSearchUser(e.target.value)}/></label><div className="choice-list">{availableUsers.filter(u=>!qualifier.participants?.some(p=>p.user_id===u.id)).slice(0,15).map(u=><button key={u.id} className="choice" disabled={busy} onClick={()=>{if(confirm(`${u.username} を予選に代理登録しますか？`))void run({action:'enroll',stageId:qualifier.id,userId:u.id},refresh)}}>{u.username} を追加</button>)}</div></section>}
    {admin&&effectiveAdminSection==='final'&&finals&&<section className="card"><h2>本戦進出者の選択・発表</h2><p className="meta">前回大会の本戦参加者 → 今大会の予選参加者 → その他のユーザーの順に表示します。同じ人は複数グループに表示されても選択は共通です。</p><label>ユーザー検索<input value={searchUser} onChange={e=>setSearchUser(e.target.value)}/></label>{candidateGroups.map(group=><div key={group.key}><h3 style={{margin:'14px 0 7px'}}>{group.label}（{group.users.length}人）</h3><div className="choice-list">{group.users.filter(u=>u.username.includes(searchUser)).map(u=><label className="choice" key={group.key+'/'+u.id}><input type="checkbox" checked={selectedFinal.includes(u.id)} onChange={e=>setSelectedFinal(x=>e.target.checked?[...new Set([...x,u.id])]:x.filter(a=>a!==u.id))}/><span>{u.username}{u.rank!==null&&<small className="meta"> ・ {u.rank}位</small>}</span></label>)}{!group.users.some(u=>u.username.includes(searchUser))&&<p className="meta">該当するユーザーはいません。</p>}</div></div>)}<p className="meta">現在の選択：{selectedFinal.length}人{finals.finalists_saved_at?' ・ 選択内容を保存済み':' ・ 未保存'}</p>{unsavedFinal&&<p role="status" className="status-note">選択内容に未保存の変更があります。保存後に発表できます。</p>}<div className="two-actions"><button className="secondary" disabled={busy} onClick={()=>void run({action:'saveFinal',stageId:finals.id,userIds:selectedFinal},refresh)}>選択内容を保存</button><button className="primary" disabled={busy||!!finals.finalists_announced_at||unsavedFinal||!finals.finalists_saved_at||!selectedFinal.length} onClick={()=>{const saved=finals.participants||[];if(confirm(`保存済みの本戦進出者 ${saved.length}名を発表しますか？\n${saved.map(u=>u.username).join('、')}`))void run({action:'publishFinal',stageId:finals.id,confirmed:true},refresh)}}>本戦進出者を発表</button></div>{finals.finalists_announced_at&&<p className="meta">発表済みです。参加者の修正は「選択内容を保存」で反映されます。</p>}</section>}
   </>}
  </>}
 </>
}

function AnnouncementContent({body}:{body:string}){
 const inline=(pieces:AnnouncementInline[])=>pieces.map((x,i)=>x.kind==='strong'?<strong key={i}>{x.text}</strong>:x.kind==='link'?<a key={i} href={x.url} target="_blank" rel="noopener noreferrer">{x.text}</a>:<span key={i}>{x.text}</span>);
 return <div className="announcement-body">{parseAnnouncement(body).map((block,i)=>block.kind==='heading'?<h3 key={i}>{inline(block.items[0])}</h3>:block.kind==='list'?<ul key={i}>{block.items.map((item,j)=><li key={j}>{inline(item)}</li>)}</ul>:<p key={i} style={{whiteSpace:'pre-wrap'}}>{inline(block.items[0])}</p>)}</div>;
}
export function NewsBoard({admin=false}:{admin?:boolean}){
 const blank={id:'',title:'',body:'',status:'draft',pinned:false};
 const [items,setItems]=useState<Announcement[]>([]),[message,setMessage]=useState('');
 const [draft,setDraft]=useState(blank),[editing,setEditing]=useState(false),[preview,setPreview]=useState(false),[saving,setSaving]=useState(false);
 const load=async()=>{const r=await api<{announcements:Announcement[]}>('/api/announcements');setItems(r.announcements)};
 useEffect(()=>{void load().catch(e=>setMessage(e.message))},[admin]);
 const startEdit=(a?:Announcement)=>{setDraft(a?{id:a.id,title:a.title,body:a.body_json,status:a.status||'published',pinned:!!a.pinned}:blank);setMessage('');setPreview(false);setEditing(true)};
 const save=async(status:string)=>{if(!draft.title.trim())return;setSaving(true);setMessage('');try{await api('/api/announcements','POST',{...draft,status});setPreview(false);setEditing(false);setDraft(blank);await load()}catch(e){setMessage((e as Error).message)}finally{setSaving(false)}};
 const remove=async(id:string)=>{if(!confirm('このお知らせを完全に削除しますか？'))return;setSaving(true);try{await api('/api/announcements','POST',{id,action:'delete'});await load()}catch(e){setMessage((e as Error).message)}finally{setSaving(false)}};
 const insert=(kind:'heading'|'bold'|'list'|'link')=>{const textarea=document.getElementById('announcement-edit-body') as HTMLTextAreaElement|null;
  const start=textarea?.selectionStart??draft.body.length,end=textarea?.selectionEnd??start,selection=draft.body.slice(start,end),value=kind==='heading'?'## '+(selection||'見出し'):kind==='bold'?`**${selection||'強調する文字'}**`:kind==='list'?'- '+(selection||'項目'):`[${selection||'リンク名'}](https://example.com)`;
  setDraft(d=>({...d,body:d.body.slice(0,start)+value+d.body.slice(end)}));
 };
 return <><Feedback message={message}/>{admin&&editing&&<section className="card"><div className="card-head"><h2>{draft.id?'お知らせを編集':'お知らせを作成'}</h2><button className="secondary" onClick={()=>{setEditing(false);setPreview(false)}}>一覧へ戻る</button></div>
  {!preview?<div className="form-stack"><label>タイトル<input maxLength={140} value={draft.title} onChange={e=>setDraft(x=>({...x,title:e.target.value}))}/></label><div><p className="meta">本文の装飾</p><div className="format-toolbar"><button onClick={()=>insert('heading')}>見出し</button><button onClick={()=>insert('bold')}>太字</button><button onClick={()=>insert('list')}>箇条書き</button><button onClick={()=>insert('link')}>リンク</button></div><textarea id="announcement-edit-body" aria-label="お知らせ本文" rows={9} maxLength={30000} value={draft.body} onChange={e=>setDraft(x=>({...x,body:e.target.value}))}/></div><label className="inline-check"><input type="checkbox" checked={draft.pinned} onChange={e=>setDraft(x=>({...x,pinned:e.target.checked}))}/>重要なお知らせとして固定</label><div className="two-actions"><button className="secondary" disabled={saving||!draft.title.trim()} onClick={()=>void save('draft')}>下書き保存</button><button className="primary" disabled={!draft.title.trim()||saving} onClick={()=>setPreview(true)}>公開前プレビュー</button></div></div>
  :<div><p className="meta">以下の内容を公開します。公開した場合、初めて固定された重要なお知らせはサイト内通知を送信します。</p><h2>{draft.title}</h2>{draft.pinned&&<p className="tag accent">重要・固定</p>}<AnnouncementContent body={draft.body}/><div className="two-actions"><button className="secondary" onClick={()=>setPreview(false)}>編集に戻る</button><button className="primary" disabled={saving} onClick={()=>{if(confirm('この内容を公開しますか？'))void save('published')}}>確認して公開</button></div></div>}
 </section>}
 {(!admin||!editing)&&<section className="card"><div className="card-head"><h2>お知らせ</h2>{admin&&<button className="primary" onClick={()=>startEdit()}>新規作成</button>}</div>{!items.length?<p className="meta">現在お知らせはありません。</p>:items.map(a=><div key={a.id} className="announcement-item"><div className="card-head"><strong>{a.title}</strong>{admin&&<button className="secondary compact" onClick={()=>startEdit(a)}>編集</button>}</div><p className="meta">{a.pinned?'重要・固定表示　':''}{a.published_at?stamp(a.published_at):'下書き'}{admin&&a.status?' ・ '+a.status:''}</p><AnnouncementContent body={a.body_json}/>{admin&&<div className="two-actions"><button className="secondary" disabled={saving} onClick={()=>void saveExistingHidden(a)}>非公開</button><button className="secondary" disabled={saving} onClick={()=>void remove(a.id)}>削除</button></div>}</div>)}</section>}</>;
 async function saveExistingHidden(a:Announcement){setSaving(true);try{await api('/api/announcements','POST',{id:a.id,title:a.title,body:a.body_json,status:'hidden',pinned:!!a.pinned});await load()}catch(e){setMessage((e as Error).message)}finally{setSaving(false)}}
}

export function NotificationPanel(){
 const [items,setItems]=useState<Notice[]>([]),[error,setError]=useState('');
 const refresh=()=>api<{notifications:Notice[]}>('/api/notifications').then(d=>setItems(d.notifications)).catch(e=>setError(e.message));
 useEffect(()=>{void refresh()},[]);
 return <div className="popover"><div className="row spread"><strong>通知</strong><button className="text-action" onClick={()=>void api('/api/notifications','POST',{action:'readAll'}).then(refresh)}>すべて既読</button></div><Feedback message={error}/>{!items.length?<p className="meta">現在通知はありません。</p>:items.map(n=><div className="listline" key={n.id}><span className={n.read_at?'':'accent-text'}>{n.kind==='cutoff_reminder'?'予想締切のお知らせ':n.kind==='inquiry'?'お問い合わせの更新':'重要なお知らせ'}<small className="meta block">{n.payload?.title||n.payload?.issue||stamp(n.created_at)}</small></span></div>)}</div>
}
export function Inquiries({admin=false}:{admin?:boolean}){
 const [items,setItems]=useState<Inquiry[]>([]),[selected,setSelected]=useState(''),[thread,setThread]=useState<Thread|null>(null),[title,setTitle]=useState(''),[text,setText]=useState(''),[error,setError]=useState('');
 const load=()=>api<{inquiries:Inquiry[]}>('/api/inquiries').then(d=>setItems(d.inquiries));
 useEffect(()=>{void load().catch(e=>setError(e.message))},[admin]);
 useEffect(()=>{if(!selected){setThread(null);return}api<Thread>('/api/inquiries?id='+encodeURIComponent(selected)).then(setThread).catch(e=>setError(e.message))},[selected]);
 const send=async(action:'create'|'reply'|'status',status?:string)=>{setError('');try{const r=await api<{id?:string}>('/api/inquiries','POST',{action,id:selected,title,message:text,status});setText('');setTitle('');await load();if(r.id)setSelected(r.id);else if(selected)setThread(await api('/api/inquiries?id='+selected))}catch(e){setError((e as Error).message)}};
 return <><Feedback message={error}/>{!admin&&!selected&&<section className="card"><h2>お問い合わせを作成</h2><div className="form-stack"><label>件名<input maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>本文<textarea rows={4} value={text} onChange={e=>setText(e.target.value)}/></label><button className="primary full" disabled={!title.trim()||!text.trim()} onClick={()=>void send('create')}>お問い合わせを送信</button></div></section>}
 <section className="card"><h2>お問い合わせ一覧</h2>{!items.length?<p className="meta">お問い合わせはありません。</p>:items.map(i=><button key={i.id} className="choice" onClick={()=>{setSelected(i.id);setText('')}}>{i.title} <span className="meta">{i.status==='done'?'完了':i.status==='new'?'未対応':'対応中'}</span></button>)}</section>
 {thread&&<section className="card"><div className="card-head"><h2>{thread.inquiry.title}</h2><button className="secondary" onClick={()=>setSelected('')}>閉じる</button></div>{thread.messages.map(m=><div className="listline" key={m.id}><div><strong>{m.sender}</strong><p style={{whiteSpace:'pre-wrap'}}>{m.body}</p><p className="meta">{stamp(m.created_at)}</p></div></div>)}<label>返信<textarea rows={3} value={text} onChange={e=>setText(e.target.value)}/></label><div className="two-actions"><button className="primary" disabled={!text.trim()} onClick={()=>void send('reply')}>返信する</button>{admin&&<button className="secondary" onClick={()=>void send('status','done')}>対応完了にする</button>}</div></section>}</>
}

export function AdminOperations({role}:{role:string}){
 const [menu,setMenu]=useState<'home'|'news'|'inquiry'|'site'|'roles'|'pdf'>('home');
 const [settings,setSettings]=useState({site_name:'ジャンプ掲載順予想',maintenance:0,maintenance_message:'メンテナンス中です。'});
 const [users,setUsers]=useState<{id:string;username:string;role:string;is_founder:number}[]>([]);
 const [target,setTarget]=useState(''),[roleChoice,setRoleChoice]=useState('admin'),[password,setPassword]=useState(''),[error,setError]=useState('');
 const [roleSearch,setRoleSearch]=useState(''),[roleMatches,setRoleMatches]=useState<{id:string;username:string;role:string}[]>([]);
 const [selectedRoleUser,setSelectedRoleUser]=useState<{id:string;username:string;role:string}|null>(null);
 useEffect(()=>{if(menu==='site')void api<{settings:typeof settings|null}>('/api/admin/site-settings').then(r=>{if(r.settings)setSettings(r.settings)}).catch(e=>setError(e.message));if(menu==='roles')void api<{admins:typeof users}>('/api/admin/roles').then(r=>setUsers(r.admins)).catch(e=>setError(e.message))},[menu]);
 useEffect(()=>{if(menu!=='roles'){setRoleMatches([]);return}let live=true;
  const timer=setTimeout(()=>{void api<{users:{id:string;username:string;role:string}[]}>('/api/admin/users?q='+encodeURIComponent(roleSearch.trim())).then(r=>{if(live)setRoleMatches(r.users)}).catch(e=>{if(live)setError((e as Error).message)})},250);
  return()=>{live=false;clearTimeout(timer)};
 },[menu,roleSearch]);
 if(menu==='news')return <><button className="secondary" onClick={()=>setMenu('home')}>運営メニューへ戻る</button><NewsBoard admin/></>;
 if(menu==='inquiry')return <><button className="secondary" onClick={()=>setMenu('home')}>運営メニューへ戻る</button><Inquiries admin/></>;
 if(menu==='site')return <><button className="secondary" onClick={()=>setMenu('home')}>戻る</button><Feedback message={error}/><section className="card"><h2>サイト設定</h2><label>サイト名<input value={settings.site_name} onChange={e=>setSettings(x=>({...x,site_name:e.target.value}))}/></label><label className="inline-check"><input type="checkbox" checked={!!settings.maintenance} onChange={e=>setSettings(x=>({...x,maintenance:e.target.checked?1:0}))}/>メンテナンスモード</label><label>案内文<textarea value={settings.maintenance_message} onChange={e=>setSettings(x=>({...x,maintenance_message:e.target.value}))}/></label><button className="primary full" onClick={()=>{if(confirm('サイトの運用設定を変更しますか？'))void api('/api/admin/site-settings','POST',{siteName:settings.site_name,maintenance:!!settings.maintenance,message:settings.maintenance_message}).then(()=>setError('保存しました。')).catch(e=>setError(e.message))}}>設定を保存</button></section></>;
 if(menu==='roles')return <><button className="secondary" onClick={()=>setMenu('home')}>戻る</button><Feedback message={error}/><section className="card"><h2>管理者管理</h2><p className="meta">現在の管理者</p>{users.map(u=><div key={u.id} className="listline">{u.username}（{u.role==='owner'?'スーパー管理者':'通常管理者'}）{u.is_founder?' ・ 創設者':''}</div>)}
  <label>変更対象をユーザー名で検索<input value={roleSearch} maxLength={60} placeholder="ユーザー名を検索" onChange={e=>{setRoleSearch(e.target.value);setSelectedRoleUser(null);setTarget('')}}/></label>
  <div className="choice-list" aria-label="対象ユーザーの検索結果">{roleMatches.length?roleMatches.map(u=><button type="button" key={u.id} className="choice" aria-pressed={target===u.id} onClick={()=>{setTarget(u.id);setSelectedRoleUser(u);setRoleChoice(u.role)}}><span>{u.username} <small className="meta">（{u.role==='user'?'一般':u.role==='admin'?'通常管理者':'スーパー管理者'}）</small></span>{target===u.id?'✓':'＋'}</button>):<p className="meta">該当するユーザーはありません。</p>}</div>
  {selectedRoleUser&&<p className="status-note" role="status">変更対象：{selectedRoleUser.username}</p>}
  <label>新しい権限<select value={roleChoice} onChange={e=>setRoleChoice(e.target.value)}><option value="user">一般ユーザー</option><option value="admin">通常管理者</option><option value="owner">スーパー管理者</option></select></label>
  <label>自分のパスワード（再確認）<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
  <button className="primary full" disabled={!target||!password||roleChoice===selectedRoleUser?.role} onClick={()=>{
   if(!selectedRoleUser||!confirm(`${selectedRoleUser.username}の権限を「${roleChoice==='user'?'一般ユーザー':roleChoice==='admin'?'通常管理者':'スーパー管理者'}」に変更しますか？`))return;
   void api('/api/admin/roles','POST',{targetUserId:target,role:roleChoice,password,confirmed:true})
    .then(async()=>{setError('権限を変更しました。');setPassword('');setSelectedRoleUser(null);setTarget('');const [r,x]=await Promise.all([api<{admins:typeof users}>('/api/admin/roles'),api<{users:typeof roleMatches}>('/api/admin/users?q='+encodeURIComponent(roleSearch.trim()))]);setUsers(r.admins);setRoleMatches(x.users)})
    .catch(e=>setError((e as Error).message));
  }}>変更を確定</button></section></>;
 if(menu==='pdf')return <><button className="secondary" onClick={()=>setMenu('home')}>戻る</button><PdfExport/></>;
 return <section className="card"><h2>運営メニュー</h2>{([['pdf','PDF出力'],['news','お知らせ管理'],['inquiry','お問い合わせ管理'],...(role==='owner'?[['site','サイト設定'],['roles','管理者管理']]:[])] as [typeof menu,string][]).map(([key,label])=><button className="choice" key={key} onClick={()=>setMenu(key)}>{label}<span>›</span></button>)}</section>;
}

export function AccountSettings({onLoggedOut}:{onLoggedOut:()=>void}){
 const [action,setAction]=useState<'username'|'password'|'securityQuestions'>('username');
 const [username,setUsername]=useState(''),[currentPassword,setCurrentPassword]=useState(''),[newPassword,setNewPassword]=useState('');
 const [questions,setQuestions]=useState<{id:number;question:string}[]>([]),[chosen,setChosen]=useState([1,2]),[answers,setAnswers]=useState(['','']);
 const [feedback,setFeedback]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{void Promise.all([api<{user:{username:string}}>('/api/account'),api<{questions:{id:number;question:string}[]}>('/api/auth/questions')]).then(([a,q])=>{setUsername(a.user.username);setQuestions(q.questions)}).catch(e=>setFeedback(e.message))},[]);
 const save=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setFeedback('');try{
  const params=action==='username'?{username}:action==='password'?{newPassword}:{question1:chosen[0],question2:chosen[1],answer1:answers[0],answer2:answers[1]};
  const result=await api<{loginRequired?:boolean}>('/api/account','POST',{action,currentPassword,...params});
  setCurrentPassword('');setNewPassword('');setAnswers(['','']);
  if(result.loginRequired)onLoggedOut();else setFeedback('アカウント情報を更新しました。');
 }catch(e){setFeedback((e as Error).message)}finally{setBusy(false)}};
 return <section className="card"><h2>アカウント情報の変更</h2><p className="meta">変更を保存するときは、現在のパスワードを再入力してください。</p><div className="segmented"><button className={action==='username'?'selected':''} onClick={()=>setAction('username')}>ユーザー名</button><button className={action==='password'?'selected':''} onClick={()=>setAction('password')}>パスワード</button><button className={action==='securityQuestions'?'selected':''} onClick={()=>setAction('securityQuestions')}>秘密の質問</button></div><Feedback message={feedback}/><form className="form-stack" onSubmit={e=>void save(e)}>
  {action==='username'&&<label>新しいユーザー名<input required minLength={2} maxLength={40} value={username} onChange={e=>setUsername(e.target.value)}/></label>}
  {action==='password'&&<label>新しいパスワード（10文字以上）<input type="password" required minLength={10} value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label>}
  {action==='securityQuestions'&&[0,1].map(i=><div key={i}><label>秘密の質問{i+1}<select value={chosen[i]} onChange={e=>setChosen(old=>old.map((n,j)=>j===i?Number(e.target.value):n))}>{questions.map(q=><option value={q.id} key={q.id}>{q.question}</option>)}</select></label><label>新しい回答{i+1}<input type="password" required minLength={2} maxLength={128} value={answers[i]} onChange={e=>setAnswers(old=>old.map((s,j)=>j===i?e.target.value:s))}/></label></div>)}
  <label>現在のパスワード<input type="password" required value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)}/></label>
  <button className="primary full" disabled={busy}>変更を保存する</button>
 </form></section>
}

/** Printable A4 landscape / 16:9 reports, with layout pagination before printing. */
export function PdfExport(){
 const [type,setType]=useState<'works'|'issue'|'tournament'>('issue');
 const [issue,setIssue]=useState(''),[stage,setStage]=useState(''),[size,setSize]=useState<'A4'|'16:9'>('A4');
 const [scope,setScope]=useState<'all'|'qualifier'|'final'|'nonfinal'>('all');
 const [scopeTournament,setScopeTournament]=useState('');
 const [asOf,setAsOf]=useState('');
 const [worksColumns,setWorksColumns]=useState(8);
 const [issues,setIssues]=useState<{code:string}[]>([]);
 const [tournaments,setTournaments]=useState<Tour[]>([]);
 const [stageItems,setStageItems]=useState<{id:string;label:string;issues:string[]}[]>([]);
 const [preview,setPreview]=useState<ReportData|null>(null),[error,setError]=useState('');
 useEffect(()=>{void Promise.all([api<{issues:{code:string}[]}>('/api/issues'),api<{tournaments:Tour[]}>('/api/tournaments')]).then(async([x,y])=>{
  setIssues(x.issues);setIssue(x.issues.find(z=>z.code)?.code||'');setTournaments(y.tournaments);
  setScopeTournament(y.tournaments[0]?.id||'');
  const all=(await Promise.all(y.tournaments.map(t=>api<TourDetail>('/api/tournaments?id='+t.id)))).flatMap(t=>t.stages.map(s=>({id:s.id,label:`${t.tournament.title}・${s.kind==='qualifier'?'予選':'本戦'}`,issues:s.issues||[]})));
  setStageItems(all);setStage(all[0]?.id||'');
 }).catch(e=>setError(e.message))},[]);
 const chosenStage=stageItems.find(x=>x.id===stage);
 const load=()=>{
  setError('');setPreview(null);
  const qs=new URLSearchParams({type});
  if(type==='tournament') {qs.set('stage',stage);if(asOf)qs.set('asOf',asOf)}
  else{qs.set('issue',issue);qs.set('scope',scope);if(scope!=='all')qs.set('tournament',scopeTournament)}
  void api<ReportData>('/api/admin/pdf-data?'+qs.toString()).then(setPreview).catch(e=>setError(e.message));
 };
 const openPrint=()=>{
  if(!preview)return;
  // Create a user-initiated popup synchronously, before any asynchronous operations.
  const popup=window.open('','_blank');if(!popup){setError('ポップアップを許可してください。');return}
  popup.document.open();popup.document.write(renderPdfHtml(preview,{size,worksColumns}));popup.document.close();
 };
 const count=preview?(preview.type==='works'?preview.users.length:preview.type==='issue'?preview.rankings.length:preview.rows.length):0;
 const layout=preview?pagedReport(preview,{size,worksColumns}):null;
 return <section className="card"><h2>PDF出力</h2><p className="meta">対象の設定とプレビューを確認し、印刷画面からPDFとして保存します。全参加者をページ分割し、帳票の途中で切り捨てません。</p>
  <div className="form-stack"><label>帳票<select value={type} onChange={e=>{setType(e.target.value as typeof type);setPreview(null)}}><option value="works">作品別採点表</option><option value="issue">号別順位表（1ページ3列）</option><option value="tournament">大会順位表</option></select></label>
  {type!=='tournament'?<><label>対象号<select value={issue} onChange={e=>{setIssue(e.target.value);setPreview(null)}}>{issues.map(i=><option value={i.code} key={i.code}>{issueText(i.code)}</option>)}</select></label>
  <label>出力する参加者<select value={scope} onChange={e=>{setScope(e.target.value as typeof scope);setPreview(null)}}><option value="all">全員</option><option value="qualifier">大会の予選参加者</option><option value="final">大会の本戦進出者</option><option value="nonfinal">大会の本戦非進出者</option></select></label>
  {scope!=='all'&&<label>絞り込みに使用する大会<select value={scopeTournament} onChange={e=>{setScopeTournament(e.target.value);setPreview(null)}}>{tournaments.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label>}
  {type==='works'&&<label>1ページあたりのユーザー列数<select value={worksColumns} onChange={e=>{setWorksColumns(Number(e.target.value));setPreview(null)}}><option value="6">6列</option><option value="8">8列</option><option value="10">10列</option></select></label>}</>:<><label>大会と区分<select value={stage} onChange={e=>{setStage(e.target.value);setAsOf('');setPreview(null)}}>{stageItems.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
  <label>累計の集計時点<select value={asOf} onChange={e=>{setAsOf(e.target.value);setPreview(null)}}><option value="">最新の集計可能号</option>{chosenStage?.issues.map(c=><option key={c} value={c}>{issueText(c)}</option>)}</select></label></>}
  <label>用紙<select value={size} onChange={e=>setSize(e.target.value as typeof size)}><option value="A4">A4横</option><option value="16:9">16:9 横</option></select></label>
  <button className="primary full" disabled={type==='tournament'?!stage:!issue||scope!=='all'&&!scopeTournament} onClick={load}>プレビューを表示</button></div>
  <Feedback message={error}/>{preview&&<><div className="hairline"/><h3>出力内容の確認</h3><p className="meta">{layout?.title}／{count}人／全{layout?.pages.length}ページ／{preview.type!=='tournament'?preview.scopeLabel||'全参加者':'大会参加者'}</p>
  {preview.type==='works'?<div className="scroller"><table className="wide"><thead><tr><th>作品</th>{preview.users.slice(0,3).map(u=><th key={u.user_id}>{u.username}</th>)}</tr></thead><tbody>{preview.works.map(w=><tr key={w.id}><td>{w.title}</td>{preview.users.slice(0,3).map(u=><td key={u.user_id}>{u.errors?.[w.id]??'—'}</td>)}</tr>)}</tbody></table></div>:<div className="scroller"><table className="wide"><thead><tr><th>順位</th><th>ユーザー</th><th>得点・累計</th></tr></thead><tbody>{(preview.type==='issue'?preview.rankings:preview.rows).map(r=><tr key={r.user_id}><td>{'disqualified' in r&&r.disqualified?'失格':r.place??'—'}</td><td>{r.username}</td><td>{'total_error' in r?r.total_error:r.total??'—'}</td></tr>)}</tbody></table></div>}
  <button className="primary full" onClick={openPrint}>全ページの印刷プレビューを開く</button></>}
 </section>
}

export function MyHistory({username}:{username:string}){
 const [history,setHistory]=useState<{code:string;place:number;total_error:number}[]>([]),[offset,setOffset]=useState<number|null>(0),[year,setYear]=useState(''),[error,setError]=useState('');
 const load=async(from:number,selectedYear=year)=>{setError('');try{const result=await api<{history:typeof history;nextOffset:number|null}>('/api/my-history?offset='+from+(selectedYear?'&year='+selectedYear:''));setHistory(x=>from===0?result.history:[...x,...result.history]);setOffset(result.nextOffset)}catch(e){setError((e as Error).message)}};
 useEffect(()=>{void load(0)},[]);
 return <section className="card"><h2>{username}の成績</h2><label>年度<select value={year} onChange={e=>{const y=e.target.value;setYear(y);void load(0,y)}}><option value="">すべて</option>{Array.from({length:6},(_,i)=>2026-i).map(y=><option key={y}>{y}</option>)}</select></label><Feedback message={error}/>{history.map(x=><div key={x.code} className="listline"><strong className="grow">{issueText(x.code)}</strong><span>{x.place}位・{x.total_error}点</span></div>)}{!history.length&&<p className="meta">公開済みの個人成績はありません。</p>}{offset!==null&&<button className="secondary full" onClick={()=>void load(offset)}>さらに20件表示</button>}</section>
}
