/** The setup editor must persist visible settings before freezing an issue. */
export type IssueSetupForm = {
  code:string;
  lead:string;
  centers:string[];
  hiatus:string[];
  confirmed:boolean;
  conflictCount:number;
};
export type SetupRequest = (path:string,method:string,payload:unknown)=>Promise<unknown>;

export async function persistIssueSetup(request:SetupRequest,setup:IssueSetupForm,open:boolean):Promise<void>{
  if(!setup.lead)throw new Error('巻頭カラー作品を指定してください。');
  if(new Set([setup.lead,...setup.centers]).size!==setup.centers.length+1)
    throw new Error('カラー作品を重複して選択できません。');
  if(new Set(setup.hiatus).size!==setup.hiatus.length)
    throw new Error('休載作品を重複して選択できません。');
  if([setup.lead,...setup.centers].some(id=>setup.hiatus.includes(id)))
    throw new Error('予定休載作品を巻頭・センターカラーに指定することはできません。');
  if(open&&(!setup.confirmed||setup.conflictCount>0))
    throw new Error('受付開始前に予定休載・作品情報の確認を完了してください。');

  const colors=[{workId:setup.lead,color:'lead'},...setup.centers.map(workId=>({workId,color:'center'}))];
  await request('/api/admin/issue-setup','POST',{
    action:'save',code:setup.code,confirmed:setup.confirmed,
    colors,plannedHiatus:setup.hiatus
  });
  // A rejected save must prevent opening; the backend revalidates all conditions.
  if(open)await request('/api/admin/issue-setup','POST',{action:'open',code:setup.code});
}
