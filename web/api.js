import { serverOrigin, resolveMedia } from "./mobile/runtime.js";
export const api = serverOrigin + "/api/v1";
export const $ = (selector) => document.querySelector(selector);

export async function request(path, options = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(api + path, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      ...options,
    });
    if (!response.ok) {
      if(response.status===401)document.dispatchEvent(new document.defaultView.Event('session-unauthorized'));
      const body = await response.json().catch(() => ({}));
      throw Error(body.error || "Ошибка запроса");
    }
    const result=response.status === 204 ? null : resolveMedia(await response.json());
    if(options.method&&options.method!=='GET'&&/^\/families\/[^/]+\/(needs|shopping)(\/|$)/.test(path))document.dispatchEvent(new document.defaultView.Event('family-needs-updated'));
    return result;
  } catch (error) {
    if (error.name === "AbortError")
      throw Error("Превышено время ожидания ответа");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function safe(value) {
  const element = document.createElement("span");
  element.textContent = value || "";
  return element.innerHTML;
}
