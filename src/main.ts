import { App, FuzzySuggestModal, ItemView, Plugin, WorkspaceLeaf, TFile, Notice, Menu, setIcon } from 'obsidian';
import { DEFAULT_SETTINGS, FolgezettelSettingTab, PluginSettings } from './settings';
import { I18n } from './i18n';

const VIEW_TYPE = 'folgezettel-view';

type Token = { type: 'num' | 'upper' | 'lower' | 'sep'; value: number | string };

function tokenize(zid: string): Token[] {
  const s = String(zid);
  const parts = s.match(/(\d+|[A-Z]+|[a-z]+|[.,\/])/g) || [];
  return parts.map((p) => {
    if (/^\d+$/.test(p)) return { type: 'num', value: parseInt(p, 10) };
    if (/^[A-Z]+$/.test(p)) return { type: 'upper', value: p };
    if (/^[a-z]+$/.test(p)) return { type: 'lower', value: p };
    return { type: 'sep', value: p };
  });
}

function typeRank(t: Token['type']) {
  // Define ordering so that numeric/depth separators come before uppercase branches:
  // num < sep < upper < lower
  if (t === 'num') return 1;
  if (t === 'sep') return 2;
  if (t === 'upper') return 3;
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

    this.addCommand({
      id: 'open-fz',
      name: this.i18n.t('command.open'),
      callback: () => this.activateView(),
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
    return this.plugin.i18n.t('view.title');
  }

  getIcon() {
    return 'archive';
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
      console.error('Error loading expanded state:', _e);
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

  private async computeNewZid(
    node: { zid: string },
    type: 'next' | 'lateral' | 'deep' | 'branch' | 'footnote' | 'inserted'
  ): Promise<string> {
    const items = await this.collectZidFiles();
    const zids = items.map((it) => it.zid);
    let newZid = '';
    const exists = (z: string) => zids.includes(z);

    const incChar = (ch: string) => String.fromCharCode(ch.charCodeAt(0) + 1);

    if (type === 'next') {
      // If ends with number -> increment number
      const mNum = node.zid.match(/^(.*?)(\d+)$/);
      if (mNum) {
        const prefix = mNum[1];
        let num = parseInt(mNum[2], 10) + 1;
        newZid = `${prefix}${num}`;
        while (exists(newZid)) {
          num += 1;
          newZid = `${prefix}${num}`;
        }
      } else {
        // If ends with uppercase
        const mUp = node.zid.match(/^(.*?)([A-Z])$/);
        if (mUp) {
          const prefix = mUp[1];
          let ch = mUp[2];
          let next = incChar(ch);
          newZid = `${prefix}${next}`;
          while (exists(newZid)) {
            next = incChar(next);
            newZid = `${prefix}${next}`;
          }
        } else {
          // ends with lowercase
          const mLow = node.zid.match(/^(.*?)([a-z])$/);
          if (mLow) {
            const prefix = mLow[1];
            let ch = mLow[2];
            let next = incChar(ch);
            newZid = `${prefix}${next}`;
            while (exists(newZid)) {
              next = incChar(next);
              newZid = `${prefix}${next}`;
            }
          } else {
            // fallback: append 1
            let n = 1;
            newZid = `${node.zid}${n}`;
            while (exists(newZid)) {
              n += 1;
              newZid = `${node.zid}${n}`;
            }
          }
        }
      }
    }

    if (type === 'branch' || type === 'lateral') {
      // Branch notes: indented a level relative to parent.
      // If ends in number -> add uppercase letter. 1.1 -> 1.1A
      // If ends uppercase -> add lowercase letter. 1.1A -> 1.1Aa
      // If ends lowercase -> add uppercase letter. 7.5a -> 7.5aA
      const mNum = node.zid.match(/^(.*?)(\d+)$/);
      if (mNum) {
        let suffix = 'A';
        newZid = `${node.zid}${suffix}`;
        while (exists(newZid)) {
          suffix = incChar(suffix);
          newZid = `${node.zid}${suffix}`;
        }
      } else if (/.*[A-Z]$/.test(node.zid)) {
        let suffix = 'a';
        newZid = `${node.zid}${suffix}`;
        while (exists(newZid)) {
          suffix = incChar(suffix);
          newZid = `${node.zid}${suffix}`;
        }
      } else {
        // ends lowercase (or other): append uppercase
        let suffix = 'A';
        newZid = `${node.zid}${suffix}`;
        while (exists(newZid)) {
          suffix = incChar(suffix);
          newZid = `${node.zid}${suffix}`;
        }
      }
    }

    if (type === 'footnote') {
      // Footnote: indented one level, placed before branch notes. Always add
      // configured separator and the first available numeric index.
      const sep = this.plugin.settings?.separator || '.';
      let idx = 1;
      newZid = `${node.zid}${sep}${idx}`;
      while (exists(newZid)) {
        idx += 1;
        newZid = `${node.zid}${sep}${idx}`;
      }
    }

    if (type === 'inserted') {
      // Inserted notes: same level as parent (sibling insertion)
      // If ends with number -> add lowercase letter 1.1 -> 1.1a
      // If ends with uppercase -> add numeric suffix 6.5A -> 6.5A1
      // If ends with lowercase -> try to create next-lowercase+'1' if that sibling exists,
      // otherwise append number to current (6.5a1).
      const mNum = node.zid.match(/^(.*?)(\d+)$/);
      if (mNum) {
        let suffix = 'a';
        newZid = `${node.zid}${suffix}`;
        while (exists(newZid)) {
          suffix = incChar(suffix);
          newZid = `${node.zid}${suffix}`;
        }
      } else if (/.*[A-Z]$/.test(node.zid)) {
        let idx = 1;
        newZid = `${node.zid}${idx}`;
        while (exists(newZid)) {
          idx += 1;
          newZid = `${node.zid}${idx}`;
        }
      } else if (/.*[a-z]$/.test(node.zid)) {
        const last = node.zid.slice(-1);
        const nextLetter = incChar(last);
        const baseNext = `${node.zid.slice(0, -1)}${nextLetter}`;
        // Prefer creating the sibling without numeric suffix (e.g. 2.2b) if free,
        // otherwise try baseNext + '1', otherwise append numeric suffix to current.
        if (!exists(baseNext)) {
          newZid = baseNext;
        } else {
          let candidate = `${baseNext}1`;
          if (!exists(candidate)) {
            newZid = candidate;
          } else {
            let idx = 1;
            newZid = `${node.zid}${idx}`;
            while (exists(newZid)) {
              idx += 1;
              newZid = `${node.zid}${idx}`;
            }
          }
        }
      } else {
        // fallback
        let n = 1;
        newZid = `${node.zid}${n}`;
        while (exists(newZid)) {
          n += 1;
          newZid = `${node.zid}${n}`;
        }
      }
    }

    return newZid;
  }

  async createZettel(
    node: { zid: string },
    type: 'next' | 'lateral' | 'deep' | 'branch' | 'footnote' | 'inserted'
  ) {
    const newZid = await this.computeNewZid(node, type);

    // Use Obsidian-like untitled naming to avoid OS filename collisions
    const baseName = this.plugin.i18n.t('note.untitled');
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

  async assignZettel(
    node: { zid: string },
    type: 'next' | 'lateral' | 'deep' | 'branch' | 'footnote' | 'inserted'
  ) {
    const newZid = await this.computeNewZid(node, type);

    const allFiles = this.app.vault.getMarkdownFiles();
    const withZid = await this.collectZidFiles();
    const pathsWithZid = new Set(withZid.map((it) => it.file.path));
    const candidates = allFiles.filter((f) => !pathsWithZid.has(f.path));

    if (candidates.length === 0) {
      new Notice(this.plugin.i18n.t('notice.noCandidates'));
      return;
    }
    new ZidAssignModal(
      this.app,
      candidates,
      newZid,
      async (file) => {
        await this.addZidToFile(file, newZid);
        // El evento vault.modify ya dispara refreshViews automáticamente
      },
      this.plugin.i18n.t('modal.assignPlaceholder', { zid: newZid })
    ).open();
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
    new Notice(this.plugin.i18n.t('notice.zidAssigned', { zid, name: file.basename }));
  }

  async removeZidFromFile(file: TFile) {
    const content = await this.app.vault.read(file);
    const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!m) {
      new Notice(this.plugin.i18n.t('notice.noFrontmatter'));
      return;
    }

    const fm = m[1];
    const lines = fm.split(/\r?\n/);
    const filtered = lines.filter((ln) => !/^\s*zid\s*:/i.test(ln));
    const newFm = filtered.join('\n').trim();

    let newContent: string;
    if (newFm === '') {
      // Eliminar frontmatter por completo
      newContent = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    } else {
      newContent = content.replace(/^---\n([\s\S]*?)\n---/, `---\n${newFm}\n---`);
    }

    await this.app.vault.modify(file, newContent);
    new Notice(this.plugin.i18n.t('notice.zidRemoved', { name: file.basename }));
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
      new Notice(
        this.plugin.i18n.t('notice.duplicatedZids', { list: duplicatedZids.join(', ') })
      );
    }

    type TreeNode = { file: TFile; zid: string; parent: TreeNode | null; children: TreeNode[] };
    const roots: Record<string, TreeNode> = {};
    const nodeMap: Record<string, TreeNode> = {};

    for (const it of items) {
      nodeMap[it.zid] = { file: it.file, zid: it.zid, parent: null, children: [] };
    }

    for (const it of items) {
      let parentZid = '';
      const sepChar = this.plugin.settings?.separator || '.';
      for (let i = it.zid.length - 1; i > 0; i -= 1) {
        const candidate = it.zid.slice(0, i);
        if (!nodeMap[candidate]) continue;
        // Character immediately after candidate
        const nextChar = it.zid.charAt(i);
        const suffix = it.zid.slice(i);

        // 1) If the next character is the configured separator -> parent
        if (nextChar === sepChar) {
          parentZid = candidate;
          break;
        }

        // 2) If suffix begins with one or more uppercase letters -> child (deeper level)
        if (/^[A-Z]/.test(suffix)) {
          parentZid = candidate;
          break;
        }

        // 3) If suffix is purely digits and the candidate ends with uppercase -> numeric child of uppercase (e.g., 1.1A1)
        if (/^\d+$/.test(suffix) && /[A-Z]$/.test(candidate)) {
          parentZid = candidate;
          break;
        }

        // 4) If suffix is lowercase but the candidate itself ends with uppercase,
        //    then it's a child of the uppercase node (e.g., 1.1A -> 1.1Aa)
        if (/^[a-z]+$/.test(suffix) && /[A-Z]$/.test(candidate)) {
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
      // Keep the visible row height constant to avoid layout glitches when sidebar is narrow
      self.style.minHeight = '24px';
      self.style.height = '24px';
      self.style.display = 'flex';
      self.style.alignItems = 'center';
      self.style.gap = '8px';

      self.oncontextmenu = (event) => {
        event.preventDefault();
        const menu = new Menu(this.app);
        // menu.addSeparator();
        menu.addItem((item) => {
          item.setTitle(this.plugin.i18n.t('menu.removeZid'));
          item.setIcon('trash');
          item.onClick(async () => {
            const ok = confirm(
              this.plugin.i18n.t('confirm.removeZid', { zid: node.zid, name: node.file.basename })
            );
            if (!ok) return;
            await this.removeZidFromFile(node.file);
          });
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
      if (duplicatedZids.includes(node.zid)) {
        zidEl.style.color = 'var(--color-error, red)';
        zidEl.title = `${node.zid} — ZID duplicado`;
      }

      const titleSpan = self.createEl('span', { text: ` ${node.file.basename}`, cls: 'fzz-title' });
      // Truncate long note names with ellipsis
      titleSpan.style.display = 'inline-block';
      titleSpan.style.maxWidth = '9em';
      titleSpan.style.overflow = 'hidden';
      titleSpan.style.textOverflow = 'ellipsis';
      titleSpan.style.whiteSpace = 'nowrap';
      titleSpan.style.verticalAlign = 'middle';

      // Acción a la derecha: crear nueva rama desde este nodo (icono corner-down-right)
      try {
        // No mostrar el botón en áreas de primer nivel (ZID numérico)
        if (!/^\d+$/.test(node.zid)) {
          const actions = self.createEl('div', { cls: 'fzz-actions' });
          actions.style.marginLeft = 'auto';
          // Hide actions by default; they become visible when the row is hovered
          actions.style.opacity = '0';
          actions.style.transition = 'opacity 0.15s ease';
          actions.style.pointerEvents = 'none';
          // Toggle visibility only when hovering the row itself (not its children)
          self.onmouseenter = () => {
            actions.style.opacity = '1';
            actions.style.pointerEvents = 'auto';
          };
          self.onmouseleave = () => {
            actions.style.opacity = '0';
            actions.style.pointerEvents = 'none';
          };

          // Leftmost small circular button: move-down (create footnote)
          const btnFootnote = actions.createEl('button', { cls: 'fzz-action-btn' });
          btnFootnote.setAttr('aria-label', this.plugin.i18n.t('action.createFootnote'));
          btnFootnote.style.width = '16px';
          btnFootnote.style.height = '16px';
          btnFootnote.style.padding = '2px';
          btnFootnote.style.border = '0';
          btnFootnote.style.borderRadius = '50%';
          btnFootnote.style.display = 'inline-flex';
          btnFootnote.style.alignItems = 'center';
          btnFootnote.style.justifyContent = 'center';
          btnFootnote.style.background = 'transparent';
          btnFootnote.style.color = 'var(--text-muted, currentColor)';
          setIcon(btnFootnote, 'move-down');
          const svgFoot = btnFootnote.querySelector('svg');
          if (svgFoot) {
            svgFoot.setAttribute('width', '12');
            svgFoot.setAttribute('height', '12');
          }
          btnFootnote.onclick = async (e) => {
            e.stopPropagation();
            if (e.shiftKey) {
              await this.assignZettel(node, 'footnote');
              return;
            }
            await this.createZettel(node, 'footnote');
          };

          // Middle button: move-right (creates next or inserted depending on position)
          const btnInsertOrNext = actions.createEl('button', { cls: 'fzz-action-btn' });
          btnInsertOrNext.setAttr('aria-label', this.plugin.i18n.t('action.insertOrNext'));
          btnInsertOrNext.style.width = '16px';
          btnInsertOrNext.style.height = '16px';
          btnInsertOrNext.style.padding = '2px';
          btnInsertOrNext.style.border = '0';
          btnInsertOrNext.style.borderRadius = '50%';
          btnInsertOrNext.style.display = 'inline-flex';
          btnInsertOrNext.style.alignItems = 'center';
          btnInsertOrNext.style.justifyContent = 'center';
          btnInsertOrNext.style.background = 'transparent';
          btnInsertOrNext.style.color = 'var(--text-muted, currentColor)';
          setIcon(btnInsertOrNext, 'move-right');
          const svgInsert = btnInsertOrNext.querySelector('svg');
          if (svgInsert) {
            svgInsert.setAttribute('width', '12');
            svgInsert.setAttribute('height', '12');
          }
          btnInsertOrNext.onclick = async (e) => {
            e.stopPropagation();
            // Determine siblings for node to see if it's last in its level
            const siblings = node.parent ? node.parent.children : Object.values(roots);
            const idx = siblings.findIndex((s) => s.zid === node.zid);
            const isLast = idx === siblings.length - 1;
            if (isLast) {
              if (e.shiftKey) await this.assignZettel(node, 'next');
              else await this.createZettel(node, 'next');
            } else {
              if (e.shiftKey) await this.assignZettel(node, 'inserted');
              else await this.createZettel(node, 'inserted');
            }
          };

          // Right small circular button: corner-down-right (creates branch)
          const btn = actions.createEl('button', { cls: 'fzz-action-btn' });
          btn.setAttr('aria-label', this.plugin.i18n.t('action.createBranch'));
          // Small circular icon button styled via inline styles to match theme colors
          btn.style.width = '16px';
          btn.style.height = '16px';
          btn.style.padding = '2px';
          btn.style.border = '0';
          btn.style.borderRadius = '50%';
          btn.style.display = 'inline-flex';
          btn.style.alignItems = 'center';
          btn.style.justifyContent = 'center';
          btn.style.background = 'transparent';
          btn.style.color = 'var(--text-muted, currentColor)';
          setIcon(btn, 'corner-down-right');
          // Reduce SVG size if created
          const svg = btn.querySelector('svg');
          if (svg) {
            svg.setAttribute('width', '12');
            svg.setAttribute('height', '12');
          }
          btn.onclick = async (e) => {
            e.stopPropagation();
            if (e.shiftKey) {
              await this.assignZettel(node, 'branch');
            } else {
              await this.createZettel(node, 'branch');
            }
          };
        }
      } catch (_e) {
        console.error('Error creating action buttons:', _e);
      }

      self.onclick = async () => {
        try {
          await this.app.workspace.getLeaf(false).openFile(node.file);
        } catch (_e) {
          console.error('Error opening file:', _e);
          await this.app.workspace.getLeaf(true).openFile(node.file);
        }
      };

      if (expanded[node.zid]) {
        // Crear contenedor para hijos que muestra la línea vertical
        const childrenContainer = treeItem.createEl('div', { cls: 'tree-item-children' });
        for (const child of node.children) renderNode(child, depth + 1, childrenContainer);

        // (Removed per-level placeholder row — branch creation now via right-aligned button)
      }
    };

    Object.values(roots).forEach((node) => renderNode(node, 0));

    // Añadir opción al final para crear un área nueva alineada con el nivel raíz
    try {
      const topKeys = Object.keys(roots)
        .map((k) => parseInt(k, 10))
        .filter((n) => !isNaN(n));
      const maxTop = topKeys.length ? Math.max(...topKeys) : 0;
      const nextArea = maxTop + 1;

      // Crear un nodo visual con la misma estructura que renderNode
      const treeItem = this.listEl.createEl('div', { cls: 'tree-item create-area' });
      treeItem.style.marginLeft = `${0 * 16}px`;
      treeItem.style.marginTop = '8px';
      const self = treeItem.createEl('div', { cls: 'tree-item-self' });
      self.style.cursor = 'pointer';
      self.style.minHeight = '24px';
      self.style.height = '24px';
      self.style.display = 'flex';
      self.style.alignItems = 'center';
      self.style.gap = '8px';

      // Zid area (icono plus en el lugar del zid)
      const zidEl = self.createEl('span', { cls: 'fzz-zid' });
      // Mostrar el número correlativo donde normalmente va el ZID
      zidEl.title = String(nextArea);
      zidEl.textContent = String(nextArea);

      // Texto alineado donde va el título (en cursiva)
      const titleEl = self.createEl('span', {
        text: ` ${this.plugin.i18n.t('action.createArea')}`,
        cls: 'fzz-title',
      });
      titleEl.style.fontStyle = 'italic';

      self.onclick = async () => {
        const zid = String(nextArea);
        const baseName = this.plugin.i18n.t('note.untitled');
        let fileName = baseName;
        let idx = 1;
        while (this.app.vault.getFiles().some((f) => f.basename === fileName)) {
          fileName = `${baseName} ${idx}`;
          idx += 1;
        }

        const content = `---\nzid: ${zid}\n---\n`;
        const newFile = await this.app.vault.create(`${fileName}.md`, content);
        try {
          await this.app.workspace.getLeaf(false).openFile(newFile);
        } catch (_e) {
          console.error('Error opening new area file:', _e);
          await this.app.workspace.getLeaf(true).openFile(newFile);
        }
        this.refreshViews();
      };
    } catch (e) {
      console.error('Error creating new area:', e);
    }
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
    else this.setPlaceholder(new I18n('auto').t('modal.assignPlaceholder', { zid: newZid }));
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
