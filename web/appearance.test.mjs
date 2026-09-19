import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {appearanceDefaults,normalizeAppearance,loadAppearance,saveAppearance,applyAppearance,createAppearanceSettings} from './appearance.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
const storage=()=>{const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};};

test('v1 visual preferences migrate without resetting the chosen skin or scale',()=>{
 const store=storage();store.setItem('familychat.appearance.v1.a',JSON.stringify({skin:'family',density:'compact',text:'small',mode:'dark'}));
 assert.deepEqual(loadAppearance(store,'a'),{skin:'family',density:'normal',text:'normal',mode:'dark'});
 store.setItem('familychat.appearance.v1.a',JSON.stringify({skin:'classic',density:'spacious',text:'large',mode:'light'}));
 assert.equal(loadAppearance(store,'a').density,'legacy-spacious');assert.equal(loadAppearance(store,'a').text,'legacy-large');
 saveAppearance(store,'a',appearanceDefaults);assert.deepEqual(loadAppearance(store,'a'),appearanceDefaults);
});

test('appearance range keeps agreed text sizes, spacing factors and touch safeguards',()=>{
 const css=readFileSync(new URL('./appearance.css',import.meta.url),'utf8');
 for(const [size,value] of [['small','.75rem'],['normal','.8125rem'],['large','1rem']]) {
  assert.ok(css.includes(`html[data-text-size="${size}"] { --ui-font:${value}; }`));
 }
 assert.match(css,/data-density="normal"\] \{ --density-space:\.6;/);
 assert.match(css,/data-density="compact"\] \{ --density-space:\.45;/);
 assert.match(css,/@media\(max-width:767px\),\(pointer:coarse\)/);
 assert.match(css,/min-height:44px/);
 assert.match(css,/font-size:max\(1em,16px\)/);
});

test('appearance defaults preserve previous theme and reject unknown CSS values',()=>{
 assert.deepEqual(normalizeAppearance({skin:'url(evil)',mode:'invalid',text:'200px',density:'tiny'},'dark'),{...appearanceDefaults,mode:'dark'});
 assert.deepEqual(normalizeAppearance(null,'contrast'),{...appearanceDefaults,mode:'contrast'});
 assert.deepEqual(loadAppearance({getItem(){throw Error('denied');}},'a','light'),{...appearanceDefaults,mode:'light'});
 assert.deepEqual(loadAppearance({getItem:()=>'{bad'},'a','dark'),{...appearanceDefaults,mode:'dark'});
});
test('appearance is isolated between accounts/devices and failures are reported',()=>{
 const first=storage(),second=storage();
 saveAppearance(first,'a',{skin:'classic',density:'compact',mode:'dark',text:'large'});
 assert.equal(loadAppearance(first,'a','light').skin,'classic');
 assert.equal(loadAppearance(first,'b','light').skin,'classic');assert.equal(loadAppearance(second,'a','light').skin,'classic');
 assert.throws(()=>saveAppearance({setItem(){throw Error('full');}},'a',appearanceDefaults),/full/);
});
test('appearance preview cancels on close, resets only draft, saves without replacing history',{skip:!JSDOM},()=>{
 const dom=new JSDOM('<section id="messages"><article data-message-id="one">History</article></section><dialog><form></form></dialog>');globalThis.document=dom.window.document;
 try{
  const store=storage(),form=document.querySelector('form'),dialog=document.querySelector('dialog'),article=document.querySelector('article');
  const ui=createAppearanceSettings({form,dialog,storage:store,userID:()=> 'a',preferences:()=>({locale:'ru',colorScheme:'dark'})});
  ui.applySaved();assert.equal(document.documentElement.dataset.theme,'dark');ui.prepare();
  form.querySelector('#interfaceSkin').value='family';form.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.equal(document.documentElement.dataset.skin,'family');assert.equal(loadAppearance(store,'a','dark').skin,'classic');
  dialog.dispatchEvent(new dom.window.Event('close'));assert.equal(document.documentElement.dataset.skin,'classic');
  ui.prepare();form.querySelector('#interfaceSkin').value='classic';form.querySelector('#interfaceDensity').value='compact';ui.save();ui.applySaved();
  form.querySelector('[data-appearance-reset]').click();assert.equal(document.documentElement.dataset.skin,'classic');assert.equal(loadAppearance(store,'a','dark').skin,'classic');
  form.querySelector('[data-appearance-cancel]').click();assert.equal(document.documentElement.dataset.skin,'classic');assert.equal(form.hidden,true);assert.equal(document.querySelector('article'),article);
 }finally{dom.window.close();delete globalThis.document;}
});
test('appearance keeps a visible message anchored when layout changes',{skip:!JSDOM},()=>{
 const dom=new JSDOM('<section id="messages"><article data-message-id="one">History</article></section>');globalThis.document=dom.window.document;
 try{
  const root=document.querySelector('#messages'),article=document.querySelector('article');root.scrollTop=100;
  root.getBoundingClientRect=()=>({top:0});article.getBoundingClientRect=()=>({top:document.documentElement.dataset.density==='compact'?10:30,bottom:60});
  applyAppearance({...appearanceDefaults,density:'compact'});assert.equal(root.scrollTop,80);assert.equal(document.querySelector('article'),article);
 }finally{dom.window.close();delete globalThis.document;}
});
