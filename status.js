(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DocumentStatus = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var labels = { P: '未收文', R: '已收文', B: '已退文', A: '已歸檔' };
  var legacy = { '未收文': 'P', '已送達': 'P', '已收文': 'R', '事務組簽收': 'R', '已退文': 'B', '已歸檔': 'A' };
  function normalize(value) {
    var text = String(value || '').trim();
    return legacy[text] || text;
  }
  function label(value) { return labels[normalize(value)] || '未知狀態'; }
  function className(value) {
    return { P: 'index-pending', R: 'index-received', B: 'index-returned', A: 'index-archived' }[normalize(value)] || 'index-unknown';
  }
  function next(value, action) {
    var transitions = { '|DELIVER': 'P', '|RECEIVE': 'R', 'P|RECEIVE': 'R', 'R|REJECT': 'B', 'B|RECEIVE': 'R', 'R|ARCHIVE': 'A', 'B|REDELIVER': 'P' };
    var target = transitions[normalize(value) + '|' + action];
    if (!target) throw new Error('目前狀態不允許執行此操作。');
    return target;
  }
  return { normalize: normalize, label: label, className: className, next: next };
});
