import { isNative, registerNativePlugin } from "./runtime.js";

let state = null;
export async function configureNativePush({ user, locale, request, announce, openConversation }) {
  if (!isNative || state) return;
  const push = registerNativePlugin("PushNotifications"), environment = registerNativePlugin("PushEnvironment");
  const button = document.querySelector("#pushSettings");
  const t = (ru,en) => locale() === "en" ? en : ru;
  const preference = `native-push:${user.ID}`;
  state = {push,environment,request,preference,installation:null,enabled:false,stopping:false};
  const update = () => { button.textContent = state.enabled ? t("Отключить уведомления", "Disable notifications") : t("Включить уведомления", "Enable notifications"); };
  button.hidden = false; button.disabled = false; update();
  await push.addListener("pushNotificationActionPerformed", async event => {
    const data = event.notification?.data || {};
    if (data.userID !== user.ID || typeof data.conversationID !== "string") return;
    try {
      const chats = await request("/conversations");
      if (chats.some(c => c.id === data.conversationID)) {
        document.querySelectorAll("dialog[open]").forEach(d => d.close());
        await openConversation(data.conversationID);
      }
    } catch (_) { announce(t("Не удалось открыть чат из уведомления", "Could not open the conversation"), "error"); }
  });
  await push.addListener("registration", async token => {
    if (state.stopping || localStorage.getItem(preference) !== "on") return;
    try {
      const info = await environment.status(); state.installation = info.installationId;
      await request("/mobile/push/devices", {method:"POST",body:JSON.stringify({installationId:info.installationId,token:token.value})});
      if (state.stopping) {
        await request(`/mobile/push/devices/${info.installationId}`,{method:"DELETE"}); return;
      }
      state.enabled = true; update();
      announce(t("Уведомления включены", "Notifications enabled"));
    } catch (_) { state.enabled = false; update(); announce(t("Не удалось зарегистрировать уведомления. Повторите включение.", "Could not register notifications. Try enabling again."),"error"); }
  });
  await push.addListener("registrationError", () => {
    state.enabled = false; update(); announce(t("FCM недоступен. Проверьте сеть и сервисы Google Play.", "FCM unavailable. Check connectivity and Google Play services."),"error");
  });
  async function enable(interactive) {
    const [info,server] = await Promise.all([environment.status(),request("/mobile/push/config")]);
    state.installation = info.installationId;
    if (!info.configured || !server.enabled) throw Error(t("Firebase ещё не настроен в приложении или на сервере", "Firebase is not configured in the app or on the server"));
    let permission = await push.checkPermissions();
    if (interactive && permission.receive !== "granted") permission = await push.requestPermissions();
    if (permission.receive !== "granted") throw Error(t("Разрешите уведомления в настройках Android", "Allow notifications in Android settings"));
    if (!(await environment.status()).systemEnabled) throw Error(t("Уведомления приложения отключены в настройках Android", "App notifications are disabled in Android settings"));
    await push.createChannel({id:"chat_messages",name:t("Сообщения ChatFamily", "ChatFamily messages"),importance:4,visibility:0});
    state.stopping = false; localStorage.setItem(preference,"on");
    await push.register();
  }
  button.onclick = async () => {
    button.disabled = true;
    try {
      if (state.enabled) { await disableNativePush(); announce(t("Уведомления отключены", "Notifications disabled")); }
      else await enable(true);
    } catch (e) { announce(e.message,"error"); }
    finally { button.disabled = false; update(); }
  };
  if (localStorage.getItem(preference) === "on") {
    try { await enable(false); } catch (_) { update(); }
  }
}

export async function disableNativePush() {
  if (!state) return;
  state.stopping = true;
  const info = await state.environment.status();
  // Do not report a successful logout/disable until the server stops targeting this device.
  await state.request(`/mobile/push/devices/${info.installationId}`,{method:"DELETE"});
  if (info.configured) await state.push.unregister();
  await state.push.removeAllDeliveredNotifications();
  localStorage.setItem(state.preference,"off"); state.enabled = false;
}
