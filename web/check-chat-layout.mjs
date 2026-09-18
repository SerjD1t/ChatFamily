// Real layout regression (jsdom cannot measure grid/flex overflow).
// TEST_PLAYWRIGHT_PATH points to an installed playwright package; no live server/data.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.TEST_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 let html=await readFile(new URL('./index.html',import.meta.url),'utf8');
 html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,'');
 await page.setContent(html);
 for(const name of ['style.css','appearance.css'])await page.addStyleTag({content:await readFile(new URL(name,import.meta.url),'utf8')});
 await page.evaluate(()=>{
  document.querySelector('#login').hidden=true;document.querySelector('#app').hidden=false;
  document.body.classList.add('mobileContentOpen');
  const back=document.createElement('button');back.className='mobileBack secondary';back.textContent='‹ Назад';document.querySelector('.chatHead').prepend(back);
  document.querySelector('#chatTitle').textContent='Очень длинное название тестовой семьи';
  document.querySelector('#chatSubtitle').textContent='Тестовое семейное пространство';
  for(const id of ['searchMessages','inviteFamily','manageMembers','chatMore'])document.getElementById(id).hidden=false;
  document.querySelector('#messages').innerHTML=Array.from({length:3},(_,i)=>`<article class="message ${i?'own':''}"><div class="bubble"><button class="messageAuthor">Тестовый статус (Участник)</button><p>${i===2?'https://example.test/'+ 'long'.repeat(80):'Тестовое сообщение с несколькими словами'}</p><div class="messageReply"><strong>Автор</strong><span>${'Длинная цитата '.repeat(30)}</span></div><small class="messageMeta">11:46 <button class="receiptInfo"><span>✓✓</span><span class="receiptCount">Прочитали 100 из 100</span></button><button class="reactionAdd">+</button><button>↩</button></small></div></article>`).join('');
 });
 let cases=0;
 for(const width of [320,375,390,430,768,1280])for(const text of ['small','normal','large'])for(const density of ['compact','normal','spacious']){
  await page.setViewportSize({width,height:900});
  await page.evaluate(({text,density})=>{document.documentElement.dataset.textSize=text;document.documentElement.dataset.density=density;},{text,density});
  const overflow=await page.evaluate(()=>{
   const chat=document.querySelector('.chat').getBoundingClientRect();
   return [...document.querySelectorAll('.chatHead,.chatActions,#messages,.message,.bubble,.messageMeta,.receiptInfo,.composer,#body,#sendButton,.chatHead button')].filter(el=>el.getClientRects().length).flatMap(el=>{
    const r=el.getBoundingClientRect(), ellipsis=getComputedStyle(el).textOverflow==='ellipsis';return r.right>chat.right+1||r.left<chat.left-1||(!ellipsis&&el.scrollWidth>el.clientWidth+1)?[{element:el.id||el.className,left:r.left,right:r.right,client:el.clientWidth,scroll:el.scrollWidth}]:[];
   });
  });
  assert.deepEqual(overflow,[],`${width}px / ${text} / ${density}`);cases++;
 }
 console.log(`PASS ${cases} real-browser chat layout cases`);
 if(process.env.LAYOUT_SCREENSHOT){
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{document.documentElement.dataset.textSize='large';document.documentElement.dataset.density='normal';document.documentElement.dataset.theme='dark';});
  await page.screenshot({path:process.env.LAYOUT_SCREENSHOT});
 }
}finally{await browser.close();}
