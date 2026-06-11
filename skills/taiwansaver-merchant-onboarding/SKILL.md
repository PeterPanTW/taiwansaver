---
name: taiwansaver-merchant-onboarding
description: >
  維運「店家填 taiwansaver.com/join/ 自製問卷 → Apps Script doPost 寫入 Google Sheet →
  自動產生中英雙語折扣頁、發佈到 GitHub Pages、同步 deals.json／sitemap、地址轉經緯度、
  寫回網址、累計修改次數計費、寄通知信、記錄 log」的全自動上架流程。
  當使用者要：修改 /join/ 表單、改 auto-publish.gs、下架店家（removeStore）、
  排查「沒上線/沒寄信/列表沒出現/地圖沒圖釘」、或把這套模式套到別的折扣/名錄型網站時，使用本 skill。
---

# TaiwanSaver — 店家上架全自動化 v2（自製表單 → 雙語頁 + 全站同步 + 計費 + 通知）

真程旅行社 TaiwanSaver（https://taiwansaver.com ，GitHub Pages 靜態站，repo `PeterPanTW/taiwansaver`）。
店家在自家網站 `taiwansaver.com/join/` 填問卷式表單（一屏一題、卡片點選、手機優先），
幾秒內中英雙語折扣頁自動上線，並同步出現在折扣列表、地圖、sitemap。

## 一句話架構
**/join/ 表單送出 → POST 到 Apps Script Web App `doPost` → 寫一列進「表單回覆 1」Sheet（＝資料庫）→
`publishStore_`：用 GitHub API commit `deals/<slug>/index.html`（即時上線）→ 地址 geocode → upsert `assets/deals.json` →
更新 `sitemap.xml` → 寫回網址 → 更新「修改次數」計費表 → 寄信給填表人+Peter → 寫一列到「log」。**

- 表單頁：repo `join/index.html`（純前端，POST URLSearchParams 到 ENDPOINT；含蜜罐欄位 `website` 防機器人）。
- 程式碼：repo `scripts/auto-publish.gs`（＝Sheet 綁定的 Apps Script 內容）。
- 回覆 Sheet：「TaiwanSaver 店家資料」ID `1Vyvhcb7uJ1L6WJ_cSnK-BrnIoLhbT_bOP-SCsAuNbi8`
  - 分頁：`表單回覆 1`（資料庫，含「已發佈網址」欄）、`修改次數`（計費表）、`log`（歷程）。
- 全站清單：`assets/deals.json` — travelers 列表、地圖頁用 JS 讀它，自動長出新店家卡片/圖釘（靜態 HTML 裡的舊店家保留給 SEO）。
- 舊 Google 表單仍綁 `onNewSubmission` 觸發器當備援，走同一條 `publishStore_` 管線。

## 一次性設定
1. **GitHub fine-grained PAT**：只授權 repo `PeterPanTW/taiwansaver`、Contents = Read and write。⚠️ 絕不寫進程式碼/commit。
2. Sheet → 擴充功能 → Apps Script，貼上 `scripts/auto-publish.gs` 全文、存檔。
3. 專案設定 → 指令碼屬性：`GITHUB_TOKEN = <PAT>`。
4. 函式選 `setupTrigger` → 執行 → 授權（ScriptApp / SpreadsheetApp / UrlFetchApp / MailApp / LanguageApp / Maps）→ 全部允許。
5. **部署 Web App**：部署 → 新增部署 → 網頁應用程式 → 執行身分=我、誰可以存取=**所有人** → 取得 `/exec` 網址，
   貼進 `join/index.html` 的 `var ENDPOINT`。
6. 完成。

> ⚠️ **改完 `doPost` 相關程式後**：重貼程式 + Ctrl+S 還不夠——Web App 部署釘住版本！
> 要到「部署 → 管理部署作業 → ✏️ → 版本：建立新版本 → 部署」，URL 不變、程式才會更新。
> （`onNewSubmission` 觸發器吃的是最新存檔，不用更新部署。）

## doPost / publishStore_ 行為
- 蜜罐欄位 `website` 有值 → 默默丟掉（回 ok 不上架）。
- 缺店名/折扣/地址 → 回 error。店名含「測試/TEST」→ SKIP 不上線。
- slug：英數直接取；**純中文店名先 LanguageApp 翻成英文再取**（台灣好餐廳 → taiwan-good-restaurant）。
- 產中英雙語頁（自動翻譯）→ commit；檔案已存在=UPDATE、否則=PUBLISH。
- **開門時間已從表單移除**；模板對 `d.hours` 為空時自動不顯示「營業時間」區塊。
- `geocode_`：地址→經緯度（Apps Script 內建 Maps geocoder，region=tw）；地址是網址（線上服務）→ 不定位，地圖只進清單不放圖釘。
- `updateDealsJson_` / `updateSitemap_`：失敗只記 WARN，不擋上架。
- 計費：新增免費、首次修改免費、第 2 次修改起每次 NT$300（`修改次數` 表自動算）。
- 通知信寄給填表人 Email + `OWNER_EMAIL`（example.com 自動跳過）。

## 維運
- 日常看「log」分頁：`PUBLISH`/`UPDATE`=成功、`SKIP`=略過、`WARN`=部分失敗、`ERROR`=出錯、`REMOVE`=下架。
- **下架店家**：Apps Script 裡把 `var cleanupSlug = '<slug>'` 填好 → 函式選 `runRemoveStore` → 執行。
  會自動刪 deal 頁、deals.json 條目、sitemap 條目、修改次數列。（`表單回覆 1` 的原始資料列保留當紀錄。）
- `backfillExisting()`：一次性把既有回覆列補產頁（測試列自動略過，不寄信）。
- 改 /join/ 表單題目：編輯 `join/index.html` 的 stepN 函式；新增欄位記得 `state`、`appendToSheet_` 的 `put()`、Sheet 表頭三處對齊。

## ⚠️ 踩雷筆記（省下重複除錯）
1. **Pages 建置延遲**：commit 後 ~1 分鐘才上線；通知信比頁面快，店家點連結可能先看到 404——等一分鐘就好。驗證改用 `git pull` 看檔案。
2. **Web App 版本釘住**：見上方警告。改 doPost 沒更新部署版本 = 改了等於沒改。
3. **Apps Script 編輯器貼大段程式**：手貼會壞字元。可靠做法 = 先 push `.gs` 到 repo，再於編輯器 Console 跑
   `fetch(rawGitHubUrl).then(r=>r.text()).then(c=>monaco.editor.getModels()[0].setValue(c))` 然後 Ctrl+S。
4. **編輯器函式下拉選單會「跳回去」**：選了別的函式按執行，實際可能還是跑原本選的。執行後務必到「執行項目」確認函式名。
   保險做法：暫時在 setupTrigger 裡加一行呼叫目標函式，跑完還原。
5. **關鍵字撞欄**：Sheet 表頭對應用關鍵字比對——`地址` 會誤中「電子郵件地址」，所以用「Address」。避免互相包含的關鍵字。
6. **雙重轉義**：放進 `data-*` 又經 `esc()` 的字串別放 HTML entity（`&middot;` 會變字面），用字面字元「·」。
7. **背景 PR workflow**：repo 有背景流程會自動 commit → 本機 push 前先 `git pull --rebase origin main`。
8. **lang.js 與動態內容**：JS 動態加的卡片要在渲染後呼叫 `TSLang.set(TSLang.get())` 重套語言。

## 驗證／測試流程
1. 到 `taiwansaver.com/join/` 填一筆**非測試名**（勿含「測試/TEST」）。
2. 等 ~15 秒 → `git pull` 確認：`deals/<slug>/` 新頁、`assets/deals.json` 新條目（lat/lng 有值）、`sitemap.xml` 新行。
3. Sheet：`表單回覆 1` 新列＋已發佈網址、`修改次數` 新列、`log` 出現 PUBLISH；收到通知信。
4. 等 Pages 建置後看 travelers 列表和地圖有沒有自動出現。
5. 清掉：`cleanupSlug='<slug>'` → `runRemoveStore`。

## 相關檔案
- 表單：`join/index.html`（ENDPOINT 在檔案頂部 JS）
- 程式：`scripts/auto-publish.gs`
- 全站清單：`assets/deals.json`；動態渲染在 `travelers/index.html`、`map/index.html` 底部 script
- 站台雙語：`assets/lang.js`、各頁 `data-en`/`data-zh`
