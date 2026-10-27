(function(root){
  'use strict';
  const Core=typeof module!=='undefined'&&module.exports?require('./app-core.js'):root.NomikaiCore;
  class LocalConflict extends Error{constructor(){super('別のタブで保存内容が変わりました。バックアップを保存し、再読み込みしてください。');this.name='LocalConflict';}}
  class Store{
    constructor(storage){this.storage=storage;}
    read(key,fallback){
      const raw=this.storage.getItem(key);if(!raw)return {doc:fallback(),version:0,dirty:false,revision:null};
      const item=JSON.parse(raw);Core.validateDocument(item.doc);
      if(!Number.isSafeInteger(item.version)||item.version<0||typeof item.dirty!=='boolean'||typeof item.revision!=='string')throw Error('保存データを読み込めません。上書きを止めています。');
      return item;
    }
    write(key,doc,meta,expectedRevision){
      const current=this.storage.getItem(key);
      if((current?JSON.parse(current).revision:null)!==expectedRevision)throw new LocalConflict();
      const item={doc:Core.validateDocument(doc),version:meta.version,dirty:meta.dirty,revision:Core.id()};
      const raw=JSON.stringify(item);if(raw.length>2*1024*1024)throw Error('保存データが大きすぎます。バックアップを保存してください。');
      this.storage.setItem(key,raw);return item;
    }
    recover(doc,reason,scope='local'){
      const key=`nomikai-recovery:${encodeURIComponent(scope)}:${Date.now()}:${Core.id()}`;
      this.storage.setItem(key,JSON.stringify({reason,document:doc}));return key;
    }
    replaceProtected(key,doc,meta){
      const raw=this.storage.getItem(key);
      if(raw!==null)this.storage.setItem(`nomikai-protected:${encodeURIComponent(key)}:${Date.now()}:${Core.id()}`,raw);
      const item={doc:Core.validateDocument(doc),version:meta.version||0,dirty:true,revision:Core.id()};
      this.storage.setItem(key,JSON.stringify(item));return item;
    }
    recoveries(scope){
      const prefixes=['nomikai-recovery:','nomikai-protected:'].map(prefix=>prefix+encodeURIComponent(scope)+':');const entries=[];
      for(let i=0;i<this.storage.length;i++){
        const key=this.storage.key(i),prefix=prefixes.find(prefix=>key?.startsWith(prefix));if(!prefix)continue;
        const time=Number(key.slice(prefix.length).split(':')[0]);if(!Number.isFinite(time))continue;
        const raw=this.storage.getItem(key);let parsed;try{parsed=JSON.parse(raw);}catch{}
        entries.push({key,raw,time,reason:parsed?.reason||'読み込めなかった元の保存内容',document:parsed?.document||parsed?.doc||null});
      }
      return entries.sort((a,b)=>b.time-a.time).slice(0,5);
    }
  }
  function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
  const api={Store,LocalConflict,canonical};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.NomikaiStorage=api;
})(typeof globalThis!=='undefined'?globalThis:this);
