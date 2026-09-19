import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.TEST_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 await page.route('https://actions.test/**',async route=>{
  const path=new URL(route.request().url()).pathname.slice(1);
  if(!path)return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="appearance.css"><main style="padding:12px"><article class="message own"><div class="bubble"><button class="messageAuthor">Synthetic member</button><p>Message with an attachment</p><small class="messageMeta">12:00</small></div></article></main>'});
  if(!['style.css','appearance.css','message-actions.js','icons.js','api.js','mobile/runtime.js'].includes(path))return route.abort();
  await route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:await readFile(new URL(path,import.meta.url),'utf8')});
 });
 let count=0;
 for(const width of [320,390,820,1280])for(const locale of ['ru','en']){
  await page.setViewportSize({width,height:844});await page.goto('https://actions.test/');
  await page.evaluate(async locale=>{
   Object.assign(document.documentElement.dataset,{skin:'classic',theme:'light',density:'normal',textSize:'normal'});
   const {messageActionsMarkup,initMessageActions}=await import('/message-actions.js');document.querySelector('.messageMeta').insertAdjacentHTML('beforeend',messageActionsMarkup({id:'source'},locale));
   initMessageActions({user:()=>({ID:'self',Name:'Synthetic User'}),locale:()=>locale,request:async path=>path==='/conversations'?[{id:'target',title:'Synthetic family conversation',kind:'family'}]:[]});
  },locale);
  await page.locator('[data-message-menu]').click();
  for(const selector of ['.bubble','.messageActionMenu']){const r=await page.locator(selector).boundingBox();assert.ok(r.x>=0&&r.x+r.width<=width+1,`${width} ${selector}`);}
  await page.locator('[data-forward]').click();
  await page.locator('[data-key="chat:target"]').waitFor();
  const r=await page.locator('.forwardDialog').boundingBox();assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=width+1&&r.y+r.height<=845);
  assert.equal(await page.locator('[data-send]').isDisabled(),true);await page.locator('[data-key="chat:target"]').click();assert.equal(await page.locator('[data-send]').isEnabled(),true);
  if(process.env.ACTIONS_SCREENSHOT&&width===390&&locale==='ru')await page.screenshot({path:process.env.ACTIONS_SCREENSHOT});
  await page.keyboard.press('Escape');await page.locator('.forwardDialog').waitFor({state:'detached'});count++;
 }
 console.log(`PASS ${count} message menu and forwarding picker layouts`);
}finally{await browser.close();}
