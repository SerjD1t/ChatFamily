import { api, $, request, safe } from "./api.js";
import { bindClipboard } from "./clipboard.js";
import { initMediaViewer } from "./media-viewer.js";
import { initMessageActions, messageActionsMarkup } from "./message-actions.js";
import { initGroups, classifyGroups, managesGroup } from './groups.js';
import { initInterfamily } from './interfamily.js';
import { initSendSettings, shouldSend } from "./send-settings.js";
const attachmentDrafts = new Map();
let attachmentConversation = null;
import { initJoinFamily } from "./join-family.js";
import { initUserLifecycle } from "./user-lifecycle.js";
import { mountDirectory, personalChatOrder } from "./directory.js";
let refreshPersonalDirectory = null;
import { isNative, nativeCapabilities, serverOrigin, serverURL } from "./mobile/runtime.js";
import { initIncomingShares } from "./mobile/incoming-share.js";
import { initDeviceStorage } from "./mobile/device-storage.js";
import { initAppUpdate } from "./mobile/app-update.js";
import { initAutomations } from "./automations.js";
import { configureNativePush, disableNativePush } from "./mobile/push.js";
import { syncMarkup } from "./dom-sync.js";
import { mountNeeds } from "./family-needs.js";
import { initStorageAdmin } from "./storage-admin.js";
import { initBackupAdmin } from "./backup-admin.js";
import { initApplicationFamilies } from "./application-families.js";
import { attachmentMarkup, bindAttachmentFallback } from "./attachments.js";
import { createReceipts } from "./receipts.js";
import { createAppearanceSettings } from "./appearance.js";
import { createReceiptDetails, receiptButton } from "./receipt-details.js";
import { activeFamily, canManageFamily, summarizeShopping } from "./family-context.js";
import { announce, confirmAction, withBusy } from "./ui.js";
import { firstLine, formatConversationTime, formatDayLabel, formatMessageTime, formatShoppingDate, groupMessageEntries, initials, splitReplyBody, todayISO } from "./format.js";
import { applyTranslations, observeTranslations, tr } from "./i18n.js";
const personalID = "__personal__",
  groupsID = "__groups__",
  childrenID = "__children__",
  grandparentsID = "__grandparents__",
  shoppingID = "__shopping__";
let conversations = [],
  favoriteIDs = new Set(),
  active = null,
  loadVersion = 0,
  currentUser = null,
  pendingFiles = [],
  reactionTarget = null,
  families = [],
  activeFamilyID = "";
let editingApplicationUser = null;
let displayedConversation = null, displayedMessages = new Map(), olderCursor = "";
const reactionRequests = new Map(), reactionWrites = new Set();
let messageSyncTimer = null, messageSyncRunning = false, messageSyncAgain = false;
const receipts = createReceipts({
  request,
  root: () => currentUser && active === displayedConversation ? $("#messages") : null,
  userID: () => currentUser?.ID,
  onRead: () => { void loadConversations().catch(() => {}); },
});
let statusRunning = false, statusAgain = false;
const receiptDetails = createReceiptDetails({request,locale:()=>userPreferences.locale});
async function refreshStatuses() {
  if (statusRunning) { statusAgain = true; return; }
  statusRunning = true;
  try {
    do {
      statusAgain = false;
      const cid = active;
      if (!currentUser || displayedConversation !== cid) break;
      const ids = [...displayedMessages.values()].filter(m => m.authorId === currentUser.ID).map(m => m.id);
      for (let offset = 0; offset < ids.length; offset += 100) {
        const statuses = await request("/message-statuses?details=1", { method: "POST", body: JSON.stringify({ messageIds: ids.slice(offset, offset + 100) }) });
        if (active !== cid || displayedConversation !== cid) { statusAgain = true; break; }
        for (const [id, info] of Object.entries(statuses)) {
          const status = typeof info === 'string' ? info : info.status;
          const cached = displayedMessages.get(id);
          if (cached) { cached.status = status; if(typeof info === 'object') cached.receiptSummary=info; }
          const slot = document.querySelector('[data-status-id="' + CSS.escape(id) + '"]');
          if (slot) syncMarkup(slot, messageStatus(status,id));
        }
      }
    } while (statusAgain);
    void receiptDetails.refresh();
  } catch (_) { /* Reconciled on the next event/reconnect. */ }
  finally { statusRunning = false; }
}
window.setInterval(() => {
  if (!currentUser) return;
  void receipts.deliver();
  if (document.visibilityState === "visible") void refreshStatuses();
}, 30000);
function scheduleMessageSync(id) {
  if (id !== active) return;
  if (messageSyncRunning) { messageSyncAgain = true; return; }
  clearTimeout(messageSyncTimer);
  messageSyncTimer = setTimeout(async () => {
    if (id !== active) return;
    messageSyncRunning = true;
    try { await openConversation(id, "", false); }
    finally {
      messageSyncRunning = false;
      if (messageSyncAgain) { messageSyncAgain = false; scheduleMessageSync(active); }
    }
  }, 100);
}
async function refreshReactions(messageID) {
  const target = document.querySelector(`[data-reactions-id="${CSS.escape(messageID)}"]`);
  if (!target) return;
  // Serialize refreshes so an older response cannot overwrite newer counts.
  if (reactionRequests.has(messageID)) { reactionRequests.get(messageID).dirty = true; return; }
  const state = { dirty: false };
  reactionRequests.set(messageID, state);
  try {
    do {
      state.dirty = false;
      const reactions = await request(`/messages/${encodeURIComponent(messageID)}/reactions`);
      if (target.isConnected) {
        const template = document.createElement("template");
        template.innerHTML = reactionButtons({ id: messageID, reactions });
        syncMarkup(target, template.content.firstElementChild.innerHTML);
        const cached = displayedMessages.get(messageID);
        if (cached) cached.reactions = reactions;
      }
    } while (state.dirty && target.isConnected);
  } finally { reactionRequests.delete(messageID); }
}
async function toggleMessageReaction(messageID, emoji) {
  if (reactionWrites.has(messageID)) return;
  reactionWrites.add(messageID);
  try {
    await request(`/messages/${encodeURIComponent(messageID)}/reactions`, { method: "POST", body: JSON.stringify({ emoji }) });
    await refreshReactions(messageID);
  } catch (error) { announce(error.message, "error"); }
  finally { reactionWrites.delete(messageID); }
}
let editingShoppingDateID = null;
let familyMemberDrafts = new Map(), editingFamilyMember = null, familyMemberSaving = false, familyManagerIsOwner = false, familyManagerCanEditCategories = false;
let userPreferences = { locale: "ru", colorScheme: "system" };
let shoppingCounter = { plannedToday: 0, total: 0 };
const familyCategoryDefinitions = [
  ["child", "Ребёнок"],
  ["parent", "Родитель"],
  ["grandparent", "Бабушка / дедушка"],
  ["guardian", "Опекун"],
  ["relative", "Родственник"],
];
const familySections = [
  [childrenID, "children", "child", "👶"],
  [grandparentsID, "grandparents", "grandparent", "👵"],
  [shoppingID, "shopping", "shopping", "🛒"],
];
let minPasswordLength = 12;
const navigationLabels = { personal: "Личные", family: "Семья", familyChat: "Семейный чат", children: "Дети", grandparents: "Бабушки и дедушки", shopping: "Дела и покупки", chats: "Семейные чаты", allChats: "Все группы" };
function t(key) { return tr(navigationLabels[key] || key, userPreferences.locale); }
function applyPasswordPolicy(policy) {
  minPasswordLength = policy.minPasswordLength || 12;
  for (const selector of ["#registerPassword", "#invitePassword", "#invitePasswordRepeat", "#newPassword", "#newPasswordRepeat"])
    $(selector).minLength = minPasswordLength;
}
function applyInterfacePreferences() {
  $("#body").setAttribute('aria-keyshortcuts',userPreferences.sendShortcut==='enter'?'Enter':'Control+Enter Meta+Enter');
  document.documentElement.lang = userPreferences.locale || "ru";
  appearance.applySaved();
  mobileBackButton.textContent = `‹ ${tr("Назад", userPreferences.locale || "ru")}`;
  applyTranslations(userPreferences.locale || "ru");
}
async function loadPasswordPolicy() {
  try { applyPasswordPolicy(await request("/password-policy")); } catch (_) {}
}
function authorHue(name) {
  let value = 0;
  for (const char of name) value = (value * 31 + char.charCodeAt(0)) % 360;
  return value;
}
const activeConversationKey = "familychat.activeConversation";
const activeFamilyKey = "familychat.activeFamily";
function saveActive(id) { if (id) localStorage.setItem(activeConversationKey, id); }
const mobileBackButton = document.createElement("button");
mobileBackButton.type = "button";
mobileBackButton.className = "secondary mobileBack";
mobileBackButton.textContent = "‹ Назад";
mobileBackButton.hidden = true;
document.querySelector(".chatHead")?.prepend(mobileBackButton);
function openMobileContent() {
  // Shared section visibility applies on desktop too, including accounts without a family.
  $("#onboarding").hidden = true;
  $("#messages").hidden = false;
  if (!matchMedia("(max-width: 767px)").matches) return;
  document.body.classList.add("mobileContentOpen");
  mobileBackButton.hidden = false;
}
function closeMobileContent() {
  document.body.classList.remove("mobileContentOpen");
  mobileBackButton.hidden = true;
}
mobileBackButton.onclick = closeMobileContent;
function resetChatActions() {
  if($('#familyChatIcon'))$('#familyChatIcon').hidden=true;
  for (const selector of ["#searchMessages", "#renameConversation", "#inviteFamily", "#toggleFavorite", "#manageMembers", "#deleteGroup", "#chatMore"])
    $(selector).hidden = true;
  $("#chatMoreMenu").hidden = true;
}
function directChats() {
  return conversations.filter((c) => c.kind === "direct");
}
function loadingMarkup() {
  return '<div class="loadingState" aria-label="Загрузка"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
}
function avatarMarkup(title, icon = "") {
  return icon ? `<span class="conversationIcon" aria-hidden="true">${safe(icon)}</span>` : `<span class="conversationAvatar" aria-hidden="true">${safe(initials(title))}</span>`;
}
function renderConversations() {
  const label=(ru,en)=>userPreferences.locale==='en'?en:ru;
  const buckets=classifyGroups(conversations,activeFamilyID),family=conversations.find(c=>c.kind==='family'&&c.familyId===activeFamilyID);
  const filter=$("#conversationFilter")?.value.trim().toLocaleLowerCase()||"";
  const button=(c,fallback='')=>`<button class="conversation ${active===c.id?'selected':''}" data-id="${safe(c.id)}">
    ${avatarMarkup(c.title,c.icon||fallback)}<span class="conversationContent"><span class="conversationTitle">${favoriteIDs.has(c.id)?'<span aria-hidden="true">★ </span>':''}${safe(c.title)}</span>
    ${c.lastMessage?`<span class="conversationPreview">${safe(c.lastMessage)}</span>`:''}</span><span class="conversationMeta">
    ${c.lastMessageAt?`<span class="conversationTime">${safe(formatConversationTime(c.lastMessageAt,userPreferences.locale))}</span>`:''}
    ${c.unreadCount?`<b class="unread" aria-label="${label('Непрочитанные сообщения','Unread messages')}">${c.unreadCount}</b>`:''}</span></button>`;
  const list=items=>[...items].filter(c=>!filter||c.title.toLocaleLowerCase().includes(filter)).sort((a,b)=>Number(favoriteIDs.has(b.id))-Number(favoriteIDs.has(a.id))).map(c=>button(c,'💬')).join('');
  const html=button({id:personalID,title:t('personal'),unreadCount:directChats().reduce((n,c)=>n+(c.unreadCount||0),0)},'👤')+
    button({id:shoppingID,title:t('shopping'),lastMessage:`${activeFamilyID?label('Личные и семья','Personal + family'):label('Личные','Personal')} · ${label('Сегодня','Today')}: ${shoppingCounter.plannedToday} · ${label('Просрочено','Overdue')}: ${shoppingCounter.overdue||0}`},'🛒')+
    `<p class="navSectionTitle">${label('Семья','Family')}</p>`+(family?button({...family,title:activeFamily(families,activeFamilyID)?.title||family.title},'🏠'):'')+list(buckets.family)+
    `<p class="navSectionTitle">${label('Семейные чаты','Family chats')}</p>`+
    list(conversations.filter(c=>c.kind==='interfamily'&&c.familyIds?.includes(activeFamilyID)))+
    (canManageFamily(families,activeFamilyID)?`<button type="button" class="secondary" data-interfamily>${label('Управление семейными чатами','Manage family chats')}</button>`:'')+
    `<p class="navSectionTitle">${label('Группы','Groups')}</p>`+list(buckets.other);
  syncMarkup($("#conversations"),html);
  $("#conversations").onclick=e=>{if(e.target.closest('[data-interfamily]')){interfamilyUI.open();return;}const button=e.target.closest('[data-id]');if(button)openConversation(button.dataset.id);};
}
$("#conversationFilter").oninput = renderConversations;
async function loadConversations(navigateIfEmpty = true) {
  const familyID = activeFamilyID;
  const [list, favorites, shoppingItems] = await Promise.all([
    request("/conversations"),
    request("/favorites"),
    Promise.all([request('/me/needs'), ...(familyID ? [request(`/families/${encodeURIComponent(familyID)}/needs`)] : [])]).then(parts=>parts.flat()).catch(() => []),
  ]);
  if (familyID !== activeFamilyID) return;
  conversations = list;
  if (active === personalID) refreshPersonalDirectory?.();
  favoriteIDs = new Set(favorites);
  shoppingCounter = summarizeShopping(shoppingItems);
  renderConversations();
  if (!active && navigateIfEmpty) {
    const saved = localStorage.getItem(activeConversationKey);
    if (saved === shoppingID || saved === personalID || saved === groupsID || conversations.some((c) => c.id === saved)) openConversation(saved);
    else { const family = conversations.find((c) => c.kind === "family" && c.familyId === activeFamilyID); if (family) openConversation(family.id); }
  }
}
function messageStatus(status,id) {
  if(id) return receiptButton(id,status,displayedMessages.get(id)?.receiptSummary,conversations.find(c=>c.id===active)?.kind!=='direct',userPreferences.locale);
  const label = tr({ sent: "Отправлено", delivered: "Получено", read: "Прочитано" }[status] || "", userPreferences.locale);
  return {
    sent: `<span class="messageStatus sent" title="${safe(label)}" aria-label="${safe(label)}">✓</span>`,
    delivered: `<span class="messageStatus delivered" title="${safe(label)}" aria-label="${safe(label)}">✓✓</span>`,
    read: `<span class="messageStatus read" title="${safe(label)}" aria-label="${safe(label)}">✓✓</span>`,
  }[status] || "";
}function reactionButtons(message) {
  const reactions = (message.reactions || [])
    .map(
      (r) =>
        `<button class="reaction ${r.reacted ? "reacted" : ""}" data-message="${message.id}" data-emoji="${safe(r.emoji)}">${safe(r.emoji)} ${r.count}</button>`,
    )
    .join("");
  return `<div class="reactions" data-reactions-id="${safe(message.id)}">${reactions}</div>`;
}
function contactMarkup({ id, name, subtitle = "", preview = "", time = "", unread = 0, self = false, group = false }) {
  return `<button class="personalContact" ${group ? `data-group-id="${safe(id)}"` : `data-user-id="${safe(id)}"`}><span class="conversationAvatar" aria-hidden="true">${safe(initials(name))}</span><span class="personalContactContent"><span class="personalContactTitle">${safe(name)}${self ? ` <span class="selfBadge">${tr("Вы", userPreferences.locale)}</span>` : ""}</span><span class="personalContactPreview">${safe(preview || subtitle)}</span></span><span class="contactMeta">${time ? `<span>${safe(time)}</span>` : ""}${unread ? `<b class="unread">${unread}</b>` : ""}</span></button>`;
}
function reactionAddButton(message) {
  return messageActionsMarkup(message,userPreferences.locale);
}
function messageBodyMarkup(message) {
  if (message.deletedAt) return `<p class="messageBody">${tr("Сообщение удалено", userPreferences.locale)}</p>`;
  const { reply, body } = splitReplyBody(message.body);
  return `${message.forwarded ? `<div class="forwardLabel" data-no-i18n>↪ ${userPreferences.locale==='en'?'Forwarded message':'Пересланное сообщение'}</div>` : ''}${reply ? `<blockquote class="messageReply" data-no-i18n><strong>${safe(reply.author)}</strong><span>${safe(reply.text)}</span></blockquote>` : ""}<p class="messageBody">${safe(body)}</p>`;
}
function openUserCard(userID, name, avatarURL) {
  $("#profileName").textContent = name || "Пользователь";
  $("#profileDetails").textContent = userID === currentUser?.ID ? "Это ваш профиль" : "Участник семейного чата";
  const image = $("#profileAvatar");
  image.src = avatarURL || "/icon-1254.png";
  image.alt = `Фото: ${name || "пользователь"}`;
  $("#changeAvatar").hidden = userID !== currentUser?.ID;
  $("#openEditNames").hidden = userID !== currentUser?.ID;
  $("#openInterfaceSettings").hidden = userID !== currentUser?.ID;
  $("#openAutomations").hidden = userID !== currentUser?.ID;
  $("#openSendSettings").hidden = userID !== currentUser?.ID;
  $("#openSendSettings").textContent = userPreferences.locale==='en'?'Messages':'Сообщения';
  $("#openAutomations").textContent = userPreferences.locale==='en'?'Automation':'Автоматизация';
  $("#interfaceSettingsForm").hidden = true;
  $("#interfaceLocale").value = userPreferences.locale || "ru";
  $("#interfaceColorScheme").value = userPreferences.colorScheme || "system";
  $("#interfaceSettingsError").textContent = "";
  $("#openPasswordForm").hidden = userID !== currentUser?.ID;
  $("#passwordForm").hidden = true;
  $("#passwordForm").reset();
  $("#passwordError").textContent = "";
  $("#profileDialog").showModal();
}async function handleMessages(event) {
  const info=event.target.closest('[data-receipt-info]');
  if(info){receiptDetails.open(info.dataset.receiptInfo,info);return;}
  const older = event.target.closest("[data-load-older]");
  if (older) { openConversation(active, older.dataset.loadOlder); return; }
  const author = event.target.closest("[data-user-name]");
  if (author) { openUserCard(author.dataset.userId, author.dataset.userName, author.dataset.avatarUrl); return; }
  await handleReaction(event);
}
async function handleReaction(event) {
  const button = event.target.closest("[data-message]");
  if (!button) return;
  if (button.dataset.addReaction) {
    reactionTarget = button.dataset.message;
    $("#reactionPicker").hidden = !$("#reactionPicker").hidden;
    return;
  }
  await toggleMessageReaction(button.dataset.message, button.dataset.emoji);
}
async function openPersonal() {
  openMobileContent();
  const version = ++loadVersion;
  active = personalID;
  saveActive(active);
  renderConversations();
  $("#chatTitle").textContent = "Личные";
  $("#chatSubtitle").textContent = "Глобальные диалоги";
  $("#composer").hidden = true;
  resetChatActions();
  $("#messages").innerHTML = loadingMarkup();
  try {
    const contacts = await request(`/contacts?familyId=${encodeURIComponent(activeFamilyID)}`);
    if (version !== loadVersion || active !== personalID) return;
    $("#messages").innerHTML = '<div id="personalDirectory" class="personalList"></div>';
    refreshPersonalDirectory = mountDirectory({list:$("#personalDirectory"),users:contacts,locale:()=>userPreferences.locale,order:items=>personalChatOrder(items,directChats(),userPreferences.locale),render:(u) => {
            const chat = directChats().find((c) => c.peerUserId === u.ID),
              unread = chat?.unreadCount || 0,
              isSelf = u.ID === currentUser.ID;
            return contactMarkup({ id: u.ID, name: u.Name, self: isSelf, subtitle: u.familyRelationship || "Неопределено", preview: chat?.lastMessage, time: formatConversationTime(chat?.lastMessageAt, userPreferences.locale), unread });
          }});
    $("#messages").onclick = (e) => {
      const item = e.target.closest("[data-user-id]");
      if (item) startDirect(item.dataset.userId);
    };
  } catch (e) {
    if (version === loadVersion)
      $("#messages").innerHTML = `<p class="error">${safe(e.message)}</p>`;
  }
}
async function openGroups(navigate = true) {
  if (navigate) openMobileContent();
  const version = ++loadVersion;
  active = groupsID;
  saveActive(active);
  renderConversations();
  $("#chatTitle").textContent = "Все группы";
  $("#chatSubtitle").textContent = activeFamily(families, activeFamilyID)?.title || "";
  $("#composer").hidden = true;
  resetChatActions();
  const groups = conversations.filter(c=>c.kind==='group');
  $("#messages").innerHTML = groups.length
    ? `<div class="personalList">${groups.map((c) => contactMarkup({ id: c.id, name: c.title || "Семья", group: true, preview: c.lastMessage, time: formatConversationTime(c.lastMessageAt, userPreferences.locale), unread: c.unreadCount })).join("")}</div>`
    : '<p class="muted">Групп пока нет.</p>';
  $("#messages").onclick = (e) => {
    const item = e.target.closest("[data-group-id]");
    if (item && version === loadVersion) openConversation(item.dataset.groupId);
  };
}
async function startDirect(userID) {
  try {
    const conversation = await request(
      `/users/${encodeURIComponent(userID)}/direct-conversation`,
      { method: "POST" },
    );
    await loadConversations();
    openConversation(conversation.id);
  } catch (e) {
    $("#messages").innerHTML = `<p class="error">${safe(e.message)}</p>`;
  }
}
async function openConversation(id, before = "", navigate = true) {
  if(active!==id)receiptDetails.close();
  const refreshing = active === id && displayedConversation === id && $("#messages").dataset.conversationId === id;
  const scroller = $("#messages"), oldHeight = scroller.scrollHeight;
  if (id === personalID) return openPersonal();
  if (id === groupsID) return openGroups(navigate);
  if (id === childrenID || id === grandparentsID) return openFamilyCategory(id, navigate);
  if (id === shoppingID) return openShopping(navigate);
  const version = ++loadVersion;
  // Navigation and history refresh are independent: returning to the list keeps
  // the selected chat/DOM, but a deliberate tap must show that chat again.
  if (navigate) openMobileContent();
  active = id;
  $("#composer").hidden = false;
  if (attachmentConversation !== id) {
    if (attachmentConversation) attachmentDrafts.set(attachmentConversation, pendingFiles);
    attachmentConversation = id;
    pendingFiles = attachmentDrafts.get(id) || [];
    renderAttachments();
  }
  saveActive(active);
  renderConversations();
  const c = conversations.find((x) => x.id === id),
    isFavorite = c?.kind === "group" && favoriteIDs.has(id);
  $("#chatTitle").textContent = (c?.kind==='family'?activeFamily(families,c.familyId)?.title:c?.title) || c?.title || "Диалог";
  $("#chatSubtitle").textContent = c?.kind === "direct" ? "Личный диалог" : activeFamily(families, c?.familyId)?.title || "";
  const canManageGroup = c?.kind==='group' ? managesGroup(c) : c?.familyId === activeFamilyID && canManageFamily(families, activeFamilyID);
  $("#manageMembers").hidden = c?.kind !== "group";
  $("#deleteGroup").hidden = c?.kind !== "group" || c?.groupRole !== 'owner';
  const canAdministerFamily = c?.kind === "family" && canManageFamily(families, activeFamilyID);
  if($('#familyChatIcon'))$('#familyChatIcon').hidden=!canAdministerFamily;
  $("#inviteFamily").hidden = !canAdministerFamily;
  $("#searchMessages").hidden = !c;
  $("#renameConversation").hidden = !(c && canManageGroup);
  $("#toggleFavorite").hidden = c?.kind !== "group";
  $("#toggleFavorite").title = isFavorite
    ? "Убрать из избранного"
    : "Добавить в избранное";
  $("#toggleFavorite").setAttribute("aria-label", $("#toggleFavorite").title);
  $("#toggleFavorite").textContent = isFavorite ? "Убрать из избранного" : "Добавить в избранное";
  $("#chatMore").hidden = $("#renameConversation").hidden && $("#toggleFavorite").hidden && $("#deleteGroup").hidden;
  if (!refreshing) $("#chatMoreMenu").hidden = true;
  if (!refreshing) $("#messages").innerHTML = loadingMarkup();
  try {
    const page = await request(`/conversations/${encodeURIComponent(id)}/messages?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`);
    if (version !== loadVersion || id !== active) return;
    if (displayedConversation !== id) { displayedMessages = new Map(); olderCursor = ""; displayedConversation = id; }
    if (!refreshing || before) olderCursor = page.nextBefore || "";
    for (const message of page.messages || []) displayedMessages.set(message.id, {...message,receiptSummary:displayedMessages.get(message.id)?.receiptSummary});
    const list = [...displayedMessages.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id.localeCompare(b.id));
    const messageHTML =
      (olderCursor ? `<button class="secondary loadOlder" data-load-older="${safe(olderCursor)}">Показать более ранние сообщения</button>` : "") +
      groupMessageEntries(list).map(({ message: m, continued, startsDay }) =>
          `${startsDay ? `<div class="dateDivider"><span>${safe(formatDayLabel(m.createdAt, userPreferences.locale))}</span></div>` : ""}<article data-message-id="${safe(m.id)}" data-author-id="${safe(m.authorId)}" data-deleted="${!!m.deletedAt}" class="message ${m.authorId === currentUser.ID ? "own" : ""} ${continued ? "continued" : ""}"><div class="bubble">${m.authorAvatarUrl ? `<img class="authorAvatar messageAvatar" src="${safe(m.authorAvatarUrl)}" alt="">` : ""}<button class="messageAuthor" data-user-id="${safe(m.authorId)}" data-avatar-url="${safe(m.authorAvatarUrl || "")}" data-user-name="${safe(m.authorName)}" style="--author-hue:${authorHue(m.authorName)}">${safe(m.authorName)}</button>${messageBodyMarkup(m)}${m.deletedAt ? '' : attachmentMarkup(m.attachments, userPreferences.locale)}${m.deletedAt ? "" : reactionButtons(m)}<small class="messageMeta">${safe(formatMessageTime(m.createdAt, userPreferences.locale))}${m.editedAt ? ` · ${tr("изменено", userPreferences.locale)}` : ""}${m.authorId === currentUser.ID ? `<span data-status-id="${safe(m.id)}">${messageStatus(m.status || "sent",m.id)}</span>` : ""}${m.deletedAt ? "" : reactionAddButton(m)}</small></div></article>`)
        .join("") || '<p class="muted">Сообщений пока нет.</p>';
    const currentScroll = scroller.scrollTop;
    const currentlyAtBottom = scroller.scrollHeight - scroller.clientHeight - currentScroll < 60;
    syncMarkup(scroller, messageHTML);
    bindAttachmentFallback(scroller);
    scroller.dataset.conversationId = id;
    $("#messages").onclick = handleMessages;
    scroller.scrollTop = before && refreshing ? currentScroll + scroller.scrollHeight - oldHeight : !refreshing || currentlyAtBottom ? scroller.scrollHeight : currentScroll;
    void receipts.deliver();
    void refreshStatuses();
  } catch (e) {
    if (version === loadVersion) {
      if (refreshing) announce(e.message, "error");
      else $("#messages").innerHTML = `<p class="error">${safe(e.message)}</p>`;
    }
  }
}

async function openFamilyCategory(sectionID, navigate = true) {
  const definition = familySections.find(([id]) => id === sectionID);
  if (!definition || !activeFamilyID) return;
  const [, title, category] = definition;
  if (navigate) openMobileContent();
  const version = ++loadVersion, familyID = activeFamilyID;
  active = sectionID; saveActive(active); renderConversations();
  $("#chatTitle").textContent = t(title);
  $("#chatSubtitle").textContent = activeFamily(families, activeFamilyID)?.title || "";
  $("#composer").hidden = true;
  resetChatActions();
  $("#messages").innerHTML = loadingMarkup();
  try {
    const familyConversation = conversations.find((conversation) => conversation.kind === "family" && conversation.familyId === activeFamilyID);
    const members = familyConversation ? await request(`/conversations/${encodeURIComponent(familyConversation.id)}/members`) : [];
    if (version !== loadVersion || familyID !== activeFamilyID || active !== sectionID) return;
    const filtered = members.filter((member) => member.familyCategories?.includes(category));
    $("#messages").innerHTML = filtered.length ? `<div class="familyDirectory">${filtered.map((member) => contactMarkup({ id: member.ID, name: member.Name, subtitle: member.familyRelationship || "Написать" })).join("")}</div>` : '<section class="emptyState"><div class="emptyIcon" aria-hidden="true">○</div><h3>Пока никого нет</h3><p>Владелец или администратор семьи может назначить эту категорию в управлении семьёй.</p></section>';
    $("#messages").onclick = (event) => { const userID = event.target.closest("[data-user-id]")?.dataset.userId; if (userID) startDirect(userID); };
  } catch (error) { if (version === loadVersion) $("#messages").innerHTML = `<p class="error">${safe(error.message)}</p>`; }
}

async function openShopping(navigate = false) {
  const version = ++loadVersion;
  const familyID = activeFamilyID;
  const refreshing = active === shoppingID && !!$("#shoppingForm");
  if (navigate) openMobileContent();
  $("#messages").hidden = false; $("#onboarding").hidden = true;
  active = shoppingID; saveActive(active); renderConversations();
  $("#chatTitle").textContent = t("shopping");
  $("#chatSubtitle").textContent = activeFamily(families, familyID)?.title || (userPreferences.locale === "en" ? "Personal" : "Личные");
  $("#composer").hidden = true; resetChatActions();
  if (!refreshing) $("#messages").innerHTML = loadingMarkup();
  const isCurrent = () => active === shoppingID && familyID === activeFamilyID;
  try {
    const bases = ['/me/needs', ...(familyID ? [`/families/${encodeURIComponent(familyID)}/needs`] : [])];
    const parts = await Promise.all(bases.flatMap(base=>[request(base),request(base+'?archived=true')]));
    const items=parts.flat().sort((a,b)=>(a.plannedDate||'9999').localeCompare(b.plannedDate||'9999') || a.id.localeCompare(b.id));
    if (version !== loadVersion || !isCurrent()) return;
    shoppingCounter = summarizeShopping(items); renderConversations();
    mountNeeds({host: $("#messages"), familyID, items, request, refresh: () => openShopping(), announce, locale: userPreferences.locale, isCurrent,currentUserID:currentUser.ID});
    $("#messages").dataset.needScope = familyID || "personal";
  } catch (error) {
    if (version !== loadVersion || !isCurrent()) return;
    if (refreshing) announce(error.message, "error");
    else $("#messages").innerHTML = `<p class="error">${safe(error.message)}</p>`;
  }
}
function renderAttachments() {
  $("#attachmentList").innerHTML = pendingFiles.map((file,index)=>`<span data-no-i18n>${safe(file.name)} <button type="button" class="secondary" data-remove-attachment="${index}" aria-label="${userPreferences.locale==='en'?'Remove attachment':'Убрать вложение'}">×</button></span>`).join(' ');
}
function addPendingFiles(files) {
  if (pendingFiles.length+files.length>10 || [...pendingFiles,...files].reduce((sum,f)=>sum+f.size,0)>100*1024*1024 || files.some(f=>!f.size||f.size>25*1024*1024)) {
    announce(userPreferences.locale==='en'?'Up to 10 nonempty files, 25 MiB each, 100 MiB total.':'До 10 непустых файлов, 25 МиБ каждый, 100 МиБ всего.','error');return false;
  }
  pendingFiles=[...pendingFiles,...files];renderAttachments();return true;
}
async function uploadAttachment(file) {
  const form = new FormData();
  form.append("file", file, file.name);
  const r = await fetch(`${api}/attachments`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw Error(e.error || `Не удалось загрузить ${file.name}`);
  }
  return r.json();
}
async function startApp() {
  [currentUser, families, userPreferences] = await Promise.all([request("/auth/me"), request("/families"), request("/user/preferences")]);
  applyInterfacePreferences();
  const savedFamily = localStorage.getItem(activeFamilyKey);
  activeFamilyID = families.some((family) => family.id === savedFamily) ? savedFamily : (families[0]?.id || "");
  const selector = $("#familySelect");
  selector.innerHTML = families.map((f) => `<option value="${safe(f.id)}">${safe(f.title)}</option>`).join("");
  $("#newGroup").hidden = false;
	$("#manageCurrentFamily").hidden = !canManageFamily(families, activeFamilyID);
	$("#currentFamilyTitle").textContent = families.find((f) => f.id === activeFamilyID)?.title || "Без семьи";
	$("#currentFamilyRole").textContent = ({ owner: "Владелец", admin: "Администратор", member: "Участник" })[families.find((f) => f.id === activeFamilyID)?.role] || "";
  selector.hidden = families.length < 2;
  selector.value = activeFamilyID;
  let familySwitchVersion = 0;
  selector.onchange = async () => {
    if (selector.value === activeFamilyID || !families.some(f => f.id === selector.value)) return;
    const switchVersion = ++familySwitchVersion;
    const previous = active;
    const keepGlobal = previous === personalID ||
      previous === shoppingID ||
      conversations.some(c => c.id === previous && ['direct','group','interfamily'].includes(c.kind));
    const section = [shoppingID, childrenID, grandparentsID, groupsID].includes(previous) ? previous : null;
    activeFamilyID = selector.value;
    if(previous===shoppingID){
      // Remove the old family's rows immediately; retain private drafts and filters.
      mountNeeds({host:$('#messages'),familyID:activeFamilyID,items:[],request,refresh:()=>openShopping(),announce,locale:userPreferences.locale,isCurrent:()=>active===shoppingID,currentUserID:currentUser.ID});
      openShopping();
    }
    localStorage.setItem(activeFamilyKey, activeFamilyID);
    if (!keepGlobal) {
      ++loadVersion; active = section;
      receiptDetails.close();
      $("#messages").innerHTML = loadingMarkup();
      $("#composer").hidden = true; resetChatActions();
      $("#chatTitle").textContent = activeFamily(families, activeFamilyID)?.title || "";
      $("#chatSubtitle").textContent = "";
      localStorage.removeItem(activeConversationKey);
    }
    const navigationVersion = loadVersion;
		$("#currentFamilyTitle").textContent = families.find((f) => f.id === activeFamilyID)?.title || "Без семьи";
		$("#currentFamilyRole").textContent = ({ owner: "Владелец", admin: "Администратор", member: "Участник" })[families.find((f) => f.id === activeFamilyID)?.role] || "";
  $("#newGroup").hidden = false;
		$("#manageCurrentFamily").hidden = !canManageFamily(families, activeFamilyID);
    try {
      await loadConversations(false);
      if (switchVersion !== familySwitchVersion || keepGlobal || navigationVersion !== loadVersion) return;
      const target = section || conversations.find(c => c.kind === "family" && c.familyId === activeFamilyID)?.id;
      if (target) await openConversation(target, "", false);
      else await openGroups(false);
    } catch (error) {
      if (switchVersion === familySwitchVersion) announce(error.message, "error");
    }
  };
  $("#currentUserName").textContent = currentUser.Name || "Пользователь";
  $("#currentUserHeader").textContent = currentUser.Name || "Пользователь";
  $("#currentUserInitial").textContent = (currentUser.Name || "П").slice(0, 1).toUpperCase();
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#newFamily").hidden = false;
  const hasFamilies = families.length > 0;
  $("#onboarding").hidden = hasFamilies;
  $("#composer").hidden = !hasFamilies;
  if (!hasFamilies) {
    $("#chatTitle").textContent = "Создайте семейный круг";
    $("#messages").hidden = true;
    $("#replyPreview").hidden = true;
  }
  if (currentUser.Permissions?.manage_application)
    $("#administration").hidden = false;
  await loadConversations();
  if (!isNative || (await nativeCapabilities()).incomingShares) initIncomingShares({ user: currentUser, locale: () => userPreferences.locale, request, onSent: (cid) => { scheduleMessageSync(cid); void loadConversations(); } });
  if (isNative && (await nativeCapabilities()).deviceStorage) initDeviceStorage({locale:()=>userPreferences.locale,confirmAction});
  if (isNative && (await nativeCapabilities()).appUpdates) initAppUpdate({locale:()=>userPreferences.locale,announce});
}
const openUserLifecycle = initUserLifecycle({request,locale:()=>userPreferences.locale,onChanged:()=>openApplicationUsers(),announce});
const openStorageAdmin = initStorageAdmin({request,locale:()=>userPreferences.locale,confirmAction});
const openBackupAdmin = initBackupAdmin({request,locale:()=>userPreferences.locale,confirmAction});
const openApplicationFamilies = initApplicationFamilies({request,locale:()=>userPreferences.locale,confirmAction});
async function openAdmin() {
  try {
    const settings = await request("/application/settings");
    $("#minPasswordLength").value = settings.minPasswordLength;
    $("#applicationSettingsError").textContent = "";
    if (!$("#openStorageAdmin")) {
      const button=document.createElement('button');button.id='openStorageAdmin';button.type='button';button.className='secondary';button.onclick=openStorageAdmin;button.setAttribute('data-no-i18n','');
      $("#applicationAdminSections").append(button);
    }
    $("#openStorageAdmin").textContent=userPreferences.locale==='en'?'Storage':'Хранилище';
    if (!$("#openBackupAdmin")) {
      const button=document.createElement('button');button.id='openBackupAdmin';button.type='button';button.className='secondary';button.onclick=openBackupAdmin;
      $("#openStorageAdmin").parentElement.append(button);
    }
    $("#openBackupAdmin").textContent=userPreferences.locale==='en'?'Backups':'Резервные копии';
    if (!$("#openApplicationFamilies")) {
      const button=document.createElement('button');button.id='openApplicationFamilies';button.type='button';button.className='secondary';button.onclick=openApplicationFamilies;
      $("#applicationAdminSections").insertBefore(button, $("#openApplicationUsers").nextSibling);
    }
    $("#openApplicationFamilies").textContent=userPreferences.locale==='en'?'Families':'Семьи';
    $("#applicationAdminDialog").showModal();
  } catch (e) { announce(e.message, "error"); }
}
let applicationUsersLoading = false;
$("#openApplicationUsers").onclick = openApplicationUsers;
$("#closeApplicationUsers").onclick = () => $("#applicationUsersDialog").close();
$("#retryApplicationUsers").onclick = openApplicationUsers;
async function openApplicationUsers() {
  if (applicationUsersLoading) return;
  applicationUsersLoading = true;
  const dialog = $("#applicationUsersDialog");
  if (!dialog.open) dialog.showModal();
  $("#applicationUsersError").textContent = "";
  $("#retryApplicationUsers").hidden = true;
  $("#users").setAttribute("aria-busy", "true");
  try {
    const users = await request("/users");
    mountDirectory({list:$("#users"),users,admin:true,locale:()=>userPreferences.locale,render:(u) => {
        const admin = !!u.Permissions?.manage_application;
        return `<li class="accountRow"><div class="accountIdentity" data-no-i18n><strong>${safe(u.Name)}</strong><small>${safe(u.Email)}</small></div><div class="accountStatus">${u.disabled ? '<small>Деактивирован</small>' : '<small>Активен</small>'}${admin ? "<small>Администратор приложения</small>" : ""}</div><details class="accountActions"><summary>Действия</summary><div>${u.ID === currentUser.ID ? "" : `<button class="toggleAdmin secondary" data-toggle-admin="${safe(u.ID)}">${admin ? "Снять права администратора" : "Сделать администратором"}</button>`}<button class="secondary" data-edit-permissions="${safe(u.ID)}">Права приложения</button>${u.ID===currentUser.ID || u.ID==='admin' ? '' : `<button class="secondary" data-user-lifecycle="${safe(u.ID)}" data-action="${u.disabled?'activate':'deactivate'}">${u.disabled?'Активировать аккаунт':'Деактивировать аккаунт'}</button><button class="secondary dangerText" data-user-lifecycle="${safe(u.ID)}" data-action="delete">Удалить аккаунт</button>`}</div></details></li>`;
      }});
    $("#users").onclick = async (e) => {
      const lifecycle=e.target.closest('[data-user-lifecycle]');
      if(lifecycle){const user=users.find(u=>u.ID===lifecycle.dataset.userLifecycle);if(user)openUserLifecycle(user,lifecycle.dataset.action);return;}
      const permissionsUserID = e.target.dataset.editPermissions;
      if (permissionsUserID) {
        const user = users.find((u) => u.ID === permissionsUserID); if (user) openApplicationPermissions(user);
        return;
      }
      const userID = e.target.dataset.toggleAdmin;
      if (!userID) return;
      const user = users.find((u) => u.ID === userID);
      if (!user) return;
      const permissions = Object.keys(user.Permissions || {}),
        index = permissions.indexOf("manage_application");
      const granting = index < 0;
      if (!await confirmAction({ title: granting ? "Назначить администратора?" : "Снять права администратора?", message: granting ? `${user.Name} получит доступ к управлению всем приложением.` : `${user.Name} потеряет доступ к администрированию приложения.`, confirmLabel: granting ? "Назначить" : "Снять права", destructive: !granting })) return;
      if (index < 0) permissions.push("manage_application");
      else permissions.splice(index, 1);
      try {
        await request(`/users/${encodeURIComponent(userID)}/permissions`, {
          method: "PATCH",
          body: JSON.stringify({ permissions }),
        });
        await openApplicationUsers();
      } catch (e) { announce(e.message, "error"); }
    };
  } catch (e) {
    $("#applicationUsersError").textContent = e.message;
    $("#retryApplicationUsers").hidden = false;
  } finally {
    applicationUsersLoading = false;
    $("#users").removeAttribute("aria-busy");
  }
}
function openApplicationPermissions(user) {
  editingApplicationUser = user;
  $("#permissionsTitle").textContent = `Права приложения: ${user.Name}`;
  const items = [
    ["manage_application", "Администратор приложения", "Открывает раздел администрирования и позволяет назначать права всем пользователям."],
  ];
  $("#permissionList").innerHTML = items.map(([value, label, help]) => `<label><input type="checkbox" value="${value}" ${user.Permissions?.[value] ? "checked" : ""}><span><strong>${label}</strong><small>${help}</small></span></label>`).join("");
  $("#permissionsDialog").showModal();
}
async function openMembers(){const c=conversations.find(c=>c.id===active);if(c?.kind==='group')await groupUI.open(c);}
async function openFamilyManagement() {
  if (!canManageFamily(families, activeFamilyID)) return;
  const familyConversation = conversations.find((conversation) => conversation.kind === "family" && conversation.familyId === activeFamilyID);
  if (!familyConversation) return;
  try {
    const members = await request(`/conversations/${encodeURIComponent(familyConversation.id)}/members`);
    const family = activeFamily(families, activeFamilyID);
    familyManagerIsOwner = family?.role === "owner";
    familyManagerCanEditCategories = family?.role === "owner" || family?.role === "admin";

    familyMemberDrafts = new Map(members.map((user) => [user.ID, { ...user, familyCategories: [...(user.familyCategories || [])].sort() }]));
    $("#familyAdminTitle").textContent = `Семья: ${family?.title || ""}`;
    $("#familyAdminError").textContent = "";
    $("#familyMemberSearch").value = "";
    $("#familyMemberRoleFilter").value = "";
    $("#familyMemberCategoryFilter").value = "";
    renderFamilyMembers();
    $("#familyAdminDialog").showModal();
  } catch (error) { announce(error.message, "error"); }
}

function renderFamilyMembers() {
  const query = $("#familyMemberSearch").value.trim().toLocaleLowerCase();
  const role = $("#familyMemberRoleFilter").value, category = $("#familyMemberCategoryFilter").value;
  const visible = [...familyMemberDrafts.values()].filter((user) => {
    const categories = user.familyCategories || [];
    return (!query || `${user.Name} ${user.Email}`.toLocaleLowerCase().includes(query)) && (!role || user.familyRole === role) && (!category || (category === "none" ? !categories.length : categories.includes(category)));
  });
  $("#familyMembers").innerHTML = visible.length ? visible.map((user) => `
    <li class="familyMemberSummary" data-family-member="${safe(user.ID)}">
      <div><strong>${safe(user.Name)}</strong>
      <small>${safe(tr(user.familyRole === "owner" ? "Владелец" : user.familyRole === "admin" ? "Администратор семьи" : "Участник"))}</small>
      <span>${safe(user.familyRelationship || tr("Неопределено"))}</span>
      <small>${safe((user.familyCategories || []).map(value => tr(familyCategoryDefinitions.find(item => item[0] === value)?.[1] || value)).join(", ") || tr("Без категории"))}</small></div>
      <button type="button" class="secondary" data-edit-family-user="${safe(user.ID)}">${tr("Редактировать")}</button>
    </li>`).join("") : '<li class="muted">Подходящих участников нет.</li>';
}
function openFamilyMemberEditor(userID) {
  const user = familyMemberDrafts.get(userID);
  if (!user || familyMemberSaving) return;
  editingFamilyMember = {...user, familyCategories:[...(user.familyCategories || [])], familyID:activeFamilyID};
  $("#familyMemberEditName").textContent = user.Name;
  $("#familyMemberEditRole").value = user.familyRole || "member";
  $("#familyMemberEditRole").disabled = !familyManagerIsOwner;
  $("#familyMemberRoleHelp").hidden = familyManagerIsOwner;
  $("#familyMemberEditStatus").value = user.familyRelationship || "Неопределено";
  $("#familyMemberEditCategories").innerHTML = familyCategoryDefinitions.map(([value,label]) => `<label><input type="checkbox" value="${value}" ${user.familyCategories?.includes(value) ? "checked" : ""} ${familyManagerCanEditCategories ? "" : "disabled"}> ${safe(tr(label))}</label>`).join("");
  $("#familyMemberEditError").textContent = "";
  $("#familyMemberEditDialog").showModal();
}
async function saveFamilyMember(event) {
  event.preventDefault();
  if (!editingFamilyMember || familyMemberSaving) return;
  const draft = {...editingFamilyMember,
    familyRole:familyManagerIsOwner ? $("#familyMemberEditRole").value : editingFamilyMember.familyRole,
    familyRelationship:$("#familyMemberEditStatus").value.trim() || "Неопределено",
    familyCategories:familyManagerCanEditCategories ? [...$("#familyMemberEditCategories").querySelectorAll("input:checked")].map(input=>input.value).sort() : editingFamilyMember.familyCategories};
  familyMemberSaving = true;
  const controls = [...$("#familyMemberEditForm").elements], disabled = controls.map(control=>control.disabled);
  controls.forEach(control=>control.disabled=true);
  $("#familyMemberEditError").textContent = "";
  try {
    await request(`/families/${encodeURIComponent(draft.familyID)}/members/${encodeURIComponent(draft.ID)}`, {method:"PATCH", body:JSON.stringify({role:draft.familyRole,relationship:draft.familyRelationship,categories:draft.familyCategories})});
    familyMemberDrafts.set(draft.ID,draft);
    $("#familyMemberEditDialog").close();
    editingFamilyMember = null;
    const panel = $("#familyAdminDialog .panelBody"), scroll = panel.scrollTop;
    renderFamilyMembers();
    panel.scrollTop = scroll;
    $("#familyMembers").querySelector(`[data-edit-family-user="${CSS.escape(draft.ID)}"]`)?.focus({preventScroll:true});
    announce("Изменения сохранены");
  } catch(error) { $("#familyMemberEditError").textContent = error.message; }
  finally { familyMemberSaving=false; controls.forEach((control,index)=>control.disabled=disabled[index]); }
}

function keyBytes(key) {
  const value = (key + "=".repeat((4 - (key.length % 4)) % 4))
      .replace(/-/g, "+")
      .replace(/_/g, "/"),
    raw = atob(value);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function configurePush() {
  if (isNative) {
    if (!(await nativeCapabilities()).nativePush) {
      $("#pushSettings").hidden = false;
      $("#pushSettings").onclick = () => announce("Для уведомлений обновите приложение Android", "error");
      return;
    }
    await configureNativePush({user:currentUser,locale:()=>userPreferences.locale,request,announce,openConversation});
    return;
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
  const button = $("#pushSettings"),
    registration = await navigator.serviceWorker.register("/sw.js");
  let subscription = await registration.pushManager.getSubscription();
  const updateButton = () => {
    button.textContent = subscription
      ? "Уведомления: вкл."
      : "Включить уведомления";
  };
  button.hidden = false;
  updateButton();
  button.onclick = async () => {
    button.disabled = true;
    button.textContent = subscription ? "Отключаем…" : "Настраиваем…";
    try {
      if (subscription) {
        await request("/push/subscriptions", {
          method: "DELETE",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
        subscription = null;
        announce("Уведомления отключены");
        return;
      }
      const key = await request("/push/public-key");
      if (Notification.permission === "denied")
        throw Error("Уведомления заблокированы в настройках браузера для этого сайта");
      if ((await Notification.requestPermission()) !== "granted")
        throw Error("Разрешение на уведомления не получено");
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(key.publicKey),
      });
      await request("/push/subscriptions", {
        method: "POST",
        body: JSON.stringify(subscription),
      });
      announce("Уведомления включены");
    } catch (e) {
      announce(e.message, "error");
    } finally {
      button.disabled = false;
      updateButton();
    }
  };
}
$("#closeProfile").onclick = () => $("#profileDialog").close();
const editNamesButton=document.createElement('button');editNamesButton.id='openEditNames';editNamesButton.type='button';editNamesButton.className='secondary';editNamesButton.textContent='Имя и фамилия';editNamesButton.hidden=true;
$("#openPasswordForm").before(editNamesButton);
editNamesButton.onclick=()=>{
  $("#profileFirstName").value=currentUser.firstName||currentUser.Name;
  $("#profileLastName").value=currentUser.lastName||'';
  $("#editNamesError").textContent='';$("#profileDialog").close();$("#editNamesDialog").showModal();
};
$("#cancelEditNames").onclick=()=>$("#editNamesDialog").close();
$("#editNamesForm").onsubmit=async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('[type="submit"]');if(button.disabled)return;
  try{
    const updated=await withBusy(button,'Сохраняем…',()=>request('/user/profile',{method:'PUT',body:JSON.stringify({firstName:$("#profileFirstName").value,lastName:$("#profileLastName").value})}));
    currentUser=updated;$("#currentUserName").textContent=updated.Name;$("#currentUserHeader").textContent=updated.Name;$("#currentUserInitial").textContent=initials(updated.Name);
    $("#editNamesDialog").close();announce('Профиль сохранён');await loadConversations();if(active===personalID)await openPersonal();
  }catch(error){$("#editNamesError").textContent=error.message;}
};
const lastNameLabel=document.createElement('label');lastNameLabel.innerHTML='Фамилия<input id="registerLastName" autocomplete="family-name" maxlength="120">';$("#registerName").closest('label').after(lastNameLabel);
$("#openPasswordForm").onclick = () => { $("#passwordForm").hidden = false; $("#currentPassword").focus(); };
$("#cancelPasswordForm").onclick = () => { $("#passwordForm").hidden = true; $("#passwordForm").reset(); };
$("#passwordForm").onsubmit = async (event) => {
  event.preventDefault();
  const currentPassword = $("#currentPassword").value;
  const newPassword = $("#newPassword").value;
  if (newPassword !== $("#newPasswordRepeat").value) { $("#passwordError").textContent = "Новые пароли не совпадают"; return; }
  try {
    await request("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
    $("#passwordForm").reset();
    $("#passwordForm").hidden = true;
    $("#passwordError").textContent = "Пароль изменён";
  } catch (error) { $("#passwordError").textContent = error.message; }
};
$("#changeAvatar").onclick = () => $("#profileAvatarFile").click();
$("#profileAvatarFile").onchange = async (event) => {
  const file = event.target.files[0]; if (!file) return;
  if (!/image\/(jpeg|png|webp)/.test(file.type) || file.size > 2 * 1024 * 1024) { announce("Выберите JPEG, PNG или WebP размером до 2 МБ", "error"); return; }
  try {
    const response = await fetch(`${api}/auth/avatar`, { method: "POST", credentials: "include", headers: { "Content-Type": file.type }, body: file });
    const result = await response.json().catch(() => ({})); if (!response.ok) throw Error(result.error || "Не удалось сохранить фото");
    currentUser.AvatarURL = `${serverURL(result.avatarUrl)}?v=${Date.now()}`;
    $("#profileAvatar").src = currentUser.AvatarURL;
    event.target.value = "";
  } catch (error) { announce(error.message, "error"); }
};
$("#openUserMenu").onclick = () => $("#userMenuDialog").showModal();
$("#myProfile").onclick = () => { $("#userMenuDialog").close(); openUserCard(currentUser.ID, currentUser.Name, currentUser.AvatarURL); };
const automationButton=document.createElement('button');automationButton.id='openAutomations';automationButton.type='button';automationButton.className='secondary';automationButton.hidden=true;automationButton.setAttribute('data-no-i18n','');
$("#openInterfaceSettings").after(automationButton);
initAutomations({profile:$("#profileDialog"),button:automationButton,request,locale:()=>userPreferences.locale});
const appearance=createAppearanceSettings({form:$("#interfaceSettingsForm"),dialog:$("#profileDialog"),userID:()=>currentUser?.ID||'',preferences:()=>userPreferences});
const sendSettingsButton=document.createElement('button');sendSettingsButton.id='openSendSettings';sendSettingsButton.type='button';sendSettingsButton.className='secondary';sendSettingsButton.hidden=true;sendSettingsButton.setAttribute('data-no-i18n','');
$("#openInterfaceSettings").after(sendSettingsButton);
initSendSettings({button:sendSettingsButton,preferences:()=>userPreferences,request,onSaved:prefs=>{userPreferences=prefs;applyInterfacePreferences();}});
$("#openInterfaceSettings").textContent='Оформление и язык';
let savingAppearance=false;
$("#openInterfaceSettings").onclick = () => { const form=$("#interfaceSettingsForm");if(form.hidden)appearance.prepare();else appearance.applySaved();form.hidden=!form.hidden; };
$("#interfaceSettingsForm").onsubmit = async (event) => {
  event.preventDefault();
  if(savingAppearance)return;
  savingAppearance=true;
  const controls=[...event.currentTarget.querySelectorAll('input,select,button')];
  controls.forEach(el=>el.disabled=true);
  try {
    if($("#interfaceLocale").value!==userPreferences.locale)
      userPreferences = await request("/user/preferences", { method: "PUT", body: JSON.stringify({ locale: $("#interfaceLocale").value, colorScheme: userPreferences.colorScheme || 'system' }) });
    appearance.save();
    applyInterfacePreferences();
    renderConversations();
    appearance.prepare();
    $("#interfaceSettingsError").textContent = userPreferences.locale==='en'?'Interface settings saved':'Настройки интерфейса сохранены';
  } catch (error) { $("#interfaceSettingsError").textContent = error.message; }
  finally {savingAppearance=false;controls.forEach(el=>el.disabled=false);}
};
$("#toggleFavorite").onclick = async () => {
  if (!active || active === personalID || active === groupsID) return;
  const favorite = !favoriteIDs.has(active);
  try {
    await request(`/conversations/${active}/favorite`, {
      method: "PUT",
      body: JSON.stringify({ favorite }),
    });
    if (favorite) favoriteIDs.add(active);
    else favoriteIDs.delete(active);
    renderConversations();
    $("#toggleFavorite").textContent = tr(favorite ? "Убрать из избранного" : "Добавить в избранное", userPreferences.locale);
    $("#chatMoreMenu").hidden = true;
  } catch (e) { announce(e.message, "error"); }
};
$("#chatMore").onclick = () => { $("#chatMoreMenu").hidden = !$("#chatMoreMenu").hidden; };
$("#administration").onclick = openAdmin;
$("#closeApplicationAdmin").onclick = () => $("#applicationAdminDialog").close();
$("#applicationSettingsForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const settings = await request("/application/settings", { method: "PUT", body: JSON.stringify({ minPasswordLength: Number($("#minPasswordLength").value) }) });
    applyPasswordPolicy(settings);
    $("#applicationSettingsError").textContent = "Правило сохранено";
  } catch (error) { $("#applicationSettingsError").textContent = error.message; }
};
$("#savePermissions").onclick = async (event) => { event.preventDefault(); if (!editingApplicationUser) return; const permissions = [...$("#permissionList").querySelectorAll("input:checked")].map((input) => input.value); try { await withBusy(event.currentTarget, "Сохраняем…", async () => request(`/users/${encodeURIComponent(editingApplicationUser.ID)}/permissions`, { method: "PATCH", body: JSON.stringify({ permissions }) })); $("#permissionsDialog").close(); announce("Права приложения сохранены"); await openApplicationUsers(); } catch (error) { announce(error.message, "error"); } };
$("#newFamily").onclick = () => {
  $("#parentFamily").innerHTML = '<option value="">Независимая семья</option>' + families.map((family) => `<option value="${safe(family.id)}" ${family.id === activeFamilyID ? "selected" : ""}>${safe(family.title)}</option>`).join("");
  $("#userMenuDialog").close();
  $("#familyDialog").showModal();
};
$("#openFamilyMenu").onclick = () => {
  const family = activeFamily(families, activeFamilyID);
  $("#familyMenuDescription").textContent = family ? `Роль в семье: ${({ owner: "владелец", admin: "администратор", member: "участник" })[family.role] || "участник"}` : "Создайте семью или примите приглашение.";
  $("#familyMenuDialog").showModal();
};
$("#closeFamilyMenu").onclick = () => $("#familyMenuDialog").close();
initJoinFamily({ request, locale: () => userPreferences.locale, announce, onJoined: async () => {
  families = await request("/families");
  if (!families.some(f => f.id === activeFamilyID)) activeFamilyID = families[0]?.id || "";
  const selector = $("#familySelect");
  selector.innerHTML = families.map(f => `<option value="${safe(f.id)}">${safe(f.title)}</option>`).join("");
  selector.value = activeFamilyID; selector.hidden = families.length < 2;
  localStorage.setItem(activeFamilyKey, activeFamilyID);
  const family = families.find(f => f.id === activeFamilyID);
  $("#currentFamilyTitle").textContent = family?.title || "Без семьи";
  $("#currentFamilyRole").textContent = ({owner:"Владелец",admin:"Администратор",member:"Участник"})[family?.role] || "";
  $("#newGroup").hidden = false; $("#manageCurrentFamily").hidden = !canManageFamily(families, activeFamilyID);
  $("#onboarding").hidden = families.length > 0;
  await loadConversations();
} });
$("#openCreateFamily").onclick = () => { $("#familyMenuDialog").close(); $("#newFamily").click(); };
$("#createFirstFamily").onclick = () => $("#newFamily").click();
$("#manageCurrentFamily").onclick = () => { $("#familyMenuDialog").close(); openFamilyManagement(); };
for (const selector of ["#familyMemberSearch", "#familyMemberRoleFilter", "#familyMemberCategoryFilter"]) {
  $(selector).oninput = renderFamilyMembers;
  $(selector).onchange = renderFamilyMembers;
}
$("#familyMembers").onclick = (event) => {
  const button = event.target.closest("[data-edit-family-user]");
  if (button) openFamilyMemberEditor(button.dataset.editFamilyUser);
};
$("#familyMemberEditForm").onsubmit = saveFamilyMember;
$("#cancelFamilyMemberEdit").onclick = () => { if (!familyMemberSaving) $("#familyMemberEditDialog").close(); };
$("#familyMemberEditDialog").oncancel = (event) => { if (familyMemberSaving) event.preventDefault(); };
$("#familyMemberEditDialog").onclose = () => { editingFamilyMember = null; };
$("#closeFamilyAdmin").onclick = () => $("#familyAdminDialog").close();
$("#inviteFamily").onclick = () => { const family = activeFamily(families, activeFamilyID); if (!family) return; $("#familyInviteRole").value = "member"; $("#familyInviteRole").disabled = family.role !== "owner" && !currentUser.Permissions?.manage_application; $("#familyInviteFamily").textContent = `Семья: ${family.title}`; $("#familyInviteError").textContent = ""; $("#familyInviteToken").hidden = true; delete $("#familyInviteToken").dataset.token; $("#familyInviteDialog").showModal(); };
$("#closeFamilyInvite").onclick = () => $("#familyInviteDialog").close();
$("#familyInviteForm").onsubmit = async (event) => { event.preventDefault(); try { const invite = await request("/invitations", { method: "POST", body: JSON.stringify({ email: $("#familyInviteEmail").value.trim(), familyId: activeFamilyID, familyRole: $("#familyInviteRole").value, relationship: $("#familyInviteRelationship").value.trim() || "Неопределено" }) }); $("#familyInviteToken").dataset.token = invite.token; $("#familyInviteTokenText").textContent = `Одноразовый код: ${invite.token}`; $("#familyInviteToken").hidden = false; $("#familyInviteEmail").value = ""; $("#familyInviteError").textContent = invite.mailSent === false ? "Приглашение создано, но письмо не отправлено. Передайте код вручную." : ""; } catch (error) { $("#familyInviteError").textContent = error.message; } };
$("#copyFamilyInviteToken").onclick = async () => { const code = $("#familyInviteToken").dataset.token || ""; if (!code) return; try { await navigator.clipboard.writeText(code); $("#copyFamilyInviteToken").textContent = "Скопировано"; setTimeout(() => { $("#copyFamilyInviteToken").textContent = "Скопировать"; }, 1500); } catch { $("#familyInviteError").textContent = "Не удалось скопировать код. Скопируйте его вручную."; } };
$("#closeFamily").onclick = () => $("#familyDialog").close();
$("#familyForm").onsubmit = async (e) => {
  e.preventDefault();
  const title = $("#familyTitle").value.trim();
  if (!title) return;
  try {
    const family = await withBusy(e.submitter, "Создаём…", async () => request("/families", { method: "POST", body: JSON.stringify({ title, parentFamilyId: $("#parentFamily").value }) }));
    $("#familyDialog").close(); $("#familyTitle").value = ""; families.push(family); activeFamilyID = family.id; localStorage.setItem(activeFamilyKey, family.id); announce("Семья создана"); location.reload();
  } catch (error) { $("#familyError").textContent = error.message; }
};
$("#logout").onclick = async () => {
  try {
  if (isNative) await disableNativePush();
  await request("/auth/logout", { method: "POST" });
  location.reload();
  } catch (_) { announce("Не удалось безопасно выйти. Проверьте соединение и повторите.","error"); }
};
$("#manageMembers").onclick = openMembers;
$("#deleteGroup").onclick = async () => {
  if (!active || !await confirmAction({ title: "Архивировать группу?", message: "Группа исчезнет из списка, но сообщения и файлы сохранятся.", confirmLabel: "Архивировать", destructive: true })) return;
  try { await request(`/conversations/${active}`, { method: "DELETE" }); active = null; await loadConversations(); announce("Группа архивирована"); } catch (error) { announce(error.message, "error"); }
};
$("#renameConversation").onclick = () => {
  const conversation = conversations.find((item) => item.id === active);
  if (!conversation) return;
  $("#renameTitle").textContent = conversation.kind === "family" ? "Переименовать семью" : "Переименовать группу";
  $("#renameValue").value = conversation.title;
  $("#renameError").textContent = "";
  $("#renameDialog").showModal();
};
$("#closeRename").onclick = () => $("#renameDialog").close();
$("#renameForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    await request(`/conversations/${encodeURIComponent(active)}`, { method: "PATCH", body: JSON.stringify({ title: $("#renameValue").value.trim() }) });
    $("#renameDialog").close();
    families = await request("/families");
    await loadConversations();
    $("#chatTitle").textContent = conversations.find(item => item.id === active)?.title || "";
  } catch (error) { $("#renameError").textContent = error.message; }
};
$("#searchMessages").onclick = () => { $("#searchError").textContent = ""; $("#searchResults").textContent = ""; $("#searchDialog").showModal(); $("#searchQuery").focus(); };
$("#closeSearch").onclick = () => $("#searchDialog").close();
$("#searchForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const result = await request(`/conversations/${encodeURIComponent(active)}/search?q=${encodeURIComponent($("#searchQuery").value.trim())}`);
    $("#searchError").textContent = result.messages.length ? "" : "Ничего не найдено";
    $("#searchResults").innerHTML = result.messages.map((message) => `<article class="searchResult"><strong>${safe(message.authorName)}</strong><p>${safe(message.body)}</p><small class="muted">${new Date(message.createdAt).toLocaleString("ru-RU")}</small></article>`).join("");
  } catch (error) { $("#searchError").textContent = error.message; }
};
$("#addMember").onclick = async (e) => {
  e.preventDefault();
  const userId = $("#memberSelect").value;
  if (!userId) return;
  try {
    await request(`/conversations/${active}/members`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
    openMembers();
    loadConversations();
  } catch (e) {
    $("#memberError").textContent = e.message;
  }
};
$("#newGroup").onclick = () => { $("#groupError").textContent = ""; $("#groupDialog").showModal(); };
$("#closeGroup").onclick = () => $("#groupDialog").close();
$("#groupForm").onsubmit = async (e) => {
  e.preventDefault();
  const title = $("#groupTitle").value.trim();
  if (!title) return;
  try {
    const created=await withBusy(e.submitter, "Создаём…", async () => request("/conversations", { method: "POST", body: JSON.stringify({ title, memberIds: [] }) }));
    if(!created)return;
    $("#groupDialog").close(); $("#groupTitle").value = ""; await loadConversations(false); await openConversation(created.id); announce("Группа создана");
  } catch (error) { $("#groupError").textContent = error.message; }
};
$("#openAcceptInvite").onclick = () => {
  $("#acceptInviteError").textContent = "";
  $("#acceptInviteDialog").showModal();
  $("#inviteCode").focus();
};
$("#joinExistingInvite").onclick = () => {
  const token = $("#inviteCode").value.trim();
  if (!token) { $("#acceptInviteError").textContent = "Введите одноразовый код"; return; }
  sessionStorage.setItem("familychat.invitationCode", token);
  $("#acceptInviteDialog").close();
  $("#email").focus();
};
$("#closeAcceptInvite").onclick = () => $("#acceptInviteDialog").close();
$("#openRegister").onclick = () => $("#registerDialog").showModal();
$("#closeRegister").onclick = () => $("#registerDialog").close();
$("#registerForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    await request("/auth/register", { method:"POST", body:JSON.stringify({email:$("#registerEmail").value.trim(),name:$("#registerName").value.trim(),lastName:$("#registerLastName").value.trim(),password:$("#registerPassword").value}) });
    location.reload();
  } catch (error) { $("#registerError").textContent = error.message; }
};

$("#acceptInvite").onsubmit = async (event) => {
  event.preventDefault();
  const token = $("#inviteCode").value.trim();
  const name = $("#inviteName").value.trim();
  const password = $("#invitePassword").value;
  const passwordRepeat = $("#invitePasswordRepeat").value;
  const error = $("#acceptInviteError");
  if (password !== passwordRepeat) {
    error.textContent = "Пароли не совпадают";
    return;
  }
  if (password.length < minPasswordLength) {
    error.textContent = `Пароль должен содержать не менее ${minPasswordLength} символов`;
    return;
  }
  try {
    const user = await request("/invitations/accept", {
      method: "POST",
      body: JSON.stringify({ token, name, password }),
    });
    $("#acceptInviteDialog").close();
    $("#loginForm").reset();
    $("#email").value = user.Email || "";
    $("#error").textContent = "Аккаунт создан. Введите пароль для входа.";
    $("#password").focus();
  } catch (requestError) {
    error.textContent = requestError.message;
  }
};
$("#attach").onclick = () => {
  $("#attachmentFiles").click();
  $("#sendMenu").hidden = true;
};
$("#attachmentFiles").onchange = (e) => {
  if (!send.disabled) addPendingFiles([...e.target.files]);
  e.target.value='';
};
$("#attachmentList").onclick = event => {
  const button=event.target.closest('[data-remove-attachment]');
  if(!button||send.disabled)return;
  pendingFiles=pendingFiles.filter((_,i)=>i!==Number(button.dataset.removeAttachment));renderAttachments();
};
$("#emoji").onclick = () => {
  $("#emojiBar").hidden = !$("#emojiBar").hidden;
  $("#sendMenu").hidden = true;
};
$("#emojiBar").onclick = (e) => {
  const button = e.target.closest("button");
  if (!button) return;
  $("#body").value += button.textContent;
  $("#body").focus();
  $("#emojiBar").hidden = true;
};
$("#reactionPicker").onclick = async (e) => {
  const emoji = e.target.dataset.emoji;
  if (!emoji || !reactionTarget) return;
  const messageID = reactionTarget;
  $("#reactionPicker").hidden = true;
  reactionTarget = null;
  await toggleMessageReaction(messageID, emoji);
};
let pressTimer,
  longPress = false;
const send = $("#sendButton");
const pasteButton=document.createElement('button');
pasteButton.type='button';pasteButton.className='menuAction';pasteButton.textContent='Вставить из буфера';
$("#sendMenu").append(pasteButton);
bindClipboard({input:$("#body"),button:pasteButton,context:()=>`${currentUser?.ID}:${active}:${loadVersion}`,available:()=>!send.disabled&&!$("#composer").hidden&&conversations.some(c=>c.id===active),addFiles:addPendingFiles,report:message=>announce(message,'error'),locale:()=>userPreferences.locale});
send.onpointerdown = () => {
  longPress = false;
  pressTimer = setTimeout(() => {
    longPress = true;
    $("#sendMenu").hidden = !$("#sendMenu").hidden;
  }, 550);
};
for (const event of ["pointerup", "pointercancel", "pointerleave"])
  send.addEventListener(event, () => clearTimeout(pressTimer));
send.onclick = (e) => {
  if (longPress) e.preventDefault();
};
$("#composer").onsubmit = async (e) => {
  e.preventDefault();
  const body = $("#body").value.trim();
  if (send.disabled || !active || active === personalID || (!body && !pendingFiles.length))
    return;
  const conversationID = active, submittedReply = replyDraft, submittedFiles = [...pendingFiles], submittedText = $("#body").value;
  const messageBody = submittedReply ? `↩ ${submittedReply.author}: ${firstLine(submittedReply.body)}\n${body}` : body;
  send.disabled = true;
  try {
    const attachments = [];
    for (const file of submittedFiles)
      attachments.push(await uploadAttachment(file));
    await request(`/conversations/${conversationID}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: messageBody, attachments }),
    });
    if (replyDraft === submittedReply) { replyDraft = null; $("#replyPreview").hidden = true; }
    attachmentDrafts.delete(conversationID);
    if (attachmentConversation === conversationID) {
      pendingFiles = pendingFiles.filter(file=>!submittedFiles.includes(file));
      renderAttachments();
    }
    if (active === conversationID) {
      if ($("#body").value === submittedText) $("#body").value = "";
      $("#body").style.height = "auto";
      $("#attachmentFiles").value = "";
    }
    scheduleMessageSync(conversationID);
    loadConversations().catch(() => {});
  } catch (e) { announce(e.message, "error"); } finally {
    send.disabled = false;
  }
};
if (new URLSearchParams(location.search).get("login") === "error")
  $("#error").textContent = "Неверный адрес или пароль";
const invitationFromLink = new URLSearchParams(location.search).get("invite");
loadPasswordPolicy();
if (invitationFromLink) {
  $("#inviteCode").value = invitationFromLink;
  $("#acceptInviteDialog").showModal();
}
$("#loginForm").onsubmit = async (event) => { event.preventDefault(); const error = $("#error"), button = $("#loginForm button"); error.textContent = ""; button.disabled = true; try { await request("/auth/login", { method: "POST", body: JSON.stringify({ email: $("#email").value.trim(), password: $("#password").value }) }); const token = sessionStorage.getItem("familychat.invitationCode"); if (token) { await request("/invitations/join-by-code", { method: "POST", body: JSON.stringify({ token }) }); sessionStorage.removeItem("familychat.invitationCode"); } location.replace("/"); } catch (requestError) { error.textContent = requestError.message || "Не удалось выполнить вход"; $("#password").focus(); } finally { button.disabled = false; } };
async function bootApp() {
  $("#retryStart").hidden = true;
  try {
    await startApp();
    connectEvents();
    if (invitationFromLink) {
      try {
        await request(`/invitations/${encodeURIComponent(invitationFromLink)}/join`, { method: "POST" });
        history.replaceState({}, "", location.pathname);
        location.reload();
        return;
      } catch (error) { console.warn("Приглашение ожидает создания аккаунта", error); }
    }
    await configurePush();
  } catch (error) {
    if (error.message !== "Требуется вход" && error.message !== "Сессия истекла") {
      $("#error").textContent = "Не удалось загрузить чат. Проверьте соединение и повторите попытку.";
      $("#retryStart").hidden = false;
    }
  }
}
$("#retryStart").onclick = bootApp;
bootApp();
function connectEvents() {
  const scheme = location.protocol === "https:" ? "wss" : "ws",
    socket = new WebSocket(serverOrigin ? `${serverOrigin.replace(/^https:/, "wss:")}/api/v1/events` : `${scheme}://${location.host}/api/v1/events`);
  socket.onopen = () => {
    void receipts.deliver();
    void refreshStatuses();
    if (active && displayedConversation === active) scheduleMessageSync(active);
  };
  socket.onmessage = async (message) => {
    try {
      const event = JSON.parse(message.data);
      if (event.type === "message.status") {
        if (event.conversationId === active) await refreshStatuses();
        await loadConversations();
        return;
      }
      if (event.type === "message.created") void receipts.deliver();
      if (event.type === "reaction.updated") {
        if (event.conversationId === active) await refreshReactions(event.messageId);
        return;
      }
      if (event.type.startsWith("message.")) {
        if (event.conversationId === active) scheduleMessageSync(active);
        if (event.type !== "message.status") await loadConversations();
        return;
      }

      if (event.type === "shopping.changed" && active === shoppingID) {
        await openShopping();
        return;
      }
      await loadConversations();
      if (active === personalID) await openPersonal();
      else if (event.type === "conversations.changed") {
        await syncActiveGroupAccess();
      }
    } catch (_) {}
  };
  socket.onclose = () => setTimeout(connectEvents, 2000);
}

let replyDraft = null;
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-reply-id]");
  if (!button) return;
  const article = button.closest(".message") || document.querySelector(`[data-message-id="${CSS.escape(button.dataset.replyId)}"]`);
  if (!article || article.dataset.deleted === 'true') return;
  replyDraft = {
    author: article?.querySelector(".messageAuthor")?.textContent || "Сообщение",
    body: firstLine(article?.querySelector(".messageBody")?.textContent || "Вложение"),
  };
  const preview = $("#replyPreview");
  if (preview) {
    preview.hidden = false;
    $("#replyPreviewAuthor").textContent = replyDraft.author;
    $("#replyPreviewText").textContent = replyDraft.body;
  }
  $("#body").focus();
});
$("#cancelReply").onclick = () => { replyDraft = null; $("#replyPreview").hidden = true; };
document.addEventListener("pointerdown", (event) => {
  const menu = $("#sendMenu");
  if (!menu.hidden && !event.target.closest("#sendMenu") && !event.target.closest("#sendButton")) menu.hidden = true;
  const actions = $("#chatMoreMenu");
  if (!actions.hidden && !event.target.closest("#chatMoreMenu") && !event.target.closest("#chatMore")) actions.hidden = true;
  if (!event.target.closest("[data-shopping-menu]") && !event.target.closest("[data-shopping-more]"))
    document.querySelectorAll("[data-shopping-menu]").forEach((item) => { item.hidden = true; });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") document.querySelectorAll("[data-shopping-menu]").forEach((item) => { item.hidden = true; });
});
$("#cancelShoppingDate").onclick = () => { editingShoppingDateID = null; $("#shoppingDateDialog").close(); };
$("#shoppingDateForm").onsubmit = async (event) => {
  event.preventDefault();
  const plannedDate = $("#shoppingDateEdit").value;
  if (!editingShoppingDateID || !plannedDate) return;
  const itemID = editingShoppingDateID;
  try {
    await request(`/families/${encodeURIComponent(activeFamilyID)}/shopping/${encodeURIComponent(itemID)}`, { method: "PATCH", body: JSON.stringify({ plannedDate }) });
    editingShoppingDateID = null;
    $("#shoppingDateDialog").close();
    announce("Дата покупки изменена");
    await openShopping();
  } catch (error) { $("#shoppingDateError").textContent = error.message; }
};
$("#body").addEventListener("input", (event) => {
  event.currentTarget.style.height = "auto";
  event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`;
});
$("#body").addEventListener("keydown", (event) => {
  if (shouldSend(event,userPreferences.sendShortcut)) {
    event.preventDefault();
    $("#composer").requestSubmit();
  }
});
observeTranslations(() => userPreferences.locale || "ru");
initMediaViewer({locale:()=>userPreferences.locale||'ru'});
async function syncActiveGroupAccess(){
 const c=conversations.find(c=>c.id===active);
 if(active&&!active.startsWith('__')&&!c){active=null;await openPersonal();return;}
 if(!c)return;
 $('#chatTitle').textContent=c.kind==='family'?(activeFamily(families,c.familyId)?.title||c.title):c.title;
 if(c.kind==='group'){
  $('#renameConversation').hidden=!managesGroup(c);
  $('#deleteGroup').hidden=c.groupRole!=='owner';
 }
}
const groupUI=initGroups({request,locale:()=>userPreferences.locale||'ru',refresh:async()=>{await loadConversations(false);await syncActiveGroupAccess();},announce,confirm:confirmAction});
const interfamilyUI=initInterfamily({request,family:()=>activeFamily(families,activeFamilyID),locale:()=>userPreferences.locale||'ru',refresh:async()=>{await loadConversations(false);await syncActiveGroupAccess();},confirm:confirmAction});
const familyIconButton=document.createElement('button');familyIconButton.id='familyChatIcon';familyIconButton.type='button';familyIconButton.className='menuAction';familyIconButton.hidden=true;familyIconButton.textContent=userPreferences.locale==='en'?'Family chat icon':'Пиктограмма семейного чата';$('#chatMoreMenu').append(familyIconButton);familyIconButton.onclick=()=>{const c=conversations.find(c=>c.id===active);if(c)groupUI.familyIcon(c);};
const recoverGroupsButton=document.createElement('button');recoverGroupsButton.type='button';recoverGroupsButton.className='secondary';recoverGroupsButton.textContent='Восстановить владельца группы';$('#applicationAdminSections').append(recoverGroupsButton);recoverGroupsButton.onclick=()=>groupUI.recovery();
initMessageActions({request,user:()=>currentUser,locale:()=>userPreferences.locale||'ru',onSent:()=>announce(userPreferences.locale==='en'?'Message forwarded':'Сообщение переслано')});
