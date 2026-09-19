import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {bindClipboard,clipboardFiles} from './clipboard.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
test('clipboard items and files fallback do not duplicate objects',()=>{
 const file={name:'synthetic.pdf'};
 assert.deepEqual(clipboardFiles({items:[{kind:'file',getAsFile:()=>file}],files:[file]}),[file]);
 assert.deepEqual(clipboardFiles({items:[],files:[file]}),[file]);
});
for(const locale of ['ru','en'])test(`clipboard gestures, errors, selection and chat isolation (${locale})`,{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<textarea maxlength="20"></textarea><button></button>');
 const input=dom.window.document.querySelector('textarea'),button=dom.window.document.querySelector('button');
 let ctx='chat1',enabled=true,accepted=true,api,files=[],errors=[];
 bindClipboard({input,button,context:()=>ctx,available:()=>enabled,addFiles:f=>{if(accepted)files.push(...f);return accepted;},report:m=>errors.push(m),locale:()=>locale,clipboard:()=>api});
 function paste(data){const e=new dom.window.Event('paste',{cancelable:true});Object.defineProperty(e,'clipboardData',{value:data});input.dispatchEvent(e);return e;}
 try{
  assert.equal(paste({items:[],getData:()=> 'text'}).defaultPrevented,false);
  input.value='abcd';input.setSelectionRange(1,3);
  const file=new dom.window.File(['abc'],'test.pdf',{type:'application/pdf'});
  assert.equal(paste({files:[file],getData:()=> 'X'}).defaultPrevented,true);
  assert.equal(files.length,1);assert.equal(input.value,'aXd');
  accepted=false;paste({files:[file],getData:()=> 'blocked'});assert.equal(files.length,1);assert.equal(input.value,'aXd');accepted=true;
  api={readText:async()=> 'hello'};input.value='';await button.onclick();assert.equal(input.value,'hello');
  api={read:async()=>{throw Error('permission');}};await button.onclick();assert.equal(errors.length,1);assert.equal(button.disabled,false);
  api={read:async()=>[{types:['text/html'],getType:async()=>{throw Error('HTML must not be read');}}]};await button.onclick();assert.equal(errors.length,2);
  let finish;api={readText:()=>new Promise(r=>{finish=r;})};const request=button.onclick();await button.onclick();ctx='chat2';finish('late');await request;assert.equal(input.value,'hello');
  enabled=false;paste({files:[file]});assert.equal(files.length,1);
 }finally{dom.window.close();}
});
test('async clipboard chooses one binary representation per item',{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<textarea></textarea><button></button>');let files=[];
 const input=dom.window.document.querySelector('textarea'),button=dom.window.document.querySelector('button');
 bindClipboard({input,button,context:()=>1,available:()=>true,addFiles:f=>{files=f;return true;},report:()=>assert.fail('unexpected error'),clipboard:()=>({read:async()=>[{types:['image/png','image/jpeg'],getType:async type=>new Blob(['synthetic'],{type})}]})});
 try{await button.onclick();assert.equal(files.length,1);assert.equal(files[0].type,'image/png');assert.match(files[0].name,/\.png$/);}finally{dom.window.close();}
});
