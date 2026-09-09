const audio=$('#audio');
let catalog={stories:[],categories:[]},listening={progress:[],favorites:[]},page='home',category='',detailId=null,current=null,ready=false,switching=false,generation=0,lastSave=0,saveChain=Promise.resolve(),sleepTimer=null,stopAt=0,stopAfterEpisode=false,autoplay=true,speed=1;
try{autoplay=localStorage.getItem('story-autoplay')!=='false'}catch{}
$('#hero-art').innerHTML=art('bear','#f3e7cf',true);
function progressFor(id){return listening.progress.find(p=>p.episode_id===id)}
function latestFor(story){return listening.progress.filter(p=>story.episodes.some(e=>e.id===p.episode_id)).sort((a,b)=>b.updated_at-a.updated_at)[0]}
function resumeEpisode(story){const p=latestFor(story);if(!p)return story.episodes[0];const index=story.episodes.findIndex(e=>e.id===p.episode_id);return p.completed?(story.episodes[index+1]||story.episodes[0]):story.episodes[index]}
function updateAutoplay(){$('#autoplay').textContent='连播 '+(autoplay?'开':'关');$('#autoplay').setAttribute('aria-pressed',String(autoplay))}
function render(){
  $('#library-count').textContent=catalog.stories.length;
  const titles={home:['今天，想听什么故事？','让小耳朵出发，去遇见大大的世界。','发现故事'],library:['好故事，都在这里。','打开一本有声音的故事书，一集接着一集听。','全部故事'],history:['每一次听见，都有迹可循','上次听到的那一集、那一秒，都为你记着。','收听记录'],favorites:['喜欢的故事，值得再听一遍','把心动的故事，收藏在这里。','喜欢的故事']};
  $('#page-title').textContent=titles[page][0];$('#page-description').textContent=titles[page][1];$('#page-crumb').textContent=titles[page][2];$('#home-content').hidden=page!=='home';$('#filters').hidden=page==='history';
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('#catalog-title').textContent=page==='home'?'故事百宝箱':titles[page][2];
  $('#filters').innerHTML=[{id:'',name:'全部故事'},...catalog.categories].map(c=>`<button data-category="${c.id}" class="${category===c.id?'selected':''}">${esc(c.name)}</button>`).join('');
  let stories=catalog.stories.filter(s=>(page!=='favorites'||listening.favorites.includes(s.id))&&(page!=='history'||latestFor(s))&&(page==='history'||!category||s.category_id===category));
  if(page==='history')stories.sort((a,b)=>latestFor(b).updated_at-latestFor(a).updated_at);
  const query=$('#search').value.trim().toLowerCase();stories=stories.filter(s=>(s.title+' '+s.description+' '+s.episodes.map(e=>e.title).join(' ')).toLowerCase().includes(query));
  $('#catalog-count').textContent=`${stories.length} 个故事`;
  $('#story-grid').innerHTML=stories.length?stories.map(s=>{const p=latestFor(s),e=p&&s.episodes.find(e=>e.id===p.episode_id);return `<article class="story-card"><button class="cover" data-story="${s.id}" aria-label="打开${esc(s.title)}">${cover(s)}<span class="cover-label">${s.episodes.length} 集 · ${esc(s.category||'故事')}</span><span class="cover-play">▶</span></button><h3>${esc(s.title)}</h3><p>${esc(s.description||'一段值得慢慢听的好时光')}</p><div class="story-meta"><span>${p?(p.completed?'已听完：':'听到：')+esc(e.title)+' '+format(p.position):'共 '+s.episodes.length+' 集 · '+format(s.episodes.reduce((n,e)=>n+e.duration,0))}</span></div><button class="favorite ${listening.favorites.includes(s.id)?'on':''}" data-favorite="${s.id}" aria-label="${listening.favorites.includes(s.id)?'取消收藏':'收藏'}${esc(s.title)}">${listening.favorites.includes(s.id)?'♥':'♡'}</button></article>`}).join(''):`<div class="empty"><strong>${query?'没有找到这个故事':page==='history'?'你的第一段旅程，还没开始':page==='favorites'?'把喜欢的故事，留在这里':'故事正在准备中'}</strong>${query?'换个名字或分类试试。':page==='favorites'?'点击故事旁的爱心，即可收藏。':'上架后的故事会出现在这里，等你来听。'}</div>`;
  const latest=listening.progress.slice().sort((a,b)=>b.updated_at-a.updated_at).find(p=>catalog.stories.some(s=>s.episodes.some(e=>e.id===p.episode_id))),story=latest&&catalog.stories.find(s=>s.episodes.some(e=>e.id===latest.episode_id));
  $('#continue-card').innerHTML=story?`<div class="continue-thumb">${cover(story)}</div><div class="continue-info"><strong>${esc(story.title)}</strong><p>${esc(story.episodes.find(e=>e.id===latest.episode_id).title)} · ${latest.completed?'已听完':format(latest.position)}</p></div><button class="resume" data-resume="${story.id}">▶ 继续收听</button>`:'<div class="continue-thumb">♧</div><div class="continue-info"><strong>从第一个故事，开始你的旅程</strong><p>每一集的收听进度，都会自动保存</p></div>';
  if(detailId)renderDetail();
}
function renderDetail(){const s=catalog.stories.find(s=>s.id===detailId);if(!s)return;$('#detail-cover').innerHTML=cover(s);$('#detail-category').textContent=s.category||'故事专辑';$('#detail-title').textContent=s.title;$('#detail-description').textContent=s.description;$('#detail-count').textContent=s.episodes.length+' 集';$('#detail-resume').textContent=latestFor(s)?'▶ 继续收听':'▶ 从第一集开始';$('#detail-resume').disabled=!s.episodes.length;$('#detail-episodes').innerHTML=s.episodes.map((e,i)=>{const p=progressFor(e.id);return `<button class="listen-episode ${current?.episode.id===e.id?'playing':''}" data-play="${e.id}"><span class="episode-index">${current?.episode.id===e.id?'♫':String(i+1).padStart(2,'0')}</span><span class="episode-name"><strong>${esc(e.title)}</strong><small>${p?(p.completed?'已听完':'听到 '+format(p.position)):'未收听'}</small></span><span>${format(e.duration||p?.duration)}</span><span>▶</span></button>`}).join('')}
function openStory(id){detailId=id;renderDetail();if(!$('#story-detail').open)$('#story-detail').showModal()}
function snapshot(completed=false){if(!current||!ready||!Number.isFinite(audio.duration)||audio.duration<=0)return null;return {episode_id:current.episode.id,position:audio.currentTime,duration:audio.duration,completed:completed||audio.ended,updated_at:Date.now()}}
function persist(completed=false,keepalive=false){const data=snapshot(completed);if(!data)return Promise.resolve();listening.progress=listening.progress.filter(p=>p.episode_id!==data.episode_id);listening.progress.unshift(data);const send=async()=>{const response=await fetch('/api/progress',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),keepalive});if(!response.ok)throw new Error('收听进度暂未保存，请检查服务器连接')};if(keepalive){send().catch(()=>{});return Promise.resolve()}saveChain=saveChain.catch(()=>{}).then(send);saveChain.catch(()=>toast('收听进度暂未保存，请检查服务器连接'));return saveChain}
async function playEpisode(id,fromStart=false){
  const story=catalog.stories.find(s=>s.episodes.some(e=>e.id===id)),episode=story?.episodes.find(e=>e.id===id);if(!episode)return;
  if(current?.episode.id===id&&ready&&!fromStart){await toggle();return}
  persist().catch(()=>{});switching=true;audio.pause();ready=false;const token=++generation;current={story,episode};
  $('#player-title').textContent=episode.title;$('#player-subtitle').textContent=story.title+' · 第 '+(story.episodes.indexOf(episode)+1)+' 集';$('#player-cover').innerHTML=cover(story);$('#elapsed').textContent='00:00';$('#duration').textContent=format(episode.duration);$('#seek').value=0;
  const p=progressFor(id);audio.onloadedmetadata=()=>{if(token!==generation)return;ready=true;switching=false;audio.currentTime=!fromStart&&p&&!p.completed?Math.min(p.position,Math.max(0,audio.duration-0.1)):0;audio.playbackRate=speed;$('#duration').textContent=format(audio.duration);persist().catch(()=>{});render()};
  audio.src=episode.audio_url;audio.playbackRate=speed;
  try{await audio.play()}catch(e){if(token===generation&&e.name!=='AbortError')toast(e.name==='NotAllowedError'?'点一下播放，继续收听':'这集暂时无法播放，请检查录音格式')}
  renderDetail();updateTransport();
}
async function toggle(){if(!current){toast('先选一个想听的故事');return}if(audio.paused){try{await audio.play()}catch{toast('无法播放这集录音，请检查网络或音频格式')}}else audio.pause()}
function updateTransport(){$('#play').textContent=audio.paused?'▶':'Ⅱ';$('#play').setAttribute('aria-label',audio.paused?'播放':'暂停');const i=current?current.story.episodes.findIndex(e=>e.id===current.episode.id):-1;$('#previous').disabled=i<=0;$('#next').disabled=!current||i>=current.story.episodes.length-1}
function nextEpisode(direction=1){if(!current)return;const episodes=current.story.episodes,i=episodes.findIndex(e=>e.id===current.episode.id),next=episodes[i+direction];if(next)return playEpisode(next.id,true);toast(direction>0?'已经是最后一集了':'已经是第一集了')}
function resetSleep() {clearTimeout(sleepTimer);stopAt=0;stopAfterEpisode=false;$('#sleep').value='0'}
function stopForSleep(){resetSleep();audio.pause();toast('时间到了，晚安，好梦。')}
$('#sleep').onchange=e=>{const value=e.target.value;resetSleep();$('#sleep').value=value;if(value==='end'){stopAfterEpisode=true;toast('这集播完后停止，不再连播')}else if(Number(value)>0){stopAt=Date.now()+Number(value)*60000;sleepTimer=setTimeout(stopForSleep,Number(value)*60000);toast(value+' 分钟后停止播放')}};
$('#autoplay').onclick=()=>{autoplay=!autoplay;try{localStorage.setItem('story-autoplay',String(autoplay))}catch{}updateAutoplay()};
$('#speed').onclick=()=>{const speeds=[1,1.25,1.5,2,.75];speed=speeds[(speeds.indexOf(speed)+1)%speeds.length];audio.playbackRate=speed;$('#speed').textContent=(Number.isInteger(speed)?speed.toFixed(1):speed)+'×'};
$('#volume').oninput=e=>{audio.volume=Number(e.target.value)};audio.volume=.8;
$('#seek').oninput=e=>{if(ready&&Number.isFinite(audio.duration)){audio.currentTime=audio.duration*Number(e.target.value)/100;persist().catch(()=>{})}};
$('#back').onclick=()=>{if(ready)audio.currentTime=Math.max(0,audio.currentTime-15)};$('#forward').onclick=()=>{if(ready)audio.currentTime=Math.min(audio.duration,audio.currentTime+15)};
$('#play').onclick=guarded(toggle);$('#previous').onclick=guarded(()=>nextEpisode(-1));$('#next').onclick=guarded(()=>nextEpisode(1));$('#open-current').onclick=()=>{if(current)openStory(current.story.id);else toast('选择一个故事，就能查看分集列表')};
$('#close-detail').onclick=()=>$('#story-detail').close();$('#detail-resume').onclick=guarded(async()=>{const s=catalog.stories.find(s=>s.id===detailId),e=resumeEpisode(s);if(e)await playEpisode(e.id)});
audio.addEventListener('play',updateTransport);
audio.addEventListener('pause',()=>{updateTransport();if(!switching){persist().catch(()=>{});render()}});
audio.addEventListener('error',()=>{switching=false;ready=false;updateTransport();toast('录音加载失败，请检查连接或在后台检查音频文件')});
audio.addEventListener('timeupdate',()=>{if(stopAt&&Date.now()>=stopAt){stopForSleep();return}$('#elapsed').textContent=format(audio.currentTime);$('#seek').value=audio.duration?audio.currentTime/audio.duration*100:0;if(Date.now()-lastSave>5000){persist().catch(()=>{});lastSave=Date.now()}});
audio.addEventListener('ended',()=>{persist(true).catch(()=>{});render();if(stopAfterEpisode||stopAt&&Date.now()>=stopAt){stopForSleep();return}if(autoplay){const i=current.story.episodes.findIndex(e=>e.id===current.episode.id);if(i<current.story.episodes.length-1)nextEpisode().catch(e=>toast(e.message));else toast('这个故事听完啦，去发现下一个吧。')}});
window.addEventListener('pagehide',()=>persist(false,true));document.addEventListener('visibilitychange',()=>{if(document.hidden)persist(false,true);else if(stopAt&&Date.now()>=stopAt)stopForSleep()});
document.addEventListener('click',guarded(async e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;if(d.page){page=d.page;category='';$('#search').value='';render()}if(d.category!==undefined){category=d.category;render()}if(d.story)openStory(d.story);if(d.play)await playEpisode(d.play);if(d.resume){const s=catalog.stories.find(s=>s.id===d.resume),episode=resumeEpisode(s);if(episode)await playEpisode(episode.id)}if(d.favorite){const liked=listening.favorites.includes(d.favorite);await api('/api/favorites/'+d.favorite,liked?'DELETE':'PUT');listening.favorites=liked?listening.favorites.filter(id=>id!==d.favorite):[...listening.favorites,d.favorite];render()}}));
$('#all-history').onclick=()=>{page='history';category='';render()};$('#search').oninput=render;$('#hero-button').onclick=()=>{$('.catalog').scrollIntoView({behavior:'smooth'})};
async function init(){try{[catalog,listening]=await Promise.all([api('/api/catalog'),api('/api/listening')]);render()}catch(e){$('#story-grid').innerHTML='<div class="empty"><strong>暂时没能打开故事小屋</strong><button id="reload-data" class="resume">重新加载</button></div>';$('#reload-data').onclick=init;toast(e.message)}}
updateAutoplay();updateTransport();init();

