# 公文送達／查詢系統公開測試版

這是 Google Apps Script 正式版的純前端流程展示，可直接透過 GitHub Pages 使用。

- 不需要高醫帳號。
- 不連接 Google 試算表或 Apps Script。
- 資料只儲存在目前瀏覽器的 `localStorage`。
- 可切換「一般測試人員」與「事務組測試人員」。
- 可測試送達、查詢、退文、重新送達、收件、歸檔及歷程。

## 安全提醒

這是公開網站。請勿輸入真實公文文號、email、個人資料或機密內容。

## 本機測試

```bash
node --test tests/demo.test.js
```

## 與正式版的差異

正式版由 Google Apps Script 執行權限檢查並以 Google 試算表保存資料；此公開版只模擬流程，重新整理後資料仍留在同一瀏覽器，但不同裝置與不同瀏覽器不會共享。
