import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.TEST_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({hasTouch:true});
 await page.route('https://dialogs.test/**',async route=>{
  const path=new URL(route.request().url()).pathname.slice(1);
  if(!path)return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="appearance.css"><a href="#" data-media-kind="image" data-media-id="test"><span class="attachmentCaption"><span>Synthetic-image.png</span></span></a>'});
  if(path.startsWith('api/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="#d9e7fa"/><circle cx="320" cy="160" r="90" fill="#245caa"/></svg>'});
  if(!['style.css','appearance.css','media-viewer.js','icons.js','api.js','mobile/runtime.js'].includes(path))return route.abort();
  await route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:await readFile(new URL(path,import.meta.url),'utf8')});
 });
 let cases=0;
 for(const width of [320,390,1280])for(const theme of ['light','dark','contrast']){
  await page.setViewportSize({width,height:844});await page.goto('https://dialogs.test/');
  await page.evaluate(async theme=>{Object.assign(document.documentElement.dataset,{skin:'classic',theme,density:'normal',textSize:'normal'});const {initMediaViewer}=await import('/media-viewer.js');initMediaViewer({});},theme);
  await page.locator('[data-media-kind]').click();
  const result=await page.evaluate(()=>{const d=document.querySelector('dialog'),buttons=[...d.querySelectorAll('header button')];return {overflow:d.scrollWidth>d.clientWidth,buttons:buttons.map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,label:b.getAttribute('aria-label'),text:b.textContent,bg:getComputedStyle(b).backgroundColor})),surface:getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()};});
  assert.equal(result.overflow,false);assert.equal(result.buttons.length,3);for(const b of result.buttons){assert.ok(b.width>=44&&b.height>=44);assert.ok(b.label);assert.equal(b.text,'');assert.equal(b.bg,result.buttons[0].bg);}
  await page.locator('[aria-pressed]').click();assert.equal(await page.locator('[aria-pressed]').getAttribute('title'),'Вписать в окно');
  await page.locator('[aria-pressed]').click();
  if(process.env.DIALOG_SCREENSHOT&&width===1280&&theme==='light')await page.screenshot({path:process.env.DIALOG_SCREENSHOT});
  await page.locator('[data-close]').click();await page.locator('dialog').waitFor({state:'detached'});
  await page.evaluate(()=>{const d=document.createElement('dialog');d.innerHTML='<button>Сохранить</button><button class="danger">Удалить</button><button aria-pressed="true">Выбрано</button>';document.body.append(d);d.showModal();});
  const colors=await page.locator('dialog button').evaluateAll(bs=>bs.map(b=>getComputedStyle(b).backgroundColor));assert.notEqual(colors[0],colors[1]);assert.notEqual(colors[0],colors[2]);cases++;
 }
 console.log(`PASS ${cases} dialog icon, touch, theme and state cases`);
}finally{await browser.close();}
