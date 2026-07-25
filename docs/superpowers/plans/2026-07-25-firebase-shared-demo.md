# Firebase 共用公文測試版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將公文測試資料由 localStorage 移至 Cloud Firestore，加入匿名登入、交易式狀態更新、即時同步及每文號一列的合併操作歷程。

**Architecture:** 保留 `app.js` 的純狀態轉換函式與現有介面，新增 `firebase-store.js` 作為唯一 Firestore 存取層。網頁透過 Firebase 12.16.0 CDN 模組初始化 Authentication 與 Firestore；所有寫入由 transaction 檢查目前狀態並同時新增事件。Firestore Rules 對匿名登入、欄位格式、合法狀態轉換與不可修改事件做伺服器端限制。

**Tech Stack:** HTML5、CSS、原生 JavaScript、Firebase JS SDK 12.16.0、Cloud Firestore、Firebase Anonymous Authentication、Firebase Emulator Suite、Node.js `node:test`

## Global Constraints

- Firebase project ID 固定為 `kmu-document-delivery`。
- 只載入 Firebase App、Authentication 與 Firestore；不載入 Analytics。
- 只能使用假文號、假職號與非敏感測試資料。
- 七碼職號與畫面角色不是真實身分驗證。
- Firestore 是唯一資料來源，不回退寫入 localStorage。
- 所有操作使用 Firestore server timestamp。
- 事件只新增，不修改、不刪除。
- 已歸檔案件不得再次操作。
- 桌面與手機均以每個文號一列顯示合併流程。

---

### Task 1: 建立 Firebase 專案設定與 Security Rules

**Files:**
- Create: `firebase.json`
- Create: `.firebaserc`
- Create: `firestore.rules`
- Create: `package.json`
- Create: `tests/firestore.rules.test.js`

**Interfaces:**
- Consumes: Firebase project `kmu-document-delivery`
- Produces: Firestore rules、Emulator 設定及 `npm test` / `npm run test:rules`

- [ ] **Step 1: Write the failing rules tests**

使用 `@firebase/rules-unit-testing@5.0.1` 建立測試，至少覆蓋：

```js
test('denies unauthenticated document reads and writes', async () => {});
test('allows an authenticated user to create a valid received document', async () => {});
test('denies malformed employee numbers and document numbers', async () => {});
test('allows received to rejected to received to archived transitions', async () => {});
test('denies updates to archived documents', async () => {});
test('allows event creation but denies event update and delete', async () => {});
test('denies document deletion', async () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm_config_cache=/tmp/kmu-document-npm-cache npm install
npm run test:rules
```

Expected: FAIL，因為 `firestore.rules` 與 Emulator 設定尚未存在。

- [ ] **Step 3: Add exact Firebase configuration**

`.firebaserc`：

```json
{
  "projects": {
    "default": "kmu-document-delivery"
  }
}
```

`firebase.json` 設定 Firestore Rules 與本機 Emulator：

```json
{
  "firestore": {
    "rules": "firestore.rules"
  },
  "emulators": {
    "firestore": {
      "port": 8080
    },
    "ui": {
      "enabled": false
    }
  }
}
```

`package.json` 固定：

```json
{
  "private": true,
  "scripts": {
    "test": "node --test tests/demo.test.js",
    "test:rules": "firebase emulators:exec --only firestore \"node --test tests/firestore.rules.test.js\"",
    "test:all": "npm test && npm run test:rules"
  },
  "devDependencies": {
    "@firebase/rules-unit-testing": "5.0.1",
    "firebase": "12.16.0",
    "firebase-tools": "15.24.0"
  }
}
```

- [ ] **Step 4: Implement minimum Firestore Rules**

Rules version 2，限制：

- `request.auth != null`
- document ID 與 `documentNumber` 都符合 `^\d{10}$`
- actor / assignee / latestRejectionActor 符合 `^\d{7}$` 或允許空字串的指定欄位
- status 只能為 `已收文`、`已退文`、`已歸檔`
- create 必須為 `已收文`
- update 只允許 `已收文 → 已退文`、`已退文 → 已收文`、`已收文 → 已歸檔`
- update 的 `revision` 必須等於舊值加一
- document 不可 delete
- event 只可 create，且 `authUid == request.auth.uid`
- event 的 `oldStatus`、`newStatus` 與 `action` 組合必須合法

- [ ] **Step 5: Run rules tests to verify they pass**

Run: `npm run test:rules`

Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add .firebaserc firebase.json firestore.rules package.json package-lock.json tests/firestore.rules.test.js
git commit -m "Add Firestore rules and emulator tests"
```

### Task 2: 建立 Firebase Authentication 與 Firestore 存取層

**Files:**
- Create: `firebase-config.js`
- Create: `firebase-store-core.js`
- Create: `firebase-store.js`
- Test: `tests/firebase-store.test.js`

**Interfaces:**
- Produces:
  - `login(employeeNumber): Promise<{ uid, employeeNumber }>`
  - `logout(): Promise<void>`
  - `subscribe(onSnapshot, onError): unsubscribe`
  - `receive(documentNumber, actor): Promise<void>`
  - `reject(documentNumber, actor, reason): Promise<void>`
  - `archive(documentNumber, actor): Promise<void>`

- [ ] **Step 1: Write failing adapter-contract tests**

測試 Firebase adapter 對輸入的驗證與事件映射：

```js
assert.throws(() => store.validateEmployeeNumber('123'));
assert.equal(store.validateEmployeeNumber('1115034'), '1115034');
assert.equal(
  store.actionForTransition('已退文', '已收文'),
  '承辦人重新收文'
);
```

另以假的 transaction gateway 測試 transaction 會：

- 讀取目前 document。
- 驗證合法轉換。
- 更新 `revision + 1`。
- 寫入一筆 event。
- 使用同一 transaction 完成兩次寫入。

- [ ] **Step 2: Run the adapter tests to verify they fail**

Run: `node --test tests/firebase-store.test.js`

Expected: FAIL，因為 adapter 尚不存在。

- [ ] **Step 3: Add Firebase Web configuration**

`firebase-config.js` 匯出提供的設定：

```js
export const firebaseConfig = {
  apiKey: "AIzaSyA0BygoYC_2wOiK2OmyCg36knCLtvoCZfI",
  authDomain: "kmu-document-delivery.firebaseapp.com",
  projectId: "kmu-document-delivery",
  storageBucket: "kmu-document-delivery.firebasestorage.app",
  messagingSenderId: "573811173709",
  appId: "1:573811173709:web:23892be4fa8177d8276f04"
};
```

不包含 `measurementId`，也不匯入 Analytics。

- [ ] **Step 4: Implement the Firestore adapter**

`firebase-store-core.js` 使用 UMD 格式提供 Node 測試與瀏覽器共用的驗證、狀態轉換及 transaction payload 建立函式。

`firebase-store.js` 從 Google CDN 匯入 12.16.0：

```js
import { initializeApp } from
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, signInAnonymously, signOut } from
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  collection, doc, getDocs, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
```

模組初始化後使用 `window.FirebaseStoreCore`，將 store 暴露為 `window.firebaseDocumentStore`，並派送 `firebase-store-ready` 事件。所有操作都先確認匿名登入存在；transaction 依目前狀態決定 action、old/new status 與 document 更新欄位。

- [ ] **Step 5: Run adapter and existing tests**

Run:

```bash
node --test tests/firebase-store.test.js
node --test tests/demo.test.js
```

Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add firebase-config.js firebase-store-core.js firebase-store.js tests/firebase-store.test.js
git commit -m "Add Firebase document store adapter"
```

### Task 3: 將單頁介面改用 Firebase 即時資料

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`
- Test: `tests/demo.test.js`

**Interfaces:**
- Consumes: `window.firebaseDocumentStore`
- Produces: Firebase 連線狀態、即時 documents/events 快照、非同步操作 UI

- [ ] **Step 1: Write failing page-integration tests**

斷言：

```js
assert.match(html, /type="module" src="firebase-store\.js"/);
assert.doesNotMatch(html, /資料僅儲存在目前瀏覽器 localStorage/);
assert.match(html, /Firebase 共用測試資料/);
assert.doesNotMatch(source, /localStorage\.setItem/);
assert.doesNotMatch(source, /localStorage\.getItem/);
assert.match(source, /firebaseDocumentStore/);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="uses Firebase as the only data source" tests/demo.test.js`

Expected: FAIL，因為頁面仍使用 localStorage。

- [ ] **Step 3: Add connection UI and Firebase module**

`index.html` 在 `app.js` 前載入：

```html
<script src="firebase-store-core.js"></script>
<script type="module" src="firebase-store.js"></script>
<script src="app.js"></script>
```

頁首加入 `#connection-status`，顯示：

- 連線中
- 已同步
- 離線／尚未同步
- Firebase 設定未完成

- [ ] **Step 4: Replace local state persistence**

`app.js`：

- 移除 `loadState()`、`saveState()` 與 localStorage reset。
- 等待 `firebase-store-ready` 後訂閱 documents/events。
- 每次 snapshot 建立 `{ documents, history }` 畫面狀態並呼叫 `renderAll()`。
- 登入改為 await `store.login(currentAssignee)`。
- 登出與逾時改為 await `store.logout()`。
- 收文、退文與歸檔改為 await 對應 store 方法。
- 寫入中停用相關按鈕。
- Firebase 錯誤顯示中文 toast，不在本機建立替代資料。
- 移除「重設測試資料」按鈕；匿名測試者沒有刪除 documents/events 的權限。

- [ ] **Step 5: Run all non-emulator tests**

Run:

```bash
npm test
node --test tests/firebase-store.test.js
```

Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add index.html app.js styles.css tests/demo.test.js
git commit -m "Use Firebase as the shared document data source"
```

### Task 4: 每個文號合併成一列操作歷程

**Files:**
- Modify: `app.js`
- Modify: `styles.css`
- Test: `tests/demo.test.js`

**Interfaces:**
- Produces: `groupHistoryByDocument(events)`，每筆含 `documentNumber`、`firstAt`、`lastAt`、`flow`、`reasons`、`actors`、`events`

- [ ] **Step 1: Write the failing grouping test**

輸入同一文號的四個事件，斷言：

```js
assert.deepEqual(grouped[0].flow, [
  '已收文', '已退文', '重新收文', '已歸檔'
]);
assert.deepEqual(grouped[0].reasons, ['缺少發文日期']);
assert.deepEqual(grouped[0].actors, [
  '1115034', '7654321', '1115034', '7654321'
]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="groups document events into one history row" tests/demo.test.js`

Expected: FAIL，因為 grouping function 尚不存在。

- [ ] **Step 3: Implement grouping and expandable details**

`renderHistory()` 每個文號建立一列：

- 日期時間：`firstAt` 至 `lastAt`
- 公文文號
- 動作：以箭頭串接 `flow`
- 退文原因：以頓號串接
- 操作帳號：依順序以箭頭串接

每列提供「查看明細」按鈕，展開後顯示每個事件完整五欄。手機版保持直式卡片。

- [ ] **Step 4: Run UI tests**

Run: `npm test`

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add app.js styles.css tests/demo.test.js
git commit -m "Group document history into one workflow row"
```

### Task 5: 完整驗證、部署規則與發布網站

**Files:**
- Verify: `firestore.rules`
- Verify: `firebase-store.js`
- Verify: `app.js`
- Verify: `index.html`
- Verify: `styles.css`

**Interfaces:**
- Consumes: Firebase Console 已啟用 Anonymous Authentication 與 Firestore `(default)`
- Produces: 已部署 Rules 與 GitHub Pages Firebase 共用測試版

- [ ] **Step 1: Run complete local verification**

Run:

```bash
npm run test:all
node --test tests/firebase-store.test.js
git diff --check
git status -sb
```

Expected: 全部測試 PASS，無非預期變更。

- [ ] **Step 2: Confirm Firebase CLI target without changing remote state**

Run:

```bash
npx firebase-tools use
npx firebase-tools projects:list
```

Expected: current project 是 `kmu-document-delivery`。若 CLI 尚未登入，停止並請使用者完成 Firebase CLI 登入。

- [ ] **Step 3: Deploy Firestore Rules**

這是外部安全規則變更，執行前再次確認目標專案 ID。確認後執行：

```bash
npx firebase-tools deploy --only firestore:rules --project kmu-document-delivery
```

Expected: Rules deployment successful。

- [ ] **Step 4: Push GitHub Pages**

Run:

```bash
git push origin main
```

Expected: GitHub Pages 更新完成。

- [ ] **Step 5: Verify two-session behavior**

以兩個獨立瀏覽器工作階段：

1. 使用不同七碼測試職號匿名登入。
2. A 收文，B 無重新整理看到紅色狀態。
3. B 退文，A 看到退文狀態與原因。
4. A 重新收文，B 歸檔。
5. 兩邊操作歷程皆為一列：
   `已收文 → 已退文 → 重新收文 → 已歸檔`
6. 展開明細確認每次時間、原因及操作帳號。

- [ ] **Step 6: Verify failure behavior**

- 未啟用 Anonymous Authentication 時顯示設定錯誤。
- Firestore Rules 拒絕時顯示權限錯誤。
- 離線時顯示「離線／尚未同步」，且不寫入 localStorage。
- 同文號並行操作只有一方成功，另一方收到最新狀態提示。

- [ ] **Step 7: Report evidence**

回報：

- 純函式與規則測試通過數。
- Firestore Rules 部署目標與結果。
- Git commit SHA 與 GitHub Pages URL。
- 兩工作階段同步驗證結果。
- 測試版的身分冒用與禁止真實資料限制。
