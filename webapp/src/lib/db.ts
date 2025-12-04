import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from './scripts';

let db: Database.Database | null = null;

/**
 * Получение экземпляра базы данных (singleton)
 */
export function getDb(): Database.Database {
  if (!db) {
    // Создаём директорию если не существует
    fs.mkdirSync(config.dataDir, { recursive: true });
    
    const dbPath = path.join(config.dataDir, 'npmBridge.db');
    db = new Database(dbPath);
    
    // Включаем WAL mode для лучшей производительности
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    // Инициализируем схему
    initSchema(db);
  }
  return db;
}

/**
 * Инициализация схемы базы данных
 */
function initSchema(database: Database.Database): void {
  database.exec(`
    -- Сети
    CREATE TABLE IF NOT EXISTS networks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#3B82F6',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Состояния сетей
    CREATE TABLE IF NOT EXISTS network_states (
      network_id TEXT PRIMARY KEY REFERENCES networks(id) ON DELETE CASCADE,
      last_sync_at TEXT,
      last_diff_id TEXT,
      packages_count INTEGER DEFAULT 0,
      total_size INTEGER DEFAULT 0
    );

    -- Diff записи
    CREATE TABLE IF NOT EXISTS diffs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'transferred', 'outdated', 'partial')),
      archive_path TEXT NOT NULL,
      archive_size INTEGER NOT NULL,
      archive_size_human TEXT NOT NULL,
      files_count INTEGER NOT NULL,
      files TEXT NOT NULL, -- JSON array
      storage_snapshot_time TEXT NOT NULL
    );

    -- Переносы diff в сети
    CREATE TABLE IF NOT EXISTS diff_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      diff_id TEXT NOT NULL REFERENCES diffs(id) ON DELETE CASCADE,
      network_id TEXT NOT NULL,
      transferred_at TEXT NOT NULL,
      UNIQUE(diff_id, network_id)
    );

    -- Обновления
    CREATE TABLE IF NOT EXISTS updates (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('full', 'recent')),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'completed_with_errors')),
      packages_total INTEGER DEFAULT 0,
      packages_success INTEGER DEFAULT 0,
      packages_failed INTEGER DEFAULT 0,
      log_file TEXT,
      broken_check_id TEXT
    );

    -- Проверки битых архивов
    CREATE TABLE IF NOT EXISTS broken_checks (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'completed_with_issues')),
      total_archives INTEGER DEFAULT 0,
      broken_archives INTEGER DEFAULT 0,
      broken_files TEXT DEFAULT '[]', -- JSON array
      fixed INTEGER DEFAULT 0, -- boolean
      fixed_count INTEGER DEFAULT 0,
      triggered_by_update TEXT
    );

    -- Прогресс задач (временные данные)
    CREATE TABLE IF NOT EXISTS task_progress (
      task_id TEXT PRIMARY KEY,
      current_val INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      percent REAL DEFAULT 0,
      current_package TEXT,
      current_file TEXT,
      success INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      broken INTEGER DEFAULT 0,
      phase TEXT,
      updated_at TEXT NOT NULL
    );

    -- Статус задач (временные данные)
    CREATE TABLE IF NOT EXISTS task_status (
      task_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      message TEXT,
      updated_at TEXT NOT NULL
    );

    -- Метаданные
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Кэш статистики storage
    CREATE TABLE IF NOT EXISTS storage_stats_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total_packages INTEGER DEFAULT 0,
      total_versions INTEGER DEFAULT 0,
      total_size INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    -- Индекс пакетов для быстрого поиска
    CREATE TABLE IF NOT EXISTS packages_index (
      name TEXT PRIMARY KEY,
      scope TEXT,
      is_scoped INTEGER DEFAULT 0,
      latest_version TEXT,
      versions_count INTEGER DEFAULT 0,
      total_size INTEGER DEFAULT 0,
      last_updated TEXT,
      package_json TEXT, -- JSON полностью
      indexed_at TEXT NOT NULL
    );

    -- Индексы
    CREATE INDEX IF NOT EXISTS idx_diffs_status ON diffs(status);
    CREATE INDEX IF NOT EXISTS idx_diffs_created_at ON diffs(created_at);
    CREATE INDEX IF NOT EXISTS idx_updates_status ON updates(status);
    CREATE INDEX IF NOT EXISTS idx_updates_started_at ON updates(started_at);
    CREATE INDEX IF NOT EXISTS idx_broken_checks_status ON broken_checks(status);
    CREATE INDEX IF NOT EXISTS idx_packages_scope ON packages_index(scope);
    CREATE INDEX IF NOT EXISTS idx_packages_is_scoped ON packages_index(is_scoped);
    CREATE INDEX IF NOT EXISTS idx_packages_last_updated ON packages_index(last_updated);

    -- Состояние индексации
    CREATE TABLE IF NOT EXISTS indexing_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      is_indexing INTEGER DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      packages_indexed INTEGER DEFAULT 0,
      packages_total INTEGER DEFAULT 0,
      last_error TEXT,
      stats_updated_at TEXT
    );
  `);

  // Миграция: добавление поддержки type='single' в таблицу updates
  migrateUpdatesTable(database);

  // Инициализация дефолтных сетей если таблица пуста
  const networksCount = database.prepare('SELECT COUNT(*) as count FROM networks').get() as { count: number };
  if (networksCount.count === 0) {
    loadDefaultNetworks(database);
  }
}

/**
 * Миграция таблицы updates для поддержки type='single'
 */
function migrateUpdatesTable(database: Database.Database): void {
  try {
    // Проверяем, нужна ли миграция (пробуем вставить с type='single')
    const testStmt = database.prepare(`
      INSERT INTO updates (id, type, started_at, status, packages_total)
      VALUES ('__migration_test__', 'single', datetime('now'), 'completed', 0)
    `);
    
    try {
      testStmt.run();
      // Если успешно, удаляем тестовую запись
      database.prepare(`DELETE FROM updates WHERE id = '__migration_test__'`).run();
      return; // Миграция не нужна
    } catch {
      // Миграция нужна - пересоздаём таблицу
      console.log('[DB] Migrating updates table to support type=single...');
      
      database.exec(`
        -- Создаём временную таблицу с новой схемой
        CREATE TABLE IF NOT EXISTS updates_new (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK(type IN ('full', 'recent', 'single')),
          started_at TEXT NOT NULL,
          finished_at TEXT,
          status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'completed_with_errors')),
          packages_total INTEGER DEFAULT 0,
          packages_success INTEGER DEFAULT 0,
          packages_failed INTEGER DEFAULT 0,
          log_file TEXT,
          broken_check_id TEXT,
          package_name TEXT
        );

        -- Копируем данные
        INSERT OR IGNORE INTO updates_new (id, type, started_at, finished_at, status, packages_total, packages_success, packages_failed, log_file, broken_check_id)
        SELECT id, type, started_at, finished_at, status, packages_total, packages_success, packages_failed, log_file, broken_check_id
        FROM updates;

        -- Удаляем старую таблицу
        DROP TABLE updates;

        -- Переименовываем новую
        ALTER TABLE updates_new RENAME TO updates;

        -- Пересоздаём индексы
        CREATE INDEX IF NOT EXISTS idx_updates_status ON updates(status);
        CREATE INDEX IF NOT EXISTS idx_updates_started_at ON updates(started_at);
      `);
      
      console.log('[DB] Updates table migration completed');
    }
  } catch (error) {
    console.error('[DB] Migration error:', error);
  }
}

/**
 * Загрузка дефолтных сетей из файла
 */
function loadDefaultNetworks(database: Database.Database): void {
  const defaultsPath = path.join(config.dataDir, '..', 'defaults', 'networks.json');
  
  let networks = [
    {
      id: 'default',
      name: 'Основная корп. сеть',
      description: 'Главная корпоративная сеть',
      color: '#3B82F6',
    },
  ];

  try {
    if (fs.existsSync(defaultsPath)) {
      const data = JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'));
      if (data.networks && Array.isArray(data.networks)) {
        networks = data.networks;
      }
    }
  } catch {
    console.warn('Could not load default networks, using built-in defaults');
  }

  const insert = database.prepare(`
    INSERT OR IGNORE INTO networks (id, name, description, color) VALUES (?, ?, ?, ?)
  `);

  for (const network of networks) {
    insert.run(network.id, network.name, network.description || '', network.color || '#3B82F6');
  }
}

/**
 * Получение/установка метаданных
 */
export function getMetadata(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || null;
}

export function setMetadata(key: string, value: string): void {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run(key, value);
}

/**
 * Закрытие базы данных
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
