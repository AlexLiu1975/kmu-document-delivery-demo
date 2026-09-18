'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
function adapter(ipFails=false, staffAllowed=true, authDelay=0){
 const writes=[],auth={currentUser:null};
 const storage=new Map();
 const window={FirebaseStoreCore:require('../firebase-store-core'),UsageCore:require('../usage-core'),dispatchEvent:()=>{}};
 const context={window,crypto:require('node:crypto').webcrypto,URL,AbortController,setTimeout,clearTimeout,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},initializeApp:()=>({}),initializeAuth:()=>auth,browserSessionPersistence:{},signInWithEmailAndPassword:async(a,email,password)=>{if(password!=='fixture-password-123')throw Error('invalid');auth.currentUser={uid:'staff-a',isAnonymous:false};},getDoc:async()=>({exists:()=>staffAllowed&&!auth.currentUser?.isAnonymous,data:()=>({enabled:true,employeeNumber:'1115034'})}),updatePassword:async()=>{},signInAnonymously:async()=>{if(authDelay)await new Promise(r=>setTimeout(r,authDelay));auth.currentUser={uid:'uid-a',isAnonymous:true};},signOut:async()=>{auth.currentUser=null;},getFirestore:()=>({}),firebaseConfig:{},collection:()=>({}),doc:()=>({}),serverTimestamp:()=> 'TIME',addDoc:async(ref,record)=>writes.push(record),runTransaction:async(db,callback)=>{await callback({get:async()=>({exists:()=>false}),set:()=>{}});},fetch:async()=>{if(ipFails)throw Error('offline');return {ok:true,json:async()=>({ip:'203.0.113.7'})};}};
 const source=fs.readFileSync(require.resolve('../firebase-store.js'),'utf8').replace(/^import[\s\S]*?;\s*/gm,'');
 vm.runInNewContext(source,context,{filename:'firebase-store.js'});
 return {store:window.firebaseDocumentStore,writes};
}
async function settle(){for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));}
test('browser adapter records visit, login, query, successful receive and rejected archive',async()=>{
 const {store,writes}=adapter();await settle();
 await store.login('1234567');await settle();
 await store.recordUsage('QUERY','1151103143','not_found');
 await store.receive('1151103143','1234567');await settle();
 await assert.rejects(()=>store.archive('1151103143','1234567'));await settle();
 assert.deepEqual(writes.map(r=>r.action),['PAGE_VIEW','LOGIN','QUERY','RECEIVE','ARCHIVE']);
 assert.equal(writes[3].ip,'203.0.113.7');assert.equal(writes[3].documentNumber,'1151103143');assert.equal(writes[3].employeeNumber,'1234567');assert.equal(writes[4].result,'failure');
});
test('unavailable IP does not prevent login or successful document mutation',async()=>{
 const {store,writes}=adapter(true);await settle();await store.login('1234567');await settle();await store.receive('1151103143','1234567');await settle();
 assert.equal(writes.find(r=>r.action==='RECEIVE').ipStatus,'unavailable');assert.equal(writes.find(r=>r.action==='RECEIVE').result,'success');
});

test('staff password login validates UID authorization and can restore session',async()=>{
 const {store}=adapter();await settle();await assert.rejects(()=>store.login('1115034'),/密碼/);await assert.rejects(()=>store.login('1115034','wrong'),/錯誤/);await store.login('1115034','fixture-password-123');assert.equal((await store.staffSession()).employeeNumber,'1115034');await assert.rejects(()=>store.changePassword('1234567'),/8/);await store.changePassword('Abcd1234');await store.logout();assert.equal(await store.staffSession(),null);
});
test('password login cannot grant access without protected staff UID authorization',async()=>{
 const {store}=adapter(false,false);await settle();await assert.rejects(()=>store.login('1115034','fixture-password-123'),/尚未啟用/);assert.equal(await store.staffSession(),null);
});

test('immediate staff login waits for initial anonymous sign-in before password sign-in',async()=>{const {store}=adapter(false,true,30);await store.login('1115034','fixture-password-123');await new Promise(r=>setTimeout(r,60));assert.equal((await store.staffSession()).employeeNumber,'1115034');});
