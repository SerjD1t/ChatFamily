export function interfamilyHeading(locale, canManage) {
  const t = (ru, en) => locale === 'en' ? en : ru;
  return `<div class="interfamilyHeading" data-no-i18n><p class="navSectionTitle">${t('Семейные чаты', 'Family chats')}</p>${canManage ? `
    <button type="button" class="secondary interfamilyMenuToggle" data-interfamily-toggle aria-expanded="false" aria-controls="interfamilyMenu" aria-label="${t('Действия семейных чатов', 'Family chat actions')}" title="${t('Действия семейных чатов', 'Family chat actions')}">…</button>
    <div id="interfamilyMenu" class="interfamilyMenu" hidden>
      <button type="button" data-interfamily-action="create">${t('Создать чат', 'Create chat')}</button>
      <button type="button" data-interfamily-action="join">${t('Подключиться по коду', 'Connect using code')}</button>
      <button type="button" data-interfamily-action="manage">${t('Управление чатами', 'Manage chats')}</button>
    </div>` : ''}</div>`;
}

export function bindInterfamilyMenu(root, open) {
  const doc = root.ownerDocument;
  const close = (focus = false) => {
    const toggle = root.querySelector('[data-interfamily-toggle]');
    const menu = root.querySelector('#interfamilyMenu');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    toggle?.setAttribute('aria-expanded', 'false');
    if (focus) toggle?.focus();
  };
  doc.addEventListener('click', event => {
    const toggle = event.target.closest('[data-interfamily-toggle]');
    if (toggle && root.contains(toggle)) {
      const menu = root.querySelector('#interfamilyMenu');
      menu.hidden = !menu.hidden;
      toggle.setAttribute('aria-expanded', String(!menu.hidden));
      return;
    }
    const action = event.target.closest('[data-interfamily-action]');
    if (action && root.contains(action)) {
      close(true);
      open(action.dataset.interfamilyAction);
      return;
    }
    if (!event.target.closest('.interfamilyHeading')) close();
  });
  doc.addEventListener('keydown', event => {
    const menu = root.querySelector('#interfamilyMenu');
    if (event.key === 'Escape' && menu && !menu.hidden) {
      close(true);
      event.preventDefault();
    }
  });
  doc.addEventListener('focusin', event => {
    if (!event.target.closest('.interfamilyHeading')) close();
  });
}
