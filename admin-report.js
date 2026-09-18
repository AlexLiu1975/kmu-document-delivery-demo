import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {initializeAuth,browserSessionPersistence,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {getFirestore,doc,getDoc,collection,query,where,orderBy,Timestamp,onSnapshot} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
const app=initializeApp(firebaseConfig);
const auth=initializeAuth(app,{persistence:browserSessionPersistence});
const db=getFirestore(app);
const el=id=>document.getElementById(id);
let stop=null,records=[],authorized=false,adminEmployee='',expiryTimer=null;
const columns=['occurredAt','employeeNumber','documentNumber','ip','ipStatus','action','result','errorCode','visitorId','sessionId','authUid'];
const titles=['時間','職號','文號','完整 IP','IP 狀態','功能','結果','錯誤類型','訪客代碼','工作階段','UID'];
function clearReport(){clearTimeout(expiryTimer);authorized=false;records=[];if(stop)stop();stop=null;el('report-content').hidden=true;el('metrics').textContent='';['employee-table','daily-table','record-table'].forEach(id=>el(id).replaceChildren());}
function message(text){el('message').textContent=text;}
function table(target,keys,labels,rows){const t=document.createElement('table'),head=document.createElement('thead'),hr=document.createElement('tr');labels.forEach(label=>{const c=document.createElement('th');c.textContent=label;hr.appendChild(c)});head.appendChild(hr);t.appendChild(head);const body=document.createElement('tbody');rows.forEach(row=>{const r=document.createElement('tr');keys.forEach(key=>{const c=document.createElement('td');c.textContent=row[key]??'';r.appendChild(c)});body.appendChild(r)});t.appendChild(body);el(target).replaceChildren(t);}
function visible(){const employee=el('report-employee').value.trim();return employee?records.filter(r=>r.employeeNumber===employee):records;}
function render(){if(!authorized)return;const rows=visible(),report=window.UsageCore.summarize(rows);el('metrics').textContent='瀏覽器訪客 '+report.visitors+'｜工作階段 '+report.sessions+'｜回訪瀏覽器 '+report.returningVisitors+'｜使用紀錄 '+report.records;table('employee-table',['employeeNumber','activeDays','logins','queries','received','returned','archived','failures','lastUsed'],['職號','使用天數','登入','查詢','收文','退文','歸檔','失敗','最近使用'],report.employees);table('daily-table',['date','views','logins','operations','failures'],['日期','頁面造訪','登入','成功公文操作','失敗'],report.daily);table('record-table',columns,titles,rows);}
function subscribe(){if(!authorized)return;if(stop)stop();records=[];render();message('讀取使用紀錄中…');const since=Timestamp.fromDate(new Date(Date.now()-Number(el('report-days').value)*86400000));stop=onSnapshot(query(collection(db,'usageRecords'),where('occurredAt','>=',since),orderBy('occurredAt','desc')),snapshot=>{if(!authorized)return;records=snapshot.docs.map(item=>{const data=item.data();return {...data,occurredAt:data.occurredAt.toDate().toISOString()}});render();message('管理者：'+adminEmployee+'｜已同步 '+new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}));},()=>{clearReport();message('無法讀取報表，請確認管理權限與網路連線。');});}
el('admin-login').onclick=()=>{location.href='index.html';};
el('admin-logout').onclick=async()=>{clearReport();sessionStorage.removeItem('kmu-staff-deadline');await signOut(auth);};
onAuthStateChanged(auth,async user=>{clearReport();el('admin-logout').hidden=!user;el('admin-login').hidden=!!user;if(!user){message('請先回公文登記簿，以管理職號及密碼登入。');return;}const deadline=Number(sessionStorage.getItem('kmu-staff-deadline'));if(!deadline||Date.now()>=deadline){await signOut(auth);return;}message('驗證管理權限中…');try{const admin=await getDoc(doc(db,'staffAdmins',user.uid));if(auth.currentUser?.uid!==user.uid)return;if(!admin.exists()||admin.data().enabled!==true||!['1107054','1115034'].includes(admin.data().employeeNumber))throw Error('denied');adminEmployee=admin.data().employeeNumber;authorized=true;armExpiry();el('report-content').hidden=false;subscribe();}catch{if(auth.currentUser?.uid===user.uid)message('目前登入沒有報表權限，請回公文登記簿使用管理職號及密碼登入。');}});
el('report-days').onchange=subscribe;el('report-refresh').onclick=subscribe;el('report-employee').oninput=render;
el('report-csv').onclick=()=>{if(!authorized)return;const quote=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';const text='\uFEFF'+[titles.map(quote).join(','),...visible().map(r=>columns.map(key=>quote(r[key])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='公文網站使用紀錄.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('pagehide',()=>{if(stop)stop();});
window.addEventListener('pageshow',event=>{if(event.persisted){clearReport();location.reload();}});

function armExpiry(){clearTimeout(expiryTimer);const deadline=Number(sessionStorage.getItem('kmu-staff-deadline'));expiryTimer=setTimeout(async()=>{clearReport();sessionStorage.removeItem('kmu-staff-deadline');await signOut(auth);message('閒置超過10分鐘，請回首頁重新登入。');},Math.max(0,deadline-Date.now()));}
['pointerdown','keydown'].forEach(type=>window.addEventListener(type,()=>{if(authorized){sessionStorage.setItem('kmu-staff-deadline',String(Date.now()+600000));armExpiry();}}));
