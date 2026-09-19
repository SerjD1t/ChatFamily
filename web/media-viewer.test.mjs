import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {initMediaViewer} from './media-viewer.js';import {attachmentMarkup} from './attachments.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
for(const locale of ['ru','en'])test(`media viewer stays inside chat and releases media (${locale})`,{skip:!JSDOM},()=>{
 const dom=new JSDOM('<main></main><textarea>draft</textarea>',{url:'https://chat.example.test'});globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 let pauses=0,loads=0,external=0;dom.window.HTMLMediaElement.prototype.pause=function(){pauses++;};dom.window.HTMLMediaElement.prototype.load=function(){loads++;};
 try{
  const main=document.querySelector('main');main.innerHTML=attachmentMarkup([{id:'image',filename:'image.png',contentType:'image/png'},{id:'video',filename:'video.mp4',contentType:'video/mp4'},{id:'pdf',filename:'doc.pdf',contentType:'application/pdf'}],locale);
  const original=main.firstChild;initMediaViewer({locale:()=>locale});document.addEventListener('click',()=>external++);
  document.querySelector('[data-media-id=image]').click();let dialog=document.querySelector('dialog');assert.equal(dialog.open,true);assert.equal(external,0);assert.match(dialog.querySelector('.mediaViewport img').src,/inline=1$/);
  for(const button of dialog.querySelectorAll('header button')){assert.ok(button.querySelector('svg'));assert.ok(button.getAttribute('aria-label'));assert.equal(button.title,button.getAttribute('aria-label'));assert.equal(button.textContent,'');}
  dialog.querySelector('button[aria-pressed]').click();assert.ok(dialog.querySelector('.mediaZoom'));assert.equal(dialog.querySelector('button[aria-pressed]').getAttribute('aria-pressed'),'true');dialog.querySelector('[data-close]').click();assert.equal(document.querySelector('dialog'),null);
  document.querySelector('[data-media-id=video]').click();dialog=document.querySelector('dialog');const video=dialog.querySelector('video');assert.ok(video.controls);assert.ok(video.playsInline);assert.equal(video.autoplay,false);assert.equal(video.preload,'metadata');
  video.dispatchEvent(new dom.window.Event('error'));assert.equal(dialog.querySelector('[role=alert]').hidden,false);assert.equal(dialog.querySelector('[data-download]').tagName,'BUTTON');
  let downloadURL;dialog.addEventListener('click',e=>{if(e.target.tagName==='A'){downloadURL=e.target.getAttribute('href');e.preventDefault();}});dialog.querySelector('[data-download]').click();assert.equal(downloadURL,'/api/v1/attachments/video');assert.equal(dialog.querySelector('[data-close]').getAttribute('aria-label'),locale==='en'?'Close':'Закрыть');
  dialog.close();assert.equal(pauses,1);assert.equal(loads,1);assert.equal(video.hasAttribute('src'),false);assert.equal(main.firstChild,original);assert.equal(document.querySelector('textarea').value,'draft');
  assert.equal(document.querySelector('[data-id="attachment-pdf"]').hasAttribute('data-media-kind'),false);
 }finally{dom.window.close();delete globalThis.document;}
});
