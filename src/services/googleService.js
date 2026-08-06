const { google } = require('googleapis');
const axios = require('axios');
const config = require('../config');

// In-Memory Cache & State Storage
let inMemoryContacts = new Map();
let inMemoryLogs = [];
let modePengamatMap = new Map();
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
        try {
          const resJadwal = await sheets.spreadsheets.values.get({
            spreadsheetId: config.SPREADSHEET_ID,
            range: 'SOP_Jadwal!A1:Z100',
          });
          sopText += "=== TABEL 1: SOP PENJADWALAN & ASISTEN PRIBADI ===\n" + parseRowsToSOPText(resJadwal.data.values) + "\n\n";
        } catch (e) {}

        try {
          const resDylan = await sheets.spreadsheets.values.get({
            spreadsheetId: config.SPREADSHEET_ID,
            range: 'SOP_Dylan!A1:Z100',
          });
          sopText += "=== TABEL 2: SOP PEMIKIRAN & KONSUL DOKTER DYLAN ===\n" + parseRowsToSOPText(resDylan.data.values);
        } catch (e) {}
      }

      return sopText || "(Belum ada data SOP)";
    } catch (err) {
      console.error("Baca SOP Sheets API Error:", err.message);
    }
  }

  // Fallback membaca CSV publik / default SOP
  return "=== SOP STANDAR DR. DYLAN & KLINIK NAFILA MEDIKA ===\n- Pasien konsul rawat inap: kumpulkan SBAR dan laporkan ke dr. Dylan.\n- Jadwal bimbingan tesis: hari Senin & Rabu malam.\n- Pertanyaan umum Klinik Nafila: arahkan ke WA Klinik 081398169819.";
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

  // 1. Check in-memory saved contacts
  if (inMemoryContacts.has(cleanNo)) {
    let c = inMemoryContacts.get(cleanNo);
    return { isKnown: true, isPetugas: false, nama: c.nama, jabatan: c.kategori };
  }

  // 2. Check Google Sheets via Service Account
  let auth = getAuthClient();
  if (auth) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      // Cek Sheet Petugas
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

      // Cek Sheet Kontak_Dylan
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
      console.log(`Kontak ${nama} (${cleanNo}) berhasil disimpan ke Google Sheets!`);
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

function setTelegramChatId(chatId) {
  currentTelegramChatId = chatId.toString();
}

function getTelegramChatId() {
  return currentTelegramChatId || config.TELEGRAM_CHAT_ID_DOKTER;
}

module.exports = {
  bacaSOP,
  getDetailPetugasAtauKontak,
  simpanKontakSheet,
  logPesanSheet,
  setPengamatModeHariIni,
  isModePengamat,
  setTelegramChatId,
  getTelegramChatId
};
