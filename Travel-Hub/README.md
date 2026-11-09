# Travel Hub V1.0

手機優先的家庭旅行手帳。每個家庭第一次登入會建立 Seoul 2027，日期為 2027/01/21–01/25，使用 Asia/Seoul 與 KRW。兩人各自登入後，可共同編輯同一家庭的旅行。住宿、交通及私人清單由使用者登入後填寫。

## 第一次設定

1. 建立專用的 Supabase 專案。在 **SQL Editor** 執行本目錄的 [schema.sql](./schema.sql) 一次。此腳本會建立六張旅遊資料表、圖片清理佇列、私有圖片 bucket、帳號隔離政策及 Realtime publication 訂閱。
2. 執行 [households.sql](./households.sql) 一次以啟用家庭權限。在 Authentication → Users 建立兩個個人帳號。管理者於 SQL Editor 執行以下 SQL，將兩個範例 UUID 替換為確認屬於家庭成員的 Auth User ID。

   ```sql
   with family as (insert into public.hub_households default values returning id)
   insert into public.hub_members(user_id, household_id)
   select member, family.id from family cross join
     unnest(array['第一位使用者 UUID','第二位使用者 UUID']::uuid[]) as member;
   ```

3. 此版本預設連接 ZT 的 Travel Hub 專案，開啟後選「登入」，各自使用自己的電子郵件與密碼。家庭成員不能從前端自行加入或邀請。若部署到另一專案，可在登入畫面選「更換專案」輸入其 URL 與 publishable key。
4. Android Chrome 開啟此網站後，從瀏覽器選單安裝或加入主畫面。初次登入、下載資料及安裝快取時需連網。若沿用此 repo 的 GitHub Pages 根目錄發布，合併並完成 Pages 部署後，新版路徑為 `/Travel/Travel-Hub/`。

專案與公開金鑰存在各裝置的網站儲存空間，無需編輯原始碼。Supabase 的資料 API 需啟用並包含 public schema。六張主表均採 UUID、owner_id、版本、建立及更新時間，子資料以複合外鍵驗證旅行與家庭。圖片路徑以家庭 UUID 開頭，Supabase Storage 以登入者身分驗證下載。刪除以版本化刪除標記通知離線裝置。商品移除或更換照片後，圖片清理工作會在同步時執行。

## 旅行途中

- **首頁與旅行**　首頁依目的地日期顯示倒數、當日行程或回顧。從上方選單切換旅行，在「旅行」編輯住宿、交通、時區與日期，或封存舊旅行。整趟刪除有兩次確認。
- **行程與收藏**　每天一張時間／行程／交通／備註表。「移動」只調整單一項目的日期及時間，可立即復原。「編輯行程」開啟新增、編輯與刪除。收藏可依分類、地區篩選，加入行程後仍保留原收藏。
- **購物與行李**　購物可拍照或從相簿選一張照片，點擊縮圖可放大。勾選只更新購買狀態。「複製前趟項目」取出發日期最近且較早的旅行，複製行李並重設打包狀態。
- **記帳與匯率**　先於「匯率」取得市場參考值或手動設定，亦可直接在記帳表單填入匯率。每筆保存當時的換算值。記帳人會成為該裝置下次的預設值。「記帳」同時顯示全程總額與篩選小計。
- **離線與衝突**　已下載的資料及開啟過的圖片可離線查看。修改先寫入 IndexedDB，相片上傳與資料列寫入各自確認。恢復連線會自動重試，亦可點「重新同步」。若兩台裝置修改同一筆，點「處理衝突」比較兩版，再選要保留的版本。清除瀏覽器網站資料會清除這台裝置尚未同步的資料。

## 從釜山版搬移

請先在**原使用裝置**開啟 Busan 2026 並匯出記帳 JSON。從新版切到目標旅行後，在「記帳 → 匯入 JSON」選檔。釜山版的目的地幣別為 KRW，舊檔只有整份匯出的匯率。匯入時會以該值換算；若檔案缺少匯率，可在表單填入備用值。新版匯出保留逐筆匯率。重複匯入同一份有效備份會略過已有的帳目。

「行程 → 編輯行程 → 匯入釜山 HTML」可在登入後選擇舊版 index.html。轉換器依每日表格的 Day 編號、時間與四欄內容對應至目標旅行日期。請核對轉換後的地點與導航。GitHub 上的原始碼不包含舊裝置的 localStorage，此 PR 沒有搬移任何私人旅行紀錄。

## 本機預覽與測試

在 repo 根目錄執行以下指令，開啟 `http://localhost:8000/Travel-Hub/`。靜態頁面可直接使用已打包的 Supabase SDK。

```sh
python -m http.server 8000 --bind 127.0.0.1
```

使用 Node.js 24 及 npm 在 Travel-Hub 目錄執行：

```sh
npm ci
npx playwright install chromium
npm run build
npm test
```

瀏覽器測試優先使用 Windows 已安裝的 Chrome，其他環境使用 Playwright Chromium。測試以兩個獨立的手機尺寸瀏覽器 profile 驅動實際 UI、SDK、Service Worker 與 IndexedDB，後端使用本機 HTTP／WebSocket 測試服務。資料庫測試以 PGlite 執行完整建表 SQL，提供最小 Auth 與 Storage 測試表。

正式驗收需在專用 Supabase 與兩支實機進行。可依序在第一支手機移動 1/22 的單一行程到 1/23、新增一筆帳、拍一張商品圖片並勾選，在第二支手機核對移動、筆數、總額與照片。接著離線新增、關閉重開、恢復網路，確認兩支手機都只看到一筆，再以另一趟旅行檢查資料隔離。
