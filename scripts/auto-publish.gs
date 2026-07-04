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
      name: name, hours: pick('開門'), phone: pick('聯絡電話'), address: pick('Address'),
      discount: pick('折扣'), category: pick('類型'), ig: pick('IG'), photos: pick('照片'),
      contactName: pick('聯絡人姓名'), contactEmail: pick('Email'), submitterEmail: pick('電子郵件'),
      contactMobile: pick('聯絡人電話'), social: pick('LINE')
    };

    publishStore_(d, { event: e, source: 'gform' });
  } catch (err) {
    log_('ERROR', name, String(err).substring(0, 300), '');
  }
}


/** ── 自家表單（taiwansaver.com/join/）入口 ──
 * 部署：Apps Script 編輯器 → 部署 → 新增部署 → 網頁應用程式
 *      執行身分=我、誰可以存取=所有人 → 取得 /exec 網址貼進 join/index.html 的 ENDPOINT。
 */
function doPost(e) {
  var p = (e && e.parameter) || {};
  var out = { ok: false };
  try {
    if (p.website) { out.ok = true; return json_(out); }          // 蜜罐：機器人填了就默默丟掉
    var d = {
      name: String(p.name || '').trim(), hours: '', phone: String(p.phone || '').trim(),
      address: String(p.address || '').trim(), discount: String(p.discount || '').trim(),
      category: String(p.category || '').trim(), ig: String(p.ig || '').trim(),
      photos: String(p.photos || '').trim(), contactName: String(p.contactName || '').trim(),
      contactEmail: String(p.contactEmail || '').trim(), submitterEmail: String(p.contactEmail || '').trim(),
      contactMobile: String(p.contactMobile || '').trim(), social: String(p.social || '').trim()
    };
    if (!d.name || !d.discount || !d.address) { out.error = '缺必填欄位'; return json_(out); }
    if (/test|測試/i.test(d.name)) { log_('SKIP', d.name, '疑似測試（join 表單），略過', ''); out.error = '測試店名不上線'; return json_(out); }
    var row = appendToSheet_(d);                                   // 寫進「表單回覆 1」＝資料庫
    var r = publishStore_(d, { sheetRow: row, source: 'join' });
    out.ok = true; out.url = r.url;
  } catch (err) {
    log_('ERROR', p.name || '', 'doPost：' + String(err).substring(0, 300), '');
    out.error = String(err).substring(0, 200);
  }
  return json_(out);
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** 把自家表單的資料寫進「表單回覆 1」，欄位用表頭關鍵字對應（與 Google 表單共用同一張表）。回傳列號 */
function appendToSheet_(d) {
  var sh = SpreadsheetApp.getActive().getSheetByName('表單回覆 1');
  var H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var row = new Array(H.length).fill('');
  function put(kw, v) { for (var i = 0; i < H.length; i++) { if (String(H[i]).indexOf(kw) !== -1) { row[i] = v; return; } } }
  put('時間戳記', new Date()); put('店名', d.name); put('聯絡電話', d.phone); put('Address', d.address);
  put('折扣', d.discount); put('類型', d.category); put('IG', d.ig); put('照片', d.photos);
  put('聯絡人姓名', d.contactName); put('聯絡人 Email', d.contactEmail); put('電子郵件地址', d.contactEmail);
  put('聯絡人電話', d.contactMobile); put('LINE', d.social);
  sh.appendRow(row);
  return sh.getLastRow();
}

/** ── 共用發佈核心：產頁→寫回網址→計次→寄信→deals.json→sitemap→log ── */
function publishStore_(d, opts) {
  opts = opts || {};
  var slug = slugify_(d.name);
  var path = (AUTO_PUBLISH ? 'deals' : 'drafts') + '/' + slug + '/index.html';
  var existed = githubPut_(path, buildDealHtml_(slug, d), 'Auto: ' + d.name + ' (from form)');
  var url = 'https://taiwansaver.com/deals/' + slug + '/';

  if (opts.sheetRow) { try { writeUrlToRowNum_(opts.sheetRow, url); } catch (e1) { log_('WARN', d.name, '寫回網址失敗：' + e1, url); } }
  if (opts.event)    { try { writeUrlToRow_(opts.event, url); }      catch (e2) { log_('WARN', d.name, '寫回網址失敗：' + e2, url); } }

  var c = bumpCount_(d.name, slug, url, existed);
  var emailMsg = '';
  try { emailMsg = notifyQueue_(d, url, c); } catch (e3) { emailMsg = '排程寄信失敗：' + e3; }

  try { updateDealsJson_(slug, d, url); } catch (e4) { log_('WARN', d.name, 'deals.json 更新失敗：' + e4, url); }
  try { updateSitemap_(slug); }           catch (e5) { log_('WARN', d.name, 'sitemap 更新失敗：' + e5, url); }

  log_(existed ? 'UPDATE' : 'PUBLISH', d.name,
    (existed ? '已更新 ' : '已新增 ') + path
    + ' | 累積發佈 ' + c.publishes + ' 次（修改 ' + c.edits + '、計費 ' + c.billable + '）'
    + ' | 窗口 ' + (d.contactName || '-') + ' ' + (d.contactEmail || d.contactMobile || d.social || '')
    + ' | ' + emailMsg, url);
  return { url: url, existed: existed, c: c };
}

function writeUrlToRowNum_(rowNum, url) {
  var sh = SpreadsheetApp.getActive().getSheetByName('表單回覆 1');
  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = headers.indexOf(URL_COL_HEADER) + 1;
  if (col === 0) { col = lastCol + 1; sh.getRange(1, col).setValue(URL_COL_HEADER); }
  sh.getRange(rowNum, col).setValue(url);
}

/** 地址→經緯度（Apps Script 內建 geocoder，限台灣範圍） */
function geocode_(address) {
  if (!address || /^https?:/i.test(address)) return null;         // 線上服務（填網址）不定位
  try {
    var res = Maps.newGeocoder().setRegion('tw').geocode(address);
    if (res.status === 'OK' && res.results.length) {
      var l = res.results[0].geometry.location;
      return { lat: Math.round(l.lat * 1e6) / 1e6, lng: Math.round(l.lng * 1e6) / 1e6 };
    }
  } catch (e) {}
  return null;
}

var CAT_EMOJI = { '酒吧': '🍸', '餐廳': '🍽️', '咖啡': '☕', '旅遊': '🚗', '其他': '✨' };
function catEmoji_(cat) { for (var k in CAT_EMOJI) { if (cat && cat.indexOf(k) !== -1) return CAT_EMOJI[k]; } return '⭐'; }

/** 把店家 upsert 進 assets/deals.json（travelers 列表與地圖會自動長出新卡片/marker） */
function updateDealsJson_(slug, d, url) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  var api = 'https://api.github.com/repos/' + REPO + '/contents/assets/deals.json';
  var headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  var g = UrlFetchApp.fetch(api + '?ref=' + BRANCH, { headers: headers, muteHttpExceptions: true });
  if (g.getResponseCode() !== 200) throw new Error('讀 deals.json 失敗 ' + g.getResponseCode());
  var meta = JSON.parse(g.getContentText());
  var data = JSON.parse(Utilities.newBlob(Utilities.base64Decode(meta.content.replace(/\n/g, ''))).getDataAsString('UTF-8'));

  function tr(t, tgt) { if (!t) return ''; try { return LanguageApp.translate(t, '', tgt); } catch (e) { return t; } }
  var emoji = catEmoji_(d.category);
  var ll = geocode_(d.address);
  var entry = {
    slug: slug, name: d.name,
    tagEN: emoji + ' ' + (tr(d.category, 'en') || 'Local deal') + ' · Taipei',
    tagZH: emoji + ' ' + (d.category || '在地優惠') + ' · 台北',
    dealEN: tr(d.discount, 'en'), dealZH: tr(d.discount, 'zh-TW'),
    descEN: d.name + ' — show the TaiwanSaver flyer at the counter to redeem.',
    descZH: d.name + ' — 到店出示 TaiwanSaver 電子 DM 即可兌換。',
    lat: ll ? ll.lat : null, lng: ll ? ll.lng : null,
    gmaps: ll ? ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(d.address)) : '',
    added: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd')
  };
  var found = false;
  for (var i = 0; i < data.deals.length; i++) { if (data.deals[i].slug === slug) { data.deals[i] = entry; found = true; break; } }
  if (!found) data.deals.push(entry);
  data.updated = entry.added;
  githubPut_('assets/deals.json', JSON.stringify(data, null, 2) + '\n', 'Auto: deals.json — ' + d.name);
}

/** 把新 deal 頁加進 sitemap.xml（已存在則更新 lastmod） */
function updateSitemap_(slug) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  var api = 'https://api.github.com/repos/' + REPO + '/contents/sitemap.xml';
  var headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  var g = UrlFetchApp.fetch(api + '?ref=' + BRANCH, { headers: headers, muteHttpExceptions: true });
  if (g.getResponseCode() !== 200) throw new Error('讀 sitemap 失敗 ' + g.getResponseCode());
  var meta = JSON.parse(g.getContentText());
  var xml = Utilities.newBlob(Utilities.base64Decode(meta.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
  var loc = 'https://taiwansaver.com/deals/' + slug + '/';
  var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  if (xml.indexOf('<loc>' + loc + '</loc>') !== -1) {
    var re = new RegExp('(<url><loc>' + loc.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + '</loc><lastmod>)[0-9-]+(</lastmod>)');
    xml = xml.replace(re, '$1' + today + '$2');
  } else {
    xml = xml.replace('</urlset>', '  <url><loc>' + loc + '</loc><lastmod>' + today + '</lastmod><priority>0.9</priority></url>\n</urlset>');
  }
  githubPut_('sitemap.xml', xml, 'Auto: sitemap — ' + slug);
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

/** ── 延遲通知：等 GitHub Pages 建置完成（頁面回 200）才寄信 ──
 * publishStore_ 不直接寄信，而是排入佇列＋建立 70 秒後的一次性觸發器。
 * processNotifyQueue 確認頁面已上線才寄；還沒好就再等 60 秒（最多 5 輪後強制寄出）。 */
function notifyQueue_(d, url, c) {
  var props = PropertiesService.getScriptProperties();
  var q = JSON.parse(props.getProperty('NOTIFY_QUEUE') || '[]');
  q.push({ d: { name: d.name, submitterEmail: d.submitterEmail || '', contactEmail: d.contactEmail || '',
                contactMobile: d.contactMobile || '', social: d.social || '' }, url: url, c: c, tries: 0 });
  props.setProperty('NOTIFY_QUEUE', JSON.stringify(q));
  ScriptApp.newTrigger('processNotifyQueue').timeBased().after(70 * 1000).create();
  return '通知已排程（頁面上線後寄出）';
}

function processNotifyQueue() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processNotifyQueue') ScriptApp.deleteTrigger(t);
  });
  var props = PropertiesService.getScriptProperties();
  var q = JSON.parse(props.getProperty('NOTIFY_QUEUE') || '[]');
  var keep = [];
  q.forEach(function (item) {
    var live = false;
    try { live = UrlFetchApp.fetch(item.url, { muteHttpExceptions: true }).getResponseCode() === 200; } catch (e) {}
    if (live || item.tries >= 4) {
      try { var msg = notify_(item.d, item.url, item.c); log_('NOTIFY', item.d.name, msg + (live ? '（頁面已確認上線）' : '（建置逾時，仍寄出）'), item.url); }
      catch (e2) { log_('WARN', item.d.name, '延遲寄信失敗：' + e2, item.url); }
    } else { item.tries++; keep.push(item); }
  });
  props.setProperty('NOTIFY_QUEUE', JSON.stringify(keep));
  if (keep.length) ScriptApp.newTrigger('processNotifyQueue').timeBased().after(60 * 1000).create();
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
  var iName = ci('店名'), iHours = ci('開門'), iPhone = ci('聯絡電話'), iAddr = ci('Address'),
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

function slugify_(s) {
  var a = s.toLowerCase().replace(/[一-鿿]/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!a) {
    // 純中文店名：先自動翻成英文再取網址（例：台灣好餐廳 → taiwan-good-restaurant）
    try {
      var en = LanguageApp.translate(s, '', 'en');
      a = String(en).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 60).replace(/-+$/g, '');
    } catch (e) {}
  }
  return a || ('store-' + Math.abs(hash_(s)));
}

/** ── 維運：一鍵下架店家（deal 頁、deals.json、sitemap、修改次數列）──
 * 用法：在下方 cleanupSlug 填 slug → 函式選 runRemoveStore → 執行。 */
var cleanupSlug = '';
function runRemoveStore() { if (cleanupSlug) removeStore(cleanupSlug); }
function cleanupTestData() { removeStore('demo-verify-diner'); removeStore('store-749845811'); }

function removeStore(slug) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  var headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  // ① 刪 deal 頁
  var api = 'https://api.github.com/repos/' + REPO + '/contents/deals/' + slug + '/index.html';
  var g = UrlFetchApp.fetch(api + '?ref=' + BRANCH, { headers: headers, muteHttpExceptions: true });
  if (g.getResponseCode() === 200) {
    var sha = JSON.parse(g.getContentText()).sha;
    UrlFetchApp.fetch(api, { method: 'delete', contentType: 'application/json', headers: headers,
      payload: JSON.stringify({ message: 'Remove: deals/' + slug, sha: sha, branch: BRANCH }), muteHttpExceptions: true });
  }
  // ② deals.json 移除
  try {
    var japi = 'https://api.github.com/repos/' + REPO + '/contents/assets/deals.json';
    var jg = UrlFetchApp.fetch(japi + '?ref=' + BRANCH, { headers: headers, muteHttpExceptions: true });
    if (jg.getResponseCode() === 200) {
      var meta = JSON.parse(jg.getContentText());
      var data = JSON.parse(Utilities.newBlob(Utilities.base64Decode(meta.content.replace(/\n/g, ''))).getDataAsString('UTF-8'));
      var before = data.deals.length;
      data.deals = data.deals.filter(function (x) { return x.slug !== slug; });
      if (data.deals.length !== before) githubPut_('assets/deals.json', JSON.stringify(data, null, 2) + '\n', 'Remove from deals.json: ' + slug);
    }
  } catch (e1) { log_('WARN', slug, 'removeStore deals.json：' + e1, ''); }
  // ③ sitemap 移除
  try {
    var sapi = 'https://api.github.com/repos/' + REPO + '/contents/sitemap.xml';
    var sg = UrlFetchApp.fetch(sapi + '?ref=' + BRANCH, { headers: headers, muteHttpExceptions: true });
    if (sg.getResponseCode() === 200) {
      var smeta = JSON.parse(sg.getContentText());
      var xml = Utilities.newBlob(Utilities.base64Decode(smeta.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
      var re = new RegExp('[ ]*<url><loc>https://taiwansaver\\.com/deals/' + slug + '/</loc>[\\s\\S]*?</url>\\n?');
      var nx = xml.replace(re, '');
      if (nx !== xml) githubPut_('sitemap.xml', nx, 'Remove from sitemap: ' + slug);
    }
  } catch (e2) { log_('WARN', slug, 'removeStore sitemap：' + e2, ''); }
  // ④ 修改次數表移除該列
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(COUNT_SHEET);
    if (sh) { var data2 = sh.getDataRange().getValues();
      for (var i = data2.length - 1; i >= 1; i--) { if (data2[i][1] === slug) sh.deleteRow(i + 1); } }
  } catch (e3) { log_('WARN', slug, 'removeStore 修改次數：' + e3, ''); }
  log_('REMOVE', slug, '已下架（頁面/deals.json/sitemap/計次）', '');
}
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
  var emoji = catEmoji_(d.category);
  var catEN = emoji + ' ' + (tr(d.category, 'en') || 'Local deal') + ' · Taipei', catZH = emoji + ' ' + (d.category || '在地優惠') + ' · 台北';
  var ph = d.phone ? ' · ☎ ' + d.phone : '';
  var ll = geocode_(d.address);
  var gmaps = ll ? ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(d.address)) : '';
  var sumEN = d.name + ' offers travelers ' + discEN + '. Show the TaiwanSaver flyer at the counter to redeem.' + (hoursEN ? ' ' + hoursEN : '') + ' Address: ' + d.address + '.';
  var sumZH = d.name + '：出示 TaiwanSaver 電子 DM 即可享「' + discZH + '」。' + (hoursZH ? hoursZH + '。' : '') + '地址：' + d.address + '。';
  var jsonld = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: d.name, description: d.name + ' — ' + discEN + '. Show the TaiwanSaver flyer to redeem.', address: { '@type': 'PostalAddress', streetAddress: d.address, addressRegion: 'Taipei', addressCountry: 'TW' }, telephone: d.phone, url: 'https://taiwansaver.com/deals/' + slug + '/', image: 'https://taiwansaver.com/assets/og.png', makesOffer: { '@type': 'Offer', name: discEN, eligibleCustomerType: 'Tourist' } };
  if (ll) jsonld.geo = { '@type': 'GeoCoordinates', latitude: ll.lat, longitude: ll.lng };
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
'<!-- Google Analytics (GA4) -->\n' +
'<script async src="https://www.googletagmanager.com/gtag/js?id=G-LFG20DT8BH"></script>\n' +
'<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag(\'js\',new Date());gtag(\'config\',\'G-LFG20DT8BH\');</script>\n' +
'<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
'<title>' + esc(d.name) + ' — ' + esc(discEN) + ' | Taipei | TaiwanSaver</title>\n' +
'<meta name="description" content="' + esc(sumEN) + '">\n' +
'<meta name="robots" content="index,follow,max-image-preview:large">\n' +
'<link rel="canonical" href="https://taiwansaver.com/deals/' + slug + '/">\n' +
'<meta property="og:type" content="website"><meta property="og:site_name" content="TaiwanSaver">\n' +
'<meta property="og:title" content="' + esc(d.name) + ' — ' + esc(discEN) + ' | Taipei">\n' +
'<meta property="og:description" content="' + esc(sumEN) + '">\n' +
'<meta property="og:url" content="https://taiwansaver.com/deals/' + slug + '/">\n' +
'<meta property="og:image" content="https://taiwansaver.com/assets/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">\n' +
'<meta property="og:locale" content="en"><meta property="og:locale:alternate" content="zh_TW">\n' +
'<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + esc(d.name) + ' — ' + esc(discEN) + '"><meta name="twitter:image" content="https://taiwansaver.com/assets/og.png">\n' +
'<meta name="theme-color" content="#225378">\n' +
'<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">\n' +
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
bi('h2', '', 'Where is it?', '在哪裡？') + '<p>' + esc(d.address + ph) + (gmaps ? ' · <a href="' + gmaps + '" target="_blank" rel="noopener" data-en="Open in Google Maps →" data-zh="用 Google 地圖開啟 →">Open in Google Maps →</a>' : '') + '</p>\n' +
(d.hours ? bi('h2', '', 'What are the opening hours?', '營業時間？') + bi('p', '', hoursEN, hoursZH) + '\n' : '') +
bi('h2', '', 'How do I redeem it?', '怎麼兌換？') + '<ol>' + bi('li', '', 'Save or screenshot the TaiwanSaver flyer.', '存下或截圖 TaiwanSaver 電子 DM。') + bi('li', '', 'Show it to the staff when you order.', '點餐時出示給店員看。') + bi('li', '', 'Enjoy your discount — no app, no code.', '享受折扣 — 免 App、免代碼。') + '</ol>\n' +
'<div class="callout" data-en="<b>Your flyer</b> · Recommended by Topology Travel. Show this page at the counter to enjoy the offer." data-zh="<b>你的電子 DM</b> · 真程旅行社推薦。到店出示本頁即可享優惠。"><b>Your flyer</b> · Recommended by Topology Travel. Show this page at the counter to enjoy the offer.</div>\n' +
'<div class="band"><a style="color:#fff" href="https://taiwansaver.com/travelers/" data-en="← All Taipei deals" data-zh="← 所有台北折扣">← All Taipei deals</a> &nbsp;·&nbsp; <a style="color:#fff" href="https://taiwansaver.com/map/" data-en="View map →" data-zh="看地圖 →">View map →</a></div>\n' +
'</main>\n' +
'<footer class="center"><p data-en="TaiwanSaver · operated by Topology Travel / 真程旅行社 · deals verified before listing" data-zh="TaiwanSaver · 由真程旅行社經營 · 上架前皆經查證">TaiwanSaver · operated by Topology Travel / 真程旅行社 · deals verified before listing</p></footer>\n' +
'</body>\n</html>\n';
}
