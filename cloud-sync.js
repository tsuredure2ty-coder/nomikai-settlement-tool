(function(root){
  'use strict';
  class CloudError extends Error{constructor(message,status=0){super(message);this.status=status;}}
  function validateConfig(config){
    let url;try{url=new URL(config.url);}catch{throw new CloudError('SupabaseのProject URLを確認してください。');}
    if(url.protocol!=='https:'||!/^[-a-z0-9]+\.supabase\.co$/.test(url.hostname)||url.username||url.password||url.port||url.search||url.hash||!['','/'].includes(url.pathname))throw new CloudError('Project URLは https://プロジェクトID.supabase.co の形式にしてください。');
    const key=String(config.key||'').trim();
    if(!/^sb_publishable_[\w-]+$/.test(key)){
      let role;try{role=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role;}catch{}
      if(role!=='anon')throw new CloudError('公開用のpublishable keyまたはanon keyを使ってください。secret / service_roleキーは使用できません。');
    }
    return {url:url.origin,key};
  }
  class Client{
    constructor(config,{storage=root.sessionStorage,fetcher=root.fetch.bind(root),now=()=>Date.now()}={}){
      this.config=validateConfig(config);this.storage=storage;this.fetcher=fetcher;this.now=now;this.sessionKey=`nomikai-auth:${this.config.url}`;this.session=null;this.refreshing=null;this.authEpoch=0;
      const raw=storage.getItem(this.sessionKey);if(raw){try{this.session=JSON.parse(raw);}catch{storage.removeItem(this.sessionKey);}}
    }
    async request(path,{body,method='GET',token=false,retry=true}={}){
      const authEpoch=this.authEpoch;
      if(token){await this.ensureSession();if(authEpoch!==this.authEpoch)throw new CloudError('ログイン状態が変更されました。');}
      const headers={apikey:this.config.key,'Content-Type':'application/json'};
      if(token)headers.Authorization=`Bearer ${this.session.access_token}`;
      let response;try{response=await this.fetcher(this.config.url+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{}),cache:'no-store',...(typeof AbortSignal!=='undefined'&&AbortSignal.timeout?{signal:AbortSignal.timeout(15000)}:{})});}catch{throw new CloudError('通信できませんでした。この端末の編集は保持しています。');}
      const text=await response.text();let data=null;try{data=text?JSON.parse(text):null;}catch{throw new CloudError('クラウドからの応答を読み込めませんでした。',response.status);}
      if(token&&authEpoch!==this.authEpoch)throw new CloudError('ログイン状態が変更されました。');
      if(response.status===401&&token&&retry){await this.refresh();return this.request(path,{body,method,token,retry:false});}
      if(!response.ok){
        if(path.includes('grant_type=password')&&[400,401].includes(response.status))throw new CloudError(data?.error_code==='email_not_confirmed'?'Users画面で、この利用者のメールアドレスの確認状態を確認してください。':'メールアドレスまたはパスワードを確認してください。',response.status);
        const message=response.status===409?'別の端末で更新されています。同期を止めて編集を保護しています。':response.status===429?'送信回数が多いため、しばらく待ってからお試しください。':response.status===401?'ログインの有効期限が切れました。再度ログインしてください。':response.status===403?'このアカウントには利用権限がありません。接続設定を確認してください。':path.includes('/verify')?'確認コードが違うか、有効期限が切れています。':path.includes('/otp')?'コードを送信できませんでした。登録済みのメールアドレスとSupabaseの設定を確認してください。':'クラウドの処理に失敗しました。この端末の編集は保持しています。';
        throw new CloudError(message,response.status);
      }
      return data;
    }
    acceptSession(data,expectedEpoch=this.authEpoch,expectedStorage){
      if(expectedEpoch!==this.authEpoch)throw new CloudError('ログイン状態が変更されました。もう一度ログインしてください。');
      if(expectedStorage!==undefined&&this.storage.getItem(this.sessionKey)!==expectedStorage)throw new CloudError('別のログイン処理で状態が変更されました。もう一度ログインしてください。');
      if(!data||typeof data.access_token!=='string'||typeof data.refresh_token!=='string'||!data.user?.id)throw new CloudError('ログイン情報を確認できませんでした。');
      this.session={access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Number(data.expires_at)||Math.floor(this.now()/1000)+Number(data.expires_in||3600),user:{id:data.user.id}};
      this.storage.setItem(this.sessionKey,JSON.stringify(this.session));
    }
    async sendCode(email){return this.request('/auth/v1/otp',{method:'POST',body:{email,create_user:false}});}
    async signInWithPassword(email,password){
      const epoch=++this.authEpoch,stored=this.storage.getItem(this.sessionKey);
      const data=await this.request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
      this.acceptSession(data,epoch,stored);return this.getUser();
    }
    async verify(email,token){const epoch=++this.authEpoch,stored=this.storage.getItem(this.sessionKey),data=await this.request('/auth/v1/verify',{method:'POST',body:{email,token,type:'email'}});this.acceptSession(data,epoch,stored);return this.getUser();}
    async ensureSession(){if(!this.session?.refresh_token)throw new CloudError('先にログインしてください。',401);if(this.session.expires_at<=this.now()/1000+60)await this.refresh();}
    async refresh(){
      const epoch=this.authEpoch;
      if(this.refreshing?.epoch===epoch)return this.refreshing.promise;
      if(!this.session?.refresh_token)throw new CloudError('再度ログインしてください。',401);
      const refreshToken=this.session.refresh_token;
      const stored=this.storage.getItem(this.sessionKey);
      const promise=(async()=>{try{const data=await this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:refreshToken}});this.acceptSession(data,epoch,stored);}catch(error){if(epoch===this.authEpoch&&(error.status===400||error.status===401)){if(this.storage.getItem(this.sessionKey)===stored)this.storage.removeItem(this.sessionKey);this.session=null;this.authEpoch++;}throw error;}finally{if(this.refreshing?.epoch===epoch)this.refreshing=null;}})();this.refreshing={epoch,promise};return promise;
    }
    async getUser(){
      const epoch=this.authEpoch,user=await this.request('/auth/v1/user',{token:true});
      if(epoch!==this.authEpoch)throw new CloudError('ログイン状態が変更されました。');
      if(!user||!/^[0-9a-f-]{36}$/i.test(user.id))throw new CloudError('アカウントを確認できませんでした。');
      this.session.user={id:user.id};
      const allowed=await this.request('/rest/v1/nomikai_allowed_users?select=user_id',{token:true});
      if(epoch!==this.authEpoch)throw new CloudError('ログイン状態が変更されました。');
      if(!Array.isArray(allowed)||!allowed.some(row=>row.user_id===user.id))throw new CloudError('利用者の登録が必要です。CLOUD_SETUP.mdの本人登録を確認してください。',403);
      return {id:user.id};
    }
    async read(){
      const user=this.session?.user?.id;if(!user)throw new CloudError('先にログインしてください。',401);
      const rows=await this.request(`/rest/v1/nomikai_workspaces?select=payload,version,updated_at&user_id=eq.${encodeURIComponent(user)}`,{token:true});
      if(!Array.isArray(rows)||rows.length>1)throw new CloudError('保存内容を確認できませんでした。');return rows[0]||null;
    }
    async write(payload,expectedVersion){return this.request('/rest/v1/rpc/save_nomikai_workspace',{method:'POST',body:{p_payload:payload,p_expected_version:expectedVersion},token:true});}
    async logout(){const epoch=++this.authEpoch;try{if(this.session)await this.request('/auth/v1/logout?scope=local',{method:'POST',token:true});}finally{if(epoch===this.authEpoch){let stored;try{stored=JSON.parse(this.storage.getItem(this.sessionKey));}catch{}if(stored?.refresh_token&&stored.refresh_token===this.session?.refresh_token)this.storage.removeItem(this.sessionKey);this.session=null;this.authEpoch++;}}}
  }
  const api={Client,CloudError,validateConfig};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.NomikaiCloud=api;
})(typeof globalThis!=='undefined'?globalThis:this);
