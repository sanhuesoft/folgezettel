import { ItemView, Plugin, WorkspaceLeaf, TFile, Notice } from 'obsidian';

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
    loadExpandedState() {
      try {
        const raw = localStorage.getItem(this.expandedKey);
        if (raw) this.expandedState = JSON.parse(raw);
      } catch {}
    }

    saveExpandedState() {
      try {
        localStorage.setItem(this.expandedKey, JSON.stringify(this.expandedState));
      } catch {}
    }
  plugin: FolgezettelPlugin;
  listEl: HTMLElement;
  expandedState: Record<string, boolean> = {};

  constructor(leaf: WorkspaceLeaf, plugin: FolgezettelPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return 'Folgezettel';
  }

  async onOpen() {
    this.containerEl.empty();
    // Aplica clase raíz para padding externo
    this.containerEl.addClass('folgezettel-view-root');
    this.containerEl.createEl('h4', { text: 'Folgezettel (zid)' });
    this.listEl = this.containerEl.createEl('div');
    await this.renderList();
  }

  onClose() {}

  async collectZidFiles(): Promise<{ file: TFile; zid: string }[]> {
    const files = this.app.vault.getMarkdownFiles();
    const res: { file: TFile; zid: string }[] = [];
    for (const f of files) {
      // Siempre lee el contenido real para extraer frontmatter actualizado
      const content = await this.app.vault.cachedRead(f);
      let zid: string | undefined = undefined;
      const m = content.match(/^---\n([\s\S]*?)\n---/);
      if (m) {
        const fm = m[1].match(/^\s*zid\s*:\s*(.+)$/im);
        if (fm) zid = fm[1].trim().replace(/^['"]|['"]$/g, '');
      }
      // También acepta ZID mayúscula
      if (!zid && m) {
        const fm = m[1].match(/^\s*ZID\s*:\s*(.+)$/im);
        if (fm) zid = fm[1].trim().replace(/^['"]|['"]$/g, '');
      }
      if (zid) res.push({ file: f, zid });
    }
    return res;
  }

  async renderList() {
    this.listEl.empty();
    const items = await this.collectZidFiles();
    items.sort((a, b) => compareZid(a.zid, b.zid));
    // Detectar duplicados
    const zidCount: Record<string, number> = {};
    for (const it of items) {
      zidCount[it.zid] = (zidCount[it.zid] || 0) + 1;
    }
    const duplicatedZids = Object.keys(zidCount).filter(zid => zidCount[zid] > 1);
    if (duplicatedZids.length > 0) {
      new Notice(`ZIDs duplicados detectados: ${duplicatedZids.join(', ')}`);
    }
    // Construir árbol jerárquico estilo Luhmann
    const tree: Record<string, any> = {};
    const nodeMap: Record<string, any> = {};
    for (const it of items) {
      nodeMap[it.zid] = { ...it, children: [], parent: null };
    }
    for (const it of items) {
      // Buscar el mayor prefijo existente como padre
      let parentZid = '';
      for (let i = it.zid.length - 1; i > 0; i--) {
        const candidate = it.zid.slice(0, i);
        if (nodeMap[candidate]) {
          parentZid = candidate;
          break;
        }
      }
      if (parentZid) {
        nodeMap[it.zid].parent = nodeMap[parentZid];
        nodeMap[parentZid].children.push(nodeMap[it.zid]);
      } else {
        tree[it.zid] = nodeMap[it.zid];
      }
    }
    // Usar estado persistente
    const expanded = this.expandedState;
    // Render recursivo
    const renderNode = (node: any, depth: number) => {
        // Usar estructura nativa de Obsidian explorer
        const treeItem = this.listEl.createEl('div', { cls: 'tree-item' });
        treeItem.style.marginLeft = `${depth * 16}px`;
        const self = treeItem.createEl('div', { cls: 'tree-item-self' });
        // Flecha nativa
        if (node.children.length > 0) {
          if (expanded[node.zid] === undefined) expanded[node.zid] = true;
          const arrow = self.createEl('div', { cls: 'tree-item-icon' });
          arrow.classList.add('collapse-icon');
          arrow.classList.add(expanded[node.zid] ? 'is-collapsed' : 'is-expanded');
          // SVG flecha nativa
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
        // Zid columna
        const zidEl = self.createEl('span', { text: node.zid, cls: 'fzz-zid' });
        if (/^\d+$/.test(node.zid)) {
          zidEl.style.fontWeight = 'bold';
        }
        if (duplicatedZids.includes(node.zid)) {
          zidEl.style.color = 'var(--color-error, red)';
          zidEl.title = 'ZID duplicado';
        }
        // Título columna
        const titleEl = self.createEl('span', { text: ` ${node.file.basename}`, cls: 'fzz-title' });
        self.onclick = async () => {
          try {
            await this.app.workspace.getLeaf(false).openFile(node.file);
          } catch (e) {
            await this.app.workspace.getLeaf(true).openFile(node.file);
          }
        };
        // Render hijos si expandido
        if (node.children.length > 0 && expanded[node.zid]) {
          const childrenContainer = treeItem.createEl('div', { cls: 'tree-item-children' });
          for (const child of node.children) {
            // Render hijos en el contenedor
            renderNode(child, depth + 1);
          }
        }
    };
    // Render raíz
    Object.values(tree).forEach((node: any) => renderNode(node, 0));
  }
}
