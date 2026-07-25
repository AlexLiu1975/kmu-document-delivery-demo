(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FirebaseStoreCore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function validateEmployeeNumber(value) {
    var text = String(value == null ? '' : value).trim();
    if (!/^\d{7}$/.test(text)) throw new Error('請輸入7碼職號，例如：1115034。');
    return text;
  }

  function validateDocumentNumber(value) {
    var text = String(value == null ? '' : value).trim();
    if (!/^\d{10}$/.test(text)) throw new Error('請輸入完整10碼文號。');
    return text;
  }

  function actionForTransition(oldStatus, newStatus) {
    var key = String(oldStatus || '') + '|' + String(newStatus || '');
    var actions = {
      '|已收文': '承辦人收文',
      '已收文|已退文': '退文',
      '已退文|已收文': '承辦人重新收文',
      '已收文|已歸檔': '歸檔'
    };
    if (!actions[key]) throw new Error('目前狀態不允許執行此操作。');
    return actions[key];
  }

  function targetStatus(current, operation) {
    var status = current ? current.status : '';
    if (operation === 'RECEIVE' && (!current || status === '已退文')) return '已收文';
    if (operation === 'REJECT' && status === '已收文') return '已退文';
    if (operation === 'ARCHIVE' && status === '已收文') return '已歸檔';
    throw new Error(current
      ? '此文號目前狀態為「' + status + '」，不允許執行此操作。'
      : '此文號尚未收文。');
  }

  function buildMutation(current, number, actor, operation, reason, authUid, timestamp) {
    var documentNumber = validateDocumentNumber(number);
    var employeeNumber = validateEmployeeNumber(actor);
    var uid = String(authUid || '').trim();
    if (!uid) throw new Error('Firebase 登入狀態已失效，請重新登入。');
    var oldStatus = current ? String(current.status || '') : '';
    var newStatus = targetStatus(current, operation);
    var action = actionForTransition(oldStatus, newStatus);
    var rejectionReason = String(reason || '').trim();
    if (operation === 'REJECT') {
      if (!rejectionReason) throw new Error('請選擇退文原因。');
      if (rejectionReason.length > 200) throw new Error('退文原因不可超過200個字元。');
    } else {
      rejectionReason = '';
    }

    var document = current ? Object.assign({}, current) : {
      documentNumber: documentNumber,
      year: documentNumber.slice(0, 3),
      typeCode: documentNumber.slice(3, 6),
      serial: documentNumber.slice(6),
      createdAt: timestamp,
      latestRejectionReason: '',
      latestRejectionActor: '',
      revision: 0
    };
    document.status = newStatus;
    document.updatedAt = timestamp;
    document.revision = Number(document.revision || 0) + 1;
    if (operation === 'RECEIVE') document.assignee = employeeNumber;
    if (operation === 'REJECT') {
      document.latestRejectionReason = rejectionReason;
      document.latestRejectionActor = employeeNumber;
    }

    return {
      isCreate: !current,
      document: document,
      event: {
        documentNumber: documentNumber,
        action: action,
        oldStatus: oldStatus,
        newStatus: newStatus,
        reason: rejectionReason,
        actor: employeeNumber,
        authUid: uid,
        occurredAt: timestamp
      }
    };
  }

  return {
    validateEmployeeNumber: validateEmployeeNumber,
    validateDocumentNumber: validateDocumentNumber,
    actionForTransition: actionForTransition,
    buildMutation: buildMutation
  };
});
