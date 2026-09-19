// Clipboard is accessed only after an explicit user gesture. No uploads here.
export function clipboardFiles(data) {
 const items=[...(data?.items||[])].filter(x=>x.kind==='file').map(x=>x.getAsFile()).filter(Boolean);
 return items.length?items:[...(data?.files||[])];
}
export function bindClipboard({input,button,context,available,addFiles,report,locale=()=> 'ru',clipboard=()=>navigator.clipboard}) {
 let busy=false;
 const t=(ru,en)=>locale()==='en'?en:ru;
 const fallback=()=>report(t('Не удалось получить объект из буфера. Используйте системную «Вставить», «Вложить файл» или «Поделиться».','Cannot access this clipboard object. Use system Paste, Attach file or Share.'));
 function insertText(text) {
  if(!text)return;
  const start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
  if(input.value.length-(end-start)+text.length>(input.maxLength<0?4000:input.maxLength)){report(t('Текст слишком длинный для сообщения.','The text is too long for a message.'));return;}
  input.setRangeText(text,start,end,'end');input.dispatchEvent(new input.ownerDocument.defaultView.Event('input',{bubbles:true}));
 }
 input.addEventListener('paste',event=>{
  const files=clipboardFiles(event.clipboardData);
  if(!files.length)return;
  event.preventDefault();if(!available()||busy)return;
  if(addFiles(files))insertText(event.clipboardData?.getData('text/plain')||'');
 });
 button.onclick=async()=>{
  if(busy||!available())return;
  const target=context();busy=true;button.disabled=true;
  try{
   const api=clipboard();let files=[],text='';
   if(api?.read){
    const entries=await api.read();
    if(entries.length>10){report(t('В буфере слишком много объектов: максимум 10.','Too many clipboard objects: maximum 10.'));return;}
    for(const entry of entries){
     const binary=entry.types.find(type=>type.startsWith('image/')&&type!=='image/svg+xml')||entry.types.find(type=>!type.startsWith('text/'));
     if(binary){
      const blob=await entry.getType(binary);
      if(!blob.size||blob.size>25*1024*1024||files.reduce((sum,file)=>sum+file.size,0)+blob.size>100*1024*1024){report(t('Объект пустой или превышает лимит: 25 МиБ на файл, 100 МиБ всего.','Empty object or size limit exceeded: 25 MiB per file, 100 MiB total.'));return;}
      const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/pdf':'pdf','video/mp4':'mp4'})[blob.type]||'bin';
      files.push(new File([blob],`clipboard-${Date.now()}-${files.length+1}.${ext}`,{type:blob.type}));
     }else if(entry.types.includes('text/plain'))text+=await (await entry.getType('text/plain')).text();
    }
   }else if(api?.readText)text=await api.readText();
   else {fallback();return;}
   if(target!==context()||!available())return;
   if(files.length&&!addFiles(files))return;
   if(text)insertText(text);
   if(!files.length&&!text)fallback();
   input.focus({preventScroll:true});
  }catch {if(target===context())fallback();}
  finally{busy=false;button.disabled=false;}
 };
}
