const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {once}=require('node:events');
const {DatabaseSync}=require('node:sqlite');
const {openDatabase}=require('../database');
const {importCatalog}=require('../import-catalog');
const {createApp}=require('../server');
const {matchEpisode}=require('../matching');

test('文件名匹配不使用目录序号，重名或缺集要求人工选择',()=>{
 const episodes=[{id:'a',title:'第1集：谜案'},{id:'b',title:'科学揭秘：飞机'},{id:'c',title:'第2集：追踪'}];
 assert.equal(matchEpisode('02-测试.wav',episodes).id,null);
 assert.equal(matchEpisode('科学揭秘：飞机.mp3',episodes).id,'b');
 assert.equal(matchEpisode('03-无对应.wav',episodes).id,null);
 assert.equal(matchEpisode('03-追踪.wav',[...episodes,{id:'d',title:'第3集：另一案'}]).id,'c');
 assert.equal(matchEpisode('01.wav',[...episodes,{id:'d',title:'第1集：另一个版本'}]).id,null);
});
test('旧数据库迁移保留分集、录音、收藏和收听进度',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ks-migration-'));let db;
 try{
  const legacy=new DatabaseSync(path.join(dir,'stories.sqlite'));
  legacy.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE categories(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,sort_order INTEGER DEFAULT 0);
  CREATE TABLE media(id TEXT PRIMARY KEY,filename TEXT NOT NULL,mime TEXT NOT NULL,kind TEXT NOT NULL,size INTEGER NOT NULL);
  CREATE TABLE stories(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT DEFAULT '',category_id TEXT REFERENCES categories(id),cover_id TEXT REFERENCES media(id),published INTEGER DEFAULT 0,created_at INTEGER NOT NULL);
  CREATE TABLE episodes(id TEXT PRIMARY KEY,story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,title TEXT NOT NULL,media_id TEXT NOT NULL REFERENCES media(id),sort_order INTEGER NOT NULL,duration REAL NOT NULL DEFAULT 0);
  CREATE TABLE progress(episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,position REAL,duration REAL,completed INTEGER,updated_at INTEGER);
  CREATE TABLE favorites(story_id TEXT PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE);
  INSERT INTO media VALUES('m','old.wav','audio/wav','audio',100);
  INSERT INTO stories(id,title,created_at) VALUES('s','旧故事',1);
  INSERT INTO episodes VALUES('e','s','旧分集','m',1,30);
  INSERT INTO progress VALUES('e',12,30,0,1); INSERT INTO favorites VALUES('s');`);legacy.close();
  db=openDatabase(dir);assert.equal(db.prepare('SELECT media_id FROM episodes').get().media_id,'m');assert.equal(db.prepare('SELECT position FROM progress').get().position,12);assert.equal(db.prepare('SELECT story_id FROM favorites').get().story_id,'s');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  db.prepare('INSERT INTO episodes(id,story_id,title,sort_order) VALUES(?,?,?,?)').run('pending','s','待录音',2);
 }finally{db?.close();fs.rmSync(dir,{recursive:true,force:true})}
});
test('目录导入、封面访问、指定分集绑定与重导入保留录音',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ks-catalog-')),sourceDir=path.join(dir,'source');fs.mkdirSync(sourceDir);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJgAAAABJRU5ErkJggg==','base64');fs.writeFileSync(path.join(sourceDir,'cover.png'),png);
 const fixture={album_id:'123',series:'口袋神探',season:1,title:'测试季',source_url:'https://kids.kaishustory.com/h5/ks-detailPage/story?albumId=123',cover_file:'cover.png',complete:true,expected_count:3,entries:[1,2,3].map(n=>({id:'cat'+n,title:'第'+n+'集：测试',subtitle:'案情',duration:'00:02',cover_file:'cover.png'}))};const file=path.join(sourceDir,'catalog.json');fs.writeFileSync(file,JSON.stringify(fixture));
 let db=openDatabase(dir);const result=importCatalog(db,dir,file);const ids=db.prepare('SELECT id FROM episodes ORDER BY sort_order').all().map(x=>x.id);db.close();let server=createApp({dataDir:dir,password:'test-secret'});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;let cookie='';
 async function call(url,method='GET',body,status=200){const r=await fetch(base+url,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(r.status,status,url);return r.json()}
 try{
  let cat=await call('/api/catalog');assert.equal(cat.stories[0].episodes.length,3);assert.equal(cat.stories[0].episodes[0].audio_url,null);assert.equal((await fetch(base+cat.stories[0].episodes[0].cover_url)).status,200);
  await call('/api/progress','PUT',{episode_id:ids[0],position:1,duration:2},404);
  const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-secret'})});cookie=login.headers.get('set-cookie').split(';')[0];
  const wav=Buffer.alloc(32044);wav.write('RIFF');wav.writeUInt32LE(32036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
  const upload=await fetch(base+'/api/admin/upload?kind=audio',{method:'POST',headers:{cookie},body:wav});const media=await upload.json();assert.equal(upload.status,201);
  await call('/api/admin/episodes/'+ids[1],'PUT',{media_id:media.id,duration:2,expected_media_id:null});
  cat=await call('/api/catalog');assert.equal(cat.stories[0].episodes.length,3);assert.equal(cat.stories[0].episodes[1].title,'第2集：测试');assert.equal(cat.stories[0].episodes[1].has_audio,true);assert.ok(cat.stories[0].episodes[1].cover_url);
  await call('/api/admin/episodes/'+ids[1],'PUT',{media_id:media.id,expected_media_id:null},409);
  await call('/api/progress','PUT',{episode_id:ids[1],position:1,duration:2});
  await new Promise(resolve=>server.close(resolve));db=openDatabase(dir);importCatalog(db,dir,file);assert.equal(db.prepare('SELECT COUNT(*) n FROM episodes').get().n,3);assert.equal(db.prepare('SELECT media_id FROM episodes WHERE id=?').get(ids[1]).media_id,media.id);assert.equal(db.prepare('SELECT position FROM progress').get().position,1);assert.equal(db.prepare('SELECT id FROM stories').get().id,result.story_id);db.close();db=null;
 }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));db?.close();fs.rmSync(dir,{recursive:true,force:true})}
});
