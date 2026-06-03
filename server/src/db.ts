import Database from 'better-sqlite3'
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
    createdAt INTEGER NOT NULL
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
    aiConfig TEXT
  );
`)

export default db
