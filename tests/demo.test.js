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
  assert.equal(app.nextStatus('已收文', 'REJECT'), '已退文');
  assert.equal(app.nextStatus('已收文', 'ARCHIVE'), '已歸檔');
  assert.throws(() => app.nextStatus('已歸檔', 'DELIVER'));
});

test('validates the fixed rejection reasons', () => {
  assert.equal(app.validateRejectionReason('缺少發文日期', ''), '缺少發文日期');
  assert.equal(app.validateRejectionReason('其它', '附件錯誤'), '其它：附件錯誤');
  assert.throws(() => app.validateRejectionReason('其它', ''));
  assert.throws(() => app.validateRejectionReason('未核准選項', ''));
});

test('allows staff to reject a received document with a fixed reason', () => {
  let state = app.registerReceived(app.emptyState(), '1151100500', '1115034');
  const id = state.documents[0].id;
  state = app.manage(state, id, 'REJECT', '缺少發文日期', '', '7654321');
  assert.equal(state.documents[0].status, '已退文');
  assert.equal(state.documents[0].latestRejectionReason, '缺少發文日期');
  assert.equal(state.documents[0].latestRejectionActor, '7654321');
  assert.equal(state.history[1].action, '退文');
  assert.equal(state.history[1].actor, '7654321');
  assert.equal(state.history[1].reason, '缺少發文日期');
});

test('creates, rejects, redelivers, receives, and archives immutable history', () => {
  let state = app.emptyState();
  state = app.deliver(state, '測試字第1號', '一般測試人員');
  const id = state.documents[0].id;
  state = app.manage(state, id, 'REJECT', '缺少校對章', '', '7654321');
  state = app.deliver(state, '測試字第1號', '一般測試人員');
  state = app.manage(state, id, 'RECEIVE', '', '', '7654321');
  state = app.manage(state, id, 'ARCHIVE', '', '', '7654321');
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

test('allows a rejected document to be received again', () => {
  let state = app.registerReceived(app.emptyState(), '1151100016', '1115034');
  const id = state.documents[0].id;
  state = app.manage(state, id, 'REJECT', '缺少發文日期', '', '7654321');
  state = app.registerReceived(state, '1151100016', '1115034');

  assert.equal(state.documents[0].status, '已收文');
  assert.equal(state.documents[0].assignee, '1115034');
  assert.deepEqual(
    state.history.map((event) => event.action),
    ['承辦人收文', '退文', '承辦人重新收文']
  );
});

test('uses a one-minute employee session timeout', () => {
  assert.equal(app.SESSION_TIMEOUT_MS, 60_000);
  assert.equal(app.formatCountdown(60), '01:00');
  assert.equal(app.formatCountdown(9), '00:09');
  assert.equal(app.formatCountdown(0), '00:00');
});

test('does not carry a logged-in employee session into staff access', () => {
  assert.equal(app.canSwitchRole(''), true);
  assert.equal(app.canSwitchRole('1115034'), false);
  assert.equal(app.canAccessStaff('general', '1115034'), false);
  assert.equal(app.canAccessStaff('staff', ''), false);
  assert.equal(app.canAccessStaff('staff', '1115034'), true);
});

test('shows the five history fields and rejection employee number', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(source, /日期時間/);
  assert.match(source, /公文文號/);
  assert.match(source, /動作/);
  assert.match(source, /退文原因/);
  assert.match(source, /操作帳號/);
  assert.match(source, /最近退文人員職號/);
});

test('groups document events into one complete workflow row', () => {
  const grouped = app.groupHistoryByDocument([
    {
      documentNumber: '1151100016', action: '歸檔', actor: '7654321',
      reason: '', occurredAt: 'T4', occurredAtMillis: 4
    },
    {
      documentNumber: '1151100016', action: '承辦人收文', actor: '1115034',
      reason: '', occurredAt: 'T1', occurredAtMillis: 1
    },
    {
      documentNumber: '1151100016', action: '退文', actor: '7654321',
      reason: '缺少發文日期', occurredAt: 'T2', occurredAtMillis: 2
    },
    {
      documentNumber: '1151100016', action: '承辦人重新收文', actor: '1115034',
      reason: '', occurredAt: 'T3', occurredAtMillis: 3
    }
  ]);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].flow, ['已收文', '已退文', '重新收文', '已歸檔']);
  assert.deepEqual(grouped[0].reasons, ['缺少發文日期']);
  assert.deepEqual(grouped[0].actors, ['1115034', '7654321', '1115034', '7654321']);
  assert.equal(grouped[0].firstAt, 'T1');
  assert.equal(grouped[0].lastAt, 'T4');
});

test('places logout and countdown in the global header', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const header = html.match(/<header>[\s\S]*?<\/header>/)[0];
  const deliverPanel = html.match(/id="panel-deliver"[\s\S]*?id="panel-query"/)[0];
  assert.match(header, /id="assignee-session"/);
  assert.match(header, /id="session-countdown"/);
  assert.match(header, /id="assignee-logout"/);
  assert.doesNotMatch(deliverPanel, /id="assignee-session"/);
});

test('uses Firebase as the only shared data source', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(html, /公開測試版/);
  assert.match(html, /type="module" src="firebase-store\.js"/);
  assert.match(html, /Firebase 共用測試資料/);
  assert.doesNotMatch(html, /資料僅儲存在目前瀏覽器 localStorage/);
  assert.match(html, /一般人員/);
  assert.match(html, /事務組/);
  assert.doesNotMatch(html, /重設測試資料/);
  assert.match(html, /id="assignee"/);
  assert.match(html, /id="assignee-login"/);
  assert.match(html, /id="assignee-logout"/);
  assert.match(html, /id="current-assignee"/);
  assert.match(html, /id="session-countdown"/);
  assert.match(html, /✓ 已登入/);
  assert.match(html, /輸入職號/);
  assert.match(html, /placeholder="例如：1115034"/);
  assert.match(html, /id="input-mode-graphic"/);
  assert.match(html, /id="input-mode-manual"/);
  assert.match(html, /id="document-matrix"/);
  assert.match(html, /id="manual-receive-form"/);
  assert.match(html, /<option>缺少發文日期<\/option>/);
  assert.match(html, /<option>缺少已用印信章<\/option>/);
  assert.match(html, /<option>缺少監印章<\/option>/);
  assert.match(html, /<option>缺少校對章<\/option>/);
  assert.match(html, /<option value="其它">其它：<\/option>/);
  assert.doesNotMatch(html, /google\.script\.run/);
  assert.doesNotMatch(html, /@kmu\.edu\.tw/);
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:/i);
  assert.doesNotMatch(source, /localStorage\.setItem/);
  assert.doesNotMatch(source, /localStorage\.getItem/);
  assert.match(source, /firebaseDocumentStore/);
});
