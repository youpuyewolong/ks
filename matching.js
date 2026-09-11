(function(root) {
  const normalize = text => String(text).normalize('NFKC').toLowerCase().replace(/\.(mp3|m4a|wav|ogg|flac|aac)$/i,'').replace(/[\s\p{P}\p{S}]/gu,'');
  const stem = text => String(text).normalize('NFKC').trim().replace(/\.(mp3|m4a|wav|ogg|flac|aac)$/i,'');
  const explicitNumber = text => {
    const match = /第\s*0*(\d+)\s*集/.exec(text);
    return match ? Number(match[1]) : null;
  };
  const episodeNumber = text => explicitNumber(stem(text));
  // Strip only leading file/episode numbering; numbers inside a title remain meaningful.
  const titleKey = text => normalize(stem(text)
    .replace(/^\d+(?:\.\d+)*(?:[\s._、:：-]+|(?=[^\d\s._-])|$)/,'')
    .replace(/^第\s*[\d零〇一二三四五六七八九十百千两]+\s*[集章回]\s*[:：._、-]?\s*/,''));
  function similarity(a,b){
    if(!a||!b)return 0;
    const left=Array.from(a),right=Array.from(b);let row=right.map((_,i)=>i+1);row.unshift(0);
    for(let i=1;i<=left.length;i++){const next=[i];for(let j=1;j<=right.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(left[i-1]===right[j-1]?0:1));row=next}
    return 1-row[right.length]/Math.max(left.length,right.length);
  }
  function matchEpisode(filename,episodes){
    const key=titleKey(filename);
    if(!key)return {id:null,reason:'文件名缺少故事名称，请手动选择',candidates:[]};
    const exact=episodes.filter(e=>titleKey(e.title)===key);
    if(exact.length===1)return {id:exact[0].id,score:1,reason:'名称匹配 100%'};
    if(exact.length>1)return {id:null,reason:'名称相同的分集有多个，请手动选择',candidates:exact.map(e=>e.id)};
    if(key==='主题曲'){
      const songs=episodes.filter(e=>/主题曲/.test(e.title+' '+(e.subtitle||'')));
      if(songs.length===1)return {id:songs[0].id,reason:'主题曲标签匹配，请核对'};
      if(songs.length>1)return {id:null,reason:'存在多个主题曲，请手动选择',candidates:songs.map(e=>e.id)};
    }
    const candidates=episodes.map(e=>({id:e.id,score:similarity(key,titleKey(e.title))})).filter(e=>e.score>=0.7).sort((a,b)=>b.score-a.score);
    if(candidates.length===1)return {id:candidates[0].id,score:candidates[0].score,reason:'名称相似度 '+Math.round(candidates[0].score*100)+'%'};
    if(candidates.length>1)return {id:null,reason:'多个名称相似度达到 70%，请手动选择',candidates:candidates.map(e=>e.id),candidateScores:candidates};
    return {id:null,reason:'名称相似度未达到 70%，请手动选择',candidates:[]};
  }
  function matchForKind(filename,episodes,kind=''){
    const all=matchEpisode(filename,episodes);
    if(!kind)return all;
    // A full-catalog exact match to another kind must not become a fuzzy match here.
    if(all.id&&(episodes.find(e=>e.id===all.id)?.kind||'故事')!==kind)return all;
    const scoped=matchEpisode(filename,episodes.filter(e=>(e.kind||'故事')===kind));
    return scoped.id||scoped.candidates?.length?scoped:all;
  }
  function analyzeQueue(queue,episodes,kind=''){
    const outside=q=>!!kind&&(q.target==='new'||q.target&&episodes.some(e=>e.id===q.target&&(e.kind||'故事')!==kind)||!q.target&&q.candidates?.length&&q.candidates.every(id=>episodes.some(e=>e.id===id&&(e.kind||'故事')!==kind)));
    const ids=new Set(episodes.map(e=>e.id)),owners=new Map();
    queue.forEach((q,i)=>{if(!outside(q)&&!['done','discarded'].includes(q.status)&&q.target&&q.target!=='new'){if(!owners.has(q.target))owners.set(q.target,[]);owners.get(q.target).push(i)}});
    return queue.map((q,i)=>{
      const peers=owners.get(q.target)||[];
      const state=q.status==='discarded'?'discarded':q.status==='done'?'done':q.status==='uploading'?'uploading':outside(q)?'outside':q.target&&q.target!=='new'&&!ids.has(q.target)?'missing':peers.length>1?'conflict':q.status==='error'?'error':!q.target?(q.candidates?.length?'ambiguous':'unmatched'):'ready';
      return {index:i,state,peers:state==='conflict'?peers.filter(n=>n!==i):[],ready:state==='ready'||(state==='error'&&!!q.target),issue:['conflict','ambiguous','unmatched','missing','error'].includes(state)};
    });
  }
  function orderFiles(queue,episodes,mode='catalog'){
    const position=new Map(episodes.map((e,i)=>[e.id,i]));
    const rank=q=>{
      if(position.has(q.target))return position.get(q.target);
      const candidates=(q.candidates||[]).filter(id=>position.has(id)).map(id=>position.get(id));
      if(candidates.length)return Math.min(...candidates);
      const n=explicitNumber(q.file.name)??Number(/^\s*(\d+)/.exec(q.file.name)?.[1]);
      const i=episodes.findIndex(e=>episodeNumber(e.title)===n);
      return i<0?Infinity:i;
    };
    return queue.map((q,i)=>i).sort((a,b)=>mode==='added'?a-b:(mode==='catalog'?(rank(queue[a])-rank(queue[b])||0):0)||queue[a].file.name.localeCompare(queue[b].file.name,'zh-CN',{numeric:true})||a-b);
  }
  root.StoryMatching={normalize,episodeNumber,titleKey,similarity,matchEpisode,matchForKind,analyzeQueue,orderFiles};
  if(typeof module!=='undefined')module.exports=root.StoryMatching;
})(typeof window!=='undefined'?window:globalThis);

