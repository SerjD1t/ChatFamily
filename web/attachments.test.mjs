import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {attachmentKind,attachmentMarkup,bindAttachmentFallback} from './attachments.js';
import {syncMarkup} from './dom-sync.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
test('thumbnail types exclude active content and unsupported documents',()=>{
 assert.equal(attachmentKind('image/jpeg'),'image');assert.equal(attachmentKind('video/mp4'),'video');assert.equal(attachmentKind('application/pdf'),'pdf');
 assert.equal(attachmentKind('image/svg+xml'),'file');assert.equal(attachmentKind('text/html'),'file');
 assert.equal(attachmentKind('application/msword'),'file');
});
test('thumbnail cards preserve image nodes and failed fallback during refresh',{skip:!JSDOM},()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 try{
  const root=document.querySelector('main');const files=[{id:'a',filename:'"><script>bad</script>.jpg',contentType:'image/jpeg',bytes:1000},{id:'b',filename:'film.mp4',contentType:'video/mp4'},{id:'c',filename:'file.pdf',contentType:'application/pdf'},{id:'d',filename:'doc.docx',contentType:'application/msword'}];
  const html=attachmentMarkup(files);syncMarkup(root,html);bindAttachmentFallback(root);
  assert.equal(root.querySelectorAll('img').length,3);assert.equal(root.querySelector('script'),null);assert.equal(root.querySelectorAll('.attachmentPlay').length,1);
  const image=root.querySelector('img');assert.equal(image.loading||image.getAttribute('loading'),'lazy');
  image.dispatchEvent(new dom.window.Event('error'));assert.equal(image.hidden,true);
  syncMarkup(root,html);assert.equal(root.querySelector('img'),image);assert.equal(image.hidden,true);
  assert.equal(root.querySelector('a').getAttribute('href'),'/api/v1/attachments/a');
 }finally{dom.window.close();delete globalThis.document;}
});
