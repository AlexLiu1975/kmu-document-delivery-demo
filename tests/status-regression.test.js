const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../firebase-store-core');
const app = require('../app');
test('1151103143 return, receive, return, receive and archive retain metadata', () => {
 const mutate = (current, operation, time) => core.buildMutation(current, '1151103143', '1115034', operation, operation === 'REJECT' ? '缺少監印章' : '', 'uid', time);
 let record = mutate(null, 'RECEIVE', 'T1').document;
 assert.equal(record.status, 'R');
 record = mutate(record, 'REJECT', 'T2').document;
 assert.equal(record.status, 'B');
 assert.equal(record.returnCount, 1);
 assert.equal(record.lastReturnDate, 'T2');
 record = mutate(record, 'RECEIVE', 'T3').document;
 assert.equal(record.receivedAt, 'T3');
 record = mutate(record, 'REJECT', 'T4').document;
 assert.equal(record.returnCount, 2);
 record = mutate(record, 'RECEIVE', 'T5').document;
 record = mutate(record, 'ARCHIVE', 'T6').document;
 assert.equal(record.status, 'A');
 assert.equal(record.archivedAt, 'T6');
 assert.equal(record.latestRejectionReason, '缺少監印章');
 assert.equal(record.lastReturnDate, 'T4');
 assert.throws(() => mutate(record, 'REJECT', 'T7'));
});
test('legacy Chinese state transitions migrate to canonical codes', () => {
 const record = core.buildMutation({ status: '已收文', revision: 1 }, '1151103143', '1115034', 'REJECT', '缺少監印章', 'uid', 'T2');
 assert.equal(record.document.status, 'B');
 assert.equal(record.event.oldStatus, 'R');
 assert.equal(record.event.newStatus, 'B');
});
test('P can be received but cannot be archived', () => {
 const record = { status: 'P', revision: 1 };
 assert.equal(core.buildMutation(record, '1151103143', '1115034', 'RECEIVE', '', 'uid', 'T1').document.status, 'R');
 assert.throws(() => core.buildMutation(record, '1151103143', '1115034', 'ARCHIVE', '', 'uid', 'T1'));
});
test('matrix statuses distinguish returned documents and support legacy states', () => {
 assert.equal(app.statusClass('B'), 'index-returned');
 assert.equal(app.statusClass('已退文'), 'index-returned');
 assert.equal(app.statusClass('P'), 'index-pending');
 assert.equal(app.statusClass('R'), 'index-received');
 assert.equal(app.statusClass('A'), 'index-archived');
 assert.equal(app.statusLabel('B'), '已退文');
});
test('document numbers use 3-digit year, 3-digit type and 4-digit serial', () => {
 assert.equal(app.buildDocumentNumber('115', '110', 3143), '1151103143');
 assert.equal(app.buildDocumentNumber('115', '000', 3143), '1150003143');
});
