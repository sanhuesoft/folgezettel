import { App, PluginSettingTab, Setting, Plugin } from 'obsidian';
import { I18n } from './i18n';

export interface PluginSettings {
  lang?: string; // 'auto' | 'en' | 'es'
}

export const DEFAULT_SETTINGS: PluginSettings = {
  lang: 'auto',
};

export class FolgezettelSettingTab extends PluginSettingTab {
  plugin: FolgezettelPluginLike;

  constructor(app: App, plugin: FolgezettelPluginLike) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const i18n: I18n = this.plugin.i18n || new I18n(this.plugin.settings?.lang);

    new Setting(containerEl).setName(i18n.t('settings.title')).setHeading();

    // NOTE: separator setting is deprecated — plugin now uses '/' only.

    new Setting(containerEl)
      .setName(i18n.t('settings.lang.name'))
      .setDesc(i18n.t('settings.lang.desc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('auto', i18n.t('settings.lang.auto'))
          .addOption('en', i18n.t('settings.lang.en'))
          .addOption('es', i18n.t('settings.lang.es'))
          .setValue(this.plugin.settings.lang || 'auto')
          .onChange(async (value) => {
            this.plugin.settings.lang = value;
            await this.plugin.saveSettings();
            try {
              this.plugin.refreshViews();
            } catch (_e) {
              console.error('Error refreshing views after changing language:', _e);
            }
            this.display();
          })
      );
  }
}

// Minimal plugin-like interface used by the settings tab to avoid importing the
// concrete plugin class and creating a circular dependency.
interface FolgezettelPluginLike extends Plugin {
  settings: PluginSettings;
  i18n: I18n;
  saveSettings: () => Promise<void>;
  refreshViews?: () => void;
}
