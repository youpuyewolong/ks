const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {matchEpisode}=require('../matching');
const {entries}=require('../catalogs/kaishu/2307/catalog.json');

test('第六季用户提供的 130 个文件全部匹配到不同分集',()=>{
  const names=fs.readFileSync(path.join(__dirname,'season6-filenames.txt'),'utf8').trim().split(/\r?\n/);
  const results=names.map(n=>matchEpisode(n+'.mp3',entries));
  assert.equal(names.length,130);
  results.forEach((r,i)=>assert.ok(r.id,names[i]));
  assert.equal(new Set(results.map(r=>r.id)).size,130);
  const cases=[
    ['04.1 技术 ∣ 高科技的“魔术”？','技术 ∣ 高科技的“魔术”？'],
    ['13.1第13集：探秘！春日寻宝的奇遇','第13集：探秘！春日寻宝的奇遇'],
    ['13.2天文 ∣ 夜空里的“指北针”？','天文 ∣ 夜空里的“指北针”？'],
    ['15.2艺术 _ 魔术都有哪些种类？','艺术 ∣ 魔术都有哪些种类？'],
    ['30.1 特邀熊（红）包包？','特邀熊（红）包包？'],
    ['30.1 物理∣电脑为什么会变热？','物理 ∣ 电脑为什么会变热？'],
    ['00 主题曲','口袋神探'],
    ['09.1 动物  山羊也会爬树？','动物 ∣ 山羊也会爬树？']
  ];
  for(const [file,title] of cases)assert.equal(matchEpisode(file+'.mp3',entries).id,entries.find(e=>e.title===title).id,file);
});
test('忽略混乱集数，以名称匹配，重名不自动绑定',()=>{
  assert.equal(matchEpisode('04.1 完全未知的科学揭秘.mp3',entries).id,null);
  assert.equal(matchEpisode('13.2未知番外.mp3',entries).id,null);
  assert.equal(matchEpisode('13.2.mp3',entries).id,null);
  const sample=[{id:'a',title:'第1集：谜案'},{id:'b',title:'第2集：追踪'}];
  assert.equal(matchEpisode('03 第1集：谜案.mp3',sample).id,'a');
  assert.equal(matchEpisode('第1集：追踪.mp3',sample).id,'b');
  assert.equal(matchEpisode('01 追踪.mp3',sample).id,'b');
  assert.equal(matchEpisode('00 主题曲.mp3',[{id:'a',title:'歌1',subtitle:'主题曲'},{id:'b',title:'歌2',subtitle:'主题曲'}]).id,null);
  assert.equal(matchEpisode('01.1 同名.mp3',[{id:'a',title:'同名'},{id:'b',title:'同名'}]).id,null);
});
const {analyzeQueue,orderFiles}=require('../matching');
test('名称优先且重名保留具体候选',()=>{
  const episodes=[{id:'a',title:'第1集：谜案'},{id:'b',title:'第2集：追踪'}];
  assert.equal(matchEpisode('第1集：追踪.mp3',episodes).id,'b');
  assert.deepEqual(matchEpisode('01.1 同名.mp3',[{id:'x',title:'同名'},{id:'y',title:'同名'}]).candidates,['x','y']);
});
test('重复占用列出全部同伴，舍弃或改绑解除冲突，仅有效目标可重试',()=>{
  const episodes=[{id:'a'},{id:'b'}];
  const q=[{target:'a',status:'waiting'},{target:'a',status:'waiting'},{target:'a',status:'waiting'},{target:'',candidates:['a','b']},{target:'gone',status:'error'}];
  let s=analyzeQueue(q,episodes);
  assert.deepEqual(s[0].peers,[1,2]);assert.equal(s.filter(x=>x.ready).length,0);assert.equal(s[3].state,'ambiguous');assert.equal(s[4].state,'missing');
  q[1].status='discarded';q[2].target='b';s=analyzeQueue(q,episodes);
  assert.equal(s[0].ready,true);assert.equal(s[1].ready,false);assert.equal(s[2].ready,true);
  q[0].status='done';q[2].status='error';s=analyzeQueue(q,episodes);
  assert.equal(s[0].ready,false);assert.equal(s[2].ready,true);
});
test('文件优先跟随目录与候选位置，剩余文件自然排序',()=>{
  const episodes=[{id:'b',title:'第2集'},{id:'a',title:'第1集'}];
  const q=[{target:'a',file:{name:'01.mp3'}},{candidates:['b'],file:{name:'候选.mp3'}},{file:{name:'未知10.mp3'}},{file:{name:'未知2.mp3'}}];
  assert.deepEqual(orderFiles(q,episodes),[1,0,3,2]);
  assert.deepEqual(orderFiles(q,episodes,'added'),[0,1,2,3]);
  assert.deepEqual(orderFiles(q,episodes,'name').filter(i=>i>=2),[3,2]);
});
test('名称相似度70%边界，忽略编号但保留标题内数字，多个模糊候选不自动绑定',()=>{
 const sample=[{id:'a',title:'第99集：abcdefghij'}];
 assert.equal(matchEpisode('03 第1集：abcdefgxyz.mp3',sample).id,'a');
 assert.equal(matchEpisode('03 第1集：abcdefwxyz.mp3',sample).id,null);
 assert.equal(matchEpisode('第99集.mp3',sample).id,null);
 const two=[...sample,{id:'b',title:'第2集：abcdefgxxx'}];
 assert.deepEqual(matchEpisode('abcdefgxyz.mp3',two).candidates,['b','a']);
 assert.equal(matchEpisode('08 abcdefghij.mp3',two).id,'a');
 assert.equal(require('../matching').titleKey('13.2 第六集：寻找100个朋友.mp3'),'寻找100个朋友');
});
