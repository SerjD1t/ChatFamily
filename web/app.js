import { api, $, request, safe } from "./api.js";
import { activeFamily, canManageFamily, familyConversations, summarizeShopping } from "./family-context.js";
import { announce, confirmAction, withBusy } from "./ui.js";
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
let familyMemberDrafts = new Map(), familyMemberSelection = new Set(), familyManagerIsOwner = false;
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
const translations = {
  ru: { personal: "Личные", family: "Семья", familyChat: "Семейный чат", children: "Дети", grandparents: "Бабушки и дедушки", shopping: "Покупки", chats: "Чаты семьи", allChats: "Все чаты семьи" },
  en: { personal: "Direct messages", family: "Family", familyChat: "Family chat", children: "Children", grandparents: "Grandparents", shopping: "Shopping", chats: "Family chats", allChats: "All family chats" },
};
function t(key) { return (translations[userPreferences.locale] || translations.ru)[key] || key; }
function applyPasswordPolicy(policy) {
  minPasswordLength = policy.minPasswordLength || 12;
  for (const selector of ["#registerPassword", "#invitePassword", "#invitePasswordRepeat", "#newPassword", "#newPasswordRepeat"])
    $(selector).minLength = minPasswordLength;
}
function applyInterfacePreferences() {
  document.documentElement.lang = userPreferences.locale || "ru";
  document.documentElement.dataset.theme = userPreferences.colorScheme || "system";
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
  if (!matchMedia("(max-width: 760px)").matches) return;
  document.body.classList.add("mobileContentOpen");
  mobileBackButton.hidden = false;
}
function closeMobileContent() {
  document.body.classList.remove("mobileContentOpen");
  mobileBackButton.hidden = true;
}
mobileBackButton.onclick = closeMobileContent;
function directChats() {
  return conversations.filter((c) => c.kind === "direct");
}
function renderConversations() {
  const direct = directChats(),
    personalUnread = direct.reduce((n, c) => n + (c.unreadCount || 0), 0),
    groups = familyConversations(conversations, activeFamilyID),
    family = groups.find((c) => c.kind === "family"),
    favorites = groups.filter(
      (c) => c.kind === "group" && favoriteIDs.has(c.id),
    ),
    groupsUnread = groups.reduce((n, c) => n + (c.unreadCount || 0), 0),
    button = (id, title, unread, icon = "") =>
      `<button class="conversation ${active === id ? "selected" : ""}" data-id="${safe(id)}"><span class="conversationLabel">${icon ? `<span class="conversationIcon" aria-hidden="true">${safe(icon)}</span>` : ""}<span>${safe(title)}</span></span>${unread ? `<b class="unread" aria-label="Непрочитанные сообщения">${unread}</b>` : ""}</button>`;
  const sectionButton = (id, title, icon, unread = 0) => `<button class="conversation sectionLink ${active === id ? "selected" : ""}" data-id="${id}"><span class="conversationLabel"><span class="conversationIcon" aria-hidden="true">${safe(icon)}</span><span>${safe(title)}</span></span>${unread ? `<b class="unread">${unread}</b>` : ""}</button>`;
  $("#conversations").innerHTML =
    sectionButton(personalID, t("personal"), "👤", personalUnread) +
    (activeFamilyID ? `<p class="navSectionTitle">${t("family")}</p>${family ? button(family.id, t("familyChat"), family.unreadCount, "💬") : ""}${familySections.map(([id, title, , icon]) => sectionButton(id, id === shoppingID ? `${t(title)} (${shoppingCounter.plannedToday}/${shoppingCounter.total})` : t(title), icon)).join("")}<p class="navSectionTitle">${t("chats")}</p>` : "") +
    favorites.map((c) => button(c.id, c.title, c.unreadCount)).join("") +
    button(groupsID, t("allChats"), groupsUnread);
  $("#conversations").onclick = (e) => {
    const item = e.target.closest("[data-id]");
    if (item) openConversation(item.dataset.id);
  };
}
async function loadConversations() {
  const [list, favorites, shoppingItems] = await Promise.all([
    request("/conversations"),
    request("/favorites"),
    activeFamilyID ? request(`/families/${encodeURIComponent(activeFamilyID)}/shopping`).catch(() => []) : [],
  ]);
  conversations = list;
  favoriteIDs = new Set(favorites);
  shoppingCounter = summarizeShopping(shoppingItems);
  renderConversations();
  if (!active) {
    const saved = localStorage.getItem(activeConversationKey);
    if (saved === personalID || saved === groupsID || conversations.some((c) => c.id === saved)) openConversation(saved);
    else { const family = conversations.find((c) => c.kind === "family"); if (family) openConversation(family.id); }
  }
}
function messageStatus(status) {
  return {
    sent: '<span class="messageStatus sent" title="Отправлено" aria-label="Отправлено">✓</span>',
    delivered: '<span class="messageStatus delivered" title="Получено" aria-label="Получено">✓✓</span>',
    read: '<span class="messageStatus read" title="Прочитано" aria-label="Прочитано">✓✓</span>',
  }[status] || "";
}function reactionButtons(message) {
  const reactions = (message.reactions || [])
    .map(
      (r) =>
        `<button class="reaction ${r.reacted ? "reacted" : ""}" data-message="${message.id}" data-emoji="${safe(r.emoji)}">${safe(r.emoji)} ${r.count}</button>`,
    )
    .join("");
  return reactions ? `<div class="reactions">${reactions}</div>` : "";
}
function reactionAddButton(message) {
  return `<button class="reaction reactionAdd" data-message="${message.id}" data-add-reaction="true" title="Добавить реакцию" aria-label="Добавить реакцию">＋</button><button class="reaction reactionReply" data-reply-id="${message.id}" title="Ответить" aria-label="Ответить">↩</button>`;
}
function openUserCard(userID, name, avatarURL) {
  $("#profileName").textContent = name || "Пользователь";
  $("#profileDetails").textContent = userID === currentUser?.ID ? "Это ваш профиль" : "Участник семейного чата";
  const image = $("#profileAvatar");
  image.src = avatarURL || "/icon-1254.png";
  image.alt = `Фото: ${name || "пользователь"}`;
  $("#changeAvatar").hidden = userID !== currentUser?.ID;
  $("#openInterfaceSettings").hidden = userID !== currentUser?.ID;
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
  await request(`/messages/${button.dataset.message}/reactions`, {
    method: "POST",
    body: JSON.stringify({ emoji: button.dataset.emoji }),
  });
  openConversation(active);
}
async function openPersonal() {
  openMobileContent();
  const version = ++loadVersion;
  active = personalID;
  saveActive(active);
  renderConversations();
  $("#chatTitle").textContent = "Личные";
  $("#composer").hidden = true;
  $("#manageMembers").hidden = true;
  $("#messages").innerHTML = '<p class="muted">Загрузка участников…</p>';
  try {
    const contacts = await request(`/contacts?familyId=${encodeURIComponent(activeFamilyID)}`);
    if (version !== loadVersion || active !== personalID) return;
    const chats = directChats();
    $("#messages").innerHTML = contacts.length
      ? `<div class="personalList">${contacts
          .map((u) => {
            const chat = chats.find((c) => c.title === u.Name),
              unread = chat?.unreadCount || 0;
            return `<button class="personalContact" data-user-id="${safe(u.ID)}"><span>${safe(u.Name)} <small class="muted">${safe(u.familyRelationship || "Неопределено")}</small></span>${unread ? `<b class="unread">${unread}</b>` : ""}</button>`;
          })
          .join("")}</div>`
      : '<p class="muted">Других участников пока нет.</p>';
    $("#messages").onclick = (e) => {
      const item = e.target.closest("[data-user-id]");
      if (item) startDirect(item.dataset.userId);
    };
  } catch (e) {
    if (version === loadVersion)
      $("#messages").innerHTML = `<p class="error">${safe(e.message)}</p>`;
  }
}
async function openGroups() {
  openMobileContent();
  const version = ++loadVersion;
  active = groupsID;
  saveActive(active);
  renderConversations();
  $("#chatTitle").textContent = "Все группы";
  $("#composer").hidden = true;
  $("#manageMembers").hidden = true;
  $("#toggleFavorite").hidden = true;
  const groups = familyConversations(conversations, activeFamilyID);
  $("#messages").innerHTML = groups.length
    ? `<div class="personalList">${groups.map((c) => `<button class="personalContact" data-group-id="${safe(c.id)}"><span>${safe(c.title || "Семья")}</span>${c.unreadCount ? `<b class="unread">${c.unreadCount}</b>` : ""}</button>`).join("")}</div>`
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
async function openConversation(id, before = "") {
  if (id === personalID) return openPersonal();
  if (id === groupsID) return openGroups();
  if (id === childrenID || id === grandparentsID) return openFamilyCategory(id);
  if (id === shoppingID) return openShopping();
  const version = ++loadVersion;
  openMobileContent();
  active = id;
  $("#composer").hidden = false;
  saveActive(active);
  renderConversations();
  const c = conversations.find((x) => x.id === id),
    isFavorite = c?.kind === "group" && favoriteIDs.has(id);
  $("#chatTitle").textContent = c?.title || "Диалог";
  const canManageGroup = c?.familyId === activeFamilyID && canManageFamily(families, activeFamilyID);
  $("#manageMembers").hidden = c?.kind !== "group";
  $("#deleteGroup").hidden = c?.kind !== "group" || !canManageGroup;
  const canAdministerFamily = c?.kind === "family" && canManageFamily(families, activeFamilyID);
  $("#inviteFamily").hidden = !canAdministerFamily;
  $("#searchMessages").hidden = !c;
  $("#renameConversation").hidden = !(c && canManageGroup);
  $("#toggleFavorite").hidden = c?.kind !== "group";
  $("#toggleFavorite").textContent = isFavorite ? "★" : "☆";
  $("#toggleFavorite").title = isFavorite
    ? "Убрать из избранного"
    : "Добавить в избранное";
  $("#toggleFavorite").setAttribute("aria-label", $("#toggleFavorite").title);
  $("#messages").innerHTML = '<p class="muted">Загрузка сообщений…</p>';
  try {
    const page = await request(`/conversations/${encodeURIComponent(id)}/messages?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`), list = page.messages || [];
    if (version !== loadVersion || id !== active) return;
    $("#messages").innerHTML =
      (page.nextBefore ? `<button class="secondary loadOlder" data-load-older="${safe(page.nextBefore)}">Показать более ранние сообщения</button>` : "") +
      (Array.isArray(list) ? list : [])
        .map(
          (m) =>
            `<article class="message ${m.authorId === currentUser.ID ? "own" : ""}"><div class="bubble">${m.authorAvatarUrl ? `<img class="authorAvatar messageAvatar" src="${safe(m.authorAvatarUrl)}" alt="">` : ""}<button class="messageAuthor" data-user-id="${safe(m.authorId)}" data-avatar-url="${safe(m.authorAvatarUrl || "")}" data-user-name="${safe(m.authorName)}" style="--author-hue:${authorHue(m.authorName)}">${safe(m.authorName)}</button><p>${m.deletedAt ? "Сообщение удалено" : safe(m.body)}</p>${(m.attachments || []).map((a) => `<p><a href="${api}/attachments/${encodeURIComponent(a.id)}" target="_blank" rel="noopener">📎 ${safe(a.filename)}</a></p>`).join("")}${m.deletedAt ? "" : reactionButtons(m)}<small class="messageMeta">${new Date(m.createdAt).toLocaleString("ru-RU")}${m.editedAt ? " · изменено" : ""}${m.status ? messageStatus(m.status) : ""}${m.deletedAt ? "" : reactionAddButton(m)}</small></div></article>`,
        )
        .join("") || '<p class="muted">Сообщений пока нет.</p>';
    $("#messages").onclick = handleMessages;
    $("#messages").scrollTop = $("#messages").scrollHeight;
    loadConversations().catch(() => {});
  } catch (e) {
    if (version === loadVersion)
      $("#messages").innerHTML = `<p class="error">${safe(e.message)}</p>`;
  }
}

async function openFamilyCategory(sectionID) {
  const definition = familySections.find(([id]) => id === sectionID);
  if (!definition || !activeFamilyID) return;
  const [, title, category] = definition;
  openMobileContent();
  active = sectionID; saveActive(active); renderConversations();
  $("#chatTitle").textContent = t(title);
  $("#composer").hidden = true;
  $("#messages").innerHTML = '<p class="muted">Загрузка участников…</p>';
  try {
    const familyConversation = conversations.find((conversation) => conversation.kind === "family" && conversation.familyId === activeFamilyID);
    const members = familyConversation ? await request(`/conversations/${encodeURIComponent(familyConversation.id)}/members`) : [];
    const filtered = members.filter((member) => member.familyCategories?.includes(category));
    $("#messages").innerHTML = filtered.length ? `<div class="familyDirectory">${filtered.map((member) => `<button class="personalContact" data-user-id="${safe(member.ID)}"><span><strong>${safe(member.Name)}</strong><small class="muted">${safe(member.familyRelationship || "")}</small></span><span>Написать</span></button>`).join("")}</div>` : '<section class="emptyState"><h3>Пока никого нет</h3><p>Владелец семьи может назначить эту категорию в управлении семьёй.</p></section>';
    $("#messages").onclick = (event) => { const userID = event.target.closest("[data-user-id]")?.dataset.userId; if (userID) startDirect(userID); };
  } catch (error) { $("#messages").innerHTML = `<p class="error">${safe(error.message)}</p>`; }
}

async function openShopping() {
  openMobileContent();
  active = shoppingID; saveActive(active); renderConversations();
  $("#chatTitle").textContent = t("shopping");
  $("#composer").hidden = true;
  $("#messages").innerHTML = '<p class="muted">Загрузка покупок…</p>';
  try {
    const items = await request(`/families/${encodeURIComponent(activeFamilyID)}/shopping`);
    shoppingCounter = summarizeShopping(items);
    renderConversations();
    const pending = items.filter((item) => !item.completedAt), done = items.filter((item) => item.completedAt);
    const plannedDateValue = (item) => item.plannedDate ? item.plannedDate.slice(0, 10) : "";
    const today = new Date(), todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const renderItem = (item) => `<li class="shoppingItem ${item.completedAt ? "completed" : ""}"><label class="shoppingCheck"><input type="checkbox" data-shopping-toggle="${safe(item.id)}" ${item.completedAt ? "checked" : ""}><span>${safe(item.title)}</span></label><label class="shoppingItemDate"><span class="visuallyHidden">Плановая дата для ${safe(item.title)}</span><input type="date" data-shopping-date="${safe(item.id)}" value="${safe(plannedDateValue(item))}" aria-label="Плановая дата покупки: ${safe(item.title)}"></label>${(item.createdBy === currentUser.ID || canManageFamily(families, activeFamilyID)) ? `<button class="secondary" data-shopping-delete="${safe(item.id)}" aria-label="Удалить покупку">×</button>` : ""}</li>`;
    $("#messages").innerHTML = `<section class="shopping"><form id="shoppingForm" class="shoppingAdd"><label class="shoppingTitleField"><span class="visuallyHidden">Добавить покупку</span><input id="shoppingTitle" maxlength="160" placeholder="Добавить покупку" required></label><label class="shoppingDateField">Дата<input id="shoppingDate" type="date" value="${todayValue}" required></label><button>Добавить</button></form><h3>Купить</h3><ul>${pending.map(renderItem).join("") || '<li class="muted">Список пуст.</li>'}</ul>${done.length ? `<details><summary>Куплено: ${done.length}</summary><ul>${done.map(renderItem).join("")}</ul></details>` : ""}</section>`;
    $("#shoppingForm").onsubmit = async (event) => { event.preventDefault(); const title = $("#shoppingTitle").value.trim(), plannedDate = $("#shoppingDate").value; if (!title || !plannedDate) return; try { await request(`/families/${encodeURIComponent(activeFamilyID)}/shopping`, { method: "POST", body: JSON.stringify({ title, plannedDate }) }); announce("Покупка добавлена"); openShopping(); } catch (error) { announce(error.message, "error"); } };
    $("#messages").onchange = async (event) => { const toggleID = event.target.dataset.shoppingToggle, dateID = event.target.dataset.shoppingDate; if (!toggleID && !dateID) return; try { if (toggleID) await request(`/families/${encodeURIComponent(activeFamilyID)}/shopping/${encodeURIComponent(toggleID)}`, { method: "PATCH", body: JSON.stringify({ completed: event.target.checked }) }); else { if (!event.target.value) throw Error("Укажите плановую дату покупки"); await request(`/families/${encodeURIComponent(activeFamilyID)}/shopping/${encodeURIComponent(dateID)}`, { method: "PATCH", body: JSON.stringify({ plannedDate: event.target.value }) }); } openShopping(); } catch (error) { announce(error.message, "error"); openShopping(); } };
    $("#messages").onclick = async (event) => { const id = event.target.dataset.shoppingDelete; if (!id) return; if (!await confirmAction({ title: "Удалить покупку?", message: "Позиция будет удалена из списка.", confirmLabel: "Удалить", destructive: true })) return; try { await request(`/families/${encodeURIComponent(activeFamilyID)}/shopping/${encodeURIComponent(id)}`, { method: "DELETE" }); openShopping(); } catch (error) { announce(error.message, "error"); } };
  } catch (error) { $("#messages").innerHTML = `<p class="error">${safe(error.message)}</p>`; }
}
function renderAttachments() {
  $("#attachmentList").textContent = pendingFiles.length
    ? pendingFiles.map((file) => file.name).join(", ")
    : "";
}
async function uploadAttachment(file) {
  const r = await fetch(`${api}/attachments`, {
    method: "POST",
    credentials: "include",
    headers: {
      "X-Filename": file.name,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
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
  $("#newGroup").hidden = !canManageFamily(families, activeFamilyID);
	$("#manageCurrentFamily").hidden = !canManageFamily(families, activeFamilyID);
	$("#currentFamilyTitle").textContent = families.find((f) => f.id === activeFamilyID)?.title || "Без семьи";
	$("#currentFamilyRole").textContent = ({ owner: "Владелец", admin: "Администратор", member: "Участник" })[families.find((f) => f.id === activeFamilyID)?.role] || "";
  selector.hidden = families.length < 2;
  selector.onchange = async () => {
    activeFamilyID = selector.value;
    localStorage.setItem(activeFamilyKey, activeFamilyID);
    active = null;
		$("#currentFamilyTitle").textContent = families.find((f) => f.id === activeFamilyID)?.title || "Без семьи";
		$("#currentFamilyRole").textContent = ({ owner: "Владелец", admin: "Администратор", member: "Участник" })[families.find((f) => f.id === activeFamilyID)?.role] || "";
    localStorage.removeItem(activeConversationKey);
    $("#newGroup").hidden = !canManageFamily(families, activeFamilyID);
		$("#manageCurrentFamily").hidden = !canManageFamily(families, activeFamilyID);
    await loadConversations();
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
}
async function openAdmin() {
  try {
    const [users, settings] = await Promise.all([request("/users"), request("/application/settings")]);
    $("#minPasswordLength").value = settings.minPasswordLength;
    $("#applicationSettingsError").textContent = "";
    $("#users").innerHTML = users
      .map((u) => {
        const admin = !!u.Permissions?.manage_application;
        return `<li><strong>${safe(u.Name)}</strong><small>${safe(u.Email)}</small>${admin ? "<small>Администратор приложения</small>" : ""}${u.ID === currentUser.ID ? "" : `<button class="toggleAdmin secondary" data-toggle-admin="${safe(u.ID)}">${admin ? "Снять права администратора" : "Сделать администратором"}</button>`}<button class="secondary" data-edit-permissions="${safe(u.ID)}">Права приложения</button></li>`;
      })
      .join("");
    $("#users").onclick = async (e) => {
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
        await openAdmin();
      } catch (e) { announce(e.message, "error"); }
    };
    $("#applicationAdminDialog").showModal();
  } catch (e) { announce(e.message, "error"); }
}
function openApplicationPermissions(user) {
  editingApplicationUser = user;
  $("#permissionsTitle").textContent = `Права приложения: ${user.Name}`;
  const items = [
    ["manage_application", "Администратор приложения", "Открывает раздел администрирования и позволяет назначать права всем пользователям."],
    ["send_messages", "Отправка сообщений", "Позволяет писать сообщения в доступных чатах и отправлять вложения."],
    ["edit_own_messages", "Изменение своих сообщений", "Позволяет исправлять только собственные отправленные сообщения."],
    ["delete_own_messages", "Удаление своих сообщений", "Позволяет помечать собственные сообщения как удалённые."],
    ["create_groups", "Создание групп", "Позволяет создавать групповые чаты в семьях, где у пользователя есть роль администратора."],
    ["manage_group_members", "Участники групп", "Позволяет добавлять и удалять участников групп в администрируемой семье."],
    ["manage_group_settings", "Настройки групп", "Позволяет менять название и архивировать группы в администрируемой семье."],
  ];
  $("#permissionList").innerHTML = items.map(([value, label, help]) => `<label><input type="checkbox" value="${value}" ${user.Permissions?.[value] ? "checked" : ""}><span><strong>${label}</strong><small>${help}</small></span></label>`).join("");
  $("#permissionsDialog").showModal();
}
async function openMembers() {
  if (!active || active === personalID) return;
  try {
    const conversation = conversations.find((item) => item.id === active);
    const canManage = conversation?.familyId === activeFamilyID && canManageFamily(families, activeFamilyID);
    const members = await request(`/conversations/${active}/members`);
    const candidates = canManage ? await request(`/conversations/${active}/member-candidates`) : [];
    const ids = new Set(members.map((u) => u.ID));
    $("#membersTitle").textContent = canManage ? "Участники группы" : "Состав группы";
    $("#memberCandidateLabel").hidden = !canManage;
    $("#addMember").hidden = !canManage;
    $("#groupMembers").innerHTML = members
      .map(
        (u) =>
          `<li><strong>${safe(u.Name)}</strong>${u.Email ? `<small>${safe(u.Email)}</small>` : ""}${canManage && u.ID !== currentUser.ID ? `<button class="removeMember secondary" data-id="${safe(u.ID)}">Удалить</button>` : ""}</li>`,
      )
      .join("");
    const options = candidates
      .filter((u) => !ids.has(u.ID))
      .map(
        (u) =>
          `<option value="${safe(u.ID)}">${safe(u.Name)} — ${safe(u.Email)}</option>`,
      )
      .join("");
    $("#memberSelect").innerHTML =
      options || '<option value="">Нет доступных пользователей</option>';
    $("#addMember").disabled = !options || !canManage;
    $("#groupMembers").onclick = async (e) => {
      if (!canManage || !e.target.dataset.id)
        return;
      if (!await confirmAction({ title: "Удалить участника?", message: "Он потеряет доступ к этой группе, но останется в семье.", confirmLabel: "Удалить", destructive: true })) return;
      try {
        await request(`/conversations/${active}/members/${encodeURIComponent(e.target.dataset.id)}`, { method: "DELETE" });
        announce("Участник удалён из группы");
        openMembers();
        loadConversations();
      } catch (error) { $("#memberError").textContent = error.message; }
    };
    $("#membersDialog").showModal();
  } catch (error) { announce(error.message, "error"); }
}
async function openFamilyManagement() {
  if (!canManageFamily(families, activeFamilyID)) return;
  const familyConversation = conversations.find((conversation) => conversation.kind === "family" && conversation.familyId === activeFamilyID);
  if (!familyConversation) return;
  try {
    const members = await request(`/conversations/${encodeURIComponent(familyConversation.id)}/members`);
    const family = activeFamily(families, activeFamilyID);
    familyManagerIsOwner = family?.role === "owner";
    familyMemberSelection = new Set();
    familyMemberDrafts = new Map(members.map((user) => [user.ID, { ...user, familyCategories: [...(user.familyCategories || [])].sort(), original: JSON.stringify({ role: user.familyRole, relationship: user.familyRelationship || "Неопределено", categories: [...(user.familyCategories || [])].sort() }) }]));
    $("#familyAdminTitle").textContent = `Семья: ${family?.title || ""}`;
    $("#familyAdminError").textContent = "";
    $("#familyBulkEdit").hidden = !familyManagerIsOwner;
    $("#familyBulkCategories").innerHTML = familyCategoryDefinitions.map(([value, label]) => `<label><input type="checkbox" value="${value}"> ${label}</label>`).join("");
    $("#familyMemberSearch").value = "";
    $("#familyMemberRoleFilter").value = "";
    $("#familyMemberCategoryFilter").value = "";
    renderFamilyMembers();
    $("#familyAdminDialog").showModal();
  } catch (error) { announce(error.message, "error"); }
}

function familyDraftDirty(draft) {
  return JSON.stringify({ role: draft.familyRole, relationship: draft.familyRelationship || "Неопределено", categories: [...(draft.familyCategories || [])].sort() }) !== draft.original;
}
function updateFamilyDirtyState() {
  const dirty = [...familyMemberDrafts.values()].some(familyDraftDirty);
  $("#familyDirtyNotice").hidden = !dirty;
  $("#saveAllFamilyMembers").hidden = !dirty;
}
function renderFamilyMembers() {
  const query = $("#familyMemberSearch").value.trim().toLocaleLowerCase();
  const role = $("#familyMemberRoleFilter").value, category = $("#familyMemberCategoryFilter").value;
  const visible = [...familyMemberDrafts.values()].filter((user) => {
    const categories = user.familyCategories || [];
    return (!query || `${user.Name} ${user.Email}`.toLocaleLowerCase().includes(query)) && (!role || user.familyRole === role) && (!category || (category === "none" ? !categories.length : categories.includes(category)));
  });
  $("#familyMembers").innerHTML = visible.length ? visible.map((user) => `
    <li class="familyMemberEditor" data-family-member="${safe(user.ID)}">
      ${familyManagerIsOwner ? `<label class="familySelection"><input type="checkbox" data-family-select="${safe(user.ID)}" ${familyMemberSelection.has(user.ID) ? "checked" : ""}> Выбрать</label>` : ""}
      <strong>${safe(user.Name)}</strong><small>${safe(user.Email)}</small>
      <label>Роль доступа<select data-family-role="${safe(user.ID)}" ${familyManagerIsOwner ? "" : "disabled"}>
        <option value="owner" ${user.familyRole === "owner" ? "selected" : ""}>Владелец</option><option value="admin" ${user.familyRole === "admin" ? "selected" : ""}>Администратор семьи</option><option value="member" ${user.familyRole !== "owner" && user.familyRole !== "admin" ? "selected" : ""}>Участник</option>
      </select>${familyManagerIsOwner ? "" : "<small>Роли и категории меняет только владелец семьи.</small>"}</label>
      <fieldset class="familyCategories"><legend>Категории <small>необязательно</small></legend>${familyCategoryDefinitions.map(([value, label]) => `<label><input type="checkbox" data-family-category="${safe(user.ID)}" value="${value}" ${user.familyCategories?.includes(value) ? "checked" : ""} ${familyManagerIsOwner ? "" : "disabled"}> ${label}</label>`).join("")}</fieldset>
      <label>Отображаемый статус<input data-family-relationship="${safe(user.ID)}" maxlength="80" value="${safe(user.familyRelationship || "Неопределено")}"></label>
      <button type="button" class="secondary" data-save-family-user="${safe(user.ID)}" ${familyDraftDirty(user) ? "" : "disabled"}>Сохранить</button>
    </li>`).join("") : '<li class="muted">Подходящих участников нет.</li>';
  updateFamilyDirtyState();
}
async function saveFamilyMember(userID, button) {
  const draft = familyMemberDrafts.get(userID);
  if (!draft || !familyDraftDirty(draft)) return;
  try {
    await withBusy(button, "Сохраняем…", async () => request(`/families/${encodeURIComponent(activeFamilyID)}/members/${encodeURIComponent(userID)}`, { method: "PATCH", body: JSON.stringify({ role: draft.familyRole, relationship: draft.familyRelationship, categories: familyManagerIsOwner ? draft.familyCategories : undefined }) }));
    draft.original = JSON.stringify({ role: draft.familyRole, relationship: draft.familyRelationship || "Неопределено", categories: [...(draft.familyCategories || [])].sort() });
    announce("Изменения сохранены");
    renderFamilyMembers();
  } catch (error) { $("#familyAdminError").textContent = error.message; }
}
function keyBytes(key) {
  const value = (key + "=".repeat((4 - (key.length % 4)) % 4))
      .replace(/-/g, "+")
      .replace(/_/g, "/"),
    raw = atob(value);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function configurePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const button = $("#pushSettings"),
    registration = await navigator.serviceWorker.register("/sw.js");
  let subscription = await registration.pushManager.getSubscription();
  button.hidden = false;
  button.textContent = subscription
    ? "Уведомления: вкл."
    : "Включить уведомления";
  button.onclick = async () => {
    try {
      if (subscription) {
        await request("/push/subscriptions", {
          method: "DELETE",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
        subscription = null;
        button.textContent = "Включить уведомления";
        return;
      }
      if ((await Notification.requestPermission()) !== "granted")
        throw Error("Разрешение на уведомления не получено");
      const key = await request("/push/public-key");
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(key.publicKey),
      });
      await request("/push/subscriptions", {
        method: "POST",
        body: JSON.stringify(subscription),
      });
      button.textContent = "Уведомления: вкл.";
    } catch (e) { announce(e.message, "error"); }
  };
}
$("#closeProfile").onclick = () => $("#profileDialog").close();
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
    currentUser.AvatarURL = `${result.avatarUrl}?v=${Date.now()}`;
    $("#profileAvatar").src = currentUser.AvatarURL;
    event.target.value = "";
  } catch (error) { announce(error.message, "error"); }
};
$("#openUserMenu").onclick = () => $("#userMenuDialog").showModal();
$("#myProfile").onclick = () => { $("#userMenuDialog").close(); openUserCard(currentUser.ID, currentUser.Name, currentUser.AvatarURL); };
$("#openInterfaceSettings").onclick = () => { $("#interfaceSettingsForm").hidden = !$("#interfaceSettingsForm").hidden; };
$("#interfaceSettingsForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    userPreferences = await withBusy(event.submitter, "Сохраняем…", async () => request("/user/preferences", { method: "PUT", body: JSON.stringify({ locale: $("#interfaceLocale").value, colorScheme: $("#interfaceColorScheme").value }) }));
    applyInterfacePreferences();
    renderConversations();
    $("#interfaceSettingsError").textContent = "Настройки интерфейса сохранены";
  } catch (error) { $("#interfaceSettingsError").textContent = error.message; }
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
    openConversation(active);
  } catch (e) { announce(e.message, "error"); }
};
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
$("#savePermissions").onclick = async (event) => { event.preventDefault(); if (!editingApplicationUser) return; const permissions = [...$("#permissionList").querySelectorAll("input:checked")].map((input) => input.value); try { await withBusy(event.currentTarget, "Сохраняем…", async () => request(`/users/${encodeURIComponent(editingApplicationUser.ID)}/permissions`, { method: "PATCH", body: JSON.stringify({ permissions }) })); $("#permissionsDialog").close(); announce("Права приложения сохранены"); await openAdmin(); } catch (error) { announce(error.message, "error"); } };
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
$("#openCreateFamily").onclick = () => { $("#familyMenuDialog").close(); $("#newFamily").click(); };
$("#createFirstFamily").onclick = () => $("#newFamily").click();
$("#manageCurrentFamily").onclick = () => { $("#familyMenuDialog").close(); openFamilyManagement(); };
for (const selector of ["#familyMemberSearch", "#familyMemberRoleFilter", "#familyMemberCategoryFilter"]) {
  $(selector).oninput = renderFamilyMembers;
  $(selector).onchange = renderFamilyMembers;
}
$("#familyMembers").onchange = (event) => {
  const target = event.target, userID = target.closest("[data-family-member]")?.dataset.familyMember;
  if (!userID) return;
  const draft = familyMemberDrafts.get(userID);
  if (!draft) return;
  if (target.dataset.familySelect) {
    if (target.checked) familyMemberSelection.add(userID); else familyMemberSelection.delete(userID);
  } else if (target.dataset.familyRole) draft.familyRole = target.value;
  else if (target.dataset.familyRelationship) draft.familyRelationship = target.value;
  else if (target.dataset.familyCategory) draft.familyCategories = [...document.querySelectorAll(`[data-family-category="${CSS.escape(userID)}"]:checked`)].map((input) => input.value).sort();
  const save = target.closest("[data-family-member]")?.querySelector("[data-save-family-user]");
  if (save) save.disabled = !familyDraftDirty(draft);
  updateFamilyDirtyState();
};
$("#familyMembers").onclick = (event) => { const button = event.target.closest("[data-save-family-user]"); if (button) saveFamilyMember(button.dataset.saveFamilyUser, button); };
$("#applyBulkCategories").onclick = () => {
  const categories = [...$("#familyBulkCategories").querySelectorAll("input:checked")].map((input) => input.value).sort();
  for (const userID of familyMemberSelection) { const draft = familyMemberDrafts.get(userID); if (draft) draft.familyCategories = categories; }
  renderFamilyMembers();
};
$("#saveAllFamilyMembers").onclick = async (event) => {
  const dirty = [...familyMemberDrafts.values()].filter(familyDraftDirty);
  try { await withBusy(event.currentTarget, "Сохраняем…", async () => { for (const draft of dirty) await saveFamilyMember(draft.ID, null); }); announce("Все изменения сохранены"); } catch (error) { $("#familyAdminError").textContent = error.message; }
};
async function closeFamilyAdministration() {
  if ([...familyMemberDrafts.values()].some(familyDraftDirty) && !await confirmAction({ title: "Закрыть без сохранения?", message: "Несохранённые изменения будут потеряны.", confirmLabel: "Закрыть", destructive: true })) return;
  $("#familyAdminDialog").close();
}
$("#closeFamilyAdmin").onclick = closeFamilyAdministration;
$("#familyAdminDialog").oncancel = (event) => { event.preventDefault(); closeFamilyAdministration(); };
$("#inviteFamily").onclick = () => { const family = activeFamily(families, activeFamilyID); if (!family) return; $("#familyInviteFamily").textContent = `Семья: ${family.title}`; $("#familyInviteError").textContent = ""; $("#familyInviteToken").hidden = true; $("#familyInviteDialog").showModal(); };
$("#closeFamilyInvite").onclick = () => $("#familyInviteDialog").close();
$("#familyInviteForm").onsubmit = async (event) => { event.preventDefault(); try { const invite = await request("/invitations", { method: "POST", body: JSON.stringify({ email: $("#familyInviteEmail").value.trim(), familyId: activeFamilyID, familyRole: $("#familyInviteRole").value, relationship: $("#familyInviteRelationship").value.trim() || "Неопределено", permissions: ["send_messages", "edit_own_messages", "delete_own_messages", "create_groups"] }) }); $("#familyInviteTokenText").textContent = `Одноразовый код: ${invite.token}`; $("#familyInviteToken").hidden = false; $("#familyInviteEmail").value = ""; $("#familyInviteError").textContent = invite.mailSent === false ? "Приглашение создано, но письмо не отправлено. Передайте код вручную." : ""; } catch (error) { $("#familyInviteError").textContent = error.message; } };
$("#copyFamilyInviteToken").onclick = async () => { const code = $("#familyInviteTokenText").textContent.replace("Одноразовый код: ", ""); if (!code) return; try { await navigator.clipboard.writeText(code); $("#copyFamilyInviteToken").textContent = "Скопировано"; setTimeout(() => { $("#copyFamilyInviteToken").textContent = "Скопировать"; }, 1500); } catch { $("#familyInviteError").textContent = "Не удалось скопировать код. Скопируйте его вручную."; } };
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
  await request("/auth/logout", { method: "POST" });
  location.reload();
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
    openConversation(active);
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
    await withBusy(e.submitter, "Создаём…", async () => request("/conversations", { method: "POST", body: JSON.stringify({ title, memberIds: [], familyId: activeFamilyID }) }));
    $("#groupDialog").close(); $("#groupTitle").value = ""; active = null; await loadConversations(); announce("Группа создана");
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
    await request("/auth/register", { method:"POST", body:JSON.stringify({email:$("#registerEmail").value.trim(),name:$("#registerName").value.trim(),password:$("#registerPassword").value}) });
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
  pendingFiles = [...e.target.files];
  renderAttachments();
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
  await request(`/messages/${reactionTarget}/reactions`, {
    method: "POST",
    body: JSON.stringify({ emoji }),
  });
  $("#reactionPicker").hidden = true;
  reactionTarget = null;
  openConversation(active);
};
let pressTimer,
  longPress = false;
const send = $("#sendButton");
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
  if (!active || active === personalID || (!body && !pendingFiles.length))
    return;
  send.disabled = true;
  try {
    const attachments = [];
    for (const file of pendingFiles)
      attachments.push(await uploadAttachment(file));
    await request(`/conversations/${active}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, attachments }),
    });
    $("#body").value = "";
    $("#attachmentFiles").value = "";
    pendingFiles = [];
    renderAttachments();
    openConversation(active);
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
    socket = new WebSocket(`${scheme}://${location.host}/api/v1/events`);
  socket.onmessage = async (message) => {
    try {
      const event = JSON.parse(message.data);
      if (event.type === "message.created" && event.conversationId)
        await request(`/conversations/${encodeURIComponent(event.conversationId)}/delivery`, { method: "POST" }).catch(() => {});
      if (event.type === "message.created" && event.conversationId === active)
        $("#messageAnnouncements").textContent = "Получено новое сообщение";
      if (event.type === "shopping.changed" && active === shoppingID) {
        await openShopping();
        return;
      }
      await loadConversations();
      if (active === personalID) await openPersonal();
      else if (active && (!event.conversationId || active === event.conversationId)) await openConversation(active);
    } catch (_) {}
  };
  socket.onclose = () => setTimeout(connectEvents, 2000);
}

let replyDraft = null;
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-reply-id]");
  if (!button) return;
  const article = button.closest(".message");
  replyDraft = {
    author: article?.querySelector("strong")?.textContent || "Сообщение",
    body: article?.querySelector("p")?.textContent || "",
  };
  const preview = $("#replyPreview");
  if (preview) {
    preview.hidden = false;
    preview.textContent = `Ответ: ${replyDraft.author}: ${replyDraft.body}`;
  }
  $("#body").focus();
});
document.addEventListener("pointerdown", (event) => {
  const menu = $("#sendMenu");
  if (!menu.hidden && !event.target.closest("#sendMenu") && !event.target.closest("#sendButton")) menu.hidden = true;
});
$("#composer").addEventListener(
  "submit",
  () => {
    if (!replyDraft) return;
    const body = $("#body");
    body.value = `↩ ${replyDraft.author}: ${replyDraft.body.slice(0, 120)}\n${body.value}`;
    replyDraft = null;
    const preview = $("#replyPreview");
    if (preview) preview.hidden = true;
  },
  true,
);
