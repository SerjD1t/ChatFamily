// GET history is side-effect free. Only exact, visible messages are marked read.
export function visibleMessageIDs(root, userID, doc = document) {
  if (!root || doc.visibilityState !== "visible" || !doc.hasFocus()) return [];
  if (doc.querySelector?.("dialog[open]")) return [];
  const viewport = root.getBoundingClientRect();
  if (!viewport.width || !viewport.height) return [];
  return [...root.querySelectorAll("[data-message-id]")].filter(node => {
    if (node.dataset.authorId === userID || node.dataset.deleted === "true") return false;
    const rect = node.getBoundingClientRect();
    const height = Math.min(rect.bottom, viewport.bottom, doc.defaultView.innerHeight) - Math.max(rect.top, viewport.top, 0);
    const width = Math.min(rect.right, viewport.right, doc.defaultView.innerWidth) - Math.max(rect.left, viewport.left, 0);
    return width > 0 && height >= Math.min(rect.height, 40) && rect.height > 0;
  }).map(node => node.dataset.messageId);
}

export function createReceipts({ request, root, userID, onRead = () => {} }) {
  const read = new Set();
  let previous = new Set(), reading = false, delivering = false, deliveryAgain = false, retryAfter = 0;
  async function scan() {
    const visible = visibleMessageIDs(root(), userID());
    const ids = visible.filter(id => previous.has(id) && !read.has(id)).slice(0, 100);
    previous = new Set(visible);
    if (!ids.length || reading || Date.now() < retryAfter) return;
    reading = true;
    try {
      await request("/message-receipts", { method: "POST", body: JSON.stringify({ messageIds: ids, read: true }) });
      ids.forEach(id => read.add(id));
      if (read.size > 5000) { read.clear(); ids.forEach(id => read.add(id)); }
      onRead();
    } catch (_) { retryAfter = Date.now() + 5000; }
    finally { reading = false; }
  }
  async function deliver() {
    if (delivering) { deliveryAgain = true; return; }
    delivering = true;
    try {
      do {
        deliveryAgain = false;
        let ids;
        do {
          ids = await request("/pending-deliveries");
          if (!ids.length) break;
          await request("/message-receipts", { method: "POST", body: JSON.stringify({ messageIds: ids, read: false }) });
        } while (ids.length === 100);
      } while (deliveryAgain);
    } catch (_) { /* Retry on reconnect or periodic reconciliation. */ }
    finally { delivering = false; }
  }
  const reset = () => { previous.clear(); };
  document.addEventListener("visibilitychange", reset);
  window.addEventListener("blur", reset);
  const timer = window.setInterval(() => { void scan(); }, 500);
  return { deliver, scan, destroy() {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", reset);
    window.removeEventListener("blur", reset);
  } };
}
