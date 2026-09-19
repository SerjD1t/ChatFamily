import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {interfamilyHeading,bindInterfamilyMenu} from './interfamily-menu.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
for(const locale of ['ru','en'])test(`family chat menu ${locale}: actions, dismissal, focus and rights`,{skip:!JSDOM},()=>{
 const dom=new JSDOM('<body><nav></nav><button id="outside">Outside</button></body>');
 const doc=dom.window.document,root=doc.querySelector('nav'),actions=[];
 root.innerHTML=interfamilyHeading(locale,true);bindInterfamilyMenu(root,a=>actions.push(a));
 const toggle=root.querySelector('[data-interfamily-toggle]'),menu=root.querySelector('#interfamilyMenu');
 assert.equal(menu.hidden,true);assert.equal(menu.querySelectorAll('button').length,3);
 toggle.click();assert.equal(menu.hidden,false);assert.equal(toggle.getAttribute('aria-expanded'),'true');
 doc.querySelector('#outside').click();assert.equal(menu.hidden,true);
 toggle.click();doc.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(menu.hidden,true);assert.equal(doc.activeElement,toggle);
 for(const action of ['create','join','manage']){toggle.click();root.querySelector(`[data-interfamily-action="${action}"]`).click();assert.equal(menu.hidden,true)}
 assert.deepEqual(actions,['create','join','manage']);
 toggle.click();doc.querySelector('#outside').focus();assert.equal(menu.hidden,true);
 root.innerHTML=interfamilyHeading(locale,false);assert.equal(root.querySelector('button'),null);
 assert.ok(root.textContent.includes(locale==='en'?'Family chats':'Семейные чаты'));dom.window.close();
});
