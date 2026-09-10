(function(root) {
  const normalize = text => String(text).normalize('NFKC').toLowerCase().replace(/\.(mp3|m4a|wav|ogg|flac|aac)$/i,'').replace(/[\s\p{P}\p{S}]/gu,'');
  const stem = text => String(text).normalize('NFKC').trim().replace(/\.(mp3|m4a|wav|ogg|flac|aac)$/i,'');
  const explicitNumber = text => {
    const match = /第\s*0*(\d+)\s*集/.exec(text);
    return match ? Number(match[1]) : null;
  };
  function fileParts(filename) {
    const name=stem(filename);
    // Decimal prefixes are file ordering, never the main story's episode number.
    const prefix=/^\d+(?:\.\d+)*(?:[\s._-]+|(?=[^\d\s._-]))/.exec(name);
    const decimal=/^\d+\.\d/.test(name);
    const text=prefix ? name.slice(prefix[0].length) : name;
    const explicit=explicitNumber(text);
    const number=explicit ?? (!decimal && prefix ? Number(/^\d+/.exec(prefix[0])[0]) : /^\d+$/.test(name) ? Number(name) : null);
    return {text,number};
  }
  const episodeNumber = text => explicitNumber(stem(text));
  const withoutNumber = text => normalize(stem(text).replace(/^第\s*\d+\s*集\s*[:：._-]?\s*/, ''));
  function matchEpisode(filename, episodes) {
    const exact=episodes.filter(e=>normalize(e.title)===normalize(filename) || e.source_id && normalize(e.source_id)===normalize(filename));
    if(exact.length===1)return {id:exact[0].id,reason:'名称匹配'};
    if(exact.length>1)return {id:null,reason:'存在多个候选，请手动选择'};
    const {text,number}=fileParts(filename);
    const numbered=number===null?[]:episodes.filter(e=>episodeNumber(e.title)===number);
    const descriptive=episodes.filter(e=>withoutNumber(e.title)===withoutNumber(text));
    if(descriptive.length>1)return {id:null,reason:'存在多个候选，请手动选择'};
    if(descriptive.length===1){
      if(numbered.length===1 && numbered[0].id!==descriptive[0].id && episodeNumber(descriptive[0].title)!==null)return {id:null,reason:'集数与标题冲突，请手动选择'};
      return {id:descriptive[0].id,reason:'标题匹配'};
    }
    // Generic song names only match when the catalog explicitly identifies one song.
    if(normalize(text)==='主题曲'){
      const songs=episodes.filter(e=>/主题曲/.test(e.title+' '+(e.subtitle||'')));
      if(songs.length===1)return {id:songs[0].id,reason:'主题曲匹配，请核对'};
      return {id:null,reason:songs.length>1?'存在多个候选，请手动选择':'未找到对应分集'};
    }
    if(numbered.length===1)return {id:numbered[0].id,reason:'集数匹配，请核对'};
    return {id:null,reason:numbered.length>1?'存在多个候选，请手动选择':'未找到对应分集'};
  }
  root.StoryMatching={normalize,episodeNumber,matchEpisode};
  if(typeof module!=='undefined')module.exports=root.StoryMatching;
})(typeof window!=='undefined'?window:globalThis);

