let boardSelected=null,boardSignature='';
function resetUploadBoard(){
  boardSelected=null;boardSignature='';$('#upload-board').hidden=true;
  $('#upload-kind').innerHTML='<option value="">全部类型</option>'+[...new Set((currentStory()?.episodes||[]).map(e=>e.kind||'故事'))].map(k=>'<option value="'+esc(k)+'">'+esc(k)+'</option>').join('');
  for(const id of ['board-episode-search','board-file-search'])$('#'+id).value='';
  $('#board-hide-matched').checked=false;$('#board-candidates-only').checked=false;$('#board-file-filter').value='active';$('#board-file-sort').value='catalog';
}
function boardLocked(){return uploading||coverUploading||batchBusy}
function renderUploadBoard(states){
  $('#upload-board').hidden=!queue.length;if(!queue.length)return;
  const hideMatched=$('#board-hide-matched').checked,matched=s=>['ready','done','uploading'].includes(s.state);
  if(boardSelected!==null&&hideMatched&&matched(states[boardSelected]))boardSelected=null;
  const hiddenEpisodes=new Set();
  if(hideMatched){for(const s of states){const id=queue[s.index].target;if(id&&matched(s)&&!states.some(other=>queue[other.index].target===id&&other.issue))hiddenEpisodes.add(id)}}
  if(boardSelected!==null&&(!queue[boardSelected]||['done','discarded'].includes(queue[boardSelected].status)))boardSelected=null;
  const episodes=currentStory()?.episodes||[],chosen=boardSelected===null?null:queue[boardSelected];
  const signature=JSON.stringify([boardSelected,hideMatched,uploadKind(),uploading,coverUploading,batchBusy,episodes.map(e=>[e.id,e.title,e.has_audio]),queue.map(q=>[q.target,q.status,q.message,q.reason,q.file.name,q.candidates]),$('#board-episode-search').value,$('#board-file-search').value,$('#board-candidates-only').checked,$('#board-file-filter').value,$('#board-file-sort').value]);
  if(signature===boardSignature){
    queue.forEach((q,i)=>{const p=$('#upload-queue').querySelector('[data-progress="'+i+'"]');if(p)p.value=q.percent||0;const t=$('#upload-queue').querySelector('[data-percent="'+i+'"]');if(t)t.textContent=q.status==='uploading'?'上传中 '+(q.percent||0)+'%':''});
    return;
  }
  boardSignature=signature;
  const leftScroll=$('#board-episodes').scrollTop,rightScroll=$('#upload-queue').scrollTop;
  $('#board-selected').textContent=chosen?'当前文件：'+chosen.file.name+' → 请搜索或点击左侧目标分集':'可拖拽右侧文件到左侧；长列表建议“选择文件 → 搜索分集 → 点击绑定”。';
  const candidateIds=new Set(chosen?.candidates||[]);if(chosen?.target)candidateIds.add(chosen.target);
  const query=$('#board-episode-search').value.trim().toLowerCase();
  const left=episodes.filter(e=>!hiddenEpisodes.has(e.id)&&(!uploadKind()||(e.kind||'故事')===uploadKind())&&(e.title+' '+e.subtitle).toLowerCase().includes(query)&&(!$('#board-candidates-only').checked||candidateIds.has(e.id)));
  $('#board-episode-count').textContent=left.length+' / '+episodes.length;
  $('#board-episodes').innerHTML=left.map(e=>{
    const assigned=states.filter(s=>queue[s.index].target===e.id&&s.state!=='discarded'&&s.state!=='outside');
    const conflict=assigned.some(s=>s.state==='conflict'),isCandidate=candidateIds.has(e.id);
    return '<article class="board-episode '+(conflict?'conflict':assigned.length?'matched':'')+(isCandidate?' candidate':'')+'" data-drop-episode="'+esc(e.id)+'"><div class="board-card-title"><span class="board-order">'+(episodes.indexOf(e)+1)+'</span><strong>'+esc(e.title)+'</strong></div><p>'+esc(e.subtitle||'')+'</p><span class="board-badge">'+(conflict?'重复占用':assigned.length?'已关联文件':e.has_audio?'本地已有录音':'待关联')+(isCandidate?' · 当前候选':'')+'</span>'+assigned.map(s=>'<button type="button" data-board-select="'+s.index+'" class="board-linked">'+esc(queue[s.index].file.name)+(s.state==='done'?' · 已上传':'')+'</button>').join('')+'<small class="direct-drop-hint">也可从电脑文件夹拖入一个录音，直接上传</small><button type="button" class="secondary" data-bind-episode="'+esc(e.id)+'" '+(!chosen||boardLocked()?'disabled':'')+'>'+(e.has_audio?'绑定到此集（已有录音）':'绑定到此集')+'</button></article>';
  }).join('')||'<p class="empty">没有符合条件的分集；可清空搜索或取消“只看候选”“隐藏已匹配”。</p>';
  const filter=$('#board-file-filter').value,search=$('#board-file-search').value.toLowerCase().trim();
  const visible=StoryMatching.orderFiles(queue,episodes,$('#board-file-sort').value).filter(i=>{
    const q=queue[i],s=states[i],target=episodes.find(e=>e.id===q.target);
    return (!hideMatched||!matched(s))&&(q.file.name+' '+(target?.title||'')).toLowerCase().includes(search)&&(filter==='outside'?s.state==='outside':filter==='issues'?s.issue:filter==='ready'?s.ready:filter==='discarded'?s.state==='discarded':s.state!=='discarded'&&s.state!=='outside');
  });
  $('#board-file-count').textContent=visible.length+' / '+queue.length;
  const labels={outside:'其他类型 · 暂不上传',ready:'已匹配 · 可上传',conflict:'重复占用 · 未上传',ambiguous:'多个名称候选 · 未上传',unmatched:'未匹配 · 未上传',missing:'目标已删除 · 未上传',error:'上传失败',done:'已上传',discarded:'已舍弃 · 不上传',uploading:'正在上传'};
  $('#upload-queue').innerHTML=visible.map(i=>{
    const q=queue[i],s=states[i],target=episodes.find(e=>e.id===q.target),locked=boardLocked()||q.status==='done'||!!q.media;
    const candidates=(q.candidates||[]).map(id=>episodes.find(e=>e.id===id)).filter(Boolean);
    return '<article class="board-file '+s.state+(boardSelected===i?' selected':'')+'" data-file-index="'+i+'" draggable="'+(!locked&&s.state!=='discarded')+'"><strong>'+esc(q.file.name)+'</strong><span class="board-badge">'+labels[s.state]+'</span><p>'+esc(q.message||q.reason||'')+'</p><p class="board-target">→ '+esc(target?((episodes.indexOf(target)+1)+'. '+target.title):q.target==='new'?'新建分集':'尚未指定分集')+'</p>'+(s.state==='conflict'?'<div class="board-conflicts">以下文件也指向同一集：'+s.peers.map(j=>'<button type="button" data-board-select="'+j+'">'+esc(queue[j].file.name)+'</button>').join('')+'</div>':'')+(candidates.length?'<details><summary>'+candidates.length+' 个候选分集</summary>'+candidates.map(e=>'<button type="button" data-show-candidate="'+esc(e.id)+'" data-candidate-file="'+i+'">'+esc(e.title)+(q.candidateScores?.find(c=>c.id===e.id)?' · '+Math.round(q.candidateScores.find(c=>c.id===e.id).score*100)+'%':'')+'</button>').join('')+'</details>':'')+'<div class="board-card-actions">'+(s.state==='discarded'?'<button type="button" data-restore-file="'+i+'" '+(boardLocked()?'disabled':'')+'>恢复</button>':'<button type="button" class="secondary" data-board-select="'+i+'" '+(locked?'disabled':'')+'>选择 / 改绑</button>'+(target?'<button type="button" data-locate-target="'+esc(target.id)+'">定位左侧</button>':'')+(q.target?'<button type="button" data-unbind-file="'+i+'" '+(locked?'disabled':'')+'>解除匹配</button>':'')+'<button type="button" data-discard-file="'+i+'" '+(boardLocked()||q.status==='done'?'disabled':'')+'>舍弃</button>'+(!currentStory()?.source_album_id&&!uploadKind()?'<button type="button" data-new-file="'+i+'" '+(locked?'disabled':'')+'>新建分集</button>':''))+'</div><progress data-progress="'+i+'" max="100" value="'+(q.percent||0)+'"></progress><small data-percent="'+i+'">'+(q.status==='uploading'?'上传中 '+q.percent+'%':'')+'</small></article>';
  }).join('')||'<p class="empty">当前筛选下没有录音文件，可调整筛选或取消“隐藏已匹配”。</p>';
  $('#board-episodes').scrollTop=leftScroll;$('#upload-queue').scrollTop=rightScroll;
}
function selectBoardFile(index){
  const q=queue[index];if(!q||boardLocked()||q.status==='done'||q.status==='discarded'||q.media)return;
  boardSelected=index;queueRender();
}
function locateBoardEpisode(id){
  $('#board-episode-search').value='';$('#board-candidates-only').checked=false;boardSignature='';queueRender();
  const node=[...$('#board-episodes').querySelectorAll('[data-drop-episode]')].find(n=>n.dataset.dropEpisode===id);
  if(node)$('#board-episodes').scrollTop=node.offsetTop-$('#board-episodes').offsetTop;
}
function bindBoardFile(index,id){
  const q=queue[index];if(!q||boardLocked()||['done','discarded'].includes(q.status)||q.media)return;
  if(id!=='new'&&!currentStory()?.episodes.some(e=>e.id===id&&(!uploadKind()||(e.kind||'故事')===uploadKind())))return;
  if(id==='new'&&uploadKind())return;
  q.manual=true;q.target=id;q.status='waiting';q.message='';q.reason='手动指定';boardSelected=index;queueRender();
}
for(const id of ['board-episode-search','board-file-search'])$('#'+id).oninput=()=>queueRender();
for(const id of ['board-file-filter','board-file-sort','board-candidates-only','board-hide-matched'])$('#'+id).onchange=()=>queueRender();
$('#upload-board').onclick=guarded(async event=>{
  const b=event.target.closest('button');if(!b)return;const d=b.dataset;
  if(d.boardSelect!==undefined){selectBoardFile(Number(d.boardSelect));return}
  if(d.locateTarget){locateBoardEpisode(d.locateTarget);return}
  if(d.showCandidate){selectBoardFile(Number(d.candidateFile));locateBoardEpisode(d.showCandidate);return}
  if(boardLocked())return;
  if(d.bindEpisode&&boardSelected!==null){bindBoardFile(boardSelected,d.bindEpisode);return}
  if(d.newFile!==undefined){bindBoardFile(Number(d.newFile),'new');return}
  if(d.unbindFile!==undefined){
    const q=queue[Number(d.unbindFile)];if(q.media||q.status==='done')return;q.target='';q.status='waiting';q.message='';q.reason='已解除匹配';queueRender();return;
  }
  if(d.discardFile!==undefined){
    const q=queue[Number(d.discardFile)];if(q.status==='done')return;
    if(q.media){await api('/api/admin/media/'+q.media.id,'DELETE');q.media=null;q.percent=0}
    q.status='discarded';q.message='';queueRender();return;
  }
  if(d.restoreFile!==undefined){const q=queue[Number(d.restoreFile)];q.status='waiting';queueRender()}
});
$('#upload-queue').ondragstart=event=>{
  const node=event.target.closest('[data-file-index]');if(!node||boardLocked()){event.preventDefault();return}
  const i=Number(node.dataset.fileIndex),q=queue[i];if(q.media||['done','discarded'].includes(q.status)){event.preventDefault();return}
  event.dataTransfer.setData('application/x-story-file',String(i));event.dataTransfer.effectAllowed='move';
  boardSelected=i;$('#board-selected').textContent='正在拖动：'+q.file.name+' → 放到左侧对应分集';
};
$('#board-episodes').ondragover=event=>{if(event.target.closest('[data-drop-episode]')&&[...event.dataTransfer.types].includes('application/x-story-file')&&!boardLocked()){event.preventDefault();event.dataTransfer.dropEffect='move'}};
$('#board-episodes').addEventListener('dragover',event=>{const node=event.target.closest('[data-drop-episode]');if(node&&[...event.dataTransfer.types].includes('Files')){event.preventDefault();event.dataTransfer.dropEffect=boardLocked()?'none':'copy';if(!boardLocked())node.classList.add('recording-drop-hover')}});
$('#board-episodes').addEventListener('dragleave',event=>{const node=event.target.closest('[data-drop-episode]');if(node&&!node.contains(event.relatedTarget))node.classList.remove('recording-drop-hover')});
$('#board-episodes').ondrop=guarded(async event=>{
  const node=event.target.closest('[data-drop-episode]'),value=event.dataTransfer.getData('application/x-story-file');
  if(node&&[...event.dataTransfer.types].includes('Files')){await externalRecordingDrop(event,node.dataset.dropEpisode);return}
  if(!node||!/^\d+$/.test(value))return;event.preventDefault();bindBoardFile(Number(value),node.dataset.dropEpisode);
});
$('#export-upload-issues').onclick=()=>{
  const states=queueStates();
  const lines=states.filter(s=>s.state!=='done').map(s=>{const q=queue[s.index];return q.file.name+'\t'+({outside:'其他类型暂不上传',ready:'可上传',conflict:'重复占用',ambiguous:'多个名称候选',unmatched:'未匹配',missing:'目标已删除',error:'上传失败',discarded:'已舍弃',uploading:'上传中'}[s.state]||s.state)+'\t'+(q.message||q.reason||'')});
  const url=URL.createObjectURL(new Blob(['\uFEFF文件名\t状态\t原因\n'+lines.join('\n')],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');
  a.href=url;a.download='未上传录音清单.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

$('#upload-kind').onchange=()=>{
  if(boardLocked())return;
  boardSelected=null;boardSignature='';$('#board-episode-search').value='';$('#board-file-filter').value='active';$('#board-candidates-only').checked=false;
  for(const q of queue){
    if(q.manual||q.media||['done','discarded'].includes(q.status))continue;
    const m=StoryMatching.matchForKind(q.file.name,currentStory()?.episodes||[],uploadKind());
    q.target=m.id||(!currentStory()?.source_album_id&&!uploadKind()?'new':'');q.candidates=m.candidates||[];q.candidateScores=m.candidateScores||[];q.reason=m.reason;q.message='';q.status='waiting';
  }
  queueRender();
};
