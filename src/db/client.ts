import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DB_PATH = path.resolve(process.cwd(), "data/app.db");
const SCHEMA_PATH = path.resolve(process.cwd(), "schema.sql");

let db: Database.Database | undefined;

// data/app.dbへの接続を取得する。schema.sqlをCREATE TABLE IF NOT EXISTSで毎回適用するため、
// 別途マイグレーションツールを導入しなくてもスキーマが最新化される。
export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(DB_PATH);
  // WALモードは使わない: ワークフローはプロセス終了ごとにdata/app.dbをそのままgitコミットするため、
  // -wal/-shm補助ファイルを残さず単一ファイルで完結させる。
  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);

  return db;
}
