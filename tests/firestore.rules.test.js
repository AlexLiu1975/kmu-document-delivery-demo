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
    documentNumber: '11511000016',
    year: '115',
    typeCode: '110',
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
    documentNumber: '11511000016',
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
});

test('denies unauthenticated document reads and writes', async () => {
  const db = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'documents/11511000016')));
  await assertFails(setDoc(doc(db, 'documents/11511000016'), documentData()));
});

test('allows an authenticated user to create a valid received document', async () => {
  const db = environment.authenticatedContext('uid-a').firestore();
  await assertSucceeds(setDoc(doc(db, 'documents/11511000016'), documentData()));
});

test('denies malformed employee numbers and document numbers', async () => {
  const db = environment.authenticatedContext('uid-a').firestore();
  await assertFails(setDoc(doc(db, 'documents/not-a-number'), documentData()));
  await assertFails(setDoc(
    doc(db, 'documents/11511000016'),
    documentData({ assignee: '123' })
  ));
});

test('allows the approved document status transitions', async () => {
  const db = environment.authenticatedContext('uid-a').firestore();
  const ref = doc(db, 'documents/11511000016');
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

test('denies updates to archived documents and document deletion', async () => {
  const db = environment.authenticatedContext('uid-a').firestore();
  const ref = doc(db, 'documents/11511000016');
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'documents/11511000016'), documentData({
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
  const db = environment.authenticatedContext('uid-a').firestore();
  const ref = doc(db, 'documents/11511000016/events/event-1');
  await assertSucceeds(setDoc(ref, eventData('uid-a')));
  await assertFails(updateDoc(ref, { reason: '竄改原因' }));
  await assertFails(deleteDoc(ref));
  await assertFails(setDoc(
    doc(db, 'documents/11511000016/events/event-2'),
    eventData('different-uid')
  ));
});

test('allows authenticated collection-group reads of operation events', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'documents/11511000016/events/event-1'),
      eventData('uid-a')
    );
  });
  const db = environment.authenticatedContext('uid-a').firestore();
  await assertSucceeds(getDocs(query(collectionGroup(db, 'events'))));
});
