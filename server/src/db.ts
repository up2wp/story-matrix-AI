import Database from 'better-sqlite3'
import type { Database as DatabaseInstance } from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'story-matrix.db')

// 确保 data 目录存在
import fs from 'fs'
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

const db = new Database(DB_PATH)

// 启用 WAL 模式，提升并发性能
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    displayName TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    createdAt INTEGER NOT NULL,
    deletedAt INTEGER
  );

  CREATE TABLE IF NOT EXISTS works (
    id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL,
    shared INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS systemConfig (
    id TEXT PRIMARY KEY CHECK (id = 'singleton'),
    registrationEnabled INTEGER NOT NULL DEFAULT 0,
     aiConfig TEXT,
     voiceboxConfig TEXT,
     novelImportConfig TEXT,
     imageGenerationConfig TEXT
  );

  CREATE TABLE IF NOT EXISTS userVoices (
    id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL,
    displayName TEXT NOT NULL,
    profileId TEXT NOT NULL,
    profileName TEXT,
    sampleId TEXT,
    referenceText TEXT NOT NULL,
    consentConfirmedAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    deletedAt INTEGER,
    FOREIGN KEY (ownerId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS voiceboxGenerations (
    generationId TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL,
    profileId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (ownerId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );
`)

function columnExists(database: DatabaseInstance, table: string, column: string): boolean {
  return database.prepare(`PRAGMA table_info(${table})`).all().some((row) => {
    return typeof row === 'object' && row !== null && 'name' in row && row.name === column
  })
}

export function migrateDatabase(database: DatabaseInstance = db) {
  if (!columnExists(database, 'users', 'deletedAt')) {
    database.prepare('ALTER TABLE users ADD COLUMN deletedAt INTEGER').run()
  }

  if (!columnExists(database, 'systemConfig', 'voiceboxConfig')) {
    database.prepare('ALTER TABLE systemConfig ADD COLUMN voiceboxConfig TEXT').run()
  }

  if (!columnExists(database, 'systemConfig', 'novelImportConfig')) {
    database.prepare('ALTER TABLE systemConfig ADD COLUMN novelImportConfig TEXT').run()
  }

  if (!columnExists(database, 'systemConfig', 'imageGenerationConfig')) {
    database.prepare('ALTER TABLE systemConfig ADD COLUMN imageGenerationConfig TEXT').run()
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS userVoices (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL,
      displayName TEXT NOT NULL,
      profileId TEXT NOT NULL,
      profileName TEXT,
      sampleId TEXT,
      referenceText TEXT NOT NULL,
      consentConfirmedAt INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      deletedAt INTEGER,
      FOREIGN KEY (ownerId) REFERENCES users(id)
    )
  `)

  database.exec(`
    CREATE TABLE IF NOT EXISTS voiceboxGenerations (
      generationId TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL,
      profileId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (ownerId) REFERENCES users(id)
    )
  `)

  database.prepare("UPDATE users SET role = 'owner' WHERE username = 'admin' AND role = 'admin'").run()
}

migrateDatabase()

export default db
