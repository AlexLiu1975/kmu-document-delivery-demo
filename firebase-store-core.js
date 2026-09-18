(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FirebaseStoreCore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var statusModel = typeof module === 'object' && module.exports ? require('./status.js') : window.DocumentStatus;
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
    var key = statusModel.normalize(oldStatus) + '|' + statusModel.normalize(newStatus);
    var actions = {
      'P|R': '承辦人收文',
      '|R': '承辦人收文',
      'R|B': '退文',
      'B|R': '承辦人重新收文',
      'R|A': '歸檔'
    };
    if (!actions[key]) throw new Error('目前狀態不允許執行此操作。');
    return actions[key];
  }

  function targetStatus(current, operation) { return statusModel.next(current ? current.status : '', operation); }

  function buildMutation(current, number, actor, operation, reason, authUid, timestamp) {
    var documentNumber = validateDocumentNumber(number);
    var employeeNumber = validateEmployeeNumber(actor);
    var uid = String(authUid || '').trim();
    if (!uid) throw new Error('Firebase 登入狀態已失效，請重新登入。');
    var oldStatus = current ? statusModel.normalize(current.status) : '';
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
      typeCode: documentNumber.slice(3, 5),
      serial: documentNumber.slice(5),
      createdAt: timestamp,
      latestRejectionReason: '',
      latestRejectionActor: '',
      revision: 0
    };
    document.status = newStatus;
    document.updatedAt = timestamp;
    document.revision = Number(document.revision || 0) + 1;
    if (operation === 'RECEIVE') { document.assignee = employeeNumber; document.receivedAt = timestamp; }
    if (operation === 'ARCHIVE') document.archivedAt = timestamp;
    document.returnCount = Number(document.returnCount || 0);
    if (operation === 'REJECT') {
      document.returnCount += 1;
      document.lastReturnDate = timestamp;
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
