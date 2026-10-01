import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type VikunjaSyncPlugin from './main';
import {
  createEmptyMapping,
  normalizeSyncIntervalValue,
  type ConflictPolicy,
  type SyncIntervalUnit,
} from './settings';

export class VikunjaSyncSettingTab extends PluginSettingTab {
  plugin: VikunjaSyncPlugin;

  constructor(app: App, plugin: VikunjaSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Vikunja Sync' });
    containerEl.createEl('p', {
      text: 'Configure connection, note ↔ project mappings, conflict policy, and sync triggers. Commands: Sync now, Preview sync (dry run). Ribbon button also starts sync.',
    });

    this.renderConnectionSection(containerEl);
    this.renderMappingsSection(containerEl);
    this.renderConflictSection(containerEl);
    this.renderTriggersSection(containerEl);
  }

  private renderConnectionSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Connection' });

    new Setting(containerEl)
      .setName('Vikunja base URL')
      .setDesc('Instance root URL without a trailing /api path. Example: https://vikunja.example')
      .addText((text) =>
        text
          .setPlaceholder('https://vikunja.example')
          .setValue(this.plugin.settings.vikunjaBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.vikunjaBaseUrl = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('API token')
      .setDesc('Bearer token from Vikunja → Settings → API Tokens')
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('Token')
          .setValue(this.plugin.settings.vikunjaApiToken)
          .onChange(async (value) => {
            this.plugin.settings.vikunjaApiToken = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Test connection')
      .setDesc('Calls the Vikunja API to list projects with the saved URL and token')
      .addButton((button) =>
        button.setButtonText('Test connection').onClick(async () => {
          button.setDisabled(true);
          try {
            const result = await this.plugin.testVikunjaConnection();
            if (result.ok) {
              new Notice(
                `Vikunja Sync: connection OK (${result.projectCount} project${result.projectCount === 1 ? '' : 's'}).`,
              );
            } else {
              new Notice(`Vikunja Sync: connection failed — ${result.message}`);
            }
          } finally {
            button.setDisabled(false);
          }
        }),
      );
  }

  private renderMappingsSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Note ↔ project mappings' });
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Each mapping pairs one vault note path with one Vikunja project id.',
    });

    this.plugin.settings.mappings.forEach((mapping, index) => {
      new Setting(containerEl)
        .setName(`Mapping ${index + 1}`)
        .setDesc('Note path relative to the vault root')
        .addText((text) =>
          text
            .setPlaceholder('Tasks/Work.md')
            .setValue(mapping.notePath)
            .onChange(async (value) => {
              mapping.notePath = value.trim();
              await this.plugin.saveSettings();
            }),
        )
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = '1';
          text
            .setPlaceholder('Project id')
            .setValue(mapping.projectId > 0 ? String(mapping.projectId) : '')
            .onChange(async (value) => {
              const parsed = Number.parseInt(value, 10);
              mapping.projectId = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
              await this.plugin.saveSettings();
            });
        })
        .addExtraButton((button) => {
          button
            .setIcon('trash')
            .setTooltip('Remove mapping')
            .onClick(async () => {
              this.plugin.settings.mappings.splice(index, 1);
              await this.plugin.saveSettings();
              this.display();
            });
        });
    });

    new Setting(containerEl).addButton((button) =>
      button.setButtonText('Add mapping').onClick(async () => {
        this.plugin.settings.mappings.push(createEmptyMapping());
        await this.plugin.saveSettings();
        this.display();
      }),
    );
  }

  private renderConflictSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Conflict policy' });

    new Setting(containerEl)
      .setName('When both sides changed')
      .setDesc('Used when a linked task differs from the last sync on both Obsidian and Vikunja')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('prefer-obsidian', 'Prefer Obsidian')
          .addOption('prefer-vikunja', 'Prefer Vikunja')
          .setValue(this.plugin.settings.conflictPolicy)
          .onChange(async (value) => {
            this.plugin.settings.conflictPolicy = value as ConflictPolicy;
            await this.plugin.saveSettings();
          }),
      );
  }

  private renderTriggersSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Sync triggers' });
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'The Sync now command is always available. These options are independent.',
    });

    new Setting(containerEl)
      .setName('Sync on startup')
      .setDesc('Run once after the plugin loads')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncOnStartup).onChange(async (value) => {
          this.plugin.settings.syncOnStartup = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Sync on interval')
      .setDesc('Run periodically while Obsidian is open')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncIntervalEnabled)
          .onChange(async (value) => {
            this.plugin.settings.syncIntervalEnabled = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Interval value')
      .setDesc('Minimum 1. Combined with the unit below')
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text
          .setValue(String(this.plugin.settings.syncIntervalValue))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.syncIntervalValue = normalizeSyncIntervalValue(parsed);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Interval unit')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('minutes', 'Minutes')
          .addOption('hours', 'Hours')
          .setValue(this.plugin.settings.syncIntervalUnit)
          .onChange(async (value) => {
            this.plugin.settings.syncIntervalUnit = value as SyncIntervalUnit;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Sync on file change')
      .setDesc('After editing a mapped note, wait 10 seconds from the last change, then sync')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncOnFileChange)
          .onChange(async (value) => {
            this.plugin.settings.syncOnFileChange = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Dry-run by default')
      .setDesc(
        'When enabled, Sync now / ribbon only preview changes. Use command “Preview sync (dry run)” explicitly anytime; automatic triggers always perform a real sync.',
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.dryRunDefault).onChange(async (value) => {
          this.plugin.settings.dryRunDefault = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
