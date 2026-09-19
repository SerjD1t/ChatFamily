import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.TEST_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({hasTouch:true});
 await page.route('https://groups.test/**',async route=>{
  const path=new URL(route.request().url()).pathname.slice(1);
  if(!path)return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="appearance.css">'});
  if(!['style.css','appearance.css','groups.js','api.js','mobile/runtime.js'].includes(path))return route.abort();
  await route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:await readFile(new URL(path,import.meta.url),'utf8')});
 });
 let cases=0;
 for(const width of [320,390,1280])for(const theme of ['light','dark','contrast']){
  await page.setViewportSize({width,height:844});await page.goto('https://groups.test/');
  await page.evaluate(async theme=>{
   Object.assign(document.documentElement.dataset,{skin:'classic',theme,density:'normal',textSize:'normal'});
   const {initGroups}=await import('/groups.js');
   const c={id:'g',title:'Synthetic group',groupRole:'owner',canInvite:true};
   const request=async path=>path==='/conversations'?[c]:path.endsWith('/members')?[{ID:'o',Name:'Owner',groupRole:'owner'},{ID:'m',Name:'Member',groupRole:'member'}]:[{ID:'x',Name:'Outside user'}];
   await initGroups({request,locale:()=> 'ru',refresh:async()=>{},announce:()=>{},confirm:async()=>false}).open(c);
  },theme);
  const check=async()=>{const state=await page.locator('dialog').last().evaluate(d=>({overflow:d.scrollWidth>d.clientWidth,width:d.getBoundingClientRect().width,screen:innerWidth}));assert.equal(state.overflow,false);assert.ok(state.width<=state.screen);};
  await check();await page.locator('[data-edit="m"]').click();await check();cases++;
 }
 console.log(`PASS ${cases} group dialogs, mobile widths and palettes`);
}finally{await browser.close()}
