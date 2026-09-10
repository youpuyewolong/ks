const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function migrate(db) {
  const add = (table, column, sql) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sql}`);
  };
  add('stories', 'source_album_id', 'TEXT');
  add('stories', 'series', "TEXT NOT NULL DEFAULT ''");
  add('stories', 'season', 'INTEGER');
  add('stories', 'source_url', "TEXT NOT NULL DEFAULT ''");
  const mediaColumn = db.prepare('PRAGMA table_info(episodes)').all().find(c => c.name === 'media_id');
  if (mediaColumn?.notnull) {
    // Rebuild only the parent table, retaining episode IDs and the progress FK.
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE episodes_v2(id TEXT PRIMARY KEY,story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,title TEXT NOT NULL,media_id TEXT REFERENCES media(id),sort_order INTEGER NOT NULL,duration REAL NOT NULL DEFAULT 0);
        INSERT INTO episodes_v2 SELECT id,story_id,title,media_id,sort_order,duration FROM episodes;
        DROP TABLE episodes; ALTER TABLE episodes_v2 RENAME TO episodes;
        CREATE INDEX episodes_story ON episodes(story_id,sort_order);`);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('数据库迁移外键检查失败');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    finally { db.exec('PRAGMA foreign_keys=ON'); }
  }
  add('episodes', 'cover_id', 'TEXT REFERENCES media(id)');
  add('episodes', 'subtitle', "TEXT NOT NULL DEFAULT ''");
  add('episodes', 'source_id', 'TEXT');
  add('episodes', 'kind', "TEXT NOT NULL DEFAULT '故事'");
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS stories_source ON stories(source_album_id) WHERE source_album_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS episodes_source ON episodes(story_id,source_id) WHERE source_id IS NOT NULL;`);
}
function openDatabase(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive:true });
  const db = new DatabaseSync(path.join(dataDir, 'stories.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,filename TEXT NOT NULL,mime TEXT NOT NULL,kind TEXT NOT NULL,size INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS stories(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,cover_id TEXT REFERENCES media(id),published INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS episodes(id TEXT PRIMARY KEY,story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,title TEXT NOT NULL,media_id TEXT REFERENCES media(id),sort_order INTEGER NOT NULL,duration REAL NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS progress(episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,position REAL NOT NULL,duration REAL NOT NULL,completed INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS favorites(story_id TEXT PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS episodes_story ON episodes(story_id,sort_order);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  migrate(db);
  return db;
}
module.exports = { openDatabase };
