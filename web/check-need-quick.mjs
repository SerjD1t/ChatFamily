import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.TEST_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 await page.route('http://quick.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1);
  if(!name)return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="appearance.css"><main></main>'});
  if(!['style.css','appearance.css','family-needs.js','format.js','dom-sync.js'].includes(name))return route.abort();
  await route.fulfill({contentType:name.endsWith('.css')?'text/css':'text/javascript',body:await readFile(new URL(name,import.meta.url),'utf8')});
 });
 let cases=0;
 for(const width of [320,390,820,1280])for(const locale of ['ru','en']){
  await page.setViewportSize({width,height:844});await page.goto('http://quick.test/');
  await page.evaluate(async locale=>{
   const {mountNeeds}=await import('/family-needs.js');
   const item={id:'test',title:'Synthetic task',kind:'task',familyId:'f',version:1};
   mountNeeds({host:document.querySelector('main'),familyID:'f',items:[item],locale,currentUserID:'me',request:async()=>({item,members:[{id:'me',name:'Synthetic member'}],activity:[],canEdit:true}),refresh:async()=>{},announce:()=>{}});
  },locale);
  await page.locator('[data-open]').click();await page.locator('[data-quick=date]').click();
  const bounds=await page.locator('.needQuickDialog').boundingBox();
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=845);
  await page.keyboard.press('Escape');await page.locator('.needQuickDialog').waitFor({state:'detached'});
  assert.equal(await page.locator('.needDialog').evaluate(el=>el.open),true);
  await page.locator('[data-quick=assignee]').click();assert.equal(await page.locator('.needQuickDialog input[type=search]').count(),0);
  await page.mouse.click(1,1);await page.locator('.needQuickDialog').waitFor({state:'detached'});
  assert.equal(await page.locator('.needDialog').evaluate(el=>el.open),true);cases++;
 }
 console.log(`PASS ${cases} quick picker layout, Escape and outside-click cases`);
}finally{await browser.close();}
