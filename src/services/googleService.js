const { google } = require('googleapis');
const axios = require('axios');
const config = require('../config');

// In-Memory Cache & State Storage
let inMemoryContacts = new Map();
let inMemoryLogs = [];
let modePengamatMap = new Map();
let conversationHistoryMap = new Map();
let currentTelegramChatId = config.TELEGRAM_CHAT_ID_DOKTER || "";

function getAuthClient() {
  if (!config.GOOGLE_SERVICE_ACCOUNT_EMAIL || !config.GOOGLE_PRIVATE_KEY) {
    return null;
  }
  try {
    const auth = new google.auth.JWT(
      config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      config.GOOGLE_PRIVATE_KEY,
      ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/tasks']
    );
    return auth;
  } catch (err) {
    console.error("Google Auth Error:", err.message);
    return null;
  }
}

async function isNomorPengecualian(nomorKlien) {
  let cleanNo = (nomorKlien || "").toString().replace(/\D/g, "");
  if (cleanNo.startsWith("0")) cleanNo = "62" + cleanNo.substring(1);

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
          let noStr = (rows[i][1] || "").toString().replace(/\D/g, "");
          if (noStr.startsWith("0")) noStr = "62" + noStr.substring(1);
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
          let noStr = (rows[i][1] || "").toString().replace(/\D/g, "");
          if (noStr.startsWith("0")) noStr = "62" + noStr.substring(1);
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

async function bacaSOP(akun) {
  let auth = getAuthClient();
  if (auth) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      let sopText = "";

      if (akun === "nafila") {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: config.SPREADSHEET_ID,
          range: 'SOP_Klinik!A1:Z100',
        });
        sopText += "=== SOP OPERASIONAL KLINIK NAFILA MEDIKA ===\n" + parseRowsToSOPText(res.data.values);
      } else {
        // HANYA BACA SOP_DYLAN (SOP_Jadwal Diabaikan / Dihapus)
        try {
          const resDylan = await sheets.spreadsheets.values.get({
            spreadsheetId: config.SPREADSHEET_ID,
            range: 'SOP_Dylan!A1:Z100',
          });
          sopText += "=== SOP PEMIKIRAN & ATURAN DR. DYLAN ===\n" + parseRowsToSOPText(resDylan.data.values);
        } catch (e) {}
      }

      return sopText || "(Belum ada data SOP)";
    } catch (err) {
      console.error("Baca SOP Sheets API Error:", err.message);
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
  let cleanNo = (nomorWA || "").toString().replace(/\D/g, "");
  if (cleanNo.startsWith("0")) cleanNo = "62" + cleanNo.substring(1);

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
          let noStr = (rows[i][1] || "").toString().replace(/\D/g, "");
          if (noStr.startsWith("0")) noStr = "62" + noStr.substring(1);
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
          let noStr = (rows[i][1] || "").toString().replace(/\D/g, "");
          if (noStr.startsWith("0")) noStr = "62" + noStr.substring(1);
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
  let cleanNo = (nomorWA || "").toString().replace(/\D/g, "");
  if (cleanNo.startsWith("0")) cleanNo = "62" + cleanNo.substring(1);

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
    } catch (err) {
      console.error("Simpan Kontak Sheet Error:", err.message);
    }
  }
}

async function logPesanSheet(data, akun) {
  let nowStr = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  inMemoryLogs.push({ time: nowStr, from: data.from, to: data.to, message: data.message });
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
}

function setPengamatModeHariIni(nomorWA) {
  let cleanNo = (nomorWA || "").toString().replace(/\D/g, "");
  if (cleanNo.startsWith("0")) cleanNo = "62" + cleanNo.substring(1);
  
  let now = new Date();
  let endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  
  modePengamatMap.set(cleanNo, endOfDay.getTime());
}

function isModePengamat(nomorWA) {
  let cleanNo = (nomorWA || "").toString().replace(/\D/g, "");
  if (cleanNo.startsWith("0")) cleanNo = "62" + cleanNo.substring(1);
  
  if (!modePengamatMap.has(cleanNo)) return false;
  let expireTime = modePengamatMap.get(cleanNo);
  if (Date.now() > expireTime) {
    modePengamatMap.delete(cleanNo);
    return false;
  }
  return true;
}

function getRiwayatPercakapan(nomorWA) {
  let cleanNo = (nomorWA || "").toString().replace(/\D/g, "");
  if (cleanNo.startsWith("0")) cleanNo = "62" + cleanNo.substring(1);
  return conversationHistoryMap.get(cleanNo) || [];
}

function tambahRiwayatPercakapan(nomorWA, role, content) {
  let cleanNo = (nomorWA || "").toString().replace(/\D/g, "");
  if (cleanNo.startsWith("0")) cleanNo = "62" + cleanNo.substring(1);
  let list = conversationHistoryMap.get(cleanNo) || [];
  list.push({ role, content });
  if (list.length > 10) list = list.slice(-8);
  conversationHistoryMap.set(cleanNo, list);
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

module.exports = {
  isNomorPengecualian,
  bacaSOP,
  getDetailPetugasAtauKontak,
  simpanKontakSheet,
  logPesanSheet,
  setPengamatModeHariIni,
  isModePengamat,
  getRiwayatPercakapan,
  tambahRiwayatPercakapan,
  setTelegramChatId,
  getTelegramChatId
};
