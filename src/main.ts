import { Notice, Plugin } from 'obsidian';
import { VikunjaSyncSettingTab } from './settings-tab';
import { DEFAULT_SETTINGS, type PluginSettings } from './settings';

export default class VikunjaSyncPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: 'vikunja-sync-now',
      name: 'Sync now',
      callback: () => {
        void this.runSyncPlaceholder();
      },
    });

    this.addSettingTab(new VikunjaSyncSettingTab(this.app, this));
  }

  onunload(): void {
    // Scheduler and vault listeners will unregister here in a later phase.
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      mappings: Array.isArray(saved?.mappings)
        ? saved.mappings.map((mapping) => ({
            notePath: typeof mapping?.notePath === 'string' ? mapping.notePath : '',
            projectId:
              typeof mapping?.projectId === 'number' && Number.isFinite(mapping.projectId)
                ? mapping.projectId
                : 0,
          }))
        : [],
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async runSyncPlaceholder(): Promise<void> {
    new Notice(
      'Vikunja Sync: sync engine is not implemented yet. Configure settings and wait for a later release.',
    );
  }
}
