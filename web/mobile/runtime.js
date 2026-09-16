export const isNative = !!globalThis.Capacitor?.isNativePlatform?.();
// Pinned official runtime is published with the site; no CDN dependency.
export const registerNativePlugin = isNative
  ? (globalThis.Capacitor.registerPlugin || (await import("./capacitor-core.js")).registerPlugin)
  : null;
export const serverOrigin = isNative ? "https://www.chatfamily.site" : "";
export async function nativeCapabilities() {
  if (!isNative) return {bridgeVersion:0};
  try {
    const info=await registerNativePlugin("PushEnvironment").status();
    return {bridgeVersion:1,incomingShares:true,nativePush:true,...info};
  } catch (_) {
    // Original share-only APK has no PushEnvironment plugin.
    return {bridgeVersion:1,incomingShares:!!globalThis.Capacitor?.isPluginAvailable?.("IncomingShare"),nativePush:false};
  }
}
export function serverURL(value) {
  return serverOrigin && typeof value === "string" && value.startsWith("/api/") ? serverOrigin + value : value;
}
export function resolveMedia(value) {
  if (Array.isArray(value)) return value.map(resolveMedia);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      value[key] = /avatarurl$/i.test(key) ? serverURL(value[key]) : resolveMedia(value[key]);
    }
  }
  return value;
}
