export const api='/api/v1';
export const $=selector=>document.querySelector(selector);

export async function request(path,options={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try {
    const response=await fetch(api+path,{credentials:'include',headers:{'Content-Type':'application/json'},signal:controller.signal,...options});
    if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error||'Ошибка запроса')}
    return response.status===204?null:response.json();
  } catch(error) {
    if(error.name==='AbortError')throw Error('Превышено время ожидания ответа');
    throw error;
  } finally { clearTimeout(timer) }
}

export function safe(value){const element=document.createElement('span');element.textContent=value||'';return element.innerHTML}
