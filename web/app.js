import { api, $, request, safe } from "./api.js";
import { activeFamily, canManageFamily, familyConversations } from "./family-context.js";
const personalID = "__personal__",
  groupsID = "__groups__";
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
const familyCategoryDefinitions = [
  ["child", "Ребёнок"],
  ["parent", "Родитель"],
  ["grandparent", "Бабушка / дедушка"],
  ["guardian", "Опекун"],
  ["relative", "Родственник"],
];
let minPasswordLength = 12;
function applyPasswordPolicy(policy) {
  minPasswordLength = policy.minPasswordLength || 12;
  for (const selector of ["#registerPassword", "#invitePassword", "#invitePasswordRepeat", "#newPassword", "#newPasswordRepeat"])
    $(selector).minLength = minPasswordLength;
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
function saveActive(id) { if (id) localStorage.setItem(activeConversationKey, id); }
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
    button = (id, title, unread) =>
      `<button class="conversation ${active === id ? "selected" : ""}" data-id="${safe(id)}"><span>${safe(title)}</span>${unread ? `<b class="unread" aria-label="Непрочитанные сообщения">${unread}</b>` : ""}</button>`;
  $("#conversations").innerHTML =
    (family ? button(family.id, "Семья", family.unreadCount) : "") +
    button(personalID, "Личные", personalUnread) +
    favorites.map((c) => button(c.id, c.title, c.unreadCount)).join("") +
    button(groupsID, "Все группы", groupsUnread);
  $("#conversations").onclick = (e) => {
    const item = e.target.closest("[data-id]");
    if (item) openConversation(item.dataset.id);
  };
}
async function loadConversations() {
  const [list, favorites] = await Promise.all([
    request("/conversations"),
    request("/favorites"),
  ]);
  conversations = list;
  favoriteIDs = new Set(favorites);
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
  const version = ++loadVersion;
  active = personalID;
  saveActive(active);
  renderConversations();
  $("#chatTitle").textContent = "Личные";
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
            return `<button class="personalContact" data-user-id="${safe(u.ID)}"><span>${safe(u.Name)} <small class="muted">${safe(u.FamilyRelationship || "Неопределено")}</small></span>${unread ? `<b class="unread">${unread}</b>` : ""}</button>`;
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
  const version = ++loadVersion;
  active = groupsID;
  saveActive(active);
  renderConversations();
  $("#chatTitle").textContent = "Все группы";
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
  const version = ++loadVersion;
  active = id;
  saveActive(active);
  renderConversations();
  const c = conversations.find((x) => x.id === id),
    isFavorite = c?.kind === "group" && favoriteIDs.has(id);
  $("#chatTitle").textContent = c?.title || "Диалог";
  $("#manageMembers").hidden = c?.kind !== "group"; $("#deleteGroup").hidden = c?.kind !== "group";
  const canAdministerFamily = c?.kind === "family" && canManageFamily(families, activeFamilyID);
  $("#inviteFamily").hidden = !canAdministerFamily;
  $("#searchMessages").hidden = !c;
  $("#renameConversation").hidden = !(c && c.familyId === activeFamilyID && canManageFamily(families, activeFamilyID));
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
  [currentUser, families] = await Promise.all([request("/auth/me"), request("/families")]);
  activeFamilyID = families[0]?.id || "";
  const selector = $("#familySelect");
  selector.innerHTML = families.map((f) => `<option value="${safe(f.id)}">${safe(f.title)}</option>`).join("");
  $("#newGroup").hidden = !canManageFamily(families, activeFamilyID);
	$("#manageCurrentFamily").hidden = !canManageFamily(families, activeFamilyID);
	$("#currentFamilyTitle").textContent = families.find((f) => f.id === activeFamilyID)?.title || "Без семьи";
  selector.hidden = families.length < 2;
  selector.onchange = async () => {
    activeFamilyID = selector.value;
    active = null;
		$("#currentFamilyTitle").textContent = families.find((f) => f.id === activeFamilyID)?.title || "Без семьи";
    localStorage.removeItem(activeConversationKey);
    $("#newGroup").hidden = !canManageFamily(families, activeFamilyID);
		$("#manageCurrentFamily").hidden = !canManageFamily(families, activeFamilyID);
    await loadConversations();
  };
  $("#currentUserName").textContent = currentUser.Name || "Пользователь";
  $("#currentUserHeader").textContent = currentUser.Name || "Пользователь";
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
      if (index < 0) permissions.push("manage_application");
      else permissions.splice(index, 1);
      try {
        await request(`/users/${encodeURIComponent(userID)}/permissions`, {
          method: "PATCH",
          body: JSON.stringify({ permissions }),
        });
        await openAdmin();
      } catch (e) {
        alert(e.message);
      }
    };
    $("#applicationAdminDialog").showModal();
  } catch (e) {
    alert(e.message);
  }
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
    const [members, candidates] = await Promise.all([
        request(`/conversations/${active}/members`),
        request(`/conversations/${active}/member-candidates`),
      ]),
      ids = new Set(members.map((u) => u.ID));
    $("#membersDialog h2").textContent = "Участники группы";
    $("#memberSelect").closest("label").hidden = false;
    $("#addMember").hidden = false;
    $("#groupMembers").innerHTML = members
      .map(
        (u) =>
          `<li><strong>${safe(u.Name)}</strong><small>${safe(u.Email)}</small>${u.ID === currentUser.ID ? "" : `<button class="removeMember secondary" data-id="${safe(u.ID)}">Удалить</button>`}</li>`,
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
    $("#addMember").disabled = !options;
    $("#groupMembers").onclick = async (e) => {
      if (!e.target.dataset.id || !confirm("Удалить участника из группы?"))
        return;
      await request(
        `/conversations/${active}/members/${encodeURIComponent(e.target.dataset.id)}`,
        { method: "DELETE" },
      );
      openMembers();
      loadConversations();
    };
    $("#membersDialog").showModal();
  } catch (e) { alert(e.message); }
}
async function openFamilyManagement() {
  if (!canManageFamily(families, activeFamilyID)) return;
  const familyConversation = conversations.find((conversation) => conversation.kind === "family" && conversation.familyId === activeFamilyID);
  if (!familyConversation) return;
  try {
    const members = await request(`/conversations/${encodeURIComponent(familyConversation.id)}/members`);
    const family = activeFamily(families, activeFamilyID);
    const isOwner = family?.role === "owner";
    $("#familyAdminTitle").textContent = `Семья: ${family?.title || ""}`;
    $("#familyAdminError").textContent = "";
    $("#familyAdminError").className = "";
    $("#familyMembers").innerHTML = members.map((user) => `
      <li class="familyMemberEditor">
        <strong>${safe(user.Name)}</strong><small>${safe(user.Email)}</small>
        <label>Роль в семье<select data-family-role="${safe(user.ID)}" ${isOwner ? "" : "disabled"}>
          <option value="owner" ${user.FamilyRole === "owner" ? "selected" : ""}>Владелец</option>
          <option value="admin" ${user.FamilyRole === "admin" ? "selected" : ""}>Администратор семьи</option>
          <option value="member" ${user.FamilyRole !== "owner" && user.FamilyRole !== "admin" ? "selected" : ""}>Участник</option>
        </select>${isOwner ? "" : "<small>Роли изменяет только владелец семьи.</small>"}</label>
        <fieldset class="familyCategories"><legend>Категории</legend>${familyCategoryDefinitions.map(([value, label]) => `<label><input type="checkbox" data-family-category="${safe(user.ID)}" value="${value}" ${user.FamilyCategories?.includes(value) ? "checked" : ""} ${isOwner ? "" : "disabled"}> ${label}</label>`).join("")}${isOwner ? "" : "<small>Категории назначает только владелец семьи.</small>"}</fieldset>
        <label>Отображаемый статус<input data-family-relationship="${safe(user.ID)}" maxlength="80" value="${safe(user.FamilyRelationship || "Неопределено")}"></label>
        <button type="button" class="secondary" data-save-family-user="${safe(user.ID)}">Сохранить</button>
      </li>`).join("");
    $("#familyMembers").onclick = async (event) => {
      const userID = event.target.dataset.saveFamilyUser;
      if (!userID) return;
      const role = document.querySelector(`[data-family-role="${CSS.escape(userID)}"]`).value;
      const relationship = document.querySelector(`[data-family-relationship="${CSS.escape(userID)}"]`).value;
      const categories = isOwner ? [...document.querySelectorAll(`[data-family-category="${CSS.escape(userID)}"]:checked`)].map((input) => input.value) : undefined;
      try {
        await request(`/families/${encodeURIComponent(activeFamilyID)}/members/${encodeURIComponent(userID)}`, {
          method: "PATCH", body: JSON.stringify({ role, relationship, categories }),
        });
        $("#familyAdminError").textContent = "Изменения сохранены";
        $("#familyAdminError").className = "success";
      } catch (error) { $("#familyAdminError").textContent = error.message; $("#familyAdminError").className = "error"; }
    };
    $("#familyAdminDialog").showModal();
  } catch (error) { $("#familyAdminError").textContent = error.message; $("#familyAdminError").className = "error"; }
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
    } catch (e) {
      alert(e.message);
    }
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
  if (!/image\/(jpeg|png|webp)/.test(file.type) || file.size > 2 * 1024 * 1024) { alert("Выберите JPEG, PNG или WebP размером до 2 МБ"); return; }
  try {
    const response = await fetch(`${api}/auth/avatar`, { method: "POST", credentials: "include", headers: { "Content-Type": file.type }, body: file });
    const result = await response.json().catch(() => ({})); if (!response.ok) throw Error(result.error || "Не удалось сохранить фото");
    currentUser.AvatarURL = `${result.avatarUrl}?v=${Date.now()}`;
    $("#profileAvatar").src = currentUser.AvatarURL;
    event.target.value = "";
  } catch (error) { alert(error.message); }
};
$("#openUserMenu").onclick = () => $("#userMenuDialog").showModal();
$("#myProfile").onclick = () => { $("#userMenuDialog").close(); openUserCard(currentUser.ID, currentUser.Name, currentUser.AvatarURL); };
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
  } catch (e) {
    alert(e.message);
  }
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
$("#savePermissions").onclick = async (event) => { event.preventDefault(); if (!editingApplicationUser) return; const permissions = [...$("#permissionList").querySelectorAll("input:checked")].map((input) => input.value); try { await request(`/users/${encodeURIComponent(editingApplicationUser.ID)}/permissions`, { method: "PATCH", body: JSON.stringify({ permissions }) }); $("#permissionsDialog").close(); await openAdmin(); } catch (error) { alert(error.message); } };
$("#newFamily").onclick = () => {
  $("#parentFamily").innerHTML = '<option value="">Независимая семья</option>' + families.map((family) => `<option value="${safe(family.id)}" ${family.id === activeFamilyID ? "selected" : ""}>${safe(family.title)}</option>`).join("");
  $("#userMenuDialog").close();
  $("#familyDialog").showModal();
};
$("#createFirstFamily").onclick = () => $("#newFamily").click();
$("#manageCurrentFamily").onclick = openFamilyManagement;
$("#inviteFamily").onclick = () => { const family = activeFamily(families, activeFamilyID); if (!family) return; $("#familyInviteFamily").textContent = `Семья: ${family.title}`; $("#familyInviteError").textContent = ""; $("#familyInviteToken").hidden = true; $("#familyInviteDialog").showModal(); };
$("#closeFamilyInvite").onclick = () => $("#familyInviteDialog").close();
$("#familyInviteForm").onsubmit = async (event) => { event.preventDefault(); try { const invite = await request("/invitations", { method: "POST", body: JSON.stringify({ email: $("#familyInviteEmail").value.trim(), familyId: activeFamilyID, familyRole: $("#familyInviteRole").value, relationship: $("#familyInviteRelationship").value.trim() || "Неопределено", permissions: ["send_messages", "edit_own_messages", "delete_own_messages", "create_groups"] }) }); $("#familyInviteTokenText").textContent = `Одноразовый код: ${invite.token}`; $("#familyInviteToken").hidden = false; $("#familyInviteEmail").value = ""; $("#familyInviteError").textContent = invite.mailSent === false ? "Приглашение создано, но письмо не отправлено. Передайте код вручную." : ""; } catch (error) { $("#familyInviteError").textContent = error.message; } };
$("#copyFamilyInviteToken").onclick = async () => { const code = $("#familyInviteTokenText").textContent.replace("Одноразовый код: ", ""); if (!code) return; try { await navigator.clipboard.writeText(code); $("#copyFamilyInviteToken").textContent = "Скопировано"; setTimeout(() => { $("#copyFamilyInviteToken").textContent = "Скопировать"; }, 1500); } catch { $("#familyInviteError").textContent = "Не удалось скопировать код. Скопируйте его вручную."; } };
$("#createFamily").onclick = async (e) => {
  e.preventDefault();
  const title = $("#familyTitle").value.trim();
  if (!title) return;
  const family = await request("/families", { method: "POST", body: JSON.stringify({ title, parentFamilyId: $("#parentFamily").value }) });
  $("#familyDialog").close();
  $("#familyTitle").value = "";
  families.push(family);
  activeFamilyID = family.id;
  location.reload();
};
$("#logout").onclick = async () => {
  await request("/auth/logout", { method: "POST" });
  location.reload();
};
$("#manageMembers").onclick = openMembers;
$("#deleteGroup").onclick = async()=>{if(!active||!confirm("Архивировать группу? Она исчезнет из списка, но сообщения и файлы сохранятся."))return;try{await request(`/conversations/${active}`,{method:"DELETE"});active=null;await loadConversations()}catch(e){alert(e.message)}};
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
$("#newGroup").onclick = () => $("#groupDialog").showModal();
$("#createGroup").onclick = async (e) => {
  e.preventDefault();
  const title = $("#groupTitle").value.trim();
  if (!title) return;
  await request("/conversations", {
    method: "POST",
    body: JSON.stringify({ title, memberIds: [], familyId: activeFamilyID }),
  });
  $("#groupDialog").close();
  $("#groupTitle").value = "";
  active = null;
  loadConversations();
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
  } catch (error) { alert(error.message); }
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
  } catch (e) {
    alert(e.message);
  } finally {
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
