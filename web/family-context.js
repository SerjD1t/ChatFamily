export function activeFamily(families, familyID) {
  return families.find((family) => family.id === familyID) || null;
}

export function familyConversations(conversations, familyID) {
  return conversations.filter(
    (conversation) =>
      !!familyID && (conversation.kind === "family" && conversation.familyId === familyID ||
      conversation.kind === "group" && conversation.familyIds?.includes(familyID)),
  );
}

export function canManageFamily(families, familyID) {
  const role = activeFamily(families, familyID)?.role;
  return role === "owner" || role === "admin";
}

export function summarizeShopping(items, now = new Date()) {
  const source = Array.isArray(items) ? items : [];
  const pending = source.filter((item) => !item.completedAt && !item.archivedAt);
  const plannedToday = pending.filter((item) => {
    if (!item.plannedDate) return false;
    const planned = new Date(item.plannedDate);
    return planned.getUTCFullYear() === now.getFullYear() &&
      planned.getUTCMonth() === now.getMonth() &&
      planned.getUTCDate() === now.getDate();
  }).length;
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const overdue = pending.filter(item => item.plannedDate && item.plannedDate.slice(0,10) < today).length;
  return { plannedToday, overdue, total: pending.length };
}
