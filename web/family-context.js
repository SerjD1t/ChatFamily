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
  const completedToday = source.filter((item) => {
    if (!item.completedAt) return false;
    const completed = new Date(item.completedAt);
    return completed.getFullYear() === now.getFullYear() &&
      completed.getMonth() === now.getMonth() &&
      completed.getDate() === now.getDate();
  }).length;
  return { completedToday, total: source.length };
}
