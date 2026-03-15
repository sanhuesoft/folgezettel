import { App, FuzzySuggestModal, ItemView, Plugin, WorkspaceLeaf, TFile, Notice, Menu } from 'obsidian';

const VIEW_TYPE = 'folgezettel-view';

type Token = { type: 'num' | 'alpha'; value: number };

function tokenize(zid: string): Token[] {
  zid = String(zid).replace(/\./g, '');
  const parts = zid.match(/(\d+|[a-zA-Z]+)/g) || [];
  return parts.map((p) => {
    if (/^\d+$/.test(p)) return { type: 'num', value: parseInt(p, 10) };
    const letters = p.toLowerCase().split('');
    let val = 0;
    for (const ch of letters) val = val * 27 + (ch.charCodeAt(0) - 96);
    return { type: 'alpha', value: val };
  });
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
      if (xa.value !== xb.value) return xa.value - xb.value;
    } else {
      return xa.type === 'num' ? -1 : 1;
    }
  }
  return 0;
}

export default class FolgezettelPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE, (leaf) => new FolgezettelView(leaf, this));

    this.addCommand({
      id: 'open-folgezettel',
      name: 'Open Folgezettel sidebar',
      callback: () => this.activateView(),
    });

    this.app.workspace.onLayoutReady(() => this.activateView());

    this.registerEvent(this.app.vault.on('modify', () => this.refreshViews()));
    this.registerEvent(this.app.vault.on('create', () => this.refreshViews()));
    this.registerEvent(this.app.vault.on('delete', () => this.refreshViews()));
    this.registerEvent(this.app.vault.on('rename', () => this.refreshViews()));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async activateView() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    await this.app.workspace.getRightLeaf(false).setViewState({ type: VIEW_TYPE, active: true });
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length) this.app.workspace.revealLeaf(leaves[0]);
  }

  refreshViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    leaves.forEach((leaf) => (leaf.view as FolgezettelView).renderList());
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
    this.expandedState = this.loadExpandedState();
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return 'Folgezettel';
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    this.listEl = container.createEl('div', { cls: 'fzz-list tree-item-children' });
    await this.renderList();
  }

  async onClose() {
    this.saveExpandedState();
  }

  private loadExpandedState(): Record<string, boolean> {
    try {
      const raw = localStorage.getItem('fzz-expanded-state');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_e) {
      // Ignore invalid persisted state
    }
    return {};
  }

  private saveExpandedState() {
    localStorage.setItem('fzz-expanded-state', JSON.stringify(this.expandedState));
  }

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

  private async computeNewZid(node: { zid: string }, type: 'next' | 'lateral' | 'deep'): Promise<string> {
    const items = await this.collectZidFiles();
    const zids = items.map((it) => it.zid);
    let newZid = '';

    if (type === 'next') {
      const match = node.zid.match(/^(.*?)(\d+)([a-zA-Z]*)$/);
      if (match) {
        const prefix = match[1];
        const number = parseInt(match[2], 10);
        const suffix = match[3] || '';
        if (suffix) {
          let nextChar = String.fromCharCode(suffix.toLowerCase().charCodeAt(0) + 1);
          newZid = `${prefix}${number}${nextChar}`;
          while (zids.includes(newZid)) {
            nextChar = String.fromCharCode(nextChar.charCodeAt(0) + 1);
            newZid = `${prefix}${number}${nextChar}`;
          }
        } else {
          let nextNum = number + 1;
          newZid = `${prefix}${nextNum}`;
          while (zids.includes(newZid)) {
            nextNum += 1;
            newZid = `${prefix}${nextNum}`;
          }
        }
      } else {
        let n = 1;
        newZid = `${node.zid}${n}`;
        while (zids.includes(newZid)) {
          n += 1;
          newZid = `${node.zid}${n}`;
        }
      }
    }

    if (type === 'lateral') {
      let suffix = 'a';
      newZid = `${node.zid}${suffix}`;
      while (zids.includes(newZid)) {
        suffix = String.fromCharCode(suffix.charCodeAt(0) + 1);
        newZid = `${node.zid}${suffix}`;
      }
    }

    if (type === 'deep') {
      let idx = 1;
      newZid = `${node.zid}.${idx}`;
      while (zids.includes(newZid)) {
        idx += 1;
        newZid = `${node.zid}.${idx}`;
      }
    }

    return newZid;
  }

  async createZettel(node: { zid: string }, type: 'next' | 'lateral' | 'deep') {
    const newZid = await this.computeNewZid(node, type);

    const baseName = `Nota ${newZid}`;
    let fileName = baseName;
    let idx = 1;
    while (this.app.vault.getFiles().some((f) => f.basename === fileName)) {
      fileName = `${baseName} ${idx}`;
      idx += 1;
    }

    const content = `---\nzid: ${newZid}\n---\n`;
    const newFile = await this.app.vault.create(`${fileName}.md`, content);
    await this.app.workspace.getLeaf(false).openFile(newFile);
    this.refreshViews();
  }

  async assignZettel(node: { zid: string }, type: 'next' | 'lateral' | 'deep') {
    const newZid = await this.computeNewZid(node, type);

    const allFiles = this.app.vault.getMarkdownFiles();
    const withZid = await this.collectZidFiles();
    const pathsWithZid = new Set(withZid.map((it) => it.file.path));
    const candidates = allFiles.filter((f) => !pathsWithZid.has(f.path));

    if (candidates.length === 0) {
      new Notice('No hay notas sin ZID en la bóveda.');
      return;
    }

    new ZidAssignModal(this.app, candidates, newZid, async (file) => {
      await this.addZidToFile(file, newZid);
      // El evento vault.modify ya dispara refreshViews automáticamente
    }).open();
  }

  private async addZidToFile(file: TFile, zid: string) {
    const content = await this.app.vault.read(file);
    let newContent: string;

    if (/^---\n/.test(content)) {
      // Insertar el campo zid justo antes del cierre --- sin tocar nada más
      newContent = content.replace(/^(---\n[\s\S]*?)(\n---)/, `$1\nzid: ${zid}$2`);
    } else {
      // Crear frontmatter mínimo al inicio
      newContent = `---\nzid: ${zid}\n---\n${content}`;
    }

    await this.app.vault.modify(file, newContent);
    new Notice(`ZID ${zid} asignado a "${file.basename}"`);
  }

  async renderList() {
    if (!this.listEl) return;
    const version = ++this.renderVersion;

    const items = await this.collectZidFiles();

    // Si una llamada más reciente llegó mientras esperábamos, la cedemos el paso
    if (version !== this.renderVersion) return;

    this.listEl.empty();
    items.sort((a, b) => compareZid(a.zid, b.zid));

    const zidCount: Record<string, number> = {};
    for (const it of items) zidCount[it.zid] = (zidCount[it.zid] || 0) + 1;
    const duplicatedZids = Object.keys(zidCount).filter((zid) => zidCount[zid] > 1);
    if (duplicatedZids.length > 0) {
      new Notice(`ZIDs duplicados detectados: ${duplicatedZids.join(', ')}`);
    }

    type TreeNode = { file: TFile; zid: string; parent: TreeNode | null; children: TreeNode[] };
    const roots: Record<string, TreeNode> = {};
    const nodeMap: Record<string, TreeNode> = {};

    for (const it of items) {
      nodeMap[it.zid] = { file: it.file, zid: it.zid, parent: null, children: [] };
    }

    for (const it of items) {
      let parentZid = '';
      for (let i = it.zid.length - 1; i > 0; i -= 1) {
        const candidate = it.zid.slice(0, i);
        // Considerar relación padre-hijo solo si el carácter siguiente es un punto (deep note)
        // Esto evita que sufijos laterales tipo '1.1a' se conviertan en hijos de '1.1'
        if (nodeMap[candidate] && it.zid.charAt(i) === '.') {
          parentZid = candidate;
          break;
        }
      }
      if (parentZid) {
        nodeMap[it.zid].parent = nodeMap[parentZid];
        nodeMap[parentZid].children.push(nodeMap[it.zid]);
      } else {
        roots[it.zid] = nodeMap[it.zid];
      }
    }

    const expanded = this.expandedState;

    const renderNode = (node: TreeNode, depth: number, container: HTMLElement = this.listEl) => {
      const treeItem = container.createEl('div', { cls: 'tree-item' });
      treeItem.style.marginLeft = `${depth * 16}px`;
      const self = treeItem.createEl('div', { cls: 'tree-item-self' });

      self.oncontextmenu = (event) => {
        event.preventDefault();
        const menu = new Menu();
        menu.addItem((item) => {
          item.setTitle('Crear nota siguiente');
          item.setIcon('arrow-right');
          item.onClick(async () => this.createZettel(node, 'next'));
        });
        menu.addItem((item) => {
          item.setTitle('Asignar nota siguiente');
          item.setIcon('link');
          item.onClick(async () => this.assignZettel(node, 'next'));
        });
        menu.addItem((item) => {
          item.setTitle('Crear nota lateral');
          item.setIcon('split');
          item.onClick(async () => this.createZettel(node, 'lateral'));
        });
        menu.addItem((item) => {
          item.setTitle('Asignar nota lateral');
          item.setIcon('link');
          item.onClick(async () => this.assignZettel(node, 'lateral'));
        });
        menu.addItem((item) => {
          item.setTitle('Crear nota de profundización');
          item.setIcon('down-arrow');
          item.onClick(async () => this.createZettel(node, 'deep'));
        });
        menu.addItem((item) => {
          item.setTitle('Asignar nota de profundización');
          item.setIcon('link');
          item.onClick(async () => this.assignZettel(node, 'deep'));
        });
        menu.showAtPosition({ x: event.pageX, y: event.pageY });
      };

      if (node.children.length > 0) {
        if (expanded[node.zid] === undefined) expanded[node.zid] = true;
        const arrow = self.createEl('div', { cls: 'tree-item-icon collapse-icon' });
        arrow.classList.add(expanded[node.zid] ? 'is-collapsed' : 'is-expanded');

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.style.transition = 'transform 0.2s';
        svg.style.transform = expanded[node.zid] ? 'rotate(90deg)' : 'rotate(0deg)';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M6 4l4 4-4 4');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('fill', 'none');
        svg.appendChild(path);
        arrow.appendChild(svg);

        arrow.onclick = (e) => {
          e.stopPropagation();
          expanded[node.zid] = !expanded[node.zid];
          this.saveExpandedState();
          this.renderList();
        };
      }

      const zidEl = self.createEl('span', { text: node.zid, cls: 'fzz-zid' });
      // Mostrar ZID completo en tooltip; truncar visualmente via CSS
      zidEl.title = node.zid;
      if (/^\d+$/.test(node.zid)) zidEl.style.fontWeight = 'bold';
      if (duplicatedZids.includes(node.zid)) {
        zidEl.style.color = 'var(--color-error, red)';
        zidEl.title = `${node.zid} — ZID duplicado`;
      }

      self.createEl('span', { text: ` ${node.file.basename}`, cls: 'fzz-title' });

      self.onclick = async () => {
        try {
          await this.app.workspace.getLeaf(false).openFile(node.file);
        } catch (_e) {
          await this.app.workspace.getLeaf(true).openFile(node.file);
        }
      };

      if (node.children.length > 0 && expanded[node.zid]) {
        // Crear contenedor para hijos que muestra la línea vertical
        const childrenContainer = treeItem.createEl('div', { cls: 'tree-item-children' });
        for (const child of node.children) renderNode(child, depth + 1, childrenContainer);
      }
    };

    Object.values(roots).forEach((node) => renderNode(node, 0));
  }
}

class ZidAssignModal extends FuzzySuggestModal<TFile> {
  private files: TFile[];
  private newZid: string;
  private onChoose: (file: TFile) => Promise<void>;

  constructor(app: App, files: TFile[], newZid: string, onChoose: (file: TFile) => Promise<void>) {
    super(app);
    this.files = files;
    this.newZid = newZid;
    this.onChoose = onChoose;
    this.setPlaceholder(`Buscar nota sin ZID para asignarle ${newZid}…`);
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
