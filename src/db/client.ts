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

  // CREATE TABLE IF NOT EXISTSは既存テーブルへの列追加はしないため、
  // マルチアカウント対応前から存在するDBに対してはここでガード付きALTERする。
  // schema.sql本体(account_nameを参照するインデックス定義を含む)を適用する前に、
  // カラム自体を先に追加しておく必要がある(順序を逆にするとCREATE INDEXが
  // 存在しないカラムを参照してSQLITE_ERRORになる)。
  const postsTableExists = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'posts'`)
    .get();
  if (postsTableExists) {
    const hasAccountName = db
      .prepare(`SELECT 1 FROM pragma_table_info('posts') WHERE name = 'account_name'`)
      .get();
    if (!hasAccountName) {
      db.exec(`ALTER TABLE posts ADD COLUMN account_name TEXT NOT NULL DEFAULT ''`);
    }
  }

  if (postsTableExists) {
    const hasSelected = db
      .prepare(`SELECT 1 FROM pragma_table_info('posts') WHERE name = 'selected_image_indices'`)
      .get();
    if (!hasSelected) {
      db.exec(`ALTER TABLE posts ADD COLUMN selected_image_indices TEXT`);
    }
  }

  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);

  return db;
}
