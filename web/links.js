// Only explicit HTTP(S) links; never interpret arbitrary HTML from messages/sites.
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const metadataCache=new Map();
export function messageLinks(text){
 const source=String(text||'');const links=[];let body='',cursor=0;
 for(const match of source.matchAll(/https?:\/\/[^\s<>"']+/gi)){
  body+=escape(source.slice(cursor,match.index));cursor=match.index+match[0].length;
  let value=match[0].replace(/[.,!?:;]+$/,'');
  for(const [open,close] of [['(',')'],['[',']'],['{','}']])while(value.endsWith(close)&&value.split(close).length>value.split(open).length)value=value.slice(0,-1);
  let url;try{url=new URL(value);}catch{body+=escape(match[0]);continue}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password){body+=escape(match[0]);continue}
  links.push(url.href);body+=`<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer" class="messageLink">${escape(value)}</a>${escape(match[0].slice(value.length))}`;
 }
 return {links:[...new Set(links)],html:body+escape(source.slice(cursor))};
}
export function linkMarkup(text){
 const result=messageLinks(String(text||'').replaceAll('\u0000',''));
 const url=result.links[0];
 const data=metadataCache.get(url);
 return {body:result.html,preview:url?`<a class="linkPreview" data-link-preview href="${escape(url)}" target="_blank" rel="noopener noreferrer"><strong>${escape(data?.title||new URL(url).hostname)}</strong><span>${escape(data?.description||url)}</span>${data?`<small>${escape(data.host)}</small>`:''}</a>`:''};
}
export function createLinkPreviews({request}){
 const cache=new Map();let running=0;const queue=[];
 async function drain(){
  if(running>=2||!queue.length)return;const job=queue.shift();running++;
  try{const data=await request('/link-preview',{method:'POST',body:JSON.stringify({url:job.url})});job.resolve(data);}catch{job.resolve(null);}finally{running--;void drain();}
 }
 return function bind(root){
  for(const node of root.querySelectorAll('[data-link-preview]')){
   const url=node.href;if(node.dataset.previewBound===url)continue;node.dataset.previewBound=url;
   if(!cache.has(url)){if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(url,new Promise(resolve=>queue.push({url,resolve})));void drain();}
   cache.get(url).then(data=>{
    if(!data||!node.isConnected||node.href!==url)return;
    if(metadataCache.size>=100)metadataCache.delete(metadataCache.keys().next().value);metadataCache.set(url,data);
    const title=document.createElement('strong'),description=document.createElement('span'),host=document.createElement('small');title.textContent=data.title||data.host;description.textContent=data.description||url;host.textContent=data.host;
    if(node.textContent===title.textContent+description.textContent+host.textContent)return;
    const bottom=root.scrollHeight-root.clientHeight-root.scrollTop<32;
    const anchor=[...root.querySelectorAll('[data-message-id]')].find(article=>article.getBoundingClientRect().bottom>root.getBoundingClientRect().top);
    const top=anchor?.getBoundingClientRect().top;
    node.replaceChildren(title,description,host);
    if(bottom)root.scrollTop=root.scrollHeight;else if(anchor)root.scrollTop+=anchor.getBoundingClientRect().top-top;
   });
  }
 };
}
