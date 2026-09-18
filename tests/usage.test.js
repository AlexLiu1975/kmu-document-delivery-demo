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
