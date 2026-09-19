import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.TEST_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({hasTouch:true});
 await page.route('https://bridge.test/**',async route=>{
  const path=new URL(route.request().url()).pathname.slice(1);
  if(!path)return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="appearance.css">'});
  if(!['style.css','appearance.css','groups.js','interfamily.js','api.js','mobile/runtime.js'].includes(path))return route.abort();
  return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:await readFile(new URL(path,import.meta.url),'utf8')});
 });
 for(const width of [320,390,1280])for(const theme of ['light','dark','contrast']){
  await page.setViewportSize({width,height:844});await page.goto('https://bridge.test/');
  await page.evaluate(async theme=>{Object.assign(document.documentElement.dataset,{skin:'classic',theme,density:'normal',textSize:'normal'});const {initInterfamily}=await import('/interfamily.js');const request=async p=>p.includes('candidates=1')?[{ID:'r',Name:'Synthetic Representative'}]:[{id:'c',title:'Synthetic shared chat',originId:'f',originTitle:'Source',targetId:'t',targetTitle:'Target',members:['r'],version:2,state:'requested'}];await initInterfamily({request,family:()=>({id:'f',title:'Synthetic family',role:'owner'}),locale:()=> 'ru',refresh:async()=>{},confirm:async()=>false}).open()},theme);
  const check=async()=>{const s=await page.locator('dialog').last().evaluate(d=>({overflow:d.scrollWidth>d.clientWidth,width:d.getBoundingClientRect().width,screen:innerWidth}));assert.equal(s.overflow,false);assert.ok(s.width<=s.screen)};
  await check();await page.locator('[data-create]').click();await check();await page.locator('dialog').last().locator('[data-close]').click();await page.locator('[data-edit]').click();await check();
 }
 console.log('PASS 9 interfamily manager/create/approval responsive cases');
}finally{await browser.close()}
