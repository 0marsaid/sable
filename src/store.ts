import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ToolCall } from './llm/types.js';
import { normalizePhone } from './phone.js';

export type StoredMessage = {
  id: number;
  phone: string;
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCalls: ToolCall[] | null;
  toolCallId: string | null;
  name: string | null;
  createdAt: string;
};

export type Fact = { id: number; phone: string; body: string; createdAt: string };
export type Note = {
  id: number;
  phone: string;
  body: string;
  isTodo: boolean;
  done: boolean;
  createdAt: string;
  completedAt: string | null;
};
export type Reminder = {
  id: number;
  phone: string;
  message: string;
  dueAt: string;
  status: 'pending' | 'sending' | 'sent' | 'cancelled' | 'failed';
  attempts: number;
  createdAt: string;
  sentAt: string | null;
  lastError: string | null;
};
export type PendingApproval = {
  phone: string;
  calls: ToolCall[];
  summaries: string[];
  createdAt: string;
};
export type TranscriptItem = {
  role: 'user' | 'assistant';
  body: string;
  at: string;
};

type Row = Record<string, unknown>;

function num(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value);
}

export class Store {
  private constructor(private readonly db: DatabaseSync) {}

  static open(file: string): Store {
    if (file !== ':memory:') {
      const directory = path.dirname(path.resolve(file));
      mkdirSync(directory, { recursive: true });
    }
    const db = new DatabaseSync(file);
    if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    const store = new Store(db);
    store.migrate();
    return store;
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // The statement that failed may already have rolled the transaction back.
      }
      throw error;
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        tool_calls TEXT,
        tool_call_id TEXT,
        name TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone, id);

      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_phone_body ON facts(phone, body);

      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        body TEXT NOT NULL,
        is_todo INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        message TEXT NOT NULL,
        due_at TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        sending_at TEXT,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, due_at);

      CREATE TABLE IF NOT EXISTS pending_approvals (
        phone TEXT PRIMARY KEY,
        calls_json TEXT NOT NULL,
        summaries_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_messages (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  /** Returns true only the first time this provider message id is seen. */
  tryProcess(id: string, now = new Date()): boolean {
    const result = this.db
      .prepare('INSERT INTO processed_messages (id, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING')
      .run(id, now.toISOString());
    return result.changes === 1;
  }

  pruneProcessed(olderThanIso: string): void {
    this.db.prepare('DELETE FROM processed_messages WHERE created_at < ?').run(olderThanIso);
  }

  addMessage(input: {
    phone: string;
    role: StoredMessage['role'];
    content: string | null;
    toolCalls?: ToolCall[] | null;
    toolCallId?: string | null;
    name?: string | null;
    createdAt?: Date;
  }): number {
    const phone = normalizePhone(input.phone);
    const result = this.db
      .prepare(
        `INSERT INTO messages (phone, role, content, tool_calls, tool_call_id, name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        phone,
        input.role,
        input.content,
        input.toolCalls?.length ? JSON.stringify(input.toolCalls) : null,
        input.toolCallId ?? null,
        input.name ?? null,
        (input.createdAt ?? new Date()).toISOString(),
      );
    return num(result.lastInsertRowid);
  }

  recentMessages(phone: string, limit: number): StoredMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE phone = ? ORDER BY id DESC LIMIT ?')
      .all(normalizePhone(phone), limit) as Row[];
    return rows.reverse().map(mapMessage);
  }

  /**
   * If a crash left an assistant tool call without a result, close it so the
   * next model request is valid. Calls that are waiting on approval are left open.
   */
  repairDanglingToolCalls(phone: string): void {
    const normalized = normalizePhone(phone);
    const pending = this.getPending(normalized);
    const pendingIds = new Set(pending?.calls.map((call) => call.id) ?? []);
    const rows = this.recentMessages(normalized, 80);
    const answered = new Set(
      rows.filter((row) => row.role === 'tool' && row.toolCallId).map((row) => row.toolCallId as string),
    );
    for (const row of rows) {
      if (row.role !== 'assistant' || !row.toolCalls?.length) continue;
      for (const call of row.toolCalls) {
        if (answered.has(call.id) || pendingIds.has(call.id)) continue;
        this.addMessage({
          phone: normalized,
          role: 'tool',
          content: 'Not completed.',
          toolCallId: call.id,
          name: call.name,
        });
        answered.add(call.id);
      }
    }
  }

  addFact(phone: string, body: string): { id: number; created: boolean } {
    const normalized = normalizePhone(phone);
    const text = body.trim();
    const existing = this.db
      .prepare('SELECT id FROM facts WHERE phone = ? AND body = ?')
      .get(normalized, text) as Row | undefined;
    if (existing) return { id: num(existing.id), created: false };
    const result = this.db
      .prepare('INSERT INTO facts (phone, body, created_at) VALUES (?, ?, ?)')
      .run(normalized, text, new Date().toISOString());
    return { id: num(result.lastInsertRowid), created: true };
  }

  listFacts(phone: string, limit = 50): Fact[] {
    const rows = this.db
      .prepare('SELECT * FROM facts WHERE phone = ? ORDER BY id DESC LIMIT ?')
      .all(normalizePhone(phone), limit) as Row[];
    return rows.reverse().map(mapFact);
  }

  getFact(phone: string, id: number): Fact | undefined {
    const row = this.db
      .prepare('SELECT * FROM facts WHERE phone = ? AND id = ?')
      .get(normalizePhone(phone), id) as Row | undefined;
    return row ? mapFact(row) : undefined;
  }

  deleteFact(phone: string, id: number): boolean {
    const result = this.db.prepare('DELETE FROM facts WHERE phone = ? AND id = ?').run(normalizePhone(phone), id);
    return result.changes === 1;
  }

  addNote(phone: string, body: string, isTodo: boolean): number {
    const result = this.db
      .prepare('INSERT INTO notes (phone, body, is_todo, done, created_at) VALUES (?, ?, ?, 0, ?)')
      .run(normalizePhone(phone), body.trim(), isTodo ? 1 : 0, new Date().toISOString());
    return num(result.lastInsertRowid);
  }

  listNotes(phone: string, status: 'open' | 'done' | 'all' = 'open'): Note[] {
    const clauses = ['phone = ?'];
    const params: Array<string | number> = [normalizePhone(phone)];
    if (status === 'open') clauses.push('done = 0');
    if (status === 'done') clauses.push('done = 1');
    const rows = this.db
      .prepare(`SELECT * FROM notes WHERE ${clauses.join(' AND ')} ORDER BY id ASC`)
      .all(...params) as Row[];
    return rows.map(mapNote);
  }

  getNote(phone: string, id: number): Note | undefined {
    const row = this.db
      .prepare('SELECT * FROM notes WHERE phone = ? AND id = ?')
      .get(normalizePhone(phone), id) as Row | undefined;
    return row ? mapNote(row) : undefined;
  }

  completeNote(phone: string, id: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE notes SET done = 1, completed_at = ? WHERE phone = ? AND id = ? AND done = 0`,
      )
      .run(new Date().toISOString(), normalizePhone(phone), id);
    return result.changes === 1;
  }

  deleteNote(phone: string, id: number): boolean {
    const result = this.db.prepare('DELETE FROM notes WHERE phone = ? AND id = ?').run(normalizePhone(phone), id);
    return result.changes === 1;
  }

  addReminder(phone: string, message: string, dueAt: Date): number {
    const result = this.db
      .prepare(
        `INSERT INTO reminders (phone, message, due_at, status, attempts, created_at)
         VALUES (?, ?, ?, 'pending', 0, ?)`,
      )
      .run(normalizePhone(phone), message.trim(), dueAt.toISOString(), new Date().toISOString());
    return num(result.lastInsertRowid);
  }

  listReminders(phone: string, includeClosed = false): Reminder[] {
    const sql = includeClosed
      ? 'SELECT * FROM reminders WHERE phone = ? ORDER BY due_at ASC'
      : `SELECT * FROM reminders WHERE phone = ? AND status IN ('pending', 'sending') ORDER BY due_at ASC`;
    const rows = this.db.prepare(sql).all(normalizePhone(phone)) as Row[];
    return rows.map(mapReminder);
  }

  getReminder(phone: string, id: number): Reminder | undefined {
    const row = this.db
      .prepare('SELECT * FROM reminders WHERE phone = ? AND id = ?')
      .get(normalizePhone(phone), id) as Row | undefined;
    return row ? mapReminder(row) : undefined;
  }

  cancelReminder(phone: string, id: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE reminders SET status = 'cancelled' WHERE phone = ? AND id = ? AND status IN ('pending', 'sending')`,
      )
      .run(normalizePhone(phone), id);
    return result.changes === 1;
  }

  dueReminders(nowIso: string): Reminder[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ? ORDER BY due_at ASC LIMIT 20`,
      )
      .all(nowIso) as Row[];
    return rows.map(mapReminder);
  }

  claimReminder(id: number, nowIso: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE reminders
         SET status = 'sending', attempts = attempts + 1, sending_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(nowIso, id);
    return result.changes === 1;
  }

  markReminderSent(id: number, nowIso: string): void {
    this.db
      .prepare(`UPDATE reminders SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?`)
      .run(nowIso, id);
  }

  markReminderRetry(id: number, error: string): 'pending' | 'failed' {
    const row = this.db.prepare('SELECT attempts FROM reminders WHERE id = ?').get(id) as Row | undefined;
    const attempts = row ? num(row.attempts) : 1;
    const status = attempts >= 3 ? 'failed' : 'pending';
    this.db
      .prepare(`UPDATE reminders SET status = ?, last_error = ? WHERE id = ? AND status = 'sending'`)
      .run(status, error.slice(0, 300), id);
    return status;
  }

  failReminder(id: number, error: string): void {
    this.db
      .prepare(`UPDATE reminders SET status = 'failed', last_error = ? WHERE id = ?`)
      .run(error.slice(0, 300), id);
  }

  recoverStuckReminders(olderThanIso: string): number {
    const result = this.db
      .prepare(
        `UPDATE reminders SET status = 'pending'
         WHERE status = 'sending' AND (sending_at IS NULL OR sending_at < ?)`,
      )
      .run(olderThanIso);
    return num(result.changes);
  }

  setPending(phone: string, calls: ToolCall[], summaries: string[], now: Date): void {
    const normalized = normalizePhone(phone);
    this.db
      .prepare(
        `INSERT INTO pending_approvals (phone, calls_json, summaries_json, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(phone) DO UPDATE SET
           calls_json = excluded.calls_json,
           summaries_json = excluded.summaries_json,
           created_at = excluded.created_at`,
      )
      .run(normalized, JSON.stringify(calls), JSON.stringify(summaries), now.toISOString());
  }

  getPending(phone: string): PendingApproval | undefined {
    const row = this.db
      .prepare('SELECT * FROM pending_approvals WHERE phone = ?')
      .get(normalizePhone(phone)) as Row | undefined;
    if (!row) return undefined;
    return {
      phone: String(row.phone),
      calls: JSON.parse(String(row.calls_json)) as ToolCall[],
      summaries: JSON.parse(String(row.summaries_json)) as string[],
      createdAt: String(row.created_at),
    };
  }

  clearPending(phone: string): void {
    this.db.prepare('DELETE FROM pending_approvals WHERE phone = ?').run(normalizePhone(phone));
  }

  logDelivery(phone: string, body: string, now = new Date()): void {
    this.db
      .prepare('INSERT INTO deliveries (phone, body, created_at) VALUES (?, ?, ?)')
      .run(normalizePhone(phone), body, now.toISOString());
  }

  transcript(phone: string, limit = 40): TranscriptItem[] {
    const normalized = normalizePhone(phone);
    const rows = this.db
      .prepare(
        `SELECT role, body, at FROM (
           SELECT 'user' AS role, content AS body, created_at AS at, id AS seq
           FROM messages WHERE phone = ? AND role = 'user'
           UNION ALL
           SELECT 'assistant', body, created_at, id
           FROM deliveries WHERE phone = ?
         )
         ORDER BY at ASC, role DESC, seq ASC`,
      )
      .all(normalized, normalized) as Row[];
    return rows.slice(-limit).map((row) => ({
      role: row.role === 'user' ? 'user' : 'assistant',
      body: String(row.body ?? ''),
      at: String(row.at),
    }));
  }
}

function mapMessage(row: Row): StoredMessage {
  return {
    id: num(row.id),
    phone: String(row.phone),
    role: String(row.role) as StoredMessage['role'],
    content: row.content == null ? null : String(row.content),
    toolCalls: row.tool_calls ? (JSON.parse(String(row.tool_calls)) as ToolCall[]) : null,
    toolCallId: row.tool_call_id == null ? null : String(row.tool_call_id),
    name: row.name == null ? null : String(row.name),
    createdAt: String(row.created_at),
  };
}

function mapFact(row: Row): Fact {
  return {
    id: num(row.id),
    phone: String(row.phone),
    body: String(row.body),
    createdAt: String(row.created_at),
  };
}

function mapNote(row: Row): Note {
  return {
    id: num(row.id),
    phone: String(row.phone),
    body: String(row.body),
    isTodo: num(row.is_todo) === 1,
    done: num(row.done) === 1,
    createdAt: String(row.created_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
  };
}

function mapReminder(row: Row): Reminder {
  return {
    id: num(row.id),
    phone: String(row.phone),
    message: String(row.message),
    dueAt: String(row.due_at),
    status: String(row.status) as Reminder['status'],
    attempts: num(row.attempts),
    createdAt: String(row.created_at),
    sentAt: row.sent_at == null ? null : String(row.sent_at),
    lastError: row.last_error == null ? null : String(row.last_error),
  };
}
