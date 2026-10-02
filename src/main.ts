import { Notice, Plugin, TFile, requestUrl } from 'obsidian';
import { VikunjaSyncSettingTab } from './settings-tab';
import {
  DEFAULT_SETTINGS,
  normalizeMappingPath,
  prepareMappingsForSave,
  syncIntervalToMilliseconds,
  type PluginSettings,
} from './settings';
import { SyncCoordinator } from './sync/coordinator';
import { syncAllMappings } from './sync/engine';
import { emptyLedger, type LedgerStore, type PendingLink, normalizeLedgerStore } from './sync/ledger';
import { collectSyncErrors, formatSyncNotice } from './sync/report';
import { SyncReportModal } from './sync/report-modal';
import { pathsReferToSameNote, resolveMarkdownFile } from './vault/resolve-note';
import { VikunjaClient } from './vikunja/client';
import { createObsidianRequestTransport } from './vikunja/http';
import { VikunjaApiError } from './vikunja/types';

interface PluginData {
  settings: PluginSettings;
  ledger: LedgerStore;
  pendingLinks: PendingLink[];
}

const FILE_CHANGE_DEBOUNCE_MS = 10_000;

export default class VikunjaSyncPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  ledger: LedgerStore = emptyLedger();
  pendingLinks: PendingLink[] = [];

  private readonly coordinator = new SyncCoordinator();
  private intervalId: number | null = null;
  private readonly fileDebounceTimers = new Map<string, number>();
  /** Paths currently being written by sync — ignore their modify events. */
  private readonly writingPaths = new Set<string>();

  async onload(): Promise<void> {
    await this.loadPluginData();

    this.addCommand({
      id: 'vikunja-sync-now',
      name: 'Sync now',
      callback: () => {
        void this.requestSync('manual', this.settings.dryRunDefault);
      },
    });

    this.addCommand({
      id: 'vikunja-sync-preview',
      name: 'Preview sync (dry run)',
      callback: () => {
        void this.requestSync('preview', true);
      },
    });

    this.addRibbonIcon('sync', 'Vikunja Sync: Sync now', () => {
      void this.requestSync('ribbon', this.settings.dryRunDefault);
    });

    this.addSettingTab(new VikunjaSyncSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!(file instanceof TFile) || file.extension !== 'md') {
          return;
        }
        this.onMappedFileModified(file.path);
      }),
    );

    this.restartScheduler();

    if (this.settings.syncOnStartup) {
      window.setTimeout(() => {
        void this.requestSync('startup', false);
      }, 1_000);
    }
  }

  onunload(): void {
    this.clearIntervalTimer();
    for (const timer of this.fileDebounceTimers.values()) {
      window.clearTimeout(timer);
    }
    this.fileDebounceTimers.clear();
  }

  async loadPluginData(): Promise<void> {
    const raw = (await this.loadData()) as
      | (Partial<PluginData> & Partial<PluginSettings>)
      | null;

    if (raw && typeof raw === 'object' && 'settings' in raw && raw.settings) {
      this.settings = normalizeSettings(raw.settings);
      this.ledger = normalizeLedger(raw.ledger);
      this.pendingLinks = normalizePendingLinks(raw.pendingLinks);
      return;
    }

    this.settings = normalizeSettings(raw ?? {});
    this.ledger = emptyLedger();
    this.pendingLinks = [];
  }

  async saveSettings(): Promise<void> {
    // Normalize in place — never replace mapping objects or the mappings array.
    // The settings tab keeps indexes/closures over those references; replacing
    // them drops subsequent edits (project id / path with spaces looked “unsaved”).
    prepareMappingsForSave(this.settings.mappings);
    await this.savePluginData();
    this.restartScheduler();
  }

  async savePluginData(): Promise<void> {
    const data: PluginData = {
      settings: this.settings,
      ledger: this.ledger,
      pendingLinks: this.pendingLinks,
    };
    await this.saveData(data);
  }

  /**
   * Forget sync history (ledger + pending links). Connection settings and
   * mappings are kept. After this, the next sync treats Vikunja tasks as new
   * again instead of “unresolved removals”.
   */
  async clearSyncState(): Promise<number> {
    const cleared = Object.keys(this.ledger.entries).length + this.pendingLinks.length;
    this.ledger = emptyLedger();
    this.pendingLinks = [];
    await this.savePluginData();
    return cleared;
  }

  restartScheduler(): void {
    this.clearIntervalTimer();
    if (!this.settings.syncIntervalEnabled) {
      return;
    }
    const ms = syncIntervalToMilliseconds(
      this.settings.syncIntervalValue,
      this.settings.syncIntervalUnit,
    );
    this.intervalId = window.setInterval(() => {
      void this.requestSync('interval', false);
    }, ms);
  }

  createVikunjaClient(): VikunjaClient {
    return new VikunjaClient({
      baseUrl: this.settings.vikunjaBaseUrl,
      token: this.settings.vikunjaApiToken,
      // Obsidian's requestUrl bypasses CORS; plain fetch fails against most self-hosted Vikunja hosts.
      transport: createObsidianRequestTransport(requestUrl),
    });
  }

  async testVikunjaConnection(): Promise<
    { ok: true; projectCount: number } | { ok: false; message: string }
  > {
    try {
      const client = this.createVikunjaClient();
      const result = await client.testConnection();
      return { ok: true, projectCount: result.projectCount };
    } catch (error) {
      return { ok: false, message: formatConnectionError(error) };
    }
  }

  async requestSync(reason: string, dryRun: boolean): Promise<void> {
    await this.coordinator.request(reason, dryRun, async (activeReason, activeDryRun) => {
      await this.runSync(activeReason, activeDryRun);
    });
  }

  private async runSync(reason: string, dryRun: boolean): Promise<void> {
    if (!this.settings.vikunjaBaseUrl.trim() || !this.settings.vikunjaApiToken.trim()) {
      new Notice('Vikunja Sync: set the base URL and API token before syncing.');
      return;
    }
    if (this.settings.mappings.length === 0) {
      new Notice('Vikunja Sync: add at least one note ↔ project mapping.');
      return;
    }

    let client: VikunjaClient;
    try {
      client = this.createVikunjaClient();
    } catch (error) {
      new Notice(`Vikunja Sync: ${formatConnectionError(error)}`);
      return;
    }

    new Notice(
      dryRun
        ? `Vikunja Sync: dry-run starting (${reason})…`
        : `Vikunja Sync: starting (${reason})…`,
    );

    try {
      const result = await syncAllMappings(
        this.settings.mappings,
        this.ledger,
        this.pendingLinks,
        {
          baseUrl: this.settings.vikunjaBaseUrl,
          conflictPolicy: this.settings.conflictPolicy,
          client,
          dryRun,
          readNote: async (path) => {
            const file = resolveMarkdownFile(this.app, path);
            return this.app.vault.read(file);
          },
          writeNote: async (path, content) => {
            const file = resolveMarkdownFile(this.app, path);
            this.writingPaths.add(file.path);
            try {
              await this.app.vault.modify(file, content);
            } finally {
              // Keep ignoring briefly so Obsidian's modify event is skipped.
              window.setTimeout(() => {
                this.writingPaths.delete(file.path);
              }, 500);
            }
          },
        },
      );

      if (!dryRun) {
        await this.savePluginData();
      }

      const errors = collectSyncErrors(result);
      const noticeText = formatSyncNotice(result);
      new Notice(noticeText, errors.length > 0 ? 15_000 : 8_000);

      for (const line of errors) {
        console.error(`Vikunja Sync: ${line}`);
      }

      // Dry-run always opens the report; real sync opens it when something failed.
      if (dryRun || errors.length > 0) {
        new SyncReportModal(this.app, result).open();
      }
    } catch (error) {
      new Notice(`Vikunja Sync failed: ${formatConnectionError(error)}`, 15_000);
      console.error('Vikunja Sync failed', error);
    }
  }

  private onMappedFileModified(path: string): void {
    if (!this.settings.syncOnFileChange) {
      return;
    }
    if (this.writingPaths.has(path) || this.coordinator.isRunning) {
      return;
    }
    const mapped = this.settings.mappings.some((mapping) =>
      pathsReferToSameNote(mapping.notePath, path),
    );
    if (!mapped) {
      return;
    }

    const existing = this.fileDebounceTimers.get(path);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }

    const timer = window.setTimeout(() => {
      this.fileDebounceTimers.delete(path);
      void this.requestSync('file-change', false);
    }, FILE_CHANGE_DEBOUNCE_MS);
    this.fileDebounceTimers.set(path, timer);
  }

  private clearIntervalTimer(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

function normalizeSettings(saved: Partial<PluginSettings>): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    mappings: Array.isArray(saved.mappings)
      ? saved.mappings.map((mapping) => ({
          notePath: normalizeMappingPath(
            typeof mapping?.notePath === 'string' ? mapping.notePath : '',
          ),
          projectId:
            typeof mapping?.projectId === 'number' && Number.isFinite(mapping.projectId)
              ? mapping.projectId
              : 0,
        }))
      : [],
    dryRunDefault: Boolean(saved.dryRunDefault),
  };
}

function normalizeLedger(raw: LedgerStore | undefined): LedgerStore {
  return normalizeLedgerStore(raw);
}

function normalizePendingLinks(raw: PendingLink[] | undefined): PendingLink[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      mappingKey: String(item.mappingKey ?? ''),
      taskId: Number(item.taskId),
      title: String(item.title ?? ''),
      description: String(item.description ?? ''),
      done: Boolean(item.done),
      parentTaskId:
        item.parentTaskId === null || item.parentTaskId === undefined
          ? null
          : Number(item.parentTaskId),
      vikunjaUpdated: String(item.vikunjaUpdated ?? ''),
    }))
    .filter((item) => item.mappingKey && Number.isFinite(item.taskId));
}

function formatConnectionError(error: unknown): string {
  if (error instanceof VikunjaApiError) {
    return `${error.message} (HTTP ${error.status})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
