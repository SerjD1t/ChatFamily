import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createEmailRetry} from './email-retry.js';
const require=createRequire(import.meta.url),{JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom');
for(const locale of ['ru','en'])test(`manual email retry guards duplicate requests and cooldown (${locale})`,()=>{
 const dom=new JSDOM('<dialog><form><input value="synthetic@example.test"><button type="button">Close</button><button>Send</button></form></dialog>');
 try{
  let time=1000;const form=dom.window.document.querySelector('form'),button=form.querySelector('button:not([type])');
  const retry=createEmailRetry(form,{locale:()=>locale,now:()=>time});
  assert.equal(retry.begin(),true);assert.equal(retry.begin(),false);
  retry.finish(true);assert.equal(button.disabled,true);assert.match(button.textContent,/60/);
  assert.match(button.textContent,locale==='en'?/Resend email/:/Отправить письмо повторно/);
  time+=59000;assert.equal(retry.begin(),false);assert.match(button.textContent,/1 /);
  dom.window.document.querySelector('dialog').dispatchEvent(new dom.window.Event('close'));
  time+=1001;form.dispatchEvent(new dom.window.Event('focusin'));
  assert.equal(button.disabled,false);assert.equal(retry.begin(),true);
  retry.finish(false);assert.equal(button.disabled,false);assert.equal(retry.begin(),true);
  retry.finish(false);assert.equal(form.querySelector('input').value,'synthetic@example.test');
 }finally{dom.window.close();}
});
