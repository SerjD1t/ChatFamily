import {safe, api} from './api.js';

export function attachmentKind(type='') {
 type=type.split(';')[0].trim().toLowerCase();
 if (['image/jpeg','image/png','image/gif','image/webp','image/bmp'].includes(type)) return 'image';
 if (['video/mp4','video/quicktime','video/webm','video/x-matroska','video/x-msvideo','video/mpeg','video/ogg'].includes(type)) return 'video';
 if (type==='application/pdf') return 'pdf';
 return 'file';
}
export function attachmentMarkup(files=[],locale='ru') {
 if (!files.length) return '';
 return `<div class="attachmentGrid">${files.map(file=>{
  const kind=attachmentKind(file.contentType),url=`${api}/attachments/${encodeURIComponent(file.id)}`;
  const icon=kind==='pdf'?'PDF':kind==='video'?'▶':kind==='image'?'▧':file.contentType?.startsWith('audio/')?'♫':'📄';
  const bytes=Number(file.bytes)||0,size=bytes>=1048576?`${(bytes/1048576).toFixed(1)} MB`:`${Math.ceil(bytes/1024)} KB`;
  return `<a class="attachmentCard ${kind==='file'?'attachmentFile':''}" data-id="attachment-${safe(file.id)}" href="${safe(url)}" target="_blank" rel="noopener" title="${locale==='en'?'Download':'Скачать'}: ${safe(file.filename)}"><span class="attachmentVisual"><span class="attachmentFallback" aria-hidden="true">${icon}</span>${kind==='file'?'':`<img class="attachmentThumbnail" src="${safe(url)}/preview" loading="lazy" decoding="async" alt="" width="240" height="160">`}${kind==='video'?'<span class="attachmentPlay" aria-hidden="true">▶</span>':''}</span><span class="attachmentCaption"><span>${safe(file.filename)}</span><small>${size}</small></span></a>`;
 }).join('')}</div>`;
}

// Capture errors once without inline handlers. The surrounding icon stays
// visible if a decoder cannot generate a thumbnail. DOM sync retains nodes.
export function bindAttachmentFallback(root) {
 if (root.dataset.attachmentFallbackBound) return;
 root.dataset.attachmentFallbackBound='true';
 root.addEventListener('error',event=>{
  if(event.target.matches?.('.attachmentThumbnail'))event.target.hidden=true;
 },true);
}
