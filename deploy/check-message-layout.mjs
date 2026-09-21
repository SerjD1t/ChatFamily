// Local synthetic layout check; no production server or accounts.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {receiptButton} from '../web/receipt-details.js';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const css=await readFile(new URL('../web/style.css',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,...(process.env.TEST_CHROMIUM_PATH?{executablePath:process.env.TEST_CHROMIUM_PATH}:{})});
try {
 for(const width of [320,390,768,1440]) {
  const page=await browser.newPage({viewport:{width,height:800},hasTouch:width<600});
  await page.setContent(`<style>${css}body{display:block;padding:12px}#messages{height:auto}html{font-size:16px}</style><section id="messages">${['Батя (Сергей)','ОченьДлинноеИмяАвтораБезПробеловДляПроверкиПереноса'].map((name,i)=>`<article class="message own"><div class="bubble"><div class="messageHeader"><button class="messageAuthor">${name}</button><small class="messageMeta"><time>17:11</time><span data-status-id="${i}">${receiptButton(String(i),'read',{read:1,total:1},true)}</span></small></div><p class="messageBody">Спите?</p></div></article>`).join('')}</section>`);
  const errors=await page.evaluate(()=>{
   const failures=[];
   if(document.documentElement.scrollWidth>innerWidth)failures.push('horizontal overflow');
   for(const bubble of document.querySelectorAll('.bubble')){
    const header=bubble.querySelector('.messageHeader').getBoundingClientRect(),body=bubble.querySelector('.messageBody').getBoundingClientRect();
    if(header.bottom>body.top+1)failures.push('header overlaps body');
    const bounds=bubble.getBoundingClientRect();
    for(const node of bubble.querySelectorAll('button,time')){const r=node.getBoundingClientRect();if(r.right>bounds.right+1||r.left<bounds.left-1)failures.push('element outside bubble');}
   }
   return failures;
  });
  if(errors.length)throw new Error(`${width}px: ${errors.join(', ')}`);
  if(width===390&&process.env.LAYOUT_SCREENSHOT)await page.screenshot({path:process.env.LAYOUT_SCREENSHOT});
  console.log(`${width}px layout passed`);await page.close();
 }
}finally{await browser.close();}
