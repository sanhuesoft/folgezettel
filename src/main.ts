import { App, FuzzySuggestModal, ItemView, Plugin, WorkspaceLeaf, TFile, Notice, Menu, setIcon, Modal } from 'obsidian';
import { DEFAULT_SETTINGS, FolgezettelSettingTab, PluginSettings } from './settings';
import { I18n } from './i18n';

const VIEW_TYPE = 'folgezettel-view';
const GRAPH_VIEW_TYPE = 'folgezettel-graph';

type Token = { type: 'num' | 'upper' | 'lower' | 'sep'; value: number | string };
type ZettelType = 'next' | 'branch' | 'inserted';

function tokenize(zid: string): Token[] {
  const s = String(zid);
  const parts = s.match(/(\d+|[A-Z]+|[a-z]+|[.,/])/g) || [];
  return parts.map((p) => {
    if (/^\d+$/.test(p)) return { type: 'num', value: parseInt(p, 10) };
    if (/^[A-Z]+$/.test(p)) return { type: 'upper', value: p };
    if (/^[a-z]+$/.test(p)) return { type: 'lower', value: p };
    return { type: 'sep', value: p };
  });
}

function typeRank(t: Token['type']) {
  if (t === 'upper') return 1;
  if (t === 'lower') return 2;
  if (t === 'num') return 3;
  return 4; 
}

function compareZid(a: string, b: string) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const len = Math.max(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    const xa = ta[i];
    const xb = tb[i];
    if (!xa) return -1;
    if (!xb) return 1;
    if (xa.type === xb.type) {
      if (xa.type === 'num') {
        const na = xa.value as number;
        const nb = (xb.value as number) || 0;
        if (na !== nb) return na - nb;
      } else {
        const sa = String(xa.value);
        const sb = String(xb.value);
        if (sa !== sb) return sa < sb ? -1 : 1;
      }
    } else {
      return typeRank(xa.type) - typeRank(xb.type);
    }
  }
  return 0;
}

function calculateDepth(zid: string): number {
  const tokens = tokenize(zid);
  let depth = 0;
  let lastType: Token['type'] | null = null;
  
  for (const t of tokens) {
    if (lastType === null) {
      depth = 0;
    } else if (t.type === 'sep') {
      depth += 1;
    } else if (t.type === 'upper' && (lastType === 'num' || lastType === 'lower')) {
      depth += 1;
    } else if (t.type === 'lower' && lastType === 'upper') {
      depth += 1;
    }
    lastType = t.type;
  }
  return depth;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export default class FolgezettelPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  i18n!: I18n;

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.i18n = new I18n(this.settings.lang);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.i18n = new I18n(this.settings.lang);
    try {
      this.refreshViews();
    } catch (_e) {
      console.error('Error refreshing views after saving settings:', _e);
    }
  }

  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new FolgezettelView(leaf, this));
    this.registerView(GRAPH_VIEW_TYPE, (leaf) => new FolgezettelGraphView(leaf, this));

    this.addCommand({
      id: 'open-fz',
      name: this.i18n.t('command.open'),
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'open-fz-graph',
      name: this.i18n.t('command.openGraph') || 'Open Graph',
      callback: () => this.activateGraphView(),
    });

    this.addCommand({
      id: 'reload-fz-view',
      name: this.i18n.t('command.reloadView'),
      callback: () => {
        try {
          this.refreshViews();
          new Notice(this.i18n.t('notice.viewReloaded'));
        } catch (_e) {
          console.error('Error refreshing views:', _e);
        }
      },
    });
    this.app.workspace.onLayoutReady(() => this.activateView());

    this.addSettingTab(new FolgezettelSettingTab(this.app, this));

    this.registerEvent(this.app.vault.on('modify', () => this.refreshViews()));
    this.registerEvent(this.app.vault.on('create', () => this.refreshViews()));
    this.registerEvent(this.app.vault.on('delete', () => this.refreshViews()));
    this.registerEvent(this.app.vault.on('rename', () => this.refreshViews()));
  }

  async activateView() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    await this.app.workspace.getRightLeaf(false).setViewState({ type: VIEW_TYPE, active: true });
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length) this.app.workspace.revealLeaf(leaves[0]);
  }

  async activateGraphView() {
    // Open the graph view in a new leaf (tab)
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: GRAPH_VIEW_TYPE, active: true });
    const leaves = this.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);
    if (leaves.length) this.app.workspace.revealLeaf(leaves[0]);
  }

  refreshViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    leaves.forEach((leaf) =>
      (leaf.view as FolgezettelView)
        .renderList()
        .catch((e) => console.error('Error rendering folgezettel view:', e))
    );
  }
}

class FolgezettelView extends ItemView {
  private plugin: FolgezettelPlugin;
  private listEl!: HTMLElement;
  private expandedState: Record<string, boolean> = {};
  private renderVersion = 0;

  constructor(leaf: WorkspaceLeaf, plugin: FolgezettelPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return this.plugin.i18n.t('view.title');
  }

  getIcon() {
    return 'brain';
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    this.listEl = container.createEl('div', { cls: 'fzz-list tree-item-children' });
    await this.renderList();
  }

  async onClose() {}

  private refreshViews() {
    this.plugin.refreshViews();
  }

  async collectZidFiles(): Promise<{ file: TFile; zid: string }[]> {
    const files = this.app.vault.getMarkdownFiles();
    const res: { file: TFile; zid: string }[] = [];

    for (const f of files) {
      const content = await this.app.vault.cachedRead(f);
      let zid: string | undefined;
      const m = content.match(/^---\n([\s\S]*?)\n---/);
      if (m) {
        const zidMatch = m[1].match(/^\s*zid\s*:\s*(.+)$/im) || m[1].match(/^\s*ZID\s*:\s*(.+)$/im);
        if (zidMatch) zid = zidMatch[1].trim().replace(/^['"]|['"]$/g, '');
      }
      if (zid) res.push({ file: f, zid });
    }

    return res;
  }

  private async computeNewZid(
    node: { zid: string },
    type: ZettelType
  ): Promise<string> {
    const items = await this.collectZidFiles();
    const zids = new Set(items.map((it) => it.zid));
    const exists = (z: string) => zids.has(z);
    
    let candidate = '';
    const zid = node.zid;
    
    const incChar = (ch: string) => String.fromCharCode(ch.charCodeAt(0) + 1);

    if (type === 'next') {
      if (/[a-zA-Z]$/.test(zid)) {
        let n = 1;
        candidate = `${zid}${n}`;
        while (exists(candidate)) { n++; candidate = `${zid}${n}`; }
      } else {
        const match = zid.match(/^(.*?)(\d+)$/);
        if (match) {
          let num = parseInt(match[2], 10) + 1;
          candidate = `${match[1]}${num}`;
          while (exists(candidate)) { num++; candidate = `${match[1]}${num}`; }
        }
      }
    } 
    else if (type === 'branch') {
      if (/^\d+$/.test(zid)) {
        let num = 1;
        candidate = `${zid}/${num}`;
        while (exists(candidate)) { num++; candidate = `${zid}/${num}`; }
      } else if (/\d$/.test(zid)) {
        let char = 'A';
        candidate = `${zid}${char}`;
        while (exists(candidate)) { char = incChar(char); candidate = `${zid}${char}`; }
      } else if (/[A-Z]$/.test(zid)) {
        let char = 'a';
        candidate = `${zid}${char}`;
        while (exists(candidate)) { char = incChar(char); candidate = `${zid}${char}`; }
      } else if (/[a-z]$/.test(zid)) {
        let char = 'A';
        candidate = `${zid}${char}`;
        while (exists(candidate)) { char = incChar(char); candidate = `${zid}${char}`; }
      }
    } 
    else if (type === 'inserted') {
      if (/\d$/.test(zid)) {
        let char = 'a';
        candidate = `${zid}${char}`;
        while (exists(candidate)) { char = incChar(char); candidate = `${zid}${char}`; }
      } else if (/[A-Z]$/.test(zid)) {
        let num = 1;
        candidate = `${zid}${num}`;
        while (exists(candidate)) { num++; candidate = `${zid}${num}`; }
      } else if (/[a-z]$/.test(zid)) {
        const match = zid.match(/^(.*?)([a-z])$/);
        if (match) {
          let char = incChar(match[2]);
          candidate = `${match[1]}${char}`;
          while (exists(candidate)) { char = incChar(char); candidate = `${match[1]}${char}`; }
        }
      }
    }

    return candidate || `${zid}-1`;
  }

  async createZettel(
    node: { zid: string },
    type: ZettelType
  ) {
    const newZid = await this.computeNewZid(node, type);
    const uuid = generateUUID();

    const baseName = this.plugin.i18n.t('note.untitled') || 'Sin título';
    let fileName = baseName;
    let idx = 1;
    while (this.app.vault.getFiles().some((f) => f.basename === fileName)) {
      fileName = `${baseName} ${idx}`;
      idx += 1;
    }

    const content = `---\nzid: ${newZid}\nuuid: ${uuid}\n---\n`;
    const newFile = await this.app.vault.create(`${fileName}.md`, content);
    await this.app.workspace.getLeaf(false).openFile(newFile);
    this.refreshViews();
  }

  async assignZettel(
    node: { zid: string },
    type: ZettelType
  ) {
    const newZid = await this.computeNewZid(node, type);

    const allFiles = this.app.vault.getMarkdownFiles();
    const withZid = await this.collectZidFiles();
    const pathsWithZid = new Set(withZid.map((it) => it.file.path));
    const candidates = allFiles.filter((f) => !pathsWithZid.has(f.path));

    if (candidates.length === 0) {
      new Notice(this.plugin.i18n.t('notice.noCandidates') || 'No hay notas huérfanas.');
      return;
    }
    
    const placeholder = (this.plugin.i18n.t('modal.assignPlaceholder') || 'Asignar ZID {zid} a...').replace('{zid}', newZid);

    new ZidAssignModal(
      this.app,
      candidates,
      newZid,
      async (file) => {
        await this.addZidToFile(file, newZid);
      },
      placeholder
    ).open();
  }

  private async addZidToFile(file: TFile, zid: string) {
    const content = await this.app.vault.read(file);
    const uuid = generateUUID();
    let newContent: string;

    if (/^---\n/.test(content)) {
      newContent = content.replace(/^(---\n[\s\S]*?)(\n---)/, `$1\nzid: ${zid}\nuuid: ${uuid}$2`);
    } else {
      newContent = `---\nzid: ${zid}\nuuid: ${uuid}\n---\n${content}`;
    }

    await this.app.vault.modify(file, newContent);
    new Notice((this.plugin.i18n.t('notice.zidAssigned') || 'ZID asignado.').replace('{zid}', zid).replace('{name}', file.basename));
  }

  async removeZidFromFile(file: TFile) {
    const content = await this.app.vault.read(file);
    const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!m) {
      new Notice(this.plugin.i18n.t('notice.noFrontmatter') || 'No hay frontmatter.');
      return;
    }

    const fm = m[1];
    const lines = fm.split(/\r?\n/);
    const filtered = lines.filter((ln) => !/^\s*zid\s*:/i.test(ln));
    const newFm = filtered.join('\n').trim();

    let newContent: string;
    if (newFm === '') {
      newContent = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    } else {
      newContent = content.replace(/^---\n([\s\S]*?)\n---/, `---\n${newFm}\n---`);
    }

    await this.app.vault.modify(file, newContent);
    new Notice((this.plugin.i18n.t('notice.zidRemoved') || 'ZID eliminado de {name}').replace('{name}', file.basename));
  }

  async renderList() {
    if (!this.listEl) return;
    const version = ++this.renderVersion;

    const items = await this.collectZidFiles();
    if (version !== this.renderVersion) return;

    this.listEl.empty();
    
    items.sort((a, b) => compareZid(a.zid, b.zid));

    const zidCount: Record<string, number> = {};
    for (const it of items) zidCount[it.zid] = (zidCount[it.zid] || 0) + 1;
    const duplicatedZids = Object.keys(zidCount).filter((zid) => zidCount[zid] > 1);
    if (duplicatedZids.length > 0) {
      const msg = this.plugin.i18n.t('notice.duplicatedZids') || 'ZIDs duplicados: {list}';
      new Notice(msg.replace('{list}', duplicatedZids.join(', ')));
    }

    type TreeNode = { file: TFile; zid: string; depth: number; parent: TreeNode | null; children: TreeNode[] };
    const rootNodes: TreeNode[] = [];
    const stack: TreeNode[] = [];

    for (const it of items) {
      const depth = calculateDepth(it.zid);
      const node: TreeNode = { file: it.file, zid: it.zid, depth, parent: null, children: [] };

      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }

      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        node.parent = parent;
        parent.children.push(node);
      } else {
        rootNodes.push(node);
      }
      stack.push(node);
    }

    const expanded = this.expandedState;

    const renderNode = (node: TreeNode, currentDepth: number, container: HTMLElement = this.listEl) => {
      const treeItem = container.createEl('div', { cls: `tree-item` });
      
      const self = treeItem.createEl('div', { cls: 'tree-item-self is-clickable' });

      self.oncontextmenu = (event) => {
        event.preventDefault();
        const menu = new Menu();
        
        menu.addItem((item) => {
          item.setTitle('Crear nota siguiente');
          item.setIcon('arrow-right');
          item.onClick(() => this.createZettel(node, 'next'));
        });
        menu.addItem((item) => {
          item.setTitle('Crear nota insertada');
          item.setIcon('corner-down-right');
          item.onClick(() => this.createZettel(node, 'inserted'));
        });
        menu.addItem((item) => {
          item.setTitle('Crear rama');
          item.setIcon('folder-input');
          item.onClick(() => this.createZettel(node, 'branch'));
        });
        
        menu.addSeparator();

        menu.addItem((item) => {
          item.setTitle(this.plugin.i18n.t('menu.removeZid') || 'Eliminar ZID');
          item.setIcon('trash');
          item.onClick(async () => {
            const msg = (this.plugin.i18n.t('confirm.removeZid') || 'Eliminar ZID {zid}?').replace('{zid}', node.zid);
            const ok = await new ConfirmModal(this.app, msg).openAndWait();
            if (ok) await this.removeZidFromFile(node.file);
          });
        });
        menu.showAtPosition({ x: event.pageX, y: event.pageY });
      };

      if (node.children.length > 0) {
        if (expanded[node.zid] === undefined) expanded[node.zid] = true;
        const arrow = self.createEl('div', { cls: 'tree-item-icon collapse-icon' });
        arrow.style.flexShrink = '0';
        arrow.classList.add(expanded[node.zid] ? 'is-collapsed' : 'is-expanded');

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M6 4l4 4-4 4');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('fill', 'none');
        svg.appendChild(path);
        arrow.appendChild(svg);

        arrow.onclick = async (e) => {
          e.stopPropagation();
          expanded[node.zid] = !expanded[node.zid];
          await this.renderList();
        };
      }

      // Agrupamos el ZID y el Título de la nota dentro del contenedor principal
      // Esto permite que el componente de Obsidian ("tree-item-inner") maneje 
      // el ancho sobrante y trunque el texto sin interrumpir la jerarquía.
      const innerEl = self.createEl('div', { cls: 'tree-item-inner fzz-title' });

      const zidSpan = innerEl.createEl('span', { text: node.zid, cls: 'fzz-zid' });
      zidSpan.style.fontFamily = 'var(--font-monospace, monospace)';
      zidSpan.style.marginRight = '8px';
      zidSpan.style.color = 'var(--text-muted)'; // Le damos un color atenuado para separarlo visualmente del título
      
      if (duplicatedZids.includes(node.zid)) {
        zidSpan.classList.add('fzz-zid-duplicate');
        zidSpan.style.color = 'var(--text-error)';
        zidSpan.title = `${node.zid} — ZID duplicado`;
      } else {
        zidSpan.title = node.zid;
      }

      innerEl.createEl('span', { text: node.file.basename });

      try {
        if (!/^\d+$/.test(node.zid)) {
          const actions = self.createEl('div', { cls: 'fzz-actions' });
          actions.style.display = 'flex';
          actions.style.alignItems = 'center';
          actions.style.flexShrink = '0';
          actions.style.gap = '4px';
          actions.style.marginLeft = '8px';

          const btnNext = actions.createEl('button', { cls: 'fzz-action-btn' });
          btnNext.setAttr('aria-label', 'Siguiente');
          setIcon(btnNext, 'arrow-right');
          btnNext.onclick = async (e) => {
            e.stopPropagation();
            if (e.shiftKey) await this.assignZettel(node, 'next');
            else await this.createZettel(node, 'next');
          };

          const btnInserted = actions.createEl('button', { cls: 'fzz-action-btn' });
          btnInserted.setAttr('aria-label', 'Insertada');
          setIcon(btnInserted, 'corner-down-right');
          btnInserted.onclick = async (e) => {
            e.stopPropagation();
            if (e.shiftKey) await this.assignZettel(node, 'inserted');
            else await this.createZettel(node, 'inserted');
          };

          const btnBranch = actions.createEl('button', { cls: 'fzz-action-btn' });
          btnBranch.setAttr('aria-label', 'Rama');
          setIcon(btnBranch, 'folder-input');
          btnBranch.onclick = async (e) => {
            e.stopPropagation();
            if (e.shiftKey) await this.assignZettel(node, 'branch');
            else await this.createZettel(node, 'branch');
          };
        }
      } catch (_e) {
        console.error('Error creating action buttons:', _e);
      }

      self.onclick = async () => {
        try {
          await this.app.workspace.getLeaf(false).openFile(node.file);
        } catch (_e) {
          await this.app.workspace.getLeaf(true).openFile(node.file);
        }
      };

      if (expanded[node.zid]) {
        const childrenContainer = treeItem.createEl('div', { cls: 'tree-item-children' });
        for (const child of node.children) renderNode(child, currentDepth + 1, childrenContainer);
      }
    };

    rootNodes.forEach((node) => renderNode(node, 0));

    try {
      const topKeys = items
        .map((it) => (/^\d+$/.test(it.zid) ? parseInt(it.zid, 10) : NaN))
        .filter((n) => !isNaN(n));
      const maxTop = topKeys.length ? Math.max(...topKeys) : 0;
      const nextArea = maxTop + 1;

      const treeItem = this.listEl.createEl('div', { cls: 'tree-item create-area' });
      const self = treeItem.createEl('div', { cls: 'tree-item-self is-clickable' });

      // Agrupamos en un mismo contenedor también para "Crear área"
      const innerEl = self.createEl('div', { cls: 'tree-item-inner fzz-title' });

      const zidSpan = innerEl.createEl('span', { text: String(nextArea), cls: 'fzz-zid' });
      zidSpan.style.fontFamily = 'var(--font-monospace, monospace)';
      zidSpan.style.marginRight = '8px';
      zidSpan.style.color = 'var(--text-muted)';

      innerEl.createEl('span', { text: this.plugin.i18n.t('action.createArea') || 'Crear área' });

      self.onclick = async () => {
        const zid = String(nextArea);
        const uuid = generateUUID();
        const baseName = this.plugin.i18n.t('note.untitled') || 'Sin título';
        let fileName = baseName;
        let idx = 1;
        while (this.app.vault.getFiles().some((f) => f.basename === fileName)) {
          fileName = `${baseName} ${idx}`;
          idx += 1;
        }

        const content = `---\nzid: ${zid}\nuuid: ${uuid}\n---\n`;
        const newFile = await this.app.vault.create(`${fileName}.md`, content);
        await this.app.workspace.getLeaf(false).openFile(newFile);
        this.refreshViews();
      };
    } catch (e) {
      console.error('Error creating new area:', e);
    }
  }
}

class FolgezettelGraphView extends ItemView {
  private plugin: FolgezettelPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: FolgezettelPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return GRAPH_VIEW_TYPE;
  }

  getDisplayText() {
    return this.plugin.i18n.t('view.graphTitle') || 'Folgezettel Graph';
  }

  getIcon() {
    return 'graph';
  }

  async onClose() {
    // Remove any lingering tooltip appended to document.body
    document.querySelectorAll('.fzz-graph-tooltip').forEach((el) => el.remove());
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();

    // Use a fresh I18n instance to ensure locale JSON changes are picked up
    const i18n = new I18n(this.plugin.settings.lang);

    const wrapper = container.createEl('div', { cls: 'fzz-graph-wrapper' });

    // Determine current ZID from active file (if any)
    const active = this.app.workspace.getActiveFile();
    let currentZid: string | null = null;
    if (active) {
      const content = await this.app.vault.read(active);
      const m = content.match(/^---\n([\s\S]*?)\n---/);
      if (m) {
        const zidMatch = m[1].match(/^\s*zid\s*:\s*(.+)$/im) || m[1].match(/^\s*ZID\s*:\s*(.+)$/im);
        if (zidMatch) currentZid = zidMatch[1].trim().replace(/^['"]|['"]$/g, '');
      }
    }

    const items = await this.collectZidFiles();
    if (!currentZid) {
      wrapper.createEl('div', { text: i18n.t('notice.noActiveZid') || 'No ZID in active note to show graph.' });
      return;
    }

    const layout = this.buildLayout(currentZid, items.map((it) => it.zid));
    if (layout.nodes.length === 0) {
      wrapper.createEl('div', { text: i18n.t('notice.noZids') || 'No ZIDs found for area.' });
      return;
    }

    this.renderLayout(wrapper, layout, items, currentZid);
  }

  async collectZidFiles(): Promise<{ file: TFile; zid: string; title: string }[]> {
    const files = this.app.vault.getMarkdownFiles();
    const res: { file: TFile; zid: string; title: string }[] = [];

    for (const f of files) {
      const content = await this.app.vault.cachedRead(f);
      let zid: string | undefined;
      const m = content.match(/^---\n([\s\S]*?)\n---/);
      if (m) {
        const zidMatch = m[1].match(/^\s*zid\s*:\s*(.+)$/im) || m[1].match(/^\s*ZID\s*:\s*(.+)$/im);
        if (zidMatch) zid = zidMatch[1].trim().replace(/^['"]|['"]$/g, '');
      }
      let title = f.basename;
      if (m) {
        const titleMatch = m[1].match(/^\s*title\s*:\s*(.+)$/im) || m[1].match(/^\s*Title\s*:\s*(.+)$/im);
        if (titleMatch) title = titleMatch[1].trim().replace(/^['"]|['"]$/g, '');
      }
      if (zid) res.push({ file: f, zid, title });
    }

    return res;
  }

  // ===== Layout algorithm (ported from Swift buildLayout) =====
  private buildLayout(currentZid: string, allZidsInput: string[]) {
    const R = 26;
    const D = R * 2;
    const hGap = 22;
    const vGap = 28;

    const areaNumber = (zid: string): number | null => {
      const t = zid.trim();
      let d = '';
      for (const ch of t) { if (/\d/.test(ch)) d += ch; else break; }
      return d ? parseInt(d, 10) : null;
    };

    const area = areaNumber(currentZid);
    if (area === null) return { nodes: [], edges: [], size: { width: 0, height: 0 }, cx: (_: number) => 0, cy: (_: number) => 0 };

    const byZid: Record<string, { id: string; zid: string }> = {};
    for (const z of allZidsInput) {
      const zt = z.trim();
      if (!zt) continue;
      if (areaNumber(zt) !== area) continue;
      byZid[zt] = { id: zt, zid: zt };
    }

    const allZids = Object.keys(byZid).sort(compareZid);
    if (allZids.length === 0) return { nodes: [], edges: [], size: { width: 0, height: 0 }, cx: (_: number) => 0, cy: (_: number) => 0 };

    type CKind = 'num' | 'upper' | 'lower' | 'sep' | 'none';
    const ckind = (ch: string): CKind => {
      if (ch === '/') return 'sep';
      if (/\d/.test(ch)) return 'num';
      if (/[A-Z]/.test(ch)) return 'upper';
      if (/[a-z]/.test(ch)) return 'lower';
      return 'none';
    };

    const splitZid = (zid: string): string[] => {
      const tokens: string[] = [];
      let cur = '';
      let prevKind: CKind = 'none';
      for (const ch of zid) {
        const k = ckind(ch);
        if (k === 'sep') {
          if (cur !== '') { tokens.push(cur); cur = ''; }
          tokens.push(ch); prevKind = 'sep'; continue;
        }
        if (prevKind !== 'none' && prevKind !== 'sep' && k !== prevKind && k !== 'none') {
          if (cur !== '') { tokens.push(cur); cur = ''; }
        }
        cur += ch;
        if (k !== 'none') prevKind = k;
      }
      if (cur !== '') tokens.push(cur);
      return tokens;
    };

    const isSep = (s: string) => s === '/';

    const isAnc = (ancestor: string, descendant: string) => {
      const at = splitZid(ancestor), dt = splitZid(descendant);
      if (dt.length <= at.length) return false;
      for (let i = 0; i < at.length; i++) if (at[i] !== dt[i]) return false;
      return true;
    };

    const isBranch = (zid: string) => {
      const toks = splitZid(zid);
      const segs = toks.filter((t) => !isSep(t));
      const last = segs[segs.length - 1];
      if (!last) return false;
      if (segs.length <= 2) return false;
      const first = last[0];
      if (/\d/.test(first)) {
        if (segs.length >= 2 && /[a-zA-Z]/.test(segs[segs.length - 2].slice(-1))) {
          return toks.length >= 2 && isSep(toks[toks.length - 2]);
        }
        return true;
      }
      if (/[A-Z]/.test(first)) return true;
      if (/[a-z]/.test(first)) {
        return segs.length >= 2 && /[A-Z]/.test(segs[segs.length - 2].slice(-1));
      }
      return false;
    };

    const parentZid = (zid: string): string | null => {
      const toks = splitZid(zid);
      if (toks.length <= 1) return null;
      let pt = toks.slice(0, toks.length - 1);
      if (pt.length && isSep(pt[pt.length - 1])) pt = pt.slice(0, pt.length - 1);
      const exact = allZids.find((a) => {
        const sa = splitZid(a);
        if (sa.length !== pt.length) return false;
        for (let i = 0; i < sa.length; i++) if (sa[i] !== pt[i]) return false;
        return true;
      });
      if (exact) return exact;
      const anc = allZids.filter((a) => splitZid(a).length === pt.length && isAnc(a, zid)).pop();
      if (anc) return anc;
      if (pt.length > 1) {
        let pt2 = pt.slice(0, pt.length - 1);
        if (pt2.length && isSep(pt2[pt2.length - 1])) pt2 = pt2.slice(0, pt2.length - 1);
        const exact2 = allZids.find((a) => {
          const sa = splitZid(a);
          if (sa.length !== pt2.length) return false;
          for (let i = 0; i < sa.length; i++) if (sa[i] !== pt2[i]) return false;
          return true;
        });
        if (exact2) return exact2;
        return allZids.filter((a) => splitZid(a).length === pt2.length && isAnc(a, zid)).pop() || null;
      }
      return null;
    };

    const hasChildren = (zid: string) => allZids.some((a) => parentZid(a) === zid);

    const makeNode = (zid: string) => {
      const n = byZid[zid] ? { id: byZid[zid].id, zid } : { id: zid, zid };
      return { ...n, hasChildren: hasChildren(zid) };
    };

    const colByZid: Record<string, number> = {};
    const rowByZid: Record<string, number> = {};
    const nextFreeCol: Record<number, number> = {};

    const place = (zid: string, parentCol: number, row: number): number => {
      const col = Math.max(nextFreeCol[row] ?? 0, parentCol + 1);
      colByZid[zid] = col;
      rowByZid[zid] = row;
      nextFreeCol[row] = col + 1;

      const kids = allZids.filter((a) => parentZid(a) === zid).sort(compareZid);
      const branchKids = kids.filter(isBranch);
      const seqKids = kids.filter((k) => !isBranch(k));

      let branchRowCursor = row + 1;
      for (const br of branchKids) {
        place(br, col, branchRowCursor);

        const descRows: number[] = Object.keys(rowByZid).map((z) => {
          const r = rowByZid[z];
          if (r === undefined) return -Infinity;
          // is descendant of br?
          if (z === br) return r;
          let cur: string | null = z;
          while (cur) {
            if (cur === br) return r;
            cur = parentZid(cur);
            if (!cur) break;
          }
          return -Infinity;
        }).filter((n) => n !== -Infinity);

        const maxDescRow = descRows.length ? Math.max(...descRows) : branchRowCursor;
        branchRowCursor = Math.max(branchRowCursor, maxDescRow + 1);
      }

      if (branchKids.length > 0) {
        const descCols: number[] = Object.keys(colByZid).map((z) => {
          const r = rowByZid[z];
          if (r === undefined || r <= row) return -Infinity;
          let cur: string | null = z;
          while (cur) {
            if (cur === zid) return colByZid[z];
            cur = parentZid(cur);
            if (!cur) break;
          }
          return -Infinity;
        }).filter((n) => n !== -Infinity);
        const maxDescendantCol = descCols.length ? Math.max(...descCols) : col;
        nextFreeCol[row] = Math.max(nextFreeCol[row] ?? 0, maxDescendantCol + 1);
      }

      for (const seq of seqKids) {
        place(seq, col, row);
      }

      return col;
    };

    const areaRoot = allZids.find((z) => parentZid(z) === null) || allZids[0];
    place(areaRoot, -1, 0);

    const layoutNodes: { node: ReturnType<typeof makeNode>; col: number; row: number }[] = [];
    const edges: { fromCol: number; fromRow: number; toCol: number; toRow: number; kind: 'sequence' | 'branch' }[] = [];

    for (const zid of allZids) {
      const col = colByZid[zid];
      const row = rowByZid[zid];
      if (col === undefined || row === undefined) continue;
      const n = makeNode(zid);
      layoutNodes.push({ node: n, col, row });
      const p = parentZid(zid);
      if (p) {
        const pc = colByZid[p];
        const pr = rowByZid[p];
        if (pc !== undefined && pr !== undefined) {
          edges.push({ fromCol: pc, fromRow: pr, toCol: col, toRow: row, kind: isBranch(zid) ? 'branch' : 'sequence' });
        }
      }
    }

    const maxCol = layoutNodes.map((n) => n.col).reduce((a, b) => Math.max(a, b), 0);
    const maxRow = layoutNodes.map((n) => n.row).reduce((a, b) => Math.max(a, b), 0);
    const w = (maxCol + 1) * (D + hGap) + D;
    const h = (maxRow + 1) * (D + vGap) + D;
    const size = { width: w + 48, height: h + 48 };

    const cx = (col: number) => col * (D + hGap) + R + 24;
    const cy = (row: number) => row * (D + vGap) + R + 24;

    return { nodes: layoutNodes, edges, size, cx, cy } as const;
  }

  private renderLayout(container: HTMLElement, layout: any, items: { file: TFile; zid: string; title: string }[], highlightZid?: string) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', String(layout.size.width));
    svg.setAttribute('height', String(layout.size.height));
    svg.style.display = 'block';
    svg.style.margin = '8px';

    // Make container a positioning context for absolute tooltip — no longer needed with fixed positioning

    // Tooltip — position: fixed so coordinates are always relative to the
    // viewport regardless of how large the canvas is or how much is scrolled.
    const TOOLTIP_WIDTH = 260; // px
    const tooltip = document.createElement('div');
    tooltip.className = 'fzz-graph-tooltip';
    tooltip.style.position = 'fixed';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.visibility = 'hidden';
    tooltip.style.padding = '6px 8px';
    tooltip.style.borderRadius = '6px';
    tooltip.style.background = 'var(--background-modifier-card, #fff)';
    tooltip.style.color = 'var(--text-normal, #000)';
    tooltip.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
    tooltip.style.fontSize = '12px';
    tooltip.style.zIndex = '9999';
    tooltip.style.width = `${TOOLTIP_WIDTH}px`;
    tooltip.style.whiteSpace = 'normal';
    tooltip.style.wordBreak = 'break-word';
    tooltip.style.textAlign = 'left';
    tooltip.style.boxSizing = 'border-box';
    // Append to body so fixed positioning is never affected by a transformed ancestor
    document.body.appendChild(tooltip);

    // Draw edges
    for (const edge of layout.edges) {
      const from = { x: layout.cx(edge.fromCol), y: layout.cy(edge.fromRow) };
      const to = { x: layout.cx(edge.toCol), y: layout.cy(edge.toRow) };
      const path = document.createElementNS(svgNS, 'path');
      if (edge.kind === 'sequence') {
        path.setAttribute('d', `M ${from.x} ${from.y} L ${to.x} ${to.y}`);
        path.setAttribute('stroke', '#D4AF37');
      } else {
        path.setAttribute('d', `M ${from.x} ${from.y} L ${from.x} ${to.y} L ${to.x} ${to.y}`);
        path.setAttribute('stroke', '#e05454');
      }
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', '4');
      path.setAttribute('stroke-linecap', 'round');
      svg.appendChild(path);
    }

    // Draw nodes
    for (const ln of layout.nodes) {
      const cx = layout.cx(ln.col);
      const cy = layout.cy(ln.row);

      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('transform', `translate(${cx}, ${cy})`);

      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('r', String(26));
      circle.setAttribute('cx', '0');
      circle.setAttribute('cy', '0');
      circle.setAttribute('fill', ln.node.zid === highlightZid ? '#ffd6a5' : '#ffffff');
      circle.setAttribute('stroke', '#000000');
      circle.setAttribute('stroke-width', '2');
      g.appendChild(circle);

      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('x', '0');
      text.setAttribute('y', '4');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '10');
      text.setAttribute('font-family', 'monospace');
      text.textContent = ln.node.zid;
      g.appendChild(text);

      // Click to open note if exists; show tooltip on hover with note title
      const match = items.find((it) => it.zid === ln.node.zid);
      if (match) {
        g.style.cursor = 'pointer';
        g.addEventListener('click', async (e) => {
          e.stopPropagation();
          try { await this.app.workspace.getLeaf(false).openFile(match.file); }
          catch { await this.app.workspace.getLeaf(true).openFile(match.file); }
        });

        g.addEventListener('mouseenter', (ev) => {
          // Position tooltip relative to the node's viewport position (fixed distance)
          const gRect = (g as SVGGraphicsElement).getBoundingClientRect();
          tooltip.textContent = match.title || match.file.basename;
          tooltip.style.visibility = 'visible';

          const vw = document.documentElement.clientWidth;
          const vh = document.documentElement.clientHeight;
          const half = TOOLTIP_WIDTH / 2;

          // center X of node in viewport
          const rawCenterX = gRect.left + gRect.width / 2;
          const centerX = Math.min(Math.max(rawCenterX, half + 8), vw - half - 8);
          tooltip.style.left = `${centerX - half}px`;

          // prefer placing below the node; if not enough space, place above
          requestAnimationFrame(() => {
            const ttHeight = tooltip.offsetHeight || 0;
            const preferredBelow = gRect.bottom + 8; // px below node
            const belowFits = preferredBelow + ttHeight <= vh - 8;
            const top = belowFits ? preferredBelow : Math.max(gRect.top - ttHeight - 8, 8);
            tooltip.style.top = `${top}px`;
          });
        });

        g.addEventListener('mouseleave', () => {
          tooltip.style.visibility = 'hidden';
        });
      }

      svg.appendChild(g);
    }

    container.appendChild(svg);
  }
}

class ZidAssignModal extends FuzzySuggestModal<TFile> {
  private files: TFile[];
  private newZid: string;
  private onChoose: (file: TFile) => Promise<void>;

  constructor(
    app: App,
    files: TFile[],
    newZid: string,
    onChoose: (file: TFile) => Promise<void>,
    placeholder?: string
  ) {
    super(app);
    this.files = files;
    this.newZid = newZid;
    this.onChoose = onChoose;
    if (placeholder) this.setPlaceholder(placeholder);
    else this.setPlaceholder(`Asignar ${newZid} a...`);
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.basename;
  }

  async onChooseItem(file: TFile): Promise<void> {
    await this.onChoose(file);
  }
}

class ConfirmModal extends Modal {
  private message: string;
  private resolve!: (value: boolean) => void;

  constructor(app: App, message: string) {
    super(app);
    this.message = message;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.message });
    const btnRow = contentEl.createEl('div', { cls: 'confirm-modal-row' });

    const btnOk = btnRow.createEl('button', { text: 'OK', cls: 'mod-cta' });
    const btnCancel = btnRow.createEl('button', { text: 'Cancel' });

    btnOk.onclick = () => this.closeAndResolve(true);
    btnCancel.onclick = () => this.closeAndResolve(false);
  }

  onClose() {
    this.contentEl.empty();
  }

  private closeAndResolve(val: boolean) {
    this.close();
    this.resolve(val);
  }

  openAndWait(): Promise<boolean> {
    this.open();
    return new Promise<boolean>((res) => {
      this.resolve = res;
    });
  }
}
