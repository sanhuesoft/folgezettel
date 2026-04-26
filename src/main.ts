import { EditorSuggest, Notice, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, FolgezettelSettingTab, PluginSettings } from './settings';
import { I18n } from './i18n';
import { BibEntry } from './types';
import { BIBLIO_FOLDER, BibEditorSuggest, bibPostProcessor, citationEditorPlugin } from './bib/bib';
import { FolgezettelView, VIEW_TYPE } from './ui/FolgezettelView';
import { FolgezettelGraphView, GRAPH_VIEW_TYPE } from './ui/FolgezettelGraphView';

export default class FolgezettelPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  i18n!: I18n;
  private bibSuggest: EditorSuggest<TFile> | null = null;

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<PluginSettings>);
    this.i18n = new I18n(this.settings.lang);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.i18n = new I18n(this.settings.lang);
    try { this.refreshViews(); } catch (_e) { console.error('Error refreshing views after saving settings:', _e); }
  }

  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new FolgezettelView(leaf, this));
    this.registerView(GRAPH_VIEW_TYPE, (leaf) => new FolgezettelGraphView(leaf, this));
    this.addCommand({ id: 'open-fz', name: this.i18n.t('command.open'), callback: () => this.activateView() });
    this.addCommand({ id: 'open-fz-graph', name: this.i18n.t('command.openGraph') || 'Open Graph', callback: () => this.activateGraphView() });
    this.addCommand({
      id: 'reload-fz-view',
      name: this.i18n.t('command.reloadView'),
      callback: () => {
        try { this.refreshViews(); new Notice(this.i18n.t('notice.viewReloaded')); }
        catch (_e) { console.error('Error refreshing views:', _e); }
      },
    });
    this.app.workspace.onLayoutReady(() => this.activateView());
    this.addSettingTab(new FolgezettelSettingTab(this.app, this));
    this.registerEvent(this.app.vault.on('modify', () => this.refreshViews()));
    this.registerEvent(this.app.vault.on('create', () => this.refreshViews()));
    this.registerEvent(this.app.vault.on('delete', () => this.refreshViews()));
    this.registerEvent(this.app.vault.on('rename', () => this.refreshViews()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.refreshViews()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshViews()));
    this.registerMarkdownPostProcessor((el, ctx) => bibPostProcessor(this, el, ctx));
    this.registerEditorExtension(citationEditorPlugin);
    this.bibSuggest = new BibEditorSuggest(this.app, this);
    this.registerEditorSuggest(this.bibSuggest);
  }

  onunload() { this.bibSuggest = null; }

  async activateView() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    await this.app.workspace.getRightLeaf(false)?.setViewState({ type: VIEW_TYPE, active: true });
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length) void this.app.workspace.revealLeaf(leaves[0]);
  }

  async activateGraphView() {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: GRAPH_VIEW_TYPE, active: true });
    const leaves = this.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);
    if (leaves.length) void this.app.workspace.revealLeaf(leaves[0]);
  }

  refreshViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    leaves.forEach((leaf) =>
      void (leaf.view as FolgezettelView).renderList().catch((e) => console.error('Error rendering folgezettel view:', e)),
    );
    const graphLeaves = this.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);
    graphLeaves.forEach((leaf) =>
      void (leaf.view as FolgezettelGraphView).refresh().catch((e) => console.error('Error refreshing graph view:', e)),
    );
  }

  async getBibEntry(key: string): Promise<BibEntry | null> {
    const path = `${BIBLIO_FOLDER}/${key}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || typeof fm !== 'object') return null;
    const fmr = fm as Record<string, unknown>;
    const toStringArray = (v: unknown): string[] | undefined => {
      if (Array.isArray(v)) return v.map(String).filter(Boolean);
      if (typeof v === 'string' && v.trim()) return [v.trim()];
      return undefined;
    };
    const authors = toStringArray(fmr['authors']) ?? toStringArray(fmr['author']);
    return {
      authors,
      author: authors ? authors[0] : undefined,
      title: typeof fmr['title'] === 'string' ? fmr['title'] : undefined,
      year: typeof fmr['year'] === 'string' || typeof fmr['year'] === 'number' ? fmr['year'] : undefined,
    };
  }
}
