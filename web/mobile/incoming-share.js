import { isNative, registerNativePlugin } from "./runtime.js";
import { syncMarkup } from "../dom-sync.js";

let initialized = false;
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export function initIncomingShares({ user, locale, request, onSent }) {
  if (!isNative || initialized) return;
  initialized = true;
  const plugin = registerNativePlugin("IncomingShare");
  const t = (ru, en) => locale() === "en" ? en : ru;
  const userMenu = document.querySelector("#userMenuDialog");
  const button = document.createElement("button");
  button.type = "button"; button.className = "menuAction mobileInboxButton";
  document.querySelector("#myProfile").after(button);
  const dialog = document.createElement("dialog");
  dialog.className = "mobileShareDialog";
  dialog.innerHTML = `<section class="dialogSurface"><header class="shareHeader"><h2></h2><button class="shareClose" type="button">×</button></header><p class="shareHelp muted"></p><div class="shareQueue"></div><form class="shareForm" hidden><label class="shareRecipientLabel"><span></span><input class="shareRecipientSearch" type="search" autocomplete="off"></label><div class="shareRecipientResults"></div><p class="shareRecipientSelected" role="status"></p><label class="shareCaptionLabel"><span></span><textarea class="shareCaption" maxlength="4000" rows="2"></textarea></label><div class="actions"><button class="shareSubmit" disabled></button></div></form><p class="shareError error" role="alert"></p><button class="shareHistoryLink" type="button"></button></section>`;
  const history = document.createElement("dialog");
  history.className = "mobileShareDialog shareHistoryDialog";
  history.innerHTML = `<section class="dialogSurface"><header class="shareHeader"><h2></h2><button class="shareClose" type="button">×</button></header><p class="muted shareHelp"></p><div class="shareHistoryList"></div></section>`;
  document.body.append(dialog, history);
  const q = s => dialog.querySelector(s), error = q(".shareError"), form = q("form"), search = q(".shareRecipientSearch"), caption = q("textarea");
  let jobs = [], selected = null, recipient = null, recipients = [], loading = false, busy = false, choosing = 0;
  const seen = new Set(), acknowledged = new Set();
  const filesMarkup = j => `<ul>${j.files.map(f => `<li>${escape(f.name)} · ${(f.bytes / 1048576).toFixed(1)} ${t("МиБ", "MiB")}</li>`).join("")}</ul>`;
  const labels = () => {
    const pending = jobs.filter(j => j.state !== "sent").length;
    button.textContent = t("Входящие вложения", "Incoming attachments") + (pending ? ` (${pending})` : "");
    q("h2").textContent = t("Отправить вложения", "Send attachments");
    q(".shareHelp").textContent = t("Выберите получателя и подтвердите отправку.", "Choose a recipient and confirm sending.");
    q(".shareRecipientLabel span").textContent = t("Кому", "To");
    search.placeholder = t("Найти человека или чат", "Find a person or chat");
    q(".shareCaptionLabel span").textContent = t("Подпись или ссылка", "Caption or link");
    q(".shareSubmit").textContent = t("Отправить", "Send");
    q(".shareClose").ariaLabel = t("Закрыть", "Close");
    q(".shareHistoryLink").textContent = t("История", "History");
    history.querySelector("h2").textContent = t("История отправок", "Sent history");
    history.querySelector(".shareHelp").textContent = t("Последние 50 отправок с этого устройства.", "Last 50 shares from this device.");
    history.querySelector(".shareClose").ariaLabel = t("Назад к вложениям", "Back to attachments");
  };
  button.onclick = () => { userMenu.close(); labels(); if (!dialog.open) dialog.showModal(); void refresh(); };
  q(".shareClose").onclick = () => dialog.close();
  q(".shareHistoryLink").onclick = () => { dialog.close(); history.showModal(); void refresh(); };
  history.querySelector(".shareClose").onclick = () => { history.close(); dialog.showModal(); };
  for (const d of [dialog,history]) d.addEventListener("click", e => { if (e.target === d) d.close(); });
  document.addEventListener("click", async e => {
    const link = e.target.closest("a[href]"); if (!link) return;
    const url = new URL(link.href), match = url.pathname.match(/^\/api\/v1\/attachments\/([a-zA-Z0-9_-]+)$/);
    if (url.origin !== "https://www.chatfamily.site" || !match) return;
    e.preventDefault();
    try { await plugin.openAttachment({ id: match[1], name: link.textContent.replace(/^📎\s*/, "").trim() || "attachment" }); }
    catch (err) { error.textContent = err.message; if (!dialog.open) dialog.showModal(); }
  });
  function renderRecipients() {
    const term = search.value.trim().toLocaleLowerCase();
    const matches = recipients.filter(r => r.label.toLocaleLowerCase().includes(term));
    syncMarkup(q(".shareRecipientResults"), matches.slice(0,40).map(r => `<button type="button" class="shareRecipientOption" data-recipient="${escape(r.key)}" aria-pressed="${recipient?.key === r.key}"><span>${escape(r.label)}</span></button>`).join("") || `<p class="shareHelp">${t("Не найдено", "No matches")}</p>`);
  }
  search.oninput = renderRecipients;
  q(".shareRecipientResults").onclick = e => {
    const target = e.target.closest("[data-recipient]"); if (!target) return;
    recipient = recipients.find(r => r.key === target.dataset.recipient);
    q(".shareRecipientSelected").textContent = recipient?.label || "";
    q(".shareSubmit").disabled = !recipient;
    renderRecipients();
  };
  async function choose(id) {
    const job = jobs.find(j => j.id === id); if (!job || job.state !== "draft") return;
    const version = ++choosing;
    selected = null; recipient = null; form.hidden = true; error.textContent = "";
    try {
      const [conversations, contacts, families] = await Promise.all([request("/conversations"),request("/contacts"),request("/families")]);
      if (version !== choosing || !jobs.some(j => j.id === id && j.state === "draft")) return;
      recipients = [{key:`user:${user.ID}`,label:`${user.Name} (${t("Вы", "You")})`}];
      for (const c of conversations) {
        if (c.kind === "direct" && c.peerUserId === user.ID) continue;
        const family = families.find(f => f.id === c.familyId);
        recipients.push({key:`chat:${c.id}`,label:c.title + (family ? ` — ${family.title}` : "")});
      }
      const peers = new Set(conversations.map(c => c.peerUserId));
      for (const contact of contacts) if (contact.ID !== user.ID && !peers.has(contact.ID)) recipients.push({key:`user:${contact.ID}`,label:contact.Name});
      selected = id; caption.value = job.body || ""; search.value = "";
      q(".shareRecipientSelected").textContent = ""; q(".shareSubmit").disabled = true;
      form.hidden = false; renderRecipients();
      // Do not automatically open the keyboard or a full-screen system selector.
    } catch (e) { error.textContent = e.message; }
  }
  q(".shareQueue").onclick = async e => {
    const target = e.target.closest("button[data-id]"); if (!target || busy) return;
    const job = jobs.find(j => j.id === target.dataset.id); if (!job) return;
    error.textContent = "";
    if (target.dataset.action === "choose") { await choose(job.id); return; }
    busy = true;
    try {
      if (target.dataset.action === "discard") {
        if (job.state === "failed" && !globalThis.confirm(t("Убрать? При потере ответа сообщение могло уже отправиться. Проверьте чат перед новой отправкой.", "Remove? The message may already have been sent. Check the chat before sending again."))) return;
        await plugin.discard({id:job.id});
        if (selected === job.id) { selected = null; form.hidden = true; }
      } else {
        if (job.userId !== user.ID) throw Error(t("Войдите в исходный аккаунт", "Sign in to the original account"));
        await plugin.submit({id:job.id,userId:user.ID,conversationId:job.conversationId,body:job.body});
      }
      await refresh();
    } catch (e) { error.textContent = e.message; } finally { busy = false; }
  };
  form.onsubmit = async e => {
    e.preventDefault(); if (!selected || busy || !recipient) return;
    busy = true; q(".shareSubmit").disabled = true; error.textContent = "";
    try {
      let cid = recipient.key.slice(5);
      if (recipient.key.startsWith("user:")) cid = (await request(`/users/${encodeURIComponent(cid)}/direct-conversation`,{method:"POST"})).id;
      await plugin.submit({id:selected,userId:user.ID,conversationId:cid,body:caption.value.trim()});
      selected = null; form.hidden = true; await refresh();
    } catch (e) { error.textContent = e.message; }
    finally { busy = false; q(".shareSubmit").disabled = !recipient; }
  };
  async function refresh() {
    if (loading || document.visibilityState === "hidden") return;
    loading = true;
    try {
      const result = await plugin.list(); jobs = result.jobs.filter(j => !j.userId || j.userId === user.ID);
      labels();
      const state = j => ({draft:t("Готово к отправке", "Ready to send"),queued:t("В очереди", "Queued"),uploading:`${t("Отправка", "Uploading")} ${j.progress || 0}%`,failed:t("Не отправлено", "Failed")}[j.state] || j.state);
      syncMarkup(q(".shareQueue"), jobs.filter(j => j.state !== "sent").map(j => `<article class="shareJob" data-job="${j.id}"><strong>${escape(state(j))}</strong>${filesMarkup(j)}${j.files.length ? "" : `<p>${escape((j.body || "").slice(0,100))}</p>`}${j.error ? `<p>${escape(j.error)}</p>` : ""}<div class="actions">${j.state === "draft" ? `<button type="button" data-id="${j.id}" data-action="choose">${selected === j.id ? t("Получатель ниже", "Recipient below") : t("Кому отправить", "Choose recipient")}</button>` : ""}${j.state === "failed" ? `<button type="button" data-id="${j.id}" data-action="retry">${t("Повторить", "Retry")}</button>` : ""}${["draft","failed"].includes(j.state) ? `<button type="button" class="secondary" data-id="${j.id}" data-action="discard">${t("Отменить", "Discard")}</button>` : ""}</div></article>`).join("") || `<p class="shareHelp">${t("Нет ожидающих вложений", "No pending attachments")}</p>`);
      syncMarkup(history.querySelector(".shareHistoryList"), jobs.filter(j => j.state === "sent").sort((a,b) => (b.sentAt || b.createdAt || 0)-(a.sentAt || a.createdAt || 0)).slice(0,50).map(j => `<article class="shareJob"><strong>${t("Отправлено", "Sent")}</strong><time>${escape(new Date(j.sentAt || j.createdAt || Date.now()).toLocaleString(locale() === "en" ? "en-GB" : "ru-RU"))}</time>${filesMarkup(j)}${j.body ? `<p>${escape(j.body.slice(0,100))}</p>` : ""}</article>`).join("") || `<p>${t("История пока пуста", "No sent shares yet")}</p>`);
      for (const j of jobs) {
        if (!seen.has(j.id) && j.state === "draft" && !document.querySelector("dialog[open]")) {
          dialog.showModal(); if (!selected) void choose(j.id);
        }
        seen.add(j.id);
        if (j.state === "sent" && !acknowledged.has(j.id)) { acknowledged.add(j.id); onSent(j.conversationId); }
      }
    } catch (e) { error.textContent = e.message; }
    finally { loading = false; }
  }
  labels(); void refresh(); setInterval(refresh,2000);
}
