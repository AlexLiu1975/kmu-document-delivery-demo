'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
function adapter(ipFails=false){
 const writes=[],auth={currentUser:null};
 const storage=new Map();
 const window={FirebaseStoreCore:require('../firebase-store-core'),UsageCore:require('../usage-core'),dispatchEvent:()=>{}};
 const context={window,crypto:require('node:crypto').webcrypto,URL,AbortController,setTimeout,clearTimeout,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},initializeApp:()=>({}),initializeAuth:()=>auth,inMemoryPersistence:{},signInAnonymously:async()=>{auth.currentUser={uid:'uid-a'};},signOut:async()=>{auth.currentUser=null;},getFirestore:()=>({}),firebaseConfig:{},collection:()=>({}),doc:()=>({}),serverTimestamp:()=> 'TIME',addDoc:async(ref,record)=>writes.push(record),runTransaction:async(db,callback)=>{await callback({get:async()=>({exists:()=>false}),set:()=>{}});},fetch:async()=>{if(ipFails)throw Error('offline');return {ok:true,json:async()=>({ip:'203.0.113.7'})};}};
 const source=fs.readFileSync(require.resolve('../firebase-store.js'),'utf8').replace(/^import[\s\S]*?;\s*/gm,'');
 vm.runInNewContext(source,context,{filename:'firebase-store.js'});
 return {store:window.firebaseDocumentStore,writes};
}
async function settle(){for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));}
test('browser adapter records visit, login, query, successful receive and rejected archive',async()=>{
 const {store,writes}=adapter();await settle();
 await store.login('1115034');await settle();
 await store.recordUsage('QUERY','1151103143','not_found');
 await store.receive('1151103143','1115034');await settle();
 await assert.rejects(()=>store.archive('1151103143','1115034'));await settle();
 assert.deepEqual(writes.map(r=>r.action),['PAGE_VIEW','LOGIN','QUERY','RECEIVE','ARCHIVE']);
 assert.equal(writes[3].ip,'203.0.113.7');assert.equal(writes[3].documentNumber,'1151103143');assert.equal(writes[3].employeeNumber,'1115034');assert.equal(writes[4].result,'failure');
});
test('unavailable IP does not prevent login or successful document mutation',async()=>{
 const {store,writes}=adapter(true);await settle();await store.login('1115034');await settle();await store.receive('1151103143','1115034');await settle();
 assert.equal(writes.find(r=>r.action==='RECEIVE').ipStatus,'unavailable');assert.equal(writes.find(r=>r.action==='RECEIVE').result,'success');
});
