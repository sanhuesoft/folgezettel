import { ItemView, TFile, WorkspaceLeaf } from 'obsidian';
import { I18n } from '../i18n';
import { compareZid } from '../utils/zid';
import FolgezettelPlugin from '../main';

export const GRAPH_VIEW_TYPE = 'folgezettel-graph';

export class FolgezettelGraphView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private readonly plugin: FolgezettelPlugin) {
    super(leaf);
  }

  getViewType() { return GRAPH_VIEW_TYPE; }
  getDisplayText() { return this.plugin.i18n.t('view.graphTitle') || 'Folgezettel Graph'; }
  getIcon() { return 'graph'; }

  async onClose() {
    document.querySelectorAll('.fzz-graph-tooltip').forEach((el) => el.remove());
  }

  async refresh() {
    document.querySelectorAll('.fzz-graph-tooltip').forEach((el) => el.remove());
    await this.onOpen();
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    const i18n = new I18n(this.plugin.settings.lang);
    const wrapper = container.createEl('div', { cls: 'fzz-graph-wrapper' });

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

  // ── Layout algorithm (ported from Swift buildLayout) ──────────────────────

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
      if (!zt || areaNumber(zt) !== area) continue;
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
      if (!last || segs.length <= 2) return false;
      const first = last[0];
      if (/\d/.test(first)) {
        if (segs.length >= 2 && /[a-zA-Z]/.test(segs[segs.length - 2].slice(-1)))
          return toks.length >= 2 && isSep(toks[toks.length - 2]);
        return true;
      }
      if (/[A-Z]/.test(first)) return true;
      if (/[a-z]/.test(first)) return segs.length >= 2 && /[A-Z]/.test(segs[segs.length - 2].slice(-1));
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
          if (z === br) return r;
          let cur: string | null = z;
          while (cur) { if (cur === br) return r; cur = parentZid(cur); if (!cur) break; }
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
          while (cur) { if (cur === zid) return colByZid[z]; cur = parentZid(cur); if (!cur) break; }
          return -Infinity;
        }).filter((n) => n !== -Infinity);
        const maxDescendantCol = descCols.length ? Math.max(...descCols) : col;
        nextFreeCol[row] = Math.max(nextFreeCol[row] ?? 0, maxDescendantCol + 1);
      }

      for (const seq of seqKids) place(seq, col, row);
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
        const pc = colByZid[p], pr = rowByZid[p];
        if (pc !== undefined && pr !== undefined)
          edges.push({ fromCol: pc, fromRow: pr, toCol: col, toRow: row, kind: isBranch(zid) ? 'branch' : 'sequence' });
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

  // ── SVG renderer ─────────────────────────────────────────────────────────

  private renderLayout(container: HTMLElement, layout: any, items: { file: TFile; zid: string; title: string }[], highlightZid?: string) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', String(layout.size.width));
    svg.setAttribute('height', String(layout.size.height));
    svg.style.display = 'block';
    svg.style.margin = '8px';

    const TOOLTIP_WIDTH = 260;
    const tooltip = document.createElement('div');
    tooltip.className = 'fzz-graph-tooltip';
    tooltip.style.cssText = [
      'position:fixed', 'pointer-events:none', 'visibility:hidden',
      'padding:6px 8px', 'border-radius:6px',
      'background:var(--background-modifier-card,#fff)',
      'color:var(--text-normal,#000)',
      'box-shadow:0 6px 18px rgba(0,0,0,0.12)',
      'font-size:12px', 'z-index:9999',
      `width:${TOOLTIP_WIDTH}px`,
      'white-space:normal', 'word-break:break-word',
      'text-align:left', 'box-sizing:border-box',
    ].join(';');
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
      circle.setAttribute('r', '26');
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

      const match = items.find((it) => it.zid === ln.node.zid);
      if (match) {
        g.style.cursor = 'pointer';
        g.addEventListener('click', async (e) => {
          e.stopPropagation();
          try { await this.app.workspace.getLeaf(false).openFile(match.file); }
          catch { await this.app.workspace.getLeaf(true).openFile(match.file); }
        });
        g.addEventListener('mouseenter', () => {
          const gRect = (g as SVGGraphicsElement).getBoundingClientRect();
          tooltip.textContent = match.title || match.file.basename;
          tooltip.style.visibility = 'visible';
          const vw = document.documentElement.clientWidth;
          const vh = document.documentElement.clientHeight;
          const half = TOOLTIP_WIDTH / 2;
          const rawCenterX = gRect.left + gRect.width / 2;
          const centerX = Math.min(Math.max(rawCenterX, half + 8), vw - half - 8);
          tooltip.style.left = `${centerX - half}px`;
          requestAnimationFrame(() => {
            const ttHeight = tooltip.offsetHeight || 0;
            const preferredBelow = gRect.bottom + 8;
            const belowFits = preferredBelow + ttHeight <= vh - 8;
            const top = belowFits ? preferredBelow : Math.max(gRect.top - ttHeight - 8, 8);
            tooltip.style.top = `${top}px`;
          });
        });
        g.addEventListener('mouseleave', () => { tooltip.style.visibility = 'hidden'; });
      }

      svg.appendChild(g);
    }

    container.appendChild(svg);
  }
}
