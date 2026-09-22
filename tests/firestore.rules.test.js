'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  query,
  setDoc,
  Timestamp,
  updateDoc
} = require('firebase/firestore');

const root = path.join(__dirname, '..');
let environment;

function documentData(overrides = {}) {
  return {
    documentNumber: '1151100016',
    year: '115',
    typeCode: '11',
    serial: '00016',
    status: '已收文',
    assignee: '1115034',
    latestRejectionReason: '',
    latestRejectionActor: '',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    revision: 1,
    ...overrides
  };
}

function eventData(uid, overrides = {}) {
  return {
    documentNumber: '1151100016',
    action: '承辦人收文',
    oldStatus: '',
    newStatus: '已收文',
    reason: '',
    actor: '1115034',
    authUid: uid,
    occurredAt: Timestamp.now(),
    ...overrides
  };
}

function staffDb(uid = 'uid-a') {
  return environment.authenticatedContext(uid, { firebase: { sign_in_provider: 'password' } }).firestore();
}

test.before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-kmu-document-delivery',
    firestore: {
      rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
    }
  });
});

test.after(async () => {
  if (environment) await environment.cleanup();
});

test.beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'staffAdmins/uid-a'), { enabled: true, employeeNumber: '1115034' });
  });
});

test('denies unauthenticated document reads and writes', async () => {
  const db = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'documents/1151100016')));
  await assertFails(setDoc(doc(db, 'documents/1151100016'), documentData()));
});

test('allows an authorized staff user to create a valid received document', async () => {
  const db = staffDb();
  await assertSucceeds(setDoc(doc(db, 'documents/1151100016'), documentData()));
});

test('only an authorized staff password account can create documents', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'staffAdmins/staff-writer'), { enabled: true, employeeNumber: '1115034' });
  });
  const passwordClaims = { firebase: { sign_in_provider: 'password' } };
  const staff = environment.authenticatedContext('staff-writer', passwordClaims).firestore();
  const general = environment.authenticatedContext('general-user').firestore();
  await assertSucceeds(setDoc(doc(staff, 'documents/1151100016'), documentData()));
  await assertFails(setDoc(doc(general, 'documents/1151100017'), documentData({ documentNumber: '1151100017', serial: '00017' })));
});

test('general users can get one known document but cannot list documents or read history', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'documents/1151100099'), documentData({ documentNumber: '1151100099', serial: '00099' }));
    await setDoc(doc(context.firestore(), 'documents/1151100099/events/event-1'), eventData('uid-a', { documentNumber: '1151100099' }));
  });
  const general = environment.authenticatedContext('general-reader').firestore();
  await assertSucceeds(getDoc(doc(general, 'documents/1151100099')));
  await assertFails(getDocs(collection(general, 'documents')));
  await assertFails(getDoc(doc(general, 'documents/1151100099/events/event-1')));
  await assertFails(getDocs(query(collectionGroup(general, 'events'))));
});

test('denies malformed employee numbers and document numbers', async () => {
  const db = staffDb();
  await assertFails(setDoc(doc(db, 'documents/not-a-number'), documentData()));
  await assertFails(setDoc(
    doc(db, 'documents/1151100016'),
    documentData({ assignee: '123' })
  ));
});

test('allows the approved document status transitions', async () => {
  const db = staffDb();
  const ref = doc(db, 'documents/1151100016');
  await assertSucceeds(setDoc(ref, documentData()));
  await assertSucceeds(updateDoc(ref, {
    status: '已退文',
    latestRejectionReason: '缺少發文日期',
    latestRejectionActor: '7654321',
    updatedAt: Timestamp.now(),
    revision: 2
  }));
  await assertSucceeds(updateDoc(ref, {
    status: '已收文',
    assignee: '1115034',
    updatedAt: Timestamp.now(),
    revision: 3
  }));
  await assertSucceeds(updateDoc(ref, {
    status: '已歸檔',
    updatedAt: Timestamp.now(),
    revision: 4
  }));
});

test('still allows updates to legacy documents with the old 3-digit type code and 4-digit serial', async () => {
  const db = staffDb();
  const ref = doc(db, 'documents/1151100016');
  await assertSucceeds(setDoc(ref, documentData({ typeCode: '110', serial: '0016' })));
  await assertSucceeds(updateDoc(ref, {
    status: '已退文',
    latestRejectionReason: '缺少發文日期',
    latestRejectionActor: '1115034',
    updatedAt: Timestamp.now(),
    revision: 2
  }));
});

test('denies updates to archived documents and document deletion', async () => {
  const db = staffDb();
  const ref = doc(db, 'documents/1151100016');
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'documents/1151100016'), documentData({
      status: '已歸檔',
      revision: 4
    }));
  });
  await assertFails(updateDoc(ref, {
    status: '已收文',
    updatedAt: Timestamp.now(),
    revision: 5
  }));
  await assertFails(deleteDoc(ref));
});

test('allows event creation but denies event update and delete', async () => {
  const db = staffDb();
  const ref = doc(db, 'documents/1151100016/events/event-1');
  await assertSucceeds(setDoc(ref, eventData('uid-a')));
  await assertFails(updateDoc(ref, { reason: '竄改原因' }));
  await assertFails(deleteDoc(ref));
  await assertFails(setDoc(
    doc(db, 'documents/1151100016/events/event-2'),
    eventData('different-uid')
  ));
});

test('allows authenticated collection-group reads of operation events', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'documents/1151100016/events/event-1'),
      eventData('uid-a')
    );
  });
  const db = staffDb();
  await assertSucceeds(getDocs(query(collectionGroup(db, 'events'))));
});

test('canonical P/R/B/A lifecycle preserves return metadata through receive and archive', async () => {
  const db = staffDb();
  const ref = doc(db, 'documents/1151100016');
  const core = require('../firebase-store-core');
  const assert = require('node:assert/strict');
  await assertSucceeds(setDoc(ref, documentData({ status: 'P', typeCode: '110', serial: '0016', returnCount: 0 })));
  for (const operation of ['RECEIVE', 'REJECT', 'RECEIVE', 'ARCHIVE']) {
    const current = (await getDoc(ref)).data();
    const mutation = core.buildMutation(current, '1151100016', '1115034', operation, operation === 'REJECT' ? '缺少監印章' : '', 'uid-a', Timestamp.now());
    await assertSucceeds(setDoc(ref, mutation.document));
    await assertSucceeds(setDoc(doc(ref, 'events', operation + current.revision), mutation.event));
  }
  const archived = (await getDoc(ref)).data();
  assert.equal(archived.status, 'A');
  assert.equal(archived.returnCount, 1);
  assert.equal(archived.latestRejectionReason, '缺少監印章');
  await assertFails(updateDoc(ref, { status: 'B', revision: archived.revision + 1 }));
});

test('legacy Chinese document can transition to canonical B while preserving immutable numbering', async () => {
  const db = staffDb();
  const ref = doc(db, 'documents/1151100016');
  await assertSucceeds(setDoc(ref, documentData()));
  const core = require('../firebase-store-core');
  const mutation = core.buildMutation((await getDoc(ref)).data(), '1151100016', '1115034', 'REJECT', '缺少監印章', 'uid-a', Timestamp.now());
  await assertSucceeds(setDoc(ref, mutation.document));
});

test('P cannot be archived and unknown status codes are denied', async () => {
  const db = staffDb();
  const ref = doc(db, 'documents/1151100016');
  await assertFails(setDoc(ref, documentData({status:'X'})));
  await assertSucceeds(setDoc(ref, documentData({status:'P'})));
  await assertFails(updateDoc(ref,{status:'A',revision:2}));
});

test('usage records bind UID, preserve full IP and deny browser reads/updates/deletes', async () => {
 const {serverTimestamp} = require('firebase/firestore');
 const db = environment.authenticatedContext('uid-a').firestore();
 const ref = doc(db,'usageRecords/record-a');
 const data={employeeNumber:'1115034',documentNumber:'1151103143',ip:'203.0.113.7',ipStatus:'available',visitorId:'v1',sessionId:'s1',authUid:'uid-a',action:'RECEIVE',result:'success',errorCode:'',occurredAt:serverTimestamp()};
 await assertSucceeds(setDoc(ref,data));
 await assertFails(getDoc(ref));
 await assertFails(getDoc(doc(environment.authenticatedContext('other-user').firestore(),'usageRecords/record-a')));
 await assertFails(updateDoc(ref,{ip:'203.0.113.8'}));
 await assertFails(deleteDoc(ref));
 await assertFails(setDoc(doc(db,'usageRecords/forged'),{...data,authUid:'other-user'}));
 await assertFails(setDoc(doc(db,'usageRecords/invalid'),{...data,employeeNumber:'123'}));
});

test('anonymous page views and unavailable IP are valid, unauthenticated telemetry is denied', async () => {
 const {serverTimestamp}=require('firebase/firestore');
 const data={employeeNumber:'',documentNumber:'',ip:'',ipStatus:'unavailable',visitorId:'v1',sessionId:'s1',authUid:'uid-a',action:'PAGE_VIEW',result:'success',errorCode:'',occurredAt:serverTimestamp()};
 await assertSucceeds(setDoc(doc(environment.authenticatedContext('uid-a').firestore(),'usageRecords/view-a'),data));
 await assertFails(setDoc(doc(environment.unauthenticatedContext().firestore(),'usageRecords/view-b'),data));
});

test('legacy Google authorization cannot grant usage record reads', async()=>{
 const {serverTimestamp}=require('firebase/firestore');
 await environment.withSecurityRulesDisabled(async context=>{
  await setDoc(doc(context.firestore(),'reportAdmins/beyle931224@gmail.com'),{enabled:true});
  await setDoc(doc(context.firestore(),'usageRecords/admin-test'),{occurredAt:serverTimestamp(),ip:'203.0.113.7'});
 });
 const claims={email:'beyle931224@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const admin=environment.authenticatedContext('google-admin',claims).firestore();
 await assertFails(getDoc(doc(admin,'usageRecords/admin-test')));
 await assertSucceeds(getDoc(doc(admin,'reportAdmins/beyle931224@gmail.com')));
 await assertFails(getDocs(collection(admin,'usageRecords')));
 await assertFails(getDoc(doc(environment.authenticatedContext('other-google',{...claims,email:'other@example.com'}).firestore(),'usageRecords/admin-test')));
 await assertFails(getDoc(doc(environment.authenticatedContext('unverified',{...claims,email_verified:false}).firestore(),'usageRecords/admin-test')));
 await assertFails(getDoc(doc(environment.authenticatedContext('anonymous',{...claims,firebase:{sign_in_provider:'anonymous'}}).firestore(),'usageRecords/admin-test')));
 await assertFails(setDoc(doc(admin,'reportAdmins/other@example.com'),{enabled:true}));
});

test('password staff UID grants reports; typed employee number cannot grant access',async()=>{
 await environment.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'staffAdmins/staff-a'),{enabled:true,employeeNumber:'1115034'});await setDoc(doc(c.firestore(),'staffAdmins/disabled'),{enabled:false,employeeNumber:'1107054'});await setDoc(doc(c.firestore(),'usageRecords/private'),{ip:'203.0.113.9'});});
 const claims={firebase:{sign_in_provider:'password'}};
 const admin=environment.authenticatedContext('staff-a',claims).firestore();
 await assertSucceeds(getDocs(collection(admin,'usageRecords')));await assertSucceeds(getDoc(doc(admin,'staffAdmins/staff-a')));await assertFails(setDoc(doc(admin,'staffAdmins/staff-a'),{enabled:true,employeeNumber:'1107054'}));
 for(const [uid,token] of [['staff-a',{firebase:{sign_in_provider:'anonymous'}}],['disabled',claims],['outsider',{...claims,employeeNumber:'1115034'}]])await assertFails(getDoc(doc(environment.authenticatedContext(uid,token).firestore(),'usageRecords/private')));
});
