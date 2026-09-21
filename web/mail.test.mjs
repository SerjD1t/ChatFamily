import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {initMail} from './mail.js';
const require=createRequire(import.meta.url);const {JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom');
for(const locale of ['ru','en'])test(`mail admin hides secrets, test and recovery preserve chat (${locale})`,async()=>{
 const dom=new JSDOM('<div class="loginAlternatives"></div><label><input id="registerPassword"></label><p id="error"></p><article>Chat</article><textarea>Draft</textarea>',{url:'https://example.test/'});
 for(const name of ['document','location','history','FormData'])globalThis[name]=dom.window[name];dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))};
 const calls=[];const config={host:'smtp.example.test',port:587,tls:'starttls',username:'test',from:'noreply@example.test',enabled:false,verifyRegistration:false,passwordConfigured:true,tested:false};
 const request=async(path,options={})=>{calls.push({path,...options});if(path==='/auth/email-policy')return {enabled:true,verifyRegistration:true};if(path==='/auth/password-reset')return {accepted:true};return config;};
 try{
  const ui=initMail({request,locale:()=>locale});await new Promise(r=>setTimeout(r,0));assert.equal(document.querySelector('#registerPassword').required,false);
  const article=document.querySelector('article');await ui.openAdmin();let form=document.querySelector('dialog form');assert.equal(form.elements.password.value,'');assert.ok(form.textContent.includes('SMTP'));
  form.elements.password.value='synthetic-new-password';form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));
  assert.equal(JSON.parse(calls.find(c=>c.method==='PUT').body).password,'synthetic-new-password');assert.equal(form.elements.password.value,'');
  form.querySelector('[data-test]').click();await new Promise(r=>setTimeout(r,0));assert.ok(calls.some(c=>c.path==='/application/mail'&&c.method==='POST'));
  const testsSent=calls.filter(c=>c.path==='/application/mail'&&c.method==='POST').length;
  form.elements.host.value='changed.example.test';form.elements.host.dispatchEvent(new dom.window.Event('input',{bubbles:true}));form.querySelector('[data-test]').click();await new Promise(r=>setTimeout(r,0));assert.equal(calls.filter(c=>c.path==='/application/mail'&&c.method==='POST').length,testsSent);
  form.querySelector('[data-close]').click();document.querySelector('.loginAlternatives button').click();form=document.querySelector('dialog form');form.elements.email.value='unknown@example.test';form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));assert.ok(form.querySelector('[data-error]').textContent);
  assert.equal(document.querySelector('article'),article);assert.equal(document.querySelector('textarea').value,'Draft');
 }finally{dom.window.close();for(const name of ['document','location','history','FormData'])delete globalThis[name];}
});
