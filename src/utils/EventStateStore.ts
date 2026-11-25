import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../core/Logger';

const logger = createLogger('EventStateStore');

/** High-water mark of an event collector: newest emitted event time (epoch ms) and the ids emitted at that time. */
export interface EventMark {
  time: number;
  ids: string[];
}

/**
 * Event collector marks, one JSON file per key under `<folder>/event-state/` (spec §Data conventions).
 * A null folder keeps marks in memory only (dry-run, tests).
 */
export class EventStateStore {
  private readonly marks = new Map<string, EventMark | undefined>();

  constructor(readonly folder: string | null) {}

  async get(key: string): Promise<EventMark | undefined> {
    if (!this.marks.has(key)) {
      this.marks.set(key, await this.read(key));
    }
    return this.marks.get(key);
  }

  async set(key: string, mark: EventMark): Promise<void> {
    this.marks.set(key, mark);
    if (this.folder === null) {
      return;
    }
    const file = this.fileOf(key);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify({ time: new Date(mark.time).toISOString(), ids: mark.ids }));
    await fs.rename(tmp, file);
  }

  private async read(key: string): Promise<EventMark | undefined> {
    if (this.folder === null) {
      return undefined;
    }
    const file = this.fileOf(key);
    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`Cannot read event state ${file}, starting from now: ${(error as Error).message}`);
      }
      return undefined;
    }
    const mark = parseMark(content);
    if (!mark) {
      logger.warn(`Ignoring invalid event state ${file}, starting from now`);
    }
    return mark;
  }

  private fileOf(key: string): string {
    return path.join(this.folder ?? '', 'event-state', `${key.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }
}

function parseMark(content: string): EventMark | undefined {
  try {
    const raw: unknown = JSON.parse(content);
    if (typeof raw !== 'object' || raw === null) {
      return undefined;
    }
    const { time, ids } = raw as { time?: unknown; ids?: unknown };
    const ms = typeof time === 'string' ? Date.parse(time) : Number.NaN;
    if (!Number.isFinite(ms) || !Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
      return undefined;
    }
    return { time: ms, ids };
  } catch {
    return undefined;
  }
}

let shared = new EventStateStore(null);

export function getEventStateStore(): EventStateStore {
  return shared;
}

/** Called once by main(): DATA_FOLDER normally, null in dry-run so a preview never advances the marks. */
export function useEventStateFolder(folder: string | null): void {
  shared = new EventStateStore(folder);
}
