const test=require('node:test');
const assert=require('node:assert/strict');
const usage=require('../usage-core');
test('full IP accepts IPv4 and IPv6 without accepting malformed input',()=>{
 assert.equal(usage.normalizeIp('203.0.113.7'),'203.0.113.7');
 assert.equal(usage.normalizeIp('2001:db8::1'),'2001:db8::1');
 assert.equal(usage.normalizeIp('999.0.0.1'),'');
 assert.equal(usage.normalizeIp('example.com'),'');
});
test('record retains employee number, document number, IP and identity',()=>{
 const record=usage.buildRecord({employeeNumber:'1115034',documentNumber:'1151103143',ip:'203.0.113.7',visitorId:'visitor-a',sessionId:'session-a',authUid:'uid-a'},'RECEIVE','success','', 'TIME');
 assert.equal(record.employeeNumber,'1115034');assert.equal(record.documentNumber,'1151103143');assert.equal(record.ip,'203.0.113.7');assert.equal(record.occurredAt,'TIME');
});
test('report groups repeat anonymous identities by employee and computes meaningful counts',()=>{
 const rows=[
 {action:'LOGIN',employeeNumber:'1115034',authUid:'u1',visitorId:'v1',sessionId:'s1',result:'success',occurredAt:'2026-09-17T02:00:00Z'},
 {action:'RECEIVE',employeeNumber:'1115034',documentNumber:'1151103143',visitorId:'v1',sessionId:'s1',result:'success',occurredAt:'2026-09-17T02:01:00Z'},
 {action:'LOGIN',employeeNumber:'1115034',authUid:'u2',visitorId:'v1',sessionId:'s2',result:'success',occurredAt:'2026-09-18T02:00:00Z'},
 {action:'QUERY',employeeNumber:'1115034',visitorId:'v1',sessionId:'s2',result:'not_found',occurredAt:'2026-09-18T02:01:00Z'},
 {action:'RECEIVE',employeeNumber:'1115034',visitorId:'v1',sessionId:'s2',result:'failure',occurredAt:'2026-09-18T02:02:00Z'}];
 const report=usage.summarize(rows);
 assert.equal(report.employees.length,1);assert.equal(report.employees[0].activeDays,2);assert.equal(report.employees[0].logins,2);assert.equal(report.employees[0].received,1);assert.equal(report.employees[0].queries,1);assert.equal(report.employees[0].failures,1);assert.equal(report.visitors,1);assert.equal(report.sessions,2);assert.equal(report.returningVisitors,1);
});
test('daily usage lists the most recent date first',()=>{
 const report=usage.summarize([
  {action:'PAGE_VIEW',result:'success',occurredAt:'2026-09-18T02:00:00Z'},
  {action:'PAGE_VIEW',result:'success',occurredAt:'2026-09-23T02:00:00Z'},
  {action:'PAGE_VIEW',result:'success',occurredAt:'2026-09-21T02:00:00Z'}
 ]);
 assert.deepEqual(report.daily.map(row=>row.date),['2026-09-23','2026-09-21','2026-09-18']);
});
test('daily receipt totals split draft and received documents without duplicate document numbers',()=>{
 const report=usage.summarize([
  {action:'RECEIVE',documentNumber:'1151100001',result:'success',occurredAt:'2026-09-22T02:00:00Z'},
  {action:'RECEIVE',documentNumber:'1150000002',result:'success',occurredAt:'2026-09-23T02:00:00Z'},
  {action:'RECEIVE',documentNumber:'1151100001',result:'success',occurredAt:'2026-09-24T02:00:00Z'},
  {action:'RECEIVE',documentNumber:'1150000003',result:'failure',occurredAt:'2026-09-24T03:00:00Z'},
  {action:'ARCHIVE',documentNumber:'1151100004',result:'success',occurredAt:'2026-09-24T04:00:00Z'}
 ]);
 assert.deepEqual(report.dailyReceipts,[
  {date:'2026-09-23',draft:0,received:1,total:1},
  {date:'2026-09-22',draft:1,received:0,total:1}
 ]);
});
test('online and generated reports render the daily receipt breakdown',()=>{
 const fs=require('node:fs');
 const path=require('node:path');
 const root=path.join(__dirname,'..');
 const html=fs.readFileSync(path.join(root,'usage-report.html'),'utf8');
 const browser=fs.readFileSync(path.join(root,'admin-report.js'),'utf8');
 const generated=fs.readFileSync(path.join(root,'scripts/usage-report.cjs'),'utf8');
 assert.match(html,/每日收文數量/);
 assert.match(html,/id="receipt-table"/);
 assert.match(browser,/\['date','draft','received','total'\]/);
 assert.match(browser,/\['日期','創稿','收文','合計'\]/);
 assert.match(generated,/report\.dailyReceipts/);
});
