var ReviewStudio = {
  id: 'zotero-review-studio@seifer08ms.github.io',
  menuId: 'zotero-review-studio-menu',
  itemMenuId: 'zotero-review-studio-item-menu',
  windows: new Set(),
  dialog: null,

  async init() {
    for (const win of Zotero.getMainWindows()) this.addToWindow(win);
  },

  addToWindow(win) {
    if (!win || !win.document || this.windows.has(win)) return;
    this.windows.add(win);
    const add = (parent, id, title) => {
      if (!parent || win.document.getElementById(id)) return;
      const entry = win.document.createXULElement('menuitem');
      entry.id = id;
      entry.setAttribute('label', title);
      entry.addEventListener('command', () => this.open(win));
      parent.appendChild(entry);
    };
    add(win.document.getElementById('menu_ToolsPopup'), this.menuId,
      '综述工作台 · 多论文 / Research Gap');
    add(win.document.getElementById('zotero-itemmenu'), this.itemMenuId,
      '使用所选论文生成综述 / Gap 分析');
  },

  removeFromWindow(win) {
    if (!win?.document) return;
    win.document.getElementById(this.menuId)?.remove();
    win.document.getElementById(this.itemMenuId)?.remove();
    this.windows.delete(win);
  },

  open(win) {
    if (this.dialog && !this.dialog.closed) {
      this.dialog.focus();
      // Refreshing the source selection is explicit; do not erase in-progress work.
      return;
    }
    const items = (win.ZoteroPane?.getSelectedItems?.() || [])
      .map(item => item.isAttachment?.() && item.parentItemID
        ? Zotero.Items.get(item.parentItemID) : item)
      .filter(item => item?.isRegularItem?.());
    const ids = [...new Set(items.map(item => item.id))];
    const libraryID = items[0]?.libraryID || Zotero.Libraries.userLibraryID;
    this.dialog = win.openDialog(
      'chrome://zoteroreviewstudio/content/review.xhtml',
      '_blank',
      'chrome,resizable,centerscreen,width=1280,height=860',
      { zotero: Zotero, selectedIDs: ids, libraryID }
    );
  },

  async shutdown() {
    if (this.dialog && !this.dialog.closed) {
      try { this.dialog.close(); } catch (error) { Zotero.logError(error); }
    }
    this.dialog = null;
    for (const win of [...this.windows]) this.removeFromWindow(win);
    this.windows.clear();
  },
};
