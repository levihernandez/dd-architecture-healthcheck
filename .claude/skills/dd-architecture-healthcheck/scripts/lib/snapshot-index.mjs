// Lightweight run history, indexed in SQLite (Node's built-in node:sqlite —
// no dependency install). Every collect.mjs / snapshot.mjs run is recorded here
// so trend/diff queries don't need to re-scan the JSON snapshot files on disk.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const DB_PATH = path.join(import.meta.dirname, '..', '..', 'snapshots', 'index.db');

let db;
function getDb() {
  if (db) return db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org TEXT NOT NULL,
      resource TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      status TEXT NOT NULL,
      item_count INTEGER,
      duration_ms INTEGER,
      file_path TEXT NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_org_resource ON runs(org, resource, timestamp);
  `);
  return db;
}

export function recordRun({ org, resource, timestamp, status, itemCount, durationMs, filePath, error }) {
  const stmt = getDb().prepare(`
    INSERT INTO runs (org, resource, timestamp, status, item_count, duration_ms, file_path, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(org, resource, timestamp, status, itemCount, durationMs, filePath, error);
}

export function history(org, resource, limit = 20) {
  const stmt = getDb().prepare(`
    SELECT timestamp, status, item_count, duration_ms, file_path, error
    FROM runs WHERE org = ? AND resource = ?
    ORDER BY timestamp DESC LIMIT ?
  `);
  return stmt.all(org, resource, limit);
}

export function latestPerResource(org) {
  const stmt = getDb().prepare(`
    SELECT resource, MAX(timestamp) AS timestamp, status, item_count, file_path
    FROM runs WHERE org = ?
    GROUP BY resource
    ORDER BY resource
  `);
  return stmt.all(org);
}
