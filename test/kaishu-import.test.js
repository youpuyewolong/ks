const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { openDatabase } = require('../database');
const { createApp } = require('../server');
const { parseAlbumLink, imageUrl, normalizeCatalog, readRemote, createImportManager } = require('../kaishu-import');
const link = 'https://kids.kaishustory.com/h5/ks-detailPage/story?albumId=123&token=secret';
const cover = 'https://cdn.kaishuhezi.com/example.jpg';
const info = { albumId:123, albumName:'神奇图书馆 第2季', preStoryCount:2, iconUrl:cover, subhead:'探索科学' };
const media = [1,2].map(n => ({ mediaId:n, mediaName:`第${n}集：冒险`, subhand:'奇妙发现', cover, duration:65 }));
const list = { showType:1, moduleList:media.map(m=>({ mediaCount:1, mediaList:[m] })) };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJgAAAABJRU5ErkJggg==','base64');
function fakeFetch({ badImage=false, denied=false } = {}) {
  return async url => {
    if (url.startsWith('https://cdn.kaishuhezi.com/')) return new Response(badImage ? 'invalid image' : png);
    return Response.json(denied ? { code:10003003, data:null } : { code:0, data:url.includes('get_info') ? info : list });
  };
}
async function finish(manager) {
  for (let i=0; i<200; i++) { if (manager.current().status !== 'running') return manager.current(); await new Promise(r=>setTimeout(r,10)); }
  throw new Error('job timeout');
}
test('只接受官方专辑链接和图片域名，过滤分享凭证并阻止跳转和超大响应', async () => {
  assert.equal(parseAlbumLink(link).sourceUrl.includes('secret'), false);
  for (const bad of ['http://127.0.0.1/?albumId=1', 'https://kids.kaishustory.com.evil.org/h5/ks-detailPage/story?albumId=1', 'https://kids.kaishustory.com/h5/ks-detailPage/story?albumId=1&albumId=2', 'https://a@kids.kaishustory.com/h5/ks-detailPage/story?albumId=1']) assert.throws(()=>parseAlbumLink(bad));
  for (const bad of ['http://127.0.0.1/x', 'https://cdn.kaishuhezi.com.evil.org/x', 'https://cdn.kaishuhezi.com:123/x']) assert.throws(()=>imageUrl(bad));
  await assert.rejects(readRemote(cover, { fetchImpl:async (url, options)=>{ assert.equal(options.redirect,'error'); throw new Error('redirect'); } }), /连接/);
  await assert.rejects(readRemote(cover, { max:2, fetchImpl:async()=>new Response('1234') }), /大小限制/);
});
test('展开全部分组，拒绝缺集、重复编号及未知结构', () => {
  const parsed = parseAlbumLink(link), catalog = normalizeCatalog(info,list,parsed);
  assert.equal(catalog.entries.length,2); assert.equal(catalog.entries[1].id,'cat2'); assert.equal(catalog.season,2); assert.equal(catalog.series,'神奇图书馆');
  assert.throws(()=>normalizeCatalog(info,{...list,moduleList:[list.moduleList[0]]},parsed),/数量/);
  assert.throws(()=>normalizeCatalog(info,{showType:2,mediaList:[media[0],media[0]]},parsed),/编号/);
  assert.throws(()=>normalizeCatalog(info,{showType:9},parsed),/结构/);
  assert.throws(()=>normalizeCatalog(info,{...list,moduleList:[{mediaCount:2,mediaList:[media[0]]}]},parsed),/数量/);
  assert.throws(()=>normalizeCatalog(info,{...list,moduleList:[{mediaCount:2}]},parsed),/分组/);
});
test('分组标注数量过时，但全专辑数量及唯一编号完整时允许导入',()=>{
  const parsed=parseAlbumLink(link);
  const stale={showType:1,moduleList:[{mediaCount:2,mediaList:[media[0]]},{mediaCount:1,mediaList:[media[1]]}]};
  assert.equal(normalizeCatalog(info,stale,parsed).entries.length,2);
  assert.throws(()=>normalizeCatalog({...info,preStoryCount:3},stale,parsed),/数量/);
  assert.throws(()=>normalizeCatalog(info,{showType:1,moduleList:[{mediaCount:2,mediaList:[media[0],media[0]]}]},parsed),/编号/);
});
test('导入任务下载去重图片；重复导入保留录音、进度及编辑；失败不留下半成品', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ks-link-')), db=openDatabase(dir);
  try {
    const manager=createImportManager(db,dir,{fetchImpl:fakeFetch()});
    const job=manager.start(link); assert.equal(JSON.stringify(job).includes('secret'),false);
    assert.throws(()=>manager.start(link),/正在导入/);
    let end=await finish(manager); assert.equal(end.status,'complete',end.message); assert.equal(end.result.entries,2);
    assert.equal(db.prepare('SELECT count(*) n FROM media').get().n,1);
    assert.equal(db.prepare('SELECT name FROM categories').get().name,'链接导入');
    const episode=db.prepare('SELECT * FROM episodes ORDER BY sort_order').get();
    db.prepare('INSERT INTO media VALUES(?,?,?,?,?)').run('audio','own.wav','audio/wav','audio',100);
    db.prepare('UPDATE episodes SET media_id=?,title=?,duration=? WHERE id=?').run('audio','我编辑的名称',99,episode.id);
    db.prepare('INSERT INTO progress VALUES(?,?,?,?,?)').run(episode.id,33,99,0,Date.now());
    manager.start(link); end=await finish(manager); assert.equal(end.status,'complete');
    assert.equal(db.prepare('SELECT count(*) n FROM episodes').get().n,2);
    const saved=db.prepare('SELECT * FROM episodes WHERE id=?').get(episode.id); assert.equal(saved.title,'我编辑的名称'); assert.equal(saved.media_id,'audio'); assert.equal(saved.duration,99);
    assert.equal(db.prepare('SELECT position FROM progress').get().position,33);
    const broken=createImportManager(db,dir,{fetchImpl:fakeFetch({badImage:true})}); broken.start(link); assert.equal((await finish(broken)).status,'failed');
    assert.equal(db.prepare('SELECT count(*) n FROM episodes').get().n,2);
    const denied=createImportManager(db,dir,{fetchImpl:fakeFetch({denied:true})}); denied.start(link); assert.match((await finish(denied)).message,/需要登录/);
    assert.equal(db.prepare('SELECT count(*) n FROM media').get().n,2);
  } finally { db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});
test('后台导入接口要求登录，启动任务、查询结果及本地图片可用', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ks-import-http-'));
  const server=createApp({dataDir:dir,password:'secret',importFetch:fakeFetch()}); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  try {
    assert.equal((await fetch(base+'/api/admin/kaishu-import')).status,401);
    assert.equal((await fetch(base+'/api/admin/kaishu-import',{method:'POST',body:JSON.stringify({url:link})})).status,401);
    const login=await fetch(base+'/api/admin/login',{method:'POST',body:JSON.stringify({password:'secret'})}); const cookie=login.headers.get('set-cookie').split(';')[0];
    const start=await fetch(base+'/api/admin/kaishu-import',{method:'POST',headers:{cookie},body:JSON.stringify({url:link})}); assert.equal(start.status,202);
    let job;
    for (let i=0;i<100;i++) { job=(await(await fetch(base+'/api/admin/kaishu-import',{headers:{cookie}})).json()).job; if(job.status!=='running')break; await new Promise(r=>setTimeout(r,10)); }
    assert.equal(job.status,'complete',job.message);
    const cat=await(await fetch(base+'/api/catalog')).json(); assert.equal(cat.stories[0].episodes.length,2); assert.equal(cat.stories[0].episodes[0].audio_url,null);
    assert.equal((await fetch(base+cat.stories[0].cover_url)).status,200);
  } finally { await new Promise(r=>server.close(r)); fs.rmSync(dir,{recursive:true,force:true}); }
});
