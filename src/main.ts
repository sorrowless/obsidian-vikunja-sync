import { Notice, Plugin, TFile } from 'obsidian';
import { VikunjaSyncSettingTab } from './settings-tab';
import { DEFAULT_SETTINGS, syncIntervalToMilliseconds, type PluginSettings } from './settings';
import { emptyLedger, type LedgerStore } from './sync/ledger';
import { syncAllMappings } from './sync/engine';
import { VikunjaClient } from './vikunja/client';
import { VikunjaApiError } from './vikunja/types';

interface PluginData {
  settings: PluginSettings;
  ledger: LedgerStore;
}

const FILE_CHANGE_DEBOUNCE_MS = 10_000;

export default class VikunjaSyncPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  ledger: LedgerStore = emptyLedger();

  private syncRunning = false;
  private syncQueued = false;
  private intervalId: number | null = null;
  private readonly fileDebounceTimers = new Map<string, number>();

  async onload(): Promise<void> {
    await this.loadPluginData();

    this.addCommand({
      id: 'vikunja-sync-now',
      name: 'Sync now',
      callback: () => {
        void this.requestSync('manual');
      },
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
      // Defer so the workspace finishes loading.
      window.setTimeout(() => {
        void this.requestSync('startup');
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
    const raw = (await this.loadData()) as Partial<PluginData> & Partial<PluginSettings> | null;
    if (raw && typeof raw === 'object' && 'settings' in raw && raw.settings) {
      this.settings = normalizeSettings(raw.settings);
      this.ledger = normalizeLedger(raw.ledger);
      return;
    }

    // Backward compatible: Phase 1 stored settings at the root.
    this.settings = normalizeSettings(raw ?? {});
    this.ledger = emptyLedger();
  }

  async saveSettings(): Promise<void> {
    await this.savePluginData();
    this.restartScheduler();
  }

  async savePluginData(): Promise<void> {
    const data: PluginData = {
      settings: this.settings,
      ledger: this.ledger,
    };
    await this.saveData(data);
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
      void this.requestSync('interval');
    }, ms);
  }

  createVikunjaClient(): VikunjaClient {
    return new VikunjaClient({
      baseUrl: this.settings.vikunjaBaseUrl,
      token: this.settings.vikunjaApiToken,
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

  async requestSync(reason: string): Promise<void> {
    if (this.syncRunning) {
      this.syncQueued = true;
      return;
    }

    this.syncRunning = true;
    try {
      do {
        this.syncQueued = false;
        await this.runSync(reason);
      } while (this.syncQueued);
    } finally {
      this.syncRunning = false;
    }
  }

  private async runSync(reason: string): Promise<void> {
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

    new Notice(`Vikunja Sync: starting (${reason})…`);

    const result = await syncAllMappings(this.settings.mappings, this.ledger, {
      baseUrl: this.settings.vikunjaBaseUrl,
      conflictPolicy: this.settings.conflictPolicy,
      client,
      readNote: async (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          throw new Error(`Note not found: ${path}`);
        }
        return this.app.vault.read(file);
      },
      writeNote: async (path, content) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          throw new Error(`Note not found: ${path}`);
        }
        await this.app.vault.modify(file, content);
      },
    });

    await this.savePluginData();
    new Notice(result.message);
    for (const mapping of result.mappings) {
      for (const error of mapping.errors) {
        console.error(`Vikunja Sync [${mapping.notePath}]: ${error}`);
      }
    }
  }

  private onMappedFileModified(path: string): void {
    if (!this.settings.syncOnFileChange) {
      return;
    }
    const mapped = this.settings.mappings.some((mapping) => mapping.notePath === path);
    if (!mapped) {
      return;
    }

    const existing = this.fileDebounceTimers.get(path);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }

    const timer = window.setTimeout(() => {
      this.fileDebounceTimers.delete(path);
      void this.requestSync('file-change');
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
          notePath: typeof mapping?.notePath === 'string' ? mapping.notePath : '',
          projectId:
            typeof mapping?.projectId === 'number' && Number.isFinite(mapping.projectId)
              ? mapping.projectId
              : 0,
        }))
      : [],
  };
}

function normalizeLedger(raw: LedgerStore | undefined): LedgerStore {
  if (!raw || typeof raw !== 'object' || !raw.entries || typeof raw.entries !== 'object') {
    return emptyLedger();
  }
  return { entries: { ...raw.entries } };
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
