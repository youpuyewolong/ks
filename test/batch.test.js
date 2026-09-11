const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events'),{openDatabase}=require('../database'),{createApp}=require('../server');
test('批量操作校验专辑和录音变更，删除保留共享媒体并清理进度',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ks-batch-'));let db=openDatabase(dir);
 db.exec("INSERT INTO stories(id,title,published,created_at) VALUES('s','专辑',1,1),('other','其他',1,1); INSERT INTO media VALUES('shared','shared.wav','audio/wav','audio',3),('alone','alone.wav','audio/wav','audio',3); INSERT INTO episodes(id,story_id,title,sort_order,media_id) VALUES('a','s','故事',1,'shared'),('b','s','番外',2,'alone'),('c','other','其他',1,'shared'); INSERT INTO progress VALUES('a',1,3,0,1),('b',1,3,0,1);");
 fs.writeFileSync(path.join(dir,'media','shared.wav'),'abc');fs.writeFileSync(path.join(dir,'media','alone.wav'),'abc');db.close();
 const server=createApp({dataDir:dir,password:'test'});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;let cookie='';
 const call=async(b,status=200)=>{const r=await fetch(base+'/api/admin/stories/s/episodes/batch',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify(b)});assert.equal(r.status,status,await r.text())};
 try{
  await call({action:'delete',episodes:[{id:'a',media_id:'shared'}]},401);
  const login=await fetch(base+'/api/admin/login',{method:'POST',body:JSON.stringify({password:'test'})});cookie=login.headers.get('set-cookie').split(';')[0];
  await call({action:'delete',episodes:[{id:'a',media_id:'shared'},{id:'c',media_id:'shared'}]},400);
  await call({action:'delete',episodes:[{id:'a',media_id:null}]},409);
  await call({action:'delete',episodes:[{id:'a',media_id:'shared'},{id:'a',media_id:'shared'}]},400);
  await call({action:'kind',kind:'番外',episodes:[{id:'a',media_id:'shared'}]});
  let cat=await(await fetch(base+'/api/catalog')).json();assert.equal(cat.stories.find(s=>s.id==='s').episodes.find(e=>e.id==='a').kind,'番外');assert.equal(cat.stories.find(s=>s.id==='s').episodes.length,2);
  await call({action:'delete',episodes:[{id:'a',media_id:'shared'},{id:'b',media_id:'alone'}]});
  assert.ok(fs.existsSync(path.join(dir,'media','shared.wav')));assert.equal(fs.existsSync(path.join(dir,'media','alone.wav')),false);
  cat=await(await fetch(base+'/api/catalog')).json();assert.equal(cat.stories.some(s=>s.id==='s'),false);assert.equal(cat.stories[0].episodes[0].id,'c');
  await new Promise(r=>server.close(r));db=openDatabase(dir);assert.equal(db.prepare('SELECT count(*) n FROM progress').get().n,0);assert.equal(db.prepare("SELECT published FROM stories WHERE id='s'").get().published,0);db.close();
 }finally{if(server.listening)await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});
