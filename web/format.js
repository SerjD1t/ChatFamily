export function localeTag(locale) {
  return locale === "en" ? "en-GB" : "ru-RU";
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((part) => part[0]).join("") || "?").toUpperCase();
}

export function formatConversationTime(value, locale = "ru") {
  if (!value) return "";
  const date = new Date(value), now = new Date(), tag = localeTag(locale);
  if (date.toDateString() === now.toDateString())
    return new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit" }).format(date);
  if (date.getFullYear() === now.getFullYear())
    return new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" }).format(date);
  return new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
}

export function formatMessageTime(value, locale = "ru") {
  return new Intl.DateTimeFormat(localeTag(locale), { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function formatDayLabel(value, locale = "ru", now = new Date()) {
  const date = new Date(value), today = dateKey(now);
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey(date) === today) return locale === "en" ? "Today" : "Сегодня";
  if (dateKey(date) === dateKey(yesterday)) return locale === "en" ? "Yesterday" : "Вчера";
  return new Intl.DateTimeFormat(localeTag(locale), { day: "numeric", month: "long", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" }).format(date);
}

export function formatShoppingDate(value, locale = "ru", now = new Date()) {
  if (!value) return locale === "en" ? "No date" : "Без даты";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (dateKey(date) === dateKey(now)) return locale === "en" ? "Today" : "Сегодня";
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateKey(date) === dateKey(tomorrow)) return locale === "en" ? "Tomorrow" : "Завтра";
  return new Intl.DateTimeFormat(localeTag(locale), { day: "numeric", month: "short" }).format(date);
}

export function groupMessageEntries(messages) {
  let previous = null;
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const day = dateKey(message.createdAt);
    const continued = !!previous && previous.authorId === message.authorId && dateKey(previous.createdAt) === day && new Date(message.createdAt) - new Date(previous.createdAt) < 5 * 60 * 1000;
    const startsDay = !previous || dateKey(previous.createdAt) !== day;
    previous = message;
    return { message, continued, startsDay };
  });
}
