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
