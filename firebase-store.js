import { initializeApp } from
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  inMemoryPersistence,
  initializeAuth,
  signInAnonymously,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  collection,
  collectionGroup,
  doc,
  getFirestore,
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
const auth = initializeAuth(app, { persistence: inMemoryPersistence });
const database = getFirestore(app);
let employeeNumber = '';

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
  ['createdAt', 'updatedAt', 'occurredAt'].forEach((field) => {
    if (normalized[field]) {
      normalized[field + 'Millis'] = normalized[field].toMillis();
      normalized[field] = timestampText(normalized[field]);
    }
  });
  return normalized;
}

async function login(value) {
  employeeNumber = core.validateEmployeeNumber(value);
  if (!auth.currentUser) await signInAnonymously(auth);
  return { uid: auth.currentUser.uid, employeeNumber };
}

async function logout() {
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
  login,
  logout,
  subscribe,
  receive: (number, actor) => mutate(number, actor, 'RECEIVE', ''),
  reject: (number, actor, reason) => mutate(number, actor, 'REJECT', reason),
  archive: (number, actor) => mutate(number, actor, 'ARCHIVE', '')
};
window.dispatchEvent(new CustomEvent('firebase-store-ready'));
