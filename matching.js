(function(root) {
  const normalize = text => String(text).normalize('NFKC').toLowerCase().replace(/\.(mp3|m4a|wav|ogg|flac|aac)$/i,'').replace(/[\s\p{P}\p{S}]/gu,'');
  const episodeNumber = text => {
    const match = /第\s*0*(\d+)\s*集/.exec(text) || /^\s*0*(\d+)[\s._-]/.exec(text);
    return match ? Number(match[1]) : null;
  };
  function matchEpisode(filename, episodes) {
    const title = normalize(filename);
    const exact = episodes.filter(e=>normalize(e.title)===title || e.source_id && normalize(e.source_id)===title);
    if(exact.length===1) return {id:exact[0].id,reason:'名称匹配'};
    const number=episodeNumber(filename);
    const numbered=number===null?[]:episodes.filter(e=>episodeNumber(e.title)===number);
    const withoutNumber = text => normalize(String(text).replace(/^\s*第\s*\d+\s*集\s*[:：._-]?\s*|^\s*\d+[\s._-]+/,''));
    const descriptive=episodes.filter(e=>withoutNumber(e.title)===withoutNumber(filename));
    if(descriptive.length===1){
      if(numbered.length===1&&numbered[0].id!==descriptive[0].id)return {id:null,reason:'集数与标题冲突，请手动选择'};
      return {id:descriptive[0].id,reason:'标题匹配，请核对'};
    }
    if(numbered.length===1) return {id:numbered[0].id,reason:'集数匹配，请核对'};
    return {id:null,reason:exact.length>1||numbered.length>1?'存在多个候选，请手动选择':'未找到对应分集'};
  }
  root.StoryMatching={normalize,episodeNumber,matchEpisode};
  if(typeof module!=='undefined')module.exports=root.StoryMatching;
})(typeof window!=='undefined'?window:globalThis);
