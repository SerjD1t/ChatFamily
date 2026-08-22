export function activeFamily(families, familyID) {
  return families.find((family) => family.id === familyID) || null;
}

export function familyConversations(conversations, familyID) {
  return conversations.filter(
    (conversation) =>
      conversation.familyId === familyID &&
      (conversation.kind === "family" || conversation.kind === "group"),
  );
}

export function canManageFamily(families, familyID) {
  const role = activeFamily(families, familyID)?.role;
  return role === "owner" || role === "admin";
}

export function summarizeShopping(items, now = new Date()) {
  const source = Array.isArray(items) ? items : [];
  const pending = source.filter((item) => !item.completedAt);
  const plannedToday = pending.filter((item) => {
    if (!item.plannedDate) return false;
    const planned = new Date(item.plannedDate);
    return planned.getUTCFullYear() === now.getFullYear() &&
      planned.getUTCMonth() === now.getMonth() &&
      planned.getUTCDate() === now.getDate();
  }).length;
  return { plannedToday, total: pending.length };
}
