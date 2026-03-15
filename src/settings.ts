import { App, PluginSettingTab, Setting } from 'obsidian';

export interface PluginSettings {
  separator: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  separator: '.',
};

export class FolgezettelSettingTab extends PluginSettingTab {
  plugin: any;

  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Folgezettel — Ajustes' });

    new Setting(containerEl)
      .setName('Símbolo separador de niveles')
      .setDesc('Selecciona el símbolo que se usará para separar niveles (deep notes).')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('.', '.')
          .addOption(',', ',')
          .addOption('/', '/')
          .setValue(this.plugin.settings.separator || '.')
          .onChange(async (value) => {
            this.plugin.settings.separator = value;
            await this.plugin.saveSettings();
            // Re-render any open Folgezettel views so the new separator takes effect
            try {
              this.plugin.refreshViews();
            } catch (_e) {
              // ignore if plugin doesn't expose refreshViews
            }
            this.display();
          })
      );
  }
}
