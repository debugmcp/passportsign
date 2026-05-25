/**
 * SQLite cache mirroring spec §5's `bindings` table.
 *
 * The cache is **non-authoritative** by design — losing it is an
 * availability incident, not a security one. The canonical state lives
 * in Rekor, and `passportsign rebuild` reconstructs the cache from log
 * entries.
 *
 * Uses Node's built-in `node:sqlite` (experimental but functional in
 * Node 22.5+; stable enough for our single-user CLI use). Avoids the
 * `better-sqlite3` native-build dependency, which requires Visual
 * Studio C++ tools on Windows.
 *
 * Usernames are normalized to lowercase on insert and read per spec §10
 * row 7. Display casing is the caller's responsibility.
 */

import { DatabaseSync } from 'node:sqlite';

export type Status = 'active' | 'stale' | 'revoked';
export type DisclosureLevel = 'personhood' | 'personhood+country';

export interface BindingRow {
  github_username: string;          // lowercase
  unique_identifier: string;
  issuing_country: string | null;
  disclosure_level: DisclosureLevel;
  scope: string;
  zkpassport_sdk_ver: string;
  proof_blob: Uint8Array;
  gist_url: string;
  gist_content_sha256: string;
  bound_at: string;                 // ISO 8601, local-cache only
  log_entry_hash: string;
  log_inclusion_proof: unknown;     // serialized as JSON in the DB
  log_root_at_submission: string;
  last_checked_at: string;          // ISO 8601
  status: Status;
}

export interface PassportsignCache {
  upsertBinding(row: BindingRow): void;
  getByUsername(username: string): BindingRow | null;
  getByUniqueIdentifier(uid: string): BindingRow[];
  setStatus(username: string, status: Status): void;
  setLastChecked(username: string, when: Date): void;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bindings (
  github_username        TEXT PRIMARY KEY,
  unique_identifier      TEXT NOT NULL,
  issuing_country        TEXT,
  disclosure_level       TEXT NOT NULL CHECK (disclosure_level IN ('personhood','personhood+country')),
  scope                  TEXT NOT NULL,
  zkpassport_sdk_ver     TEXT NOT NULL,
  proof_blob             BLOB NOT NULL,
  gist_url               TEXT NOT NULL,
  gist_content_sha256    TEXT NOT NULL,
  bound_at               TEXT NOT NULL,
  log_entry_hash         TEXT NOT NULL UNIQUE,
  log_inclusion_proof    TEXT NOT NULL,
  log_root_at_submission TEXT NOT NULL,
  last_checked_at        TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','stale','revoked'))
);
CREATE INDEX IF NOT EXISTS bindings_unique_identifier ON bindings(unique_identifier);
`;

interface DbRow {
  github_username: string;
  unique_identifier: string;
  issuing_country: string | null;
  disclosure_level: DisclosureLevel;
  scope: string;
  zkpassport_sdk_ver: string;
  proof_blob: Uint8Array;
  gist_url: string;
  gist_content_sha256: string;
  bound_at: string;
  log_entry_hash: string;
  log_inclusion_proof: string;
  log_root_at_submission: string;
  last_checked_at: string;
  status: Status;
}

function rowFromDb(r: DbRow): BindingRow {
  return {
    github_username: r.github_username,
    unique_identifier: r.unique_identifier,
    issuing_country: r.issuing_country,
    disclosure_level: r.disclosure_level,
    scope: r.scope,
    zkpassport_sdk_ver: r.zkpassport_sdk_ver,
    proof_blob: new Uint8Array(r.proof_blob),
    gist_url: r.gist_url,
    gist_content_sha256: r.gist_content_sha256,
    bound_at: r.bound_at,
    log_entry_hash: r.log_entry_hash,
    log_inclusion_proof: JSON.parse(r.log_inclusion_proof),
    log_root_at_submission: r.log_root_at_submission,
    last_checked_at: r.last_checked_at,
    status: r.status,
  };
}

export function openCache(path: string): PassportsignCache {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);

  const upsertStmt = db.prepare(`
    INSERT INTO bindings (
      github_username, unique_identifier, issuing_country, disclosure_level,
      scope, zkpassport_sdk_ver, proof_blob, gist_url, gist_content_sha256,
      bound_at, log_entry_hash, log_inclusion_proof, log_root_at_submission,
      last_checked_at, status
    ) VALUES (
      :github_username, :unique_identifier, :issuing_country, :disclosure_level,
      :scope, :zkpassport_sdk_ver, :proof_blob, :gist_url, :gist_content_sha256,
      :bound_at, :log_entry_hash, :log_inclusion_proof, :log_root_at_submission,
      :last_checked_at, :status
    )
    ON CONFLICT(github_username) DO UPDATE SET
      unique_identifier      = excluded.unique_identifier,
      issuing_country        = excluded.issuing_country,
      disclosure_level       = excluded.disclosure_level,
      scope                  = excluded.scope,
      zkpassport_sdk_ver     = excluded.zkpassport_sdk_ver,
      proof_blob             = excluded.proof_blob,
      gist_url               = excluded.gist_url,
      gist_content_sha256    = excluded.gist_content_sha256,
      bound_at               = excluded.bound_at,
      log_entry_hash         = excluded.log_entry_hash,
      log_inclusion_proof    = excluded.log_inclusion_proof,
      log_root_at_submission = excluded.log_root_at_submission,
      last_checked_at        = excluded.last_checked_at,
      status                 = excluded.status
  `);
  const getByUsernameStmt = db.prepare(`SELECT * FROM bindings WHERE github_username = ?`);
  const getByUniqueIdStmt = db.prepare(`SELECT * FROM bindings WHERE unique_identifier = ? ORDER BY bound_at`);
  const setStatusStmt = db.prepare(`UPDATE bindings SET status = ? WHERE github_username = ?`);
  const setLastCheckedStmt = db.prepare(`UPDATE bindings SET last_checked_at = ? WHERE github_username = ?`);

  return {
    upsertBinding(row) {
      upsertStmt.run({
        github_username: row.github_username.toLowerCase(),
        unique_identifier: row.unique_identifier,
        issuing_country: row.issuing_country,
        disclosure_level: row.disclosure_level,
        scope: row.scope,
        zkpassport_sdk_ver: row.zkpassport_sdk_ver,
        proof_blob: row.proof_blob,
        gist_url: row.gist_url,
        gist_content_sha256: row.gist_content_sha256,
        bound_at: row.bound_at,
        log_entry_hash: row.log_entry_hash,
        log_inclusion_proof: JSON.stringify(row.log_inclusion_proof),
        log_root_at_submission: row.log_root_at_submission,
        last_checked_at: row.last_checked_at,
        status: row.status,
      });
    },
    getByUsername(username) {
      const r = getByUsernameStmt.get(username.toLowerCase()) as unknown as DbRow | undefined;
      return r ? rowFromDb(r) : null;
    },
    getByUniqueIdentifier(uid) {
      const rows = getByUniqueIdStmt.all(uid) as unknown as DbRow[];
      return rows.map(rowFromDb);
    },
    setStatus(username, status) {
      setStatusStmt.run(status, username.toLowerCase());
    },
    setLastChecked(username, when) {
      setLastCheckedStmt.run(when.toISOString(), username.toLowerCase());
    },
    close() {
      db.close();
    },
  };
}
