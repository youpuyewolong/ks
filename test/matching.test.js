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
test('小数排序不回退到主线集数，重名与标题冲突不自动绑定',()=>{
  assert.equal(matchEpisode('04.1 完全未知的科学揭秘.mp3',entries).id,null);
  assert.equal(matchEpisode('13.2未知番外.mp3',entries).id,null);
  assert.equal(matchEpisode('13.2.mp3',entries).id,null);
  const sample=[{id:'a',title:'第1集：谜案'},{id:'b',title:'第2集：追踪'}];
  assert.equal(matchEpisode('03 第1集：谜案.mp3',sample).id,'a');
  assert.equal(matchEpisode('第1集：追踪.mp3',sample).id,null);
  assert.equal(matchEpisode('01 追踪.mp3',sample).id,null);
  assert.equal(matchEpisode('00 主题曲.mp3',[{id:'a',title:'歌1',subtitle:'主题曲'},{id:'b',title:'歌2',subtitle:'主题曲'}]).id,null);
  assert.equal(matchEpisode('01.1 同名.mp3',[{id:'a',title:'同名'},{id:'b',title:'同名'}]).id,null);
});
