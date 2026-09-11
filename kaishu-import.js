const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { importCatalog } = require('./import-catalog');

const API = 'https://sapi.kaishustory.com';
const IMAGE_HOSTS = new Set(['cdn.kaishuhezi.com', 'rsmedia.kaishustory.com', 'static.kaishustory.com', 'tcdn.kaishustory.com']);
function inputError(message) { return Object.assign(new Error(message), { status:400 }); }
function parseAlbumLink(value) {
  let url;
  try { if (typeof value !== 'string' || value.length > 8192) throw 0; url = new URL(value.trim()); } catch { throw inputError('请粘贴完整的凯叔专辑分享链接'); }
  if (url.protocol !== 'https:' || url.hostname !== 'kids.kaishustory.com' || url.port || url.username || url.password || !/^\/h5\/ks-detailPage\/(story|audio|book|video)\/?$/.test(url.pathname)) throw inputError('仅支持 kids.kaishustory.com 的专辑分享链接');
  const ids = url.searchParams.getAll('albumId');
  if (ids.length !== 1 || !/^[1-9]\d{0,15}$/.test(ids[0]) || !Number.isSafeInteger(Number(ids[0]))) throw inputError('链接缺少有效的 albumId');
  return { albumId:ids[0], sourceUrl:`https://kids.kaishustory.com${url.pathname}?albumId=${ids[0]}` };
}
function imageUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('官方目录缺少有效封面地址'); }
  if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname) || url.port || url.username || url.password) throw new Error('封面地址不属于已支持的官方图片服务器');
  return url.href;
}
// Each request is fixed to the official API/CDNs; redirects cannot reach other hosts.
async function readRemote(url, { fetchImpl = fetch, signal, max = 8 * 1024 * 1024 } = {}) {
  const requestSignal = AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(30000)]);
  let response;
  try { response = await fetchImpl(url, { signal:requestSignal, redirect:'error', headers:{ Accept:'application/json,image/webp,image/*', Referer:'https://kids.kaishustory.com/' } }); }
  catch { throw new Error('连接官方服务器失败或超时，请稍后重试'); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`官方服务器返回 HTTP ${response.status}，请稍后重试`); }
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('官方文件超过导入大小限制'); }
  let size = 0; const chunks = [];
  try {
    for await (const chunk of response.body) { size += chunk.length; if (size > max) throw new Error('官方文件超过导入大小限制'); chunks.push(chunk); }
  } catch (e) { if (requestSignal.aborted) throw new Error('下载超时或任务已停止，请重试'); throw e; }
  return Buffer.concat(chunks);
}
async function apiData(endpoint, albumId, options) {
  const bytes = await readRemote(`${API}${endpoint}?albumId=${albumId}`, options);
  let result; try { result = JSON.parse(bytes); } catch { throw new Error('官方接口响应格式已变化，无法导入'); }
  if (result.code !== 0 || !result.data) throw new Error(result.code === 10003003 ? '此专辑的官方资料需要登录，当前无法通过公开链接导入' : '官方暂未提供此专辑资料，请检查链接或稍后重试');
  return result.data;
}
function normalizeCatalog(info, list, parsed) {
  if (String(info.albumId) !== parsed.albumId || typeof info.albumName !== 'string' || !info.albumName.trim()) throw new Error('官方专辑名称或编号无效');
  let media;
  if (list.showType === 1 && Array.isArray(list.moduleList)) {
    media = list.moduleList.flatMap(group => {
      // Group badges can be stale (album 262 reports 71 for a 70-entry group).
      // The album-wide count and unique IDs below remain mandatory.
      if (!Array.isArray(group.mediaList)) throw new Error('官方分组目录结构不完整，未写入数据库');
      return group.mediaList.map(m => ({...m, groupName:String(group.moduleName || '未命名分组')}));
    });
  } else if (list.showType === 2 && Array.isArray(list.mediaList)) media = list.mediaList;
  else throw new Error('暂不支持此专辑的目录结构');
  const count = info.storyCount > 0 ? info.storyCount : info.preStoryCount;
  if (!Number.isInteger(count) || count < 1 || media.length !== count || count > 2000) throw new Error(`官方目录数量未通过校验（获取 ${media.length} 集，预计 ${count ?? '未知'} 集），未写入数据库`);
  const seen = new Set();
  const entries = media.map((m, i) => {
    const id = String(m.mediaId), seconds = m.duration;
    if (!/^[1-9]\d*$/.test(id) || seen.has(id) || typeof m.mediaName !== 'string' || !m.mediaName.trim() || !Number.isFinite(seconds) || seconds < 0 || seconds > 1e7) throw new Error('官方分集编号、名称或时长不完整');
    seen.add(id);
    const filters = (list.albumFilterList || []).filter(f => (m.filterIdList || []).includes(f.filterId)).map(f => f.filterName).join(' ');
    return { group:m.groupName || '全部分集', labels:filters, id:'cat'+id, order:i+1, title:m.mediaName.trim(), subtitle:String(m.subhand || ''), duration:`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`, cover:imageUrl(m.cover), kind:/科学|揭秘/.test(filters+' '+m.subhand) ? '科学揭秘' : /^第\s*\d+集/.test(m.mediaName) ? '故事' : '番外' };
  });
  const seasonMatch = /^(.*?)\s*第\s*(\d+)\s*季/.exec(info.albumName);
  return { album_id:parsed.albumId, source_url:parsed.sourceUrl, title:info.albumName.trim(), description:String(info.subhead || info.albumDescribe || '').slice(0,3000), series:seasonMatch ? seasonMatch[1].trim() : info.albumName.trim(), season:seasonMatch ? Number(seasonMatch[2]) : null, captured_at:new Date().toISOString(), complete:true, expected_count:count, cover:imageUrl(info.iconUrl || info.coverUrl), entries };
}
async function fetchCatalog(parsed, options = {}) {
  const results = await Promise.allSettled([
    apiData('/rs_content/ajax/album/get_info', parsed.albumId, options),
    apiData('/v2/content/album/media-list', parsed.albumId, options)
  ]);
  for (const r of results) if (r.status === 'rejected') throw r.reason;
  return normalizeCatalog(results[0].value, results[1].value, parsed);
}
async function downloadCatalog(parsed, directory, options = {}, progress = () => {}) {
  const catalog = options.catalog ? structuredClone(options.catalog) : await fetchCatalog(parsed, options);
  const urls = [...new Set([catalog.cover, ...catalog.entries.map(e => e.cover)])];
  const files = new Map(); let cursor = 0, done = 0, totalBytes = 0;
  progress({ stage:'images', title:catalog.title, episodes:catalog.entries.length, done, total:urls.length, message:'正在下载专辑和分集封面' });
  const cancellation = new AbortController();
  const signal = AbortSignal.any([options.signal || new AbortController().signal, cancellation.signal]);
  const workers = await Promise.allSettled(Array.from({ length:3 }, async () => {
    try {
      while (cursor < urls.length) {
        signal.throwIfAborted(); const index = cursor++, url = urls[index];
        const bytes = await readRemote(url, { ...options, signal });
        totalBytes += bytes.length;
        if (totalBytes > 250 * 1024 * 1024) throw new Error('专辑图片总大小超过 250 MB，未导入');
        const file = `image-${index}.bin`; await fs.writeFile(path.join(directory, file), bytes); files.set(url, file);
        progress({ done:++done });
      }
    } catch (e) { cancellation.abort(); throw e; }
  }));
  const failed = workers.find(r => r.status === 'rejected' && r.reason.name !== 'AbortError');
  if (failed) throw failed.reason;
  signal.throwIfAborted();
  catalog.cover_file = files.get(catalog.cover);
  for (const entry of catalog.entries) entry.cover_file = files.get(entry.cover);
  const file = path.join(directory, 'catalog.json'); await fs.writeFile(file, JSON.stringify(catalog)); return file;
}
function createImportManager(db, dataDir, { fetchImpl = fetch } = {}) {
  let job = null, controller, pending = null;
  const current = () => job ? structuredClone(job) : null;
  function execute(parsed, categoryId, selectedCatalog, previewOnly) {
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15*60*1000)]);
    const active = job;
    (async () => {
      let directory;
      try {
        const source = selectedCatalog || await fetchCatalog(parsed, { fetchImpl, signal });
        signal.throwIfAborted();
        if (previewOnly) {
          pending = { source, parsed, categoryId };
          const existing = new Set(db.prepare('SELECT e.source_id FROM episodes e JOIN stories s ON s.id=e.story_id WHERE s.source_album_id=?').all(source.album_id).map(e=>e.source_id));
          Object.assign(active, { status:'preview', stage:'preview', title:source.title, message:'目录已获取，请勾选需要导入的内容', episodes:source.entries.length,
            entries:source.entries.map(({id,title,subtitle,duration,kind,group,labels})=>({id,title,subtitle,duration,kind,group,labels,exists:existing.has(id)})) });
          return;
        }
        directory = await fs.mkdtemp(path.join(dataDir, 'kaishu-import-'));
        const file = await downloadCatalog(parsed, directory, { fetchImpl, signal, catalog:source }, values => Object.assign(active, values));
        signal.throwIfAborted();
        Object.assign(active, { stage:'database', message:'正在校验图片并写入本地数据库' });
        const result = importCatalog(db, dataDir, file, { categoryId });
        Object.assign(active, { status:'complete', stage:'complete', message:'所选内容导入完成，可以上传对应录音', result });
      } catch (e) {
        Object.assign(active, { status:'failed', stage:'failed', message:signal.aborted ? '任务已停止或超过 15 分钟，请重新获取目录' : e.message });
      } finally {
        if (active.status !== 'preview') active.finished_at = new Date().toISOString();
        if (directory) await fs.rm(directory, { recursive:true, force:true }).catch(() => {});
      }
    })();
  }
  return {
    current,
    stop:() => controller?.abort(),
    start(value, categoryId, {previewOnly=false} = {}) {
      const parsed = parseAlbumLink(value);
      if (job?.status === 'running') throw Object.assign(new Error('已有专辑正在导入，请等待完成'), { status:409 });
      if (categoryId && !db.prepare('SELECT id FROM categories WHERE id=?').get(categoryId)) throw inputError('所选分类不存在');
      pending = null;
      job = { id:crypto.randomUUID(), album_id:parsed.albumId, status:'running', stage:'metadata', message:'正在获取完整目录', done:0, total:0, started_at:new Date().toISOString() };
      execute(parsed, categoryId, null, previewOnly);
      return current();
    },
    confirm(id, ids) {
      if (job?.id !== id || job.status !== 'preview' || !pending) throw Object.assign(new Error('预览已失效或已提交，请重新获取目录'), { status:409 });
      if (!Array.isArray(ids) || !ids.length || ids.length > 2000 || ids.some(id=>typeof id !== 'string') || new Set(ids).size !== ids.length) throw inputError('请至少选择一个分集，且不要重复选择');
      const selected = new Set(ids);
      const entries = pending.source.entries.filter(e=>selected.has(e.id));
      if (entries.length !== ids.length) throw inputError('所选分集不属于当前预览目录');
      const {source,parsed,categoryId} = pending;
      // Only the already verified complete snapshot may be reduced by selection.
      const selection = {...source, source_count:source.entries.length, expected_count:entries.length, entries};
      pending = null;
      delete job.entries;
      Object.assign(job, { status:'running', stage:'images', message:'正在下载所选内容的封面', episodes:entries.length });
      execute(parsed, categoryId, selection, false);
      return current();
    }
  };
}
module.exports = { parseAlbumLink, imageUrl, normalizeCatalog, readRemote, downloadCatalog, createImportManager };
