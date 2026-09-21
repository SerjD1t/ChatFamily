// Synthetic browser regression: chat columns fill available space, bubbles do not.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const css=(await Promise.all(['style.css','appearance.css'].map(name=>readFile(new URL('../web/'+name,import.meta.url),'utf8')))).join('\n');
const browser=await chromium.launch({headless:true,...(process.env.TEST_CHROMIUM_PATH?{executablePath:process.env.TEST_CHROMIUM_PATH}:{})});
try {
 for(const width of [320,390,768,1440,1920,2560])for(const rootSize of [16,20])for(const sidebar of [false,true]){
  const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<768});
  await page.setContent(`<html data-skin="classic" data-theme="light"><style>${css}html{font-size:${rootSize}px}</style><body class="mobileContentOpen"><main ${sidebar?'class="layout"':''}>${sidebar?'<aside class="sidebar">Тестовая семья</aside>':''}<section class="chat"><header class="chatHead"><div class="chatHeading"><h2>Тестовый диалог</h2></div></header><div id="messages">${Array.from({length:12},(_,i)=>`<article class="message ${i%2?'own':''}"><div class="bubble"><div class="messageHeader"><button class="messageAuthor">Тестовый участник</button><small class="messageMeta"><time>12:00</time></small></div><p class="messageBody">${i%2?'Длинная строка для проверки читаемой ширины сообщения. '.repeat(8):'Короткое сообщение'}</p></div></article>`).join('')}</div><form class="composer"><textarea placeholder="Напишите сообщение"></textarea><button class="sendButton" aria-label="Отправить">→</button></form></section></main></body></html>`);
  const failures=await page.evaluate(()=>{
   const result=[],chat=document.querySelector('.chat'),style=getComputedStyle(chat),bounds=chat.getBoundingClientRect();
   const left=bounds.left+parseFloat(style.paddingLeft),right=bounds.right-parseFloat(style.paddingRight);
   for(const selector of ['.chatHead','#messages','.composer']){
    const r=document.querySelector(selector).getBoundingClientRect();
    if(Math.abs(r.left-left)>1||Math.abs(r.right-right)>1)result.push(selector+' not full width');
   }
   if(innerWidth>=1100&&(parseFloat(style.paddingLeft)>24||parseFloat(style.paddingRight)>24))result.push('oversized side padding');
   if(document.documentElement.scrollWidth>innerWidth)result.push('horizontal overflow');
   const messages=document.querySelector('#messages');
   if(messages.scrollWidth>messages.clientWidth+1)result.push('message overflow');
   for(const bubble of messages.querySelectorAll('.bubble')){
    const r=bubble.getBoundingClientRect();
    if(innerWidth>=768&&r.width>58*parseFloat(getComputedStyle(document.documentElement).fontSize)+1)result.push('unbounded bubble');
   }
   return result;
  });
  if(failures.length)throw Error(`${width}px, root ${rootSize}, sidebar ${sidebar}: ${failures.join(', ')}`);
  if(width===1920&&rootSize===16&&!sidebar&&process.env.LAYOUT_SCREENSHOT)await page.screenshot({path:process.env.LAYOUT_SCREENSHOT});
  console.log(`${width}px / root ${rootSize} / sidebar ${sidebar}: passed`);await page.close();
 }
}finally{await browser.close();}
