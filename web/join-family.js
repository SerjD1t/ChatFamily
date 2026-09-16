import { tr } from "./i18n.js";

export function initJoinFamily({ request, locale, onJoined, announce }) {
  const dialog = document.querySelector("#joinFamilyDialog");
  const form = document.querySelector("#joinFamilyForm");
  const code = document.querySelector("#joinFamilyCode");
  const error = document.querySelector("#joinFamilyError");
  const submit = form.querySelector('[type="submit"]');
  const cancel = document.querySelector("#closeJoinFamily");
  let busy = false;
  document.querySelector("#openJoinFamily").onclick = () => {
    document.querySelector("#familyMenuDialog").close();
    form.reset(); error.textContent = ""; dialog.showModal(); code.focus();
  };
  cancel.onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const token = code.value.trim();
    if (!token) { error.textContent = tr("Введите одноразовый код", locale()); code.focus(); return; }
    busy = true; submit.disabled = cancel.disabled = code.disabled = true;
    form.setAttribute("aria-busy", "true"); error.textContent = "";
    try {
      await request("/invitations/join-by-code", { method: "POST", body: JSON.stringify({ token }) });
      code.value = ""; dialog.close();
      try {
        await onJoined();
        announce(tr("Приглашение принято. Семья доступна в меню пространства.", locale()));
      } catch (_) {
        announce(tr("Приглашение принято, но список семей не обновился. Перезагрузите страницу.", locale()), "error");
      }
    } catch (_) {
      error.textContent = tr("Не удалось принять приглашение. Проверьте соединение, срок действия кода и совпадение почты приглашения с вашим аккаунтом.", locale());
    } finally {
      busy = false; submit.disabled = cancel.disabled = code.disabled = false;
      form.removeAttribute("aria-busy");
    }
  };
}
