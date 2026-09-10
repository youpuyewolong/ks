let catalog = { stories:[], categories:[] }, editing = null, selectedCover = null, queue = [], uploading = false, coverUploading = false, preview = null;
const form = $('#story-form');
function confirmDelete(message) { return new Promise(resolve => { $('#confirm-message').textContent = message; const dialog = $('#confirm-dialog'); dialog.showModal(); const done = answer => { dialog.close(); resolve(answer); }; $('#confirm-cancel').onclick = () => done(false); $('#confirm-ok').onclick = () => done(true); dialog.oncancel = event => { event.preventDefault(); done(false); }; }); }
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
  editing = id; queue = []; $('#episode-search').value=''; $('#episode-status').value='all'; $('#start-uploads').hidden=true; $('#upload-queue').innerHTML=''; $('#upload-summary').textContent=''; $('#retry-failed').hidden=true;
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
  const episodes=currentStory()?.episodes||[];
  $('#upload-queue').innerHTML=queue.map((q,i)=>`<div class="upload-row ${q.status==='error'?'error':!q.target||q.status==='skipped'?'unmatched':''}"><span title="${esc(q.file.name)}">${esc(q.file.name)}</span><span>${esc(q.message||({waiting:q.target?q.reason||'待确认':'未上传 · 未匹配，请手动选择',uploading:'上传中 '+q.percent+'%',done:'✓ 已绑定',error:'上传失败',skipped:'未上传 · 已跳过（未匹配）'})[q.status])}</span><select data-target="${i}" aria-label="${esc(q.file.name)}对应分集" ${uploading||q.status==='done'||q.media?'disabled':''}><option value="">请选择对应分集</option><option value="new" ${q.target==='new'?'selected':''}>＋ 新建分集（使用文件名）</option>${episodes.map(e=>`<option value="${e.id}" ${q.target===e.id?'selected':''}>${esc(e.title)}${e.has_audio?' · 替换已有录音':''}</option>`).join('')}</select><progress max="100" value="${q.percent}"></progress></div>`).join('');
  const skipped=queue.filter(q=>q.status==='skipped'||q.status==='waiting'&&!q.target).length;
  const success=queue.filter(q=>q.status==='done').length,failed=queue.filter(q=>q.status==='error').length;
  $('#upload-summary').textContent=queue.length?`${success} / ${queue.length} 集已绑定${failed?' · '+failed+' 个失败':''}${skipped?' · '+skipped+' 个未匹配，未上传':''}`:'';
  $('#retry-failed').hidden=!failed||uploading;
  $('#start-uploads').hidden=uploading||!queue.some(q=>q.status==='waiting'&&q.target);
  $('#start-uploads').textContent='上传已选择的 '+queue.filter(q=>q.status==='waiting'&&q.target).length+' 个文件';
}
$('#upload-queue').onchange=e=>{if(e.target.dataset.target!==undefined){const q=queue[Number(e.target.dataset.target)];q.target=e.target.value;q.reason=q.target?'手动指定':'未匹配';if(q.status==='skipped')q.status='waiting';q.message='';queueRender();}};
async function runQueue(){
  if(uploading||coverUploading)return;
  for(const q of queue)if(q.status==='waiting'&&!q.target)q.status='skipped';
  queueRender();
  const waiting=queue.filter(q=>q.status==='waiting'&&q.target),targets=waiting.map(q=>q.target).filter(t=>t!=='new');
  if(!waiting.length){toast('没有可上传的文件，未匹配文件已标记为未上传');return}
  if(new Set(targets).size!==targets.length){toast('多个文件指向同一分集，请调整对应关系');return}
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
    queue.push({file,target:directTarget||match.id||(!currentStory().source_album_id?'new':''),reason:directTarget?'指定分集':match.reason,status:'waiting',message:'',percent:0});
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
$('#episode-search').oninput=()=>renderEpisodes();$('#episode-status').onchange=()=>renderEpisodes();
$('#add-placeholder').onclick=guarded(async()=>{if(uploading||coverUploading)return;await api('/api/admin/stories/'+editing+'/episodes','POST',{title:'新分集 '+(currentStory().episodes.length+1)});await refresh();$('#episode-search').value='';$('#episode-status').value='all';renderEpisodes();toast('已添加待上传分集，可修改标题和封面')});
function renderEpisodes(){
  const all=currentStory()?.episodes||[],search=$('#episode-search').value.trim(),status=$('#episode-status').value;
  form.elements.published.disabled=!all.length;if(!all.length)form.elements.published.checked=false;
  $('#episode-count').textContent=`${all.length} 集 · 已上传 ${all.filter(e=>e.has_audio).length} 集`;
  const episodes=all.filter(e=>(e.title+' '+e.subtitle).includes(search)&&(status==='all'||(status==='ready')===e.has_audio));
  $('#episode-list').innerHTML=episodes.map(e=>{const i=all.indexOf(e);return `<div class="episode-row" data-episode="${e.id}"><div class="episode-admin-cover">${cover(e)}</div><div class="episode-edit-fields"><label>分集名称<input value="${esc(e.title)}" maxlength="120" aria-label="第${i+1}条名称"></label><input data-subtitle value="${esc(e.subtitle)}" placeholder="副标题" aria-label="第${i+1}条副标题"><div class="episode-edit-meta"><span class="badge ${e.has_audio?'live':''}">${e.has_audio?'已有录音':'待上传录音'}</span><span class="muted">${format(e.duration)} · 序号 ${i+1}</span><select data-kind aria-label="第${i+1}条分类">${['故事','科学揭秘','番外'].map(k=>`<option ${k===e.kind?'selected':''}>${k}</option>`).join('')}</select></div></div><div class="episode-actions"><button class="primary" data-attach="${e.id}">${e.has_audio?'替换录音':'上传录音'}</button><button data-episode-save="${e.id}">保存信息</button><button data-episode-cover="${e.id}">换封面</button><button data-preview="${e.id}" ${e.has_audio?'':'disabled'}>试听</button><button data-move="${e.id}" data-direction="-1" ${i===0?'disabled':''} aria-label="上移第${i+1}条">↑</button><button data-move="${e.id}" data-direction="1" ${i===all.length-1?'disabled':''} aria-label="下移第${i+1}条">↓</button><button class="text-button" data-delete-episode="${e.id}">删除分集</button></div></div>`}).join('')||'<div class="empty">没有符合条件的分集。</div>';
}
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
  if(d.episodeSave){const row=b.closest('.episode-row');const title=row.querySelector('input').value;await api('/api/admin/episodes/'+d.episodeSave,'PUT',{title,subtitle:row.querySelector('[data-subtitle]').value,kind:row.querySelector('[data-kind]').value});await refresh();renderEpisodes();toast('分集名称已保存')}
  if(d.move){const ids=currentStory().episodes.map(x=>x.id),i=ids.indexOf(d.move),j=i+Number(d.direction);if(j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];await api('/api/admin/stories/'+editing+'/order','PUT',{ids});await refresh();renderEpisodes()}
  if(d.deleteEpisode&&await confirmDelete('删除整个分集（含名称、封面、录音和进度）？无法撤销。')){await api('/api/admin/episodes/'+d.deleteEpisode,'DELETE');await refresh();form.elements.published.checked=!!currentStory().published;renderEpisodes();toast('分集已删除')}
  if(d.attach){targetEpisode=d.attach;$('#episode-audio-file').click()}
  if(d.episodeCover){targetCover=d.episodeCover;$('#episode-cover-file').click()}
  if(d.preview){if(preview){preview.pause();preview.remove()}const episode=currentStory().episodes.find(x=>x.id===d.preview);if(!episode?.audio_url){toast('这集还没有录音');return}preview=document.createElement('audio');preview.controls=true;preview.className='episode-preview';preview.src=episode.audio_url;b.closest('.episode-row').after(preview);try{await preview.play()}catch{toast('浏览器无法播放此格式，请检查录音或转为 MP3')}}
}));
$('#login-form').onsubmit=guarded(async e=>{e.preventDefault();await api('/api/admin/login','POST',{password:$('#password').value});$('#password').value='';await init()});
$('#logout').onclick=guarded(async()=>{await api('/api/admin/logout','POST');await init()});
let importTimer = null, importedStory = null;
function renderImport(job) {
  const running = job?.status === 'running';
  $('#start-import').disabled = running;
  $('#kaishu-url').disabled = running;
  $('#import-category').disabled = running;
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
  $('#start-import').textContent = running ? '正在导入…' : job.status === 'failed' ? '重新获取并导入' : '获取并导入';
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
    const {job} = await api('/api/admin/kaishu-import', 'POST', { url:$('#kaishu-url').value.trim(), category_id:$('#import-category').value || null });
    $('#kaishu-url').value = ''; renderImport(job); importTimer = setTimeout(pollImport, 1000);
  } catch (e) { $('#start-import').disabled = false; throw e; }
});
$('#refresh-import').onclick = pollImport;
$('#open-imported').onclick = guarded(async () => { await refresh(); if (catalog.stories.some(s=>s.id===importedStory)) openEditor(importedStory); else toast('该专辑已删除，请重新导入'); });
async function init(){clearTimeout(importTimer);const session=await api('/api/admin/session');$('#login-panel').hidden=session.authenticated;$('#workspace').hidden=!session.authenticated;$('#new-story').disabled=!session.authenticated;$('#logout').hidden=!session.passwordRequired||!session.authenticated;$('#admin-mode').textContent=session.passwordRequired?'管理员模式':'本机管理模式';if(session.authenticated){await refresh();await pollImport()}}
guarded(init)();
