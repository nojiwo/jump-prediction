import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {announcementInline,parseAnnouncement} from '../src/core/announcement.ts';
test('announcement markdown supports safe headings, strong text, lists and HTTPS links',()=>{
 const blocks=parseAnnouncement('# お知らせ\n本文 **重要** です\n\n- 一つ\n- [詳しくはこちら](https://example.com/notice)');
 assert.deepEqual(blocks.map(b=>b.kind),['heading','paragraph','list']);
 assert.ok(blocks[1].items[0].some(i=>i.kind==='strong'&&i.text==='重要'));
 assert.equal(blocks[2].items[1][0].url,'https://example.com/notice');
});
test('javascript: and data: links are treated as plain text, never active HTML',()=>{
 const parts=announcementInline('[危険](javascript:alert(1)) [危険](data:text/html,test) <script>');
 assert.equal(parts.filter(p=>p.kind==='link').length,0);
 assert.ok(parts.some(p=>p.text.includes('<script>')));
});
