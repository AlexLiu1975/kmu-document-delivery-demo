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
  assert.equal(app.nextStatus('已送達', 'RECEIVE'), '已收件');
  assert.equal(app.nextStatus('已送達', 'REJECT'), '已退文');
  assert.equal(app.nextStatus('已收件', 'ARCHIVE'), '已歸檔');
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

test('page is a dependency-free GitHub Pages demo', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /公開測試版/);
  assert.match(html, /localStorage/);
  assert.match(html, /一般人員/);
  assert.match(html, /事務組/);
  assert.match(html, /重設測試資料/);
  assert.doesNotMatch(html, /google\.script\.run/);
  assert.doesNotMatch(html, /@kmu\.edu\.tw/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:/i);
});
