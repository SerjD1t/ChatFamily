// Decimal commas are kept; other commas and line breaks separate products.
export function splitChecklist(text) {
 const value=String(text),parts=[];let start=0;
 for(let i=0;i<value.length;i++){
  if(value[i]==='\n'||value[i]==='\r'||(value[i]===','&&!(/\d/.test(value[i-1]||'')&&/\d/.test(value[i+1]||'')))){parts.push(value.slice(start,i));start=i+1;}
 }
 parts.push(value.slice(start));return parts.map(s=>s.trim()).filter(Boolean);
}

export function mountChecklist({host,item,editable,t,save}) {
 let busy=false;
 const button=(text,fn)=>{const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=text;b.onclick=fn;return b;};
 async function run(body,success){
  if(busy)return;busy=true;error.textContent='';
  host.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
  try{await save(body);success();}
  catch(e){error.textContent=e.message;}
  finally{busy=false;host.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);host.querySelectorAll('[data-readonly]').forEach(el=>el.disabled=true);}
 }
 const error=document.createElement('p');error.className='error';error.setAttribute('role','alert');
 function render(){
  host.replaceChildren();host.className='needChecklist';
  const entries=item.checklist||[];
  if(entries.length){
   const count=document.createElement('p');count.textContent=t('Куплено','Bought')+`: ${entries.filter(e=>e.completed).length}/${entries.length}`;host.append(count);
   for(const entry of entries){
    const label=document.createElement('label');label.className='needCheckRow';
    const check=document.createElement('input');check.type='checkbox';check.checked=entry.completed;
    if(item.archivedAt||item.completedAt){check.disabled=true;check.dataset.readonly='';}
    const text=document.createElement('span');text.textContent=entry.text;if(entry.completed)text.className='muted';
    check.onchange=()=>{const completed=check.checked;check.checked=entry.completed;run({checkItem:{id:entry.id,completed}},render);};
    label.append(check,text);host.append(label);
   }
   if(!item.archivedAt&&!item.completedAt&&entries.every(e=>e.completed))host.append(button(t('Всё куплено — завершить покупку','All bought — complete purchase'),()=>run({completed:true},render)));
  }
  if(editable)host.append(button(entries.length?t('Изменить чек-лист','Edit checklist'):t('Сделать чек-лист','Make checklist'),preview));
  host.append(error);
 }
 function preview(){
  const original=item.description?.trim()||item.title;
  host.replaceChildren();
  const label=document.createElement('label');label.textContent=t('Текст через запятые или с новой строки','Text separated by commas or new lines');
  const source=document.createElement('textarea');source.maxLength=4000;source.rows=3;source.value=original;label.append(source);host.append(label);
  const rows=document.createElement('div');rows.className='needCheckDraft';
  function add(entry){
   const row=document.createElement('div');row.className='needCheckRow';
   const input=document.createElement('input');input.type='text';input.maxLength=160;input.value=entry.text;input.setAttribute('aria-label',t('Пункт покупки','Purchase entry'));
   row.entry=entry;row.append(input,button(t('Убрать','Remove'),()=>row.remove()));rows.append(row);
  }
  const parse=()=>{rows.replaceChildren();for(const text of splitChecklist(source.value))add({text,completed:false});};
  host.append(button(t('Разбить текст','Split text'),parse),rows,button(t('Добавить пункт','Add entry'),()=>add({text:'',completed:false})));
  if(item.checklist?.length)item.checklist.forEach(add);else parse();
  host.append(button(t('Сохранить чек-лист','Save checklist'),()=>{
   const checklist=[...rows.children].map(row=>({...row.entry,text:row.querySelector('input').value.trim()})).filter(e=>e.text);
   if(checklist.length>100||checklist.some(e=>[...e.text].length>160)){error.textContent=t('Не более 100 пунктов, до 160 символов каждый','Up to 100 entries, 160 characters each');return;}
   if(!checklist.length){error.textContent=t('Добавьте хотя бы один пункт','Add at least one entry');return;}
   run({checklist,...(!item.checklist?.length?{checklistSource:source.value}:{})},render);
  }),button(t('Отмена','Cancel'),render),error);
 }
 render();
}
