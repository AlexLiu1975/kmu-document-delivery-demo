(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DocumentDemo = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var STORAGE_KEY = 'kmu-document-delivery-demo-v1';
  var SESSION_TIMEOUT_MS = 600000;
  var REASONS = ['缺少發文日期', '缺少已用印信章', '缺少監印章', '缺少校對章', '其它'];
  var STATUS = { DELIVERED: '已送達', RECEIVED: '已收文', REJECTED: '已退文', ARCHIVED: '已歸檔' };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowText() {
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date()).replace(/\//g, '-');
  }

  function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function normalizeDocumentNumber(value) {
    var text = String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toUpperCase();
    if (!text) throw new Error('請輸入文號。');
    if (text.length > 100) throw new Error('文號不可超過 100 個字元。');
    return text;
  }

  function buildDocumentNumber(year, typeCode, serial) {
    return String(year).padStart(3, '0') + String(typeCode).padStart(3, '0') +
      String(serial).padStart(4, '0');
  }

  function normalizeIndexDocumentNumber(value) {
    var text = String(value == null ? '' : value).trim();
    if (!/^\d{10}$/.test(text)) throw new Error('請輸入完整 10 碼文號。');
    return text;
  }

  function normalizeAssignee(value) {
    var text = String(value == null ? '' : value).trim();
    if (!/^\d{7}$/.test(text)) throw new Error('請輸入7碼職號，例如：1115034。');
    return text;
  }

  function formatCountdown(seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    var minutes = Math.floor(total / 60);
    var remainder = total % 60;
    return String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
  }

  function canSwitchRole(employeeNumber) {
    return !String(employeeNumber || '').trim();
  }

  function canAccessStaff(roleName, employeeNumber) {
    return roleName === 'staff' && /^\d{7}$/.test(String(employeeNumber || '').trim());
  }

  function nextStatus(fromStatus, action) {
    var transitions = {};
    transitions['|DELIVER'] = STATUS.DELIVERED;
    transitions[STATUS.REJECTED + '|REDELIVER'] = STATUS.DELIVERED;
    transitions[STATUS.DELIVERED + '|RECEIVE'] = STATUS.RECEIVED;
    transitions[STATUS.REJECTED + '|RECEIVE'] = STATUS.RECEIVED;
    transitions[STATUS.DELIVERED + '|REJECT'] = STATUS.REJECTED;
    transitions[STATUS.RECEIVED + '|REJECT'] = STATUS.REJECTED;
    transitions[STATUS.RECEIVED + '|ARCHIVE'] = STATUS.ARCHIVED;
    var result = transitions[String(fromStatus || '') + '|' + action];
    if (!result) throw new Error('目前狀態不允許執行此操作。');
    return result;
  }

  function validateRejectionReason(category, detail) {
    var selected = String(category || '').trim();
    var extra = String(detail || '').trim();
    if (REASONS.indexOf(selected) < 0) throw new Error('請選擇有效的退文原因。');
    if (selected === '其它') {
      if (!extra) throw new Error('請填寫其它退文原因。');
      if (extra.length > 200) throw new Error('其它原因不可超過 200 個字元。');
      return '其它：' + extra;
    }
    return selected;
  }

  function emptyState() {
    return { version: 1, documents: [], history: [] };
  }

  function addHistory(state, document, action, oldStatus, actor, reason) {
    state.history.push({
      id: newId('HIS'), documentId: document.id, documentNumber: document.documentNumber,
      action: action, oldStatus: oldStatus || '', newStatus: document.status,
      occurredAt: document.updatedAt, actor: actor, reason: reason || ''
    });
  }

  function deliver(inputState, number, actor) {
    var state = clone(inputState);
    var normalized = normalizeDocumentNumber(number);
    var document = state.documents.find(function (item) { return item.index === normalized; });
    var time = nowText();
    if (!document) {
      document = {
        id: newId('DOC'), documentNumber: normalized, index: normalized,
        status: nextStatus('', 'DELIVER'), firstDeliveredAt: time,
        lastDeliveredAt: time, updatedAt: time, latestRejectionReason: ''
      };
      state.documents.push(document);
      addHistory(state, document, '首次送達', '', actor);
      return state;
    }
    if (document.status !== STATUS.REJECTED) {
      throw new Error('此文號已登錄，目前狀態為「' + document.status + '」。');
    }
    var oldStatus = document.status;
    document.status = nextStatus(oldStatus, 'REDELIVER');
    document.lastDeliveredAt = time;
    document.updatedAt = time;
    addHistory(state, document, '重新送達', oldStatus, actor);
    return state;
  }

  function registerReceived(inputState, number, assignee) {
    var state = clone(inputState);
    var normalized = normalizeIndexDocumentNumber(number);
    var handler = normalizeAssignee(assignee);
    var document = state.documents.find(function (item) { return item.index === normalized; });
    var time = nowText();
    if (document && document.status !== STATUS.DELIVERED && document.status !== STATUS.REJECTED) {
      throw new Error('此文號已登錄，目前狀態為「' + document.status + '」。');
    }
    if (!document) {
      document = {
        id: newId('DOC'), documentNumber: normalized, index: normalized,
        status: STATUS.RECEIVED, firstDeliveredAt: time, lastDeliveredAt: time,
        updatedAt: time, latestRejectionReason: '', assignee: handler
      };
      state.documents.push(document);
      addHistory(state, document, '承辦人收文', '', handler);
      return state;
    }
    var oldStatus = document.status;
    document.status = nextStatus(oldStatus, 'RECEIVE');
    document.updatedAt = time;
    document.assignee = handler;
    addHistory(
      state,
      document,
      oldStatus === STATUS.REJECTED ? '承辦人重新收文' : '承辦人收文',
      oldStatus,
      handler
    );
    return state;
  }

  function manage(inputState, documentId, action, category, detail, actor) {
    var state = clone(inputState);
    var document = state.documents.find(function (item) { return item.id === documentId; });
    if (!document) throw new Error('查無此案件。');
    var oldStatus = document.status;
    var reason = action === 'REJECT' ? validateRejectionReason(category, detail) : '';
    document.status = nextStatus(oldStatus, action);
    document.updatedAt = nowText();
    if (reason) {
      document.latestRejectionReason = reason;
      document.latestRejectionActor = normalizeAssignee(actor);
    }
    var labels = { RECEIVE: '確認收件', REJECT: '退文', ARCHIVE: '歸檔' };
    addHistory(state, document, labels[action], oldStatus, actor, reason);
    return state;
  }

  function seedState() {
    var state = emptyState();
    state = deliver(state, '測試秘字第115000001號', '一般測試人員');
    state = deliver(state, '測試秘字第115000002號', '一般測試人員');
    state = manage(state, state.documents[1].id, 'REJECT', '缺少校對章', '', '7654321');
    return state;
  }

  function groupHistoryByDocument(events) {
    var groups = {};
    var flowLabels = {
      '承辦人收文': '已收文',
      '退文': '已退文',
      '承辦人重新收文': '重新收文',
      '歸檔': '已歸檔',
      '確認收件': '已收文'
    };
    (events || []).forEach(function (event, index) {
      var number = String(event.documentNumber || '');
      if (!groups[number]) groups[number] = [];
      var copy = Object.assign({ _order: index }, event);
      groups[number].push(copy);
    });
    return Object.keys(groups).map(function (number) {
      var ordered = groups[number].slice().sort(function (left, right) {
        var leftTime = Number(left.occurredAtMillis);
        var rightTime = Number(right.occurredAtMillis);
        if (isNaN(leftTime) || isNaN(rightTime)) return left._order - right._order;
        return leftTime - rightTime;
      });
      return {
        documentNumber: number,
        firstAt: ordered[0].occurredAt || '—',
        lastAt: ordered[ordered.length - 1].occurredAt || '—',
        lastAtMillis: Number(ordered[ordered.length - 1].occurredAtMillis) || 0,
        flow: ordered.map(function (event) {
          return flowLabels[event.action] || event.newStatus || event.action || '—';
        }),
        reasons: ordered.filter(function (event) { return event.reason; })
          .map(function (event) { return event.reason; }),
        actors: ordered.map(function (event) { return event.actor || '—'; }),
        events: ordered
      };
    }).sort(function (left, right) {
      return right.lastAtMillis - left.lastAtMillis;
    });
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    SESSION_TIMEOUT_MS: SESSION_TIMEOUT_MS,
    REASONS: REASONS,
    STATUS: STATUS,
    emptyState: emptyState,
    normalizeDocumentNumber: normalizeDocumentNumber,
    buildDocumentNumber: buildDocumentNumber,
    normalizeIndexDocumentNumber: normalizeIndexDocumentNumber,
    formatCountdown: formatCountdown,
    canSwitchRole: canSwitchRole,
    canAccessStaff: canAccessStaff,
    nextStatus: nextStatus,
    validateRejectionReason: validateRejectionReason,
    deliver: deliver,
    registerReceived: registerReceived,
    manage: manage,
    seedState: seedState,
    groupHistoryByDocument: groupHistoryByDocument
  };

  if (typeof document === 'undefined') return api;

  var state = emptyState();
  var role = 'general';
  var selectedRejectId = '';
  var inputMode = 'graphic';
  var indexType = 'draft';
  var currentAssignee = '';
  var sessionTimer = null;
  var sessionInterval = null;
  var sessionDeadline = 0;
  var firebaseStore = null;
  var unsubscribeFirebase = null;
  var lastReceivedNumber = '';
  var byId = function (id) { return document.getElementById(id); };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function statusLabel(status) {
    if (status === STATUS.RECEIVED) return '事務組簽收';
    return status;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function notify(message, error) {
    var box = byId('toast');
    box.textContent = message;
    box.classList.toggle('error', Boolean(error));
    box.classList.add('show');
    window.setTimeout(function () { box.classList.remove('show'); }, 3600);
  }

  function setConnectionStatus(stateName, text) {
    var status = byId('connection-status');
    status.dataset.state = stateName;
    status.textContent = text;
  }

  function firebaseErrorMessage(error) {
    var code = error && error.code ? String(error.code) : '';
    if (code.indexOf('auth/operation-not-allowed') >= 0) {
      return 'Firebase 尚未啟用匿名登入，請先在 Authentication 開啟 Anonymous。';
    }
    if (code.indexOf('permission-denied') >= 0) {
      return 'Firestore 權限不足，請確認資料庫與安全規則已部署。';
    }
    if (code.indexOf('unavailable') >= 0) {
      return 'Firebase 目前無法連線，資料尚未同步。';
    }
    if (code.indexOf('failed-precondition') >= 0) {
      return 'Firestore 缺少必要索引，請部署 firestore.indexes.json 或依主控台連結建立索引。';
    }
    return error && error.message ? error.message : 'Firebase 操作失敗。';
  }

  function recordCard(record) {
    var headers = ['文號', '目前狀態', '登錄時間', '登錄職號', '最後更新', '最近退文原因', '退文人員職號'];
    var values = [
      record.documentNumber,
      statusLabel(record.status),
      record.createdAt || '—',
      record.assignee || '—',
      record.updatedAt || '—',
      record.latestRejectionReason || '—',
      record.latestRejectionActor || '—'
    ];
    var wrap = el('div', 'history-list');
    var table = el('table', 'history-table');
    var head = el('thead');
    var headRow = el('tr');
    headers.forEach(function (header) {
      headRow.appendChild(el('th', '', header));
    });
    head.appendChild(headRow);
    table.appendChild(head);
    var body = el('tbody');
    var row = el('tr');
    values.forEach(function (value, index) {
      var cell = el('td', '', value);
      cell.dataset.label = headers[index];
      if (index === 1) {
        cell.textContent = '';
        var badge = el('strong', 'badge', value);
        badge.dataset.status = record.status;
        cell.appendChild(badge);
      }
      row.appendChild(cell);
    });
    body.appendChild(row);
    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  function clampIndexPage(value) {
    var parsed = parseInt(value, 10);
    if (isNaN(parsed)) return 0;
    return Math.max(0, Math.min(99, parsed));
  }

  function findDocument(number) {
    return state.documents.find(function (item) { return item.documentNumber === number; });
  }

  function indexStatusClass(number) {
    var record = findDocument(number);
    if (!record) return 'index-pending';
    if (record.status === STATUS.ARCHIVED) return 'index-archived';
    if (record.status === STATUS.RECEIVED) return 'index-received';
    return 'index-pending';
  }

  function renderMatrix() {
    var body = byId('document-matrix');
    if (!body) return;
    clear(body);
    var year = byId('index-year').value;
    var page = clampIndexPage(byId('index-page').value);
    var typeCode = indexType === 'draft' ? '110' : '000';
    var start = page * 100;
    var end = start + 99;
    byId('index-page').value = page;
    byId('index-prev').disabled = page === 0;
    byId('index-next').disabled = page === 99;
    byId('index-range').textContent =
      buildDocumentNumber(year, typeCode, start) + '–' + buildDocumentNumber(year, typeCode, end);
    byId('index-draft').classList.toggle('active', indexType === 'draft');
    byId('index-draft').setAttribute('aria-pressed', String(indexType === 'draft'));
    byId('index-receive').classList.toggle('active', indexType === 'receive');
    byId('index-receive').setAttribute('aria-pressed', String(indexType === 'receive'));
    for (var serial = start; serial <= end; serial += 1) {
      var number = buildDocumentNumber(year, typeCode, serial);
      var button = el('button', 'document-cell ' + indexStatusClass(number), number);
      button.type = 'button';
      button.dataset.documentNumber = number;
      var record = findDocument(number);
      button.title = record ? record.status + (record.assignee ? '｜' + record.assignee : '') : '未收文';
      body.appendChild(button);
    }
  }

  function renderInputMode() {
    var graphic = inputMode === 'graphic';
    byId('graphic-receive').hidden = !graphic;
    byId('manual-receive').hidden = graphic;
    byId('input-mode-graphic').classList.toggle('active', graphic);
    byId('input-mode-graphic').setAttribute('aria-pressed', String(graphic));
    byId('input-mode-manual').classList.toggle('active', !graphic);
    byId('input-mode-manual').setAttribute('aria-pressed', String(!graphic));
  }

  function renderAssigneeSession() {
    var loggedIn = Boolean(currentAssignee);
    byId('assignee-login-panel').hidden = loggedIn;
    byId('assignee-session').hidden = !loggedIn;
    byId('current-assignee').textContent = currentAssignee;
  }

  function updateSessionCountdown() {
    if (!currentAssignee) return;
    var seconds = Math.max(0, Math.ceil((sessionDeadline - Date.now()) / 1000));
    byId('session-countdown').textContent = '自動登出倒數 ' + formatCountdown(seconds);
  }

  async function logoutAssignee(isAutomatic) {
    currentAssignee = '';
    if (sessionTimer) window.clearTimeout(sessionTimer);
    if (sessionInterval) window.clearInterval(sessionInterval);
    sessionTimer = null;
    sessionInterval = null;
    sessionDeadline = 0;
    if (unsubscribeFirebase) {
      unsubscribeFirebase();
      unsubscribeFirebase = null;
    }
    state = emptyState();
    byId('assignee').value = '';
    renderAll();
    if (firebaseStore) {
      try {
        await firebaseStore.logout();
        setConnectionStatus('ready', 'Firebase 已連線，請登入職號');
      } catch (error) {
        setConnectionStatus('error', 'Firebase 登出失敗');
        notify(firebaseErrorMessage(error), true);
      }
    }
    if (isAutomatic) notify('閒置超過10分鐘，已自動登出。');
  }

  function resetSessionTimer() {
    if (!currentAssignee) return;
    if (sessionTimer) window.clearTimeout(sessionTimer);
    sessionDeadline = Date.now() + SESSION_TIMEOUT_MS;
    sessionTimer = window.setTimeout(function () {
      logoutAssignee(true);
    }, SESSION_TIMEOUT_MS);
    if (!sessionInterval) {
      sessionInterval = window.setInterval(updateSessionCountdown, 1000);
    }
    updateSessionCountdown();
  }

  function startFirebaseSubscription() {
    if (unsubscribeFirebase) unsubscribeFirebase();
    unsubscribeFirebase = firebaseStore.subscribe(function (nextState) {
      state = nextState;
      setConnectionStatus('synced', 'Firebase 已同步');
      renderAll();
      if (lastReceivedNumber && findDocument(lastReceivedNumber)) {
        showReceivedResult(lastReceivedNumber);
        lastReceivedNumber = '';
      }
    }, function (error) {
      setConnectionStatus('error', '離線／尚未同步');
      notify(firebaseErrorMessage(error), true);
    });
  }

  async function loginAssignee() {
    if (!firebaseStore) throw new Error('Firebase 尚在連線中，請稍後再試。');
    var employeeNumber = normalizeAssignee(byId('assignee').value);
    setConnectionStatus('connecting', 'Firebase 登入中');
    await firebaseStore.login(employeeNumber);
    currentAssignee = employeeNumber;
    startFirebaseSubscription();
    resetSessionTimer();
    renderAll();
    notify('職號 ' + currentAssignee + ' 已登入 Firebase 測試資料。');
  }

  function showReceivedResult(number) {
    var record = findDocument(number);
    clear(byId('deliver-result'));
    byId('deliver-result').appendChild(recordCard(record));
  }

  async function runRegisterReceived(number) {
    if (!currentAssignee) throw new Error('請先輸入職號並登入。');
    var normalized = normalizeIndexDocumentNumber(number);
    lastReceivedNumber = normalized;
    await firebaseStore.receive(normalized, currentAssignee);
    notify('已登記為事務組簽收。');
  }

  function renderManage() {
    var body = byId('manage-list');
    clear(body);
    if (!canAccessStaff(role, currentAssignee)) return;
    var records = state.documents.filter(function (item) {
      return item.status === STATUS.RECEIVED;
    });
    if (!records.length) {
      body.appendChild(el('p', 'empty', '目前沒有待處理案件。'));
      return;
    }
    records.forEach(function (record) {
      var row = el('article', 'case-row');
      var info = el('div');
      info.appendChild(el('strong', '', record.documentNumber));
      var badge = el('span', 'badge', statusLabel(record.status));
      badge.dataset.status = record.status;
      info.appendChild(badge);
      info.appendChild(el('small', '', '最後更新：' + record.updatedAt));
      row.appendChild(info);
      var actions = el('div', 'row-actions');
      actions.appendChild(actionButton('歸檔', 'primary', function () {
        runManage(record.documentNumber, 'ARCHIVE');
      }));
      actions.appendChild(actionButton('退文', 'danger', function () {
        selectedRejectId = record.documentNumber;
        byId('reject-doc').textContent = '文號：' + record.documentNumber;
        byId('reject-dialog').showModal();
      }));
      row.appendChild(actions);
      body.appendChild(row);
    });
  }

  function actionButton(text, className, callback) {
    var button = el('button', 'button ' + className, text);
    button.type = 'button';
    button.addEventListener('click', callback);
    return button;
  }

  async function runManage(documentNumber, action) {
    try {
      if (!canAccessStaff(role, currentAssignee)) {
        throw new Error('請先以事務組身分登入。');
      }
      if (action !== 'ARCHIVE') throw new Error('不支援的管理操作。');
      await firebaseStore.archive(documentNumber, currentAssignee);
      notify('歸檔完成。');
    } catch (error) {
      notify(error.message, true);
    }
  }

  function renderHistory() {
    var body = byId('history-list');
    clear(body);
    var headers = ['日期時間', '公文文號', '動作', '退文原因', '操作帳號'];
    var table = el('table', 'history-table');
    var head = el('thead');
    var headRow = el('tr');
    headers.forEach(function (header) {
      headRow.appendChild(el('th', '', header));
    });
    head.appendChild(headRow);
    table.appendChild(head);
    var tableBody = el('tbody');
    groupHistoryByDocument(state.history).forEach(function (group) {
      var row = el('tr');
      var values = [
        group.firstAt === group.lastAt ? group.firstAt : group.firstAt + ' → ' + group.lastAt,
        group.documentNumber,
        group.flow.join(' → '),
        group.reasons.length ? group.reasons.join('、') : '—',
        group.actors.join(' → ')
      ];
      values.forEach(function (value, index) {
        var cell = el('td', '', value);
        cell.dataset.label = headers[index];
        if (index === 2) {
          cell.textContent = '';
          cell.appendChild(el('span', 'workflow-flow', value));
          var detailButton = el('button', 'history-detail-toggle', '查看明細');
          detailButton.type = 'button';
          detailButton.setAttribute('aria-expanded', 'false');
          cell.appendChild(detailButton);
        }
        row.appendChild(cell);
      });
      tableBody.appendChild(row);
      var detailRow = el('tr', 'history-detail-row');
      detailRow.hidden = true;
      var detailCell = el('td');
      detailCell.colSpan = headers.length;
      var detailTable = el('table', 'history-detail-table');
      var detailHead = el('thead');
      var detailHeadRow = el('tr');
      headers.forEach(function (header) {
        detailHeadRow.appendChild(el('th', '', header));
      });
      detailHead.appendChild(detailHeadRow);
      detailTable.appendChild(detailHead);
      var detailBody = el('tbody');
      group.events.forEach(function (event) {
        var eventRow = el('tr');
        [
          event.occurredAt || '—',
          event.documentNumber || '—',
          event.action || '—',
          event.reason || '—',
          event.actor || '—'
        ].forEach(function (value, index) {
          var eventCell = el('td', '', value);
          eventCell.dataset.label = headers[index];
          eventRow.appendChild(eventCell);
        });
        detailBody.appendChild(eventRow);
      });
      detailTable.appendChild(detailBody);
      detailCell.appendChild(detailTable);
      detailRow.appendChild(detailCell);
      tableBody.appendChild(detailRow);
      row.querySelector('.history-detail-toggle').addEventListener('click', function (event) {
        detailRow.hidden = !detailRow.hidden;
        event.currentTarget.setAttribute('aria-expanded', String(!detailRow.hidden));
        event.currentTarget.textContent = detailRow.hidden ? '查看明細' : '收合明細';
      });
    });
    table.appendChild(tableBody);
    body.appendChild(table);
  }

  function renderAll() {
    var staffAccess = canAccessStaff(role, currentAssignee);
    byId('role-label').textContent = role === 'staff' ? '事務組測試人員' : '一般測試人員';
    byId('role-toggle').disabled = !canSwitchRole(currentAssignee);
    byId('role-toggle').title = currentAssignee ? '請先登出目前職號' : '';
    byId('tab-manage').hidden = !staffAccess;
    if (!staffAccess && byId('panel-manage').classList.contains('active')) activate('deliver');
    renderManage();
    renderHistory();
    renderInputMode();
    renderMatrix();
    renderAssigneeSession();
  }

  function activate(name) {
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.panel === name);
      tab.setAttribute('aria-selected', String(tab.dataset.panel === name));
    });
    document.querySelectorAll('.panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.id === 'panel-' + name);
    });
  }

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () { activate(tab.dataset.panel); });
  });

  byId('role-toggle').addEventListener('click', function () {
    if (!canSwitchRole(currentAssignee)) {
      notify('請先登出目前職號，再切換身分。', true);
      return;
    }
    role = role === 'general' ? 'staff' : 'general';
    renderAll();
    notify('已切換為' + byId('role-label').textContent + '。');
  });

  byId('manual-receive-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    try {
      var number = byId('manual-document-number').value;
      await runRegisterReceived(number);
      byId('manual-document-number').value = '';
    } catch (error) {
      notify(error.message, true);
    }
  });

  byId('assignee-login').addEventListener('click', async function () {
    try {
      await loginAssignee();
    } catch (error) {
      notify(error.message, true);
    }
  });
  byId('assignee').addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    byId('assignee-login').click();
  });
  byId('assignee-logout').addEventListener('click', async function () {
    await logoutAssignee(false);
    notify('已登出。');
  });
  ['click', 'keydown', 'pointerdown', 'touchstart'].forEach(function (eventName) {
    document.addEventListener(eventName, resetSessionTimer, { passive: true });
  });

  byId('input-mode-graphic').addEventListener('click', function () {
    inputMode = 'graphic';
    renderInputMode();
  });
  byId('input-mode-manual').addEventListener('click', function () {
    inputMode = 'manual';
    renderInputMode();
  });
  byId('index-draft').addEventListener('click', function () {
    indexType = 'draft';
    renderMatrix();
  });
  byId('index-receive').addEventListener('click', function () {
    indexType = 'receive';
    renderMatrix();
  });
  byId('index-year').addEventListener('change', renderMatrix);
  byId('index-page').addEventListener('change', renderMatrix);
  byId('index-prev').addEventListener('click', function () {
    byId('index-page').value = clampIndexPage(byId('index-page').value) - 1;
    renderMatrix();
  });
  byId('index-next').addEventListener('click', function () {
    byId('index-page').value = clampIndexPage(byId('index-page').value) + 1;
    renderMatrix();
  });
  byId('document-matrix').addEventListener('click', async function (event) {
    var button = event.target.closest('[data-document-number]');
    if (!button) return;
    try {
      await runRegisterReceived(button.dataset.documentNumber);
    } catch (error) {
      notify(error.message, true);
    }
  });

  byId('query-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var result = byId('query-result');
    clear(result);
    try {
      var index = normalizeIndexDocumentNumber(byId('query-number').value);
      var record = findDocument(index);
      result.appendChild(record ? recordCard(record) : el('p', 'empty', '查無此文號資料。'));
    } catch (error) {
      notify(error.message, true);
    }
  });

  byId('reason').addEventListener('change', function () {
    var other = byId('other-wrap');
    other.hidden = byId('reason').value !== '其它';
    byId('other').required = !other.hidden;
  });

  byId('reject-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    try {
      if (!canAccessStaff(role, currentAssignee)) {
        throw new Error('請先以事務組身分登入。');
      }
      var reason = validateRejectionReason(byId('reason').value, byId('other').value);
      await firebaseStore.reject(selectedRejectId, currentAssignee, reason);
      byId('reject-dialog').close();
      event.currentTarget.reset();
      byId('other-wrap').hidden = true;
      renderAll();
      notify('退文完成。');
    } catch (error) {
      notify(error.message, true);
    }
  });

  byId('cancel-reject').addEventListener('click', function () { byId('reject-dialog').close(); });

  renderAll();
  function connectFirebaseStore() {
    firebaseStore = window.firebaseDocumentStore;
    if (!firebaseStore) {
      setConnectionStatus('error', 'Firebase 設定未完成');
      return;
    }
    setConnectionStatus('ready', 'Firebase 已連線，請登入職號');
  }
  window.addEventListener('firebase-store-ready', connectFirebaseStore, { once: true });
  if (window.firebaseDocumentStore) connectFirebaseStore();
  window.setTimeout(function () {
    if (!firebaseStore) setConnectionStatus('error', 'Firebase 設定未完成');
  }, 8000);
  return api;
});
