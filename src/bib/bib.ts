import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  TFile,
} from 'obsidian';
// eslint-disable-next-line import/no-extraneous-dependencies
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
// eslint-disable-next-line import/no-extraneous-dependencies
import { RangeSetBuilder } from '@codemirror/state';
import { BibEntry } from '../types';

// ── Constants ─────────────────────────────────────────────────────────────────

export const BIBLIO_FOLDER = 'Bibliografía';

/** Matches {{key}} or {{key:pages}}. Group 1 → key, Group 2 → pages (optional). */
export const CITATION_SOURCE = String.raw`\{\{([^}:]+?)(?::([^}]+?))?\}\}`;

// ── Interface for the plugin subset bib needs ─────────────────────────────────

export interface BibPlugin {
  getBibEntry(key: string): Promise<BibEntry | null>;
}

// ── Hover popup render child ──────────────────────────────────────────────────

export class BibRenderChild extends MarkdownRenderChild {
  private activePopup: HTMLElement | null = null;

  constructor(containerEl: HTMLElement, private readonly plugin: BibPlugin) {
    super(containerEl);
  }

  onload(): void {
    this.containerEl.querySelectorAll<HTMLElement>('.bibman-cite').forEach((cite) => {
      this.registerDomEvent(cite, 'mouseenter', () => void this.showPopup(cite));
      this.registerDomEvent(cite, 'mouseleave', () => this.hidePopup());
    });
  }

  onunload(): void { this.hidePopup(); }

  private async showPopup(cite: HTMLElement): Promise<void> {
    const key = cite.dataset.bibkey;
    if (!key) return;
    const entry = await this.plugin.getBibEntry(key);
    this.hidePopup();
    const popup = document.createElement('div');
    popup.className = 'bibman-popup';
    if (entry) {
      if (entry.title) {
        const p = popup.appendChild(document.createElement('p'));
        p.className = 'bibman-popup__title';
        p.textContent = entry.title;
      }
      let authorLine = '';
      if (Array.isArray(entry.authors) && entry.authors.length > 0) {
        authorLine = entry.authors.join(' · ');
      } else if (entry.author) {
        authorLine = entry.author;
      }
      if (authorLine) {
        const p = popup.appendChild(document.createElement('p'));
        p.className = 'bibman-popup__author';
        p.textContent = authorLine;
      }
      if (entry.year != null) {
        const p = popup.appendChild(document.createElement('p'));
        p.className = 'bibman-popup__year';
        p.textContent = String(entry.year);
      }
    } else {
      const p = popup.appendChild(document.createElement('p'));
      p.className = 'bibman-popup__error';
      p.textContent = `Referencia no encontrada: ${key}`;
    }
    const rect = cite.getBoundingClientRect();
    popup.style.setProperty('--bibman-x', `${Math.round(rect.left)}px`);
    popup.style.setProperty('--bibman-y', `${Math.round(rect.bottom + 6)}px`);
    document.body.appendChild(popup);
    this.activePopup = popup;
  }

  private hidePopup(): void {
    this.activePopup?.remove();
    this.activePopup = null;
  }
}

// ── CM6 editor extension — highlight {{...}} in source / live-preview ─────────

function decorateView(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const mark = Decoration.mark({ class: 'bibman-inline-cite' });
  const re = new RegExp(CITATION_SOURCE, 'g');
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const start = from + match.index;
      builder.add(start, start + match[0].length, mark);
    }
  }
  return builder.finish();
}

export const citationEditorPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = decorateView(view); }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) this.decorations = decorateView(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Editor suggest — autocomplete {{...}} from Bibliografía folder ─────────────

export class BibEditorSuggest extends EditorSuggest<TFile> {
  constructor(app: App, private readonly plugin: BibPlugin) { super(app); }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line).slice(0, cursor.ch);
    const m = line.match(/\{\{([^}]*)$/);
    if (!m) return null;
    return { start: { line: cursor.line, ch: m.index ?? 0 }, end: cursor, query: m[1] ?? '' };
  }

  getSuggestions(context: EditorSuggestContext): TFile[] {
    const q = context.query.toLowerCase().trim();
    const files = this.app.vault.getFiles().filter(
      (f) => f.path.startsWith(`${BIBLIO_FOLDER}/`) && f.extension === 'md',
    );
    if (!q) return files.sort((a, b) => a.basename.localeCompare(b.basename)).slice(0, 100);
    return files.filter((f) =>
      f.basename.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
    ).slice(0, 100);
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.empty();
    el.addClass('bibman-suggest');
    el.createEl('div', { text: file.basename, cls: 'bibman-suggest-name' });
  }

  selectSuggestion(file: TFile): void {
    const ctx = this.context;
    if (!ctx) return;
    const editor = ctx.editor;
    const look = editor.getRange(ctx.end, { line: ctx.end.line, ch: ctx.end.ch + 2 });
    let extra = 0;
    if (look.startsWith('}}')) extra = 2;
    else if (look.startsWith('}')) extra = 1;
    const replaceEnd = extra ? { line: ctx.end.line, ch: ctx.end.ch + extra } : ctx.end;
    const insertText = `{{${file.basename}}}`;
    editor.replaceRange(insertText, ctx.start, replaceEnd);
    editor.setCursor({ line: ctx.start.line, ch: ctx.start.ch + insertText.length });
  }
}

// ── Post-processor helpers ────────────────────────────────────────────────────

export function replaceCitations(root: HTMLElement): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node): number {
      if (node.parentElement?.closest('code, pre')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const re = new RegExp(CITATION_SOURCE, 'g');
  const pending: Array<{ node: Text; frags: Array<string | HTMLElement> }> = [];
  let node: Node | null = walker.nextNode();
  while (node !== null) {
    const text = (node as Text).data;
    if (text.includes('{{')) {
      re.lastIndex = 0;
      let cursor = 0;
      let match: RegExpExecArray | null;
      const frags: Array<string | HTMLElement> = [];
      while ((match = re.exec(text)) !== null) {
        if (match.index > cursor) frags.push(text.slice(cursor, match.index));
        const sup = document.createElement('sup');
        sup.className = 'bibman-cite';
        sup.dataset.bibkey = match[1];
        if (match[2]) sup.dataset.bibpages = match[2];
        sup.textContent = '[ref]';
        frags.push(sup);
        cursor = match.index + match[0].length;
      }
      if (frags.length > 0) {
        if (cursor < text.length) frags.push(text.slice(cursor));
        pending.push({ node: node as Text, frags });
      }
    }
    node = walker.nextNode();
  }
  for (const { node, frags } of pending) {
    const parent = node.parentNode;
    if (!parent) continue;
    for (const frag of frags) {
      parent.insertBefore(
        typeof frag === 'string' ? document.createTextNode(frag) : frag,
        node,
      );
    }
    parent.removeChild(node);
  }
  return pending.length > 0;
}

export function bibPostProcessor(
  plugin: BibPlugin,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): void {
  if (!replaceCitations(el)) return;
  ctx.addChild(new BibRenderChild(el, plugin));
}
