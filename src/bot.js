// bot.js - FINAL V14 (All features: scheduled ads, batching, dashboard, backups, premium lock, ad-stats, multi-language)
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const express = require("express");
const app = express();
const path = require("path");

// ---------------- CONFIG ----------------
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("Please set TELEGRAM_BOT_TOKEN environment variable.");
  process.exit(1);
}
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Strict admin rules
const ADMIN_PASSWORD = "afiya1310";
const ALLOWED_ADMIN_ID = 6358090699; // only this chat id can use /admin

// DB path
const DB_PATH = "./src/database.json";
const BACKUP_DIR = "./src/backups";
if (!fs.existsSync("./src")) fs.mkdirSync("./src");
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

// Header/footer default (off)
let headerFooterEnabled = false;

// API validation mode: false = fast (length), true = live call before each shorten
let USE_LIVE_API_VALIDATION = false;

// Batching config
const BATCH_SIZE = 25;        // recipients per batch
const BATCH_DELAY_MS = 1000;  // wait between batches

// Scheduled auto-ads check interval (1 minute)
const SCHEDULE_CHECK_INTERVAL_MS = 60 * 1000;

// Auto-backup interval (6 hours)
const AUTO_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// ---------------- DB UTILITIES ----------------
// DB schema:
// {
//   tokens: {chatId: apiKey},
//   lastActive: {chatId: timestamp},
//   admins: [idStr,...],
//   adsMessage: "text",
//   headerText: "...",
//   footerText: "...",
//   schedule: { enabled: bool, time: "HH:MM", timezone: "Asia/Kolkata" },
//   adStats: { totalDelivered: n, totalFailed: n, history: [ {id, type, content, delivered, failed, timestamp} ] },
//   premium: [chatIdStr,...]
// }

function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const db = JSON.parse(raw);
    db.tokens = db.tokens || {};
    db.lastActive = db.lastActive || {};
    db.admins = db.admins || [];
    db.adsMessage = db.adsMessage || "🔥 *SPECIAL OFFER!*  \nEarn More With SmallshortURL!  \nVisit 👉 https://smallshorturl.myvippanel.shop";
    db.headerText = db.headerText || "not available now";
    db.footerText = db.footerText || "not available now";
    db.schedule = db.schedule || { enabled: false, time: null, timezone: "Asia/Kolkata" };
    db.adStats = db.adStats || { totalDelivered: 0, totalFailed: 0, history: [] };
    db.premium = db.premium || []; // premium allowed user ids
    return db;
  } catch (e) {
    return {
      tokens: {},
      lastActive: {},
      admins: [],
      adsMessage: "🔥 *SPECIAL OFFER!*  \nEarn More With SmallshortURL!  \nVisit 👉 https://smallshorturl.myvippanel.shop",
      headerText: "not available now",
      footerText: "not available now",
      schedule: { enabled: false, time: null, timezone: "Asia/Kolkata" },
      adStats: { totalDelivered: 0, totalFailed: 0, history: [] },
      premium: [],
    };
  }
}
function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function backupDB() {
  try {
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const fname = path.join(BACKUP_DIR, `database-backup-${stamp}.json`);
    fs.copyFileSync(DB_PATH, fname);
    console.log("DB backup saved:", fname);
  } catch (e) {
    console.error("DB backup error:", e.message || e);
  }
}

// Ensure default admin present
(function ensureDefaultAdmin() {
  const db = readDB();
  const defaultIdStr = String(ALLOWED_ADMIN_ID);
  if (!db.admins.includes(defaultIdStr)) {
    db.admins.push(defaultIdStr);
    writeDB(db);
  }
})();

// ---------------- MARKDOWN HELPERS ----------------
function escapeMdV2(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/\\/g, "\\\\").replace(/_/g, "\\_").replace(/\*/g, "\\*")
    .replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)").replace(/~/g, "\\~").replace(/`/g, "\\`")
    .replace(/>/g, "\\>").replace(/#/g, "\\#").replace(/\+/g, "\\+")
    .replace(/-/g, "\\-").replace(/=/g, "\\=").replace(/\|/g, "\\|")
    .replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\./g, "\\.")
    .replace(/!/g, "\\!");
}
function mdCode(text) {
  const safe = String(text).replace(/`/g, "");
  return "`" + safe + "`";
}

// ---------------- LANGUAGE DETECTION (very basic) ----------------
// returns 'hi' for Hindi (Devanagari), 'ur' for Urdu (Arabic), else 'en'
function detectLang(text) {
  if (!text) return "en";
  // Devanagari Unicode range: \u0900-\u097F
  if (/[^\u0000-\u007F]*[\u0900-\u097F][^\u0000-\u007F]*/.test(text)) return "hi";
  // Arabic/Urdu range: \u0600-\u06FF
  if (/[^\u0000-\u007F]*[\u0600-\u06FF][^\u0000-\u007F]*/.test(text)) return "ur";
  return "en";
}
function t(msgKey, lang) {
  // Minimal translations for system messages used in bot
  const msgs = {
    start: {
      en: "👋 Hello! Send your Smallshorturl API Key from the Dashboard and then send any link to shorten it.",
      hi: "👋 नमस्ते! Dashboard से अपना Smallshorturl API Key भेजें, फिर कोई link भेजें और मैं उसे छोटा कर दूँगा।",
      ur: "👋 سلام! Dashboard سے اپنا Smallshorturl API Key بھیجیں، پھر کوئی لنک بھیجیں میں اسے مختصر کروں گا۔"
    },
    no_api: {
      en: "❌ Please set your *Smallshorturl API Key* first.\nUse: /api YOUR_API_KEY",
      hi: "❌ कृपया पहले अपना *Smallshorturl API Key* सेट करें।\nउपयोग: /api YOUR_API_KEY",
      ur: "❌ براہِ مہربانی پہلے اپنا *Smallshorturl API Key* سیٹ کریں۔\nاستعمال کریں: /api YOUR_API_KEY"
    },
    invalid_api: {
      en: "❌ Invalid API. Please send your API key.",
      hi: "❌ अमान्य API। कृपया अपना API key भेजें।",
      ur: "❌ غیر معتبر API۔ براہِ مہربانی اپنا API key بھیجیں۔"
    },
    shorten_none: {
      en: "⚠️ Could not shorten any of the links. Please check your API key or try again later.",
      hi: "⚠️ किसी भी लिंक को छोटा नहीं किया जा सका। कृपया अपना API key जांचें या बाद में कोशिश करें।",
      ur: "⚠️ کسی لنک کو مختصر نہیں کیا جا سکا۔ براہِ کرم اپنا API key چیک کریں یا بعد میں کوشش کریں۔"
    },
    ads_sent: {
      en: "📢 Ads sent to all users successfully!",
      hi: "📢 सभी उपयोगकर्ताओं को ads सफलतापूर्वक भेज दी गईं!",
      ur: "📢 تمام صارفین کو اشتہارات کامیابی سے بھیج دیے گئے!"
    }
  };
  return (msgs[msgKey] && msgs[msgKey][lang]) ? msgs[msgKey][lang] : msgs[msgKey].en;
}

// ---------------- EXTRACT LINKS ----------------
function extractLinks(text) {
  const re = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9.-]+\.[a-z]{2,})/gi;
  return [...text.matchAll(re)].map(m => m[0]);
}

// ---------------- API VALIDATION ----------------
async function validateApiBrief(token) {
  // fast check (length)
  return token && token.length >= 8;
}
async function validateApiLive(token) {
  if (!token) return false;
  try {
    const testUrl = `https://smallshorturl.myvippanel.shop/api?api=${encodeURIComponent(token)}&url=${encodeURIComponent("https://google.com")}`;
    const res = await axios.get(testUrl, { timeout: 15000 });
    return !!(res.data && (res.data.shortenedUrl || res.data.short));
  } catch (e) {
    return false;
  }
}
async function validateApiForShorten(token) {
  if (!USE_LIVE_API_VALIDATION) return validateApiBrief(token);
  return validateApiLive(token);
}

// ---------------- SHORTENING ----------------
async function shortenUrlWithToken(token, url) {
  try {
    const apiUrl = `https://smallshorturl.myvippanel.shop/api?api=${encodeURIComponent(token)}&url=${encodeURIComponent(url)}`;
    const res = await axios.get(apiUrl, { timeout: 15000 });
    const short = res.data && (res.data.shortenedUrl || res.data.short || res.data.url) ? (res.data.shortenedUrl || res.data.short || res.data.url) : null;
    return short;
  } catch (e) {
    return null;
  }
}

async function shortenMultipleAndRespond(chatId, links) {
  // check premium mode: if DB has premium non-empty, allow only those
  const db = readDB();
  if (db.premium && db.premium.length > 0 && !db.premium.includes(String(chatId))) {
    // send localized message
    const lang = detectLang("");
    return bot.sendMessage(chatId, "❌ You are not allowed to use this feature.", { parse_mode: "Markdown" });
  }

  const token = getUserToken(chatId);
  const userLang = detectLang(""); // default english for system messages
  if (!token) {
    return bot.sendMessage(chatId, t("no_api", userLang), { parse_mode: "Markdown" });
  }

  const ok = await validateApiForShorten(token);
  if (!ok) return bot.sendMessage(chatId, t("invalid_api", userLang), { parse_mode: "Markdown" });

  const pairs = [];
  for (const url of links) {
    const short = await shortenUrlWithToken(token, url);
    if (short) pairs.push({ original: url, short });
  }

  if (pairs.length === 0) {
    return bot.sendMessage(chatId, t("shorten_none", userLang), { parse_mode: "Markdown" });
  }

  // Build combined message in requested format
  let fullMsg = "";
  pairs.forEach((p, idx) => {
    const block =
`✨✨ Congratulations !  Your Url has been successfully shortened! 🚀 🔗

🔗**Original url:*  
${mdCode(p.original)}

🌐**Shortened Url:** 
${mdCode(p.short)}`;
    fullMsg += block;
    if (idx < pairs.length - 1) fullMsg += "\n\n";
  });
    
  // send
  await bot.sendMessage(chatId, fullMsg, { parse_mode: "MarkdownV2" });

  return pairs;
}

// ---------------- BATCH SENDER (for broadcasts) ----------------
async function sendInBatches(userIds, sendFn, batchSize = BATCH_SIZE, batchDelayMs = BATCH_DELAY_MS) {
  // userIds is array of chatId strings
  let delivered = 0;
  let failed = 0;
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    await Promise.all(batch.map(async (uid) => {
      try {
        await sendFn(uid);
        delivered++;
      } catch (e) {
        failed++;
        console.error("Batch send failed to", uid, e?.message || e);
      }
    }));
    await new Promise((res) => setTimeout(res, batchDelayMs));
  }
  return { delivered, failed };
}

// ---------------- AD STAT TRACKING ----------------
function recordAdStat(type, content, delivered, failed) {
  const db = readDB();
  db.adStats.totalDelivered = (db.adStats.totalDelivered || 0) + delivered;
  db.adStats.totalFailed = (db.adStats.totalFailed || 0) + failed;
  db.adStats.history = db.adStats.history || [];
  db.adStats.history.unshift({
    id: Date.now(),
    type,
    content,
    delivered,
    failed,
    timestamp: new Date().toISOString()
  });
  // keep history reasonable size
  if (db.adStats.history.length > 200) db.adStats.history = db.adStats.history.slice(0, 200);
  writeDB(db);
}

// ---------------- SCHEDULED AUTO-ADS ----------------
// schedule: db.schedule = { enabled: bool, time: "HH:MM", timezone: "Asia/Kolkata" }
// We'll check every minute, compare local time HH:MM in configured timezone.
// For simplicity we use server local time; if you host in India, set timezone accordingly.
// If you want exact timezone handling, we can add moment-timezone later.

let lastScheduleRunDate = null;

function startScheduleChecker() {
  setInterval(async () => {
    try {
      const db = readDB();
      if (!db.schedule || !db.schedule.enabled || !db.schedule.time) return;
      const now = new Date();
      // Extract HH:MM in server local time
      const HH = String(now.getHours()).padStart(2, "0");
      const MM = String(now.getMinutes()).padStart(2, "0");
      const current = `${HH}:${MM}`;
      if (current !== db.schedule.time) return;
      // Avoid double-run within same minute
      const today = now.toDateString();
      if (lastScheduleRunDate === today) return;
      lastScheduleRunDate = today;

      // Send ads using batching
      const users = getAllUsers();
      const sendFn = async (uid) => {
        // send default ads message from db
        const db2 = readDB();
        await bot.sendMessage(uid, db2.adsMessage, { parse_mode: "Markdown" });
      };
      const { delivered, failed } = await sendInBatches(users, sendFn);
      recordAdStat("auto-schedule", db.adsMessage || "", delivered, failed);
      console.log(`Auto-ads sent: delivered=${delivered} failed=${failed}`);
    } catch (e) {
      console.error("Schedule checker error:", e?.message || e);
    }
  }, SCHEDULE_CHECK_INTERVAL_MS);
}
startScheduleChecker();

// ---------------- AUTO BACKUP ----------------
setInterval(() => {
  try {
    backupDB();
  } catch (e) {
    console.error("Auto backup failed:", e);
  }
}, AUTO_BACKUP_INTERVAL_MS);

// ---------------- EXPRESS DASHBOARD (simple) ----------------
// Dashboard protected by token query param (admin password).
// Open: http://YOUR_SERVER:8080/dashboard?token=afiya1310
app.get("/dashboard", (req, res) => {
  const token = req.query.token;
  if (!token || token !== ADMIN_PASSWORD) {
    return res.status(403).send("Forbidden - provide ?token=ADMIN_PASSWORD");
  }
  const db = readDB();
  const users = Object.keys(db.lastActive || {}).length;
  const admins = (db.admins || []).join(", ");
  const ads = db.adsMessage || "(not set)";
  const header = db.headerText || "";
  const footer = db.footerText || "";
  const schedule = db.schedule || { enabled: false, time: null };
  const stats = db.adStats || { totalDelivered: 0, totalFailed: 0, history: [] };

  // Simple HTML dashboard
  res.send(`
    <html>
      <head><title>Bot Dashboard</title></head>
      <body style="font-family: Arial, sans-serif; line-height:1.6">
        <h2>Bot V14 Dashboard</h2>
        <p><strong>Users:</strong> ${users}</p>
        <p><strong>Admins:</strong> ${admins}</p>
        <p><strong>Header:</strong> ${escapeHtml(header)}</p>
        <p><strong>Footer:</strong> ${escapeHtml(footer)}</p>
        <p><strong>Ads:</strong> ${escapeHtml(ads)}</p>
        <p><strong>Schedule:</strong> ${schedule.enabled ? `Enabled @ ${schedule.time}` : "Disabled"}</p>
        <h3>Ad Stats</h3>
        <p>Total Delivered: ${stats.totalDelivered} | Total Failed: ${stats.totalFailed}</p>
        <h4>Recent Ads</h4>
        <ul>
          ${ (stats.history || []).slice(0,10).map(h => `<li>${escapeHtml(h.timestamp)} - ${escapeHtml(h.type)} - delivered:${h.delivered} failed:${h.failed}</li>`).join("") }
        </ul>
        <hr>
        <h3>Actions</h3>
        <form method="POST" action="/dashboard/sendad?token=${ADMIN_PASSWORD}">
          <textarea name="adtext" rows="4" cols="60" placeholder="Ad text (Markdown)"></textarea><br>
          <button type="submit">Send Ad Now</button>
        </form>
        <form method="POST" action="/dashboard/setads?token=${ADMIN_PASSWORD}">
          <textarea name="adtext" rows="4" cols="60" placeholder="Save default ad text"></textarea><br>
          <button type="submit">Save Default Ads</button>
        </form>
      </body>
    </html>
  `);
});
// Need body parsing for POST forms
app.use(express.urlencoded({ extended: true }));

// Helper escape
function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

app.post("/dashboard/sendad", async (req, res) => {
  const token = req.query.token;
  if (!token || token !== ADMIN_PASSWORD) return res.status(403).send("Forbidden");
  const text = req.body.adtext || "";
  if (!text) return res.send("No ad text provided.");
  const users = getAllUsers();
  const sendFn = async (uid) => bot.sendMessage(uid, text, { parse_mode: "Markdown" });
  const { delivered, failed } = await sendInBatches(users, sendFn);
  recordAdStat("dashboard-send", text, delivered, failed);
  res.send(`Ad sent. delivered: ${delivered}, failed: ${failed}`);
});

app.post("/dashboard/setads", (req, res) => {
  const token = req.query.token;
  if (!token || token !== ADMIN_PASSWORD) return res.status(403).send("Forbidden");
  const text = req.body.adtext || "";
  if (!text) return res.send("No text");
  const db = readDB();
  db.adsMessage = text;
  writeDB(db);
  res.send("Default ad saved.");
});

// ---------------- TELEGRAM COMMANDS & HANDLERS ----------------

// /start (localized)
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from.username || msg.from.first_name || "User";
  saveLastActive(chatId);
  const dashboardLink = "https://smallshorturl.myvippanel.shop/member/tools/api";
  const lang = detectLang(user);
  const startMsg = {
    en: `👋 Hello *${escapeMdV2(user)}*!\n\nSend your *Smallshorturl API Key* from *[Dashboard](${dashboardLink})* (send /api with your api)\n\nOnce your API key is set, just send any link — I will shorten it instantly 🔗🚀`,
    hi: `👋 नमस्ते *${escapeMdV2(user)}*!\n\nअपने *Smallshorturl API Key* को यहाँ से भेजें: ${dashboardLink} (उपयोग: /api YOUR_API)\n\nAPI सेट होने के बाद कोई भी लिंक भेजें — मैं उसे तुरंत छोटा कर दूँगा 🔗🚀`,
    ur: `👋 سلام *${escapeMdV2(user)}*!\n\nاپنا *Smallshorturl API Key* یہاں سے بھیجیں: ${dashboardLink} (استعمال: /api YOUR_API)\n\nAPI سیٹ ہونے کے بعد کوئی لنک بھیجیں — میں اسے فوری طور پر مختصر کروں گا 🔗🚀`
  };
  bot.sendMessage(chatId, startMsg[lang] || startMsg.en, { parse_mode: "MarkdownV2" }).catch(console.error);
});

// /api <key>
bot.onText(/\/api (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const token = (match && match[1]) ? match[1].trim() : null;
  saveLastActive(chatId);
  if (!token) return bot.sendMessage(chatId, "❌ Provide API: /api YOUR_API_KEY");
  try {
    // test call
    const ok = await validateApiLive(token);
    if (!ok) return bot.sendMessage(chatId, "❌ Invalid API. Please send your API key.", { parse_mode: "Markdown" });
    saveUserToken(chatId, token);
    bot.sendMessage(chatId, "✅ Your *Smallshorturl API Key* has been saved!", { parse_mode: "Markdown" });
  } catch {
    bot.sendMessage(chatId, "❌ Invalid API. Please send your API key.", { parse_mode: "Markdown" });
  }
});

// /admin <password> - strict rule
bot.onText(/\/admin (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const pass = (match && match[1]) ? match[1].trim() : "";
  // only allowed id may use /admin - others silent
  if (Number(chatId) !== Number(ALLOWED_ADMIN_ID)) return;
  if (pass !== ADMIN_PASSWORD) {
    bot.sendMessage(chatId, "❌ Incorrect password.");
    return;
  }
  addAdminToDB(chatId);
  bot.sendMessage(chatId, "✅ You are now an *Admin*! 🎉", { parse_mode: "Markdown" });
});

// /setautoschedule HH:MM  - admin only
bot.onText(/\/setautoschedule (\d{1,2}:\d{2})/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const time = match[1];
  const db = readDB();
  db.schedule = db.schedule || {};
  db.schedule.enabled = true;
  db.schedule.time = time.padStart(5, "0");
  writeDB(db);
  bot.sendMessage(chatId, `✅ Auto-ads scheduled daily at ${db.schedule.time}`);
});

// /disableautoschedule
bot.onText(/\/disableautoschedule/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const db = readDB();
  db.schedule = db.schedule || {};
  db.schedule.enabled = false;
  writeDB(db);
  bot.sendMessage(chatId, `✅ Auto-ads schedule disabled.`);
});

// /setads (single-line) already in V13; here we keep it
bot.onText(/\/setads (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const text = (match && match[1]) ? match[1].trim() : "";
  if (!text) return bot.sendMessage(chatId, "Usage: /setads <text>");
  const db = readDB();
  db.adsMessage = text;
  writeDB(db);
  bot.sendMessage(chatId, "✅ Default ads message saved.");
});

// /sendads now uses batching and ad-stats
bot.onText(/\/sendads/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  bot.sendMessage(chatId, "✏️ Send the advertisement text now (will be broadcast to all users).");

  const watcher = (m) => {
    if (!m.text || !m.from || m.from.id !== chatId) return;
    const adText = m.text;
    const users = getAllUsers();
    // send with batc
