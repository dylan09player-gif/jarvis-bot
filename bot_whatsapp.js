// ============================================================
// FUNGSI 1-KLIK SETUP & PERBARUI SELURUH TAB GOOGLE SHEET
// ============================================================
function setupSheetsKomplit() {
  let ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 1. Tab Pengaturan (Aktifkan Centang Bot)
  let sheetPengaturan = ss.getSheetByName("Pengaturan") || ss.insertSheet("Pengaturan");
  if (sheetPengaturan.getLastRow() === 0) {
    sheetPengaturan.appendRow(["Akun Bot WA", "Status (ON/OFF)", "Nomor WA", "Keterangan"]);
    sheetPengaturan.appendRow(["Bot CS Klinik Nafila", true, "81398169819", "Centang TRUE untuk AKTIFKAN Bot Klinik"]);
    sheetPengaturan.appendRow(["Bot Asisten dr. Dylan", true, "6281291868456", "Centang TRUE untuk AKTIFKAN Bot dr. Dylan"]);
  } else {
    sheetPengaturan.getRange("B2").setValue(true);
    sheetPengaturan.getRange("B3").setValue(true);
  }

  // 2. Tab Kontak_Dylan
  let sheetKontak = ss.getSheetByName("Kontak_Dylan") || ss.insertSheet("Kontak_Dylan");
  if (sheetKontak.getLastRow() === 0) {
    sheetKontak.appendRow(["Tanggal Didaftarkan", "Nomor WA", "Nama Kontak", "Kategori / Status", "Status AI"]);
    sheetKontak.appendRow([Utilities.formatDate(new Date(), "Asia/Jakarta", "dd/MM/yyyy HH:mm"), NOMOR_DOKTER, "dr. Dylan", "Owner / Dokter", "Off"]);
  }

  // 3. Tab Pengecualian
  let sheetPengecualian = ss.getSheetByName("Pengecualian") || ss.insertSheet("Pengecualian");
  if (sheetPengecualian.getLastRow() === 0) {
    sheetPengecualian.appendRow(["Nama Kontak", "Nomor WA", "Keterangan / Hubungan", "Status Bot"]);
    sheetPengecualian.appendRow(["Mamah", "08123456789", "Keluarga / Ibu", "Off (Bebas AI 100%)"]);
  }

  // 4. Tab SOP_Dylan (Ubah ke 3 Kolom Sederhana Pemikiran Dokter)
  let sheetDylan = ss.getSheetByName("SOP_Dylan");
  if (sheetDylan) {
    sheetDylan.getRange("A1:C1").setValues([["Pemicu / Pertanyaan Chat", "Pola Pikir & Aturan Balas Saya", "Contoh Kalimat Balasan Saya"]]);
  }

  Logger.log("✅ SUKSES: Semua Tab Google Sheet telah diperbarui & dirapikan 100%!");
}

// ===================== KONFIGURASI ==========================
const DEEPSEEK_API_KEY     = "your_deepseek_api_key_here";
const GEMINI_API_KEY       = "your_gemini_api_key_here";
const TELEGRAM_BOT_TOKEN   = "your_telegram_bot_token_here";

const WA_DYLAN             = "19196c01c4263f86a1dd678b472ac597";   // WhaCenter dr Dylan
const WA_NAFILA            = "83f3428d66d811ef2f2d78e289bae57c";   // WhaCenter Klinik Nafila
const SPREADSHEET_ID       = "1FkuO3Ix04dFWriI3Q-65HZQjUMOiPwgjmrpQKobO9q4";
const NOMOR_DOKTER         = "6281291868456";
const NOMOR_KLINIK         = "081398169819";
const NOMOR_KLINIK_WA_LINK = "https://wa.me/6281398169819";
const NOMOR_CASMIX_MAK_SRI = "6282216368421";
const INSTAGRAM_NAFILA     = "https://www.instagram.com/nafilamedika";
const JAM_KONSUL_MULAI     = 9;
const JAM_KONSUL_AKHIR     = 17;
const DURASI_KONSUL        = 60;


// ============================================================
// 1. FUNGSI UTAMA (WEBHOOK RECEIVER UNTUK WHATSAPP & TELEGRAM)
// ============================================================
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return respon("No data");
    let data = JSON.parse(e.postData.contents);

    // A. JIKA PESAN DARI TELEGRAM
    if (data.update_id || data.message || data.callback_query) {
      return prosesWebhookTelegram(data);
    }

    // B. JIKA PESAN DARI WHATSAPP (WHACENTER)
    let pengirim   = data.from    || "";
    let penerima   = data.to      || "";
    let pesanMasuk = data.message || "";
    let mediaUrl   = data.media   || "";
    
    // ANTI-LOOP
    if (pengirim.includes("81291868456") || pengirim.includes("81398169819")) {
      logError("ANTI-LOOP AKTIF: Pesan dari sesama bot diabaikan.");
      return respon("Loop dicegah.");
    }

    // PENGECUALIAN (VIP / Blacklist)
    if (isNomorPengecualian(pengirim)) {
      logError("PENGECUALIAN: Pesan dari " + pengirim + " diabaikan 100%.");
      return respon("Nomor VIP/Pengecualian.");
    }

    // Deteksi Akun (Dylan vs Nafila)
    let queryAkun = (e.parameter && e.parameter.akun) ? e.parameter.akun.toLowerCase() : "";
    let akun = "dylan"; 
    let cleanPenerima = penerima.replace(/\D/g, "");

    if (queryAkun === "nafila" || cleanPenerima.includes("81398169819")) {
      akun = "nafila";
    } else if (queryAkun === "dylan" || cleanPenerima.includes("81291868456")) {
      akun = "dylan";
    }

    // Catat log sheet
    logPesan(data, akun);

    if (!pesanMasuk && !mediaUrl) return respon("Kosong");

    // Cek Bot ON/OFF
    if (!isBotAktif(akun)) {
      return respon("Bot " + akun.toUpperCase() + " OFF. Diabaikan.");
    }

    return prosesPesanPasien(pengirim, pesanMasuk, mediaUrl, akun);

  } catch (error) {
    logError(error.toString());
    return respon("Error: " + error.toString());
  }
}


// ============================================================
// 2. PROSES PESAN PASIEN / KLIEN (WA)
// ============================================================
function prosesPesanPasien(pengirim, pesanMasuk, mediaUrl, akun) {
  let dataSOP = bacaSOP(akun);
  let infoKontak = getDetailPetugasAtauKontak(pengirim);
  let isPengamat = isModePengamat(pengirim);

  let jawabanAI = "";
  let pesanBersih = "";

  // JIKA BUKAN MODE PENGAMAT, AI MEMBALAS DI WA
  if (!isPengamat) {
    jawabanAI = panggilDualAIEngine(pengirim, pesanMasuk, mediaUrl, dataSOP, akun, infoKontak);
    pesanBersih = prosesKodeAksi(jawabanAI, pengirim, akun);

    if (pesanBersih && pesanBersih.trim() !== "") {
      let wa_api = (akun === "nafila") ? WA_NAFILA : WA_DYLAN;
      kirimPesan(wa_api, pengirim, pesanBersih);
    }
  } else {
    logError("MODE PENGAMAT AKTIF untuk " + pengirim + ". AI diam.");
  }

  // JIKA AKUN DYLAN, FORWARD LOG NOTIFIKASI KE TELEGRAM DOKTER
  if (akun === "dylan") {
    kirimNotifikasiTelegramDylan(pengirim, pesanMasuk, isPengamat ? "⏸️ (MODE PENGAMAT - Bot Diam Karena Dokter Sudah Balas)" : pesanBersih, infoKontak);
  }

  return respon("OK");
}


// ============================================================
// 3. TELEGRAM WEBHOOK HANDLING & BALAS CHAT WA LEWAT TELEGRAM
// ============================================================
function prosesWebhookTelegram(data) {
  try {
    let msg = data.message;
    if (!msg) return respon("No msg");

    let chatId = msg.chat.id;
    let text = msg.text || "";
    let replyToMsg = msg.reply_to_message;

    // Simpan Chat ID Dokter otomatis untuk push notification
    PropertiesService.getScriptProperties().setProperty("TELEGRAM_CHAT_ID_DOKTER", chatId.toString());

    // Command /start
    if (text === "/start") {
      kirimTelegram(chatId, "🤖 *Jarvis Assistant dr. Dylan Aktif!*\n\nSelamat datang Dok! Semua pesan WhatsApp ke dr. Dylan akan diteruskan ke Telegram ini.\n\n*Cara Penggunaan*:\n1. **Balas WA**: Cukup gunakan fitur **Reply** pada notifikasi pesan masuk di Telegram ini.\n2. **Auto Mode Pengamat**: Begitu Dokter membalas via Telegram, AI otomatis *pause* (mode Pengamat) di hari tersebut untuk kontak itu.\n3. **Simpan Kontak Baru**: Jika ada nomor baru, balas notifikasi dengan nama & statusnya (contoh: *\"Ini Pak Budi Pasien LBP\"*), AI akan menyimpannya ke Google Sheet `Kontak_Dylan`!");
      return respon("OK");
    }

    if (text === "/status") {
      kirimTelegram(chatId, "📊 *Status Sistem Jarvis*:\n• WA Dylan: Connected\n• Bot Telegram: Connected\n• Dual AI Engine: DeepSeek V4 + Gemini 3.6");
      return respon("OK");
    }

    // Cari nomor WA tujuan dari pesan reply Telegram
    let targetNoWA = null;
    if (replyToMsg && replyToMsg.text) {
      let replyText = replyToMsg.text;
      let matchNo = replyText.match(/(?:📱|Nomor WA|No WA|Nomor):\s*(\+?62\d+|08\d+)/i) || replyText.match(/(628\d{8,12}|08\d{8,12})/);
      if (matchNo) {
        targetNoWA = formatNomorWA(matchNo[1]);
      }
    }

    if (!targetNoWA) {
      targetNoWA = CacheService.getScriptCache().get("last_tg_target_" + chatId);
    }

    if (!targetNoWA) {
      kirimTelegram(chatId, "⚠️ *Nomor WA tujuan tidak ditemukan.*\nMohon gunakan fitur **Reply / Balas** pada pesan notifikasi WA yang ingin Dokter jawab.");
      return respon("OK");
    }

    let infoKontak = getDetailPetugasAtauKontak(targetNoWA);

    // Cek apakah balasan Dokter adalah untuk Menyimpan Kontak Baru
    let isSaveContactIntent = !infoKontak.isKnown && (
      text.toLowerCase().includes("ini ") || 
      text.toLowerCase().includes("pasien") || 
      text.toLowerCase().includes("simpan") || 
      text.toLowerCase().includes("nama") ||
      text.toLowerCase().includes("istri") ||
      text.toLowerCase().includes("teman") ||
      text.toLowerCase().includes("dosen") ||
      text.toLowerCase().includes("hrd")
    );

    if (isSaveContactIntent) {
      let parsed = parseKontakDenganAI(text, targetNoWA);
      simpanKontakSheet(targetNoWA, parsed.nama, parsed.kategori);
      kirimTelegram(chatId, "✅ *Kontak Berhasil Disimpan ke Google Sheet `Kontak_Dylan`!*\n• **Nama**: " + parsed.nama + "\n• **Nomor**: " + targetNoWA + "\n• **Status**: " + parsed.kategori);
    } else {
      // Kirim balasan Dokter langsung ke WA pasien via WhaCenter
      kirimPesan(WA_DYLAN, targetNoWA, text);

      // Otomatis aktifkan Mode Pengamat (AI Paused) untuk nomor ini di hari ini
      setPengamatModeHariIni(targetNoWA);

      let namaTarget = infoKontak.nama || targetNoWA;
      kirimTelegram(chatId, "🚀 *Pesan Terkirim ke WA " + namaTarget + "!*\n💬 *" + text + "*\n\n⏸️ *AI Otomatis Mode Pengamat* (diam) untuk nomor " + namaTarget + " sampai akhir hari ini.");
    }

    return respon("OK");
  } catch (err) {
    logError("Telegram Webhook Error: " + err.toString());
    return respon("Error");
  }
}


// ============================================================
// 4. FORWARD NOTIFIKASI KE TELEGRAM DOKTER
// ============================================================
function kirimNotifikasiTelegramDylan(pengirim, pesanMasuk, jawabanAI, infoKontak) {
  try {
    let chatId = PropertiesService.getScriptProperties().getProperty("TELEGRAM_CHAT_ID_DOKTER");
    if (!chatId) return;

    let cleanNo = formatNomorWA(pengirim);
    let namaLabel = infoKontak.isKnown ? (infoKontak.nama + " (" + infoKontak.jabatan + ")") : (cleanNo + " *(Belum Disimpan)*");

    // Simpan target WA terakhir ke cache
    CacheService.getScriptCache().put("last_tg_target_" + chatId, cleanNo, 3600);

    let notifText = "📩 *PESAN WA MASUK*\n"
      + "━━━━━━━━━━━━━━━━━━\n"
      + "👤 *Pengirim*: " + namaLabel + "\n"
      + "📱 *Nomor WA*: " + cleanNo + "\n"
      + "💬 *Pesan*: " + pesanMasuk + "\n"
      + "━━━━━━━━━━━━━━━━━━\n"
      + "🤖 *Balasan AI (Jarvis)*:\n" + (jawabanAI || "(Tidak ada balasan)") + "\n";

    if (!infoKontak.isKnown) {
      notifText += "\n━━━━━━━━━━━━━━━━━━\n"
        + "❓ *Nomor Belum Terdaftar!*\n"
        + "Balas notif ini dengan nama & statusnya (misal: *\"Ini Pak Joko pasien LBP\"*) untuk menyimpan kontak ini.";
    } else {
      notifText += "\n👉 *Balas notif ini di Telegram untuk meneruskan pesan Dokter langsung ke WhatsApp.*";
    }

    kirimTelegram(chatId, notifText);
  } catch (err) {
    logError("Kirim Notif Telegram Gagal: " + err.toString());
  }
}


// ============================================================
// 5. MANAJEMEN MODE PENGAMAT (AUTO-PAUSE AI HARI INI)
// ============================================================
function setPengamatModeHariIni(nomorWA) {
  let cleanNo = formatNomorWA(nomorWA);
  let sekarang = new Date();
  let akhirHari = new Date();
  akhirHari.setHours(23, 59, 59, 999);
  
  let sisaDetik = Math.floor((akhirHari.getTime() - sekarang.getTime()) / 1000);
  if (sisaDetik < 300) sisaDetik = 3600; 

  CacheService.getScriptCache().put("pengamat_" + cleanNo, "true", sisaDetik);
}

function isModePengamat(nomorWA) {
  let cleanNo = formatNomorWA(nomorWA);
  let val = CacheService.getScriptCache().get("pengamat_" + cleanNo);
  return val === "true";
}


// ============================================================
// 6. MANAJEMEN KONTAK SHEET "Kontak_Dylan" & DEEPSEEK PARSER
// ============================================================
function getDetailPetugasAtauKontak(nomorWA) {
  if (!nomorWA) return { isKnown: false, isPetugas: false, nama: "", jabatan: "" };
  let numCheck = formatNomorWA(nomorWA);

  // 1. Cek Sheet Petugas
  let petugasInfo = getDetailPetugas(numCheck);
  if (petugasInfo.isPetugas) {
    return { isKnown: true, isPetugas: true, nama: petugasInfo.nama, jabatan: petugasInfo.jabatan };
  }

  // 2. Cek Sheet Kontak_Dylan
  try {
    let ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName("Kontak_Dylan");
    if (sheet) {
      let data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        let noStr = formatNomorWA(data[i][1]);
        if (noStr === numCheck) {
          return {
            isKnown: true,
            isPetugas: false,
            nama: data[i][2] || "Klien/Pasien",
            jabatan: data[i][3] || "Kontak Terdaftar"
          };
        }
      }
    }
  } catch (e) {}

  return { isKnown: false, isPetugas: false, nama: "", jabatan: "" };
}

function simpanKontakSheet(nomorWA, nama, kategori) {
  try {
    let ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName("Kontak_Dylan");
    if (!sheet) {
      sheet = ss.insertSheet("Kontak_Dylan");
      sheet.appendRow(["Tanggal Didaftarkan", "Nomor WA", "Nama Kontak", "Kategori / Status", "Status AI"]);
    }
    let tgl = Utilities.formatDate(new Date(), "Asia/Jakarta", "dd/MM/yyyy HH:mm");
    let cleanNo = formatNomorWA(nomorWA);

    let data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (formatNomorWA(data[i][1]) === cleanNo) {
        sheet.getRange(i + 1, 3).setValue(nama);
        sheet.getRange(i + 1, 4).setValue(kategori);
        return;
      }
    }
    sheet.appendRow([tgl, cleanNo, nama, kategori, "Aktif"]);
  } catch (err) {
    logError("Gagal simpan kontak: " + err.toString());
  }
}

function parseKontakDenganAI(teksDokter, nomorWA) {
  try {
    let prompt = `Ekstrak Nama Kontak dan Kategori/Status dari kalimat berikut:\n"${teksDokter}"\n\nFormat output WAJIB JSON persis seperti ini:\n{"nama": "Nama Kontak", "kategori": "Kategori/Status"}`;
    let res = UrlFetchApp.fetch("https://api.deepseek.com/chat/completions", {
      method: "post",
      headers: { "Authorization": "Bearer " + DEEPSEEK_API_KEY, "Content-Type": "application/json" },
      payload: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1
      }),
      muteHttpExceptions: true
    });
    let json = JSON.parse(res.getContentText());
    let raw = json.choices[0].message.content;
    let match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) {}

  return { nama: teksDokter, kategori: "Kontak Terdaftar" };
}

function formatNomorWA(nomor) {
  if (!nomor) return "";
  let clean = nomor.toString().replace(/\D/g, "");
  if (clean.startsWith("0")) clean = "62" + clean.substring(1);
  return clean;
}


// ============================================================
// 7. OTAK DUAL AI ENGINE (DeepSeek V4 Flash + Fallback Gemini)
// ============================================================
function panggilDualAIEngine(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas) {
  infoPetugas = infoPetugas || getDetailPetugasAtauKontak(pengirim);

  try {
    let jawabanDeepseek = tanyaDeepseek(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas);
    if (jawabanDeepseek && jawabanDeepseek.trim() !== "") {
      return jawabanDeepseek;
    }
  } catch (errDS) {
    logError("DeepSeek API Fail: " + errDS.toString());
  }

  try {
    logError("Menggunakan GEMINI AI BACKUP untuk: " + pengirim);
    let jawabanGemini = tanyaGemini(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas);
    if (jawabanGemini && jawabanGemini.trim() !== "") {
      return jawabanGemini;
    }
  } catch (errGem) {
    logError("Gemini API Fail: " + errGem.toString());
  }

  return "Mohon maaf, sistem AI kami sedang sibuk. Silakan kirim ulang pesan Anda beberapa saat lagi 🙏";
}

function tanyaDeepseek(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas) {
  infoPetugas = infoPetugas || getDetailPetugasAtauKontak(pengirim);
  let url = "https://api.deepseek.com/chat/completions";

  let riwayat = getRiwayat(pengirim);
  let kontenUser = pesanBaru || "";
  if (mediaUrl) kontenUser += "\n[Lampiran media/foto URL: " + mediaUrl + "]";
  riwayat.push({ role: "user", content: kontenUser });

  let systemPrompt = buildSystemPrompt(dataSOP, akun, infoPetugas);

  let messages = [{ role: "system", content: systemPrompt }];
  let riwayatTerakhir = riwayat.slice(-10);
  messages = messages.concat(riwayatTerakhir);

  let payload = {
    model: "deepseek-v4-flash",
    messages: messages,
    temperature: 0.3,
    max_tokens: 950
  };

  let options = {
    method: "post",
    headers: {
      "Authorization": "Bearer " + DEEPSEEK_API_KEY,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  let response = UrlFetchApp.fetch(url, options);
  let statusCode = response.getResponseCode();
  let contentText = response.getContentText();
  let json = JSON.parse(contentText);

  if (statusCode !== 200 || !json.choices || json.choices.length === 0) {
    let errMsg = json.error ? (json.error.message || JSON.stringify(json.error)) : contentText;
    logError("DeepSeek HTTP " + statusCode + ": " + errMsg);
    return null;
  }

  let jawaban = json.choices[0].message.content;

  riwayat.push({ role: "assistant", content: jawaban });
  if (riwayat.length > 12) riwayat = riwayat.slice(-10);
  simpanRiwayat(pengirim, riwayat);

  return jawaban;
}

function tanyaGemini(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas) {
  infoPetugas = infoPetugas || getDetailPetugasAtauKontak(pengirim);
  let url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=" + GEMINI_API_KEY;

  let riwayat = getRiwayat(pengirim);
  let kontenUser = pesanBaru || "";
  if (mediaUrl) kontenUser += "\n[Lampiran media/foto URL: " + mediaUrl + "]";
  riwayat.push({ role: "user", content: kontenUser });

  let systemPrompt = buildSystemPrompt(dataSOP, akun, infoPetugas);

  let contents = [];
  let riwayatTerakhir = riwayat.slice(-8);

  riwayatTerakhir.forEach(function(item) {
    contents.push({
      role: (item.role === "user") ? "user" : "model",
      parts: [{ text: item.content }]
    });
  });

  let payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: contents,
    generationConfig: { temperature: 0.3, maxOutputTokens: 900 }
  };

  let options = {
    method: "post",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  let response = UrlFetchApp.fetch(url, options);
  let statusCode = response.getResponseCode();
  let contentText = response.getContentText();
  let json = JSON.parse(contentText);

  if (statusCode !== 200 || !json.candidates || json.candidates.length === 0) {
    let errMsg = json.error ? (json.error.message || JSON.stringify(json.error)) : contentText;
    logError("Gemini HTTP " + statusCode + ": " + errMsg);
    return null;
  }

  let jawaban = json.candidates[0].content.parts[0].text;

  riwayat.push({ role: "assistant", content: jawaban });
  if (riwayat.length > 12) riwayat = riwayat.slice(-10);
  simpanRiwayat(pengirim, riwayat);

  return jawaban;
}


// ============================================================
// 8. SYSTEM PROMPT BUILDER
// ============================================================
function buildSystemPrompt(dataSOP, akun, infoPetugas) {
  if (!infoPetugas) {
    infoPetugas = { isKnown: false, isPetugas: false, nama: "", jabatan: "" };
  }

  let peran = "";
  
  if (akun === "nafila") {
    peran = `Kamu adalah Customer Service resmi Klinik Nafila Medika (${NOMOR_KLINIK}).
=== PENTING: JANGAN MENGARAHKAN KE NOMOR CHAT INI ===
- Pasien saat ini sedang berbincang denganmu langsung di WhatsApp Resmi Klinik Nafila Medika (${NOMOR_KLINIK}).
- JANGAN PERNAH menyuruh pasien untuk menghubungi, menelpon, atau mengirim WhatsApp ke nomor klinik ${NOMOR_KLINIK} lagi, karena mereka sudah berada di dalam chat ini!
- Jika pasien menanyakan biaya, tarif, layanan BPJS spesialis yang tidak tercover, atau jika pertanyaan pasien tidak ada aturannya di SOP:
  ➔ Jawab secara sopan: "Baik, pesan Kakak kami koordinasikan ke admin Klinik Nafila Medika terlebih dahulu agar diteruskan ke petugas kami ya."
  ➔ DAN kamu WAJIB menyertakan kode aksi: [CATAT|NamaPasien atau Pasien|Pertanyaan/keperluan pasien|Admin] [FORWARD] di bagian paling akhir balasanmu agar sistem otomatis meneruskan pesan tersebut ke WhatsApp petugas leader/admin.

=== KEPRIBADIAN & GAYA BAHASA ===
- Hangat, ramah, sopan dan profesional.
- Sapaan awal wajib: "Halo, selamat datang di Klinik Nafila Medika. Ada yang bisa kami bantu?"
- Panggil pasien dengan "Bapak/Ibu" atau nama mereka.
- Kamu adalah CS resmi klinik. JANGAN sebut dirimu Jarvis atau asisten pribadi dokter.

=== ATURAN OPERASIONAL KLINIK NAFILA MEDIKA ===
1. Berikan info layanan, jam buka, dokter spesialis, jadwal BPJS, & pendaftaran.
2. Jika pasien pendaftaran offline / Baby Spa / Sunat ➔ Kumpulkan form & kirimkan [DAFTAR_DATANG], [DAFTAR_BABYSPA], [DAFTAR_KHITAN].
3. Jika pertanyaan Rujukan BPJS ➔ Kumpulkan data & gunakan [KIRIM_CASMIX].
4. Jika Poli Gigi BPJS ➔ Arahkan ke JKN Mobile H-1.`;
  } else {
    let statusPengirim = infoPetugas.isKnown
      ? "PENGIRIM TERDAFTAR DI DATABASE DOKTER: " + infoPetugas.nama + " (Status/Kategori: " + infoPetugas.jabatan + ")"
      : "PENGIRIM ADALAH PIHAK LUAR / NOMOR BARU (Belum terdaftar di database kontak dr. Dylan).";

    peran = `Kamu adalah "Jarvis", Asisten Medis & Asisten Pribadi dr. Dylan via WhatsApp.
=== STATUS PENGIRIM ===
${statusPengirim}

=== KEPRIBADIAN & GAYA BAHASA ===
- Sangat profesional, hangat, ramah, presisi, dan mengutamakan keselamatan pasien (Patient Safety).
- Sapaan awal wajib: "Halo, saya Jarvis asisten dr. Dylan. Ada yang bisa saya bantu hari ini?"

=== PENGGUNAAN TABEL DOKUMEN & SOP DR. DYLAN ===
1. Gunakan SOP dan panduan dari tabel data untuk memberikan respon yang persis menggambarkan alur berpikir dr. Dylan.
2. Jika pesan berhubungan dengan bimbingan/tesis/agenda/kuliah ➔ Tanya detail singkat & gunakan kode [TASK_SCHEDULE|judul|catatan|YYYY-MM-DD HH:mm] atau [BUAT_JADWAL|judul|mulai|selesai].
3. Jika perawat medis konsul pasien rawat inap ➔ Rekomendasikan terapi awal & susun SBAR dengan kode [LAPOR_DOKTER|SBAR_Text].
4. Jika pasien umum bertanya seputar Klinik Nafila Medika ➔ Arahkan ramah ke WA Resmi Klinik: ${NOMOR_KLINIK} (${NOMOR_KLINIK_WA_LINK}).`;
  }

  return `${peran}

=== DATA SOP KHUSUS DR. DYLAN ===
${dataSOP}
=== AKHIR SOP ===`;
}


// ============================================================
// 9. PEMBACAAN DATA SHEET SOP
// ============================================================
function bacaSOP(akun) {
  try {
    let ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sopText = "";

    if (akun === "nafila") {
      let sheetKlinik = ss.getSheetByName("SOP_Klinik") || ss.getSheetByName("SOP");
      if (sheetKlinik) {
        sopText += "=== SOP OPERASIONAL KLINIK NAFILA MEDIKA ===\n" + ekstraksDataSOP(sheetKlinik);
      }
    } else {
      let sheetJadwal = ss.getSheetByName("SOP_Jadwal");
      if (sheetJadwal) {
        sopText += "=== TABEL 1: SOP PENJADWALAN & ASISTEN PRIBADI ===\n" + ekstraksDataSOP(sheetJadwal) + "\n\n";
      }

      let sheetDylan = ss.getSheetByName("SOP_Dylan");
      if (sheetDylan) {
        sopText += "=== TABEL 2: SOP PEMIKIRAN & KONSUL DOKTER DYLAN ===\n" + ekstraksDataSOP(sheetDylan);
      }
    }

    return sopText || "(Belum ada data SOP)";
  } catch (err) { return "(Gagal membaca data SOP)"; }
}

function ekstraksDataSOP(sheet) {
  let data = sheet.getDataRange().getValues();
  let text = "";
  for (let i = 1; i < data.length; i++) {
    let line = data[i].filter(cell => cell.toString().trim() !== "").join(" | ");
    if (line) text += "- " + line + "\n";
  }
  return text;
}


// ============================================================
// 10. PROSES KODE AKSI BOT
// ============================================================
function prosesKodeAksi(jawabanAI, pengirim, akun) {
  if (!jawabanAI) return "";
  let pesan = jawabanAI;

  if (pesan.includes("[ABAIKAN]")) {
    logPesan({ from: "SYSTEM", to: pengirim, message: "Pesan spam/diabaikan." });
    return "";
  }

  // [CEK_JADWAL|jumlah_hari]
  let cekJadwalMatch = pesan.match(/\[CEK_JADWAL\|(\d+)\]/);
  if (cekJadwalMatch) {
    let hari = parseInt(cekJadwalMatch[1]) || 7;
    let daftarJadwal = bacaJadwalCalendarDanTasks(hari);
    pesan = pesan.replace(cekJadwalMatch[0], "\n\n" + daftarJadwal);
  }

  // [BUAT_JADWAL|Judul|YYYY-MM-DD HH:mm|YYYY-MM-DD HH:mm]
  let buatJadwalMatch = pesan.match(/\[BUAT_JADWAL\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
  if (buatJadwalMatch) {
    let judul   = buatJadwalMatch[1].trim();
    let mulaiStr  = buatJadwalMatch[2].trim();
    let selesaiStr = buatJadwalMatch[3].trim();
    pesan = pesan.replace(buatJadwalMatch[0], "");

    let resCalendar = prosesTambahJadwalCalendar(judul, mulaiStr, selesaiStr);
    pesan += "\n\n" + resCalendar;
  }

  // [DAFTAR_DATANG|nama|noWA|tglDatang|poli|jaminan|keluhan]
  let daftarDatangMatch = pesan.match(/\[DAFTAR_DATANG\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
  if (daftarDatangMatch) {
    let nama      = daftarDatangMatch[1].trim();
    let noWA      = daftarDatangMatch[2].trim();
    let tglDatang = daftarDatangMatch[3].trim();
    let poli      = daftarDatangMatch[4].trim();
    let jaminan   = daftarDatangMatch[5].trim();
    let keluhan   = daftarDatangMatch[6].trim();
    pesan = pesan.replace(daftarDatangMatch[0], "");

    catatAntrian(noWA, nama, "Datang Langsung | Poli: " + poli + " | Jaminan: " + jaminan + " | Keluhan: " + keluhan + " | Tgl: " + tglDatang, "Berobat Langsung", akun);
    kirimKePetugasPendaftaran(nama, noWA, "BEROBAT DATANG LANGSUNG\n• Tanggal: " + tglDatang + "\n• Poli: " + poli + "\n• Jaminan: " + jaminan + "\n• Keluhan: " + keluhan, "Datang Langsung");
    buatGoogleTask("Pasien Datang (" + poli + "): " + nama, "No WA: " + noWA + "\nJaminan: " + jaminan + "\nTgl: " + tglDatang, null);
  }

  // [DAFTAR_BABYSPA|nama|noWA|tglTreatment|treatment|detail]
  let spaMatch = pesan.match(/\[DAFTAR_BABYSPA\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
  if (spaMatch) {
    let nama         = spaMatch[1].trim();
    let noWA         = spaMatch[2].trim();
    let tglTreatment = spaMatch[3].trim();
    let treatment    = spaMatch[4].trim();
    let detail       = spaMatch[5].trim();
    pesan = pesan.replace(spaMatch[0], "");

    catatAntrian(noWA, nama, "Baby Spa | Treatment: " + treatment + " | Tgl: " + tglTreatment, "Baby & Mom Spa", akun);
    kirimKePetugasPendaftaran(nama, noWA, "PENDAFTARAN BABY & MOM SPA\n• Jadwal: " + tglTreatment + "\n• Treatment: " + treatment + "\n• Detail: " + detail, "Baby & Mom Spa");
    buatGoogleTask("Baby Spa: " + nama + " (" + tglTreatment + ")", "No WA: " + noWA + "\nTreatment: " + treatment, null);
  }

  // [DAFTAR_KHITAN|nama|noWA|tglSunat|skriningText]
  let khitanMatch = pesan.match(/\[DAFTAR_KHITAN\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
  if (khitanMatch) {
    let nama        = khitanMatch[1].trim();
    let noWA        = khitanMatch[2].trim();
    let tglSunat    = khitanMatch[3].trim();
    let skrining    = khitanMatch[4].trim();
    pesan = pesan.replace(khitanMatch[0], "");

    catatAntrian(noWA, nama, "Pendaftaran Khitan | Tgl: " + tglSunat, "Khitan/Sunat", akun);
    kirimKePetugasPendaftaran(nama, noWA, "PENDAFTARAN KHITAN/SUNAT\n• Tanggal: " + tglSunat + "\n• Hasil Skrining:\n" + skrining, "Khitan / Sunat");
    buatGoogleTask("Khitan: " + nama + " (" + tglSunat + ")", "No WA: " + noWA + "\nSkrining: " + skrining, null);
  }

  // [KIRIM_CASMIX|nama|noWA|detailRujukan]
  let casmixMatch = pesan.match(/\[KIRIM_CASMIX\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
  if (casmixMatch) {
    let nama   = casmixMatch[1].trim();
    let noWA   = casmixMatch[2].trim();
    let detail = casmixMatch[3].trim();
    pesan = pesan.replace(casmixMatch[0], "");

    let pesanCasmix = "📋 *NOTIFIKASI PERTANYAAN RUJUKAN BPJS (CASMIX)*\n"
      + "━━━━━━━━━━━━━━━━━━\n"
      + "👤 Nama Pasien : " + nama + "\n"
      + "📱 No WA       : " + noWA + "\n"
      + "📝 Detail      : " + detail + "\n"
      + "━━━━━━━━━━━━━━━━━━\n"
      + "Mohon ditindaklanjuti ya Bidan Sri 🙏";

    kirimPesan(WA_NAFILA, NOMOR_CASMIX_MAK_SRI, pesanCasmix);
    catatAntrian(noWA, nama, detail, "Rujukan Casmix", akun);
  }

  // [LAPOR_DOKTER|Ringkasan_SBAR]
  let laporMatch = pesan.match(/\[LAPOR_DOKTER\|([^\]]+)\]/);
  if (laporMatch) {
    let detailSBAR = laporMatch[1].trim();
    pesan = pesan.replace(laporMatch[0], "");
    
    let pesanDokter = "🔔 *KONSUL RAWAT INAP BARU (JARVIS)*\n"
      + "━━━━━━━━━━━━━━━━━━\n"
      + "📱 Dari WA : " + pengirim + "\n"
      + detailSBAR + "\n"
      + "━━━━━━━━━━━━━━━━━━\n"
      + "Mohon verifikasi & instruksi lanjutan ya Dok 🙏";
    
    kirimPesan(WA_DYLAN, NOMOR_DOKTER, pesanDokter);
    buatGoogleTask("Konsul Rawat Inap: " + pengirim, detailSBAR, null);
  }

  // [TASK_SCHEDULE|judul|catatan|YYYY-MM-DD HH:mm]
  let taskScheduleMatch = pesan.match(/\[TASK_SCHEDULE\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
  if (taskScheduleMatch) {
    let judul    = taskScheduleMatch[1].trim();
    let catatan  = taskScheduleMatch[2].trim();
    let waktuStr = taskScheduleMatch[3].trim();
    pesan = pesan.replace(taskScheduleMatch[0], "");

    buatGoogleTask(judul, catatan + "\nNo WA: " + pengirim, waktuStr);
  }

  // [CATAT|nama|keluhan|kategori]
  let catatMatch = pesan.match(/\[CATAT\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
  if (catatMatch) {
    let nama     = catatMatch[1].trim();
    let keluhan  = catatMatch[2].trim();
    let kategori = catatMatch[3].trim();
    catatAntrian(pengirim, nama, keluhan, kategori, akun);
    buatGoogleTask("WA Masuk (" + kategori + "): " + nama, "No WA: " + pengirim + "\nDetail: " + keluhan, null);
    pesan = pesan.replace(catatMatch[0], "");
  }

  // [FORWARD]
  if (pesan.includes("[FORWARD]")) {
    if (catatMatch) {
      kirimKePetugasPendaftaran(catatMatch[1], pengirim, catatMatch[2], catatMatch[3]);
    }
    pesan = pesan.replace("[FORWARD]", "");
  }

  // [HANDOVER]
  if (pesan.includes("[HANDOVER]")) {
    pesan = pesan.replace(/\[HANDOVER\]/g, "");
    setPengamatModeHariIni(pengirim);
  }

  return pesan.trim();
}


// ============================================================
// 11. DETEKSI PETUGAS DARI SHEET "Petugas"
// ============================================================
function getDetailPetugas(nomorWA) {
  if (!nomorWA) return { isPetugas: false, nama: "", jabatan: "" };
  try {
    let ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName("Petugas");
    if (!sheet) return { isPetugas: false, nama: "", jabatan: "" };

    let data = sheet.getDataRange().getValues();
    let numCheck = formatNomorWA(nomorWA);

    for (let i = 1; i < data.length; i++) {
      let nomorPetugas = data[i][1];
      if (nomorPetugas && nomorPetugas.toString().trim() !== "") {
        let noStr = formatNomorWA(nomorPetugas);
        if (noStr === numCheck) {
          return {
            isPetugas: true,
            nama: data[i][0] || "Petugas",
            jabatan: (data[i][2] || "Karyawan Medis").toString()
          };
        }
      }
    }
    return { isPetugas: false, nama: "", jabatan: "" };
  } catch (err) { return { isPetugas: false, nama: "", jabatan: "" }; }
}

function kirimKePetugasPendaftaran(namaPasien, nomorPasien, detail, kategori) {
  try {
    let ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName("Petugas");
    if (!sheet) return;

    let data = sheet.getDataRange().getValues();
    let waktu = Utilities.formatDate(new Date(), "Asia/Jakarta", "dd/MM/yyyy HH:mm");

    let pesanForward = "📋 *NOTIFIKASI PENDAFTARAN - " + kategori.toUpperCase() + "*\n"
      + "━━━━━━━━━━━━━━━━━━\n"
      + "👤 Nama Pasien : " + namaPasien + "\n"
      + "📱 No WA       : " + nomorPasien + "\n"
      + "📝 Detail      : " + detail + "\n"
      + "🕐 Waktu       : " + waktu + "\n"
      + "━━━━━━━━━━━━━━━━━━\n"
      + "Mohon segera diproses tim Pendaftaran / Leader 🙏";

    for (let i = 1; i < data.length; i++) {
      let nomorPetugas = data[i][1];
      let jabatan = (data[i][2] || "").toString().toLowerCase();

      if (nomorPetugas && nomorPetugas.toString().trim() !== "") {
        if (jabatan.includes("pendaftaran") || jabatan.includes("leader") || jabatan.includes("admin")) {
          kirimPesan(WA_NAFILA, nomorPetugas.toString(), pesanForward);
        }
      }
    }
  } catch (err) { logError("Forward pendaftaran gagal: " + err.toString()); }
}


// ============================================================
// 12. HELPER PENGIRIMAN API (WHATSAPP & TELEGRAM)
// ============================================================
function kirimPesan(deviceId, nomorTujuan, isiPesan) {
  let url = "https://app.whacenter.com/api/send";
  let payload = {
    device_id: deviceId,
    number: nomorTujuan,
    message: isiPesan
  };
  let options = {
    method: "post",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  UrlFetchApp.fetch(url, options);
}

function kirimTelegram(chatId, isiPesan) {
  let url = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";
  let payload = {
    chat_id: chatId,
    text: isiPesan,
    parse_mode: "Markdown"
  };
  let options = {
    method: "post",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  UrlFetchApp.fetch(url, options);
}

// FUNGSI 1-CLICK SET WEBHOOK TELEGRAM
function setTelegramWebhook() {
  let urlApp = ScriptApp.getService().getUrl();
  if (!urlApp) {
    Logger.log("⚠️ Deploy dulu Script ini sebagai Web App (Execute as: Me, Access: Anyone), baru jalankan fungsi ini!");
    return;
  }
  urlApp = urlApp.replace(/\/dev$/, "/exec");
  let tgUrl = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/setWebhook?url=" + encodeURIComponent(urlApp);
  let response = UrlFetchApp.fetch(tgUrl);
  Logger.log("Hasil Set Webhook Telegram: " + response.getContentText());
}


// ============================================================
// 13. CALENDAR, TASKS & SHEET LOGGING HELPER
// ============================================================
function isBotAktif(akun) {
  try {
    let ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName("Pengaturan");
    if (!sheet) return true;

    if (akun === "nafila") {
      let val = sheet.getRange("B2").getValue();
      return val === true || val.toString().toUpperCase() === "TRUE";
    } else {
      let val = sheet.getRange("B3").getValue();
      return val === true || val.toString().toUpperCase() === "TRUE";
    }
  } catch (err) { return true; }
}

function isNomorPengecualian(nomorKlien) {
  try {
    let ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName("Pengecualian");
    if (!sheet) return false;

    let data = sheet.getDataRange().getValues();
    for (let i = 2; i < data.length; i++) {
      let nomor = data[i][1];
      if (nomor && nomor.toString().trim() !== "") {
        if (formatNomorWA(nomor) === formatNomorWA(nomorKlien)) return true;
      }
    }
    return false;
  } catch (err) { return false; }
}

function catatAntrian(nomorWA, nama, keluhan, kategori, akun) {
  try {
    let ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheetName = (akun === "nafila") ? "Antrian_Klinik" : "Antrian_Dylan";
    let sheet = ss.getSheetByName(sheetName) || ss.getSheetByName("Antrian");
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(["Waktu", "Nomor WA", "Nama", "Kategori", "Detail/Keluhan", "Status"]);
    }
    let waktu = Utilities.formatDate(new Date(), "Asia/Jakarta", "dd/MM/yyyy HH:mm");
    sheet.appendRow([waktu, nomorWA, nama, kategori, keluhan, "Baru"]);
  } catch (err) { logError("Catat antrian gagal: " + err.toString()); }
}

function getRiwayat(nomorKlien) {
  try {
    let cache = CacheService.getScriptCache();
    let data = cache.get("riwayat_" + nomorKlien);
    return data ? JSON.parse(data) : [];
  } catch (err) { return []; }
}

function simpanRiwayat(nomorKlien, riwayat) {
  try { CacheService.getScriptCache().put("riwayat_" + nomorKlien, JSON.stringify(riwayat), 3600); } catch (err) {}
}

function logPesan(data, akun) {
  try {
    let ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheetName = (akun === "nafila") ? "Log_Klinik" : "Log_Dylan";
    let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
    
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Waktu", "Pengirim (From)", "Penerima (To)", "Pesan"]);
    }
    
    let waktu = Utilities.formatDate(new Date(), "Asia/Jakarta", "dd/MM/yyyy HH:mm:ss");
    sheet.appendRow([waktu, data.from || "", data.to || "", data.message || "(media)"]);
    if (sheet.getLastRow() > 500) sheet.deleteRows(2, sheet.getLastRow() - 500);
  } catch (err) {}
}

function logError(pesanError) {
  try {
    let ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName("Log");
    if (sheet) {
      let waktu = Utilities.formatDate(new Date(), "Asia/Jakarta", "dd/MM/yyyy HH:mm:ss");
      sheet.appendRow([waktu, "SYSTEM", "ERROR", pesanError]);
    }
  } catch (err) {}
}

function respon(pesan) {
  return ContentService.createTextOutput(JSON.stringify({ status: pesan }))
    .setMimeType(ContentService.MimeType.JSON);
}

function bacaJadwalCalendarDanTasks(jumlahHari) {
  try {
    let sekarang = new Date();
    let akhir = new Date();
    akhir.setDate(sekarang.getDate() + jumlahHari);

    let calendar = CalendarApp.getDefaultCalendar();
    let events = calendar.getEvents(sekarang, akhir);
    let tasks = bacaGoogleTasks(jumlahHari);

    let text = "📅 *Jadwal Agenda & Tugas dr. Dylan (" + jumlahHari + " Hari ke Depan)*:\n━━━━━━━━━━━━━━━━━━\n";

    if (events.length === 0 && tasks.length === 0) {
      return "📅 *Info Agenda & Tasks dr. Dylan*: Tidak ada agenda di Google Calendar maupun Tasks dalam " + jumlahHari + " hari ke depan (Jadwal Kosong).";
    }

    if (events.length > 0) {
      text += "🗓️ *AGENDA GOOGLE CALENDAR*:\n";
      events.forEach(function(evt) {
        let tgl = Utilities.formatDate(evt.getStartTime(), "Asia/Jakarta", "dd MMMM yyyy");
        let jamMulai = Utilities.formatDate(evt.getStartTime(), "Asia/Jakarta", "HH:mm");
        let jamSelesai = Utilities.formatDate(evt.getEndTime(), "Asia/Jakarta", "HH:mm");
        text += "• *" + tgl + "* (" + jamMulai + " - " + jamSelesai + " WIB)\n  📌 " + evt.getTitle() + "\n";
      });
      text += "\n";
    }

    if (tasks.length > 0) {
      text += "📋 *DOKUMEN & TUGAS GOOGLE TASKS*:\n";
      tasks.forEach(function(t) {
        text += "• *" + t.dueFormatted + "*\n  📝 " + t.title + (t.notes ? "\n  (Catatan: " + t.notes + ")" : "") + "\n";
      });
    }

    return text;
  } catch (err) { return "⚠️ Gagal membaca Google Calendar & Tasks."; }
}

function bacaGoogleTasks(jumlahHari) {
  try {
    let tasksResponse = Tasks.Tasks.list('@default', { showCompleted: false });
    if (!tasksResponse.items || tasksResponse.items.length === 0) return [];

    let taskList = [];
    tasksResponse.items.forEach(function(item) {
      if (item.title) {
        let dueStr = "Tugas Umum (Tanpa Tenggat Khusus)";
        if (item.due) {
          let dueDt = new Date(item.due);
          dueStr = Utilities.formatDate(dueDt, "Asia/Jakarta", "dd MMMM yyyy HH:mm");
          taskList.push({ title: item.title, notes: item.notes || "", dueFormatted: dueStr });
        } else {
          taskList.push({ title: item.title, notes: item.notes || "", dueFormatted: dueStr });
        }
      }
    });

    return taskList;
  } catch (err) { return []; }
}

function buatGoogleTask(judul, catatan, waktuDueStr) {
  try {
    let task = { title: judul, notes: catatan };
    if (waktuDueStr) {
      let dt = parseDateTimeStr(waktuDueStr);
      if (dt) task.due = dt.toISOString();
    }
    Tasks.Tasks.insert(task, "@default");
  } catch (err) { logError("Google Task gagal: " + err.toString()); }
}

function prosesTambahJadwalCalendar(judul, mulaiStr, selesaiStr) {
  try {
    let tMulai   = parseDateTimeStr(mulaiStr);
    let tSelesai = parseDateTimeStr(selesaiStr);

    if (!tMulai || !tSelesai) return "⚠️ Format tanggal/jam tidak valid. Gunakan YYYY-MM-DD HH:mm";

    let calendar = CalendarApp.getDefaultCalendar();
    let bentrokEvents = calendar.getEvents(tMulai, tSelesai);

    if (bentrokEvents.length > 0) {
      let infoBentrok = bentrokEvents.map(e => e.getTitle() + " (" + Utilities.formatDate(e.getStartTime(), "Asia/Jakarta", "HH:mm") + "-" + Utilities.formatDate(e.getEndTime(), "Asia/Jakarta", "HH:mm") + ")").join(", ");
      return "⚠️ *Gagal Membuat Jadwal (BENTROK)*!\n"
        + "Agenda *\"" + judul + "\"* bentrok dengan agenda:\n"
        + "📌 " + infoBentrok + "\n\n"
        + "Silakan pilih waktu lain yang kosong 🙏";
    }

    calendar.createEvent(judul, tMulai, tSelesai);
    let tglStr = Utilities.formatDate(tMulai, "Asia/Jakarta", "dd MMMM yyyy");
    let jamMulaiStr = Utilities.formatDate(tMulai, "Asia/Jakarta", "HH:mm");
    let jamSelesaiStr = Utilities.formatDate(tSelesai, "Asia/Jakarta", "HH:mm");

    return "✅ *Jadwal Berhasil Ditambahkan ke Google Calendar!*\n"
      + "📌 *Agenda*: " + judul + "\n"
      + "📅 *Tanggal*: " + tglStr + "\n"
      + "🕐 *Waktu*: " + jamMulaiStr + " - " + jamSelesaiStr + " WIB";
  } catch (err) { return "⚠️ Terjadi kendala saat menambahkan agenda ke Google Calendar."; }
}

function parseDateTimeStr(str) {
  try {
    let parts = str.split(" ");
    let dateParts = parts[0].split("-");
    let timeParts = parts[1].split(":");
    return new Date(
      parseInt(dateParts[0]),
      parseInt(dateParts[1]) - 1,
      parseInt(dateParts[2]),
      parseInt(timeParts[0]),
      parseInt(timeParts[1])
    );
  } catch (e) { return null; }
}
