# [B.M] YouTube Shorts 工具箱

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/)
[![Site](https://img.shields.io/badge/site-YouTube_Shorts-FF0000?logo=youtube)](https://www.youtube.com/shorts/)
[![GitHub](https://img.shields.io/badge/GitHub-bm--youtube--shorts--tool-181717?logo=github)](https://github.com/BoringMan314/bm-youtube-shorts-tool)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

適用於 [YouTube Shorts](https://www.youtube.com/shorts/)（`youtube.com/shorts/*`）的瀏覽器擴充功能：將 Shorts 右側操作列整合成工具箱，提供倍速、逐幀播放、截圖、錄製、下載等功能，並可從擴充圖示開啟選項（左右鍵音量、選單展開方向）；並盡量對齊原生樣式與互動節奏。

*适用于 [YouTube Shorts](https://www.youtube.com/shorts/)（`youtube.com/shorts/*`）的浏览器扩展：将 Shorts 右侧操作栏整合为工具箱，提供倍速、逐帧播放、截图、录制、下载等功能，并可从扩展图标打开选项（左右键音量、菜单展开方向）；同时尽量贴近原生样式与交互节奏。*<br>
*[YouTube Shorts](https://www.youtube.com/shorts/)（`youtube.com/shorts/*`）向けのブラウザ拡張機能：Shorts の右側アクション列をツールボックス化し、再生速度、コマ送り再生、スクリーンショット、録画、ダウンロードなどの機能を提供します。拡張アイコンからオプション（左右キー音量、メニュー展開方向）を開くことができ、ネイティブの見た目と操作テンポにもできるだけ合わせています。*<br>
*A browser extension for [YouTube Shorts](https://www.youtube.com/shorts/) (`youtube.com/shorts/*`): it integrates the Shorts right action rail into a toolbox, provides features such as speed control, frame-by-frame playback, screenshot, recording, and download, lets you open options from the extension icon (arrow-key volume, panel expand direction), and keeps the UI and interaction rhythm as close to native Shorts as possible.*

> **聲明**：本專案為第三方輔助工具，與 Google／YouTube 官方無關。使用請遵守各服務條款與著作權規範。

---

![YouTube Shorts 工具箱示意](screenshot/screenshot_1280x800.png)

---

## 目錄

- [功能](#功能)
- [系統需求](#系統需求)
- [安裝方式](#安裝方式)
- [本機開發與測試](#本機開發與測試)
- [技術概要](#技術概要)
- [專案結構](#專案結構)
- [版本與多語系](#版本與多語系)
- [隱私說明](#隱私說明)
- [維護者：更新 GitHub 與 Chrome 線上應用程式商店](#維護者更新-github-與-chrome-線上應用程式商店)
- [授權](#授權)
- [問題與建議](#問題與建議)

---

## 功能

- **工具箱主鈕**：掛載在 Shorts **右側操作列**，主鈕可展開工具面板。
- **倍速切換**：`1x -> 1.5x -> 2x -> 3x` 循環，並維持跨 Shorts 切換的使用者設定。
- **逐幀播放**：靜音、以固定步進檢視畫面；與下載等流程互動時會依設計解除或還原相關狀態。
- **截圖**：以影片原始解析度擷取當前畫格並下載 PNG。
- **錄製 / 下載**：支援手動錄製與背景下載流程（`webm`），進行中提供狀態提示。
- **擴充選項（彈出視窗）**：例如 **左右鍵調整音量**、**功能選單向右或向上展開**，設定存於本機。
- **樣式對齊**：工具箱按鈕尺寸、間距與字色以原生 Shorts 右欄為基準同步。

---

## 系統需求

- **Chrome** 或 **Microsoft Edge**（Chromium）等支援 **Manifest V3** 的瀏覽器。

---

## 安裝方式

### 從 Chrome 線上應用程式商店（建議）

請在 [Chrome Web Store](https://chromewebstore.google.com/) 搜尋 **「[B.M] YouTube Shorts 工具箱」** 安裝。已有正式商品頁者，可改寫為與本系列他專案相同、附 **商店頁面** 直連之句型。

### 從原始碼載入（開發人員模式）

1. 點選本頁綠色 **Code** → **Download ZIP** 解壓，或執行 `git clone https://github.com/BoringMan314/bm-youtube-shorts-tool.git` 複製本倉庫。
2. 以 **Chrome** 或 **Microsoft Edge** 開啟 `chrome://extensions`（在 Edge 為 `edge://extensions`）。
3. 開啟「**開發人員模式**」→「**載入未封裝項目**」→ 選取含 [`manifest.json`](manifest.json) 的**專案根目錄**（勿選子資料夾）。
4. 進入任一 Shorts 頁面（`https://www.youtube.com/shorts/...`）驗證工具箱是否出現在右側操作列。

---

## 本機開發與測試

修改 [`content.js`](content.js)、[`content.css`](content.css)、[`background.js`](background.js)、[`popup.html`](popup.html)、[`popup.js`](popup.js) 或 [`_locales/`](_locales/) 後，在 `chrome://extensions` 將本擴充**重新載入**，再重新整理 Shorts 分頁驗證；若變更彈出視窗，請關閉後再開啟一次。

---

## 技術概要

- **Content script** [`content.js`](content.js)：注入 UI、控制倍速與逐幀、處理截圖與錄製狀態。
- **Background service worker** [`background.js`](background.js)：處理下載相關流程與分頁協調。
- **彈出視窗** [`popup.html`](popup.html) / [`popup.js`](popup.js)：搭配 `chrome.storage` 儲存選項。
- **樣式層** [`content.css`](content.css)：與腳本內影子樣式同步，降低 YouTube 動態 DOM 變動影響。
- **定位策略**：以 Shorts 右側操作列原生節點為錨點，透過 `MutationObserver` 維持掛載與狀態更新。
- **多語系**：以 `chrome.i18n` 與 [`_locales/`](_locales/) 提供 `zh_TW` / `zh_CN` / `ja_JP` / `en_US`。

---

## 專案結構

| 路徑 | 說明 |
|------|------|
| [`manifest.json`](manifest.json) | Manifest V3 設定、權限、背景腳本與內容腳本宣告 |
| [`content.js`](content.js) | 工具箱 UI、倍速、逐幀、截圖、錄製、下載流程與狀態同步 |
| [`content.css`](content.css) | 工具箱外觀、按鈕狀態、與右欄對齊樣式 |
| [`background.js`](background.js) | 背景錄製／下載、訊息傳遞與例外處理 |
| [`popup.html`](popup.html)／[`popup.js`](popup.js) | 擴充圖示彈出視窗與選項介面 |
| [`_locales/`](_locales/) | 多語系字串（`zh_TW`、`zh_CN`、`ja_JP`、`en_US`） |
| [`privacy-policy.html`](privacy-policy.html) | 隱私權政策（上架商店所需之公開網頁） |
| [`icons/`](icons/) | 工具列與商店用圖示：icon.png |
| [`screenshot/`](screenshot/) | 商店與說明用截圖 |
| [`LICENSE`](LICENSE) | MIT 授權 |

---

## 版本與多語系

- **版本**：以 [`manifest.json`](manifest.json) 的 `version` 為準。
- **預設語系**：`zh_TW`（`default_locale`）。
- **內建語系**：`zh_TW`、`zh_CN`、`ja_JP`、`en_US`（路徑為 `_locales/<code>/messages.json`）。實際顯示依瀏覽器語系與遞減規則。

---

## 隱私說明

本擴充**不蒐集、不上傳**可識別個人之帳戶或瀏覽內容；**未內建**遠端可執行程式、分析或廣告追蹤。僅在本機分頁中處理 Shorts 互動所需邏輯，並以 `chrome.storage` 儲存選項（例如左右鍵音量、面板展開方向）。詳見 [`privacy-policy.html`](privacy-policy.html)。

**上架提醒**：若上架 Chrome Web Store，須在開發人員後台完成隱私實踐聲明，並提供本政策之**公開 HTTPS 網址**（建議以 [GitHub Pages](https://pages.github.com/) 託管專案內的 `privacy-policy.html`）。

---

## 維護者：更新 GitHub 與 Chrome 線上應用程式商店

### 更新至 GitHub

**Bash / Git Bash / PowerShell：**

```powershell
git add .
git commit -m "docs: 更新內容說明與商店連結"
git push origin main
```

### 更新至 Chrome 線上應用程式商店

請透過 [Chrome Web Store 開發人員控制台](https://chrome.google.com/webstore/devconsole) 手動上傳更新：

1. **遞增版本**：修改 `manifest.json` 中的 `version`（例如從 `0.1.0` 提升至 `0.1.1`）。
2. **封裝套件**：將專案內容壓縮為 ZIP 檔。
   - **必要檔案**：`manifest.json`, `content.js`, `content.css`, `background.js`, `popup.html`, `popup.js`, `privacy-policy.html`, `icons/`, `_locales/`, `LICENSE`
   - **建議不打包**：`.git/`, `.gitignore`, `README.md`, `screenshot/`, `*.psd`, `*.zip`, `*.url`
3. **上傳審核**：在控制台選擇項目 →「套件」→「上傳新套件」。
4. **提交送審**：確認版號、商店文案、截圖、隱私欄位與 `privacy-policy` 公開網址無誤後，點擊「**提交送審**」。

---

## 授權

本專案以 [MIT License](LICENSE) 授權。

---

## 問題與建議

歡迎透過 [GitHub Issues](https://github.com/BoringMan314/bm-youtube-shorts-tool/issues) 回報錯誤或提出改善建議。回報時請一併提供瀏覽器版本、**介面語言**及重現步驟。