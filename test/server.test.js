const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createApp } = require('../server');
function wav(seconds=2){const size=8000*2*seconds,b=Buffer.alloc(44+size);b.write('RIFF');b.writeUInt32LE(36+size,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size,40);return b;}
test('专辑管理、上传、上架、排序、音频范围读取与数据库持久化',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'little-ear-test-'));let server=createApp({dataDir,password:'test-only-secret'}),base,cookie='';
 async function start(){server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port}
 async function request(route,method='GET',body,auth=true,expected=200){const r=await fetch(base+route,{method,headers:{...(auth&&cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});assert.equal(r.status,expected,route+' '+await (r.status!==expected?r.text():Promise.resolve('')));return r}
 async function call(route,method,body,auth=true,expected=200){return (await request(route,method,body,auth,expected)).json()}
 async function upload(buffer,kind='audio',expected=201){const r=await fetch(base+'/api/admin/upload?kind='+kind,{method:'POST',headers:{cookie},body:buffer});assert.equal(r.status,expected);return r.json()}
 try{await start();await request('/api/admin/catalog','GET',undefined,false,401);const login=await request('/api/admin/login','POST',{password:'test-only-secret'});cookie=login.headers.get('set-cookie').split(';')[0];
 const category=await call('/api/admin/categories','POST',{name:'测试分类',sort_order:5},true,201);
 await request('/api/admin/categories','POST',{name:'测试分类'},true,409);
 const story=await call('/api/admin/stories','POST',{title:'多集故事',category_id:category.id},true,201);
 const edit={title:'多集故事',description:'测试简介',category_id:category.id,published:true};
 await request('/api/admin/stories/'+story.id,'PUT',edit,true,400);
 assert.equal((await call('/api/catalog')).stories.length,0);
 await upload(Buffer.from('<html>not audio at all</html>'),'audio',415);
 await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),'image',415);
 const media=await upload(wav(2));
 await request('/media/'+media.id,'GET',undefined,false,404);
 const one=await call('/api/admin/stories/'+story.id+'/episodes','POST',{title:'第一集',media_id:media.id,duration:2},true,201);
 const two=await call('/api/admin/stories/'+story.id+'/episodes','POST',{title:'第二集',media_id:media.id,duration:2},true,201);
 await request('/api/admin/stories/'+story.id,'PUT',edit);
 const pub=(await call('/api/catalog','GET',undefined,false)).stories[0];assert.equal(pub.episodes.length,2);
 const r=await fetch(base+'/media/'+media.id,{headers:{Range:'bytes=0-43'}});assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,44);assert.equal(r.headers.get('content-range'),'bytes 0-43/32044');
 const suffix=await fetch(base+'/media/'+media.id,{headers:{Range:'bytes=-10'}});assert.equal(suffix.status,206);assert.equal((await suffix.arrayBuffer()).byteLength,10);
 assert.equal((await fetch(base+'/media/'+media.id,{headers:{Range:'bytes=9999999-'}})).status,416);
 assert.equal((await fetch(base+'/media/'+media.id,{method:'HEAD'})).headers.get('content-length'),'32044');
 await call('/api/admin/stories/'+story.id+'/order','PUT',{ids:[two.id,one.id]});
 assert.equal((await call('/api/catalog')).stories[0].episodes[0].id,two.id);
 await request('/api/admin/stories/'+story.id+'/order','PUT',{ids:[one.id,one.id]},true,400);
 const now=Date.now();await call('/api/progress','PUT',{episode_id:one.id,position:1,duration:2,updated_at:now},false);
 await call('/api/progress','PUT',{episode_id:one.id,position:0,duration:2,updated_at:now-100},false);
 assert.equal((await call('/api/listening')).progress[0].position,1);
 await request('/api/progress','PUT',{episode_id:one.id,position:-1,duration:2},false,400);
 await call('/api/favorites/'+story.id,'PUT',undefined,false);
 assert.deepEqual((await call('/api/listening')).favorites,[story.id]);
 assert.equal((await fetch(base+'/api/progress',{method:'PUT',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
 for(const route of ['/server.js','/data/stories.sqlite','/package.json','/../server.js'])await request(route,'GET',undefined,false,404);
 await request('/api/admin/categories/'+category.id,'DELETE',undefined,true,409);
 await new Promise(resolve=>server.close(resolve));server=createApp({dataDir,password:'test-only-secret'});await start();
 assert.equal((await call('/api/listening','GET',undefined,false)).progress[0].position,1);
 assert.equal((await call('/api/catalog','GET',undefined,false)).stories[0].episodes.length,2);
 await request('/api/admin/catalog','GET',undefined,true,401);
 const relogin=await request('/api/admin/login','POST',{password:'test-only-secret'});cookie=relogininCookie(relogin);
 await call('/api/admin/stories/'+story.id,'PUT',{...edit,published:false});
 assert.equal((await call('/api/catalog')).stories.length,0);assert.equal((await call('/api/listening')).progress.length,0);
 await request('/media/'+media.id,'GET',undefined,false,404);
 await call('/api/admin/stories/'+story.id,'DELETE');await call('/api/admin/categories/'+category.id,'DELETE');
 assert.equal(fs.readdirSync(path.join(dataDir,'media')).length,0);
 }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));fs.rmSync(dataDir,{recursive:true,force:true})}
});
function relogininCookie(response){return response.headers.get('set-cookie').split(';')[0]}
module.exports={wav};
