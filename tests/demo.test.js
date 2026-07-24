'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = require('../app.js');
const root = path.join(__dirname, '..');

test('normalizes document numbers and rejects invalid lengths', () => {
  assert.equal(app.normalizeDocumentNumber('  kmu   字第a-1號  '), 'KMU 字第A-1號');
  assert.throws(() => app.normalizeDocumentNumber(''));
  assert.throws(() => app.normalizeDocumentNumber('A'.repeat(101)));
});

test('supports the approved workflow only', () => {
  assert.equal(app.nextStatus('', 'DELIVER'), '已送達');
  assert.equal(app.nextStatus('已退文', 'REDELIVER'), '已送達');
  assert.equal(app.nextStatus('已送達', 'RECEIVE'), '已收文');
  assert.equal(app.nextStatus('已送達', 'REJECT'), '已退文');
  assert.equal(app.nextStatus('已收文', 'ARCHIVE'), '已歸檔');
  assert.throws(() => app.nextStatus('已歸檔', 'DELIVER'));
});

test('validates the fixed rejection reasons', () => {
  assert.equal(app.validateRejectionReason('缺少發文日期', ''), '缺少發文日期');
  assert.equal(app.validateRejectionReason('其它', '附件錯誤'), '其它：附件錯誤');
  assert.throws(() => app.validateRejectionReason('其它', ''));
  assert.throws(() => app.validateRejectionReason('未核准選項', ''));
});

test('creates, rejects, redelivers, receives, and archives immutable history', () => {
  let state = app.emptyState();
  state = app.deliver(state, '測試字第1號', '一般測試人員');
  const id = state.documents[0].id;
  state = app.manage(state, id, 'REJECT', '缺少校對章', '', '事務組測試人員');
  state = app.deliver(state, '測試字第1號', '一般測試人員');
  state = app.manage(state, id, 'RECEIVE', '', '', '事務組測試人員');
  state = app.manage(state, id, 'ARCHIVE', '', '', '事務組測試人員');
  assert.equal(state.documents[0].status, '已歸檔');
  assert.equal(state.documents[0].latestRejectionReason, '缺少校對章');
  assert.deepEqual(
    state.history.map((event) => event.action),
    ['首次送達', '退文', '重新送達', '確認收件', '歸檔']
  );
});

test('prevents duplicate delivery unless the document was rejected', () => {
  const state = app.deliver(app.emptyState(), '測試字第2號', '一般測試人員');
  assert.throws(() => app.deliver(state, '測試字第2號', '一般測試人員'));
});

test('builds ten-digit index document numbers', () => {
  assert.equal(app.buildDocumentNumber('115', '110', 500), '1151100500');
  assert.equal(app.buildDocumentNumber('115', '000', 599), '1150000599');
});

test('registers received documents with a seven-digit employee number', () => {
  let state = app.emptyState();
  state = app.registerReceived(state, '1151100500', '1115034');
  assert.equal(state.documents[0].status, '已收文');
  assert.equal(state.documents[0].assignee, '1115034');
  assert.equal(state.history[0].action, '承辦人收文');
  assert.equal(state.history[0].actor, '1115034');
  assert.throws(() => app.registerReceived(state, '1151100500', '1115034'));
  assert.throws(() => app.registerReceived(state, '1151100501', ''));
  assert.throws(() => app.registerReceived(state, '1151100501', '王小明'));
  assert.throws(() => app.registerReceived(state, '1151100501', '123456'));
  assert.throws(() => app.registerReceived(state, '115110501', '1115034'));
});

test('page is a dependency-free GitHub Pages demo', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /公開測試版/);
  assert.match(html, /localStorage/);
  assert.match(html, /一般人員/);
  assert.match(html, /事務組/);
  assert.match(html, /重設測試資料/);
  assert.match(html, /id="assignee"/);
  assert.match(html, /輸入職號/);
  assert.match(html, /placeholder="例如：1115034"/);
  assert.match(html, /id="input-mode-graphic"/);
  assert.match(html, /id="input-mode-manual"/);
  assert.match(html, /id="document-matrix"/);
  assert.match(html, /id="manual-receive-form"/);
  assert.doesNotMatch(html, /google\.script\.run/);
  assert.doesNotMatch(html, /@kmu\.edu\.tw/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:/i);
});
