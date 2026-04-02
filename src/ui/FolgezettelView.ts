import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { I18n } from '../i18n';
import { ZettelType } from '../types';
import { calculateDepth, compareZid, generateUUID } from '../utils/zid';
import { ConfirmModal, ZidAssignModal } from './modals';
import FolgezettelPlugin from '../main';

export const VIEW_TYPE = 'folgezettel-view';

export class FolgezettelView extends ItemView {
  private listEl!: HTMLElement;
  private expandedState: Record<string, boolean> = {};
  private renderVersion = 0;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: FolgezettelPlugin) {
    super(leaf);
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return this.plugin.i18n.t('view.title'); }
  getIcon() { return 'brain'; }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    this.listEl = container.createEl('div', { cls: 'fzz-list tree-item-children' });
    await this.renderList();
  }

  async onClose() {}

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

  private async computeNewZid(node: { zid: string }, type: ZettelType): Promise<string> {
    const items = await this.collectZidFiles();
    const zids = new Set(items.map((it) => it.zid));
    const exists = (z: string) => zids.has(z);
    const incChar = (ch: string) => String.fromCharCode(ch.charCodeAt(0) + 1);
    let candidate = '';
    const zid = node.zid;

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
    } else if (type === 'branch') {
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
    } else if (type === 'inserted') {
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

  async createZettel(node: { zid: string }, type: ZettelType) {
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
    this.plugin.refreshViews();
  }

  async assignZettel(node: { zid: string }, type: ZettelType) {
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
    new ZidAssignModal(this.app, candidates, newZid, async (file) => {
      await this.addZidToFile(file, newZid);
    }, placeholder).open();
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
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();
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
      const treeItem = container.createEl('div', { cls: 'tree-item' });
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

      const innerEl = self.createEl('div', { cls: 'tree-item-inner fzz-title' });
      const zidSpan = innerEl.createEl('span', { text: node.zid, cls: 'fzz-zid' });
      zidSpan.style.fontFamily = 'var(--font-monospace, monospace)';
      zidSpan.style.marginRight = '8px';
      zidSpan.style.color = 'var(--text-muted)';

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
          btnNext.setAttr('aria-label', this.plugin.i18n.t('menu.createNext'));
          setIcon(btnNext, 'arrow-right');
          btnNext.onclick = async (e) => {
            e.stopPropagation();
            if (e.shiftKey) await this.assignZettel(node, 'next');
            else await this.createZettel(node, 'next');
          };

          const btnInserted = actions.createEl('button', { cls: 'fzz-action-btn' });
          btnInserted.setAttr('aria-label', this.plugin.i18n.t('menu.createInserted'));
          setIcon(btnInserted, 'corner-down-right');
          btnInserted.onclick = async (e) => {
            e.stopPropagation();
            if (e.shiftKey) await this.assignZettel(node, 'inserted');
            else await this.createZettel(node, 'inserted');
          };

          const btnBranch = actions.createEl('button', { cls: 'fzz-action-btn' });
          btnBranch.setAttr('aria-label', this.plugin.i18n.t('menu.createBranch'));
          setIcon(btnBranch, 'folder-input');
          btnBranch.onclick = async (e) => {
            e.stopPropagation();
            if (e.shiftKey) await this.assignZettel(node, 'branch');
            else await this.createZettel(node, 'branch');
          };

          Promise.all([
            this.computeNewZid(node, 'next'),
            this.computeNewZid(node, 'inserted'),
            this.computeNewZid(node, 'branch'),
          ]).then(([zNext, zInserted, zBranch]) => {
            btnNext.setAttr('aria-label', `${this.plugin.i18n.t('menu.createNext')} (${zNext})`);
            btnInserted.setAttr('aria-label', `${this.plugin.i18n.t('menu.createInserted')} (${zInserted})`);
            btnBranch.setAttr('aria-label', `${this.plugin.i18n.t('menu.createBranch')} (${zBranch})`);
          }).catch(() => { /* leave basic labels on error */ });
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
        this.plugin.refreshViews();
      };
    } catch (e) {
      console.error('Error creating new area:', e);
    }
  }
}
