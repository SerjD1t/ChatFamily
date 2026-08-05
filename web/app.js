import { api, $, request, safe } from "./api.js";
const personalID = "__personal__",
  groupsID = "__groups__";
let conversations = [],
  favoriteIDs = new Set(),
  active = null,
  loadVersion = 0,
  currentUser = null,
  pendingFiles = [],
  reactionTarget = null;
function authorHue(name) {
  let value = 0;
  for (const char of name) value = (value * 31 + char.charCodeAt(0)) % 360;
  return value;
}
function directChats() {
  return conversations.filter((c) => c.kind === "direct");
}
function renderConversations() {
  const direct = directChats(),
    personalUnread = direct.reduce((n, c) => n + (c.unreadCount || 0), 0),
    groups = conversations.filter(
      (c) => c.kind === "group" || c.kind === "family",
    ),
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
    const family = conversations.find((c) => c.kind === "family");
    if (family) openConversation(family.id);
  }
}
function reactionButtons(message) {
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
  renderConversations();
  $("#chatTitle").textContent = "Личные";
  $("#manageMembers").hidden = true;
  $("#messages").innerHTML = '<p class="muted">Загрузка участников…</p>';
  try {
    const contacts = await request("/contacts");
    if (version !== loadVersion || active !== personalID) return;
    const chats = directChats();
    $("#messages").innerHTML = contacts.length
      ? `<div class="personalList">${contacts
          .map((u) => {
            const chat = chats.find((c) => c.title === u.Name),
              unread = chat?.unreadCount || 0;
            return `<button class="personalContact" data-user-id="${safe(u.ID)}"><span>${safe(u.Name)}</span>${unread ? `<b class="unread">${unread}</b>` : ""}</button>`;
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
  renderConversations();
  $("#chatTitle").textContent = "Все группы";
  $("#manageMembers").hidden = true;
  $("#toggleFavorite").hidden = true;
  const groups = conversations.filter(
    (c) => c.kind === "group" || c.kind === "family",
  );
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
async function openConversation(id) {
  if (id === personalID) return openPersonal();
  if (id === groupsID) return openGroups();
  const version = ++loadVersion;
  active = id;
  renderConversations();
  const c = conversations.find((x) => x.id === id),
    isFavorite = c?.kind === "group" && favoriteIDs.has(id);
  $("#chatTitle").textContent = c?.title || "Диалог";
  $("#manageMembers").hidden = c?.kind !== "group"; $("#deleteGroup").hidden = c?.kind !== "group";
  $("#toggleFavorite").hidden = c?.kind !== "group";
  $("#toggleFavorite").textContent = isFavorite ? "★" : "☆";
  $("#toggleFavorite").title = isFavorite
    ? "Убрать из избранного"
    : "Добавить в избранное";
  $("#toggleFavorite").setAttribute("aria-label", $("#toggleFavorite").title);
  $("#messages").innerHTML = '<p class="muted">Загрузка сообщений…</p>';
  try {
    const list = await request(`/conversations/${id}/messages`);
    if (version !== loadVersion || id !== active) return;
    $("#messages").innerHTML =
      (Array.isArray(list) ? list : [])
        .map(
          (m) =>
            `<article class="message ${m.authorId === currentUser.ID ? "own" : ""}"><div class="bubble"><strong style="--author-hue:${authorHue(m.authorName)}">${safe(m.authorName)}</strong><p>${m.deletedAt ? "Сообщение удалено" : safe(m.body)}</p>${(m.attachments || []).map((a) => `<p><a href="${api}/attachments/${encodeURIComponent(a.id)}" target="_blank" rel="noopener">📎 ${safe(a.filename)}</a></p>`).join("")}${m.deletedAt ? "" : reactionButtons(m)}<small class="messageMeta">${new Date(m.createdAt).toLocaleString("ru-RU")}${m.editedAt ? " · изменено" : ""}${m.deletedAt ? "" : reactionAddButton(m)}</small></div></article>`,
        )
        .join("") || '<p class="muted">Сообщений пока нет.</p>';
    $("#messages").onclick = handleReaction;
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
  currentUser = await request("/auth/me");
  $("#currentUserName").textContent = currentUser.Name || "Пользователь";
  $("#login").hidden = true;
  $("#app").hidden = false;
  if (currentUser.Permissions?.manage_users)
    $("#administration").hidden = false;
  await loadConversations();
}
async function openAdmin() {
  try {
    const users = await request("/users");
    $("#users").innerHTML = users
      .map((u) => {
        const admin = !!u.Permissions?.manage_users;
        return `<li><strong>${safe(u.Name)}</strong><small>${safe(u.Email)}</small>${admin ? "<small>Администратор</small>" : ""}${u.ID === currentUser.ID ? "" : `<button class="toggleAdmin secondary" data-toggle-admin="${safe(u.ID)}">${admin ? "Снять права администратора" : "Сделать администратором"}</button>`}</li>`;
      })
      .join("");
    $("#users").onclick = async (e) => {
      const userID = e.target.dataset.toggleAdmin;
      if (!userID) return;
      const user = users.find((u) => u.ID === userID);
      if (!user) return;
      const permissions = Object.keys(user.Permissions || {}),
        index = permissions.indexOf("manage_users");
      if (index < 0) permissions.push("manage_users");
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
    $("#inviteToken").hidden = true;
    $("#adminDialog").showModal();
  } catch (e) {
    alert(e.message);
  }
}
async function openMembers() {
  if (!active || active === personalID) return;
  try {
    const [members, candidates] = await Promise.all([
        request(`/conversations/${active}/members`),
        request(`/conversations/${active}/member-candidates`),
      ]),
      ids = new Set(members.map((u) => u.ID));
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
  } catch (e) {
    alert(e.message);
  }
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
$("#openUserMenu").onclick = () => $("#userMenuDialog").showModal();
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
$("#logout").onclick = async () => {
  await request("/auth/logout", { method: "POST" });
  location.reload();
};
$("#manageMembers").onclick = openMembers; $("#deleteGroup").onclick = async()=>{if(!active||!confirm("Удалить группу? Сообщения исчезнут из чата, файлы вложений останутся на сервере."))return;try{await request(`/conversations/${active}`,{method:"DELETE"});active=null;await loadConversations()}catch(e){alert(e.message)}};
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
    body: JSON.stringify({ title, memberIds: [] }),
  });
  $("#groupDialog").close();
  $("#groupTitle").value = "";
  active = null;
  loadConversations();
};
$("#createInvite").onclick = async (e) => {
  e.preventDefault();
  const email = $("#inviteEmail").value.trim();
  if (!email) return;
  const permissions = [...document.querySelectorAll('[name="permission"]:checked')].map((input) => input.value);
  try {
    const invite = await request("/invitations", {
      method: "POST",
      body: JSON.stringify({ email, permissions }),
    });
    $("#inviteTokenText").textContent = `Одноразовый код: ${invite.token}`;
    $("#inviteToken").hidden = false;
    $("#inviteEmail").value = "";
    $("#inviteError").textContent = "";
  } catch (error) {
    $("#inviteError").textContent = error.message;
  }
};
$("#copyInviteToken").onclick = async () => {
  const code = $("#inviteTokenText").textContent.replace("Одноразовый код: ", "");
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    $("#copyInviteToken").textContent = "Скопировано";
    setTimeout(() => { $("#copyInviteToken").textContent = "Скопировать"; }, 1500);
  } catch {
    $("#inviteError").textContent = "Не удалось скопировать код. Скопируйте его вручную.";
  }
};
$("#openAcceptInvite").onclick = () => {
  $("#acceptInviteError").textContent = "";
  $("#acceptInviteDialog").showModal();
  $("#inviteCode").focus();
};
$("#closeAcceptInvite").onclick = () => $("#acceptInviteDialog").close();
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
  if (password.length < 5) {
    error.textContent = "Пароль должен содержать не менее 5 символов";
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
startApp()
  .then(async () => {
    connectEvents();
    await configurePush();
  })
  .catch(() => {});
function connectEvents() {
  const scheme = location.protocol === "https:" ? "wss" : "ws",
    socket = new WebSocket(`${scheme}://${location.host}/api/v1/events`);
  socket.onmessage = async () => {
    try {
      await loadConversations();
      if (active === personalID) await openPersonal();
      else if (active) await openConversation(active);
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
