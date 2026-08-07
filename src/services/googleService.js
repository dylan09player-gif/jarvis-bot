const { google } = require('googleapis');
const axios = require('axios');
const config = require('../config');

// In-Memory Cache & State Storage
let inMemoryContacts = new Map();
let inMemoryLogs = [];
let modePengamatMap = new Map();
let conversationHistoryMap = new Map();
let contactAccountTypeMap = new Map();
let currentTelegramChatId = config.TELEGRAM_CHAT_ID_DOKTER || "";

// FAST MEMORY CACHE UNTUK PERFORMANCE & KUOTA GOOGLE SHEETS
let cachedDashboardResult = null;
let lastDashboardCacheTime = 0;

let cachedSopMap = {
  dylan: { text: null, time: 0 },
  nafila: { text: null, time: 0 }
};

let cachedVIPMap = { list: null, time: 0 };
let cachedPetugasMap = { list: null, time: 0 };

// MASTER AI TOGGLE FOR 2 ACCOUNTS (DYLAN & NAFILA)
let masterAiStatusMap = {
  dylan: true,
  nafila: true
};

function getAuthClient() {
  if (!config.GOOGLE_SERVICE_ACCOUNT_EMAIL || !config.GOOGLE_PRIVATE_KEY) {
    return null;
  }
  try {
    const auth = new google.auth.JWT(
      config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      config.GOOGLE_PRIVATE_KEY,
      [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/tasks',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive'
      ]
    );
    return auth;
  } catch (err) {
    console.error("Google Auth Error:", err.message);
    return null;
  }
}

// MASTER AI TOGGLE CONTROL
function isMasterAiActive(account) {
  let key = (account || "dylan").toLowerCase();
  return masterAiStatusMap[key] !== false;
}

function setMasterAiStatus(account, status) {
  let key = (account || "dylan").toLowerCase();
  masterAiStatusMap[key] = Boolean(status);
  
  let auth = getAuthClient();
  if (auth) {
    let range = key === "nafila" ? "Pengaturan!B3" : "Pengaturan!B2";
    let valStr = status ? "ON" : "OFF";
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      sheets.spreadsheets.values.update({
        spreadsheetId: config.SPREADSHEET_ID,
        range: range,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[valStr]] }
      }).catch(e => {});
    } catch (e) {}
  }
  invalidateCache();
  return masterAiStatusMap;
}

function getMasterAiStatuses() {
  return { ...masterAiStatusMap };
}

function invalidateCache() {
  cachedDashboardResult = null;
  lastDashboardCacheTime = 0;
  cachedSopMap.dylan.text = null;
  cachedSopMap.nafila.text = null;
  cachedVIPMap.list = null;
  cachedPetugasMap.list = null;
}

// ================= PERTAHANKAN RIWAYAT CHAT 24 JAM & AUTO PURGE =================
function cleanNumberFormat(nomorWA) {
  let cleanNo = (nomorWA || "").toString().replace(/\D/g, "");
  if (cleanNo.startsWith("0")) cleanNo = "62" + cleanNo.substring(1);
  return cleanNo;
}

function getRiwayatPercakapan(nomorWA) {
  let cleanNo = cleanNumberFormat(nomorWA);
  let list = conversationHistoryMap.get(cleanNo) || [];
  
  // PURGE ATURAN 1 x 24 JAM: Hapus pesan yang sudah lebih tua dari 24 jam (86.400.000 ms)
  let limit24Jam = Date.now() - (24 * 60 * 60 * 1000);
  let validList = list.filter(msg => {
    return !msg.timestamp || msg.timestamp >= limit24Jam;
  });

  if (validList.length !== list.length) {
    conversationHistoryMap.set(cleanNo, validList);
  }
  return validList;
}

function tambahRiwayatPercakapan(nomorWA, role, content) {
  let cleanNo = cleanNumberFormat(nomorWA);
  let list = getRiwayatPercakapan(cleanNo);
  
  let timeStr = new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
  let newMsg = {
    role: role,
    content: content,
    time: timeStr,
    timestamp: Date.now()
  };

  list.push(newMsg);
  
  if (list.length > 30) list = list.slice(-30);
  
  conversationHistoryMap.set(cleanNo, list);
  invalidateCache();
}

// ================= GOOGLE DRIVE BACKUP SERVICE =================
async function backupDataKeGoogleDrive() {
  let auth = getAuthClient();
  if (!auth) return { status: "ERROR", message: "Google Auth belum terkonfigurasi" };

  try {
    const drive = google.drive({ version: 'v3', auth });
    let nowStr = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }).replace(/[/:]/g, '-');
    let fileName = `Jarvis_Backup_Logs_SOP_${nowStr}.txt`;

    let dataSOPDylan = await bacaSOP("dylan");
    let dataSOPKlinik = await bacaSOP("nafila");
    
    let contentText = `=== BACKUP LENGKAP JARVIS BOT SYSTEM ===\nWaktu Backup: ${nowStr}\n\n`;
    contentText += `=== LOG PESAN TERAKHIR ===\n` + JSON.stringify(inMemoryLogs, null, 2) + `\n\n`;
    contentText += `=== DATA SOP DR. DYLAN ===\n${dataSOPDylan}\n\n`;
    contentText += `=== DATA SOP KLINIK ===\n${dataSOPKlinik}\n\n`;

    const fileMetadata = {
      name: fileName,
      mimeType: 'text/plain'
    };
    const media = {
      mimeType: 'text/plain',
      body: contentText
    };

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink'
    });

    console.log("Backup Google Drive Berhasil:", file.data.id);
    return { status: "OK", fileId: file.data.id, link: file.data.webViewLink, fileName };
  } catch (err) {
    console.error("Google Drive Backup Error:", err.message);
    return { status: "ERROR", message: err.message };
  }
}

// ================= MANAJEMEN KELOLA KONTAK (3 TAB SPREADSHEET) =================
async function getContactsBySheet(sheetName = "Kontak_Dylan") {
  let auth = getAuthClient();
  if (!auth) return [];

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    let range = `${sheetName}!A1:Z100`;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.SPREADSHEET_ID,
      range: range,
    });
    let rows = res.data.values || [];
    let list = [];

    for (let i = 1; i < rows.length; i++) {
      let r = rows[i];
      if (!r || r.length === 0) continue;

      if (sheetName === "Pengecualian") {
        let nama = r[0] || "VIP";
        let noWA = r[1] || "";
        if (noWA) list.push({ rowIndex: i + 1, nama, noWA, info: "AI Off 100%" });
      } else if (sheetName === "Petugas") {
        let nama = r[0] || "Petugas";
        let noWA = r[1] || "";
        let jabatan = r[2] || "Petugas RS";
        if (noWA) list.push({ rowIndex: i + 1, nama, noWA, info: jabatan });
      } else {
        // Kontak_Dylan
        let tgl = r[0] || "";
        let noWA = r[1] || "";
        let nama = r[2] || "Kontak";
        let kategori = r[3] || "Klien";
        let status = r[4] || "Aktif";
        if (noWA) list.push({ rowIndex: i + 1, nama, noWA, info: kategori, status, tgl });
      }
    }
    return list;
  } catch (e) {
    console.error("Get Contacts By Sheet Error:", e.message);
    return [];
  }
}

async function tambahKontakBaruSheet(sheetName, noWA, nama, info) {
  let cleanNo = cleanNumberFormat(noWA);
  let nowStr = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

  let auth = getAuthClient();
  if (auth) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      let rowValues = [];

      if (sheetName === "Pengecualian") {
        rowValues = [[nama, cleanNo]];
      } else if (sheetName === "Petugas") {
        rowValues = [[nama, cleanNo, info || "Petugas"]];
      } else {
        rowValues = [[nowStr, cleanNo, nama, info || "Kontak Terdaftar", "Aktif"]];
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId: config.SPREADSHEET_ID,
        range: `${sheetName}!A:E`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: rowValues }
      });
      invalidateCache();
      return true;
    } catch (e) {
      console.error("Tambah Kontak Sheet Error:", e.message);
    }
  }
  return false;
}

async function hapusKontakSheet(sheetName, rowIndex) {
  let auth = getAuthClient();
  let targetIndex = parseInt(rowIndex);
  if (auth && targetIndex > 1) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });

      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: config.SPREADSHEET_ID
      });

      let sheetObj = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
      let sheetId = sheetObj ? sheetObj.properties.sheetId : 0;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.SPREADSHEET_ID,
        resource: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: sheetId,
                  dimension: "ROWS",
                  startIndex: targetIndex - 1,
                  endIndex: targetIndex
                }
              }
            }
          ]
        }
      });

      invalidateCache();
      return true;
    } catch (e) {
      console.error("Hapus Kontak Sheet Error:", e.message);
      try {
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.clear({
          spreadsheetId: config.SPREADSHEET_ID,
          range: `${sheetName}!A${targetIndex}:Z${targetIndex}`
        });
        invalidateCache();
        return true;
      } catch (errClear) {}
    }
  }
  return false;
}

// ================= GOOGLE CALENDAR & TASKS INTEGRATION =================
async function bacaGoogleCalendar() {
  try {
    let icalUrl = "https://calendar.google.com/calendar/ical/dylan09player%40gmail.com/private-163ac99848f72f91dfca8e4f03a489e1/basic.ics";
    let res = await axios.get(icalUrl, { timeout: 8000 });
    let icalText = res.data;

    let events = parseICalText(icalText);
    if (events.length > 0) {
      let text = "=== AGENDA GOOGLE CALENDAR DR. DYLAN (AKSES TERHUBUNG) ===\n";
      events.slice(0, 10).forEach(e => {
        text += `📅 ${e.timeStr}: ${e.summary}\n`;
      });
      return text;
    }
  } catch (errICal) {
    console.error("iCal fetch error:", errICal.message);
  }

  let auth = getAuthClient();
  if (auth) {
    try {
      const calendar = google.calendar({ version: 'v3', auth });
      let now = new Date();
      let nextWeek = new Date();
      nextWeek.setDate(now.getDate() + 7);

      const res = await calendar.events.list({
        calendarId: 'dylan09player@gmail.com',
        timeMin: now.toISOString(),
        timeMax: nextWeek.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      let events = res.data.items || [];
      if (events.length > 0) {
        let text = "=== AGENDA GOOGLE CALENDAR DR. DYLAN MINGGU INI ===\n";
        events.forEach(e => {
          let start = e.start.dateTime || e.start.date;
          let summary = e.summary || "Agenda Tanpa Judul";
          text += `📅 ${new Date(start).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}: ${summary}\n`;
        });
        return text;
      }
    } catch (e) {}
  }

  return "Tidak ada agenda mendatang terdaftar di Google Calendar dr. Dylan minggu ini.";
}

function parseICalText(icalData) {
  let events = [];
  let vevents = icalData.split("BEGIN:VEVENT");
  let now = new Date();
  
  for (let i = 1; i < vevents.length; i++) {
    let block = vevents[i].split("END:VEVENT")[0];
    
    let summaryMatch = block.match(/SUMMARY:(.*)/);
    let dtstartMatch = block.match(/DTSTART.*:(\d{8}(?:T\d{6}Z?)?)/);
    
    if (summaryMatch && dtstartMatch) {
      let summary = summaryMatch[1].trim();
      let dtStr = dtstartMatch[1].trim();
      
      let year = parseInt(dtStr.substring(0, 4));
      let month = parseInt(dtStr.substring(4, 6)) - 1;
      let day = parseInt(dtStr.substring(6, 8));
      let hour = dtStr.includes("T") ? parseInt(dtStr.substring(9, 11)) : 0;
      let min = dtStr.includes("T") ? parseInt(dtStr.substring(11, 13)) : 0;

      let dateObj = dtStr.endsWith("Z") ? new Date(Date.UTC(year, month, day, hour, min)) : new Date(year, month, day, hour, min);
      
      if (dateObj >= new Date(now.getTime() - 24 * 3600 * 1000)) {
        let timeStr = dateObj.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });
        events.push({ dateObj, timeStr, summary });
      }
    }
  }

  events.sort((a, b) => a.dateObj - b.dateObj);
  return events;
}

async function bacaGoogleTasks() {
  let auth = getAuthClient();
  if (!auth) return "Google Tasks belum terhubung.";

  try {
    const tasks = google.tasks({ version: 'v1', auth });
    const res = await tasks.tasks.list({
      tasklist: '@default',
      showCompleted: false
    });

    let items = res.data.items || [];
    if (items.length === 0) return "Tidak ada catatan tugas aktif di Google Tasks.";

    let text = "=== CATATAN TUGAS GOOGLE TASKS ===\n";
    items.forEach(t => {
      text += `📌 ${t.title}` + (t.notes ? ` (${t.notes})` : '') + "\n";
    });
    return text;
  } catch (err) {
    console.error("Baca Tasks Error:", err.message);
    return "Google Tasks: (Belum ada tugas terdaftar)";
  }
}

async function tambahSOPBaru(pemicu, polaPikir, contohBalasan, akun = "dylan") {
  let sheetTarget = (akun === "nafila") ? 'SOP_Klinik!A:C' : 'SOP_Dylan!A:C';
  let auth = getAuthClient();
  if (auth) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      await sheets.spreadsheets.values.append({
        spreadsheetId: config.SPREADSHEET_ID,
        range: sheetTarget,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[pemicu, polaPikir, contohBalasan]]
        }
      });
      invalidateCache();
      return true;
    } catch (e) {
      console.error("Tambah SOP Error:", e.message);
    }
  }
  return false;
}

async function bacaSOPList(akun) {
  let auth = getAuthClient();
  let sheetTarget = (akun === "nafila") ? 'SOP_Klinik!A1:Z100' : 'SOP_Dylan!A1:Z100';
  
  if (auth) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: config.SPREADSHEET_ID,
        range: sheetTarget,
      });
      let rows = res.data.values || [];
      let list = [];
      for (let i = 1; i < rows.length; i++) {
        let pemicu = rows[i][0] || "";
        let polaPikir = rows[i][1] || "";
        let contoh = rows[i][2] || "";
        if (pemicu || polaPikir) {
          list.push({ rowIndex: i + 1, pemicu, polaPikir, contoh });
        }
      }
      return list;
    } catch (e) {}
  }
  return [];
}

async function hapusSOPItem(akun, rowIndex) {
  let auth = getAuthClient();
  let targetSheetName = (akun === "nafila") ? 'SOP_Klinik' : 'SOP_Dylan';
  let targetIndex = parseInt(rowIndex);

  if (auth && targetIndex > 1) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });

      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: config.SPREADSHEET_ID
      });

      let sheetObj = spreadsheet.data.sheets.find(s => s.properties.title === targetSheetName);
      let sheetId = sheetObj ? sheetObj.properties.sheetId : 0;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.SPREADSHEET_ID,
        resource: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: sheetId,
                  dimension: "ROWS",
                  startIndex: targetIndex - 1,
                  endIndex: targetIndex
                }
              }
            }
          ]
        }
      });

      invalidateCache();
      return true;
    } catch (e) {
      console.error("Hapus SOP BatchUpdate Error:", e.message);
      try {
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.clear({
          spreadsheetId: config.SPREADSHEET_ID,
          range: `${targetSheetName}!A${targetIndex}:Z${targetIndex}`
        });
        invalidateCache();
        return true;
      } catch (errClear) {}
    }
  }
  return false;
}

// ================= GOOGLE SHEETS & CONTACTS =================
async function isNomorPengecualian(nomorKlien) {
  let cleanNo = cleanNumberFormat(nomorKlien);

  if (inMemoryContacts.has(cleanNo)) {
    let c = inMemoryContacts.get(cleanNo);
    let kat = (c.kategori || "").toLowerCase();
    if (kat.includes("keluarga") || kat.includes("vip") || kat.includes("mamah") || kat.includes("istri") || kat.includes("anak") || kat.includes("ibu") || kat.includes("off")) {
      return true;
    }
  }

  let auth = getAuthClient();
  if (auth) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      try {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: config.SPREADSHEET_ID,
          range: 'Pengecualian!A1:B100',
        });
        let rows = res.data.values || [];
        for (let i = 1; i < rows.length; i++) {
          let noStr = cleanNumberFormat(rows[i][1] || "");
          if (noStr === cleanNo) return true;
        }
      } catch (e) {}

      try {
        const resK = await sheets.spreadsheets.values.get({
          spreadsheetId: config.SPREADSHEET_ID,
          range: 'Kontak_Dylan!A1:E100',
        });
        let rows = resK.data.values || [];
        for (let i = 1; i < rows.length; i++) {
          let noStr = cleanNumberFormat(rows[i][1] || "");
          if (noStr === cleanNo) {
            let kat = (rows[i][3] || "").toLowerCase();
            let status = (rows[i][4] || "").toLowerCase();
            if (kat.includes("keluarga") || kat.includes("vip") || kat.includes("mamah") || kat.includes("istri") || kat.includes("anak") || kat.includes("ibu") || status.includes("off") || status.includes("nonaktif")) {
              return true;
            }
          }
        }
      } catch (e) {}
    } catch (e) {}
  }
  return false;
}

// BACA SOP TER-CACHE (5 MENIT CACHE UNTUK MENGHINDARI 429 QUOTA EXCEEDED)
async function bacaSOP(akun) {
  let key = (akun === "nafila") ? "nafila" : "dylan";
  let now = Date.now();

  if (cachedSopMap[key].text && (now - cachedSopMap[key].time < 300000)) {
    return cachedSopMap[key].text;
  }

  let auth = getAuthClient();
  if (auth) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      let sopText = "";

      if (key === "nafila") {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: config.SPREADSHEET_ID,
          range: 'SOP_Klinik!A1:Z100',
        });
        sopText += "=== SOP OPERASIONAL KLINIK NAFILA MEDIKA ===\n" + parseRowsToSOPText(res.data.values);
      } else {
        const resDylan = await sheets.spreadsheets.values.get({
          spreadsheetId: config.SPREADSHEET_ID,
          range: 'SOP_Dylan!A1:Z100',
        });
        sopText += "=== SOP PEMIKIRAN & ATURAN DR. DYLAN ===\n" + parseRowsToSOPText(resDylan.data.values);
      }

      let finalText = sopText || "(Belum ada data SOP)";
      cachedSopMap[key] = { text: finalText, time: now };
      return finalText;
    } catch (err) {
      console.error("Baca SOP Sheets API Error:", err.message);
      if (cachedSopMap[key].text) return cachedSopMap[key].text;
    }
  }

  return "=== SOP STANDAR DR. DYLAN & KLINIK NAFILA MEDIKA ===\n- Pasien konsul rawat inap: kumpulkan SBAR dan laporkan ke dr. Dylan.\n- Pertanyaan umum Klinik Nafila: arahkan ke WA Klinik 081398169819.";
}

function parseRowsToSOPText(rows) {
  if (!rows || rows.length <= 1) return "";
  let text = "";
  for (let i = 1; i < rows.length; i++) {
    let line = rows[i].filter(cell => cell && cell.toString().trim() !== "").join(" | ");
    if (line) text += "- " + line + "\n";
  }
  return text;
}

async function getDetailPetugasAtauKontak(nomorWA) {
  let cleanNo = cleanNumberFormat(nomorWA);

  if (inMemoryContacts.has(cleanNo)) {
    let c = inMemoryContacts.get(cleanNo);
    return { isKnown: true, isPetugas: false, nama: c.nama, jabatan: c.kategori };
  }

  let auth = getAuthClient();
  if (auth) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      try {
        const resPetugas = await sheets.spreadsheets.values.get({
          spreadsheetId: config.SPREADSHEET_ID,
          range: 'Petugas!A1:C100',
        });
        let rows = resPetugas.data.values || [];
        for (let i = 1; i < rows.length; i++) {
          let noStr = cleanNumberFormat(rows[i][1] || "");
          if (noStr === cleanNo) {
            return { isKnown: true, isPetugas: true, nama: rows[i][0] || "Petugas", jabatan: rows[i][2] || "Petugas" };
          }
        }
      } catch (e) {}

      try {
        const resKontak = await sheets.spreadsheets.values.get({
          spreadsheetId: config.SPREADSHEET_ID,
          range: 'Kontak_Dylan!A1:D100',
        });
        let rows = resKontak.data.values || [];
        for (let i = 1; i < rows.length; i++) {
          let noStr = cleanNumberFormat(rows[i][1] || "");
          if (noStr === cleanNo) {
            return { isKnown: true, isPetugas: false, nama: rows[i][2] || "Kontak Terdaftar", jabatan: rows[i][3] || "Klien" };
          }
        }
      } catch (e) {}
    } catch (err) {
      console.error("Get Detail Kontak Error:", err.message);
    }
  }

  return { isKnown: false, isPetugas: false, nama: "", jabatan: "" };
}

async function simpanKontakSheet(nomorWA, nama, kategori) {
  let cleanNo = cleanNumberFormat(nomorWA);

  inMemoryContacts.set(cleanNo, { nama, kategori, time: new Date() });

  let auth = getAuthClient();
  if (auth) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      let nowStr = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      
      await sheets.spreadsheets.values.append({
        spreadsheetId: config.SPREADSHEET_ID,
        range: 'Kontak_Dylan!A:E',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[nowStr, cleanNo, nama, kategori, "Aktif"]]
        }
      });
      invalidateCache();
    } catch (err) {
      console.error("Simpan Kontak Sheet Error:", err.message);
    }
  }
}

function setContactAccountType(nomorWA, accountType) {
  let cleanNo = cleanNumberFormat(nomorWA);
  contactAccountTypeMap.set(cleanNo, accountType);
}

function getContactAccountType(nomorWA) {
  let cleanNo = cleanNumberFormat(nomorWA);
  return contactAccountTypeMap.get(cleanNo) || "dylan";
}

async function logPesanSheet(data, akun) {
  let nowStr = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  let cleanFrom = cleanNumberFormat(data.from || "");

  setContactAccountType(cleanFrom, akun);

  inMemoryLogs.push({ time: nowStr, from: cleanFrom, to: data.to, message: data.message });
  if (inMemoryLogs.length > 50) inMemoryLogs.shift();

  let auth = getAuthClient();
  if (auth) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      let sheetName = (akun === "nafila") ? "Log_Klinik" : "Log_Dylan";
      await sheets.spreadsheets.values.append({
        spreadsheetId: config.SPREADSHEET_ID,
        range: `${sheetName}!A:D`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[nowStr, data.from || "", data.to || "", data.message || "(media)"]]
        }
      });
    } catch (err) {}
  }
  invalidateCache();
}

function setPengamatMode24Jam(nomorWA) {
  let cleanNo = cleanNumberFormat(nomorWA);
  
  let expireTime = Date.now() + (24 * 60 * 60 * 1000);
  modePengamatMap.set(cleanNo, expireTime);
  invalidateCache();
}

function unsetPengamatMode(nomorWA) {
  let cleanNo = cleanNumberFormat(nomorWA);
  modePengamatMap.delete(cleanNo);
  invalidateCache();
}

function isModePengamat(nomorWA) {
  let cleanNo = cleanNumberFormat(nomorWA);
  
  if (!modePengamatMap.has(cleanNo)) return false;
  let expireTime = modePengamatMap.get(cleanNo);
  if (Date.now() > expireTime) {
    modePengamatMap.delete(cleanNo);
    return false;
  }
  return true;
}

function getPengamatExpireTime(nomorWA) {
  let cleanNo = cleanNumberFormat(nomorWA);
  return modePengamatMap.get(cleanNo) || null;
}

async function setTelegramChatId(chatId) {
  if (!chatId) return;
  currentTelegramChatId = chatId.toString();

  let auth = getAuthClient();
  if (auth) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.SPREADSHEET_ID,
        range: 'Pengaturan!B4',
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[chatId.toString()]] }
      });
    } catch (e) {}
  }
}

async function getTelegramChatId() {
  if (currentTelegramChatId) return currentTelegramChatId;
  if (config.TELEGRAM_CHAT_ID_DOKTER) return config.TELEGRAM_CHAT_ID_DOKTER;

  let auth = getAuthClient();
  if (auth) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: config.SPREADSHEET_ID,
        range: 'Pengaturan!B4',
      });
      if (res.data.values && res.data.values[0] && res.data.values[0][0]) {
        currentTelegramChatId = res.data.values[0][0].toString();
        return currentTelegramChatId;
      }
    } catch (e) {}
  }
  return currentTelegramChatId;
}

// HELPER MULTI-CHAT DASHBOARD (PERSISTENT 24-HOUR RETENTION & AUTO PURGE)
async function getDashboardData() {
  let now = Date.now();
  if (cachedDashboardResult && (now - lastDashboardCacheTime < 1500)) {
    return cachedDashboardResult;
  }

  let contactsList = [];
  let threadsMap = {};

  let jarvisHistory = getRiwayatPercakapan("JARVIS_AI_ASSISTANT");
  if (jarvisHistory.length === 0) {
    tambahRiwayatPercakapan("JARVIS_AI_ASSISTANT", "assistant", "Halo Dokter Dylan! 🤖 Saya Jarvis siap berdiskusi, mencatat SOP baru, membaca Google Calendar & Tasks, serta merangkum agenda Dokter.");
    jarvisHistory = getRiwayatPercakapan("JARVIS_AI_ASSISTANT");
  }

  contactsList.push({
    number: "JARVIS_AI_ASSISTANT",
    name: "🤖 Jarvis Assistant",
    category: "Diskusi, SOP, Calendar & Tasks",
    accountType: "internal",
    isKnown: true,
    isPaused: false,
    pauseExpire: null,
    lastMsg: jarvisHistory.length > 0 ? jarvisHistory[jarvisHistory.length - 1].content : "Diskusi & SOP",
    lastTime: jarvisHistory.length > 0 ? jarvisHistory[jarvisHistory.length - 1].time : ""
  });
  threadsMap["JARVIS_AI_ASSISTANT"] = jarvisHistory;

  for (let [number, rawHistory] of conversationHistoryMap.entries()) {
    if (number === "JARVIS_AI_ASSISTANT") continue;

    let history = getRiwayatPercakapan(number);
    if (!history || history.length === 0) continue;

    let info = await getDetailPetugasAtauKontak(number);
    let paused = isModePengamat(number);
    let expire = getPengamatExpireTime(number);
    let accType = getContactAccountType(number);
    
    let lastMsg = history[history.length - 1].content || "";
    let lastTime = history[history.length - 1].time || "";

    contactsList.push({
      number,
      name: info.isKnown ? info.nama : number,
      category: info.isKnown ? info.jabatan : "Nomor Baru",
      accountType: accType,
      isKnown: info.isKnown,
      isPaused: paused,
      pauseExpire: expire,
      lastMsg,
      lastTime
    });

    threadsMap[number] = history;
  }

  let result = {
    contacts: contactsList,
    threads: threadsMap,
    masterAiStatus: getMasterAiStatuses(),
    recentLogs: inMemoryLogs.slice(-20)
  };

  cachedDashboardResult = result;
  lastDashboardCacheTime = Date.now();
  return result;
}

module.exports = {
  isMasterAiActive,
  setMasterAiStatus,
  getMasterAiStatuses,
  backupDataKeGoogleDrive,
  getContactsBySheet,
  tambahKontakBaruSheet,
  hapusKontakSheet,
  bacaGoogleCalendar,
  bacaGoogleTasks,
  tambahSOPBaru,
  bacaSOPList,
  hapusSOPItem,
  isNomorPengecualian,
  bacaSOP,
  getDetailPetugasAtauKontak,
  simpanKontakSheet,
  logPesanSheet,
  setContactAccountType,
  getContactAccountType,
  setPengamatMode24Jam,
  unsetPengamatMode,
  isModePengamat,
  getPengamatExpireTime,
  getRiwayatPercakapan,
  tambahRiwayatPercakapan,
  setTelegramChatId,
  getTelegramChatId,
  getDashboardData
};
