const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function setup(){
 const nodes=new Map(),events={};const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',paused:true,innerHTML:'',setAttribute(){},classList:{toggle(){}},addEventListener(name,fn){events[name]=fn},pause(){this.paused=true},play(){this.paused=false;return Promise.resolve()}});return nodes.get(id)};
 const context=vm.createContext({$:node,art:()=>'',cover:()=>'',esc:x=>String(x),format:()=>'',localStorage:{getItem(){return null},setItem(){}},document:{querySelectorAll:()=>[],addEventListener(){},body:{classList:{add(){},remove(){}}}},window:{addEventListener(){},scrollTo(){}},api:()=>new Promise(()=>{}),guarded:f=>f,toast(){},setTimeout,clearTimeout,fetch:async()=>({ok:true})});
 vm.runInContext(fs.readFileSync('app.js','utf8'),context);
 vm.runInContext(`catalog.stories=[{id:'s',episodes:[{id:'a',kind:'故事',has_audio:true},{id:'x',kind:'番外',has_audio:true},{id:'m',kind:'故事',has_audio:false},{id:'b',kind:'故事',has_audio:true},{id:'z',kind:'讲解',has_audio:false}]},{id:'other',episodes:[{id:'o',kind:'番外',has_audio:true}]}];detailId='s';`,context);
 return {run:s=>vm.runInContext(s,context),nodes,events};
}
test('筛选同步列表和播放队列，跨过番外与缺录音，按专辑保留选择',()=>{
 const {run,nodes}=setup();run("selectKind('故事')");assert.equal(run("playable(catalog.stories[0]).map(e=>e.id).join(',')"),'a,b');assert.equal(run("filteredEpisodes(catalog.stories[0]).length"),3);
 assert.match(nodes.get('#detail-episodes').innerHTML,/data-play="m"/);assert.doesNotMatch(nodes.get('#detail-episodes').innerHTML,/data-play="x"/);
 assert.match(nodes.get('#detail-filters').innerHTML,/讲解/);
 run("openStory('other');openStory('s')");assert.equal(run('detailKind'),'故事');
 run("selectKind('讲解')");assert.equal(nodes.get('#detail-resume').disabled,true);
 run("selectKind('')");assert.equal(run('playable(catalog.stories[0]).length'),3);
});
test('类型内续播及上下集，连播到所选类型末集停止',()=>{
 const {run,events}=setup();run("selectKind('故事');listening.progress=[{episode_id:'x',updated_at:10},{episode_id:'a',updated_at:5,completed:true}]");assert.equal(run('resumeEpisode(catalog.stories[0]).id'),'b');
 run("current={story:catalog.stories[0],episode:catalog.stories[0].episodes[0]};var played=null;playEpisode=async id=>{played=id};nextEpisode()");assert.equal(run('played'),'b');
 run('played=null');events.ended();assert.equal(run('played'),'b');
 run('current.episode=catalog.stories[0].episodes[3];played=null');events.ended();assert.equal(run('played'),null);
 run("audio.paused=false;selectKind('番外')");assert.equal(run('audio.paused'),true);run('nextEpisode()');assert.equal(run('played'),'x');
});
