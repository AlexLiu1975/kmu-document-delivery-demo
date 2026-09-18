import { initializeApp } from
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  browserSessionPersistence,
  signInWithEmailAndPassword,
  updatePassword,
  initializeAuth,
  signInAnonymously,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  getFirestore,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const core = window.FirebaseStoreCore;
if (!core) throw new Error('Firebase 資料驗證模組載入失敗。');

const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, { persistence: browserSessionPersistence });
const database = getFirestore(app);
let employeeNumber = '';
let anonymousLogin = null;
let ipPromise = null;
const randomId = () => crypto.randomUUID();
function storedId(storage, key) {
  try { let value = storage.getItem(key); if (!value) { value = randomId(); storage.setItem(key, value); } return value; }
  catch { return randomId(); }
}
let visitorId;
let sessionId;
try { visitorId = storedId(localStorage, 'kmu-usage-visitor'); } catch { visitorId = randomId(); }
try { sessionId = storedId(sessionStorage, 'kmu-usage-session'); } catch { sessionId = randomId(); }
async function ensureAnonymous() {
  if (auth.authStateReady) await auth.authStateReady();
  if (auth.currentUser) return;
  if (!anonymousLogin) anonymousLogin = signInAnonymously(auth).finally(() => { anonymousLogin = null; });
  await anonymousLogin;
}
async function publicIp() {
  if (!ipPromise) ipPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch('https://api64.ipify.org?format=json', {signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
      if (!response.ok) return '';
      return window.UsageCore.normalizeIp((await response.json()).ip);
    } catch { return ''; } finally { clearTimeout(timer); }
  })();
  return ipPromise;
}
async function recordUsage(action, number = '', result = 'success', errorCode = '', identity = null) {
  // Capture identity before asynchronous IP lookup so logout or a new login cannot relabel the event.
  const actor = identity ? identity.actor : employeeNumber;
  try {
    await ensureAnonymous();
    const uid = identity ? identity.uid : auth.currentUser.uid;
    const ip = await publicIp();
    if (!auth.currentUser || auth.currentUser.uid !== uid) return;
    const record = window.UsageCore.buildRecord({employeeNumber:actor,documentNumber:number,ip,visitorId,sessionId,authUid:uid},action,result,errorCode,serverTimestamp());
    await addDoc(collection(database, 'usageRecords'), record);
    window.dispatchEvent(new CustomEvent('usage-record-status', {detail:'synced'}));
  } catch {
    window.dispatchEvent(new CustomEvent('usage-record-status', {detail:'failed'}));
  }
}

function timestampText(value) {
  if (!value || typeof value.toDate !== 'function') return '';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(value.toDate()).replace(/\//g, '-');
}

function normalizeSnapshotData(data) {
  const normalized = { ...data };
  ['createdAt', 'updatedAt', 'occurredAt', 'receivedAt', 'archivedAt', 'lastReturnDate'].forEach((field) => {
    if (normalized[field]) {
      normalized[field + 'Millis'] = normalized[field].toMillis();
      normalized[field] = timestampText(normalized[field]);
    }
  });
  if ('status' in normalized) normalized.status = window.DocumentStatus.normalize(normalized.status);
  return normalized;
}

async function staffSession() {
  if(auth.authStateReady) await auth.authStateReady();
  if(!auth.currentUser || auth.currentUser.isAnonymous) return null;
  const deadline=Number(sessionStorage.getItem('kmu-staff-deadline'));
  if(!deadline||Date.now()>=deadline){await signOut(auth);return null;}
  const user=auth.currentUser;
  const row=await getDoc(doc(database,'staffAdmins',user.uid));
  if(auth.currentUser?.uid!==user.uid)return null;
  if(!row.exists()||row.data().enabled!==true||!['1107054','1115034'].includes(row.data().employeeNumber)) throw Error('此帳號沒有事務組權限。');
  employeeNumber=row.data().employeeNumber;
  return {employeeNumber,uid:auth.currentUser.uid};
}
async function login(value,password) {
  const actor=core.validateEmployeeNumber(value);
  if(['1107054','1115034'].includes(actor)) {
    await ensureAnonymous();
    if(!password) throw Error('管理職號請輸入密碼。');
    try {
      sessionStorage.setItem('kmu-staff-deadline',String(Date.now()+600000));
      await signInWithEmailAndPassword(auth,actor+'@staff.kmu-document-delivery.invalid',password);
      const session=await staffSession();
      if(!session||session.employeeNumber!==actor) throw Error('管理職號不符。');
    } catch(error) { employeeNumber='';await signOut(auth);throw Error('管理職號或密碼錯誤，或帳號尚未啟用。'); }
  } else { await ensureAnonymous();if(!auth.currentUser.isAnonymous){await signOut(auth);await ensureAnonymous();}employeeNumber=actor; }
  void recordUsage('LOGIN');
  return { uid: auth.currentUser.uid, employeeNumber };
}

async function changePassword(password) {
  if(!await staffSession()) throw Error('請先登入管理職號。');
  if(String(password).length<8) throw Error('新密碼至少需要8個字元。');
  await updatePassword(auth,password);
}
async function logout() {
  sessionStorage.removeItem('kmu-staff-deadline');
  ipPromise = null;
  employeeNumber = '';
  if (auth.currentUser) await signOut(auth);
}

function requireSession(actor) {
  const validated = core.validateEmployeeNumber(actor);
  if (!auth.currentUser || validated !== employeeNumber) {
    throw new Error('Firebase 登入狀態已失效，請重新登入。');
  }
  return { actor: validated, uid: auth.currentUser.uid };
}

async function mutate(documentNumber, actor, operation, reason) {
  const session = requireSession(actor);
  const documentRef = doc(database, 'documents', documentNumber);
  const eventRef = doc(collection(documentRef, 'events'));
  try {
  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(documentRef);
    const current = snapshot.exists() ? snapshot.data() : null;
    const mutation = core.buildMutation(
      current,
      documentNumber,
      session.actor,
      operation,
      reason || '',
      session.uid,
      serverTimestamp()
    );
    transaction.set(documentRef, mutation.document);
    transaction.set(eventRef, mutation.event);
  });
  void recordUsage(operation, documentNumber, 'success', '', session);
  } catch (error) {
    void recordUsage(operation, documentNumber, 'failure', error.code || 'operation-failed', session);
    throw error;
  }
}

function subscribe(onData, onError) {
  let documents = [];
  let history = [];
  const publish = () => onData({ documents, history });
  const handleError = (error) => onError(error);
  const stopDocuments = onSnapshot(
    query(collection(database, 'documents'), orderBy('updatedAt', 'desc')),
    (snapshot) => {
      documents = snapshot.docs.map((item) => normalizeSnapshotData(item.data()));
      publish();
    },
    handleError
  );
  const stopEvents = onSnapshot(
    query(collectionGroup(database, 'events'), orderBy('occurredAt', 'asc')),
    (snapshot) => {
      history = snapshot.docs.map((item) => normalizeSnapshotData(item.data()));
      publish();
    },
    handleError
  );
  return () => {
    stopDocuments();
    stopEvents();
  };
}

window.firebaseDocumentStore = {
  recordUsage,
  staffSession,
  changePassword,
  login,
  logout,
  subscribe,
  receive: (number, actor) => mutate(number, actor, 'RECEIVE', ''),
  reject: (number, actor, reason) => mutate(number, actor, 'REJECT', reason),
  archive: (number, actor) => mutate(number, actor, 'ARCHIVE', '')
};
window.dispatchEvent(new CustomEvent('firebase-store-ready'));

void recordUsage('PAGE_VIEW');
