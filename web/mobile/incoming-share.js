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
  dialog.innerHTML = `<section class="dialogSurface"><header class="shareHeader"><h2></h2><button class="shareClose" type="button">×</button></header><p class="shareHelp muted"></p><div class="shareQueue"></div><form class="shareForm" hidden><label class="shareRecipientLabel"><span></span><input class="shareRecipientSearch" type="search" autocomplete="off"></label><div class="shareRecipientResults"></div><p class="shareRecipientSelected" role="status"></p><label class="shareCaptionLabel"><span></span><textarea class="shareCaption" maxlength="4000" rows="2"></textarea></label><div class="actions"><button class="shareSubmit" disabled></button></div></form><p class="shareError error" role="alert"></p></section>`;
  document.body.append(dialog);
  const q = s => dialog.querySelector(s), error = q(".shareError"), form = q("form"), search = q(".shareRecipientSearch"), caption = q("textarea");
  let jobs = [], selected = null, recipient = null, recipients = [], loading = false, busy = false, choosing = 0;
  const seen = new Set(), acknowledged = new Set();
  const pendingNavigation = new Set();
  let haveSnapshot = false;
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
  };
  button.onclick = () => { userMenu.close(); labels(); if (!dialog.open) dialog.showModal(); void refresh(); };
  q(".shareClose").onclick = () => dialog.close();
  dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); });
  document.addEventListener("click", async e => {
    const link = e.target.closest("a[href]"); if (!link) return;
    const url = new URL(link.href), match = url.pathname.match(/^\/api\/v1\/attachments\/([a-zA-Z0-9_-]+)$/);
    if (url.origin !== "https://www.chatfamily.site" || !match) return;
    e.preventDefault();
    try { await plugin.openAttachment({ id: match[1], name: link.querySelector('.attachmentCaption > span')?.textContent || link.textContent.replace(/^📎\s*/, "").trim() || "attachment" }); }
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
        pendingNavigation.delete(job.id);
        if (selected === job.id) { selected = null; form.hidden = true; }
      } else {
        if (job.userId !== user.ID) throw Error(t("Войдите в исходный аккаунт", "Sign in to the original account"));
        pendingNavigation.add(job.id);
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
      pendingNavigation.add(selected);
      await plugin.submit({id:selected,userId:user.ID,conversationId:cid,body:caption.value.trim()});
      selected = null; form.hidden = true; dialog.close(); await refresh();
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
      for (const j of jobs) {
        // A saved draft is not a new Android Share action. Old APKs use changes
        // after the initial snapshot; new APKs provide a one-shot launch signal.
        const newlyShared=result.shareOpenRequests ? result.openId===j.id : haveSnapshot&&!seen.has(j.id);
        if (newlyShared && j.state === "draft" && !document.querySelector("dialog[open]")) {
          dialog.showModal(); if (!selected) void choose(j.id);
        }
        seen.add(j.id);
        if (["queued", "uploading"].includes(j.state)) pendingNavigation.add(j.id);
        if (j.state === "sent" && !acknowledged.has(j.id)) {
          acknowledged.add(j.id);
          const navigate = pendingNavigation.delete(j.id);
          if (navigate) {
            dialog.close();
            await onSent(j.conversationId, true);
          }
        }
      }
      haveSnapshot = true;
    } catch (e) { error.textContent = e.message; }
    finally { loading = false; }
  }
  labels(); void refresh(); setInterval(refresh,2000);
}
