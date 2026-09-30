// Journal of every question asked, for the /admin pages. One row per question.
// No IP address, no tool results (only the calls), deleted after RETENTION_DAYS.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const PATH = process.env.FRANCE_RE_DB ?? "data/france-re.sqlite";
export const RETENTION_DAYS = Number(process.env.FRANCE_RE_RETENTION_DAYS ?? 90);

export interface ToolCall {
  name: string;
  input: unknown;
  ms: number;
  error?: boolean;
}

export interface TurnRecord {
  sessionId: string;
  turnIndex: number;
  question: string;
  answer: string;
  tools: ToolCall[];
  model: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  error: string | null;
}

mkdirSync(dirname(PATH), { recursive: true });
const db = new DatabaseSync(PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS turns (
    id            INTEGER PRIMARY KEY,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    session_id    TEXT    NOT NULL,
    turn_index    INTEGER NOT NULL,
    question      TEXT    NOT NULL,
    answer        TEXT    NOT NULL,
    tools         TEXT    NOT NULL,          -- JSON array of ToolCall
    model         TEXT    NOT NULL,
    duration_ms   INTEGER NOT NULL,
    input_tokens  INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_usd      REAL,
    error         TEXT,
    feedback      INTEGER                    -- 1 👍, -1 👎, NULL none
  );
  CREATE INDEX IF NOT EXISTS turns_session ON turns (session_id, turn_index);
  CREATE INDEX IF NOT EXISTS turns_created ON turns (created_at);

  -- Accent-insensitive full-text search over questions and answers.
  CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5 (
    question, answer, content = 'turns', content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER IF NOT EXISTS turns_ai AFTER INSERT ON turns BEGIN
    INSERT INTO turns_fts (rowid, question, answer) VALUES (new.id, new.question, new.answer);
  END;
  CREATE TRIGGER IF NOT EXISTS turns_ad AFTER DELETE ON turns BEGIN
    INSERT INTO turns_fts (turns_fts, rowid, question, answer) VALUES ('delete', old.id, old.question, old.answer);
  END;
`);

const insert = db.prepare(`
  INSERT INTO turns (session_id, turn_index, question, answer, tools, model, duration_ms, input_tokens, output_tokens, cost_usd, error)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function logTurn(t: TurnRecord): number {
  const { lastInsertRowid } = insert.run(
    t.sessionId, t.turnIndex, t.question, t.answer, JSON.stringify(t.tools), t.model,
    t.durationMs, t.inputTokens, t.outputTokens, t.costUsd, t.error,
  );
  return Number(lastInsertRowid);
}

const feedbackStmt = db.prepare("UPDATE turns SET feedback = ? WHERE id = ? AND session_id = ?");

/** Only the conversation that produced a turn can rate it. */
export function setFeedback(id: number, sessionId: string, value: 1 | -1 | null): boolean {
  return Number(feedbackStmt.run(value, id, sessionId).changes) > 0;
}

// ——— admin queries ———

const COLUMNS = "t.id, t.created_at, t.session_id, t.turn_index, t.question, t.answer, t.tools, t.model, t.duration_ms, t.input_tokens, t.output_tokens, t.cost_usd, t.error, t.feedback";

/** Turn free text into an FTS5 query: every word must match, as a prefix. */
function ftsQuery(q: string): string {
  return q
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => `"${w}"*`)
    .join(" ");
}

export interface TurnFilter {
  q?: string;
  feedback?: "up" | "down";
  errors?: boolean;
  limit?: number;
  offset?: number;
}

export function listTurns({ q, feedback, errors, limit = 50, offset = 0 }: TurnFilter) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  let from = "turns t";
  let snippet = "NULL";
  const fts = q ? ftsQuery(q) : "";
  if (fts) {
    from = "turns_fts JOIN turns t ON t.id = turns_fts.rowid";
    where.push("turns_fts MATCH ?");
    params.push(fts);
    snippet = "snippet(turns_fts, -1, '<mark>', '</mark>', '…', 24)";
  }
  if (feedback) where.push(`t.feedback = ${feedback === "up" ? 1 : -1}`);
  if (errors) where.push("t.error IS NOT NULL");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT count(*) n FROM ${from} ${clause}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`SELECT ${COLUMNS}, ${snippet} AS snippet FROM ${from} ${clause} ORDER BY t.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  return { total, rows };
}

export function getSession(sessionId: string) {
  return db.prepare(`SELECT ${COLUMNS} FROM turns t WHERE session_id = ? ORDER BY turn_index, id`).all(sessionId);
}

export function stats(days = 30) {
  return db
    .prepare(`
      SELECT substr(created_at, 1, 10) AS day,
             count(*) AS questions,
             count(DISTINCT session_id) AS conversations,
             sum(error IS NOT NULL) AS errors,
             sum(feedback = 1) AS up,
             sum(feedback = -1) AS down,
             round(avg(duration_ms) / 1000.0, 1) AS avg_seconds,
             round(sum(cost_usd), 4) AS cost_usd
      FROM turns
      WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
      GROUP BY day ORDER BY day DESC
    `)
    .all(`-${days} days`);
}

export function exportAll() {
  return db.prepare(`SELECT ${COLUMNS} FROM turns t ORDER BY id`).all();
}

export function purgeOld(): number {
  const { changes } = db
    .prepare("DELETE FROM turns WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)")
    .run(`-${RETENTION_DAYS} days`);
  return Number(changes);
}
