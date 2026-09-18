(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.UsageCore=api;})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 function normalizeIp(value){
  var text=String(value||'').trim();
  if(/^\d{1,3}(\.\d{1,3}){3}$/.test(text))return text.split('.').every(function(v){return Number(v)<=255;})?text:'';
  if(!/^[0-9a-fA-F:.]+$/.test(text)||text.indexOf(':')<0)return '';
  try{new URL('http://['+text+']/');return text;}catch(e){return '';}
 }
 function buildRecord(context,action,result,errorCode,time){
  return {employeeNumber:/^\d{7}$/.test(context.employeeNumber||'')?context.employeeNumber:'',documentNumber:/^\d{10}$/.test(context.documentNumber||'')?context.documentNumber:'',ip:normalizeIp(context.ip),ipStatus:normalizeIp(context.ip)?'available':'unavailable',visitorId:context.visitorId,sessionId:context.sessionId,authUid:context.authUid,action:action,result:result,errorCode:String(errorCode||'').slice(0,100),occurredAt:time};
 }
 function day(value){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
 function summarize(rows){
  var visitors=new Set(),sessions=new Set(),employees={},daily={},visitorSessions={};
  rows.forEach(function(r){
   if(r.visitorId){visitors.add(r.visitorId);if(!visitorSessions[r.visitorId])visitorSessions[r.visitorId]=new Set();if(r.sessionId)visitorSessions[r.visitorId].add(r.sessionId);}if(r.sessionId)sessions.add(r.sessionId);
   var d=day(r.occurredAt);if(!daily[d])daily[d]={date:d,views:0,logins:0,operations:0,failures:0};
   if(r.action==='PAGE_VIEW')daily[d].views++;if(r.action==='LOGIN'&&r.result==='success')daily[d].logins++;
   if(['RECEIVE','REJECT','ARCHIVE'].indexOf(r.action)>=0&&r.result==='success')daily[d].operations++;
   if(r.result==='failure')daily[d].failures++;
   if(!r.employeeNumber)return;
   var e=employees[r.employeeNumber]||(employees[r.employeeNumber]={employeeNumber:r.employeeNumber,days:new Set(),logins:0,queries:0,received:0,returned:0,archived:0,failures:0,lastUsed:''});
   e.days.add(d);if(r.action==='LOGIN'&&r.result==='success')e.logins++;if(r.action==='QUERY')e.queries++;
   if(r.result==='success'){if(r.action==='RECEIVE')e.received++;if(r.action==='REJECT')e.returned++;if(r.action==='ARCHIVE')e.archived++;}
   if(r.result==='failure')e.failures++;if(String(r.occurredAt)>e.lastUsed)e.lastUsed=String(r.occurredAt);
  });
  return {returningVisitors:Object.values(visitorSessions).filter(function(s){return s.size>1;}).length,visitors:visitors.size,sessions:sessions.size,records:rows.length,daily:Object.values(daily).sort(function(a,b){return a.date.localeCompare(b.date);}),employees:Object.values(employees).map(function(e){e.activeDays=e.days.size;delete e.days;return e;}).sort(function(a,b){return b.activeDays-a.activeDays||(b.queries+b.received+b.returned+b.archived)-(a.queries+a.received+a.returned+a.archived);})};
 }
 return {normalizeIp:normalizeIp,buildRecord:buildRecord,summarize:summarize};
});
