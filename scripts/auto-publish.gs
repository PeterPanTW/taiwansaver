/**
 * TaiwanSaver — 表單新回覆 → 自動產生/更新 deal 頁發佈到 GitHub Pages。
 * 並：① 把上線網址寫回「資料清單」該列 ② 記錄到「log」修改歷程
 *     ③ 更新「修改次數」累積表 ④ 寄信給 Peter + 填表人（含 3 連結 + 修改總次數）
 *
 * ── 設定（若先前已設定過，改動程式後只需「重貼 + 再跑一次 setupTrigger」以授權寄信權限）──
 * 1) GitHub fine-grained PAT（repo=PeterPanTW/taiwansaver, Contents=Read and write）。
 * 2) 這份 Sheet → 擴充功能 → Apps Script，貼上本檔，Ctrl+S。
 * 3) 專案設定 → 指令碼屬性：GITHUB_TOKEN = 你的 token。
 * 4) 函式選 setupTrigger → 執行 → 授權（這次會多要求「以你的名義寄送電子郵件」權限，按允許）。
 * 完成。之後表單一送出就自動跑全套。
 */

var REPO = 'PeterPanTW/taiwansaver';
var BRANCH = 'main';
var AUTO_PUBLISH = true;                       // true=發到 deals/（正式上線）
var LOG_SHEET = 'log';                          // 修改歷程
var COUNT_SHEET = '修改次數';                    // 修改次數累積表
var OWNER_EMAIL = 'peter@topologytravel.com';   // 一律副本給 Peter
var URL_COL_HEADER = '已發佈網址';               // 寫回資料清單的欄位名
var FREE_EDITS = 1;                             // 首次修改免費（新增本身也免費）
var FEE_PER_EDIT = 300;                         // 第 2 次修改起，每次 NT$

/** 安裝觸發器（執行一次；改動程式或新增寄信權限後再跑一次以重新授權） */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onNewSubmission') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onNewSubmission').forSpreadsheet(SpreadsheetApp.getActive()).onFormSubmit().create();
  log_('SETUP', '', '觸發器已安裝；AUTO_PUBLISH=' + AUTO_PUBLISH, '');
}

/** 每次表單送出自動執行 */
function onNewSubmission(e) {
  var nv = (e && e.namedValues) || {};
  function pick(k) { for (var key in nv) { if (key.indexOf(k) !== -1 && nv[key][0]) return String(nv[key][0]).trim(); } return ''; }
  var name = pick('店名');
  try {
    if (!name) { log_('SKIP', '', '缺店名，略過', ''); return; }
    if (/test|測試/i.test(name)) { log_('SKIP', name, '疑似測試列，略過', ''); return; }

    var d = {
      name: name, hours: pick('開門'), phone: pick('聯絡電話'), address: pick('地址'),
      discount: pick('折扣'), category: pick('類型'), ig: pick('IG'), photos: pick('照片'),
      contactName: pick('聯絡人姓名'), contactEmail: pick('Email'), submitterEmail: pick('電子郵件'),
      contactMobile: pick('聯絡人電話'), social: pick('LINE')
    };

    var slug = slugify_(name);
    var path = (AUTO_PUBLISH ? 'deals' : 'drafts') + '/' + slug + '/index.html';
    var existed = githubPut_(path, buildDealHtml_(slug, d), 'Auto: ' + name + ' (from form)');
    var url = 'https://taiwansaver.com/deals/' + slug + '/';

    // ① 寫回資料清單該列
    try { writeUrlToRow_(e, url); } catch (err2) { log_('WARN', name, '寫回網址失敗：' + err2, url); }

    // ③ 更新修改次數累積表（existed=true 表示這是「修改」，否則是「新增」）
    var c = bumpCount_(name, slug, url, existed);

    // ④ 寄信給 Peter + 填表人
    var emailMsg = '';
    try { emailMsg = notify_(d, url, c); } catch (err3) { emailMsg = '寄信失敗：' + err3; }

    // ② 記錄修改歷程
    log_(existed ? 'UPDATE' : 'PUBLISH', name,
      (existed ? '已更新 ' : '已新增 ') + path
      + ' | 累積發佈 ' + c.publishes + ' 次（修改 ' + c.edits + '、計費 ' + c.billable + '）'
      + ' | 窗口 ' + (d.contactName || '-') + ' ' + (d.contactEmail || d.contactMobile || d.social || '')
      + ' | ' + emailMsg, url);
  } catch (err) {
    log_('ERROR', name, String(err).substring(0, 300), '');
  }
}

/** 把上線網址寫回「資料清單(表單回覆)」剛送出的那一列（新增欄位「已發佈網址」） */
function writeUrlToRow_(e, url) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  var row = e.range.getRow();
  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headers.indexOf(URL_COL_HEADER) + 1;
  if (col === 0) { col = lastCol + 1; sh.getRange(1, col).setValue(URL_COL_HEADER); }
  sh.getRange(row, col).setValue(url);
}

/** 修改次數累積表：每次發佈 +1。新增與首次修改免費，第 2 次修改起每次計費。回傳統計。 */
function bumpCount_(name, slug, url, existed) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(COUNT_SHEET);
  if (!sh) { sh = ss.insertSheet(COUNT_SHEET); sh.appendRow(['店名 Store', 'slug', '累積發佈次數', '修改次數', '計費修改次數', '應計費 NT$', '首次發佈', '最近發佈', '網址']); }
  var data = sh.getDataRange().getValues();
  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) { if (data[i][1] === slug) { rowIdx = i + 1; break; } }
  var publishes, first;
  if (rowIdx === -1) { publishes = 1; first = new Date(); rowIdx = sh.getLastRow() + 1; }
  else { publishes = Number(data[rowIdx - 1][2]) + 1; first = data[rowIdx - 1][6] || new Date(); }
  var edits = Math.max(0, publishes - 1);              // 修改次數（不含新增）
  var billable = Math.max(0, publishes - 1 - FREE_EDITS); // 計費次數（首次修改免費）
  sh.getRange(rowIdx, 1, 1, 9).setValues([[name, slug, publishes, edits, billable, billable * FEE_PER_EDIT, first, new Date(), url]]);
  // 平台總修改次數（所有店家 edits 加總）
  var total = 0; var dd = sh.getDataRange().getValues();
  for (var j = 1; j < dd.length; j++) total += Number(dd[j][3]) || 0;
  return { publishes: publishes, edits: edits, billable: billable, fee: billable * FEE_PER_EDIT, platformTotalEdits: total };
}

/** 寄信給 Peter + 填表人，含 3 連結與修改總次數 */
function notify_(d, dealUrl, c) {
  var ss = SpreadsheetApp.getActive();
  var base = ss.getUrl();
  var listUrl = base + '#gid=' + ss.getSheetByName('表單回覆 1').getSheetId();
  var histUrl = base + '#gid=' + ss.getSheetByName(LOG_SHEET).getSheetId();
  var to = [OWNER_EMAIL];
  var merchant = d.submitterEmail || d.contactEmail || '';
  if (merchant && merchant.indexOf('@') !== -1 && merchant.toLowerCase().indexOf('example.com') === -1) to.push(merchant);

  var feeLine = (c.billable > 0)
    ? ('本次為第 ' + c.edits + ' 次修改，依方案產生費用 NT$' + FEE_PER_EDIT + '（累計應計費 NT$' + c.fee + '）。')
    : (c.publishes === 1 ? '本次為新增上架，免費。' : '本次為首次修改，免費。');

  var body =
    d.name + ' 您好（副本：Peter / 真程旅行社）\n\n' +
    '您的 TaiwanSaver 折扣頁已自動' + (c.publishes === 1 ? '產生並上線' : '更新') + '。請查看以下三個連結的內容是否正確：\n\n' +
    '1. 您的折扣頁（已上線）：\n   ' + dealUrl + '\n' +
    '2. 您填寫的資料（資料清單）：\n   ' + listUrl + '\n' +
    '3. 修改歷程（每次變動紀錄）：\n   ' + histUrl + '\n\n' +
    '目前這筆資料累積修改 ' + c.edits + ' 次（含本次）。' + feeLine + '\n\n' +
    '如資料有誤需修改，請回覆此信或重新填寫上架表單。\n— TaiwanSaver / 真程旅行社';

  MailApp.sendEmail({ to: to.join(','), subject: '[TaiwanSaver] ' + d.name + ' 折扣頁已' + (c.publishes === 1 ? '上線' : '更新') + '（累積修改 ' + c.edits + ' 次）', body: body });
  return '已寄信給 ' + to.join(',');
}

/**
 * 一次性回填：把「表單回覆 1」既有每一列都產頁 + 寫回網址 + 計次 + 記錄備份到 log。
 * 用途：把過去既有資料納入系統做「備份 + 產出 link」。不寄信（避免大量回填時洗信）。
 * 用法：函式選 backfillExisting → 執行。（測試列會自動略過）
 */
function backfillExisting() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('表單回覆 1');
  if (!sh) { log_('ERROR', '', '找不到「表單回覆 1」分頁', ''); return; }
  var data = sh.getDataRange().getValues();
  var H = data[0];
  function ci(kw) { for (var i = 0; i < H.length; i++) { if (String(H[i]).indexOf(kw) !== -1) return i; } return -1; }
  var iName = ci('店名'), iHours = ci('開門'), iPhone = ci('聯絡電話'), iAddr = ci('地址'),
      iDisc = ci('折扣'), iCat = ci('類型'), iIg = ci('IG'), iPhoto = ci('照片');
  function g(row, i) { return i >= 0 ? String(row[i] || '').trim() : ''; }
  var done = 0, skip = 0;
  for (var r = 1; r < data.length; r++) {
    var name = g(data[r], iName);
    if (!name) continue;
    if (/test|測試/i.test(name)) { skip++; log_('SKIP', name, 'backfill：測試列略過', ''); continue; }
    try {
      var d = { name: name, hours: g(data[r], iHours), phone: g(data[r], iPhone), address: g(data[r], iAddr),
        discount: g(data[r], iDisc), category: g(data[r], iCat), ig: g(data[r], iIg), photos: g(data[r], iPhoto) };
      var slug = slugify_(name);
      var path = (AUTO_PUBLISH ? 'deals' : 'drafts') + '/' + slug + '/index.html';
      var existed = githubPut_(path, buildDealHtml_(slug, d), 'Backfill: ' + name);
      var url = 'https://taiwansaver.com/deals/' + slug + '/';
      // 寫回該列的「已發佈網址」
      var lastCol = sh.getLastColumn();
      var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
      var col = hdr.indexOf(URL_COL_HEADER) + 1;
      if (col === 0) { col = lastCol + 1; sh.getRange(1, col).setValue(URL_COL_HEADER); }
      sh.getRange(r + 1, col).setValue(url);
      var c = bumpCount_(name, slug, url, existed);
      log_('BACKFILL', name, '備份+產頁 ' + path + ' | 累積發佈 ' + c.publishes, url);
      done++;
      Utilities.sleep(800); // 放慢，避免 GitHub API 過快
    } catch (err) { log_('ERROR', name, 'backfill：' + String(err).substring(0, 200), ''); }
  }
  log_('BACKFILL-DONE', '', '回填完成：' + done + ' 筆，略過 ' + skip + ' 筆（測試）', '');
}

function slugify_(s) { var a = s.toLowerCase().replace(/[一-鿿]/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); return a || ('store-' + Math.abs(hash_(s))); }
function hash_(s) { var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }

/** GitHub 建立/更新檔案。回傳 true=檔案原本就存在(此次為更新)；false=新建 */
function githubPut_(path, content, message) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('尚未設定指令碼屬性 GITHUB_TOKEN');
  var api = 'https://api.github.com/repos/' + REPO + '/contents/' + path;
  var headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  var sha = null;
  var g = UrlFetchApp.fetch(api + '?ref=' + BRANCH, { headers: headers, muteHttpExceptions: true });
  if (g.getResponseCode() === 200) sha = JSON.parse(g.getContentText()).sha;
  var payload = { message: message, content: Utilities.base64Encode(content, Utilities.Charset.UTF_8), branch: BRANCH };
  if (sha) payload.sha = sha;
  var r = UrlFetchApp.fetch(api, { method: 'put', contentType: 'application/json', headers: headers, payload: JSON.stringify(payload), muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('GitHub PUT ' + r.getResponseCode() + ': ' + r.getContentText().substring(0, 200));
  return sha !== null;
}

/** 寫一列到「log」修改歷程 */
function log_(status, store, detail, url) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(LOG_SHEET) || ss.insertSheet(LOG_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(['時間 Time', '狀態 Status', '店名 Store', '說明 Detail', '網址 URL']);
  sh.appendRow([new Date(), status, store, detail, url]);
}

/** 產生「中英雙語」公開 deal 頁：每個元素都有 data-en/data-zh，lang.js 可切換、內容鏡像。
 *  商家輸入用 LanguageApp 自動翻成兩種語言；UI 文字寫死雙語。不含內部聯絡資訊。 */
function buildDealHtml_(slug, d) {
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function tr(t, tgt) { if (!t) return ''; try { return LanguageApp.translate(t, '', tgt); } catch (e) { return t; } }
  function bi(tag, attrs, en, zh) { return '<' + tag + (attrs ? ' ' + attrs : '') + ' data-en="' + esc(en) + '" data-zh="' + esc(zh) + '">' + esc(en) + '</' + tag + '>'; }
  var discEN = tr(d.discount, 'en'), discZH = tr(d.discount, 'zh-TW');
  var hoursEN = tr(d.hours, 'en'), hoursZH = tr(d.hours, 'zh-TW');
  var catEN = d.category || 'Local deal', catZH = d.category || '在地優惠';
  var ph = d.phone ? ' &middot; ☎ ' + d.phone : '';
  var sumEN = d.name + ' offers travelers ' + discEN + '. Show the TaiwanSaver flyer at the counter to redeem. ' + hoursEN + ' Address: ' + d.address + '.';
  var sumZH = d.name + '：出示 TaiwanSaver 電子 DM 即可享「' + discZH + '」。' + hoursZH + '。地址：' + d.address + '。';
  var jsonld = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: d.name, description: d.name + ' — ' + discEN + '. Show the TaiwanSaver flyer to redeem.', address: { '@type': 'PostalAddress', streetAddress: d.address, addressRegion: 'Taipei', addressCountry: 'TW' }, telephone: d.phone, url: 'https://taiwansaver.com/deals/' + slug + '/', makesOffer: { '@type': 'Offer', name: discEN } };
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
'<title>' + esc(d.name) + ' — ' + esc(discEN) + ' | Taipei | TaiwanSaver</title>\n' +
'<meta name="description" content="' + esc(sumEN) + '">\n' +
'<link rel="canonical" href="https://taiwansaver.com/deals/' + slug + '/">\n' +
'<link rel="stylesheet" href="https://taiwansaver.com/assets/style.css">\n' +
'<script defer src="https://taiwansaver.com/assets/lang.js"></script>\n' +
'<script type="application/ld+json">' + JSON.stringify(jsonld) + '</script>\n</head>\n<body>\n' +
'<div class="bar"><a class="brand" href="https://taiwansaver.com/">Taiwan<b>Saver</b></a>\n' +
'<nav class="nav"><a href="https://taiwansaver.com/travelers/" data-en="For travelers" data-zh="旅客">For travelers</a> <a href="https://taiwansaver.com/map/" data-en="Map" data-zh="地圖">Map</a> <a href="https://taiwansaver.com/for-business/" data-en="For business" data-zh="店家合作">For business</a> <button class="langbtn" data-lang-toggle aria-label="切換成中文">中</button></nav></div>\n' +
'<main class="wrap">\n' +
bi('p', 'class="eyebrow"', catEN, catZH) + '\n' +
bi('h1', '', d.name, d.name) + '\n' +
bi('p', 'class="deal" style="font-size:22px;color:var(--red);font-weight:800"', discEN, discZH) + '\n' +
bi('p', 'class="summary"', sumEN, sumZH) + '\n' +
bi('h2', '', 'What is the discount?', '有什麼折扣？') + bi('p', '', discEN + ' — show the flyer at the counter, no booking needed.', discZH + ' — 到店出示電子 DM 即可，免預約。') + '\n' +
bi('h2', '', 'Where is it?', '在哪裡？') + bi('p', '', d.address + ph, d.address + ph) + '\n' +
bi('h2', '', 'What are the opening hours?', '營業時間？') + bi('p', '', hoursEN, hoursZH) + '\n' +
bi('h2', '', 'How do I redeem it?', '怎麼兌換？') + '<ol>' + bi('li', '', 'Save or screenshot the TaiwanSaver flyer.', '存下或截圖 TaiwanSaver 電子 DM。') + bi('li', '', 'Show it at the counter.', '到店出示。') + bi('li', '', 'Enjoy your discount.', '享受折扣。') + '</ol>\n' +
'<div class="callout" data-en="<b>Your flyer</b> &middot; Recommended by Topology Travel. Show this page at the counter to enjoy the offer." data-zh="<b>你的電子 DM</b> &middot; 真程旅行社推薦。到店出示本頁即可享優惠。"><b>Your flyer</b> &middot; Recommended by Topology Travel. Show this page at the counter to enjoy the offer.</div>\n' +
'</main>\n</body>\n</html>\n';
}
