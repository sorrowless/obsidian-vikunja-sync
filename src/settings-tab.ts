import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type VikunjaSyncPlugin from './main';
import {
  createEmptyAssigneeMapping,
  createEmptyMapping,
  isAssigneeMappingBlank,
  isAssigneeMappingComplete,
  isMappingBlank,
  isMappingComplete,
  normalizeSyncIntervalValue,
  suggestObsidianTagFromUsername,
  type ConflictPolicy,
  type SyncIntervalUnit,
} from './settings';
import { NoteSuggestModal } from './vault/note-suggest-modal';
import { resolveMarkdownFile } from './vault/resolve-note';
import { formatUserLabel } from './vikunja/client';
import type { VikunjaUser } from './vikunja/types';

type UsersLoadState = 'idle' | 'loading' | 'loaded' | 'error';

export class VikunjaSyncSettingTab extends PluginSettingTab {
  plugin: VikunjaSyncPlugin;

  private usersState: UsersLoadState = 'idle';
  private discoveredUsers: VikunjaUser[] = [];
  private usersError: string | null = null;

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
    this.renderAssigneeMappingsSection(containerEl);
    this.renderConflictSection(containerEl);
    this.renderTriggersSection(containerEl);
    this.renderMaintenanceSection(containerEl);
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

  private renderAssigneeMappingsSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Assignee ↔ tag mappings' });
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Pick a Vikunja user (loaded from your mapped projects) and an Obsidian tag (e.g. #alice). Only mapped assignees sync on open tasks; when both sides are Done, assignees are left alone. On conflict Obsidian wins.',
    });

    if (!Array.isArray(this.plugin.settings.assigneeMappings)) {
      this.plugin.settings.assigneeMappings = [];
    }

    this.ensureAssigneeUsersLoaded();

    const usersSetting = new Setting(containerEl)
      .setName('Vikunja users')
      .setDesc(this.assigneeUsersStatusText());

    usersSetting.addButton((button) =>
      button
        .setButtonText(this.usersState === 'loading' ? 'Loading…' : 'Refresh users')
        .setDisabled(this.usersState === 'loading')
        .onClick(() => {
          void this.loadAssigneeUsers(true);
        }),
    );

    this.plugin.settings.assigneeMappings.forEach((mapping, index) => {
      const setting = new Setting(containerEl)
        .setName(`Assignee ${index + 1}`)
        .setDesc('Vikunja user and Obsidian tag (with or without #)');

      setting.addDropdown((dropdown) => {
        dropdown.addOption('', 'Select Vikunja user…');
        const knownIds = new Set<number>();
        for (const user of this.discoveredUsers) {
          knownIds.add(user.id);
          dropdown.addOption(String(user.id), formatUserLabel(user));
        }
        // Keep a previously saved user visible even if discovery missed them.
        if (mapping.vikunjaUserId > 0 && !knownIds.has(mapping.vikunjaUserId)) {
          const fallback =
            mapping.label.trim() ||
            `User ${mapping.vikunjaUserId}`;
          dropdown.addOption(String(mapping.vikunjaUserId), `${fallback} (saved)`);
        }
        dropdown.setValue(
          mapping.vikunjaUserId > 0 ? String(mapping.vikunjaUserId) : '',
        );
        dropdown.onChange(async (value) => {
          const current = this.plugin.settings.assigneeMappings[index];
          if (!current) {
            return;
          }
          const parsed = Number.parseInt(value, 10);
          const userId = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
          current.vikunjaUserId = userId;
          const user = this.discoveredUsers.find((item) => item.id === userId);
          if (user) {
            current.label = formatUserLabel(user);
            if (!current.obsidianTag.trim()) {
              current.obsidianTag = suggestObsidianTagFromUsername(user.username);
            }
          } else if (userId === 0) {
            current.label = '';
          }
          await this.plugin.saveSettings();
          this.display();
        });
      });

      setting
        .addText((text) =>
          text
            .setPlaceholder('#alice')
            .setValue(mapping.obsidianTag ? `#${mapping.obsidianTag}` : '')
            .onChange(async (value) => {
              const current = this.plugin.settings.assigneeMappings[index];
              if (!current) {
                return;
              }
              current.obsidianTag = value;
              await this.plugin.saveSettings();
            }),
        )
        .addExtraButton((button) => {
          button
            .setIcon('trash')
            .setTooltip('Remove assignee mapping')
            .onClick(async () => {
              this.plugin.settings.assigneeMappings.splice(index, 1);
              await this.plugin.saveSettings();
              this.display();
            });
        });

      if (!isAssigneeMappingBlank(mapping) && !isAssigneeMappingComplete(mapping)) {
        containerEl.createEl('p', {
          cls: 'setting-item-description',
          text: `Assignee ${index + 1} is incomplete — pick a Vikunja user and an Obsidian tag.`,
        });
      }
    });

    new Setting(containerEl).addButton((button) =>
      button.setButtonText('Add assignee mapping').onClick(async () => {
        this.plugin.settings.assigneeMappings.push(createEmptyAssigneeMapping());
        await this.plugin.saveSettings();
        this.display();
      }),
    );
  }

  private assigneeUsersStatusText(): string {
    if (this.usersState === 'loading') {
      return 'Loading users from Vikunja…';
    }
    if (this.usersState === 'error') {
      return this.usersError
        ? `Could not load users: ${this.usersError}`
        : 'Could not load users from Vikunja.';
    }
    if (this.usersState === 'loaded') {
      const count = this.discoveredUsers.length;
      if (count === 0) {
        return 'No users found. Check the API token and note ↔ project mappings, then refresh.';
      }
      return `${count} user${count === 1 ? '' : 's'} loaded from Vikunja (mapped projects when set, otherwise all projects).`;
    }
    return 'Users load automatically when URL and token are set. Use Refresh to reload.';
  }

  private ensureAssigneeUsersLoaded(): void {
    if (this.usersState !== 'idle') {
      return;
    }
    if (
      !this.plugin.settings.vikunjaBaseUrl.trim() ||
      !this.plugin.settings.vikunjaApiToken.trim()
    ) {
      return;
    }
    void this.loadAssigneeUsers(false);
  }

  private async loadAssigneeUsers(force: boolean): Promise<void> {
    if (this.usersState === 'loading') {
      return;
    }
    if (!force && this.usersState === 'loaded') {
      return;
    }
    if (
      !this.plugin.settings.vikunjaBaseUrl.trim() ||
      !this.plugin.settings.vikunjaApiToken.trim()
    ) {
      this.usersState = 'error';
      this.usersError = 'Set Vikunja base URL and API token first.';
      this.discoveredUsers = [];
      this.display();
      return;
    }

    this.usersState = 'loading';
    this.usersError = null;
    this.display();

    const result = await this.plugin.discoverAssigneeUsers();
    if (result.ok) {
      this.discoveredUsers = result.users;
      this.usersState = 'loaded';
      this.usersError = null;
    } else {
      this.discoveredUsers = [];
      this.usersState = 'error';
      this.usersError = result.message;
    }
    this.display();
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

  private renderMaintenanceSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Maintenance' });

    const entryCount = Object.keys(this.plugin.ledger.entries).length;
    const pendingCount = this.plugin.pendingLinks.length;

    new Setting(containerEl)
      .setName('Clear sync state')
      .setDesc(
        `Forget the sync ledger and pending links (${entryCount} ledger entr${entryCount === 1 ? 'y' : 'ies'}, ${pendingCount} pending). Connection settings and mappings stay. Use this after wiping synced tasks from a note so the next sync imports Vikunja tasks again instead of reporting unresolved removals.`,
      )
      .addButton((button) =>
        button
          .setButtonText('Clear sync state')
          .setWarning()
          .onClick(async () => {
            const confirmed = window.confirm(
              'Clear Vikunja Sync state?\n\n' +
                'This deletes the local sync ledger and pending links. ' +
                'Mapped notes and Vikunja tasks are not deleted. ' +
                'The next sync will treat remote tasks as new imports.',
            );
            if (!confirmed) {
              return;
            }
            const cleared = await this.plugin.clearSyncState();
            new Notice(
              cleared > 0
                ? `Vikunja Sync: cleared sync state (${cleared} record${cleared === 1 ? '' : 's'}).`
                : 'Vikunja Sync: sync state was already empty.',
            );
            this.display();
          }),
      );
  }
}
