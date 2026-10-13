/** A deliberately small, plain-text Markdown subset for site announcements.
 * Never interpret raw HTML, and never pass untrusted strings to innerHTML.
 */
export type AnnouncementInline = {kind:'text'|'strong'|'link';text:string;url?:string};
export type AnnouncementBlock = {kind:'paragraph'|'heading'|'list';items:AnnouncementInline[][]};
function safeLink(raw:string):string|null{
 try{const url=new URL(raw.trim());return url.protocol==='https:'||url.protocol==='http:'?url.href:null}catch{return null}
}
export function announcementInline(source:string):AnnouncementInline[]{
 const out:AnnouncementInline[]=[],markup=/\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\n]+)\)/g;
 let index=0,match:RegExpExecArray|null;
 while((match=markup.exec(source))){
  if(match.index>index)out.push({kind:'text',text:source.slice(index,match.index)});
  if(match[1])out.push({kind:'strong',text:match[1]});
  else{const href=safeLink(match[3]);out.push(href?{kind:'link',text:match[2],url:href}:{kind:'text',text:match[0]});}
  index=markup.lastIndex;
 }
 if(index<source.length)out.push({kind:'text',text:source.slice(index)});
 return out.length?out:[{kind:'text',text:''}];
}
export function parseAnnouncement(source:string):AnnouncementBlock[]{
 const blocks:AnnouncementBlock[]=[],lines=source.replace(/\r\n?/g,'\n').split('\n');
 let paragraph:string[]=[],bullets:string[]=[];
 const flushParagraph=()=>{if(paragraph.length){blocks.push({kind:'paragraph',items:[announcementInline(paragraph.join('\n'))]});paragraph=[]}};
 const flushBullets=()=>{if(bullets.length){blocks.push({kind:'list',items:bullets.map(announcementInline)});bullets=[]}};
 for(const line of lines){
  if(/^\s*$/.test(line)){flushParagraph();flushBullets();continue;}
  if(/^#{1,3} /.test(line)){flushParagraph();flushBullets();blocks.push({kind:'heading',items:[announcementInline(line.replace(/^#{1,3} /,''))]});continue;}
  if(/^[-*] /.test(line)){flushParagraph();bullets.push(line.slice(2));continue;}
  flushBullets();paragraph.push(line);
 }
 flushParagraph();flushBullets();return blocks;
}
