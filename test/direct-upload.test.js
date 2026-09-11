const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(hasAudio=false,confirm=true){
 const calls=[],messages=[],nodes=new Map(),episodes=[{id:'a',title:'目标分集',kind:'故事',has_audio:hasAudio},{id:'b',title:'其他分集',kind:'故事'}];
 const ctx=vm.createContext({editing:'s',uploading:false,coverUploading:false,batchBusy:false,queue:[{file:{name:'原匹配.wav'},target:'a',status:'waiting'},{file:{name:'其他.wav'},target:'b',status:'waiting'}],$:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)},currentStory:()=>({episodes}),uploadKind:()=>'',queueRender(){},queueStates(){throw Error('单集直传不得使用批量队列')},StoryMatching:require('../matching'),toast:m=>messages.push(m),confirmDelete:async()=>confirm,upload:async file=>{calls.push(file.name);return {id:'media'}},durationOf:async()=>10,api:async(path,method,data)=>{calls.push({path,method,data})},refresh:async()=>{},renderEpisodes(){}});
 const src=fs.readFileSync('admin.js','utf8');vm.runInContext(src.slice(src.indexOf('async function runQueue('),src.indexOf('async function addFiles(')),ctx);
 return {ctx,calls,messages,run:s=>vm.runInContext(s,ctx)};
}
test('直传任意文件名只上传指定分集，不上传其他队列，原占用文件暂不上传',async()=>{
 const x=setup();await x.run("uploadDirect([{name:'任意名字.mp3',size:10,lastModified:1}],'a')");
 assert.equal(x.calls[0],'任意名字.mp3');assert.equal(x.calls[1].path,'/api/admin/episodes/a');assert.equal(x.calls.length,2);
 assert.equal(x.run('queue[0].status'),'discarded');assert.equal(x.run('queue[1].status'),'waiting');assert.equal(x.run('queue[2].status'),'done');
});
test('多文件、无效文件、上传忙时拒绝直传；已有录音取消确认后不上传',async()=>{
 const x=setup(true,false);await x.run("uploadDirect([{name:'test.mp3',size:10}],'a')");assert.equal(x.calls.length,0);
 await x.run("uploadDirect([{name:'1.mp3',size:10},{name:'2.mp3',size:10}],'a')");assert.match(x.messages.at(-1),/一次/);
 await x.run("uploadDirect([{name:'folder',size:0}],'a')");assert.match(x.messages.at(-1),/有效/);
 await x.run("uploading=true;uploadDirect([{name:'1.mp3',size:10}],'a')");assert.match(x.messages.at(-1),/等待/);assert.equal(x.calls.length,0);
});
