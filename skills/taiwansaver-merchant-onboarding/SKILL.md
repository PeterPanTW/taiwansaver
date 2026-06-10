---
name: taiwansaver-merchant-onboarding
description: >
  建立並維運「店家填 Google 表單 → 自動產生中英雙語折扣頁、發佈到 GitHub Pages、
  寫回網址、累計修改次數計費、寄通知信給填表人+老闆、記錄到 log」的全自動上架流程。
  當使用者要：設定/修改 TaiwanSaver 店家上架自動化、改 auto-publish.gs、加表單欄位、
  排查「自動沒上線/沒寄信/欄位錯」、或要把這套「表單→Apps Script→GitHub Pages 自動發佈」
  模式套到別的折扣/名錄型網站時，使用本 skill。
---

# TaiwanSaver — 店家上架全自動化（Form → 雙語 GitHub Pages + 計費 + 通知）

真程旅行社 TaiwanSaver（https://taiwansaver.com ，GitHub Pages 靜態站，repo `PeterPanTW/taiwansaver`）的
店家上架自動化。店家填一次 Google 表單，幾秒內就自動產生一頁中英雙語折扣頁上線，並完成計費、通知、記錄。

## 一句話架構
**表單送出 → Sheet 綁定 Apps Script `onFormSubmit` 觸發 → 用 GitHub API commit `deals/<slug>/index.html`
（即時上線）→ 寫回網址到表單回覆列 → 更新「修改次數」表 → 寄信給填表人+Peter → 寫一列到「log」。**

- 程式碼：本 repo `scripts/auto-publish.gs`（即 Sheet 綁定的 Apps Script 內容）。
- 回覆 Sheet：「TaiwanSaver 店家資料」ID `1Vyvhcb7uJ1L6WJ_cSnK-BrnIoLhbT_bOP-SCsAuNbi8`
  - 分頁：`表單回覆 1`（真實回覆，含「已發佈網址」欄）、`修改次數`（計費累積表）、`log`（修改歷程）。
- 站台組件：雙語 `assets/lang.js`（讀 `data-en`/`data-zh`；含 `<` 的值用 innerHTML 渲染）、GA4 `G-LFG20DT8BH`。

## 一次性設定
1. **GitHub fine-grained PAT**：只授權 repo `PeterPanTW/taiwansaver`、權限 Contents = Read and write。⚠️ 絕不寫進程式碼/commit。
2. Sheet → 擴充功能 → Apps Script，貼上 `scripts/auto-publish.gs` 全文、存檔。
3. 專案設定 → 指令碼屬性：`GITHUB_TOKEN = <PAT>`。
4. 函式選 `setupTrigger` → 執行 → 授權（會要求 ScriptApp / SpreadsheetApp / **UrlFetchApp（連 GitHub）** / **MailApp（寄信）** / **LanguageApp（翻譯）**）→ 全部允許。
5. 完成。之後表單一送出就自動跑全套。

> 改完程式後只需「重貼 + 重跑一次 `setupTrigger`」即可（新 API 會要求重新授權）。

## onFormSubmit 行為
- 讀新列 → 缺店名或店名含「測試/TEST」→ `SKIP`。
- 產**中英雙語**頁（見下）→ `githubPut_` commit；檔案已存在=「更新」(UPDATE)、否則「新增」(PUBLISH)。
- 寫回上線網址到該列「已發佈網址」欄。
- `bumpCount_`：每次發佈 +1；`修改次數 = 發佈次數-1`；計費依收費模型。
- `notify_`：寄信給 `OWNER_EMAIL` + 填表人 email（example.com 會自動跳過）。
- `log_`：寫一列（時間/狀態/店名/說明/網址）。
- 開關：`AUTO_PUBLISH=true` 發到 `deals/`（正式）；`false` 發到 `drafts/`（待審）。

## 收費模型（已定案）
月費 NT$0。新增上架免費、**首次修改免費**、**第 2 次修改起每次 NT$300（US$10）**。
`修改次數` 表自動算每店的計費次數與應計費金額。修改費只放招商頁/條款，**不放招商簡報**。

## 雙語（中英完全鏡像）
- 每個文字元素都帶 `data-en` 與 `data-zh`；`lang.js` 的 中/EN 鈕切換同頁語言。
- 自動產頁：商家輸入用 **`LanguageApp.translate(text,'','en'|'zh-TW')`** 自動翻成兩種語言；UI 標題/兌換步驟寫死雙語。
- 全站 10 頁（首頁/旅客/招商/地圖/各 deal）皆鏡像；任何新元素都要補 `data-en`+`data-zh`。

## 維運
- 日常只要看「log」：`PUBLISH`/`UPDATE`=成功、`SKIP`=略過、`ERROR`=出錯（含原因）。
- `backfillExisting()`：一次性把「表單回覆 1」既有每列補產頁/寫回網址/計次/記 log（測試列會略過）。
- 撤掉不良頁：`git rm -r deals/<slug> && git commit && git push`。
- 每日排程 `taiwansaver-merchant-onboarding`（產草稿版）已**停用**，由本即時自動化取代。

## ⚠️ 踩雷筆記（重要，省下重複除錯）
1. **關鍵字撞欄**：`pick('地址')` 會誤中 Google 自動欄「**電子郵件地址**」→ 地址要用關鍵字「**Address**」。同理避免用會互相包含的中文關鍵字。
2. **雙重轉義**：放進 `data-*` 又經過 `esc()` 的字串，別放 HTML entity（如 `&middot;`）→ 會變字面 `&amp;middot;`。用字面字元「·」。含 `<b>` 的靜態文字不要 esc（讓 lang.js 用 innerHTML 渲染）。
3. **貼程式回編輯器**：大段 base64 手貼會壞字元。可靠做法 = 把 `.gs` push 到 repo，於 Apps Script 分頁執行
   `fetch(rawGitHubUrl).then(r=>r.text()).then(c=>monaco.editor.getModels()[0].setValue(c))` 再 Ctrl+S。
4. **背景 PR workflow**：此 repo 有背景流程會自動 commit/PR → 本機 push 前先 `git pull --rebase origin main`。
5. **自動化用 Google 表單填寫測試**：欄位用原生 setter+`input`事件設值；提交要與填值「隔一拍」（setTimeout ~700ms 再點提交），同步立即提交會被驗證擋下。段落題（textarea）尤其要先 focus 再設值。
6. **GitHub Pages 建置延遲**：commit 後 ~1 分鐘才上線；驗證可改用 `git pull` 直接看 commit 進來的檔案，不必等 Pages。

## 驗證／測試流程
1. 用表單送一筆**非測試名**（例：`Demo Verify Shop`，勿含「測試/TEST」否則被 SKIP）、英文內容。
2. 等 ~12 秒 → `git pull` → 讀 `deals/<slug>/index.html`：
   - `data-zh` 應是**真中文翻譯**（證明 LanguageApp 已授權）。
   - 地址欄是地址、不是 email；`·` 正常顯示。
   - log 出現 `PUBLISH`、修改次數表多一列、收到通知信。
3. 驗證後清掉：`git rm -r deals/<slug>` → commit → push。

## 相關檔案
- 程式：`scripts/auto-publish.gs`
- 站台雙語：`assets/lang.js`、各頁 `data-en`/`data-zh`
- 規劃文件：`../taiwan-discounts/`（01-PLAN ~ 07-SEO、progress.html、招商簡報）
