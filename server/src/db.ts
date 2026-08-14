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

const IMAGEGEN_HISTORY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS imagegenHistory (
    id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL,
    prompt TEXT NOT NULL,
    generationPromptSnapshot TEXT NOT NULL,
    provider TEXT NOT NULL,
    providerLabel TEXT NOT NULL,
    modelId TEXT NOT NULL,
    modelName TEXT NOT NULL,
    mimeType TEXT,
    storageMode TEXT NOT NULL CHECK (storageMode IN ('local', 'immich')),
    storageStatus TEXT NOT NULL CHECK (storageStatus IN ('generating', 'succeeded', 'pendingImmichUpload', 'storageUploadFailed', 'failed')),
    status TEXT NOT NULL CHECK (status IN ('generating', 'succeeded', 'pendingImmichUpload', 'storageUploadFailed', 'failed')),
    localAssetId TEXT,
    immichAssetId TEXT,
    immichFilename TEXT,
    thumbnailUrl TEXT,
    originalUrl TEXT,
    referenceImageIds TEXT,
    error TEXT,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (ownerId) REFERENCES users(id)
  )
`

const IMAGEGEN_HISTORY_COLUMNS = [
  'id',
  'ownerId',
  'prompt',
  'generationPromptSnapshot',
  'provider',
  'providerLabel',
  'modelId',
  'modelName',
  'mimeType',
  'storageMode',
  'storageStatus',
  'status',
  'localAssetId',
  'immichAssetId',
  'immichFilename',
  'thumbnailUrl',
  'originalUrl',
  'referenceImageIds',
  'error',
  'createdAt',
] as const

function createImagegenHistoryTable(database: DatabaseInstance, tableName = 'imagegenHistory') {
  database.exec(IMAGEGEN_HISTORY_TABLE_SQL.replace('CREATE TABLE IF NOT EXISTS imagegenHistory', `CREATE TABLE IF NOT EXISTS ${tableName}`))
}

function createImagegenHistoryIndexes(database: DatabaseInstance) {
  database.exec('CREATE INDEX IF NOT EXISTS idx_imagegenHistory_ownerCreatedAt ON imagegenHistory(ownerId, createdAt)')
}

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    displayName TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    createdAt INTEGER NOT NULL,
    deletedAt INTEGER,
    themePreference TEXT NOT NULL DEFAULT 'system'
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

  CREATE TABLE IF NOT EXISTS imagegenReferenceAssets (
    id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL,
    originalFilename TEXT,
    contentHash TEXT,
    mimeType TEXT NOT NULL,
    byteSize INTEGER NOT NULL,
    storageMode TEXT NOT NULL CHECK (storageMode IN ('local', 'immich')),
    storageStatus TEXT NOT NULL CHECK (storageStatus IN ('succeeded', 'pendingImmichUpload', 'storageUploadFailed', 'failed')),
    localAssetId TEXT,
    immichAssetId TEXT,
    immichFilename TEXT,
    thumbnailUrl TEXT NOT NULL,
    originalUrl TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (ownerId) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_imagegenReferenceAssets_ownerCreatedAt ON imagegenReferenceAssets(ownerId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_imagegenReferenceAssets_ownerStatus ON imagegenReferenceAssets(ownerId, storageStatus);

  CREATE TABLE IF NOT EXISTS imageGenerationFailures (
    id TEXT PRIMARY KEY,
    surface TEXT NOT NULL CHECK (surface IN ('work', 'imagegen')),
    ownerId TEXT NOT NULL,
    workId TEXT,
    prompt TEXT NOT NULL,
    generationPromptSnapshot TEXT NOT NULL,
    referenceImageIds TEXT,
    provider TEXT NOT NULL,
    providerLabel TEXT NOT NULL,
    modelId TEXT NOT NULL,
    modelName TEXT NOT NULL,
    storageMode TEXT NOT NULL CHECK (storageMode IN ('local', 'immich')),
    storageStatus TEXT NOT NULL CHECK (storageStatus IN ('failed')),
    status TEXT NOT NULL CHECK (status IN ('failed')),
    error TEXT NOT NULL,
    failureType TEXT,
    countsTowardAutoDisable INTEGER,
    autoDisableTriggeredAt INTEGER,
    riskControlAudit TEXT,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (ownerId) REFERENCES users(id),
    FOREIGN KEY (workId) REFERENCES works(id)
  );

  CREATE INDEX IF NOT EXISTS idx_imageGenerationFailures_ownerCreatedAt ON imageGenerationFailures(ownerId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_imageGenerationFailures_ownerRiskWindow ON imageGenerationFailures(ownerId, countsTowardAutoDisable, createdAt);
  CREATE INDEX IF NOT EXISTS idx_imageGenerationFailures_surfaceCreatedAt ON imageGenerationFailures(surface, createdAt);
  CREATE INDEX IF NOT EXISTS idx_imageGenerationFailures_workCreatedAt ON imageGenerationFailures(workId, createdAt);

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );
`)

createImagegenHistoryTable(db)
createImagegenHistoryIndexes(db)

function columnExists(database: DatabaseInstance, table: string, column: string): boolean {
  return database.prepare(`PRAGMA table_info(${table})`).all().some((row) => {
    return typeof row === 'object' && row !== null && 'name' in row && row.name === column
  })
}

function imagegenHistoryAllowsGenerating(database: DatabaseInstance): boolean {
  const row = database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'imagegenHistory'").get() as { sql?: string } | undefined
  return Boolean(row?.sql?.includes('generating'))
}

function rebuildImagegenHistoryForGenerating(database: DatabaseInstance) {
  const columns = IMAGEGEN_HISTORY_COLUMNS.join(', ')
  const rebuild = database.transaction(() => {
    database.exec('DROP TABLE IF EXISTS imagegenHistory_new')
    createImagegenHistoryTable(database, 'imagegenHistory_new')
    database.exec(`
      INSERT INTO imagegenHistory_new (${columns})
      SELECT ${columns}
      FROM imagegenHistory
    `)
    database.exec('DROP TABLE imagegenHistory')
    database.exec('ALTER TABLE imagegenHistory_new RENAME TO imagegenHistory')
    createImagegenHistoryIndexes(database)
  })

  const foreignKeys = database.pragma('foreign_keys', { simple: true })
  database.pragma('foreign_keys = OFF')
  try {
    rebuild()
    database.pragma('foreign_key_check')
  } finally {
    database.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`)
  }
}

export function migrateDatabase(database: DatabaseInstance = db) {
  if (!columnExists(database, 'users', 'deletedAt')) {
    database.prepare('ALTER TABLE users ADD COLUMN deletedAt INTEGER').run()
  }

  if (!columnExists(database, 'users', 'themePreference')) {
    database.prepare("ALTER TABLE users ADD COLUMN themePreference TEXT NOT NULL DEFAULT 'system'").run()
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

  if (!columnExists(database, 'imagegenHistory', 'referenceImageIds')) {
    database.prepare('ALTER TABLE imagegenHistory ADD COLUMN referenceImageIds TEXT').run()
  }

  if (!columnExists(database, 'imagegenReferenceAssets', 'contentHash')) {
    database.prepare('ALTER TABLE imagegenReferenceAssets ADD COLUMN contentHash TEXT').run()
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

  createImagegenHistoryTable(database)
  if (!imagegenHistoryAllowsGenerating(database)) {
    rebuildImagegenHistoryForGenerating(database)
  }
  createImagegenHistoryIndexes(database)

  database.exec(`
    CREATE TABLE IF NOT EXISTS imagegenReferenceAssets (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL,
      originalFilename TEXT,
      contentHash TEXT,
      mimeType TEXT NOT NULL,
      byteSize INTEGER NOT NULL,
      storageMode TEXT NOT NULL CHECK (storageMode IN ('local', 'immich')),
      storageStatus TEXT NOT NULL CHECK (storageStatus IN ('succeeded', 'pendingImmichUpload', 'storageUploadFailed', 'failed')),
      localAssetId TEXT,
      immichAssetId TEXT,
      immichFilename TEXT,
      thumbnailUrl TEXT NOT NULL,
      originalUrl TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (ownerId) REFERENCES users(id)
    )
  `)

  database.exec('CREATE INDEX IF NOT EXISTS idx_imagegenReferenceAssets_ownerCreatedAt ON imagegenReferenceAssets(ownerId, createdAt)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_imagegenReferenceAssets_ownerStatus ON imagegenReferenceAssets(ownerId, storageStatus)')
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_imagegenReferenceAssets_ownerContentHash ON imagegenReferenceAssets(ownerId, contentHash) WHERE contentHash IS NOT NULL')

  database.exec(`
    CREATE TABLE IF NOT EXISTS imageGenerationFailures (
      id TEXT PRIMARY KEY,
      surface TEXT NOT NULL CHECK (surface IN ('work', 'imagegen')),
      ownerId TEXT NOT NULL,
      workId TEXT,
      prompt TEXT NOT NULL,
      generationPromptSnapshot TEXT NOT NULL,
      referenceImageIds TEXT,
      provider TEXT NOT NULL,
      providerLabel TEXT NOT NULL,
      modelId TEXT NOT NULL,
      modelName TEXT NOT NULL,
      storageMode TEXT NOT NULL CHECK (storageMode IN ('local', 'immich')),
      storageStatus TEXT NOT NULL CHECK (storageStatus IN ('failed')),
      status TEXT NOT NULL CHECK (status IN ('failed')),
      error TEXT NOT NULL,
      failureType TEXT,
      countsTowardAutoDisable INTEGER,
      autoDisableTriggeredAt INTEGER,
      riskControlAudit TEXT,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (ownerId) REFERENCES users(id),
      FOREIGN KEY (workId) REFERENCES works(id)
    )
  `)

  if (!columnExists(database, 'imageGenerationFailures', 'failureType')) {
    database.prepare('ALTER TABLE imageGenerationFailures ADD COLUMN failureType TEXT').run()
  }

  if (!columnExists(database, 'imageGenerationFailures', 'countsTowardAutoDisable')) {
    database.prepare('ALTER TABLE imageGenerationFailures ADD COLUMN countsTowardAutoDisable INTEGER').run()
  }

  if (!columnExists(database, 'imageGenerationFailures', 'autoDisableTriggeredAt')) {
    database.prepare('ALTER TABLE imageGenerationFailures ADD COLUMN autoDisableTriggeredAt INTEGER').run()
  }

  if (!columnExists(database, 'imageGenerationFailures', 'riskControlAudit')) {
    database.prepare('ALTER TABLE imageGenerationFailures ADD COLUMN riskControlAudit TEXT').run()
  }

  database.exec('CREATE INDEX IF NOT EXISTS idx_imageGenerationFailures_ownerCreatedAt ON imageGenerationFailures(ownerId, createdAt)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_imageGenerationFailures_ownerRiskWindow ON imageGenerationFailures(ownerId, countsTowardAutoDisable, createdAt)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_imageGenerationFailures_surfaceCreatedAt ON imageGenerationFailures(surface, createdAt)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_imageGenerationFailures_workCreatedAt ON imageGenerationFailures(workId, createdAt)')

  database.prepare("UPDATE users SET role = 'owner' WHERE username = 'admin' AND role = 'admin'").run()
}

migrateDatabase()

export default db
