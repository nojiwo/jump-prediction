import {useCallback,useEffect,useMemo,useRef,useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode} from 'react';
import {issueChoices, encodeIssue, decodeIssue} from './core/domain';
import './styles.css';
import {TournamentPage,NewsBoard,NotificationPanel,Inquiries,AdminOperations,AccountSettings,MyHistory} from './Extras';
import {moveRankedItem} from './core/reorder';
import {restoreDraftOrder,selectedDraftPrefix} from './core/draft-order';
import {pickPredictionDisplayIssue} from './core/prediction-display';
import {changeWorkKind} from './core/work-form';
import {persistIssueSetup} from './core/issue-setup-flow';

type Role='user'|'admin'|'owner';
type Mode='drag'|'sequential';
type Appearance='system'|'light'|'dark';
type Accent='cyan'|'blue'|'green'|'purple'|'orange'|'pink';
type User={id:string;username:string;role:Role;theme_mode:Appearance;accent_color:Accent;prediction_input_mode:Mode;actual_input_mode:Mode};
type Work={id:string;title:string;kind:'serial'|'oneshot';periods?:{start_issue_code:string;end_issue_code:string|null}[];oneShots?:string[]};
type Issue={code:string;release_at:string;cutoff_at:string;status:'planned'|'open'|'closed';scores_confirmed_at?:string;results_published_at?:string};
type Frozen={work_id:string;initial_position:number;color:'lead'|'center'|'none'};
type IssueSetup={code:string;selected:{id:string;title:string;color:string}[];lead:string;centers:string[];hiatus:string[];confirmed:boolean;conflictCount:number};
type PredictionState={issue:Issue;frozen:Frozen[];formal:string[]|null;draft:string[];draft_input_mode?:Mode|null;first_submitted_at:string|null};
type RankedUser={username:string;total_error:number;place:number};
type RankingResponse={issue:string|null;availableIssues:string[];ranking:RankedUser[]};
type ScoredUser={user_id:string;username?:string;total_error:number;place:number};
type ScoringResponse={issue:Issue;frozen:(Frozen&{title:string})[];draft:string[];actual:string[];suddenHiatus:string[];scores:(ScoredUser&{username:string})[]};
type Alert={title:string;content:ReactNode;confirmText?:string;onConfirm?:()=>void};
type Tab='トップ'|'予想'|'ランキング'|'大会';
type AdminTab='ダッシュボード'|'作品・ジャンプ'|'採点・大会'|'その他';
const publicTabs:Tab[]=['トップ','予想','ランキング','大会'];
const adminTabs:AdminTab[]=['ダッシュボード','作品・ジャンプ','採点・大会','その他'];
const accentPairs:Record<Accent,{label:string;light:string;dark:string}>={
  cyan:{label:'水色',light:'#0089D4',dark:'#58CFFF'},blue:{label:'青',light:'#245FC6',dark:'#8CB8FF'},green:{label:'緑',light:'#087956',dark:'#6CDFAC'},purple:{label:'紫',light:'#7446BB',dark:'#C5A0FF'},orange:{label:'オレンジ',light:'#955000',dark:'#FFC47D'},pink:{label:'ピンク',light:'#AE3675',dark:'#FF9BCB'}
};
const demoWorks:Work[]=['星屑のリグレット','夜明けのブルー','放課後のメロディ','アオのフラッグ','ルミナスワールド','サイレント・ブルー','イノセントデイズ','となりのハル','星降る約束','明日のカケラ','ヒーローの休日','雨音レコード'].map((title,i)=>({id:String(i+1).padStart(4,'0'),title,kind:'serial'}));
const demoNow='2026-10-13T12:00:00+09:00';
const demoIssues:Issue[]=[{code:'20264200',release_at:'2026-10-19T00:00:00+09:00',cutoff_at:'2026-10-15T00:00:00+09:00',status:'open'}, {code:'20264100',release_at:'2026-10-12T00:00:00+09:00',cutoff_at:'2026-10-08T00:00:00+09:00',status:'closed'}];
const demoRanking:[string,number][]=[['ユウキ',16],['ナツメ',22],['カイト',22],['ハルカ',28],['タクミ',30],['ミサキ',34],['リョウ',36],['アヤカ',40],['ヒロ',49],['サクラ',52]];
const demoUser:User={id:'demo',username:'プレビューユーザー',role:'owner',theme_mode:'system',accent_color:'cyan',prediction_input_mode:'drag',actual_input_mode:'sequential'};
function Icon({name,size=20}:{name:string;size?:number}){
 const paths:Record<string,ReactNode>={
 home:<><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></>,
 edit:<><path d="m4 20 4-.8L20 7l-3-3L5 16zM15 6l3 3"/></>,
 chart:<><path d="M4 21v-9h4v9M10 21V4h4v17M16 21v-7h4v7"/></>,
 trophy:<><path d="M8 21h8m-4-4v4M7 3h10v7a5 5 0 0 1-10 0zM7 5H4v3a4 4 0 0 0 3 4M17 5h3v3a4 4 0 0 1-3 4"/></>,
 bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9M10 21h4"/></>,
 user:<><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
 gear:<><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></>,
 sun:<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/></>,
 moon:<path d="M20 15A8 8 0 0 1 9 4a8.5 8.5 0 1 0 11 11z"/>,
 check:<path d="m5 12 4 4 10-10"/>,
 checkCircle:<><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
 chevron:<path d="m9 5 7 7-7 7"/>,
 back:<path d="m15 5-7 7 7 7"/>,
 up:<path d="m6 15 6-6 6 6"/>,down:<path d="m6 9 6 6 6-6"/>,
 grip:<><circle cx="9" cy="5" r=".8"/><circle cx="15" cy="5" r=".8"/><circle cx="9" cy="12" r=".8"/><circle cx="15" cy="12" r=".8"/><circle cx="9" cy="19" r=".8"/><circle cx="15" cy="19" r=".8"/></>,
 close:<path d="M5 5 19 19M19 5 5 19"/>,plus:<path d="M12 4v16M4 12h16"/>,
 book:<path d="M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1m0-15c3-2 7-2 10-1v15c-3-1-7-1-10 1z"/>,
 calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>,
 clipboard:<><rect x="5" y="5" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zM9 14l2 2 4-4"/></>,
 more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
 file:<><path d="M6 2h8l5 5v15H6zM14 2v6h5M9 13h7M9 17h7"/></>,
 shield:<path d="M12 2 21 6v6c0 6-4 9-9 10-5-1-9-4-9-10V6z"/>,
 message:<><path d="M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-.9L3 21l1.7-5A9 9 0 1 1 21 11z"/><path d="M8 11h8"/></>,
 megaphone:<path d="m3 10 14-5v14L3 14zM7 15l2 6h4l-2-7"/>,
 search:<><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
 save:<><path d="M4 3h14l3 3v15H3V3zM7 3v6h9V3M7 21v-9h10v9"/></>,
 send:<path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/>,
 logout:<><path d="M10 3H4v18h6M15 8l5 4-5 4M8 12h12"/></>,
 alert:<><path d="M12 3 2 21h20zM12 9v5m0 3v.01"/></>,
 clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/></>,
 lock:<><rect x="5" y="10" width="14" height="12" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
 info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.01"/></>,
 filter:<path d="M3 4h18l-7 8v7l-4 2v-9z"/>,
 };
 return <svg className="app-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]??paths.info}</svg>
}
const fmtIssue=(code:string)=>{try{const z=decodeIssue(code);return `${z.year}年${z.first}${z.combined?`・${z.last}合併`:''}号`}catch{return code}};
const fmtDate=(date:string)=>{try{return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(date))}catch{return date}};
async function request<T>(path:string,method='GET',data?:unknown):Promise<T>{
 const res=await fetch(path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
 let parsed:any;try{parsed=await res.json()}catch{parsed={error:'サーバーから正しい応答がありませんでした。'}}
 if(!res.ok)throw new Error(parsed.error||'通信に失敗しました。');return parsed as T;
}

function IssueCodePicker({value,onChange}:{value:string;onChange:(next:string)=>void}){
 let z:{year:number;first:number;last:number;combined:boolean};
 try{z=decodeIssue(value)}catch{z=decodeIssue('20264300')}
 const years=Array.from({length:Math.max(6,new Date().getFullYear()+4-2021)},(_,i)=>2021+i);
 const option=`${z.first},${z.combined?z.last:0}`;
 return <div className="issue-picker">
   <select value={z.year} onChange={e=>onChange(encodeIssue(Number(e.target.value),z.first,z.combined?z.last:undefined))} aria-label="年度">{years.map(y=><option key={y} value={y}>{y}年</option>)}</select>
   <select value={option} onChange={e=>{const [first,last]=e.target.value.split(',').map(Number);onChange(encodeIssue(z.year,first,last||undefined))}} aria-label="号番号">{issueChoices(z.year).map(c=>{const d=decodeIssue(c.code);return <option key={c.code} value={`${d.first},${d.combined?d.last:0}`}>{c.label}</option>})}</select>
 </div>
}
// The demo must be explicitly enabled. Never silently bypass authentication in a real deployment.
const demo=import.meta.env.VITE_DEMO_MODE==='true' && import.meta.env.DEV;
const selectStorage=(key:string,defaultValue:string)=>{try{return localStorage.getItem(key)||defaultValue}catch{return defaultValue}};

export default function App(){
 const [user,setUser]=useState<User|null>(demo?demoUser:null);
 const [checking,setChecking]=useState(!demo);
 const [side,setSide]=useState<'public'|'admin'>('public');
 const [tab,setTab]=useState(0),[page,setPage]=useState<'main'|'settings'|'my'|'login'|'register'|'reset'>('main');
 const [popup,setPopup]=useState<'profile'|'notifications'|null>(null);
 const [alert,setAlert]=useState<Alert|null>(null);
 const [appearance,setAppearance]=useState<Appearance>((selectStorage('jump.theme','system') as Appearance));
 const [color,setColor]=useState<Accent>((selectStorage('jump.accent','cyan') as Accent));
 const [systemDark,setSystemDark]=useState(false);
 const [defaultPrediction,setDefaultPrediction]=useState<Mode>('drag');
 const [defaultActual,setDefaultActual]=useState<Mode>('sequential');
 const [works,setWorks]=useState<Work[]>(demo?demoWorks:[]),[issues,setIssues]=useState<Issue[]>(demo?demoIssues:[]);
 const [selectedWorkTab,setSelectedWorkTab]=useState<'works'|'issues'>('works');
 const [selectedScoreTab,setSelectedScoreTab]=useState<'score'|'tournament'>('score');
 const [workSearch,setWorkSearch]=useState('');
 const [newWork,setNewWork]=useState<Work|null>(null);
 const [newIssue,setNewIssue]=useState(false);
 const [editingIssue,setEditingIssue]=useState<Issue|null>(null);
 const [issueSetup,setIssueSetup]=useState<IssueSetup|null>(null);
 const [editingPrediction,setEditingPrediction]=useState(true);
 const [predictionMode,setPredictionMode]=useState<Mode>('drag');
 const [order,setOrder]=useState<string[]>(demo?demoWorks.map(w=>w.id):[]);
 const [sequentialCount,setSequentialCount]=useState(0);
 const [draft,setDraft]=useState<string[]|null>(null),[formal,setFormal]=useState<string[]|null>(null);
 const [frozen,setFrozen]=useState<Frozen[]>(demo?demoWorks.map((w,i)=>({work_id:w.id,initial_position:i+1,color:i===1?'lead':[3,6].includes(i)?'center':'none'})):[]);
 const [busy,setBusy]=useState(false),[selectedIssue,setSelectedIssue]=useState(41);
 const [joinTournament,setJoinTournament]=useState(false);
 const [actualMode,setActualMode]=useState<Mode>('sequential');
 const [actualOrder,setActualOrder]=useState(demoWorks.map(w=>w.id));
 const [actualCount,setActualCount]=useState(0);
 const touchSort=useRef<{kind:'prediction'|'actual';from:number;pointerId:number}|null>(null);
 const [touchSorting,setTouchSorting]=useState<string|null>(null);
 const [suddenHiatus,setSuddenHiatus]=useState<string[]>([]);
 const [actualFrozen,setActualFrozen]=useState<Frozen[]>([]);
 const [scoredPreview,setScoredPreview]=useState<ScoredUser[]|null>(null);
 const [publicRanking,setPublicRanking]=useState<RankingResponse|null>(null);
 const [rankIssueCode,setRankIssueCode]=useState('');
 const [compareData,setCompareData]=useState<{works:{work_id:string;title:string;color:string}[];participants:{username:string;userId:string;order:string[];firstSubmittedAt?:string}[]}|null>(null);
 const [newActualWork,setNewActualWork]=useState('');
 const [selectedActualIssue,setSelectedActualIssue]=useState('20264100');
 const [noticeRead,setNoticeRead]=useState(false);
 const [credentials,setCredentials]=useState({username:'',password:'',question1:1,question2:2,answer1:'',answer2:'',newPassword:''});
 const [securityQuestions,setSecurityQuestions]=useState<{id:number;question:string}[]>([]);
 const [feedback,setFeedback]=useState('');
 const activeIssue=issues.find(i=>i.status==='open');
 const predictionIssue=pickPredictionDisplayIssue(issues);
 const dark=appearance==='dark'||appearance==='system'&&systemDark;
 const accent=accentPairs[color][dark?'dark':'light'];
 const style={'--accent':accent} as CSSProperties;
 const canAdmin=user && ['admin','owner'].includes(user.role);
 const workLookup=useCallback((id:string)=>works.find(w=>w.id===id)?.title||'作品情報なし',[works]);
 const freezeColor=(id:string)=>frozen.find(w=>w.work_id===id)?.color;
 const nowDate=demo?new Date(demoNow).getTime():Date.now();
 const canSubmit=!!activeIssue && nowDate<Date.parse(activeIssue.cutoff_at);
 const selectedIssueData=issues.find(x=>x.code===selectedActualIssue);
 const comparisonParticipants=useMemo(()=>[...(compareData?.participants||[])].sort((a,b)=>
   Number(b.userId===user?.id)-Number(a.userId===user?.id)||
   String(a.firstSubmittedAt||'').localeCompare(String(b.firstSubmittedAt||''))||a.userId.localeCompare(b.userId)),[compareData,user?.id]);

 useEffect(()=>{const mq=matchMedia('(prefers-color-scheme: dark)');setSystemDark(mq.matches);const on=()=>setSystemDark(mq.matches);mq.addEventListener?.('change',on);return()=>mq.removeEventListener?.('change',on)},[]);
 useEffect(()=>{try{localStorage.setItem('jump.theme',appearance);localStorage.setItem('jump.accent',color)}catch{}},[appearance,color]);
 useEffect(()=>{if(demo)return;request<{user:User|null}>('/api/session').then(v=>{setUser(v.user);if(v.user){setAppearance(v.user.theme_mode);setColor(v.user.accent_color);setDefaultPrediction(v.user.prediction_input_mode);setPredictionMode(v.user.prediction_input_mode);setDefaultActual(v.user.actual_input_mode)}}).catch(()=>setFeedback('サーバー接続を確認できません。')).finally(()=>setChecking(false))},[]);
 const loadData=useCallback(async()=>{if(demo||!user)return;try{const [w,i]=await Promise.all([request<{works:Work[]}>('/api/works'),request<{issues:Issue[]}>('/api/issues')]);setWorks(w.works);setIssues(i.issues);const selectedForScore=i.issues.find(x=>x.status==='closed')||i.issues.find(x=>x.status==='open');if(selectedForScore)setSelectedActualIssue(selectedForScore.code);const issue=pickPredictionDisplayIssue(i.issues);setCompareData(null);if(issue){const v=await request<PredictionState>('/api/prediction?issue='+encodeURIComponent(issue.code));setFrozen(v.frozen);setDraft(v.draft.length?v.draft:null);setFormal(v.formal);setOrder(v.formal||((issue.status==='open')?restoreDraftOrder(v.frozen.map(f=>f.work_id),v.draft):[]));setPredictionMode(v.draft.length&&(v.draft_input_mode==='drag'||v.draft_input_mode==='sequential')?v.draft_input_mode:user.prediction_input_mode);setSequentialCount(v.formal?.length??v.draft.length);setEditingPrediction(issue.status==='open'&&!v.formal)}else{setFrozen([]);setFormal(null);setDraft(null);setOrder([])}}catch(e){setFeedback((e as Error).message)}},[user?.id,demo]);
 useEffect(()=>{void loadData()},[loadData]);
 useEffect(()=>{
  if(demo||!user||page!=='main'||side!=='public'||tab!==2)return;
  let active=true;
  request<RankingResponse>('/api/rankings'+(rankIssueCode?'?issue='+encodeURIComponent(rankIssueCode):''))
   .then(v=>{if(active){setPublicRanking(v);if(!rankIssueCode&&v.issue)setRankIssueCode(v.issue)}})
   .catch(e=>{if(active)setFeedback((e as Error).message)});
  return()=>{active=false};
 },[demo,user?.id,side,tab,page,rankIssueCode]);
 useEffect(()=>{
  if(demo||!user||!['admin','owner'].includes(user.role)||side!=='admin'||tab!==2||selectedScoreTab!=='score'||!selectedActualIssue)return;
  let active=true;
  request<ScoringResponse>('/api/admin/scoring?issue='+encodeURIComponent(selectedActualIssue)).then(v=>{
    if(!active)return;
    const eligible=v.frozen.map(f=>f.work_id);
    const o=v.draft.length?restoreDraftOrder(eligible,v.draft,v.suddenHiatus):v.actual.length?restoreDraftOrder(eligible,v.actual,v.suddenHiatus):eligible.filter(id=>!v.suddenHiatus.includes(id));
    setActualOrder(o);setActualCount(v.draft.length||v.actual.length||0);
    setSuddenHiatus(v.suddenHiatus);setActualFrozen(v.frozen);setScoredPreview(null);
  }).catch(e=>{if(active)setFeedback((e as Error).message)});
  return()=>{active=false};
 },[demo,user?.id,side,tab,selectedScoreTab,selectedActualIssue]);
 useEffect(()=>{
  if(demo||!user||!predictionIssue||canSubmit||Date.now()<Date.parse(predictionIssue.cutoff_at)||page!=='main'||side!=='public'||tab!==1)return;
  let active=true;
  request<{works:{work_id:string;title:string;color:string}[];participants:{username:string;userId:string;order:string[]}[]}>('/api/prediction-comparison?issue='+predictionIssue.code)
  .then(x=>{if(active)setCompareData(x)}).catch(()=>{});
  return()=>{active=false};
 },[demo,user?.id,predictionIssue?.code,canSubmit,page,side,tab]);

 const settingsUpdate=async(changes:Partial<Pick<User,'theme_mode'|'accent_color'|'prediction_input_mode'|'actual_input_mode'>>)=>{
  if(!demo&&user){try{const d=await request<{preferences:Partial<User>}>('/api/preferences','PATCH',changes);setUser({...user,...d.preferences})}catch(e){setFeedback((e as Error).message)}}
 };
 const switchTab=(v:number)=>{if(!demo&&!user&&v!==0){setPage('login');setPopup(null);return}setPage('main');setTab(v);setPopup(null)};
 const back=()=>{setPage('main');setPopup(null)};
 const notify=(title:string,content:ReactNode)=>setAlert({title,content});
 const move=moveRankedItem<string>;
 // Pointer capture enables touch reordering on iOS/Android, where HTML5 drag events
 // do not reliably fire. Keyboard-accessible up/down buttons remain as a fallback.
 const touchStart=(e:ReactPointerEvent<HTMLButtonElement>,kind:'prediction'|'actual',from:number)=>{
   if(e.pointerType==='mouse')return;
   e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
   touchSort.current={kind,from,pointerId:e.pointerId};setTouchSorting(`${kind}:${from}`);
 };
 const touchEnd=(e:ReactPointerEvent<HTMLButtonElement>,kind:'prediction'|'actual')=>{
   const pending=touchSort.current;
   if(!pending||pending.pointerId!==e.pointerId||pending.kind!==kind)return;
   const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>(`[data-rank-group="${kind}"][data-rank-index]`);
   touchSort.current=null;setTouchSorting(null);
   if(hit){const dest=Number(hit.dataset.rankIndex);
     if(Number.isInteger(dest)&&dest!==pending.from){
       if(kind==='prediction')setOrder(items=>move(items,pending.from,dest));
       else setActualOrder(items=>move(items,pending.from,dest));
     }
   }
 };
 const touchCancel=()=>{touchSort.current=null;setTouchSorting(null)};

 const doPrediction=async(mode:'draft'|'submit')=>{
  if(!activeIssue||!canSubmit)return notify('受付は終了しています','受付中の号と締切を確認してください。');
  if(mode==='submit'&&(order.length!==frozen.length||new Set(order).size!==frozen.length||(predictionMode==='sequential'&&sequentialCount!==order.length)))return notify('予想が未完成です','すべての予想対象作品を順位に配置してください。');
  setBusy(true);try{
    if(!demo)await request('/api/prediction','POST',{issue:activeIssue.code,mode,order:mode==='draft'&&predictionMode==='sequential'?selectedDraftPrefix(order,sequentialCount):order,inputMode:predictionMode});
    if(mode==='draft'){setDraft(predictionMode==='sequential'?selectedDraftPrefix(order,sequentialCount):[...order]);notify('下書きを保存しました',demo?'試作版のため、この画面内だけで保存されています。':'サーバーに下書きを保存しました。')}
    else{setFormal([...order]);setEditingPrediction(false);setDraft(null);notify('正式提出しました','最初の正式提出日時は、再提出しても保持されます。')}
  }catch(e){notify('保存できませんでした',(e as Error).message)}finally{setBusy(false)}
 };
 const submitPrediction=()=>setAlert({title:'正式提出の確認',content:<p>{fmtIssue(activeIssue?.code||'')}の予想を正式提出します。締切前であれば編集して再提出できます。</p>,confirmText:'正式提出する',onConfirm:()=>void doPrediction('submit')});
 const chooseSequential=(id:string)=>{const filtered=order.filter(x=>x!==id);const count=Math.min(sequentialCount,filtered.length);const next=[...filtered.slice(0,count),id,...filtered.slice(count)];setOrder(next);setSequentialCount(count+1)};
 const workColors:Record<string,string>={lead:'巻頭カラー',center:'センターカラー'};
 const workRows=order.map((id,i)=><div key={id} data-rank-group="prediction" data-rank-index={i} className={"work-row "+(touchSorting===`prediction:${i}`?"touch-sorting":"")} draggable={editingPrediction&&predictionMode==='drag'} onDragStart={e=>e.dataTransfer.setData('text/plain',String(i))} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();setOrder(x=>move(x,Number(e.dataTransfer.getData('text/plain')),i))}}>
  <span className="rank-index">{i+1}位</span><span className="work-title">{workLookup(id)}{freezeColor(id)!=='none'&&freezeColor(id)&&<small className={'flag '+freezeColor(id)}>{workColors[freezeColor(id)||'']}</small>}</span>
  {editingPrediction&&predictionMode==='drag'&&<span className="move-controls"><button aria-label="上へ" disabled={i===0} onClick={()=>setOrder(x=>move(x,i,i-1))}><Icon name="up" size={15}/></button><button aria-label="下へ" disabled={i===order.length-1} onClick={()=>setOrder(x=>move(x,i,i+1))}><Icon name="down" size={15}/></button><button type="button" className="touch-handle" aria-label="長押しして順位を移動" onPointerDown={e=>touchStart(e,"prediction",i)} onPointerUp={e=>touchEnd(e,"prediction")} onPointerCancel={touchCancel}><Icon name="grip" size={18}/></button></span>}
 </div>);

 const issueInfo=activeIssue&&<section className="card"><div className="card-head"><h2>現在の予想受付</h2><span className="tag accent">受付中</span></div><div className="big-title">{fmtIssue(activeIssue.code)}</div><p className="meta">締切：{fmtDate(activeIssue.cutoff_at)}</p><div className="hairline"/><div className="row spread"><div><p className="eyebrow">あなたの提出状況</p><strong className="accent-text">{formal?'正式提出済み':draft?'下書き保存済み':'未提出'}</strong></div><button className="primary action" onClick={()=>switchTab(1)}>予想を入力 <Icon name="chevron" size={16}/></button></div></section>;
 const noIssue=<section className="card empty"><Icon name="calendar" size={29}/><h3>現在受付中の予想はありません</h3><p>管理者が必要情報を確認し、受付を開始すると表示されます。</p></section>;
 const home=<>{issueInfo||noIssue}{demo&&<section className="card"><div className="card-head"><h2>開催中の大会</h2><button className="text-action" onClick={()=>switchTab(3)}>大会を見る <Icon name="chevron" size={15}/></button></div><div className="row"><Icon name="trophy" size={27}/><div className="grow"><strong>第3回大会</strong><p className="eyebrow">予選 41号〜44号</p></div><span className="tag accent">予選開催中</span></div><div className="hairline"/><div className="row spread"><span>{joinTournament?'予選に参加しています':'予選参加受付中'}</span><button className="secondary" onClick={()=>setJoinTournament(true)}>{joinTournament?'参加済み':'参加する'}</button></div></section>}{!demo&&<><section className="card"><h2>大会・お知らせ</h2><button className="choice" onClick={()=>switchTab(3)}>開催中の大会を見る <Icon name="chevron"/></button></section><NewsBoard/></>}{demo&&<section className="card"><h2>お知らせ</h2><div className="listline"><span>10/12</span><span className="tag">重要</span><strong>42号の予想受付を開始しました</strong><Icon name="chevron" size={15}/></div><div className="listline"><span>10/08</span><strong>大会のルールを公開しました</strong><Icon name="chevron" size={15}/></div></section>}</>;
 const predict=<>{!predictionIssue?noIssue:<><section className="card"><div className="card-head"><div><p className="eyebrow">対象号</p><h2 className="big-title">{fmtIssue(predictionIssue.code)}</h2></div><span className="tag accent">{canSubmit?'受付中':'受付終了'}</span></div><div className="row spread"><p className="meta">締切：{fmtDate(predictionIssue.cutoff_at)}</p>{formal&&<span className="tag">提出済み</span>}</div></section>{(canSubmit||formal)&&<section className="card"><div className="card-head"><h2>{formal&&!editingPrediction?'提出した予想':'予想の並び順'}</h2><span className="eyebrow">{predictionMode==='drag'?'並び替え':'順番選択'}</span></div>{!canSubmit&&<div className="status-note">受付期間外のため、ここから提出はできません。</div>}{editingPrediction&&predictionMode==='sequential'?<><p className="meta">{sequentialCount<order.length?`${sequentialCount+1}位の作品を選択してください。`:'全作品を選択しました。'}</p>{order.slice(0,sequentialCount).map((id,i)=><div className="work-row" key={id}><span className="rank-index">{i+1}位</span><strong>{workLookup(id)}</strong><Icon name="check" size={18}/></div>)}<div className="choice-list">{order.filter(id=>!order.slice(0,sequentialCount).includes(id)).map(id=><button key={id} className="choice" onClick={()=>chooseSequential(id)}>{workLookup(id)}<Icon name="plus" size={17}/></button>)}</div><button className="secondary full" onClick={()=>setSequentialCount(x=>Math.max(0,x-1))}>ひとつ戻す</button></>:<><p className="meta">{editingPrediction?'ドラッグ、または上下の矢印で順位を変更できます。':'正式提出済みの予想を表示しています。'}</p>{workRows}</>}{!editingPrediction&&formal?canSubmit&&<button className="secondary full" disabled={!canSubmit} onClick={()=>{setOrder(draft?restoreDraftOrder(frozen.map(f=>f.work_id),draft):[...formal]);setSequentialCount(draft?draft.length:formal.length);setEditingPrediction(true)}}>予想を編集する</button>:<div className="two-actions"><button className="secondary" disabled={busy||!canSubmit} onClick={()=>void doPrediction('draft')}><Icon name="save" size={16}/> 下書き保存</button><button className="primary" disabled={busy||!canSubmit} onClick={submitPrediction}><Icon name="send" size={16}/> 正式提出</button></div>}</section>}{!canSubmit&&!formal&&<section className="card empty"><h3>この号の予想は未提出です</h3><p>受付は終了しました。正式提出済みの参加者の予想比較をご覧ください。</p></section>}<p className="meta footnote">入力方式の初期設定は右上のプロフィール → 設定で変更できます。</p>{!canSubmit&&compareData&&<section className="card"><h2>全員の予想比較</h2><p className="meta">締切後に公開された正式予想のみ表示します。左右にスクロールできます。</p><div className="scroller"><table className="wide comparison-table"><thead><tr><th>順位</th>{comparisonParticipants.map(p=><th key={p.userId}>{p.username}</th>)}</tr></thead><tbody>{compareData.works.map((_,i)=><tr key={i}><td>{i+1}位</td>{comparisonParticipants.map(p=>{const w=compareData.works.find(w=>w.work_id===p.order[i]);return <td key={p.userId}><span className={w?.color==='lead'?'flag lead':w?.color==='center'?'flag center':''}>{w?.title||'—'}</span></td>})}</tr>)}</tbody></table></div></section>}</>}</>;
 const ranking=demo?<><section className="card row spread"><button className="icon-button" aria-label="前の号" disabled={selectedIssue<=40} onClick={()=>setSelectedIssue(n=>n-1)}><Icon name="back"/></button><div className="center"><p className="eyebrow">公開済みランキング</p><strong>{`2026年${selectedIssue}号`}</strong></div><button className="icon-button" aria-label="次の号" disabled={selectedIssue>=41} onClick={()=>setSelectedIssue(n=>n+1)}><Icon name="chevron"/></button></section><section className="card"><div className="card-head"><h2>この号のランキング</h2><span className="tag">公開済み</span></div><p className="meta">得点が少ないほど上位。同点は同順位です。</p><table><thead><tr><th>順位</th><th>ユーザー名</th><th className="right">得点</th></tr></thead><tbody>{demoRanking.map(([n,score],i)=><tr key={n}><td>{i===2?2:i+1}位</td><td className={n==='ヒロ'?'accent-text':''}>{n}</td><td className="right"><strong>{score+(selectedIssue===40?5:0)}点</strong></td></tr>)}</tbody></table></section></>:<>{publicRanking?.issue?<><section className="card"><label className="form-label">公開済みの号</label><select aria-label="ランキングの対象号" value={rankIssueCode||publicRanking.issue} onChange={e=>setRankIssueCode(e.target.value)}>{publicRanking.availableIssues.map(c=><option value={c} key={c}>{fmtIssue(c)}</option>)}</select></section><section className="card"><h2>この号のランキング</h2><p className="meta">得点が少ないほど上位。得点が同じ場合は同順位です。</p><table><thead><tr><th>順位</th><th>ユーザー名</th><th className="right">得点</th></tr></thead><tbody>{publicRanking.ranking.map((r,i)=><tr key={i}><td>{r.place}位</td><td>{r.username}</td><td className="right"><strong>{r.total_error}点</strong></td></tr>)}</tbody></table></section></>:<section className="card empty"><Icon name="chart" size={28}/><h3>公開済みのランキングはありません</h3><p>採点が確定し、次号の発売条件を満たすと表示されます。</p></section>}</>;
 const tournament=demo?<><section className="card"><div className="card-head"><div><p className="eyebrow">開催中の大会</p><h2 className="big-title">第3回大会</h2></div><span className="tag accent">予選開催中</span></div><p>予選：2026年41号〜44号</p><p>本戦：2026年45号〜48号</p><div className="hairline"/><button className={joinTournament?'secondary full':'primary full'} onClick={()=>setJoinTournament(true)}>{joinTournament?'参加登録済み':'予選に参加する'}</button></section><section className="card"><h2>予選ランキング</h2><div className="scroller"><table className="wide"><thead><tr><th>順位</th><th>ユーザー名</th><th>41号</th><th>42号</th><th>累計</th></tr></thead><tbody>{demoRanking.slice(0,7).map(([n,p],i)=><tr key={n}><td>{i+1}位</td><td>{n}</td><td>{p}</td><td>—</td><td>{p}</td></tr>)}</tbody></table></div></section></>:<TournamentPage userId={user?.id}/>;

 function saveNewWork(e:FormEvent){e.preventDefault();if(!newWork)return;
  const v=newWork;if(!v.title.trim())return;
  if(demo){const newId=v.id||String(works.length+1).padStart(4,'0');setWorks(ws=>[...ws.filter(w=>w.id!==newId),{...v,id:newId}]);setNewWork(null);notify('作品を保存しました','サンプルの作品一覧に反映しました。');return}
  void (async()=>{setBusy(true);try{await request('/api/works','POST',{id:v.id||undefined,title:v.title,kind:v.kind,periods:(v.periods||[]).map(p=>({start:p.start_issue_code,end:p.end_issue_code})),oneShots:v.oneShots||[]});setNewWork(null);await loadData();notify('保存しました','作品情報をデータベースに保存しました。')}catch(ex){setFeedback((ex as Error).message)}finally{setBusy(false)}})();
 }
 function createIssue(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget),year=Number(fd.get('year')),choice=String(fd.get('number')||'01'),parts=choice.split('-').map(Number);
  try{const code=encodeIssue(year,parts[0],parts[1]||undefined);const release=String(fd.get('release')),cutoff=String(fd.get('cutoff'));const data={code,release_at:new Date(release+'+09:00').toISOString(),cutoff_at:new Date(cutoff+'+09:00').toISOString()};
    if(!Number.isFinite(Date.parse(data.release_at)))throw new Error('発売日を入力してください');
    if(demo){setIssues(v=>[{...data,status:'planned'},...v]);setNewIssue(false);notify('号を追加しました','管理者が手動で受付を開始するまでは準備中のままです。')}
    else void (async()=>{setBusy(true);try{await request('/api/issues','POST',data);setNewIssue(false);await loadData()}catch(ex){setFeedback((ex as Error).message)}finally{setBusy(false)}})();
  }catch(ex){setFeedback((ex as Error).message)}
 }
 async function editIssueDates(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!editingIssue)return;
  const fd=new FormData(e.currentTarget),release=String(fd.get('release')||''),cutoff=String(fd.get('cutoff')||'');
  try{
   const payload={code:editingIssue.code,release_at:new Date(release+'+09:00').toISOString(),cutoff_at:editingIssue.status==='closed'?editingIssue.cutoff_at:new Date(cutoff+'+09:00').toISOString()};
   if(!Number.isFinite(Date.parse(payload.release_at))||!Number.isFinite(Date.parse(payload.cutoff_at)))throw new Error('日付を確認してください。');
   setBusy(true);
   if(!demo){await request('/api/issues','PATCH',payload);await loadData()}
   else setIssues(list=>list.map(x=>x.code===editingIssue.code?{...x,release_at:payload.release_at,cutoff_at:payload.cutoff_at}:x));
   setEditingIssue(null);notify('ジャンプ号の日時を更新しました','公開済みの採点結果が、日時変更によって再び非公開になることはありません。');
  }catch(ex){setFeedback((ex as Error).message)}finally{setBusy(false)}
 }
 async function openIssueSetup(code:string){
  if(demo){setIssueSetup({code,selected:works.map(w=>({id:w.id,title:w.title,color:'none'})),lead:works[1]?.id||'',centers:[works[3]?.id,works[6]?.id].filter(Boolean),hiatus:[],confirmed:false,conflictCount:0});return}
  setBusy(true);try{
    const d=await request<{selected:{id:string;title:string;color:string}[];overrides:{work_id:string;color:string;inclusion:string}[];conflictCount:number;issue:{plan_reviewed_at:string|null}}>('/api/admin/issue-setup?code='+code);
    setIssueSetup({code,selected:d.selected,lead:d.overrides.find(x=>x.color==='lead')?.work_id||'',centers:d.overrides.filter(x=>x.color==='center').map(x=>x.work_id),hiatus:d.overrides.filter(x=>x.inclusion==='planned_hiatus').map(x=>x.work_id),confirmed:!!d.issue.plan_reviewed_at,conflictCount:d.conflictCount});
  }catch(e){setFeedback((e as Error).message)}finally{setBusy(false)}
 }
 async function saveIssueConfiguration(open:boolean){
  if(!issueSetup)return;
  setBusy(true);
  try{
    if(!demo){
      await persistIssueSetup(request,issueSetup,open);
      await loadData();
    }else{
      await persistIssueSetup(async()=>({ok:true}),issueSetup,false);
      if(open){
        if(!issueSetup.confirmed||issueSetup.conflictCount)throw new Error('必要情報を確認してください。');
        if(issues.some(i=>i.status==='open'))throw new Error('現在受付中の号を終了してから開始してください。');
        setIssues(list=>list.map(i=>i.code===issueSetup.code?{...i,status:'open'}:i));
      }
    }
    if(open)setIssueSetup(null);
    notify(open?'受付を開始しました':'設定を保存しました',open?'予想対象作品を確定しました。':'作品情報と号の矛盾がなければ受付を開始できます。');
  }catch(e){setFeedback((e as Error).message)}finally{setBusy(false)}
 }
 const workManagement=<><section className="card"><div className="card-head"><h2>作品一覧</h2><button className="primary compact" onClick={()=>setNewWork({id:'',title:'',kind:'serial',periods:[{start_issue_code:'20264300',end_issue_code:null}],oneShots:[]})}><Icon name="plus" size={17}/> 新規登録</button></div><label className="search-box"><Icon name="search" size={18}/><input value={workSearch} onChange={e=>setWorkSearch(e.target.value)} placeholder="作品名・IDで検索"/></label><p className="meta">{works.length}作品登録済み</p>{works.filter(w=>w.title.includes(workSearch)||w.id.includes(workSearch)).map(w=><div className="listline" key={w.id}><span className="meta">{w.id}</span><strong className="grow">{w.title}<small className="meta block">{w.kind==='serial'?'連載':'読み切り'}</small></strong><button className="icon-button" aria-label="作品編集" onClick={()=>setNewWork({...w,periods:w.periods?.length?w.periods:[{start_issue_code:'20260100',end_issue_code:null}],oneShots:w.oneShots?.length?w.oneShots:['20264300']})}><Icon name="edit"/></button></div>)}</section></>;
 const issueManagement=<><section className="card"><div className="card-head"><h2>ジャンプ号一覧</h2><button className="primary compact" onClick={()=>setNewIssue(true)}><Icon name="plus" size={17}/> 新規登録</button></div>{issues.map(issue=><div className="listline" key={issue.code}><div className="grow"><strong>{fmtIssue(issue.code)}</strong><p className="meta">発売日：{fmtDate(issue.release_at)}</p></div><span className={'tag '+(issue.status==='open'?'accent':'')}>{issue.status==='open'?'受付中':issue.status==='closed'?'締切済み':'準備中'}</span><button className="icon-button" aria-label="発売日と締切を編集" onClick={()=>setEditingIssue(issue)}><Icon name="calendar"/></button>{issue.status==='planned'&&<button className="icon-button" aria-label="受付設定" onClick={()=>void openIssueSetup(issue.code)}><Icon name="edit"/></button>}</div>)}</section><section className="card"><h2>受付開始条件</h2><p className="meta">発売日・締切・カラー・予定休載・対象作品を確認してから、管理者が手動で受付を開始します。</p><p className="meta">ジャンプ号の日時はカレンダーアイコン、受付対象・カラー・予定休載は編集アイコンから設定できます。</p></section></>;
 const saveActual=async(action:'draft'|'preview'|'confirm')=>{
  if(!selectedActualIssue)return;
  setBusy(true);
  try{
    if(demo){notify('プレビュー版','デモモードでは、実際の採点データを保存しません。');return}
    const result=await request<{ok:boolean;scores?:ScoredUser[]}>('/api/admin/scoring','POST',{issue:selectedActualIssue,action,order:actualMode==='sequential'&&action==='draft'?selectedDraftPrefix(actualOrder,actualCount):actualOrder,suddenHiatus});
    if(action==='draft')notify('下書きを保存しました','掲載順の下書きをデータベースに保存しました。');
    else if(action==='preview'){
      setScoredPreview(result.scores||[]);
      setAlert({title:'採点プレビュー',content:<><p>提出済みのユーザーについて、採点を計算しました。一般公開はまだされません。</p><table><thead><tr><th>順位</th><th>得点</th></tr></thead><tbody>{(result.scores||[]).map((r,i)=><tr key={r.user_id}><td>{r.place}位 — {r.username||r.user_id}</td><td>{r.total_error}点</td></tr>)}</tbody></table></>,confirmText:'採点を確定する',onConfirm:()=>void saveActual('confirm')});
    } else {notify('採点を確定しました','次号の発売日時など公開条件を満たした場合にのみ、ランキングへ反映されます。');await loadData()}
  }catch(e){notify('処理できませんでした',(e as Error).message)}finally{setBusy(false)}
 };
 const orderRows=actualOrder.map((id,i)=><div className={"work-row "+(touchSorting===`actual:${i}`?"touch-sorting":"")} data-rank-group="actual" data-rank-index={i} key={id} draggable={actualMode==='drag'} onDragStart={e=>e.dataTransfer.setData('text/plain',String(i))} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();setActualOrder(x=>move(x,Number(e.dataTransfer.getData('text/plain')),i))}}><span className="rank-index">{i+1}位</span><strong className="grow">{workLookup(id)}</strong>{actualMode==='drag'&&<span className="move-controls"><button disabled={i===0} onClick={()=>setActualOrder(x=>move(x,i,i-1))} aria-label="上へ"><Icon name="up" size={15}/></button><button disabled={i===actualOrder.length-1} onClick={()=>setActualOrder(x=>move(x,i,i+1))} aria-label="下へ"><Icon name="down" size={15}/></button><button type="button" className="touch-handle" aria-label="長押しして掲載順を移動" onPointerDown={e=>touchStart(e,"actual",i)} onPointerUp={e=>touchEnd(e,"actual")} onPointerCancel={touchCancel}><Icon name="grip" size={18}/></button></span>}</div>);
 const scoring=<>
  <section className="card"><div className="card-head"><h2>実際の掲載順登録</h2><span className="tag">{actualMode==='drag'?'並び替え':'順番選択'}</span></div><label className="form-label">対象号</label><select value={selectedActualIssue} onChange={e=>{setSelectedActualIssue(e.target.value);setActualMode(defaultActual);setActualCount(0)}}>{issues.map(i=><option value={i.code} key={i.code}>{fmtIssue(i.code)}</option>)}</select><p className="meta">管理画面の「設定」から入力方式を変更できます。締切を過ぎた号だけ確定できます。</p></section>
  <section className="card"><h2>掲載順</h2>{actualMode==='drag'?orderRows:<><p className="meta">{actualCount<actualOrder.length?`${actualCount+1}位に掲載された作品を選択してください。`:'全作品を選択しました。'}</p>{actualOrder.slice(0,actualCount).map((id,i)=><div className="work-row" key={id}><span className="rank-index">{i+1}位</span>{workLookup(id)}</div>)}<div className="choice-list">{actualOrder.filter(id=>!actualOrder.slice(0,actualCount).includes(id)).map(id=><button className="choice" key={id} onClick={()=>{setActualOrder(x=>move(x,x.indexOf(id),actualCount));setActualCount(n=>n+1)}}>{workLookup(id)}<Icon name="plus" size={17}/></button>)}</div><button className="secondary full" onClick={()=>setActualCount(c=>Math.max(0,c-1))}>ひとつ戻す</button></>}
  <div className="hairline"/><p className="form-label">想定外に掲載された作品を追加</p><div className="row"><select value={newActualWork} onChange={e=>setNewActualWork(e.target.value)}><option value="">作品を選択</option>{works.filter(w=>!actualOrder.includes(w.id)).map(w=><option value={w.id} key={w.id}>{w.title}</option>)}</select><button className="secondary" disabled={!newActualWork} onClick={()=>{setActualOrder(x=>[...x,newActualWork]);setNewActualWork('')}}><Icon name="plus"/></button></div>
  <p className="form-label">突発休載作品</p><div className="choice-list">{actualFrozen.map(f=><label key={f.work_id} className="choice"><input type="checkbox" checked={suddenHiatus.includes(f.work_id)} onChange={e=>{const enabled=e.target.checked;setSuddenHiatus(x=>enabled?[...x,f.work_id]:x.filter(v=>v!==f.work_id));setActualOrder(x=>{const next=enabled?x.filter(id=>id!==f.work_id):x.includes(f.work_id)?x:[...x,f.work_id];if(enabled)setActualCount(n=>Math.min(n,next.length));return next;})}}/> {workLookup(f.work_id)}</label>)}</div>
  <div className="two-actions"><button className="secondary" disabled={busy} onClick={()=>void saveActual('draft')}>下書き保存</button><button className="primary" disabled={busy||actualMode==='sequential'&&actualCount!==actualOrder.length} onClick={()=>void saveActual('preview')}>採点プレビュー</button></div></section>
  </>;
 const dashboard=<><section className="card"><div className="card-head"><h2>現在の予想受付</h2><span className="tag accent">管理情報</span></div><div className="big-title">{activeIssue?fmtIssue(activeIssue.code):'受付中の号なし'}</div>{activeIssue&&<p>締切：{fmtDate(activeIssue.cutoff_at)}</p>}<button className="secondary compact" onClick={()=>{setTab(1);setSelectedWorkTab('issues')}}>ジャンプ号を管理 <Icon name="chevron" size={15}/></button></section><div className="two-actions"><section className="card mini-card"><p>採点待ち</p><strong className="accent-text counter">{demo?'1':'—'}</strong><button className="text-action" onClick={()=>{setTab(2);setSelectedScoreTab('score')}}>確認する</button></section><section className="card mini-card"><p>お問い合わせ</p><strong className="accent-text counter">{demo?'2':'—'}</strong><button className="text-action" onClick={()=>setTab(3)}>確認する</button></section></div><section className="card"><h2>要対応</h2>{['採点内容の確認','大会情報の管理','次号の予想受付準備'].map((x,i)=><button className="choice" key={x} onClick={()=>setTab(i===2?1:2)}>{x}<Icon name="chevron" size={17}/></button>)}</section></>;
 const adminOther=demo?<section className="card"><h2>運営メニュー</h2><p>デザイン確認用モードです。</p></section>:<AdminOperations role={user?.role||"user"}/>;
 const adminContents=[dashboard,<><div className="segmented"><button className={selectedWorkTab==='works'?'selected':''} onClick={()=>setSelectedWorkTab('works')}>作品管理</button><button className={selectedWorkTab==='issues'?'selected':''} onClick={()=>setSelectedWorkTab('issues')}>ジャンプ管理</button></div>{selectedWorkTab==='works'?workManagement:issueManagement}</>,<><div className="segmented"><button className={selectedScoreTab==='score'?'selected':''} onClick={()=>setSelectedScoreTab('score')}>採点管理</button><button className={selectedScoreTab==='tournament'?'selected':''} onClick={()=>setSelectedScoreTab('tournament')}>大会管理</button></div>{selectedScoreTab==='score'?scoring:<TournamentPage admin/>}</>,adminOther];
 const contents=side==='public'?[home,predict,ranking,tournament]:adminContents;
 const tabNames=side==='public'?publicTabs:adminTabs;
 const tabIcons=side==='public'?['home','edit','chart','trophy']:['home','book','clipboard','more'];
 const heading=page==='main'?(side==='public'?(tab===0?'ジャンプ掲載順予想':publicTabs[tab]):adminTabs[tab]):page==='settings'?'設定':page==='my'?'マイページ':page==='register'?'新規登録':page==='reset'?'パスワード再設定':'ログイン';

 function authenticate(e:FormEvent,kind:'login'|'register'|'reset'){e.preventDefault();setBusy(true);void (async()=>{try{
    if(kind==='login'){const r=await request<{user:User}>('/api/auth/login','POST',{username:credentials.username,password:credentials.password});setUser(r.user);setAppearance(r.user.theme_mode);setColor(r.user.accent_color);setDefaultPrediction(r.user.prediction_input_mode);setPredictionMode(r.user.prediction_input_mode);setDefaultActual(r.user.actual_input_mode);back()}
    if(kind==='register'){const r=await request<{user:User}>('/api/auth/register','POST',credentials);setUser(r.user);back()}
    if(kind==='reset'){await request('/api/auth/reset-password','POST',credentials);setPage('login');notify('変更しました','新しいパスワードでログインしてください。')}
  }catch(e){setFeedback((e as Error).message)}finally{setBusy(false)}})()}
 const c=(k:keyof typeof credentials,v:string|number)=>setCredentials(x=>({...x,[k]:v}));
 const authForm=page==='login'?<section className="card"><h2>ログイン</h2><form onSubmit={e=>authenticate(e,'login')} className="form-stack"><label>ユーザー名<input required value={credentials.username} autoComplete="username" onChange={e=>c('username',e.target.value)}/></label><label>パスワード<input required type="password" autoComplete="current-password" value={credentials.password} onChange={e=>c('password',e.target.value)}/></label><button className="primary full" disabled={busy}>ログイン</button></form><div className="row spread gap-top"><button className="text-action" onClick={()=>{setPage('register');void request<{questions:{id:number;question:string}[]}>('/api/auth/questions').then(r=>setSecurityQuestions(r.questions))}}>新規登録</button><button className="text-action" onClick={()=>setPage('reset')}>パスワードを忘れた</button></div></section>:page==='register'?<section className="card"><h2>ユーザー登録</h2><p className="meta">異なる秘密の質問2つを登録してください。回答はハッシュ化して保存します。</p><form className="form-stack" onSubmit={e=>authenticate(e,'register')}><label>ユーザー名<input required value={credentials.username} onChange={e=>c('username',e.target.value)} minLength={2} maxLength={40}/></label><label>パスワード（10文字以上）<input required type="password" value={credentials.password} minLength={10} maxLength={128} onChange={e=>c('password',e.target.value)}/></label>{[1,2].map(n=><div key={n}><label>秘密の質問{n}<select value={n===1?credentials.question1:credentials.question2} onChange={e=>c(n===1?'question1':'question2',Number(e.target.value))}>{securityQuestions.map(q=><option value={q.id} key={q.id}>{q.question}</option>)}</select></label><label>回答{n}<input minLength={2} required type="password" value={n===1?credentials.answer1:credentials.answer2} onChange={e=>c(n===1?'answer1':'answer2',e.target.value)}/></label></div>)}<button className="primary full" disabled={busy||securityQuestions.length<2}>登録する</button></form><button className="text-action gap-top" onClick={()=>setPage('login')}>ログインに戻る</button></section>:page==='reset'?<section className="card"><h2>秘密の質問で再設定</h2><p className="meta">2つとも正しく回答する必要があります。</p><form className="form-stack" onSubmit={e=>authenticate(e,'reset')}><label>ユーザー名<input value={credentials.username} onChange={e=>c('username',e.target.value)}/></label><button type="button" className="secondary full" onClick={()=>void request<{questions:{slot:number;id:number;question:string}[]}>('/api/auth/reset-questions?username='+encodeURIComponent(credentials.username)).then(r=>setSecurityQuestions(r.questions)).catch(e=>setFeedback(e.message))}>質問を表示する</button>{securityQuestions.map(q=><label key={q.id}>{q.question}<input type="password" required onChange={e=>{c((q as {slot?:number}).slot===2?'answer2':'answer1',e.target.value);c((q as {slot?:number}).slot===2?'question2':'question1',q.id)}}/></label>)}<label>新しいパスワード<input type="password" minLength={10} value={credentials.newPassword} onChange={e=>c('newPassword',e.target.value)}/></label><button className="primary full" disabled={busy||securityQuestions.length!==2}>パスワード変更</button></form><button className="text-action gap-top" onClick={()=>setPage('login')}>ログインに戻る</button></section>:null;

 const settingScreen=<><section className="card"><h2>外観</h2><p className="form-label">表示モード</p><div className="appearance-switch">{([['system','端末に合わせる','gear'],['light','ライト','sun'],['dark','ダーク','moon']] as const).map(([v,label,icon])=><button key={v} className={appearance===v?'chosen':''} onClick={()=>{setAppearance(v);void settingsUpdate({theme_mode:v})}}><Icon name={icon} size={19}/>{label}{appearance===v&&<Icon name="check" size={14}/>}</button>)}</div><p className="form-label">アクセントカラー</p><div className="color-grid">{(Object.keys(accentPairs) as Accent[]).map(key=><button key={key} className={'color-choice '+(color===key?'chosen':'')} onClick={()=>{setColor(key);void settingsUpdate({accent_color:key})}}><span className="swatch" style={{background:accentPairs[key][dark?'dark':'light']}}>{color===key&&<Icon name="check" size={17}/>}</span><span>{accentPairs[key].label}</span>{color===key&&<small>選択中</small>}</button>)}</div></section><section className="card"><h2>予想の入力方式</h2><p className="meta">次に新しく入力を始めるときの初期方式です。</p>{([['drag','並び替え'],['sequential','1位から順に選択']] as const).map(([key,label])=><button className="choice" key={key} onClick={()=>{setDefaultPrediction(key);void settingsUpdate({prediction_input_mode:key})}}>{label}{defaultPrediction===key&&<span className="accent-text"><Icon name="checkCircle"/></span>}</button>)}</section>{canAdmin&&<section className="card"><h2>管理者：掲載順入力方式</h2>{([['drag','並び替え'],['sequential','1位から順に選択']] as const).map(([key,label])=><button className="choice" key={key} onClick={()=>{setDefaultActual(key);void settingsUpdate({actual_input_mode:key})}}>{label}{defaultActual===key&&<span className="accent-text"><Icon name="checkCircle"/></span>}</button>)}</section>}</>;
 const accountPanel=!demo&&user?<AccountSettings onLoggedOut={()=>{setUser(null);setPage('login')}}/>:null;
 const profileMenu=<div className="popover"><strong>{user?.username||'未ログイン'}</strong><p className="eyebrow">アカウントメニュー</p><button onClick={()=>{setPage('my');setPopup(null)}}><Icon name="user"/> マイページ</button><button onClick={()=>{setPage('settings');setPopup(null)}}><Icon name="gear"/> 設定</button>{canAdmin&&<button onClick={()=>{setSide(x=>x==='public'?'admin':'public');setPage('main');setTab(0);setPopup(null);setActualMode(defaultActual)}}><Icon name="shield"/> {side==='public'?'管理画面へ切り替え':'利用者画面へ戻る'}</button>}{!demo&&<button onClick={()=>void request('/api/auth/logout','POST').then(()=>{setUser(null);setPopup(null);setPage('login')})}><Icon name="logout"/> ログアウト</button>}</div>;
 const notifications=demo?<div className="popover"><div className="row spread"><strong>通知</strong><button className="text-action" onClick={()=>setNoticeRead(true)}>すべて既読</button></div><p className="meta">{noticeRead?'未読の通知はありません。':'42号の締切が近づいています。'}</p></div>:<NotificationPanel/>;
 const getWorkIssueFields=(w:Work,kind:'period'|'oneshot')=>kind==='period'?w.periods?.[0]?.start_issue_code||'20264300':w.oneShots?.[0]||'20264300';
 const workModal=newWork&&<div className="overlay" onClick={()=>setNewWork(null)}><section className="dialog" onClick={e=>e.stopPropagation()}><div className="card-head"><h2>作品の{newWork.id?'編集':'登録'}</h2><button className="icon-button" aria-label="閉じる" onClick={()=>setNewWork(null)}><Icon name="close"/></button></div><form className="form-stack" onSubmit={saveNewWork}><label>作品名<input autoFocus value={newWork.title} required onChange={e=>setNewWork({...newWork,title:e.target.value})}/></label><label>作品種別<select value={newWork.kind} onChange={e=>setNewWork(w=>w?changeWorkKind(w,e.target.value as Work['kind']):w)}><option value="serial">連載</option><option value="oneshot">読み切り</option></select></label>{newWork.kind==='serial'?<>
 {(newWork.periods||[]).map((period,i)=><div className="period-card" key={i}>
  <div className="row spread"><strong>連載期間 {i+1}</strong>{i>0&&<button type="button" className="text-action" onClick={()=>setNewWork(w=>w?{...w,periods:w.periods?.filter((_,idx)=>idx!==i)}:w)}>期間を削除</button>}</div>
  <label>開始号<IssueCodePicker value={period.start_issue_code} onChange={v=>setNewWork(w=>w?{...w,periods:w.periods?.map((p,j)=>i===j?{...p,start_issue_code:v}:p)}:w)}/></label>
  <label className="inline-check"><input type="checkbox" checked={!period.end_issue_code} onChange={e=>setNewWork(w=>w?{...w,periods:w.periods?.map((p,j)=>i===j?{...p,end_issue_code:e.target.checked?null:p.start_issue_code}:p)}:w)}/> 連載中（終了号なし）</label>
  {period.end_issue_code&&<label>終了号<IssueCodePicker value={period.end_issue_code} onChange={v=>setNewWork(w=>w?{...w,periods:w.periods?.map((p,j)=>i===j?{...p,end_issue_code:v}:p)}:w)}/></label>}
 </div>)}
 <button type="button" className="secondary full" onClick={()=>setNewWork(w=>w?{...w,periods:[...(w.periods||[]),{start_issue_code:'20264300',end_issue_code:null}]}:w)}>連載再開期間を追加</button>
 </>:<><label>読み切り掲載号<IssueCodePicker value={getWorkIssueFields(newWork,'oneshot')} onChange={v=>setNewWork({...newWork,oneShots:[v]})}/></label></>}
 <p className="meta">作品の掲載号は、ジャンプ号マスターに未登録の号も選択できます。</p><button className="primary full" disabled={busy}>作品を保存する</button></form></section></div>;
 const issueSetupModal=issueSetup&&<div className="overlay" onClick={()=>setIssueSetup(null)}><section className="dialog" onClick={e=>e.stopPropagation()}>
  <div className="card-head"><h2>{fmtIssue(issueSetup.code)}の受付設定</h2><button className="icon-button" onClick={()=>setIssueSetup(null)} aria-label="閉じる"><Icon name="close"/></button></div>
  <p className="meta">予想対象の作品一覧、カラー、休載予定を確認してください。</p>
  {issueSetup.conflictCount>0&&<p className="status-note">作品の号情報に{issueSetup.conflictCount}件の矛盾があります。手動修正が必要です。</p>}
  <label className="form-label">巻頭カラー</label>
  <select value={issueSetup.lead} onChange={e=>setIssueSetup({...issueSetup,lead:e.target.value})}>
   <option value="">選択してください</option>
   {issueSetup.selected.map(w=><option value={w.id} key={w.id}>{w.title}</option>)}
  </select><p className="form-label">センターカラー</p>
  {issueSetup.selected.filter(w=>w.id!==issueSetup.lead).map(w=><label className="inline-check" key={w.id}><input type="checkbox" checked={issueSetup.centers.includes(w.id)} onChange={e=>setIssueSetup({...issueSetup,centers:e.target.checked?[...issueSetup.centers,w.id]:issueSetup.centers.filter(x=>x!==w.id)})}/>{w.title}</label>)}
  <p className="form-label">予定休載</p>
  {issueSetup.selected.map(w=><label className="inline-check" key={w.id}><input type="checkbox" checked={issueSetup.hiatus.includes(w.id)} onChange={e=>setIssueSetup({...issueSetup,hiatus:e.target.checked?[...issueSetup.hiatus,w.id]:issueSetup.hiatus.filter(x=>x!==w.id)})}/>{w.title}</label>)}
  <label className="inline-check confirm-check"><input type="checkbox" checked={issueSetup.confirmed} onChange={e=>setIssueSetup({...issueSetup,confirmed:e.target.checked})}/>必要情報と予定休載を確認しました</label>
  <div className="two-actions"><button className="secondary" disabled={busy} onClick={()=>void saveIssueConfiguration(false)}>設定を保存</button><button className="primary" disabled={busy||!issueSetup.confirmed||issueSetup.conflictCount>0} onClick={()=>setAlert({title:'予想受付開始の確認',content:<p>受付開始後は予想対象作品が固定されます。開始してよろしいですか？</p>,confirmText:'受付を開始',onConfirm:()=>void saveIssueConfiguration(true)})}>受付を開始</button></div>
 </section></div>;
 const editIssueModal=editingIssue&&<div className="overlay" onClick={()=>setEditingIssue(null)}><section className="dialog" onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-label="ジャンプ号の日時編集"><div className="card-head"><h2>{fmtIssue(editingIssue.code)}の日時編集</h2><button className="icon-button" aria-label="閉じる" onClick={()=>setEditingIssue(null)}><Icon name="close"/></button></div><form className="form-stack" onSubmit={e=>void editIssueDates(e)}><label>発売日時（日本時間）<input name="release" type="datetime-local" required defaultValue={new Date(Date.parse(editingIssue.release_at)+9*3600000).toISOString().slice(0,16)}/></label><label>締切日時（日本時間）<input name="cutoff" type="datetime-local" required disabled={editingIssue.status==='closed'} defaultValue={new Date(Date.parse(editingIssue.cutoff_at)+9*3600000).toISOString().slice(0,16)}/></label><p className="meta">{editingIssue.status==='planned'?'準備中：日時を修正すると受付前の確認が必要になります。':editingIssue.status==='open'?'受付中：締切は延長のみ。元の締切週の日曜日23:59:59まで変更できます。':'受付終了後は締切を変更できません。発売日時のみ修正できます。'}</p><button className="primary full" disabled={busy}>日時を保存</button></form></section></div>;
 const issueModal=newIssue&&<div className="overlay" onClick={()=>setNewIssue(false)}><section className="dialog" onClick={e=>e.stopPropagation()}><div className="card-head"><h2>ジャンプ号を登録</h2><button className="icon-button" onClick={()=>setNewIssue(false)}><Icon name="close"/></button></div><form className="form-stack" onSubmit={createIssue}><label>年度<select name="year" defaultValue={2026}>{Array.from({length:Math.max(6,new Date().getFullYear()+4-2021)},(_,i)=>2021+i).map(y=><option value={y} key={y}>{y}年</option>)}</select></label><label>号番号<select name="number" defaultValue="43-0">{issueChoices(2026).map(c=>{const z=decodeIssue(c.code);return <option value={`${z.first}-${z.combined?z.last:0}`} key={c.code}>{c.label}</option>})}</select></label><label>発売日時（日本時間で入力）<input name="release" type="datetime-local" required defaultValue="2026-10-26T00:00"/></label><label>予想締切（日本時間で入力）<input name="cutoff" type="datetime-local" required defaultValue="2026-10-22T00:00"/></label><p className="meta">まず準備中として登録します。公開・受付は別操作です。</p><button className="primary full" disabled={busy}>登録する</button></form></section></div>;
 if(checking)return <div className="boot-screen"><Icon name="clock"/> 認証状態を確認しています…</div>;
 return <div className={'app-root '+(dark?'dark':'light')} style={style}><div className="app-shell"><header className="topbar"><div className="app-brand"><strong>{heading}</strong><small>{demo?'操作できる開発プレビュー':'ジャンプ掲載順予想'}</small></div><div className="header-actions">{page!=='main'&&<button className="icon-button" aria-label="戻る" onClick={back}><Icon name="back"/></button>}<button className="icon-button" aria-label="通知" onClick={()=>setPopup(x=>x==='notifications'?null:'notifications')}><Icon name="bell"/>{!noticeRead&&demo&&<i className="notification-dot"/>}</button><button className="icon-button" aria-label="プロフィール" onClick={()=>setPopup(x=>x==='profile'?null:'profile')}><Icon name="user"/></button></div></header>{popup==='profile'&&profileMenu}{popup==='notifications'&&notifications}<main className="app-content" onClick={()=>{if(popup)setPopup(null)}}>{feedback&&<div className="error-banner"><Icon name="alert"/><span>{feedback}</span><button onClick={()=>setFeedback('')}><Icon name="close" size={15}/></button></div>}{!user&&!demo?(authForm||<><section className="card"><h2>ジャンプ掲載順予想へようこそ</h2><p className="meta">予想提出・ランキング・大会参加にはログインが必要です。</p><button className="primary full" onClick={()=>setPage('login')}>ログイン・新規登録</button></section><NewsBoard/></>):page==='settings'?<>{settingScreen}{accountPanel}</>:page==='my'?(demo?<section className="card"><h2>プレビューユーザー</h2><p className="meta">個人成績はサンプルです。</p></section>:<MyHistory username={user?.username||''}/>):page==='main'?contents[tab]:authForm}</main><nav className="bottom-nav" aria-label={side==='public'?'利用者メニュー':'管理メニュー'}>{tabNames.map((x,i)=><button className={page==='main'&&tab===i?'active':''} key={x} onClick={()=>switchTab(i)}><Icon name={tabIcons[i]}/><span>{x}</span></button>)}</nav></div>{workModal}{issueModal}{editIssueModal}{issueSetupModal}{alert&&<div className="overlay" onClick={()=>setAlert(null)}><section className="dialog" onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true"><div className="card-head"><h2>{alert.title}</h2><button className="icon-button" onClick={()=>setAlert(null)} aria-label="閉じる"><Icon name="close"/></button></div><div className="dialog-content">{alert.content}</div><div className="two-actions"><button className="secondary" onClick={()=>setAlert(null)}>閉じる</button>{alert.confirmText&&<button className="primary" onClick={()=>{const callback=alert.onConfirm;setAlert(null);callback?.()}}>{alert.confirmText}</button>}</div></section></div>}</div>;
}
