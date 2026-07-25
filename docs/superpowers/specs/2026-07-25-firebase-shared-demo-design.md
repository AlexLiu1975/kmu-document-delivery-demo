# Firebase 共用公文測試版設計

## 目標與使用邊界

將目前只存在單一瀏覽器 localStorage 的測試資料改存至 Firebase Cloud Firestore，讓不同電腦與瀏覽器能即時查看相同的公文狀態與操作歷程。

本版本只供流程測試：

- 只能使用假文號、假職號及非敏感資料。
- 七碼職號是操作標示，不是真實身分驗證。
- 一般人員與事務組的角色切換仍是測試介面，不構成正式權限。
- 流程確認後，畫面與狀態機可保留，但身分驗證與資料存取層必須改接校內系統。

## Firebase 專案

- Project ID：`kmu-document-delivery`
- Project number：`573811173709`
- Web App ID：`1:573811173709:web:23892be4fa8177d8276f04`
- Auth domain：`kmu-document-delivery.firebaseapp.com`

網頁使用 Firebase Web SDK 的 Authentication 與 Firestore 模組。測試版不啟用 Analytics，也不載入 Analytics SDK。

## 使用者工作階段

使用者輸入七碼職號並按下登入時：

1. 驗證職號格式。
2. 透過 Firebase Authentication 建立匿名登入工作階段。
3. 成功後才啟用收文及事務組測試操作。
4. 右上角顯示職號、一分鐘倒數與登出按鈕。
5. 手動登出或閒置一分鐘時，同時清除畫面職號並執行 Firebase `signOut()`。

匿名 Firebase UID 僅用於規則要求與稽核輔助，不取代操作畫面上的七碼測試職號。

## Firestore 資料結構

### `documents/{documentNumber}`

文件 ID 使用完整十碼公文文號，欄位如下：

- `documentNumber`: string
- `year`: string
- `typeCode`: string
- `serial`: string
- `status`: `已收文`、`已退文` 或 `已歸檔`
- `assignee`: string，最近收文職號
- `latestRejectionReason`: string
- `latestRejectionActor`: string
- `createdAt`: Firestore timestamp
- `updatedAt`: Firestore timestamp
- `revision`: number，用於狀態更新競爭檢查

### `documents/{documentNumber}/events/{eventId}`

- `documentNumber`: string
- `action`: `承辦人收文`、`退文`、`承辦人重新收文` 或 `歸檔`
- `oldStatus`: string
- `newStatus`: string
- `reason`: string
- `actor`: string，七碼測試職號
- `authUid`: string，當次匿名 Firebase UID
- `occurredAt`: Firestore timestamp

每次操作以 Firestore transaction 同時更新公文目前狀態並新增不可覆寫的事件，避免兩位測試者同時操作時產生不一致狀態。

## 狀態規則

- 未建立 → 已收文
- 已收文 → 已退文
- 已退文 → 重新收文（目前狀態回到已收文）
- 已收文 → 已歸檔
- 已歸檔不得再次操作

重複點選、過期畫面或不合法轉換必須顯示錯誤，並重新讀取 Firestore 最新狀態。

## 共用即時畫面

公文矩陣與操作歷程使用 Firestore 即時監聽。其他測試者完成收文、退文、重新收文或歸檔後，目前頁面無須重新整理即可更新顏色與資料。

操作歷程每個公文文號只顯示一列，動作欄依時間顯示完整流程，例如：

`已收文 → 已退文 → 重新收文 → 已歸檔`

同一列保留：

- 第一次與最後一次操作時間
- 所有退文原因
- 依操作順序排列的操作職號

桌面版使用表格；手機版轉為直式卡片。使用者可展開單一公文查看各事件的完整日期時間、動作、原因與操作職號。

## Firestore Security Rules

測試規則採最小開放：

- 未經 Firebase Authentication 匿名登入者不得讀寫。
- 公文文號、職號、狀態、動作與欄位型別必須符合格式。
- 事件只允許新增，不允許修改或刪除。
- 公文只允許建立或依合法狀態轉換更新，不允許刪除。
- Rules 不把七碼職號或畫面角色視為可信權限。

匿名登入仍無法阻止測試者冒用其他職號，因此不得存放真實資料。

## 連線與錯誤處理

- Firebase 初始化或匿名登入失敗時，停用寫入功能並顯示明確錯誤。
- Firestore 無法連線時，不回退寫入 localStorage，避免形成兩套互相矛盾的資料。
- 可顯示目前已載入的最後 Firestore 快照，但必須標示「離線／尚未同步」。
- 初次上線不自動匯入既有 localStorage 測試資料；Firebase 從空白測試資料開始。

## Firebase Console 前置設定

開始線上驗證前，專案管理者需要：

1. 在 Authentication 的 Sign-in method 啟用 Anonymous。
2. 建立 Cloud Firestore `(default)` database。
3. 先以 Production mode 建立，保持預設拒絕所有存取。
4. 由本專案提供並部署經 Emulator 測試通過的 Firestore Rules。
5. 將 `alexliu1975.github.io` 加入 Authentication 的 Authorized domains（若 Firebase 流程要求）。

## 驗證

- 純函式測試所有合法與非法狀態轉換。
- Firebase Emulator 測試未登入拒絕、合法匿名讀寫、事件不可改刪、文件不可刪除及非法狀態轉換拒絕。
- 兩個瀏覽器工作階段測試即時同步。
- 測試退文後重新收文及歸檔的完整事件鏈。
- 測試同文號並行操作只允許其中一次成功。
- 測試登出與一分鐘逾時會終止 Firebase Authentication 工作階段。
- 測試桌面及手機的合併歷程列與展開明細。
