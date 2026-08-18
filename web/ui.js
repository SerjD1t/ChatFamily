import { $ } from "./api.js";

export function announce(message, type = "success") {
  const feedback = $("#feedback");
  feedback.textContent = message;
  feedback.dataset.type = type;
  feedback.hidden = !message;
  clearTimeout(announce.timer);
  if (message) announce.timer = setTimeout(() => { feedback.hidden = true; }, 5000);
}

export async function withBusy(button, pendingText, operation) {
  if (!button) return operation();
  if (button.disabled) return;
  const original = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (pendingText) button.textContent = pendingText;
  try {
    return await operation();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = original;
  }
}

export function confirmAction({ title, message, confirmLabel = "Подтвердить", destructive = false }) {
  const dialog = $("#confirmDialog");
  $("#confirmTitle").textContent = title;
  $("#confirmMessage").textContent = message;
  const accept = $("#confirmAccept");
  accept.textContent = confirmLabel;
  accept.classList.toggle("danger", destructive);
  dialog.showModal();
  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.close();
      accept.onclick = null;
      $("#confirmCancel").onclick = null;
      resolve(value);
    };
    accept.onclick = () => finish(true);
    $("#confirmCancel").onclick = () => finish(false);
    dialog.oncancel = (event) => { event.preventDefault(); finish(false); };
  });
}
