(function(root){
  'use strict';
  const C=typeof module!=='undefined'&&module.exports?require('./app-core.js'):root.NomikaiCore;
  const S=typeof module!=='undefined'&&module.exports?require('./app-storage.js'):root.NomikaiStorage;
  const LOCAL_KEY='nomikai-workspace-v5:local';
  class Workspace{
    constructor(storage,{onChange=()=>{},onStatus=()=>{}}={}){
      this.store=new S.Store(storage);this.onChange=onChange;this.onStatus=onStatus;this.key=LOCAL_KEY;this.client=null;this.epoch=0;this.serial=0;this.busy=false;this.conflict=null;this.locked=false;this.reason='';this.timer=0;
      this.openLocal();
    }
    status(text){this.onStatus(text);}
    recover(doc,reason){return this.store.recover(doc,reason,this.key);}
    protect(error){this.locked=true;this.reason=error.message||String(error);this.status(this.reason);this.onChange();}
    openLocal(){
      this.key=LOCAL_KEY;this.locked=false;this.reason='';this.conflict=null;
      try{
        let migrated=false;
        this.meta=this.store.read(this.key,()=>{const result=C.migrateStorage(this.store.storage);migrated=result.migrated;return result.doc;});this.doc=this.meta.doc;
        if(migrated)this.persist(this.doc,true);
        this.status(migrated?'旧データを引き継ぎました。元の保存内容は残しています。':'このブラウザの端末データを利用中');
      }catch(error){this.doc=C.documentData();this.meta={version:0,dirty:false,revision:null};this.protect(error);}
    }
    persist(doc,dirty=true){
      if(this.locked)throw Error(this.reason);
      this.doc=doc;
      try{this.meta=this.store.write(this.key,doc,{version:this.meta.version,dirty},this.meta.revision);}
      catch(error){this.protect(error);throw error;}
      this.serial++;this.status(this.client?(dirty?'この端末に保存済み・同期を待っています':'クラウドと同期済み'):'このブラウザに自動保存済み');
    }
    save(doc){doc.updatedAt=new Date().toISOString();this.persist(doc,true);if(this.client&&!this.conflict){clearTimeout(this.timer);this.timer=setTimeout(()=>this.sync(),650);}}
    async connect(client){
      const expectedEpoch=this.epoch,user=await client.getUser();if(expectedEpoch!==this.epoch)return;
      clearTimeout(this.timer);this.epoch++;this.client=client;this.userId=user.id;this.busy=false;this.locked=false;this.reason='';this.conflict=null;
      this.key=`nomikai-workspace-v5:${client.config.url}:${user.id}`;
      try{this.meta=this.store.read(this.key,C.documentData);this.doc=this.meta.doc;}catch(error){this.doc=C.documentData();this.meta={version:0,dirty:false,revision:null};this.protect(error);return;}
      this.onChange();await this.sync();
    }
    checkedRemote(row){
      if(!row)return null;
      if(!Number.isSafeInteger(row.version)||row.version<1)throw Error('クラウドの版番号を確認できません。');
      return {...row,payload:C.validateDocument(row.payload)};
    }
    async sync(){
      if(!this.client||this.locked||this.conflict||this.busy)return;
      const epoch=this.epoch,client=this.client;this.busy=true;this.status('クラウドと同期中…');let again=false;
      try{
        const remote=this.checkedRemote(await client.read());if(epoch!==this.epoch)return;
        const remoteVersion=remote?.version||0;
        if(remoteVersion!==this.meta.version&&this.meta.dirty&&(!remote||S.canonical(remote.payload)!==S.canonical(this.doc))){this.conflict={remote};this.status('別の端末の更新と競合しています。編集はこの端末に保持しています。');this.onChange();return;}
        if(!remote&&this.meta.version>0){this.conflict={remote:null};this.status('クラウドの保存内容が見つかりません。端末の内容を保護しています。');this.onChange();return;}
        if(!this.meta.dirty||remote&&S.canonical(remote.payload)===S.canonical(this.doc)){
          if(remote){this.meta.version=remote.version;this.persist(remote.payload,false);this.onChange();}
          else this.status('ログイン済み。入力を始めるとクラウドにも保存します。');
          return;
        }
        const sent=C.clone(this.doc),serial=this.serial;
        const saved=this.checkedRemote(await client.write(sent,this.meta.version));if(epoch!==this.epoch)return;
        if(!saved||S.canonical(saved.payload)!==S.canonical(sent))throw Error('保存結果を確認できません。この端末の編集は保持しています。');
        this.meta.version=saved.version;again=this.serial!==serial;this.persist(this.doc,again);
      }catch(error){
        if(epoch!==this.epoch)return;
        if(error.status===409){this.conflict={remote:undefined};this.onChange();}
        this.status(error.message||'同期できませんでした。端末の編集は保持しています。');
      }finally{if(epoch===this.epoch){this.busy=false;if(again&&!this.locked&&!this.conflict){clearTimeout(this.timer);this.timer=setTimeout(()=>this.sync(),0);}}}
    }
    async resolve(choice){
      if(!this.client||!this.conflict)throw Error('同期の競合はありません。');
      const epoch=this.epoch,remote=this.checkedRemote(await this.client.read());if(epoch!==this.epoch)return;
      this.recover(this.doc,'同期の競合を解決する前の端末データ');
      if(choice==='remote'){
        this.meta.version=remote?.version||0;this.conflict=null;this.persist(remote?.payload||C.documentData(),false);this.onChange();
      }else if(choice==='local'){
        if(remote)this.recover(remote.payload,'端末の内容を送る前のクラウドデータ');
        this.meta.version=remote?.version||0;this.conflict=null;this.persist(this.doc,true);await this.sync();this.onChange();
      }else throw Error('解決方法を選んでください。');
    }
    importLocal(){
      if(!this.client)throw Error('先にログインしてください。');
      const local=this.store.read(LOCAL_KEY,()=>C.migrateStorage(this.store.storage).doc);
      this.recover(this.doc,'端末データを取り込む前のアカウントデータ');this.save(C.clone(local.doc));this.onChange();
    }
    async disconnect(){
      clearTimeout(this.timer);const epoch=++this.epoch;this.busy=false;const client=this.client;this.client=null;this.userId=null;
      let error;try{if(client)await client.logout();}catch(e){error=e;}
      if(epoch!==this.epoch)return;
      this.openLocal();this.onChange();if(error)throw error;
    }
  }
  const api={Workspace,LOCAL_KEY};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.NomikaiWorkspace=api;
})(typeof globalThis!=='undefined'?globalThis:this);
