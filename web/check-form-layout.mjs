// Validate real computed field sizes; iPhone focus zoom still needs device QA.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.TEST_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({hasTouch:true});
 await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><dialog class="needDialog"><div class="needDialogHead"><h3>Карточка</h3><button>×</button></div><form data-edit><fieldset><label>Название<input name="title" value="Тестовое дело"></label><label>Срок<input type="date" value="2026-09-18"></label><label>Исполнитель<select><option>Не назначен</option></select></label><label>Описание<textarea rows="3"></textarea></label></fieldset><button>Сохранить</button></form><form data-comment><label>Комментарий<textarea></textarea></label></form></dialog>');
 for(const file of ['style.css','appearance.css'])await page.addStyleTag({content:await readFile(new URL(file,import.meta.url),'utf8')});
 let cases=0;
 for(const width of [320,375,390,430,820])for(const text of ['', 'small','normal','large'])for(const density of ['compact','normal','spacious']){
  await page.setViewportSize({width,height:844});
  const result=await page.evaluate(({text,density})=>{
   if(text)document.documentElement.dataset.textSize=text;else delete document.documentElement.dataset.textSize;
   document.documentElement.dataset.density=density;
   const dialog=document.querySelector('dialog');dialog.showModal();
   const fields=[...dialog.querySelectorAll('input,select,textarea')];fields[0].focus();
   const bad=fields.filter(el=>parseFloat(getComputedStyle(el).fontSize)<16||el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,font:getComputedStyle(el).fontSize}));
   const r=dialog.getBoundingClientRect();dialog.close();return {bad,fits:r.left>=0&&r.right<=innerWidth};
  },{text,density});
  assert.deepEqual(result,{bad:[],fits:true},`${width}/${text||'unset'}/${density}`);cases++;
 }
 console.log(`PASS ${cases} touch form font/width cases`);
}finally{await browser.close();}
