const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { openDatabase } = require('./database');
const { importBundled } = require('./import-catalog');
const { createImportManager } = require('./kaishu-import');

function createApp({ dataDir = process.env.DATA_DIR || path.join(__dirname, 'data'), password = process.env.ADMIN_PASSWORD || '', seedCatalogs = false, importFetch = fetch } = {}) {
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  const db = openDatabase(dataDir);
  if (!db.prepare("SELECT 1 FROM settings WHERE key='initialized'").get()) {
    for (const [i, name] of ['睡前故事', '童话冒险', '国学经典', '科普百科'].entries()) db.prepare('INSERT INTO categories VALUES(?,?,?)').run(crypto.randomUUID(), name, i);
    db.prepare('INSERT INTO settings VALUES(?,?)').run('initialized', '1');
  }
  if (seedCatalogs) importBundled(db, dataDir);
  const imports = createImportManager(db, dataDir, { fetchImpl:importFetch });
  const sessions = new Map(), attempts = new Map();
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const row = (table, id) => { if (typeof id !== 'string') fail(400, '缺少内容编号'); const result = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id); if (!result) fail(404, '内容不存在或已被删除'); return result; };
  const label = (value, max = 120) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `请填写 1–${max} 字的名称`); return value.trim(); };
  const numeric = (value, max = 1e7) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) fail(400, '数值不合法'); return value; };
  const mediaRef = (id, kind) => { if (row('media', id).kind !== kind) fail(400, '文件类型不匹配'); return id; };
  async function body(req) { let size = 0, chunks = []; for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) fail(413, '请求内容过大'); chunks.push(chunk); } try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (!value || Array.isArray(value) || typeof value !== 'object') fail(400, '请求格式不正确'); return value; } catch { fail(400, '请求格式不正确'); } }
  function authorized(req) { if (!password) return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress); const token = /(?:^|;\s*)story_admin=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1]; if (!token) return false; if ((sessions.get(token) || 0) < Date.now()) { sessions.delete(token); return false; } return true; }
  function catalog(admin = false) {
    const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order,name').all();
    const stories = db.prepare(`SELECT s.*,c.name category FROM stories s LEFT JOIN categories c ON c.id=s.category_id ${admin ? '' : 'WHERE s.published=1'} ORDER BY s.series,s.season,s.created_at DESC,s.id`).all();
    const episodes = db.prepare('SELECT e.*,m.size,m.mime FROM episodes e LEFT JOIN media m ON m.id=e.media_id ORDER BY e.sort_order,e.id').all();
    for (const story of stories) { story.cover_url = story.cover_id ? '/media/' + story.cover_id : null; story.episodes = episodes.filter(e => e.story_id === story.id).map(e => ({ ...e, audio_url: e.media_id ? '/media/' + e.media_id : null, cover_url:e.cover_id ? '/media/' + e.cover_id : null, has_audio:!!e.media_id })); }
    return { categories, stories };
  }
  async function removeUnused(id) { if (!id || db.prepare('SELECT 1 FROM episodes WHERE media_id=? OR cover_id=? UNION ALL SELECT 1 FROM stories WHERE cover_id=?').get(id, id, id)) return; const file = db.prepare('SELECT * FROM media WHERE id=?').get(id); if (file) { db.prepare('DELETE FROM media WHERE id=?').run(id); await fsp.unlink(path.join(dataDir, 'media', file.filename)).catch(() => {}); } }
  function detect(bytes, kind) {
    if (kind === 'image') {
      if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return ['image/png', 'png'];
      if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['image/jpeg', 'jpg'];
      if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return ['image/webp', 'webp'];
    } else {
      if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return ['audio/wav', 'wav'];
      if (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 6) !== 0)) return ['audio/mpeg', 'mp3'];
      if (bytes.toString('ascii', 0, 4) === 'OggS') return ['audio/ogg', 'ogg'];
      if (bytes.toString('ascii', 0, 4) === 'fLaC') return ['audio/flac', 'flac'];
      if (bytes.toString('ascii', 4, 8) === 'ftyp') return ['audio/mp4', 'm4a'];
      if (bytes[0] === 255 && (bytes[1] & 0xf6) === 0xf0) return ['audio/aac', 'aac'];
    }
    fail(415, kind === 'image' ? '封面支持 JPG、PNG、WebP' : '录音支持 MP3、M4A、WAV、OGG、FLAC、AAC，请检查文件内容');
  }
  async function upload(req, res, url) {
    const kind = url.searchParams.get('kind'); if (!['image','audio'].includes(kind)) fail(400, '未指定上传类型');
    const max = (kind === 'image' ? 10 : 500) * 1024 * 1024;
    if (Number(req.headers['content-length']) > max) fail(413, `文件不能超过 ${max / 1024 / 1024} MB`);
    const id = crypto.randomUUID(), temp = path.join(dataDir, 'media', id + '.part'); let size = 0, head = Buffer.alloc(0);
    try {
      const limiter = new Transform({ transform(chunk, enc, done) { size += chunk.length; if (size > max) { done(Object.assign(new Error('文件过大'), { status: 413 })); return; } if (head.length < 64) head = Buffer.concat([head, chunk.subarray(0, 64 - head.length)]); done(null, chunk); } });
      await pipeline(req, limiter, fs.createWriteStream(temp, { flags: 'wx' }));
      if (size < 12) fail(415, '文件为空或内容无效');
      const [mime, ext] = detect(head, kind), filename = id + '.' + ext;
      await fsp.rename(temp, path.join(dataDir, 'media', filename));
      try { db.prepare('INSERT INTO media VALUES(?,?,?,?,?)').run(id, filename, mime, kind, size); } catch (error) { await fsp.unlink(path.join(dataDir, 'media', filename)); throw error; }
      json(res, 201, { id, url: '/media/' + id, mime, size });
    } catch (error) { await fsp.unlink(temp).catch(() => {}); throw error; }
  }
  async function serveFile(req, res, file, mime) {
    let stat; try { stat = await fsp.stat(file); } catch { fail(404, '文件不存在'); }
    let start = 0, end = stat.size - 1, status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
      if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; } else start = Math.max(0, stat.size - Number(match[2]));
      if (start > end || start >= stat.size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
      status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    }
    res.writeHead(status, { 'Content-Type': mime, 'Content-Length': Math.max(0, end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache' });
    if (req.method === 'HEAD' || !stat.size) { res.end(); return; }
    await pipeline(fs.createReadStream(file, { start, end }), res).catch(() => {});
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY');
    try {
      const url = new URL(req.url, 'http://localhost'), p = url.pathname, method = req.method;
      if (!password && !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '')) fail(403, '本地模式只允许 localhost 访问');
      if (!['GET','HEAD'].includes(method)) {
        if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, '不允许跨站写入');
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) fail(403, '不允许跨站写入');
      }
      if (p === '/api/admin/session' && method === 'GET') return json(res, 200, { authenticated: authorized(req), passwordRequired: !!password });
      if (p === '/api/admin/login' && method === 'POST') {
        const ip = req.socket.remoteAddress, attempt = attempts.get(ip) || { count: 0, until: 0 };
        if (attempt.until > Date.now() && attempt.count >= 10) fail(429, '尝试过于频繁，请 10 分钟后再试');
        const input = await body(req), hash = x => crypto.createHash('sha256').update(x).digest();
        if (!password || typeof input.password !== 'string' || !crypto.timingSafeEqual(hash(password), hash(input.password))) { attempts.set(ip, { count: attempt.until > Date.now() ? attempt.count + 1 : 1, until: Date.now() + 600000 }); fail(401, '管理密码不正确'); }
        attempts.delete(ip); for (const [token, expiry] of sessions) if (expiry < Date.now()) sessions.delete(token);
        const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, Date.now() + 12 * 3600000);
        res.setHeader('Set-Cookie', `story_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`); return json(res, 200, { ok: true });
      }
      if (p.startsWith('/api/admin/') && !authorized(req)) fail(401, '请先输入管理密码');
      if (p === '/api/admin/logout' && method === 'POST') { const token = /story_admin=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1]; sessions.delete(token); res.setHeader('Set-Cookie', 'story_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'); return json(res, 200, { ok: true }); }
      if (p === '/api/catalog' && method === 'GET') return json(res, 200, catalog());
      if (p === '/api/admin/catalog' && method === 'GET') return json(res, 200, catalog(true));
      if (p === '/api/admin/kaishu-import' && method === 'GET') return json(res, 200, { job:imports.current() });
      if (p === '/api/admin/kaishu-import/confirm' && method === 'POST') {
        const b = await body(req);
        return json(res, 202, { job:imports.confirm(b.job_id, b.entry_ids) });
      }
      if (p === '/api/admin/kaishu-import' && method === 'POST') {
        const b = await body(req);
        if (b.category_id != null && typeof b.category_id !== 'string') fail(400, '分类格式不正确');
        return json(res, 202, { job:imports.start(b.url, b.category_id || null, {previewOnly:b.preview === true}) });
      }
      if (p === '/api/listening' && method === 'GET') return json(res, 200, { progress: db.prepare('SELECT p.* FROM progress p JOIN episodes e ON e.id=p.episode_id JOIN stories s ON s.id=e.story_id WHERE s.published=1 ORDER BY p.updated_at DESC').all(), favorites: db.prepare('SELECT f.story_id FROM favorites f JOIN stories s ON s.id=f.story_id WHERE s.published=1').all().map(f => f.story_id) });
      if (p === '/api/progress' && method === 'PUT') {
        const b = await body(req), episode = row('episodes', b.episode_id); if (!episode.media_id || !row('stories', episode.story_id).published) fail(404, '故事未上架');
        const duration = numeric(b.duration), position = Math.min(numeric(b.position), duration); if (duration <= 0) fail(400, '音频时长无效');
        const completed = b.completed === true && position >= duration - 1 ? 1 : 0;
        const timestamp = b.updated_at === undefined ? Date.now() : Math.min(numeric(b.updated_at, 1e15), Date.now() + 60000);
        db.prepare('INSERT INTO progress VALUES(?,?,?,?,?) ON CONFLICT(episode_id) DO UPDATE SET position=excluded.position,duration=excluded.duration,completed=excluded.completed,updated_at=excluded.updated_at WHERE excluded.updated_at>=progress.updated_at').run(episode.id, position, duration, completed, timestamp);
        if (!episode.duration) db.prepare('UPDATE episodes SET duration=? WHERE id=?').run(duration, episode.id);
        return json(res, 200, { ok: true });
      }
      const favorite = /^\/api\/favorites\/([^/]+)$/.exec(p);
      if (favorite && ['PUT','DELETE'].includes(method)) { const story = row('stories', favorite[1]); if (!story.published) fail(404, '故事未上架'); if (method === 'PUT') db.prepare('INSERT OR IGNORE INTO favorites VALUES(?)').run(story.id); else db.prepare('DELETE FROM favorites WHERE story_id=?').run(story.id); return json(res, 200, { ok: true }); }
      if (p === '/api/admin/upload' && method === 'POST') return await upload(req, res, url);
      if (p === '/api/admin/categories' && method === 'POST') { const b = await body(req), id = crypto.randomUUID(); db.prepare('INSERT INTO categories VALUES(?,?,?)').run(id, label(b.name, 30), numeric(b.sort_order ?? 0)); return json(res, 201, { id }); }
      const category = /^\/api\/admin\/categories\/([^/]+)$/.exec(p);
      if (category && ['PUT','DELETE'].includes(method)) { row('categories', category[1]); if (method === 'DELETE') { if (db.prepare('SELECT 1 FROM stories WHERE category_id=?').get(category[1])) fail(409, '此分类下还有故事，请先移动故事'); db.prepare('DELETE FROM categories WHERE id=?').run(category[1]); } else { const b = await body(req); db.prepare('UPDATE categories SET name=?,sort_order=? WHERE id=?').run(label(b.name, 30), numeric(b.sort_order ?? 0), category[1]); } return json(res, 200, { ok: true }); }
      if (p === '/api/admin/stories' && method === 'POST') { const b = await body(req), id = crypto.randomUUID(); if (b.category_id) row('categories', b.category_id); db.prepare('INSERT INTO stories(id,title,description,category_id,created_at) VALUES(?,?,?,?,?)').run(id, label(b.title), String(b.description || '').slice(0, 3000), b.category_id || null, Date.now()); return json(res, 201, { id }); }
      const storyMatch = /^\/api\/admin\/stories\/([^/]+)$/.exec(p);
      if (storyMatch && ['PUT','DELETE'].includes(method)) {
        const story = row('stories', storyMatch[1]);
        if (method === 'DELETE') { const ids = db.prepare('SELECT media_id,cover_id FROM episodes WHERE story_id=?').all(story.id).flatMap(e => [e.media_id,e.cover_id]); db.prepare('DELETE FROM stories WHERE id=?').run(story.id); for (const id of [...ids, story.cover_id]) await removeUnused(id); }
        else { const b = await body(req); if (b.category_id) row('categories', b.category_id); const coverId = b.cover_id === undefined ? story.cover_id : b.cover_id || null; if (coverId) mediaRef(coverId, 'image'); if (b.published && !db.prepare('SELECT 1 FROM episodes WHERE story_id=?').get(story.id)) fail(400, '请先添加至少一个分集再上架'); db.prepare('UPDATE stories SET title=?,description=?,category_id=?,cover_id=?,published=? WHERE id=?').run(label(b.title), String(b.description || '').slice(0, 3000), b.category_id || null, coverId, b.published ? 1 : 0, story.id); if (story.cover_id !== coverId) await removeUnused(story.cover_id); }
        return json(res, 200, { ok: true });
      }
      const episodeList = /^\/api\/admin\/stories\/([^/]+)\/episodes$/.exec(p);
      if (episodeList && method === 'POST') { row('stories', episodeList[1]); const b = await body(req), id = crypto.randomUUID(); const next = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 n FROM episodes WHERE story_id=?').get(episodeList[1]).n; db.prepare('INSERT INTO episodes(id,story_id,title,media_id,sort_order,duration,cover_id,subtitle,kind) VALUES(?,?,?,?,?,?,?,?,?)').run(id, episodeList[1], label(b.title), b.media_id ? mediaRef(b.media_id, 'audio') : null, next, numeric(b.duration ?? 0), b.cover_id ? mediaRef(b.cover_id,'image') : null, String(b.subtitle||'').slice(0,500), ['故事','科学揭秘','番外'].includes(b.kind)?b.kind:'故事'); return json(res, 201, { id }); }
      const order = /^\/api\/admin\/stories\/([^/]+)\/order$/.exec(p);
      if (order && method === 'PUT') { row('stories', order[1]); const b = await body(req), ids = db.prepare('SELECT id FROM episodes WHERE story_id=?').all(order[1]).map(e => e.id); if (!Array.isArray(b.ids) || b.ids.length !== ids.length || new Set(b.ids).size !== ids.length || b.ids.some(id => !ids.includes(id))) fail(400, '分集列表已变化，请刷新后重试'); db.exec('BEGIN'); try { b.ids.forEach((id, i) => db.prepare('UPDATE episodes SET sort_order=? WHERE id=?').run(i + 1, id)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return json(res, 200, { ok: true }); }
      const batchMatch = /^\/api\/admin\/stories\/([^/]+)\/episodes\/batch$/.exec(p);
      if (batchMatch && method === 'POST') {
        const story = row('stories',batchMatch[1]), b = await body(req);
        if (!Array.isArray(b.episodes) || !b.episodes.length || b.episodes.length>2000 || new Set(b.episodes.map(e=>e?.id)).size!==b.episodes.length) fail(400,'请选择有效且不重复的分集');
        if (!['delete','kind'].includes(b.action) || b.action==='kind'&&!['故事','科学揭秘','番外'].includes(b.kind)) fail(400,'操作或类型无效');
        const entries=b.episodes.map(item=>{
          const e=row('episodes',item?.id);
          if(e.story_id!==story.id)fail(400,'所选分集不属于当前专辑');
          if(item.media_id!==e.media_id)fail(409,'分集录音已变化，请刷新后重新确认');
          return e;
        });
        db.exec('BEGIN IMMEDIATE');
        try {
          for(const e of entries) {
            if(b.action==='delete')db.prepare('DELETE FROM episodes WHERE id=?').run(e.id);
            else db.prepare('UPDATE episodes SET kind=? WHERE id=?').run(b.kind,e.id);
          }
          if(!db.prepare('SELECT 1 FROM episodes WHERE story_id=?').get(story.id))db.prepare('UPDATE stories SET published=0 WHERE id=?').run(story.id);
          db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        if(b.action==='delete')for(const id of new Set(entries.flatMap(e=>[e.media_id,e.cover_id])))await removeUnused(id);
        return json(res,200,{ok:true,count:entries.length});
      }
      const episodeMatch = /^\/api\/admin\/episodes\/([^/]+)$/.exec(p);
      if (episodeMatch && ['PUT','DELETE'].includes(method)) { const e = row('episodes', episodeMatch[1]); if (method === 'DELETE') { db.prepare('DELETE FROM episodes WHERE id=?').run(e.id); if (!db.prepare('SELECT 1 FROM episodes WHERE story_id=?').get(e.story_id)) db.prepare('UPDATE stories SET published=0 WHERE id=?').run(e.story_id); await removeUnused(e.media_id); await removeUnused(e.cover_id); } else { const b = await body(req); if ('expected_media_id' in b && b.expected_media_id !== e.media_id) fail(409, '该分集录音已变化，请刷新后重试'); const mediaId = b.media_id ? mediaRef(b.media_id, 'audio') : e.media_id; const coverId=b.cover_id===undefined?e.cover_id:b.cover_id?mediaRef(b.cover_id,'image'):null; db.prepare('UPDATE episodes SET title=?,media_id=?,duration=?,cover_id=?,subtitle=?,kind=? WHERE id=?').run(label(b.title ?? e.title), mediaId, numeric(b.duration ?? e.duration), coverId, String(b.subtitle ?? e.subtitle).slice(0,500), ['故事','科学揭秘','番外'].includes(b.kind)?b.kind:e.kind, e.id); if (coverId!==e.cover_id) await removeUnused(e.cover_id); if (mediaId !== e.media_id) { db.prepare('DELETE FROM progress WHERE episode_id=?').run(e.id); await removeUnused(e.media_id); } } return json(res, 200, { ok: true }); }
      const unusedMedia = /^\/api\/admin\/media\/([^/]+)$/.exec(p);
      if (unusedMedia && method === 'DELETE') { await removeUnused(unusedMedia[1]); return json(res, 200, { ok: true }); }
      const media = /^\/media\/([^/]+)$/.exec(p);
      if (media && ['GET','HEAD'].includes(method)) { const file = row('media', media[1]); if (!authorized(req) && !db.prepare('SELECT 1 FROM stories WHERE cover_id=? AND published=1 UNION ALL SELECT 1 FROM episodes e JOIN stories s ON s.id=e.story_id WHERE (e.media_id=? OR e.cover_id=?) AND s.published=1').get(file.id, file.id, file.id)) fail(404, '文件不存在'); return await serveFile(req, res, path.join(dataDir, 'media', file.filename), file.mime); }
      const assets = { "/matching.js":"matching.js", '/': 'index.html', '/index.html': 'index.html', '/admin': 'admin.html', '/admin/': 'admin.html', '/admin.html': 'admin.html', '/app.js': 'app.js', '/admin.js': 'admin.js', '/artwork.js': 'artwork.js', '/shared.js': 'shared.js', '/style.css': 'style.css', '/admin.css': 'admin.css' };
      if (assets[p] && ['GET','HEAD'].includes(method)) return await serveFile(req, res, path.join(__dirname, assets[p]), ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' })[path.extname(assets[p])]);
      fail(404, '页面或接口不存在');
    } catch (error) { if (!res.headersSent && !res.destroyed) { const status = error.status || (String(error.message).includes('UNIQUE constraint') ? 409 : 500); if (status === 500) console.error(error); json(res, status, { error: status === 500 ? '服务器处理失败，请稍后重试' : !error.status && status === 409 ? '名称已存在' : error.message }); } }
  });
  server.requestTimeout = 30 * 60 * 1000;
  server.on('close', () => { imports.stop(); db.close(); });
  return server;
}
if (require.main === module) {
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1','::1','localhost'].includes(host) && !process.env.ADMIN_PASSWORD) throw new Error('对外监听前请设置 ADMIN_PASSWORD');
  createApp({ seedCatalogs:true }).listen(Number(process.env.PORT || 5173), host, () => console.log(`Story house: http://${host}:${process.env.PORT || 5173} · Admin: /admin`));
}
module.exports = { createApp };
