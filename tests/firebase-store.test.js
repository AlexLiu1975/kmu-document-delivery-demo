'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../firebase-store-core.js');
const root = path.join(__dirname, '..');

test('validates Firebase employee and document numbers', () => {
  assert.equal(core.validateEmployeeNumber('1115034'), '1115034');
  assert.equal(core.validateDocumentNumber('1151100016'), '1151100016');
  assert.throws(() => core.validateEmployeeNumber('123'));
  assert.throws(() => core.validateDocumentNumber('115110016'));
});

test('maps approved transitions to history actions', () => {
  assert.equal(core.actionForTransition('', '已收文'), '承辦人收文');
  assert.equal(core.actionForTransition('已收文', '已退文'), '退文');
  assert.equal(core.actionForTransition('已退文', '已收文'), '承辦人重新收文');
  assert.equal(core.actionForTransition('已收文', '已歸檔'), '歸檔');
  assert.throws(() => core.actionForTransition('已歸檔', '已收文'));
});

test('builds a create mutation with matching document and event data', () => {
  const mutation = core.buildMutation(
    null,
    '1151100016',
    '1115034',
    'RECEIVE',
    '',
    'anonymous-uid',
    'SERVER_TIME'
  );
  assert.equal(mutation.isCreate, true);
  assert.equal(mutation.document.status, '已收文');
  assert.equal(mutation.document.revision, 1);
  assert.equal(mutation.event.action, '承辦人收文');
  assert.equal(mutation.event.authUid, 'anonymous-uid');
});

test('builds rejected, re-received, and archived transaction mutations', () => {
  const received = core.buildMutation(
    null, '1151100016', '1115034', 'RECEIVE', '', 'uid-a', 'T1'
  ).document;
  const rejected = core.buildMutation(
    received, '1151100016', '7654321', 'REJECT',
    '缺少發文日期', 'uid-b', 'T2'
  );
  assert.equal(rejected.document.status, '已退文');
  assert.equal(rejected.document.latestRejectionActor, '7654321');
  assert.equal(rejected.event.reason, '缺少發文日期');

  const receivedAgain = core.buildMutation(
    rejected.document, '1151100016', '1115034', 'RECEIVE', '', 'uid-a', 'T3'
  );
  assert.equal(receivedAgain.event.action, '承辦人重新收文');
  assert.equal(receivedAgain.document.latestRejectionReason, '缺少發文日期');

  const archived = core.buildMutation(
    receivedAgain.document, '1151100016', '7654321', 'ARCHIVE', '', 'uid-b', 'T4'
  );
  assert.equal(archived.document.status, '已歸檔');
  assert.equal(archived.document.revision, 4);
  assert.throws(() => core.buildMutation(
    archived.document, '1151100016', '1115034', 'RECEIVE', '', 'uid-a', 'T5'
  ));
});

test('Firebase browser adapter uses anonymous auth, snapshots, and transactions', () => {
  const source = fs.readFileSync(path.join(root, 'firebase-store.js'), 'utf8');
  assert.match(source, /initializeAuth/);
  assert.match(source, /inMemoryPersistence/);
  assert.match(source, /signInAnonymously/);
  assert.match(source, /signOut/);
  assert.match(source, /onSnapshot/);
  assert.match(source, /runTransaction/);
  assert.doesNotMatch(source, /analytics/i);
});
