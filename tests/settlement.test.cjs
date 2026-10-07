const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate } = require('../settlement.js');
const fs = require('node:fs');
const vm = require('node:vm');

function member(id, extra = {}) {
  return { id: String(id), name: `架空${id}`, role: '一般', rate: 1, offset: 0,
    fixedAmount: null, included: true, ...extra };
}
function state(members, extra = {}) {
  return { schemaVersion: 4, totalAmount: 10000, roundUnit: 100, paymentMode: 'amount',
    adjustmentMode: 'organizer', organizerId: '0', members, ...extra };
}
function valid(result, total) {
  assert.equal(result.error, '');
  assert.equal(result.finalTotal, total);
  assert.equal(result.difference, 0);
  for (const row of result.rows) {
    assert.ok(Number.isSafeInteger(row.finalAmount) && row.finalAmount >= 0);
    if (!row.included) assert.equal(row.finalAmount, 0);
    else if (row.isFixed) assert.equal(row.finalAmount, row.fixedAmount);
  }
}

test('固定額の幹事は端数調整から除外し、金額を守る', () => {
  const result = calculate(state([member(0, {fixedAmount: 5000}), member(1), member(2)], {totalAmount:10001}));
  valid(result, 10001);
  assert.equal(result.rows[0].finalAmount, 5000);
  assert.deepEqual(result.rows.slice(1).map(row => row.finalAmount), [2501, 2500]);
});

test('総額より丸め単位が大きくても過剰徴収しない', () => {
  const result = calculate(state([member(0), member(1), member(2)], {totalAmount:1000,roundUnit:1000}));
  valid(result, 1000);
});

test('固定額自体は丸めない。0円の固定と不参加も保護する', () => {
  const result = calculate(state([member(0, {fixedAmount:1234}), member(1, {fixedAmount:0}),
    member(2, {fixedAmount:99999,included:false}), member(3)], {totalAmount:10001,roundUnit:1000}));
  valid(result,10001);
  assert.deepEqual(result.rows.map(row => row.finalAmount), [1234,0,0,8767]);
});

test('多めと少なめの差を金額で付ける', () => {
  const result = calculate(state([member(0,{offset:500}),member(1,{offset:-500})]));
  valid(result,10000);
  assert.deepEqual(result.rows.map(row=>row.finalAmount),[5500,4500]);
});

test('少なめが大きくても支払額を負にしない', () => {
  const result = calculate(state([member(0,{offset:-10000}),member(1),member(2)],{totalAmount:1000}));
  valid(result,1000);
  assert.equal(result.rows[0].finalAmount,0);
});

test('全員固定額は一致するときだけ有効。固定額超過・配分先なしを知らせる', () => {
  valid(calculate(state([member(0,{fixedAmount:5000}),member(1,{fixedAmount:5000})])),10000);
  assert.match(calculate(state([member(0,{fixedAmount:11000})])).error,/超え/);
  assert.match(calculate(state([member(0,{fixedAmount:5000})])).error,/残額/);
});

test('倍率0の参加者も端数で課金しない', () => {
  const result = calculate(state([member(0,{rate:0}),member(1,{rate:2}),member(2)],{paymentMode:'weighted',totalAmount:10001}));
  valid(result,10001);
  assert.equal(result.rows[0].finalAmount,0);
});

test('小数円と負の倍率はコピー可能な結果を作らない', () => {
  assert.ok(calculate(state([member(0)],{totalAmount:1.5})).error);
  assert.ok(calculate(state([member(0,{fixedAmount:10.5})])).error);
  assert.ok(calculate(state([member(0,{rate:-1}),member(1)],{paymentMode:'weighted'})).error);
});

test('決定的な500ケースで合計・固定額・免除・不参加の不変条件を検証', () => {
  let seed = 7;
  const next = max => { seed=(seed*1664525+1013904223)>>>0; return seed%max; };
  for(let i=0;i<500;i++) {
    const members=Array.from({length:2+next(18)},(_,id)=>member(id,{
      role:id===0?'部長':'一般', offset:(next(41)-20)*500,
      rate:id===0?1:next(21)/10, included:id===0||next(4)!==0,
      fixedAmount:id===0||next(3)!==0?null:next(6000),
    }));
    const fixed=members.reduce((sum,m)=>sum+(m.included&&m.fixedAmount!==null?m.fixedAmount:0),0);
    const total=fixed+next(30000);
    const input=state(members,{totalAmount:total,roundUnit:[1,10,100,500,1000][next(5)],
      paymentMode:i%2?'amount':'weighted',adjustmentMode:['organizer','top','all'][next(3)]});
    valid(calculate(input),total);
  }
});

function app() {
  const context={document:{addEventListener(){}},NomikaiSettlement:{calculate}};
  vm.createContext(context);
  const source=fs.readFileSync(require.resolve('../script.js'),'utf8').replace(
    '  document.addEventListener("DOMContentLoaded", init);',
    '  globalThis.review = {normalizeMember,readStateData,readTemplateData,saveState,storageWrite,elements,state,lockedStorageKeys,copyForLine,setResult(input){Object.assign(state,input);latestResult=calculatePayments();}};');
  vm.runInContext(source,context);
  return {context,...context.review};
}

test('旧データの0円未指定は自動、倍率0は免除として移行。旧倍率を保持する', () => {
  const {readStateData}=app();
  const old=readStateData({members:[{id:'0',name:'架空',role:'一般',rate:1,fixedAmount:0},
    {id:'1',name:'架空免除',role:'一般',rate:0,fixedAmount:0}],organizerId:'0'});
  assert.equal(old.paymentMode,'weighted');
  assert.equal(old.members[0].fixedAmount,null);
  assert.equal(old.members[1].fixedAmount,0);
  assert.equal(old.members[1].rate,0);
});

test('新データの0円固定・不参加・差額を保存復元する', () => {
  const {readStateData}=app();
  const saved=state([member(0,{fixedAmount:0}),member(1,{offset:-500,included:false})]);
  const restored=readStateData(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.members[0].fixedAmount,0);
  assert.equal(restored.members[1].included,false);
  assert.equal(restored.members[1].offset,-500);
});

test('テンプレは3枠で、当日の不参加と遅刻を解除する', () => {
  const {readTemplateData}=app();
  const result=readTemplateData({slots:[{...state([member(0,{included:false,attendance:'遅刻'})]),name:'架空枠'}]});
  assert.equal(result.length,3);
  assert.equal(result[0].members[0].included,true);
  assert.equal(result[0].members[0].attendance,'通常');
  assert.throws(()=>readTemplateData({slots:[null,null,null,null]}));
});

test('保存失敗を成功と表示せず、壊れた保存データも上書きしない', () => {
  const {context,elements,saveState,storageWrite,lockedStorageKeys}=app();
  elements.saveStatus={textContent:'',classList:{toggle(){}}};
  let calls=0;
  context.localStorage={setItem(){calls++;throw Error('quota');}};
  assert.equal(saveState(),false);
  assert.match(elements.saveStatus.textContent,/失敗/);
  lockedStorageKeys.add('protected');
  assert.equal(storageWrite('protected',{}),false);
  assert.equal(calls,1);
});

test('テンプレの遅刻解除は倍率も戻す。手動倍率は保持する', () => {
  const {readTemplateData}=app();
  const template=readTemplateData({slots:[{members:[
    {id:'0',role:'一般',adjustment:'なし',attendance:'遅刻',rate:0.9,fixedAmount:0},
    {id:'1',role:'一般',adjustment:'なし',attendance:'遅刻',rate:1.2,fixedAmount:0},
  ]}]});
  assert.equal(template[0].members[0].attendance,'通常');
  assert.equal(template[0].members[0].rate,1);
  assert.equal(template[0].members[1].rate,1.2);
});

test('LINE用テキストは不参加を除外し、固定額と免除を含める', async () => {
  const {context,elements,setResult,copyForLine}=app();
  let copied='';
  context.navigator={clipboard:{writeText(text){copied=text;return Promise.resolve();}}};
  context.window={clearTimeout(){},setTimeout(){return 0;}};
  elements.toast={textContent:'',classList:{add(){}}};
  setResult(state([member(0,{fixedAmount:5000}),member(1,{included:false}),member(2,{fixedAmount:0}),member(3)]));
  copyForLine();
  await Promise.resolve();
  assert.ok(copied.includes('架空0（幹事）　5,000円'));
  assert.ok(!copied.includes('架空1'));
  assert.ok(copied.includes('架空2　0円'));
  assert.ok(copied.includes('合計：10,000円'));
});
