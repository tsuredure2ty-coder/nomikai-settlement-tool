(function (root) {
  'use strict';
  const ROLES = {社長:4000,部長:2000,室長:2000,次長:1500,課長:1000,調査役:500,一般:0};
  const WORK = {正社員:0,嘱託:-500,パート:-1000};
  const UNITS = [1,10,100,500,1000];
  const LEVELS = [0,0.5,1,1.5];
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = () => root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const member = (name = '') => ({id:id(),name,role:'一般',employment:'正社員',gender:'未設定',included:true,fixedAmount:null,offset:0,rate:1,collected:false});
  function event() {
    return {id:id(),eventName:'',date:today(),totalAmount:null,subsidy:0,roundUnit:100,adjustmentMode:'organizer',organizerId:'',paymentMode:'amount',roleLevel:1,workLevel:1,genderLevel:0,roleRules:{...ROLES},workRules:{...WORK},members:[]};
  }
  const documentData = () => ({schemaVersion:5,draft:event(),templates:[],history:[],updatedAt:new Date().toISOString()});
  function calculate(e) {
    const rows=e.members.map(m=>({...m,rawAmount:0,finalAmount:0,isFixed:m.fixedAmount!==null}));
    const result={rows,error:'',note:'',netAmount:0,finalTotal:0,activeCount:rows.filter(m=>m.included).length,collectedTotal:0,outstanding:0,remainder:0};
    const fail=error=>({...result,error,note:error});
    if(!Number.isSafeInteger(e.totalAmount)||e.totalAmount<=0)return fail('お会計の総額を、1円以上の整数で入力してください。');
    if(!Number.isSafeInteger(e.subsidy)||e.subsidy<0||e.subsidy>e.totalAmount)return fail('補助額は総額以下の、0円以上の整数で入力してください。');
    if(!UNITS.includes(e.roundUnit))return fail('丸め単位を確認してください。');
    const active=rows.filter(m=>m.included),fixed=active.filter(m=>m.isFixed),variable=active.filter(m=>!m.isFixed&&(e.paymentMode!=='weighted'||m.rate>0));
    result.activeCount=active.length;result.netAmount=e.totalAmount-e.subsidy;
    if(!active.length)return fail('参加者を追加するか、参加にチェックを入れてください。');
    if(fixed.some(m=>!Number.isSafeInteger(m.fixedAmount)||m.fixedAmount<0))return fail('指定する金額は0円以上の整数にしてください。');
    if(active.some(m=>!Number.isSafeInteger(m.offset)||!Number.isFinite(m.rate)||m.rate<0))return fail('個別の調整額・倍率を確認してください。');
    let left=result.netAmount;
    for(const m of fixed){m.rawAmount=m.finalAmount=m.fixedAmount;left-=m.finalAmount;}
    if(left<0)return fail('指定額の合計が、補助を引いた総額を超えています。');
    if(!variable.length&&left)return fail('残額を分ける人がいません。1人以上を自動計算にしてください。');
    if(e.paymentMode==='weighted'){
      const sum=variable.reduce((s,m)=>s+m.rate,0);
      variable.forEach(m=>m.rawAmount=left*m.rate/sum);
    }else{
      if(!LEVELS.includes(e.roleLevel)||!LEVELS.includes(e.workLevel)||![0,500,1000].includes(e.genderLevel))return fail('傾斜の強さを確認してください。');
      for(const m of variable){
        const role=e.roleRules[m.role],work=e.workRules[m.employment];
        if(!Number.isSafeInteger(role)||!Number.isSafeInteger(work))return fail('役職・勤務形態の配分ルールを確認してください。');
        m.effectiveOffset=role*e.roleLevel+work*e.workLevel-(m.gender==='女性'?e.genderLevel:0)+m.offset;
      }
      let pool=variable.slice();
      while(pool.length){
        const base=(left-pool.reduce((s,m)=>s+m.effectiveOffset,0))/pool.length;
        const positive=pool.filter(m=>base+m.effectiveOffset>0);
        if(positive.length===pool.length){pool.forEach(m=>m.rawAmount=base+m.effectiveOffset);break;}
        pool=positive;
      }
    }
    for(const m of variable)m.finalAmount=Math.floor(m.rawAmount/e.roundUnit)*e.roundUnit;
    left-=variable.reduce((s,m)=>s+m.finalAmount,0);
    const ranked=variable.slice().sort((a,b)=>(b.rawAmount-b.finalAmount)-(a.rawAmount-a.finalAmount));
    for(const m of ranked){if(left<e.roundUnit)break;m.finalAmount+=e.roundUnit;left-=e.roundUnit;}
    result.remainder=left;
    result.note=`${e.roundUnit.toLocaleString()}円単位で配分。単位未満の端数はありません。`;
    if(left){
      const eligible=variable.filter(m=>m.rawAmount>0);
      if(e.adjustmentMode==='all'){
        if(!eligible.length)return fail('端数を分ける人がいません。');
        const base=Math.floor(left/eligible.length),rest=left%eligible.length;
        eligible.forEach((m,i)=>m.finalAmount+=base+(i<rest?1:0));
        result.note=`単位未満の端数 ${left.toLocaleString()}円を、自動計算の人で均等に調整しました。`;
      }else{
        const target=e.adjustmentMode==='organizer'?eligible.find(m=>m.id===e.organizerId):eligible.slice().sort((a,b)=>(e.roleRules[b.role]||0)-(e.roleRules[a.role]||0))[0];
        if(!target)return fail('端数を負担できる幹事を選ぶか、端数の調整方法を変更してください。固定額・免除・欠席の人は対象外です。');
        target.finalAmount+=left;result.note=`単位未満の端数 ${left.toLocaleString()}円は、${target.name||'名無し'}さんが負担します。`;
      }
    }
    result.finalTotal=rows.reduce((s,m)=>s+m.finalAmount,0);
    if(result.finalTotal!==result.netAmount||rows.some(m=>!Number.isSafeInteger(m.finalAmount)||m.finalAmount<0))return fail('総額に合わせて配分できませんでした。');
    result.collectedTotal=active.reduce((s,m)=>s+(m.collected?m.finalAmount:0),0);
    result.outstanding=result.netAmount-result.collectedTotal;
    return result;
  }
  function nextEvent(source,{keepTotal=false}={}){
    const next=clone(source);next.id=id();next.date=today();next.eventName='';
    if(!keepTotal){next.totalAmount=null;next.subsidy=0;}
    next.members.forEach(m=>{m.included=true;m.collected=false;});return next;
  }
  function clearCollection(e){e.members.forEach(m=>m.collected=false);}
  function templateFrom(e,name){return {id:id(),name:name.trim().slice(0,80),event:nextEvent(e)};}
  function finalize(doc){
    const result=calculate(doc.draft);if(result.error)throw Error(result.error);
    const record={id:id(),createdAt:new Date().toISOString(),event:clone(doc.draft),amounts:Object.fromEntries(result.rows.map(m=>[m.id,m.finalAmount])),netAmount:result.netAmount,note:result.note,collection:Object.fromEntries(doc.draft.members.map(m=>[m.id,m.collected]))};
    doc.history=[record,...doc.history].slice(0,5);doc.draft=nextEvent(doc.draft);return record;
  }
  function assert(ok,message='保存データの形式を確認してください。'){if(!ok)throw Error(message);}
  function validateEvent(e){
    assert(e&&typeof e==='object'&&typeof e.id==='string'&&typeof e.eventName==='string'&&e.eventName.length<=120&&/^\d{4}-\d{2}-\d{2}$/.test(e.date));
    assert(e.totalAmount===null||Number.isFinite(e.totalAmount));assert(Number.isFinite(e.subsidy));
    assert(UNITS.includes(e.roundUnit)&&['organizer','top','all'].includes(e.adjustmentMode)&&['amount','weighted'].includes(e.paymentMode));
    assert(typeof e.organizerId==='string'&&LEVELS.includes(e.roleLevel)&&LEVELS.includes(e.workLevel)&&[0,500,1000].includes(e.genderLevel));
    assert(e.roleRules&&e.workRules&&Object.values(e.roleRules).every(Number.isSafeInteger)&&Object.values(e.workRules).every(Number.isSafeInteger));
    assert(Array.isArray(e.members)&&e.members.length<=1000);const ids=new Set();
    for(const m of e.members){
      assert(m&&typeof m.id==='string'&&m.id&&!ids.has(m.id));ids.add(m.id);
      assert(typeof m.name==='string'&&m.name.length<=120&&typeof m.role==='string'&&typeof m.employment==='string'&&Object.hasOwn(e.roleRules,m.role)&&Object.hasOwn(e.workRules,m.employment));
      assert(['男性','女性','未設定'].includes(m.gender)&&typeof m.included==='boolean'&&typeof m.collected==='boolean');
      assert(m.fixedAmount===null||Number.isFinite(m.fixedAmount));assert(Number.isFinite(m.offset)&&Number.isFinite(m.rate));
    }
    return e;
  }
  function validateDocument(doc){
    assert(doc&&doc.schemaVersion===5&&typeof doc.updatedAt==='string');validateEvent(doc.draft);
    assert(Array.isArray(doc.templates)&&doc.templates.length<=100&&Array.isArray(doc.history)&&doc.history.length<=5);
    const ids=new Set();
    for(const t of doc.templates){assert(t&&typeof t.id==='string'&&!ids.has(t.id)&&typeof t.name==='string'&&t.name.trim()&&t.name.length<=80);ids.add(t.id);validateEvent(t.event);}
    ids.clear();
    for(const h of doc.history){
      assert(h&&typeof h.id==='string'&&!ids.has(h.id)&&Number.isFinite(Date.parse(h.createdAt)));ids.add(h.id);validateEvent(h.event);
      assert(h.amounts&&h.collection&&typeof h.note==='string'&&Number.isSafeInteger(h.netAmount)&&h.netAmount>=0&&h.netAmount===h.event.totalAmount-h.event.subsidy);
      assert(h.event.members.reduce((s,m)=>s+(h.amounts[m.id]||0),0)===h.netAmount);
      for(const m of h.event.members){const amount=h.amounts[m.id];assert(Number.isSafeInteger(amount)&&amount>=0&&typeof h.collection[m.id]==='boolean');if(!m.included)assert(amount===0);else if(m.fixedAmount!==null)assert(amount===m.fixedAmount);}
    }
    return clone(doc);
  }
  function legacyPreset(x){
    const category=x.role||x.category||'一般',female=x.adjustment==='女性'||x.category==='女性';
    const roleRates={社長:3,部長:2,室長:2,次長:1.8,課長:1.5,調査役:1.3,一般:1,パート:0.5};
    return Math.round((roleRates[category]||1)*(female?0.8:(x.adjustment==='学生'||x.category==='学生')?0.5:1)*({'通常':1,'遅刻':0.9,'早退':0.9,'遅刻＋早退':0.8}[x.attendance]||1)*100)/100;
  }
  function migrateEvent(old){
    assert(old&&Array.isArray(old.members)&&old.members.length<=1000,'旧データを読み込めません。旧画面またはバックアップを確認してください。');
    const e=event(),legacy=old.schemaVersion!==4;
    e.eventName=String(old.eventName||'').slice(0,120);e.totalAmount=Number(old.totalAmount)||null;e.roundUnit=UNITS.includes(Number(old.roundUnit))?Number(old.roundUnit):100;
    e.paymentMode=['amount','weighted'].includes(old.paymentMode)?old.paymentMode:legacy?'weighted':'amount';
    e.adjustmentMode=['organizer','top','all'].includes(old.adjustmentMode)?old.adjustmentMode:'organizer';e.roleLevel=0;e.workLevel=0;
    e.members=old.members.map(x=>{
      const m=member(String(x.name||'').slice(0,120));m.id=String(x.id||id());
      const category=x.role||x.category||'一般';m.role=category==='パート'?'一般':Object.hasOwn(ROLES,category)?category:'一般';m.employment=category==='パート'?'パート':'正社員';m.gender=x.adjustment==='女性'||x.category==='女性'?'女性':'未設定';
      const preset=legacyPreset(x);
      m.rate=x.rate!==null&&x.rate!==undefined&&x.rate!==''?Number(x.rate):preset;
      m.fixedAmount=x.fixedAmount===null||x.fixedAmount===undefined||x.fixedAmount===''?null:Number(x.fixedAmount);
      if(legacy&&!(m.fixedAmount>0))m.fixedAmount=m.rate===0?0:null;
      m.offset=Number(x.offset)||0;m.included=x.included!==false;return m;
    });
    const seen=new Set();e.members.forEach(m=>{if(seen.has(m.id))m.id=id();seen.add(m.id);});
    e.organizerId=e.members.some(m=>m.id===old.organizerId)?old.organizerId:'';return validateEvent(e);
  }
  function migrateTemplateEvent(old){
    assert(old&&Array.isArray(old.members));
    const copy={...old,members:old.members.map(x=>{
      const hasRate=x.rate!==null&&x.rate!==undefined&&x.rate!=='';
      const custom=typeof x.customRate==='boolean'?x.customRate:hasRate&&Math.abs(Number(x.rate)-legacyPreset(x))>0.000001;
      return {...x,attendance:'通常',...(custom?{}:{rate:legacyPreset({...x,attendance:'通常'})})};
    })};
    return nextEvent(migrateEvent(copy));
  }
  function migrateStorage(storage){
    const doc=documentData();let found=false;
    for(const key of ['nomikai-settlement-v4','nomikai-settlement-v3','nomikai-settlement-v2','nomikai-settlement-v1']){const raw=storage.getItem(key);if(raw){doc.draft=migrateEvent(JSON.parse(raw));found=true;break;}}
    const modern=storage.getItem('nomikai-member-templates-v2'),old=storage.getItem('nomikai-member-template-v1');
    const slots=modern?JSON.parse(modern).slots:old?[JSON.parse(old)]:[];assert(Array.isArray(slots)&&slots.length<=3);
    doc.templates=slots.filter(Boolean).map((slot,i)=>({id:id(),name:String(slot.name||`以前のテンプレ${i+1}`).slice(0,80),event:migrateTemplateEvent(slot)}));
    return {doc:validateDocument(doc),migrated:found||doc.templates.length>0};
  }
  function lineText(e,result=calculate(e)){
    if(result.error)throw Error(result.error);
    return [`【${e.eventName||'飲み会'} 清算】`,e.date,'',...result.rows.filter(m=>m.included).map(m=>`${m.name||'名無し'}${m.id===e.organizerId?'（幹事）':''}　${m.finalAmount.toLocaleString()}円`),'',`会計：${e.totalAmount.toLocaleString()}円`,...(e.subsidy?[`補助：${e.subsidy.toLocaleString()}円`]:[]),`参加者の負担合計：${result.netAmount.toLocaleString()}円`].join('\n');
  }
  const api={ROLES,WORK,UNITS,LEVELS,clone,id,today,member,event,documentData,calculate,nextEvent,clearCollection,templateFrom,finalize,validateEvent,validateDocument,migrateEvent,migrateTemplateEvent,migrateStorage,lineText};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.NomikaiCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
