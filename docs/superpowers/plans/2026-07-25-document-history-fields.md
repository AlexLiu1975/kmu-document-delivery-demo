# 公文狀態、操作歷程與全站登出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 顯示收文與退文操作職號、提供五欄操作歷程，並讓使用者可從網站右上角隨時登出。

**Architecture:** 沿用單頁靜態網站與 localStorage 狀態模型，在既有 document/history 資料增加最近退文人員，並以純 JavaScript 產生語意化歷程表格。共用頁首承接登入狀態元件，既有一分鐘工作階段計時與權限檢查維持不變。

**Tech Stack:** HTML5、CSS、原生 JavaScript、Node.js `node:test`、GitHub Pages

## Global Constraints

- 操作歷程固定為：日期時間、公文文號、動作、退文原因、操作帳號。
- 非退文操作的退文原因顯示「—」。
- 所有操作帳號使用當下登入的七碼職號。
- 既有資料缺少新欄位時顯示「—」，不得發生錯誤。
- 登入後，右上角在所有功能頁顯示職號、倒數及登出按鈕。
- 手機版不得裁切登入資訊或歷程欄位。
- 不增加外部相依套件。

---

### Task 1: 保存收文與退文職號

**Files:**
- Modify: `app.js`
- Test: `tests/demo.test.js`

**Interfaces:**
- Consumes: `manage(inputState, documentId, action, category, detail, actor)`
- Produces: document 的 `assignee` 與 `latestRejectionActor`，history 的 `actor` 與 `reason`

- [ ] **Step 1: Write the failing test**

在退文測試中使用七碼事務組職號 `7654321`，斷言：

```js
assert.equal(state.documents[0].latestRejectionActor, '7654321');
assert.equal(state.history[1].actor, '7654321');
assert.equal(state.history[1].reason, '缺少發文日期');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="records the rejecting employee number" tests/demo.test.js`

Expected: FAIL，因為 `latestRejectionActor` 尚未寫入。

- [ ] **Step 3: Write minimal implementation**

在 `manage()` 的 `REJECT` 分支寫入：

```js
if (reason) {
  document.latestRejectionReason = reason;
  document.latestRejectionActor = normalizeAssignee(actor);
}
```

把 UI 的 `runManage()` 與退文表單傳入的固定字串改成 `currentAssignee`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/demo.test.js`

Expected: 所有測試 PASS。

- [ ] **Step 5: Commit**

```bash
git add app.js tests/demo.test.js
git commit -m "Record employee numbers in document history"
```

### Task 2: 顯示目前狀態與五欄操作歷程

**Files:**
- Modify: `app.js`
- Modify: `index.html`
- Modify: `styles.css`
- Test: `tests/demo.test.js`

**Interfaces:**
- Consumes: document 的 `assignee`、`latestRejectionReason`、`latestRejectionActor`
- Produces: `recordCard(record)` 狀態摘要與 `renderHistory()` 五欄表格

- [ ] **Step 1: Write the failing test**

讀取 `index.html` 與 `app.js`，斷言五個欄名及新狀態標籤存在：

```js
assert.match(source, /日期時間/);
assert.match(source, /公文文號/);
assert.match(source, /動作/);
assert.match(source, /退文原因/);
assert.match(source, /操作帳號/);
assert.match(source, /最近退文人員職號/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="shows the five history fields" tests/demo.test.js`

Expected: FAIL，因為五欄表格尚未建立。

- [ ] **Step 3: Write minimal implementation**

`recordCard()` 將「職號」改為「收文職號」，新增：

```js
['最近退文人員職號', record.latestRejectionActor || '—']
```

`renderHistory()` 建立帶有 `thead`、`tbody` 的表格，每列輸出 `occurredAt`、`documentNumber`、`action`、`reason || '—'`、`actor || '—'`。每格加上 `data-label` 供手機版顯示欄名。

CSS 在桌面顯示表格，在窄螢幕隱藏表頭並將每列轉為直式卡片。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/demo.test.js`

Expected: 所有測試 PASS。

- [ ] **Step 5: Commit**

```bash
git add app.js index.html styles.css tests/demo.test.js
git commit -m "Show detailed document operation history"
```

### Task 3: 將登入狀態與登出移到右上角

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `app.js`
- Test: `tests/demo.test.js`

**Interfaces:**
- Consumes: `currentAssignee`、`sessionDeadline`、`logoutAssignee()`
- Produces: 頁首 `#assignee-session`，包含 `#current-assignee`、`#session-countdown`、`#assignee-logout`

- [ ] **Step 1: Write the failing test**

解析頁面文字位置，斷言 `assignee-session` 位於 `<header>` 內，並且不位於 `panel-deliver` 內。

```js
const header = html.match(/<header>[\s\S]*?<\/header>/)[0];
const deliverPanel = html.match(/id="panel-deliver"[\s\S]*?id="panel-query"/)[0];
assert.match(header, /id="assignee-session"/);
assert.doesNotMatch(deliverPanel, /id="assignee-session"/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="places logout in the global header" tests/demo.test.js`

Expected: FAIL，因為登入狀態仍在收文面板。

- [ ] **Step 3: Write minimal implementation**

將既有 `#assignee-session` 整段移至 `.role-box`，保留原 id 與事件綁定。調整 CSS：

```css
.header-session { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
```

窄螢幕允許換行並維持按鈕最小點選尺寸；`renderAssigneeSession()` 繼續控制頁首狀態與收文登入區的顯示。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/demo.test.js`

Expected: 所有測試 PASS。

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css app.js tests/demo.test.js
git commit -m "Move logout controls to the global header"
```

### Task 4: 完整驗證與部署

**Files:**
- Verify: `app.js`
- Verify: `index.html`
- Verify: `styles.css`
- Verify: `tests/demo.test.js`

**Interfaces:**
- Consumes: Tasks 1–3 的所有變更
- Produces: 可由 GitHub Pages 直接載入的公開測試版

- [ ] **Step 1: Run the complete automated verification**

Run:

```bash
node --test tests/demo.test.js
git diff --check
git status -sb
```

Expected: 所有測試 PASS、無空白錯誤，且只包含本計畫的預期變更。

- [ ] **Step 2: Push the completed commits**

Run:

```bash
git push origin main
```

Expected: `main` 成功推送。

- [ ] **Step 3: Verify the public site**

檢查公開 `index.html` 與 `app.js`，確認頁首登出元件、`latestRejectionActor`、五欄歷程表及 `currentAssignee` 已上線。

- [ ] **Step 4: Report evidence**

回報測試通過數、公開網址、提交版本及 GitHub Pages 實際載入結果；若部署尚未完成，明確標示仍在等待。
