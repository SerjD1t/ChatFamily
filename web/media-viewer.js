import {api,safe} from './api.js';
import {iconMarkup} from './icons.js';
export function initMediaViewer({locale=()=> 'ru',root=document}) {
 let current=null;
 root.addEventListener('click',event=>{
  const link=event.target.closest('a[data-media-kind]');
  if(!link||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  const kind=link.dataset.mediaKind,id=link.dataset.mediaId;
  if(!['image','video'].includes(kind)||!id)return;
  event.preventDefault();event.stopImmediatePropagation();
  current?.close();
  const t=(ru,en)=>locale()==='en'?en:ru;
  const dialog=document.createElement('dialog');current=dialog;
  dialog.className='mediaViewer';dialog.setAttribute('data-no-i18n','');dialog.setAttribute('aria-label',t('Просмотр вложения','Attachment viewer'));
  const url=`${api}/attachments/${encodeURIComponent(id)}`,name=link.querySelector('.attachmentCaption > span')?.textContent||t('Вложение','Attachment');
  const iconButton=(name,label,attribute)=>`<button type="button" class="iconButton" ${attribute} title="${label}" aria-label="${label}">${iconMarkup(name)}</button>`;
  dialog.innerHTML=`<header><strong>${safe(name)}</strong><div class="mediaActions">${iconButton('download',t('Скачать','Download'),'data-download')}${iconButton('close',t('Закрыть','Close'),'data-close')}</div></header><div class="mediaViewport"></div><p class="error" role="alert" hidden>${t('Не удалось открыть файл. Формат может не поддерживаться или доступ утрачен. Можно попробовать скачать файл.','Cannot open the file. The format may be unsupported or access was revoked. You can try downloading it.')}</p>`;
  dialog.querySelector('[data-download]').onclick=()=>{const download=document.createElement('a');download.href=url;download.target='_blank';download.rel='noopener';download.textContent=name;download.hidden=true;dialog.append(download);download.click();download.remove();};
  const viewport=dialog.querySelector('.mediaViewport'),media=document.createElement(kind==='video'?'video':'img');
  if(kind==='video'){media.controls=true;media.playsInline=true;media.preload='metadata';}
  else {media.alt=name;const zoom=document.createElement('button');zoom.type='button';zoom.className='iconButton';zoom.innerHTML=iconMarkup('zoomIn');zoom.title=t('Масштаб 1:1','Actual size');zoom.setAttribute('aria-label',zoom.title);zoom.setAttribute('aria-pressed','false');dialog.querySelector('.mediaActions').insertBefore(zoom,dialog.querySelector('[data-close]'));zoom.onclick=()=>{const on=viewport.classList.toggle('mediaZoom');zoom.setAttribute('aria-pressed',String(on));zoom.innerHTML=iconMarkup(on?'zoomOut':'zoomIn');zoom.title=t(on?'Вписать в окно':'Масштаб 1:1',on?'Fit to window':'Actual size');zoom.setAttribute('aria-label',zoom.title);};}
  media.onerror=()=>{dialog.querySelector('[role=alert]').hidden=false;};
  media.src=url+'?inline=1';viewport.append(media);document.body.append(dialog);
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.onclick=e=>{if(e.target===dialog)dialog.close();};
  dialog.addEventListener('close',()=>{if(kind==='video')media.pause();media.removeAttribute('src');if(kind==='video')media.load();dialog.remove();if(current===dialog)current=null;if(link.isConnected)link.focus({preventScroll:true});},{once:true});
  dialog.showModal();
 },true); // Before the Android external-file handler; downloads remain unchanged.
}
