import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type VikunjaSyncPlugin from './main';
import {
  createEmptyMapping,
  isMappingBlank,
  isMappingComplete,
  normalizeSyncIntervalValue,
  type ConflictPolicy,
  type SyncIntervalUnit,
} from './settings';
import { NoteSuggestModal } from './vault/note-suggest-modal';
import { resolveMarkdownFile } from './vault/resolve-note';

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
      text: 'Each mapping pairs one vault note path with one Vikunja project id. Paths are relative to the vault root; spaces in file names are fine (example: Folder/My tasks.md).',
    });

    this.plugin.settings.mappings.forEach((mapping, index) => {
      new Setting(containerEl)
        .setName(`Mapping ${index + 1}`)
        .setDesc('Note path relative to the vault root — prefer Browse to copy Obsidian’s exact path')
        .addText((text) =>
          text
            .setPlaceholder('Folder/My tasks.md')
            .setValue(mapping.notePath)
            .onChange(async (value) => {
              const current = this.plugin.settings.mappings[index];
              if (!current) {
                return;
              }
              // Keep spaces inside the name; ends are trimmed on save.
              current.notePath = value;
              await this.plugin.saveSettings();
            }),
        )
        .addButton((button) =>
          button.setButtonText('Browse').onClick(() => {
            new NoteSuggestModal(this.app, (file) => {
              const current = this.plugin.settings.mappings[index];
              if (!current) {
                return;
              }
              // Store the exact vault path Obsidian uses (correct Unicode form).
              current.notePath = file.path;
              void this.plugin.saveSettings().then(() => this.display());
            }).open();
          }),
        )
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = '1';
          text
            .setPlaceholder('Project id')
            .setValue(mapping.projectId > 0 ? String(mapping.projectId) : '')
            .onChange(async (value) => {
              const current = this.plugin.settings.mappings[index];
              if (!current) {
                return;
              }
              const parsed = Number.parseInt(value, 10);
              current.projectId = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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

      if (!isMappingBlank(mapping) && !isMappingComplete(mapping)) {
        containerEl.createEl('p', {
          cls: 'setting-item-description',
          text: `Mapping ${index + 1} is incomplete — both note path and project id are required before sync.`,
        });
      } else if (isMappingComplete(mapping)) {
        try {
          const file = resolveMarkdownFile(this.app, mapping.notePath);
          if (file.path !== mapping.notePath) {
            containerEl.createEl('p', {
              cls: 'setting-item-description',
              text: `Resolved to vault path “${file.path}”. Click Browse once to store that exact path.`,
            });
          }
        } catch {
          containerEl.createEl('p', {
            cls: 'setting-item-description',
            text: `Mapping ${index + 1}: note not found in the vault. Use Browse to select it.`,
          });
        }
      }
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
