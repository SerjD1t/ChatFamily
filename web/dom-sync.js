// Preserve existing nodes, focus and scroll when server data changes.
function key(node) {
  return node.nodeType === 1 ? node.getAttribute('data-message-id') || node.getAttribute('data-shopping-id') || node.getAttribute('data-id') || node.id : null;
}
function reconcile(parent, incoming) {
  let cursor = parent.firstChild;
  for (const next of [...incoming.childNodes]) {
    const nextKey = key(next);
    let current = nextKey ? [...parent.childNodes].find(node => key(node) === nextKey) : cursor;
    if (!current || key(current) !== nextKey || current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
      current = next.cloneNode(true);
      parent.insertBefore(current, cursor);
    } else {
      if (current !== cursor) parent.insertBefore(current, cursor);
      if (current.nodeType === 3) {
        if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      } else if (current.nodeType === 1) {
        for (const attr of [...current.attributes]) if (!next.hasAttribute(attr.name) && !(current.nodeName === 'DETAILS' && attr.name === 'open')) current.removeAttribute(attr.name);
        for (const attr of [...next.attributes]) if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
        if (current.nodeName === 'INPUT' && current.type === 'checkbox') current.checked = next.checked;
        reconcile(current, next);
      }
    }
    cursor = current.nextSibling;
  }
  while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
}
export function syncMarkup(element, html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  reconcile(element, template.content);
}
