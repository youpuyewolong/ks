const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDatabase } = require('./database');

function importCatalog(db, dataDir, catalogFile, { once = false, categoryId: chosenCategory } = {}) {
  const source = JSON.parse(fs.readFileSync(catalogFile, 'utf8').replace(/^\uFEFF/, ''));
  if (!/^\d+$/.test(source.album_id) || !Array.isArray(source.entries) || !source.entries.length || source.complete !== true || source.expected_count !== source.entries.length) throw new Error('仅导入已核对完整的官方目录');
  const marker = 'imported:kaishu:' + source.album_id;
  if (once && db.prepare('SELECT 1 FROM settings WHERE key=?').get(marker)) return { skipped:true, album_id:source.album_id };
  const root = fs.realpathSync(path.dirname(catalogFile));
  const seen = new Set();
  for (const entry of source.entries) {
    if (!entry.id || seen.has(entry.id) || !entry.title || !/^\d+:\d{2}$/.test(entry.duration)) throw new Error('目录编号、名称或时长无效');
    seen.add(entry.id);
  }
  const pending = new Map();
  function image(relative) {
    if (typeof relative !== 'string') throw new Error('缺少本地封面');
    const absolute = fs.realpathSync(path.resolve(root, relative));
    if (!absolute.startsWith(root + path.sep)) throw new Error('封面路径超出目录');
    const bytes = fs.readFileSync(absolute);
    let ext, mime;
    if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) [ext,mime]=['png','image/png'];
    else if (bytes[0]===255 && bytes[1]===216) [ext,mime]=['jpg','image/jpeg'];
    else if (bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') [ext,mime]=['webp','image/webp'];
    else throw new Error('本地封面文件类型无效');
    const id = 'cover-' + crypto.createHash('sha256').update(bytes).digest('hex');
    pending.set(id, { id, bytes, mime, filename:id+'.'+ext });
    return id;
  }
  const coverId = image(source.cover_file);
  const entries = source.entries.map((e,i) => ({ ...e, order:Number.isInteger(e.order) && e.order > 0 ? e.order : i+1, coverId:image(e.cover_file), durationSeconds:e.duration.split(':').map(Number).reduce((a,n)=>a*60+n,0), kind:e.kind || (/^第\s*\d+集/.test(e.title)?'故事':/∣|揭秘|什么是/.test(e.title+' '+e.subtitle)?'科学揭秘':'番外') }));
  const newFiles = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const m of pending.values()) {
      const target = path.join(dataDir, 'media', m.filename);
      if (!fs.existsSync(target)) { fs.writeFileSync(target,m.bytes,{flag:'wx'}); newFiles.push(target); }
      db.prepare('INSERT OR IGNORE INTO media VALUES(?,?,?,?,?)').run(m.id,m.filename,m.mime,'image',m.bytes.length);
    }
    const categoryName = source.series === '口袋神探' ? '侦探推理' : '链接导入';
    const categoryId = chosenCategory || db.prepare('SELECT id FROM categories WHERE name=?').get(categoryName)?.id || crypto.randomUUID();
    if (chosenCategory) {
      if (!db.prepare('SELECT id FROM categories WHERE id=?').get(chosenCategory)) throw new Error('所选分类已删除，请重新选择后导入');
    } else db.prepare('INSERT OR IGNORE INTO categories VALUES(?,?,?)').run(categoryId,categoryName,0);
    let storyId = db.prepare('SELECT id FROM stories WHERE source_album_id=?').get(source.album_id)?.id;
    if (!storyId) {
      storyId = crypto.randomUUID();
      db.prepare('INSERT INTO stories(id,title,description,category_id,cover_id,published,created_at,source_album_id,series,season,source_url) VALUES(?,?,?,?,?,1,?,?,?,?,?)').run(storyId,source.title,source.description || '',categoryId,coverId,Date.now(),source.album_id,source.series || '',source.season ?? null,source.source_url);
    } else db.prepare('UPDATE stories SET cover_id=? WHERE id=?').run(coverId,storyId);
    for (const e of entries) {
      const old = db.prepare('SELECT id FROM episodes WHERE story_id=? AND source_id=?').get(storyId,e.id);
      if (old) db.prepare('UPDATE episodes SET cover_id=?,subtitle=?,kind=? WHERE id=?').run(e.coverId,e.subtitle||'',e.kind,old.id);
      else db.prepare('INSERT INTO episodes(id,story_id,title,sort_order,duration,cover_id,subtitle,source_id,kind) VALUES(?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),storyId,e.title,e.order,e.durationSeconds,e.coverId,e.subtitle||'',e.id,e.kind);
    }
    db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(marker,source.captured_at || new Date().toISOString());
    db.exec('COMMIT');
    return { story_id:storyId,album_id:source.album_id,entries:entries.length,unique_images:pending.size };
  } catch (e) { db.exec('ROLLBACK'); for (const file of newFiles) fs.unlinkSync(file); throw e; }
}
function importBundled(db, dataDir, root = path.join(__dirname,'catalogs','kaishu')) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>path.join(root,e.name,'catalog.json')).filter(f=>fs.existsSync(f)).map(f=>importCatalog(db,dataDir,f,{once:true}));
}
if (require.main===module) {
  const dataDir=path.resolve(process.env.DATA_DIR||'data'),db=openDatabase(dataDir);
  try { console.log(JSON.stringify(process.argv[2]?importCatalog(db,dataDir,path.resolve(process.argv[2])):importBundled(db,dataDir),null,2)); }
  finally { db.close(); }
}
module.exports={importCatalog,importBundled};
