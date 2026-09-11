let catalog = { stories:[], categories:[] }, editing = null, selectedCover = null, queue = [], uploading = false, coverUploading = false, preview = null;
let selectedEpisodes=new Set(), batchBusy=false;
const form = $('#story-form');
function confirmDelete(message) { return new Promise(resolve => { $('#confirm-dialog h2').textContent=message.includes('删除')?'确认删除':'确认批量修改';$('#confirm-ok').textContent='确认';$('#confirm-message').textContent = message; const dialog = $('#confirm-dialog'); dialog.showModal(); const done = answer => { dialog.close(); resolve(answer); }; $('#confirm-cancel').onclick = () => done(false); $('#confirm-ok').onclick = () => done(true); dialog.oncancel = event => { event.preventDefault(); done(false); }; }); }
async function refresh() { catalog = await api('/api/admin/catalog'); render(); }
function render() {
  const categoryChoice = $('#import-category').value;
  $('#import-category').innerHTML = '<option value="">自动分类</option>' + catalog.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('#import-category').value = categoryChoice;
  $('#stats').innerHTML = [['故事专辑',catalog.stories.length],['待上传录音',catalog.stories.reduce((n,s)=>n+s.episodes.filter(e=>!e.has_audio).length,0)],['已上架故事',catalog.stories.filter(s=>s.published).length]].map(([text,n])=>`<div class="stat"><span>${text}</span><strong>${n.toString().padStart(2,'0')}</strong></div>`).join('');
  const query = $('#admin-search').value.trim().toLowerCase(), status = $('#status-filter').value;
  const list = catalog.stories.filter(s=>s.title.toLowerCase().includes(query)&&(status==='all'||String(s.published)===status));
  $('#admin-stories').innerHTML = list.length ? list.map(s=>`<article class="admin-story"><div class="admin-cover">${cover(s)}</div><div class="admin-story-info"><h3>${esc(s.title)}</h3><p>${esc(s.category||'未分类')} · ${s.episodes.length} 集 · 已上传 ${s.episodes.filter(e=>e.has_audio).length} 集</p></div><span class="badge ${s.published?'live':''}">${s.published?'已上架':'草稿'}</span><button class="secondary" data-edit="${s.id}">管理 / 上传</button><button class="text-button" data-delete-story="${s.id}">删除</button></article>`).join('') : '<div class="empty"><strong>这里还没有故事</strong>新建一个故事，再批量上传它的分集录音。</div>';
  $('#category-list').innerHTML = catalog.categories.map(c=>`<form class="category-row" data-category="${c.id}"><input name="name" value="${esc(c.name)}" maxlength="30" required aria-label="分类名称"><input name="sort_order" type="number" value="${c.sort_order}" min="0" max="100000" aria-label="分类排序"><span class="muted">${catalog.stories.filter(s=>s.category_id===c.id).length} 个故事</span><button class="secondary">保存</button><button type="button" class="text-button" data-delete-category="${c.id}">删除</button></form>`).join('');
}
function currentStory() { return catalog.stories.find(s=>s.id===editing); }
function renderCover() { $('#cover-preview').innerHTML = selectedCover ? `<img src="/media/${esc(selectedCover)}" alt="故事封面预览">` : art('audio','#e7e9d7'); }
function openEditor(id = null) {
  editing = id; queue = []; resetUploadBoard(); selectedEpisodes.clear(); $('#episode-kind-filter').value='all'; $('#episode-search').value=''; $('#episode-status').value='all'; $('#start-uploads').hidden=true; $('#upload-queue').innerHTML=''; $('#upload-summary').textContent=''; $('#retry-failed').hidden=true;
  const s = currentStory(); selectedCover=s?.cover_id||null; form.reset();
  $('#story-category').innerHTML='<option value="">未分类</option>'+catalog.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  form.elements.title.value=s?.title||''; form.elements.description.value=s?.description||''; form.elements.category_id.value=s?.category_id||''; form.elements.published.checked=!!s?.published;
  $('#editor-title').textContent=s?'管理故事与录音':'新建故事'; $('#episode-section').hidden=!id; $('#save-first').hidden=!!id; renderCover(); renderEpisodes(); $('#story-dialog').showModal();
}
async function closeEditor(event) { event?.preventDefault(); if (uploading||coverUploading) { toast('文件正在上传，请完成后再关闭'); return; } if (selectedCover && selectedCover!==currentStory()?.cover_id) await api('/api/admin/media/'+selectedCover,'DELETE'); for(const item of queue) if(item.media&&item.status!=='done') await api('/api/admin/media/'+item.media.id,'DELETE'); if(preview){preview.pause();preview=null} $('#story-dialog').close(); }
$('#close-editor').onclick=guarded(closeEditor); $('#story-dialog').oncancel=guarded(closeEditor);
$('#new-story').onclick=()=>openEditor();
form.onsubmit=guarded(async event=>{
  event.preventDefault(); if(coverUploading){toast('封面正在上传，请稍后保存');return} const button=$('#save-story');button.disabled=true;
  try {
    const data={title:form.elements.title.value.trim(),description:form.elements.description.value,category_id:form.elements.category_id.value||null,cover_id:selectedCover,published:form.elements.published.checked};
    if(!editing){const created=await api('/api/admin/stories','POST',data);editing=created.id;}
    await api('/api/admin/stories/'+editing,'PUT',data); await refresh(); $('#editor-title').textContent='管理故事与录音'; $('#episode-section').hidden=false; $('#save-first').hidden=true; renderEpisodes(); toast('故事信息已保存');
  } finally {button.disabled=false;}
});
function upload(file,kind,progress=()=>{}) { return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest(); xhr.open('POST','/api/admin/upload?kind='+kind);xhr.timeout=30*60*1000;xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');
  xhr.upload.onprogress=e=>{if(e.lengthComputable)progress(Math.round(e.loaded/e.total*100))};
  xhr.onload=()=>{let result;try{result=JSON.parse(xhr.responseText)}catch{reject(new Error('服务器响应无效'));return}if(xhr.status>=200&&xhr.status<300)resolve(result);else reject(new Error(result.error||'上传失败'));};
  xhr.onerror=()=>reject(new Error('网络中断，请重试'));xhr.ontimeout=()=>reject(new Error('上传超时，请重试'));xhr.send(file);
}); }
$('#cover-file').onchange=guarded(async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;if(file.size>10*1024*1024)throw new Error('封面不能超过 10 MB');coverUploading=true;$('#save-story').disabled=true;
  try{const result=await upload(file,'image');if(selectedCover&&selectedCover!==currentStory()?.cover_id)await api('/api/admin/media/'+selectedCover,'DELETE');selectedCover=result.id;renderCover();toast('封面已上传，保存故事信息后生效')}finally{coverUploading=false;$('#save-story').disabled=false}
});
$('#remove-cover').onclick=guarded(async()=>{if(coverUploading)return;if(selectedCover&&selectedCover!==currentStory()?.cover_id)await api('/api/admin/media/'+selectedCover,'DELETE');selectedCover=null;renderCover()});
function durationOf(file){return new Promise(resolve=>{const a=new Audio(),url=URL.createObjectURL(file);let done=false;const finish=value=>{if(done)return;done=true;clearTimeout(timer);a.removeAttribute('src');a.load();URL.revokeObjectURL(url);resolve(value)};const timer=setTimeout(()=>finish(0),8000);a.preload='metadata';a.onloadedmetadata=()=>finish(Number.isFinite(a.duration)?a.duration:0);a.onerror=()=>finish(0);a.src=url;});}
function queueRender(){
  const states=StoryMatching.analyzeQueue(queue,currentStory()?.episodes||[]);
  renderUploadBoard(states);
  const ready=states.filter(s=>s.ready).length,issues=states.filter(s=>s.issue).length,done=states.filter(s=>s.state==='done').length,discarded=states.filter(s=>s.state==='discarded').length;
  $('#upload-summary').textContent=queue.length?`已上传 ${done} · 可上传 ${ready} · 问题未上传 ${issues} · 已舍弃 ${discarded}`:'';
  $('#retry-failed').hidden=uploading||!queue.some(q=>q.status==='error');
  $('#start-uploads').hidden=uploading||!ready;
  $('#start-uploads').textContent='上传匹配正常的 '+ready+' 个文件';
}
async function runQueue(){
  if(uploading||coverUploading||batchBusy)return;
  for(const q of queue)if(q.status==='waiting'&&!q.target)q.status='skipped';
  queueRender();
  const states=StoryMatching.analyzeQueue(queue,currentStory().episodes);
  const waiting=states.filter(s=>s.ready).map(s=>queue[s.index]);
  if(!waiting.length){toast('没有可上传的文件，未匹配文件已标记为未上传');return}
  const replace=waiting.filter(q=>currentStory().episodes.find(e=>e.id===q.target)?.has_audio);
  if(replace.length && !await confirmDelete(`将替换 ${replace.length} 集已有录音，并重置这些分集的收听进度。确认继续？`))return;
  uploading=true;$('#choose-audio').disabled=true;$('#close-editor').disabled=true;$('#save-story').disabled=true;queueRender();
  try{for(const item of waiting){
    item.status='uploading';item.message='';queueRender();
    try{
      if(item.file.size>500*1024*1024)throw new Error('文件不能超过 500 MB');
      if(!/\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(item.file.name))throw new Error('不支持此录音格式');
      if(!item.media){item.media=await upload(item.file,'audio',percent=>{item.percent=percent;queueRender()});item.duration=await durationOf(item.file)}
      if(item.target==='new'){
        const result=await api('/api/admin/stories/'+editing+'/episodes','POST',{title:item.file.name.replace(/\.[^.]+$/,'').slice(0,120),media_id:item.media.id,duration:item.duration});item.target=result.id;
      }else{
        const episode=currentStory().episodes.find(e=>e.id===item.target);if(!episode)throw new Error('分集已变化，请关闭后重新打开');
        await api('/api/admin/episodes/'+episode.id,'PUT',{media_id:item.media.id,duration:item.duration,expected_media_id:episode.media_id});
      }
      item.status='done';item.percent=100;
    }catch(e){item.status='error';item.message=e.message}queueRender();
  }await refresh();renderEpisodes();}finally{uploading=false;$('#choose-audio').disabled=false;$('#close-editor').disabled=false;$('#save-story').disabled=false;queueRender()}
}
async function addFiles(files,directTarget=null){
  if(!editing||uploading||coverUploading)return;
  const existing=new Set(queue.filter(q=>q.status!=='done').map(q=>[q.file.name,q.file.size,q.file.lastModified].join(':')));
  for(const file of [...files].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}))){
    const key=[file.name,file.size,file.lastModified].join(':');
    if(existing.has(key)){
      const pending=queue.find(q=>q.status!=='done'&&[q.file.name,q.file.size,q.file.lastModified].join(':')===key);
      if(directTarget&&pending&&!pending.media){pending.target=directTarget;pending.reason='指定分集';pending.status='waiting';pending.message='';}
      continue;
    }
    existing.add(key);
    const match=StoryMatching.matchEpisode(file.name,currentStory().episodes);
    queue.push({file,target:directTarget||match.id||(!currentStory().source_album_id?'new':''),reason:directTarget?'指定分集':match.reason,candidates:match.candidates||[],candidateScores:match.candidateScores||[],status:'waiting',message:'',percent:0});
  }
  queueRender();
  if(directTarget && queue.filter(q=>q.status==='waiting').length===1)await runQueue();
  else {toast('请核对文件与分集的对应关系，再点击确认上传');$('#upload-queue').scrollIntoView({behavior:'smooth',block:'nearest'})}
}
$('#start-uploads').onclick=guarded(runQueue);
$('#choose-audio').onclick=()=>$('#audio-files').click();$('#audio-files').onchange=guarded(async e=>{const files=[...e.target.files];e.target.value='';await addFiles(files)});
$('#retry-failed').onclick=guarded(async()=>{queue.filter(q=>q.status==='error').forEach(q=>{q.status='waiting';q.message=''});queueRender()});
$('#dropzone').ondragover=e=>{e.preventDefault();$('#dropzone').classList.add('dragging')};$('#dropzone').ondragleave=()=>$('#dropzone').classList.remove('dragging');$('#dropzone').ondrop=guarded(async e=>{e.preventDefault();$('#dropzone').classList.remove('dragging');await addFiles(e.dataTransfer.files)});
window.addEventListener('beforeunload',e=>{if(uploading||coverUploading){e.preventDefault();e.returnValue=''}});
let targetEpisode=null,targetCover=null;
$('#episode-audio-file').onchange=guarded(async e=>{const file=e.target.files[0];e.target.value='';if(file)await addFiles([file],targetEpisode)});
$('#episode-cover-file').onchange=guarded(async event=>{
  const file=event.target.files[0];event.target.value='';if(!file||uploading||coverUploading)return;
  if(file.size>10*1024*1024)throw new Error('封面不能超过 10 MB');const id=targetCover;let media;
  coverUploading=true;$('#save-story').disabled=true;
  try{media=await upload(file,'image');await api('/api/admin/episodes/'+id,'PUT',{cover_id:media.id});await refresh();renderEpisodes();toast('分集封面已保存')}
  catch(e){if(media)await api('/api/admin/media/'+media.id,'DELETE');throw e}
  finally{coverUploading=false;$('#save-story').disabled=false}
});
function resetEpisodeSelection(){selectedEpisodes.clear();renderEpisodes()}
$('#episode-search').oninput=resetEpisodeSelection;$('#episode-status').onchange=resetEpisodeSelection;$('#episode-kind-filter').onchange=resetEpisodeSelection;
$('#add-placeholder').onclick=guarded(async()=>{if(uploading||coverUploading)return;await api('/api/admin/stories/'+editing+'/episodes','POST',{title:'新分集 '+(currentStory().episodes.length+1)});await refresh();$('#episode-search').value='';$('#episode-status').value='all';renderEpisodes();toast('已添加待上传分集，可修改标题和封面')});
function renderEpisodes(){
  const all=currentStory()?.episodes||[],search=$('#episode-search').value.trim(),status=$('#episode-status').value;
  form.elements.published.disabled=!all.length;if(!all.length)form.elements.published.checked=false;
  $('#episode-count').textContent=`${all.length} 集 · 已上传 ${all.filter(e=>e.has_audio).length} 集`;
  const episodes=filteredEpisodes();
  selectedEpisodes=new Set([...selectedEpisodes].filter(id=>episodes.some(e=>e.id===id)));
  $('#episode-list').innerHTML=episodes.map(e=>{const i=all.indexOf(e);return `<div class="episode-row" data-episode="${e.id}"><div class="episode-admin-cover"><label class="episode-select"><input type="checkbox" data-select-episode="${e.id}" aria-label="选择${esc(e.title)}" ${selectedEpisodes.has(e.id)?'checked':''}>选择</label>${cover(e)}</div><div class="episode-edit-fields"><label>分集名称<input value="${esc(e.title)}" maxlength="120" aria-label="第${i+1}条名称"></label><input data-subtitle value="${esc(e.subtitle)}" placeholder="副标题" aria-label="第${i+1}条副标题"><div class="episode-edit-meta"><span class="badge ${e.has_audio?'live':''}">${e.has_audio?'已有录音':'待上传录音'}</span><span class="muted">${format(e.duration)} · 序号 ${i+1}</span><select data-kind aria-label="第${i+1}条分类">${['故事','科学揭秘','番外'].map(k=>`<option ${k===e.kind?'selected':''}>${k}</option>`).join('')}</select></div></div><div class="episode-actions"><button class="primary" data-attach="${e.id}">${e.has_audio?'替换录音':'上传录音'}</button><button data-episode-save="${e.id}">保存信息</button><button data-episode-cover="${e.id}">换封面</button><button data-preview="${e.id}" ${e.has_audio?'':'disabled'}>试听</button><button data-move="${e.id}" data-direction="-1" ${i===0?'disabled':''} aria-label="上移第${i+1}条">↑</button><button data-move="${e.id}" data-direction="1" ${i===all.length-1?'disabled':''} aria-label="下移第${i+1}条">↓</button><button class="text-button" data-delete-episode="${e.id}">删除分集</button></div></div>`}).join('')||'<div class="empty">没有符合条件的分集。</div>';
  updateEpisodeSelection();
}
function filteredEpisodes(){
  const search=$('#episode-search').value.trim(),status=$('#episode-status').value,kind=$('#episode-kind-filter').value;
  return (currentStory()?.episodes||[]).filter(e=>(e.title+' '+e.subtitle).includes(search)&&(status==='all'||(status==='ready')===e.has_audio)&&(kind==='all'||e.kind===kind));
}
function updateEpisodeSelection(){
  const list=filteredEpisodes(),n=list.filter(e=>selectedEpisodes.has(e.id)).length,box=$('#select-filtered-episodes');
  box.checked=!!list.length&&n===list.length;box.indeterminate=n>0&&n<list.length;box.disabled=!list.length||batchBusy;
  $('#episode-selection-count').textContent='筛选 '+list.length+' 集 · 已选 '+n+' 集';
  $('#batch-delete-episodes').disabled=$('#batch-set-kind').disabled=!n||batchBusy;
}
$('#episode-list').addEventListener('change',event=>{
  const id=event.target.dataset.selectEpisode;if(!id)return;
  event.target.checked?selectedEpisodes.add(id):selectedEpisodes.delete(id);updateEpisodeSelection();
});
$('#select-filtered-episodes').onchange=event=>{selectedEpisodes=event.target.checked?new Set(filteredEpisodes().map(e=>e.id)):new Set();renderEpisodes()};
async function batchEpisodes(action){
  if(batchBusy||uploading||coverUploading){toast('请等待当前操作完成');return}
  const storyId=editing,entries=filteredEpisodes().filter(e=>selectedEpisodes.has(e.id));if(!entries.length)return;
  const kind=$('#batch-kind').value;
  const message=action==='delete' ? '将永久删除所选 '+entries.length+' 个分集，其中 '+entries.filter(e=>e.has_audio).length+' 集已有录音。分集、录音及收听进度将删除，无法撤销。是否继续？' : '将所选 '+entries.length+' 个分集的类型改为「'+kind+'」？';
  batchBusy=true;updateEpisodeSelection();
  try{
    if(!await confirmDelete(message))return;
    if(uploading||coverUploading||editing!==storyId)throw new Error('页面状态已变化，请重新选择');
    await api('/api/admin/stories/'+storyId+'/episodes/batch','POST',{action,kind,episodes:entries.map(e=>({id:e.id,media_id:e.media_id}))});
    if(preview){preview.pause();preview.remove();preview=null}
    selectedEpisodes.clear();await refresh();form.elements.published.checked=!!currentStory()?.published;renderEpisodes();toast('已处理 '+entries.length+' 个分集');
  }finally{batchBusy=false;updateEpisodeSelection()}
}
$('#batch-delete-episodes').onclick=guarded(()=>batchEpisodes('delete'));
$('#batch-set-kind').onclick=guarded(()=>batchEpisodes('kind'));
$('#admin-search').oninput=render;$('#status-filter').onchange=render;
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(n=>n.classList.toggle('active',n===b));$('#stories-panel').hidden=b.dataset.tab!=='stories';$('#categories-panel').hidden=b.dataset.tab!=='categories'});
$('#category-form').onsubmit=guarded(async e=>{e.preventDefault();const f=e.target;await api('/api/admin/categories','POST',{name:f.elements.name.value,sort_order:Number(f.elements.sort_order.value)});f.reset();await refresh();toast('分类已添加')});
$('#category-list').addEventListener('submit',guarded(async e=>{e.preventDefault();const f=e.target;await api('/api/admin/categories/'+f.dataset.category,'PUT',{name:f.elements.name.value,sort_order:Number(f.elements.sort_order.value)});await refresh();toast('分类已保存')}));
document.addEventListener('click',guarded(async e=>{
  const b=e.target.closest('button');if(!b)return;const d=b.dataset;
  if(d.edit)openEditor(d.edit);
  if(d.deleteStory&&await confirmDelete('删除此故事及全部分集录音？对应的收听记录也会删除，无法撤销。')){await api('/api/admin/stories/'+d.deleteStory,'DELETE');await refresh();toast('故事已删除')}
  if(d.deleteCategory&&await confirmDelete('删除此分类？分类下有故事时无法删除。')){await api('/api/admin/categories/'+d.deleteCategory,'DELETE');await refresh();toast('分类已删除')}
  if((uploading||coverUploading)&&(d.episodeSave||d.move||d.deleteEpisode||d.attach||d.episodeCover)){toast('请等待上传完成后编辑分集');return}
  if(d.episodeSave){const row=b.closest('.episode-row');const title=row.querySelector('.episode-edit-fields label input').value;await api('/api/admin/episodes/'+d.episodeSave,'PUT',{title,subtitle:row.querySelector('[data-subtitle]').value,kind:row.querySelector('[data-kind]').value});await refresh();renderEpisodes();toast('分集名称已保存')}
  if(d.move){const ids=currentStory().episodes.map(x=>x.id),i=ids.indexOf(d.move),j=i+Number(d.direction);if(j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];await api('/api/admin/stories/'+editing+'/order','PUT',{ids});await refresh();renderEpisodes()}
  if(d.deleteEpisode&&await confirmDelete('删除整个分集（含名称、封面、录音和进度）？无法撤销。')){await api('/api/admin/episodes/'+d.deleteEpisode,'DELETE');await refresh();form.elements.published.checked=!!currentStory().published;renderEpisodes();toast('分集已删除')}
  if(d.attach){targetEpisode=d.attach;$('#episode-audio-file').click()}
  if(d.episodeCover){targetCover=d.episodeCover;$('#episode-cover-file').click()}
  if(d.preview){if(preview){preview.pause();preview.remove()}const episode=currentStory().episodes.find(x=>x.id===d.preview);if(!episode?.audio_url){toast('这集还没有录音');return}preview=document.createElement('audio');preview.controls=true;preview.className='episode-preview';preview.src=episode.audio_url;b.closest('.episode-row').after(preview);try{await preview.play()}catch{toast('浏览器无法播放此格式，请检查录音或转为 MP3')}}
}));
$('#login-form').onsubmit=guarded(async e=>{e.preventDefault();await api('/api/admin/login','POST',{password:$('#password').value});$('#password').value='';await init()});
$('#logout').onclick=guarded(async()=>{await api('/api/admin/logout','POST');await init()});
let importTimer = null, importedStory = null;
let previewJob = null, previewEntries = [], selectedEntries = new Set();
function updateSelection() {
  $('#selection-count').textContent = `已选 ${selectedEntries.size} / ${previewEntries.length} 集`;
  $('#confirm-import').disabled = !selectedEntries.size;
  $('#confirm-import').textContent = `确认导入 ${selectedEntries.size} 集`;
  document.querySelectorAll('#import-preview input[type=checkbox]').forEach(input=>{
    const matches = previewEntries.filter(e=>input.dataset.entry ? e.id===input.dataset.entry : input.dataset.kind ? e.kind===input.dataset.kind : e.group===input.dataset.group);
    const count = matches.filter(e=>selectedEntries.has(e.id)).length;
    input.checked = !!matches.length && count===matches.length;
    input.indeterminate = count>0 && count<matches.length;
  });
}
function showSelection(job) {
  $('#import-preview').hidden = job?.status !== 'preview';
  if (job?.status !== 'preview') { previewJob=null; return; }
  if (previewJob === job.id) return;
  previewJob=job.id; previewEntries=job.entries; selectedEntries=new Set(previewEntries.map(e=>e.id));
  const kinds=[...new Set(previewEntries.map(e=>e.kind))], groups=[...new Set(previewEntries.map(e=>e.group))];
  $('#import-type-options').innerHTML='<strong>按类型选择</strong>'+kinds.map(kind=>`<label><input type="checkbox" data-kind="${esc(kind)}">${esc(kind)} · ${previewEntries.filter(e=>e.kind===kind).length} 集</label>`).join('');
  $('#import-entry-options').innerHTML=groups.map(group=>{
    const entries=previewEntries.filter(e=>e.group===group);
    return `<details open class="import-group"><summary>${esc(group)} · ${entries.length} 集</summary><label class="group-selection"><input type="checkbox" data-group="${esc(group)}">选择此分组全部分集</label>${entries.map(e=>`<label class="import-entry"><input type="checkbox" data-entry="${esc(e.id)}"><span><strong>${esc(e.title)}</strong><small>${esc(e.subtitle || '')}</small></span><span class="muted">${esc(e.kind)}${e.labels?' · '+esc(e.labels):''}<small>${esc(e.duration)}${e.exists?' · 本地已有':''}</small></span></label>`).join('')}</details>`;
  }).join('');
  updateSelection();
}
$('#import-preview').onchange = event=>{
  const input=event.target;if(!input.matches('input[type=checkbox]'))return;
  previewEntries.filter(e=>input.dataset.entry ? e.id===input.dataset.entry : input.dataset.kind ? e.kind===input.dataset.kind : e.group===input.dataset.group).forEach(e=>input.checked?selectedEntries.add(e.id):selectedEntries.delete(e.id));
  updateSelection();
};
$('#select-all-import').onclick=()=>{selectedEntries=new Set(previewEntries.map(e=>e.id));updateSelection()};
$('#select-none-import').onclick=()=>{selectedEntries.clear();updateSelection()};
$('#confirm-import').onclick=guarded(async()=>{
  $('#confirm-import').disabled=true;
  try {
    const {job}=await api('/api/admin/kaishu-import/confirm','POST',{job_id:previewJob,entry_ids:[...selectedEntries]});
    renderImport(job);importTimer=setTimeout(pollImport,1000);
  } catch(e) {$('#confirm-import').disabled=!selectedEntries.size;throw e;}
});
function renderImport(job) {
  showSelection(job);
  const running = job?.status === 'running';
  $('#start-import').disabled = running;
  $('#kaishu-url').disabled = running;
  $('#import-category').disabled = running || job?.status === 'preview';
  $('#import-status').hidden = !job;
  $('#refresh-import').hidden = true;
  if (!job) return;
  if (!$('#kaishu-url').value) $('#kaishu-url').value = 'https://kids.kaishustory.com/h5/ks-detailPage/story?albumId=' + job.album_id;
  $('#import-title').textContent = job.title || '专辑 ' + job.album_id;
  $('#import-message').textContent = job.message + (job.stage === 'images' ? ` · ${job.done} / ${job.total} 张图片` : job.status === 'complete' ? ` · ${job.result.entries} 集` : '');
  const progress = $('#import-progress'); progress.hidden = !running;
  if (job.total && job.stage === 'images') progress.value = job.done / job.total * 100;
  else progress.removeAttribute('value');
  $('#import-status').classList.toggle('import-failed', job.status === 'failed');
  importedStory = job.result?.story_id || null;
  $('#open-imported').hidden = !importedStory;
  $('#start-import').textContent = running ? '正在处理…' : '获取目录预览';
}
async function pollImport() {
  clearTimeout(importTimer);
  try {
    const {job} = await api('/api/admin/kaishu-import'); renderImport(job);
    if (job?.status === 'running') importTimer = setTimeout(pollImport, 1500);
    else if (job?.status === 'complete') await refresh();
  } catch {
    $('#import-status').hidden = false;
    $('#import-message').textContent = '暂时无法查询进度，任务可能仍在运行。请重新查询；若登录过期，请刷新页面登录。';
    $('#refresh-import').hidden = false;
  }
}
$('#link-import-form').onsubmit = guarded(async event => {
  event.preventDefault(); $('#start-import').disabled = true;
  try {
    const {job} = await api('/api/admin/kaishu-import', 'POST', { url:$('#kaishu-url').value.trim(), category_id:$('#import-category').value || null, preview:true });
    $('#kaishu-url').value = ''; renderImport(job); importTimer = setTimeout(pollImport, 1000);
  } catch (e) { $('#start-import').disabled = false; throw e; }
});
$('#refresh-import').onclick = pollImport;
$('#open-imported').onclick = guarded(async () => { await refresh(); if (catalog.stories.some(s=>s.id===importedStory)) openEditor(importedStory); else toast('该专辑已删除，请重新导入'); });
async function init(){clearTimeout(importTimer);const session=await api('/api/admin/session');$('#login-panel').hidden=session.authenticated;$('#workspace').hidden=!session.authenticated;$('#new-story').disabled=!session.authenticated;$('#logout').hidden=!session.passwordRequired||!session.authenticated;$('#admin-mode').textContent=session.passwordRequired?'管理员模式':'本机管理模式';if(session.authenticated){await refresh();await pollImport()}}
guarded(init)();
