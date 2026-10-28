(() => {
  'use strict';
  const C=NomikaiCore,$=id=>document.getElementById(id),esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const yen=value=>`${Number(value||0).toLocaleString('ja-JP')}円`;
  const view=$('view'),editor=$('editor'),editorForm=$('editorForm');
  const ui={page:'current',step:0,layout:'list',edit:null,toastTimer:0,sentEmail:'',resendAt:0};
  let workspace,initializing=true,storage;
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(ui.toastTimer);ui.toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
  function status(message){$('saveStatus').textContent=message;}
  function errorMessage(error){toast(error.message||'処理できませんでした。入力内容を確認してください。');}
  try{storage=window.localStorage;storage.getItem('nomikai-storage-check');}
  catch{storage={getItem(){throw Error('端末保存を利用できません。ブラウザの設定を確認してください。');},setItem(){throw Error('端末保存を利用できません。');}};}
  workspace=new NomikaiWorkspace.Workspace(storage,{onStatus:status,onChange:()=>{if(!initializing)render();}});
  initializing=false;
  function options(items,value){return items.map(([key,label])=>`<option value="${esc(key)}"${String(key)===String(value)?' selected':''}>${esc(label)}</option>`).join('');}
  function select(label,key,items,value){return `<label class="row-field"><span>${label}</span><select data-setting="${key}">${options(items,value)}</select></label>`;}
  function field(label,key,value,type='text',extra=''){return `<label class="field"><span>${label}</span><input name="${key}" type="${type}" value="${esc(value)}" ${extra}></label>`;}
  function empty(title,text,action,label){return `<div class="empty"><span class="empty-mark" aria-hidden="true">＋</span><h3>${title}</h3><p>${text}</p>${action?`<button type="button" class="primary-button" data-action="${action}">${label}</button>`:''}</div>`;}
  function confirmAction(message,label='続ける'){
    return new Promise(resolve=>{
      const dialog=$('confirmation');$('confirmationMessage').textContent=message;$('confirmationAccept').textContent=label;
      const finish=value=>{dialog.close();$('confirmationAccept').onclick=null;$('confirmationCancel').onclick=null;dialog.oncancel=null;resolve(value);};
      $('confirmationAccept').onclick=()=>finish(true);$('confirmationCancel').onclick=()=>finish(false);dialog.oncancel=event=>{event.preventDefault();finish(false);};dialog.showModal();$('confirmationCancel').focus();
    });
  }
  async function change(mutator,{financial=false,renderAll=true}={}){
    if(workspace.locked)throw Error(workspace.reason);
    const hasCollection=workspace.doc.draft.members.some(m=>m.collected);
    if(financial&&hasCollection&&!await confirmAction('支払額が変わるため、今回の「集金済み」チェックを解除して再確認します。変更を続けますか？','変更する')){render();return false;}
    const next=C.clone(workspace.doc);next.draft.roleRules=C.roleRulesFor(next.draft);mutator(next);if(financial)C.clearCollection(next.draft);workspace.save(next);
    if(renderAll)render();else refreshResults();return true;
  }
  function renderProtection(){
    const panel=$('protection');panel.hidden=!workspace.locked&&!workspace.conflict;
    if(workspace.locked){panel.innerHTML=`${esc(workspace.reason)}<br>元の保存内容への上書きを止めています。<div class="button-row"><button type="button" class="secondary-button" data-action="backup">画面の入力をバックアップ</button><button type="button" class="secondary-button" data-action="raw-backup">元の保存内容をバックアップ</button></div>`;}
    else if(workspace.conflict){panel.innerHTML='別の端末で更新されています。自動上書きを止め、両方の内容を保護しています。<div class="button-row"><button type="button" class="secondary-button" data-action="resolve-remote">クラウド版を使う</button><button type="button" class="secondary-button" data-action="resolve-local">この端末の内容を送る</button><button type="button" class="secondary-button" data-action="backup">バックアップ</button></div>';}
    $('accountButton').textContent=workspace.client?'ログイン中':'端末で利用中';$('syncButton').hidden=!workspace.client;
  }
  function render(){
    renderProtection();document.querySelectorAll('[data-page]').forEach(button=>{if(button.dataset.page===ui.page)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
    if(ui.page==='current')renderCurrent();else if(ui.page==='templates')renderTemplates();else if(ui.page==='history')renderHistory();else renderSettings();
  }
  function renderCurrent(){
    const e=workspace.doc.draft,r=C.calculate(e),templates=workspace.doc.templates;
    const openDetails=new Set(Array.from(view.querySelectorAll('.details[open]'),el=>el.querySelector('summary')?.textContent));
    const focused=document.activeElement,focusKey=['data-setting','data-detail','data-money'].find(key=>focused?.hasAttribute(key));
    const focusValue=focusKey?focused.getAttribute(focusKey):null;
    view.innerHTML=`<div class="heading"><div><p class="eyebrow">YOUR GATHERING</p><h1>今日の清算。</h1><p class="subtitle">いつものメンバーで、さっと整える。</p></div><div class="view-switch" aria-label="画面の表示方法"><button data-action="layout-list" type="button" aria-pressed="${ui.layout==='list'}">一覧</button><button data-action="layout-steps" type="button" aria-pressed="${ui.layout==='steps'}">順番に</button></div></div>
    <div class="mobile-step ${ui.layout==='steps'?'steps-active':''}" aria-label="清算の手順">${['会計・傾斜','参加者・確認'].map((name,i)=>`<button type="button" data-step="${i}" aria-pressed="${ui.step===i}">${name}</button>`).join('')}</div>
    <div class="layout ${ui.layout==='steps'?'steps-mode':''}">
      <div class="stack ${ui.step!==0?'step-hidden':''}">
        <section class="panel"><div class="panel-header"><h2>今回の飲み会</h2><span class="count">${esc(e.date)}</span></div>
          ${templates.length?`<label class="field"><span>テンプレートから始める</span><select id="quickTemplate"><option value="">テンプレートを選ぶ</option>${options(templates.map(t=>[t.id,`${t.name} · ${t.event.members.length}人`]),'')}</select></label>`:''}
          <label class="amount-field"><span class="amount-label">お会計の総額</span><span class="amount-input-wrap"><input aria-label="お会計の総額（円）" data-money="totalAmount" type="number" inputmode="numeric" min="1" step="1" placeholder="20,000" value="${e.totalAmount===null?'':esc(e.totalAmount)}"><span>円</span></span></label>
          <details class="details"><summary>イベント名・日付・補助</summary>${field('イベント名','eventName',e.eventName,'text','maxlength="120" data-detail="eventName" placeholder="例：部署の懇親会"')}${field('開催日','date',e.date,'date','data-detail="date" required')}<label class="row-field"><span>会社補助・差し入れ</span><input data-money="subsidy" type="number" aria-label="会社補助・差し入れ（円）" inputmode="numeric" min="0" step="1" value="${esc(e.subsidy)}"></label><p class="helper">参加者が分ける金額から差し引きます。1人あたりではなく、会全体の合計額です。</p></details>
        </section>
        <section class="panel"><div class="panel-header"><h2>今回の傾斜</h2><button class="text-button" type="button" data-action="rules">詳細を変更</button></div>
          ${e.paymentMode==='weighted'?'<div class="notice">以前の倍率を引き継いでいます。<button type="button" class="text-button" data-action="amount-mode">新しい傾斜方式に切り替える</button></div>':`${select('役職','roleLevel',[[0,'なし'],[.5,'ゆるめ'],[1,'標準'],[1.5,'強め']],e.roleLevel)}${select('勤務形態','workLevel',[[0,'なし'],[.5,'ゆるめ'],[1,'標準'],[1.5,'強め']],e.workLevel)}${select('性別','genderLevel',[[0,'調整なし'],[500,'女性 −500円'],[1000,'女性 −1,000円']],e.genderLevel)}<p class="rule-hint">基準額との差：部長 ${yen((e.roleRules['部長']||0)*e.roleLevel)} / 嘱託 ${yen((e.workRules['嘱託']||0)*e.workLevel)}<br>差額を合算し、総額に合うように基準額を計算します。</p>`}
        </section>
        <section class="panel"><div class="panel-header"><h2>端数の調整</h2></div>${select('丸め単位','roundUnit',C.UNITS.map(n=>[n,yen(n)]),e.roundUnit)}${select('端数を負担','adjustmentMode',[['organizer','幹事'],['top','役職が上の人'],['all','自動計算の人で均等']],e.adjustmentMode)}<p class="helper">幹事は参加者の名前を開いて選べます。固定額・免除・欠席の人は端数の対象外です。</p></section>
        <button type="button" class="primary-button next-step" data-action="next-step">参加者を確認する</button>
      </div>
      <div class="stack ${ui.step!==1?'step-hidden':''}">
        <section class="panel"><div class="panel-header"><h2>参加者</h2><span class="count">${r.activeCount}人参加</span><button class="text-button" type="button" data-action="add-member">＋ 追加</button></div><div id="memberRows" class="member-list">${memberRows(e,r)}</div></section>
        <section class="panel summary" aria-labelledby="summaryTitle"><div class="panel-header"><h2 id="summaryTitle">清算の確認</h2></div><div class="summary-numbers"><div><small>参加者の負担合計</small><strong id="netTotal">${yen(r.netAmount)}</strong></div><div><small>未集金</small><strong id="outstanding">${r.error?'—':yen(r.outstanding)}</strong></div></div><p id="calculationNote" class="balance-note ${r.error?'error':''}" role="${r.error?'alert':'status'}">${esc(r.note)}</p><div class="button-row"><button type="button" class="primary-button" data-action="finalize"${r.error?' disabled':''}>この内容で確定</button><button type="button" class="secondary-button" data-action="share"${r.error?' disabled':''}>共有</button></div><button type="button" class="text-button block-button" data-action="save-template">このメンバーと配分をテンプレートに保存</button></section>
      </div>
    </div>`;
    view.querySelectorAll('.details').forEach(el=>{if(openDetails.has(el.querySelector('summary')?.textContent))el.open=true;});
    if(focusKey)view.querySelector(`[${focusKey}="${focusValue}"]`)?.focus({preventScroll:true});
  }
  function memberRows(e,r){
    if(!e.members.length)return empty('メンバーを登録しましょう','名前をまとめて貼り付けて追加できます。','add-member','参加者を追加');
    return r.rows.map(m=>`<div class="member-row ${m.included?'':'excluded'}"><label class="check-label"><input type="checkbox" data-include="${esc(m.id)}" aria-label="${esc(m.name)}が参加"${m.included?' checked':''}></label><button type="button" class="member-name-button" data-edit="${esc(m.id)}"><span class="member-name">${esc(m.name||'名無し')}${m.id===e.organizerId?'<span class="badge">幹事</span>':''}</span><span class="member-meta">${esc(m.role)} · ${esc(m.employment)}${m.isFixed?(m.fixedAmount===0?' · 免除':' · 金額指定'):e.paymentMode==='weighted'?` · ${esc(m.rate)}倍`:''} ⌄</span></button><div class="payment"><button class="amount-button" type="button" data-edit="${esc(m.id)}" aria-label="${esc(m.name)}の支払額 ${!m.included?'欠席':r.error?'未計算':yen(m.finalAmount)}を編集">${!m.included?'欠席':r.error?'—':yen(m.finalAmount)}</button><label class="collection-label"><input type="checkbox" data-collected="${esc(m.id)}"${m.collected?' checked':''}${r.error||!m.included||!m.finalAmount?' disabled':''}>${!m.included?'対象外':!r.error&&m.finalAmount===0?'集金不要':'集金済み'}</label></div></div>`).join('');
  }
  function refreshResults(){
    if(ui.page!=='current')return;const r=C.calculate(workspace.doc.draft),e=workspace.doc.draft;
    $('memberRows').innerHTML=memberRows(e,r);$('netTotal').textContent=yen(r.netAmount);$('outstanding').textContent=r.error?'—':yen(r.outstanding);$('calculationNote').textContent=r.note;$('calculationNote').classList.toggle('error',!!r.error);$('calculationNote').setAttribute('role',r.error?'alert':'status');
    view.querySelectorAll('[data-action="finalize"],[data-action="share"]').forEach(button=>button.disabled=!!r.error);renderProtection();
  }
  function renderTemplates(){
    const templates=workspace.doc.templates;
    view.innerHTML=`<div class="heading"><div><p class="eyebrow">YOUR REGULARS</p><h1>いつもの集まり。</h1><p class="subtitle">メンバーも、分け方も、まとめて保存。</p></div><button type="button" class="primary-button" data-action="save-template">＋ 保存</button></div>${templates.length?`<div class="template-grid">${templates.map(t=>`<section class="panel template-card"><h2>${esc(t.name)}</h2><p class="subtitle">${t.event.members.length}人 · ${yen(t.event.roundUnit)}単位</p><p class="helper">${t.event.members.slice(0,8).map(m=>esc(m.name)).join('、')}${t.event.members.length>8?' ほか':''}</p><div class="button-row"><button class="primary-button" type="button" data-load-template="${esc(t.id)}">このメンバーで始める</button><button class="secondary-button" type="button" data-update-template="${esc(t.id)}">名前・保存内容</button></div></section>`).join('')}</div>`:`<section class="panel">${empty('いつものメンバーを、ひとつに。','今回の清算でメンバーを登録してから保存できます。','to-current','今回の清算を開く')}</section>`}`;
  }
  function renderHistory(){
    const history=workspace.doc.history;
    view.innerHTML=`<div class="heading"><div><p class="eyebrow">PAST GATHERINGS</p><h1>これまでの清算。</h1><p class="subtitle">直近5回。確定した金額はそのままに。</p></div></div>${history.length?`<div class="history-list">${history.map(h=>{const active=h.event.members.filter(m=>m.included),collected=active.reduce((sum,m)=>sum+(h.collection[m.id]?h.amounts[m.id]:0),0);return `<details class="panel history-card"><summary><span><h2>${esc(h.event.eventName||'飲み会')}</h2><span class="member-meta">${esc(h.event.date)} · ${active.length}人</span></span><strong>${yen(h.netAmount)} ⌄</strong></summary><div class="history-stats"><span>会計 ${yen(h.event.totalAmount)}${h.event.subsidy?` · 補助 ${yen(h.event.subsidy)}`:''}</span><span>未集金 ${yen(h.netAmount-collected)}</span></div>${active.map(m=>`<div class="member-row"><span class="member-name">${esc(m.name)}<span class="member-meta">${esc(m.role)} · ${esc(m.employment)}</span></span><div class="payment"><span class="amount-button">${yen(h.amounts[m.id])}</span><label class="collection-label"><input type="checkbox" data-history-collected="${esc(h.id)}" data-member="${esc(m.id)}"${h.collection[m.id]?' checked':''}${h.amounts[m.id]===0?' disabled':''}>${h.amounts[m.id]===0?'集金不要':'集金済み'}</label></div></div>`).join('')}<p class="helper">${esc(h.note)}</p><div class="button-row"><button type="button" class="primary-button" data-reuse="${esc(h.id)}">次の飲み会に使う</button><button type="button" class="secondary-button" data-share-history="${esc(h.id)}">共有</button></div></details>`;}).join('')}</div>`:`<section class="panel">${empty('清算の記録を、ここに。','「この内容で確定」で、金額と条件を保存します。','to-current','今回の清算を開く')}</section>`}`;
  }
  function getConfig(){const raw=storage.getItem('nomikai-cloud-config-v1');if(raw)return NomikaiCloud.validateConfig(JSON.parse(raw));const shared=window.NOMIKAI_PUBLIC_CONFIG;return shared?.url&&shared?.key?NomikaiCloud.validateConfig(shared):null;}
  function renderSettings(){
    let config=null;try{config=getConfig();}catch{}
    const recoveries=workspace.store.recoveries(workspace.key);
    view.innerHTML=`<div class="heading"><div><p class="eyebrow">YOUR WORKSPACE</p><h1>どの端末でも。</h1><p class="subtitle">PCで準備して、スマホで続きを。</p></div></div><div class="settings-layout"><section class="panel"><h2>${workspace.client?'アカウントで同期中':'ログインと同期'}</h2>${workspace.client?`<p class="helper">このアカウントのメンバー・テンプレート・履歴を同期します。端末用のデータは別に保管されています。</p><div class="button-row"><button type="button" class="primary-button" data-action="sync">今すぐ同期</button><button type="button" class="secondary-button" data-action="import-local">端末データを取り込む</button><button type="button" class="secondary-button" data-action="logout">ログアウト</button></div>`:`<p class="helper">登録したメールアドレスとパスワードでログインします。</p><form id="passwordLoginForm">${field('登録済みのメールアドレス','email',ui.sentEmail,'email','autocomplete="username" required')}${field('利用者を作成したときのパスワード','password','','password','autocomplete="current-password" required')}<button class="primary-button" type="submit"${!config?' disabled':''}>ログイン</button></form><p class="helper">SupabaseのUsersで利用者を作成した際のパスワードを使います。データベース用のパスワードとは別です。</p><details class="details"><summary>確認コードでログイン</summary><p class="helper">確認コードを送れるよう、メールの設定を済ませた場合に利用できます。</p><form id="loginForm">${field('登録済みのメールアドレス','email',ui.sentEmail,'email','autocomplete="email" required')}<button class="primary-button" type="submit" data-otp-send${!config?' disabled':''}>確認コードを送信</button></form>${ui.sentEmail?`<form id="verifyForm" class="compact-field">${field('メールに届いた確認コード','token','','text','inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" minlength="6" maxlength="10" required')}<button class="primary-button" type="submit">ログイン</button></form>`:''}</details>`}</section>
    <section class="panel"><h2>クラウドの接続先</h2><form id="configForm">${field('Supabase Project URL','url',config?.url||'','url',`placeholder="https://project-id.supabase.co" autocomplete="off" required ${workspace.client?' disabled':''}`)}${field('公開用 publishable key / anon key','key',config?.key||'','text',`placeholder="sb_publishable_…" autocomplete="off" spellcheck="false" required ${workspace.client?' disabled':''}`)}<p class="helper">公開用キーを使います。secret key・service_roleキーは入力しないでください。ログイン情報はこのタブ内で保持します。</p><button class="secondary-button" type="submit"${workspace.client?' disabled':''}>接続設定を保存</button></form></section>
    <section class="panel"><h2>バックアップ</h2><p class="helper">バックアップにログイン情報や接続キーは含みません。旧版のバックアップも読み込めます。</p><div class="button-row"><button type="button" class="secondary-button" data-action="backup">バックアップを保存</button><label class="secondary-button">バックアップを読み込む<input id="importFile" type="file" accept="application/json,.json" hidden></label></div></section>
    ${recoveries.length?`<section class="panel"><h2>この保存先の復旧用データ</h2><p class="helper">置き換え前の内容を最大5件表示します。この端末に保管され、クラウドへは送信されません。</p>${recoveries.map(item=>`<div class="row-field"><span>${esc(new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(item.time)))}</span><button type="button" class="text-button" data-recovery="${esc(item.key)}">${item.document?'内容を復元':'元の内容を保存'}</button></div><p class="helper">${esc(item.reason)}</p>`).join('')}</section>`:''}</div>`;
    if(ui.sentEmail)updateResendButton();
  }
  function updateResendButton(){const button=view.querySelector('[data-otp-send]');if(!button)return;const seconds=Math.max(0,Math.ceil((ui.resendAt-Date.now())/1000));button.disabled=seconds>0;button.textContent=seconds?`再送まで ${seconds}秒`:'確認コードを送信';if(seconds)setTimeout(()=>{if(ui.page==='settings')updateResendButton();},1000);}
  function openEditor(title,body,type,extra={}){ui.edit={type,...extra};$('editorContent').innerHTML=`<h2 id="editorTitle">${title}</h2>${body}<div class="dialog-actions"><button class="secondary-button" type="button" data-close-editor>キャンセル</button><button class="primary-button" type="submit">保存する</button></div>`;editor.showModal();const input=editor.querySelector('input:not([type=checkbox]),textarea,select');input?.focus();}
  function openMember(memberId){
    const e=workspace.doc.draft,m=e.members.find(m=>m.id===memberId);if(!m)return;
    openEditor('参加者の設定',`${field('名前','name',m.name,'text','required maxlength="120" autocomplete="off"')}<div class="field-grid"><label class="field"><span>役職</span><select name="role">${options(Object.keys(C.roleRulesFor(e)).map(name=>[name,name]),m.role)}</select></label><label class="field"><span>勤務形態</span><select name="employment">${options(Object.keys(e.workRules).map(name=>[name,name]),m.employment)}</select></label><label class="field"><span>性別</span><select name="gender">${options(['未設定','男性','女性'].map(name=>[name,name]),m.gender)}</select></label><label class="field"><span>支払方法</span><select id="memberPaymentMode" name="payment">${options([['auto','自動計算'],['fixed','金額を指定'],['exempt','免除（0円）']],m.fixedAmount===null?'auto':m.fixedAmount===0?'exempt':'fixed')}</select></label></div><div id="fixedField"${m.fixedAmount===null||m.fixedAmount===0?' hidden':''}>${field('指定する金額（円）','fixedAmount',m.fixedAmount??'','number','inputmode="numeric" min="0" step="1"')}<p class="helper">この金額を維持し、残りを自動計算の人で分けます。</p></div>${field(e.paymentMode==='weighted'?'個別の倍率':'個別の多め・少なめ（円）',e.paymentMode==='weighted'?'rate':'offset',e.paymentMode==='weighted'?m.rate:m.offset,'number',e.paymentMode==='weighted'?'min="0" step="0.01" inputmode="decimal"':'step="1" inputmode="decimal"')}<label class="check-label"><input name="organizer" type="checkbox"${e.organizerId===m.id?' checked':''}>この人を幹事にする</label><p class="helper">幹事は1人です。固定額・免除・欠席の場合、端数は負担できません。</p><details class="details"><summary>参加者を外す</summary><button class="danger-button" type="button" data-remove-member="${esc(m.id)}">今回の参加者から削除</button></details>`,'member',{memberId});
    toggleFixedField();
  }
  function toggleFixedField(){const select=$('memberPaymentMode');if(!select)return;const fixed=select.value==='fixed';$('fixedField').hidden=!fixed;const input=editorForm.elements.fixedAmount;input.required=fixed;input.disabled=!fixed;}
  function openAdd(){const e=workspace.doc.draft;openEditor('参加者をまとめて追加','<label class="field"><span>名前（1行に1人）</span><textarea name="names" rows="5" placeholder="田中\n佐藤\n鈴木" required maxlength="12000"></textarea></label>'+`<div class="field-grid"><label class="field"><span>役職</span><select name="role">${options(Object.keys(C.roleRulesFor(e)).map(x=>[x,x]),'一般')}</select></label><label class="field"><span>勤務形態</span><select name="employment">${options(Object.keys(e.workRules).map(x=>[x,x]),'正社員')}</select></label></div><p class="helper">後から1人ずつ役職や勤務形態を変更できます。</p>`,'add');}
  function openTemplate(templateId){const e=workspace.doc.draft,t=workspace.doc.templates.find(t=>t.id===templateId);if(!e.members.length&&!t){toast('先に参加者を登録してください。');return;}openEditor(t?'テンプレートを変更':'テンプレートに保存',`${field('テンプレート名','name',t?.name||e.eventName||'','text','required maxlength="80" placeholder="例：部署の飲み会"')}${t?'<label class="check-label"><input name="replaceMembers" type="checkbox">今回のメンバー・配分設定で上書き</label><p class="helper">テンプレート名だけの変更は、チェックせず保存できます。保存した参加者の名前を直すには、先にこのテンプレートを呼び出して参加者名を修正し、ここでチェックして保存してください。</p>':'<p class="helper">メンバー・固定額・幹事・傾斜・端数設定を保存します。総額・補助・当日の出欠・集金済みは保存しません。</p>'}`,'template',{templateId});}
  function openRules(){const e=workspace.doc.draft;openEditor('標準の配分ルール',`<p class="dialog-subtitle">基準額との差です。「ゆるめ」は0.5倍、「強め」は1.5倍になります。今回だけの変更で、保存済みテンプレートには反映しません。</p><h3>役職</h3><div class="field-grid">${Object.entries(C.roleRulesFor(e)).map(([name,value],i)=>field(`${esc(name)}（円）`,`role_${i}`,value,'number','step="1" inputmode="decimal" required')).join('')}</div><h3>勤務形態</h3><div class="field-grid">${Object.entries(e.workRules).map(([name,value],i)=>field(`${esc(name)}（円）`,`work_${i}`,value,'number','step="1" inputmode="decimal" required')).join('')}</div>`,'rules');}
  function download(name,data){const text=JSON.stringify(data,null,2),url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  function backup(){download(`nomikai-${C.today()}.json`,{kind:'nomikai-v5-backup',schemaVersion:5,exportedAt:new Date().toISOString(),document:workspace.doc});toast('バックアップの保存先を確認してください。');}
  function rawBackup(){const keys=['nomikai-workspace-v5:local','nomikai-settlement-v4','nomikai-settlement-v3','nomikai-settlement-v2','nomikai-settlement-v1','nomikai-member-templates-v2','nomikai-member-template-v1'];if(workspace.key&&!keys.includes(workspace.key))keys.push(workspace.key);download('nomikai-original-data.json',{kind:'nomikai-protected-data',savedAt:new Date().toISOString(),entries:keys.map(key=>({key,raw:storage.getItem(key)})).filter(item=>item.raw!==null)});}
  async function importBackup(file){
    if(!file||file.size>2*1024*1024)throw Error('2MB以下のバックアップファイルを選んでください。');
    const data=JSON.parse(await file.text());let doc;
    if(data.kind==='nomikai-v5-backup')doc=C.validateDocument(data.document);
    else if(data.kind==='nomikai-backup'){
      doc=C.documentData();doc.draft=C.migrateEvent(data.state);if(!data.templates||!Array.isArray(data.templates.slots)||data.templates.slots.length>3)throw Error('旧テンプレートを読み込めません。');doc.templates=data.templates.slots.filter(Boolean).map((t,i)=>({id:C.id(),name:String(t.name||`以前のテンプレ${i+1}`),event:C.migrateTemplateEvent(t)}));C.validateDocument(doc);
    }else throw Error('対応するバックアップではありません。');
    if(!await confirmAction(`現在の清算・テンプレート・履歴を、バックアップの内容に置き換えます。\nテンプレート ${doc.templates.length}件、履歴 ${doc.history.length}件を読み込みます。`,'読み込む'))return;
    workspace.recover(workspace.doc,'バックアップを復元する前の入力');
    if(workspace.locked){workspace.meta=workspace.store.replaceProtected(workspace.key,doc,workspace.meta);workspace.locked=false;workspace.reason='';}
    workspace.save(doc);render();toast('バックアップを読み込みました。');
  }
  function share(text){openEditor('共有する内容','<textarea id="shareText" class="copy-preview" rows="12" readonly aria-label="共有用の清算内容"></textarea><button class="primary-button block-button" type="button" data-action="copy">コピーする</button>','share');$('shareText').value=text;editorForm.querySelector('[type=submit]').hidden=true;editorForm.querySelector('[data-close-editor]').textContent='閉じる';}
  async function copyShare(){const area=$('shareText');try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(area.value);else{area.select();if(!document.execCommand('copy'))throw Error();}toast('コピーしました。');}catch{area.focus();area.select();toast('自動コピーできませんでした。選択した内容をコピーしてください。');}}
  async function loadTemplate(templateId){const t=workspace.doc.templates.find(t=>t.id===templateId);if(!t)return;if(workspace.doc.draft.members.length&&!await confirmAction(`今回の入力を「${t.name}」のメンバーと配分設定で置き換えます。`,'このメンバーで始める'))return;workspace.recover(workspace.doc,'テンプレートを呼び出す前の入力');await change(doc=>doc.draft=C.nextEvent(t.event));ui.page='current';ui.step=0;render();}
  async function handleAction(action){
    if(action==='to-current'){ui.page='current';render();}
    else if(action==='layout-list'||action==='layout-steps'){ui.layout=action==='layout-list'?'list':'steps';render();}
    else if(action==='next-step'){ui.step=1;render();view.scrollIntoView({behavior:'smooth',block:'start'});}
    else if(action==='add-member')openAdd();else if(action==='rules')openRules();else if(action==='save-template')openTemplate();
    else if(action==='amount-mode'){if(await confirmAction('旧倍率による配分から、役職・勤務形態の円額による配分へ切り替えます。各人の金額が変わる場合があります。','切り替える'))await change(doc=>{doc.draft.paymentMode='amount';doc.draft.roleLevel=1;doc.draft.workLevel=1;},{financial:true});}
    else if(action==='backup')backup();else if(action==='raw-backup')rawBackup();
    else if(action==='share')share(C.lineText(workspace.doc.draft));else if(action==='copy')await copyShare();
    else if(action==='finalize'){
      const result=C.calculate(workspace.doc.draft);if(result.error)throw Error(result.error);
      const old=workspace.doc.history.length===5?'\n直近5回を保持するため、最も古い履歴は一覧から外れます。確定前の内容はこの端末の復旧用データにも保存します。':'';
      if(!await confirmAction(`${workspace.doc.draft.members.filter(m=>m.included).length}人・負担合計 ${yen(result.netAmount)}で履歴に保存します。\n確定後も集金済みチェックは変更できます。${old}`,'確定して履歴へ'))return;
      workspace.recover(workspace.doc,'清算を確定する前の入力と履歴');await change(doc=>C.finalize(doc));ui.page='history';render();toast('清算を確定しました。次の清算は総額を入れて始められます。');
    }else if(action==='sync')await workspace.sync();
    else if(action==='import-local'){if(await confirmAction('端末用の清算・テンプレート・履歴で、このアカウントの内容を置き換えます。現在のアカウント内容は復旧用データにも残します。','取り込む')){workspace.importLocal();render();}}
    else if(action==='logout'){if(workspace.meta.dirty&&!await confirmAction('まだ同期されていない編集があります。この端末のアカウント用データに残してログアウトしますか？','ログアウト'))return;await workspace.disconnect();render();}
    else if(action==='resolve-remote'||action==='resolve-local'){const choice=action==='resolve-remote'?'remote':'local';if(await confirmAction(choice==='remote'?'現在の端末の編集を復旧用に残し、最新のクラウド版を読み込みます。':'最新のクラウド内容も復旧用に残し、この端末の内容をクラウドへ保存します。','選んだ内容で続ける'))await workspace.resolve(choice);}
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    (async()=>{
      if(button.hasAttribute('data-close-editor')){editor.close();return;}
      if(button.dataset.page){ui.page=button.dataset.page;render();return;}
      if(button.id==='accountButton'){ui.page='settings';render();return;}
      if(button.id==='syncButton'){await workspace.sync();return;}
      if(button.dataset.step!==undefined){ui.step=Number(button.dataset.step);ui.layout='steps';render();return;}
      if(button.dataset.edit){openMember(button.dataset.edit);return;}
      if(button.dataset.loadTemplate){await loadTemplate(button.dataset.loadTemplate);return;}
      if(button.dataset.updateTemplate){openTemplate(button.dataset.updateTemplate);return;}
      if(button.dataset.recovery){const item=workspace.store.recoveries(workspace.key).find(item=>item.key===button.dataset.recovery);if(!item)throw Error('復旧用の内容が見つかりません。');if(item.document){await importBackup(new File([JSON.stringify({kind:'nomikai-v5-backup',document:item.document})],'nomikai-recovery.json',{type:'application/json'}));}else download('nomikai-protected-data.json',{kind:'nomikai-protected-data',entries:[{key:workspace.key,raw:item.raw}]});return;}
      if(button.dataset.reuse){const h=workspace.doc.history.find(h=>h.id===button.dataset.reuse);if(h&&await confirmAction('今回の入力を、履歴のメンバーと配分条件で置き換えます。履歴そのものは変わりません。','次の飲み会に使う')){workspace.recover(workspace.doc,'履歴を流用する前の入力');await change(doc=>doc.draft=C.nextEvent(h.event));ui.page='current';ui.step=0;render();}return;}
      if(button.dataset.shareHistory){const h=workspace.doc.history.find(h=>h.id===button.dataset.shareHistory);if(h)share(C.lineText(h.event,{error:'',netAmount:h.netAmount,rows:h.event.members.map(m=>({...m,finalAmount:h.amounts[m.id]}))}));return;}
      if(button.dataset.removeMember){if(await confirmAction('この参加者を今回の清算から削除します。欠席にするだけなら、参加チェックを外せます。','削除する')){const memberId=button.dataset.removeMember;const removed=C.clone(workspace.doc.draft.members.find(m=>m.id===memberId));workspace.recover(workspace.doc,'参加者を削除する前の入力');if(await change(doc=>{doc.draft.members=doc.draft.members.filter(m=>m.id!==memberId);if(doc.draft.organizerId===memberId)doc.draft.organizerId='';},{financial:true})){editor.close();toast(`${removed.name}さんを今回の参加者から削除しました。`);}}return;}
      if(button.dataset.action)await handleAction(button.dataset.action);
    })().catch(errorMessage);
  });
  document.addEventListener('input',event=>{
    const target=event.target;if(!target.dataset.money||workspace.doc.draft.members.some(m=>m.collected))return;
    const key=target.dataset.money,value=target.value===''?(key==='totalAmount'?null:0):Number(target.value);
    if(!Number.isFinite(value)&&value!==null)return;
    change(doc=>doc.draft[key]=value,{renderAll:false}).catch(errorMessage);
  });
  document.addEventListener('change',event=>{
    const target=event.target;
    (async()=>{
      if(target.id==='memberPaymentMode'){toggleFixedField();return;}
      if(target.id==='quickTemplate'){await loadTemplate(target.value);return;}
      if(target.id==='importFile'){try{await importBackup(target.files[0]);}finally{target.value='';}return;}
      if(target.dataset.money){const key=target.dataset.money,value=target.value===''?(key==='totalAmount'?null:0):Number(target.value);if(value===workspace.doc.draft[key])return;await change(doc=>doc.draft[key]=value,{financial:true,renderAll:false});return;}
      if(target.dataset.detail){if(!target.checkValidity()){target.reportValidity();render();return;}await change(doc=>doc.draft[target.dataset.detail]=target.value);return;}
      if(target.dataset.setting){const key=target.dataset.setting,value=['adjustmentMode'].includes(key)?target.value:Number(target.value);await change(doc=>doc.draft[key]=value,{financial:true});return;}
      if(target.dataset.include){await change(doc=>doc.draft.members.find(m=>m.id===target.dataset.include).included=target.checked,{financial:true});return;}
      if(target.dataset.collected){await change(doc=>doc.draft.members.find(m=>m.id===target.dataset.collected).collected=target.checked,{renderAll:false});return;}
      if(target.dataset.historyCollected){const openIds=Array.from(view.querySelectorAll('.history-card[open]')).map(el=>el.querySelector('[data-history-collected]')?.dataset.historyCollected);await change(doc=>doc.history.find(h=>h.id===target.dataset.historyCollected).collection[target.dataset.member]=target.checked);view.querySelectorAll('.history-card').forEach(el=>{if(openIds.includes(el.querySelector('[data-history-collected]')?.dataset.historyCollected))el.open=true;});}
    })().catch(errorMessage);
  });
  editorForm.addEventListener('submit',event=>{
    event.preventDefault();const data=new FormData(editorForm),editing=ui.edit;
    (async()=>{
      let saved=false;
      if(editing.type==='add'){
        const names=String(data.get('names')).split(/[\n\r]+/).map(name=>name.trim()).filter(Boolean);
        if(!names.length||names.some(name=>name.length>120)||workspace.doc.draft.members.length+names.length>1000)throw Error('名前は1人120文字以内、合計1,000人以内で入力してください。');
        saved=await change(doc=>{const added=names.map(name=>({...C.member(name),role:String(data.get('role')),employment:String(data.get('employment'))}));doc.draft.members.push(...added);if(!doc.draft.organizerId)doc.draft.organizerId=added[0].id;},{financial:true});
      }else if(editing.type==='member'){
        const e=workspace.doc.draft,m=e.members.find(m=>m.id===editing.memberId);if(!m)throw Error('参加者が変わりました。画面を開き直してください。');
        const name=String(data.get('name')).trim();if(!name)throw Error('名前を入力してください。');const payment=data.get('payment'),fixed=payment==='auto'?null:payment==='exempt'?0:Number(data.get('fixedAmount'));
        if(fixed!==null&&(!Number.isSafeInteger(fixed)||fixed<0))throw Error('固定額は0円以上の整数で入力してください。');
        const updates={name,role:String(data.get('role')),employment:String(data.get('employment')),gender:String(data.get('gender')),fixedAmount:fixed,[e.paymentMode==='weighted'?'rate':'offset']:Number(data.get(e.paymentMode==='weighted'?'rate':'offset'))};
        if(!Number.isSafeInteger(updates.offset??m.offset)||!Number.isFinite(updates.rate??m.rate)||(updates.rate??m.rate)<0)throw Error('個別の調整額・倍率を確認してください。');
        const organizer=data.get('organizer')?m.id:e.organizerId===m.id?'':e.organizerId;
        const financial=Object.entries(updates).some(([key,value])=>key!=='name'&&m[key]!==value)||organizer!==e.organizerId;
        saved=await change(doc=>{Object.assign(doc.draft.members.find(x=>x.id===m.id),updates);doc.draft.organizerId=organizer;},{financial});
      }else if(editing.type==='template'){
        const name=String(data.get('name')).trim();if(!name)throw Error('テンプレート名を入力してください。');
        if(editing.templateId){const replace=!!data.get('replaceMembers');if(replace&&!workspace.doc.draft.members.length)throw Error('先に今回の参加者を追加してください。');if(replace&&!await confirmAction('保存済みテンプレートのメンバーと配分設定を、今回の内容で上書きします。','上書きする'))return;saved=await change(doc=>{const t=doc.templates.find(t=>t.id===editing.templateId);t.name=name;if(replace)t.event=C.nextEvent(doc.draft);});}
        else{if(workspace.doc.templates.length>=100)throw Error('テンプレートは100件までです。');saved=await change(doc=>doc.templates.push(C.templateFrom(doc.draft,name)));}
      }else if(editing.type==='rules'){
        const roles=Object.fromEntries(Object.keys(C.roleRulesFor(workspace.doc.draft)).map((name,i)=>[name,Number(data.get(`role_${i}`))]));const work=Object.fromEntries(Object.keys(workspace.doc.draft.workRules).map((name,i)=>[name,Number(data.get(`work_${i}`))]));if(![...Object.values(roles),...Object.values(work)].every(Number.isSafeInteger))throw Error('差額は整数の円で入力してください。');saved=await change(doc=>{doc.draft.roleRules=roles;doc.draft.workRules=work;},{financial:true});
      }
      if(saved){editor.close();toast('保存しました。');}
    })().catch(errorMessage);
  });
  document.addEventListener('submit',event=>{
    if(event.target===editorForm)return;
    const form=event.target;if(!['configForm','passwordLoginForm','loginForm','verifyForm'].includes(form.id))return;event.preventDefault();const data=new FormData(form),submit=form.querySelector('[type=submit]');submit.disabled=true;
    (async()=>{
      if(form.id==='configForm'){const config=NomikaiCloud.validateConfig({url:String(data.get('url')).trim(),key:String(data.get('key')).trim()});storage.setItem('nomikai-cloud-config-v1',JSON.stringify(config));ui.sentEmail='';render();toast('接続設定を保存しました。');}
      else if(form.id==='passwordLoginForm'){
        const config=getConfig();if(!config)throw Error('先に接続設定を保存してください。');
        const client=new NomikaiCloud.Client(config);await client.signInWithPassword(String(data.get('email')).trim(),String(data.get('password')));form.reset();await workspace.connect(client);ui.sentEmail='';render();toast('ログインしました。');
      }else if(form.id==='loginForm'){
        if(Date.now()<ui.resendAt)return;const config=getConfig();if(!config)throw Error('先に接続設定を保存してください。');const email=String(data.get('email')).trim();const client=new NomikaiCloud.Client(config);await client.sendCode(email);ui.sentEmail=email;ui.resendAt=Date.now()+60000;renderSettings();toast('確認コードのメールをご確認ください。');
      }else{
        const config=getConfig();if(!config||!ui.sentEmail)throw Error('先に確認コードを送信してください。');const client=new NomikaiCloud.Client(config);await client.verify(ui.sentEmail,String(data.get('token')).trim());await workspace.connect(client);ui.sentEmail='';render();toast('ログインしました。端末用のデータは「取り込む」から移せます。');
      }
    })().catch(errorMessage).finally(()=>{if(submit.isConnected)submit.disabled=false;});
  });
  window.addEventListener('storage',event=>{if(event.key===workspace.key&&event.newValue){try{if(JSON.parse(event.newValue).revision!==workspace.meta.revision)workspace.protect(new Error('別のタブで保存内容が更新されました。画面の編集をバックアップし、再読み込みしてください。'));}catch{workspace.protect(new Error('保存内容が別のタブで変更されました。上書きを止めています。'));}}});
  window.addEventListener('focus',()=>{if(!editor.open&&!$('confirmation').open)workspace.sync();});window.addEventListener('online',()=>workspace.sync());
  render();
  try{const config=getConfig();if(config){const client=new NomikaiCloud.Client(config);if(client.session)workspace.connect(client).then(render).catch(error=>{status(error.message);});}}catch(error){status(error.message);}
})();
