import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {shouldSend,initSendSettings} from './send-settings.js';
test('send shortcut defaults and newline/IME/repeat protection',()=>{
 assert.equal(shouldSend({key:'Enter'}),false);
 assert.equal(shouldSend({key:'Enter',ctrlKey:true}),true);
 assert.equal(shouldSend({key:'Enter',metaKey:true}),true);
 assert.equal(shouldSend({key:'Enter'},'enter'),true);
 assert.equal(shouldSend({key:'Enter',ctrlKey:true},'enter'),false);
 for(const mode of ['enter','ctrl_enter'])for(const extra of [{shiftKey:true},{altKey:true},{isComposing:true},{keyCode:229},{repeat:true}])assert.equal(shouldSend({key:'Enter',ctrlKey:mode==='ctrl_enter',...extra},mode),false);
});
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
for(const locale of ['ru','en'])test(`send setting persists only on success (${locale})`,{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<button></button><textarea>draft</textarea>');globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.dispatchEvent(new dom.window.Event('close'));};
 let prefs={locale,colorScheme:'dark',sendShortcut:'ctrl_enter'},fail=true,writes=0;
 try{
  const button=document.querySelector('button');initSendSettings({button,preferences:()=>prefs,request:async(path,options)=>{if(!options)return {...prefs};writes++;if(fail)throw Error('Synthetic failure');return JSON.parse(options.body);},onSaved:p=>prefs=p});
  button.click();const dialog=document.querySelector('dialog');dialog.querySelector('select').value='enter';
  await dialog.querySelector('form').onsubmit({preventDefault(){}});assert.equal(prefs.sendShortcut,'ctrl_enter');assert.match(dialog.querySelector('[role=alert]').textContent,/Synthetic/);
  fail=false;await dialog.querySelector('form').onsubmit({preventDefault(){}});assert.equal(prefs.sendShortcut,'enter');assert.equal(prefs.colorScheme,'dark');assert.equal(writes,2);assert.equal(document.querySelector('dialog'),null);assert.equal(document.querySelector('textarea').value,'draft');
 }finally{dom.window.close();delete globalThis.document;}
});
