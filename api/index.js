const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('../src/config');
const whacenter = require('../src/services/whacenterService');
const googleService = require('../src/services/googleService');
const aiService = require('../src/services/aiService');
const telegramService = require('../src/services/telegramService');

const app = express();
app.use(cors());
// Naikkan limit ke 8MB untuk mendukung upload gambar base64 dari dashboard
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));

let dashboardHtmlContent = "";
try {
  dashboardHtmlContent = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
} catch (e) {
  console.error("Initial read dashboard HTML error:", e.message);
}

// ================= REAL-TIME SERVER-SENT EVENTS (SSE) STREAM =================
let sseClients = [];

function broadcastRealtimeUpdate(type, payload = {}) {
  let eventStr = `data: ${JSON.stringify({ type, ...payload, timestamp: Date.now() })}\n\n`;
  sseClients.forEach(client => {
    try { client.write(eventStr); } catch (e) {}
  });
}

// Subscribe ke callback pesan baru dari googleService
googleService.setOnNewMessageCallback((msgData) => {
  broadcastRealtimeUpdate('NEW_MESSAGE', msgData);
});

app.get('/api/stream-updates', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() })}\n\n`);
  sseClients.push(res);

  const keepAlive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch (e) {}
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients = sseClients.filter(c => c !== res);
  });
});

// Root Health Check Route
app.get('/', (req, res) => {
  res.send({
    status: "OK",
    service: "Jarvis Bot Engine (Node.js)",
    account_dylan: config.NOMOR_DOKTER,
    account_nafila: config.NOMOR_KLINIK,
    dashboard_url: "/dashboard",
    timestamp: new Date().toISOString()
  });
});

// Render Dashboard Web App UI (No Cache Enforced)
const renderDashboardHandler = (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    if (!dashboardHtmlContent) {
      dashboardHtmlContent = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
    }
    return res.send(dashboardHtmlContent);
  } catch (e) {
    return res.status(500).send("Dashboard HTML not found: " + e.message);
  }
};

app.get('/dashboard', renderDashboardHandler);
app.get('/dash', renderDashboardHandler);
app.get('/app', renderDashboardHandler);

// Dashboard API Endpoints
app.get('/api/dashboard-data', async (req, res) => {
  try {
    let data = await googleService.getDashboardData();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/backup-google-drive', async (req, res) => {
  try {
    let result = await googleService.backupDataKeGoogleDrive();
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ===== UPLOAD FILE KE GOOGLE DRIVE (PUBLIC) =====
// Terima file sebagai base64 JSON, upload ke Drive, kembalikan URL publik
app.post('/api/upload-to-drive', async (req, res) => {
  try {
    let { filename, mimeType, base64 } = req.body || {};
    if (!base64) return res.status(400).json({ error: "Data file (base64) tidak boleh kosong" });

    // Batas ukuran: 5MB setelah decode
    let buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: "File terlalu besar (maks 5MB). Kompres dulu ya Dok 🙏" });
    }

    let safeFilename = filename || ('jarvis_upload_' + Date.now() + '.jpg');
    let safeMimeType = mimeType || 'image/jpeg';

    let result = await googleService.uploadFileToDrive(safeFilename, safeMimeType, buffer);
    return res.json({ status: "OK", ...result });
  } catch (e) {
    console.error("Upload to Drive error:", e.message);
    return res.status(500).json({ error: "Gagal upload: " + e.message });
  }
});

app.get('/api/contacts-list', async (req, res) => {
  try {
    let sheet = (req.query && req.query.sheet) ? req.query.sheet : "Kontak_Dylan";
    let list = await googleService.getContactsBySheet(sheet);
    res.json({ status: "OK", sheet: sheet, list: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/add-contact-sheet', async (req, res) => {
  try {
    let { sheetName, number, name, category } = req.body || {};
    if (!number || !name) return res.status(400).json({ error: "Nomor dan nama wajib diisi" });

    let sheet = sheetName || "Kontak_Dylan";
    await googleService.tambahKontakBaruSheet(sheet, number, name, category);
    return res.json({ status: "OK" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/delete-contact-sheet', async (req, res) => {
  try {
    let { sheetName, rowIndex } = req.body || {};
    if (!rowIndex) return res.status(400).json({ error: "rowIndex wajib diisi" });

    let sheet = sheetName || "Kontak_Dylan";
    await googleService.hapusKontakSheet(sheet, rowIndex);
    return res.json({ status: "OK" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/api/sop-data', async (req, res) => {
  try {
    let akun = (req.query && req.query.akun) ? req.query.akun.toLowerCase() : "dylan";
    let sopText = await googleService.bacaSOP(akun);
    res.json({ status: "OK", account: akun, sopText: sopText });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sop-list', async (req, res) => {
  try {
    let akun = (req.query && req.query.akun) ? req.query.akun.toLowerCase() : "dylan";
    let list = await googleService.bacaSOPList(akun);
    let sopText = await googleService.bacaSOP(akun);
    res.json({ status: "OK", account: akun, list: list, sopText: sopText });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/save-sop', async (req, res) => {
  try {
    let { account, rowIndex, pemicu, polaPikir, contohBalasan } = req.body || {};
    let akun = account || "dylan";
    
    if (!pemicu) return res.status(400).json({ error: "Topik / Pemicu SOP tidak boleh kosong" });

    if (rowIndex) {
      await googleService.editSOPItem(akun, rowIndex, pemicu, polaPikir || "-", contohBalasan || "-");
    } else {
      await googleService.tambahSOPBaru(pemicu, polaPikir || "-", contohBalasan || "-", akun);
    }
    return res.json({ status: "OK" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/delete-sop', async (req, res) => {
  try {
    let { account, rowIndex } = req.body || {};
    let akun = account || "dylan";
    if (!rowIndex) return res.status(400).json({ error: "rowIndex wajib diisi" });

    await googleService.hapusSOPItem(akun, rowIndex);
    return res.json({ status: "OK" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ===== JARVIS SOP COMMAND ENDPOINT — Perintah langsung dari Jarvis Chat =====
app.post('/api/jarvis-sop-command', async (req, res) => {
  try {
    let { command, akun } = req.body || {};
    if (!command) return res.status(400).json({ error: "Perintah tidak boleh kosong" });
    akun = (akun === "nafila") ? "nafila" : "dylan";

    let currentSOPList = await googleService.bacaSOPList(akun);
    let sopExtractPrompt = `Dokter Dylan memberikan perintah SOP:\n"${command}"\n\n=== SOP SAAT INI (${akun.toUpperCase()}) ===\n${JSON.stringify(currentSOPList.slice(0, 30), null, 2)}\n\nAnalisa dan buat respons JSON VALID (HANYA JSON):\n{"intent":"tambah"|"edit"|"hapus","pemicu":"...","polaPikir":"...","contohBalasan":"...","rowIndex":null|number,"konfirmasi":"pesan 1 kalimat"}`;

    let jsonRaw = await aiService.panggilDualAIEngine("SOP_CMD", sopExtractPrompt, null, "", akun, { isKnown: true, nama: "dr. Dylan", jabatan: "Dokter / Owner" }, []);
    let jsonMatch = jsonRaw && jsonRaw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(422).json({ error: "AI tidak bisa memahami perintah, coba lebih spesifik" });

    let cmd = JSON.parse(jsonMatch[0]);

    if (cmd.intent === "tambah" && cmd.pemicu) {
      await googleService.tambahSOPBaru(cmd.pemicu, cmd.polaPikir || "-", cmd.contohBalasan || "-", akun);
      return res.json({ status: "OK", action: "tambah", akun, pemicu: cmd.pemicu, konfirmasi: cmd.konfirmasi });

    } else if (cmd.intent === "edit" && cmd.rowIndex && cmd.pemicu) {
      await googleService.editSOPItem(akun, cmd.rowIndex, cmd.pemicu, cmd.polaPikir || "-", cmd.contohBalasan || "-");
      return res.json({ status: "OK", action: "edit", akun, rowIndex: cmd.rowIndex, konfirmasi: cmd.konfirmasi });

    } else if (cmd.intent === "hapus" && cmd.rowIndex) {
      await googleService.hapusSOPItem(akun, cmd.rowIndex);
      return res.json({ status: "OK", action: "hapus", akun, rowIndex: cmd.rowIndex, konfirmasi: cmd.konfirmasi });

    } else {
      return res.status(422).json({ error: "Perintah tidak cukup jelas, sebutkan nomor baris atau topik SOP yang dimaksud" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});



app.post('/api/toggle-master-ai', async (req, res) => {
  try {
    let { account, status } = req.body || {};
    if (!account) return res.status(400).json({ error: "Account wajib diisi ('dylan' atau 'nafila')" });

    let updatedStatuses = googleService.setMasterAiStatus(account, status);
    broadcastRealtimeUpdate('REFRESH_DASHBOARD', { masterAiStatus: updatedStatuses });
    return res.json({ status: "OK", masterAiStatus: updatedStatuses });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/send-doctor-message', async (req, res) => {
  try {
    let { number, message, senderAccount, fileUrl } = req.body || {};
    if (!number) return res.status(400).json({ error: "Nomor tidak boleh kosong" });
    if (!message && !fileUrl) return res.status(400).json({ error: "Pesan atau file wajib diisi" });

    // RUANG DISKUSI KHUSUS 🤖 JARVIS ASSISTANT
    if (number === "JARVIS_AI_ASSISTANT" || number.includes("JARVIS")) {
      googleService.tambahRiwayatPercakapan("JARVIS_AI_ASSISTANT", "doctor", message);

      let dataSOPDylan = await googleService.bacaSOP("dylan");
      let dataSOPKlinik = await googleService.bacaSOP("nafila");
      let calendarData = await googleService.bacaGoogleCalendar();
      let tasksData = await googleService.bacaGoogleTasks();
      let riwayat = googleService.getRiwayatPercakapan("JARVIS_AI_ASSISTANT");

      // ===== SOP COMMAND DETECTION — Deteksi apakah dokter memerintahkan perubahan SOP =====
      let msgLower = message.toLowerCase();
      let isSopCommand = (
        (msgLower.includes("tambah") || msgLower.includes("catat") || msgLower.includes("tambahkan")) ||
        (msgLower.includes("ubah") || msgLower.includes("edit") || msgLower.includes("ganti") || msgLower.includes("perbarui")) ||
        (msgLower.includes("hapus") || msgLower.includes("hilangkan") || msgLower.includes("delete")) ||
        (msgLower.includes("analisa") || msgLower.includes("usulan") || msgLower.includes("saran sop"))
      ) && (msgLower.includes("sop") || msgLower.includes("aturan") || msgLower.includes("rule"));

      if (isSopCommand) {
        // Minta DeepSeek ekstrak intent + data SOP dari perintah dokter
        let currentSOPList = await googleService.bacaSOPList("dylan");
        let currentSOPListKlinik = await googleService.bacaSOPList("nafila");
        let sopExtractPrompt = `Kamu adalah Jarvis AI. Dokter Dylan memberikan perintah terkait SOP berikut:

"${message}"

=== SOP SAAT INI (DYLAN) ===
${JSON.stringify(currentSOPList.slice(0, 20), null, 2)}

=== SOP SAAT INI (KLINIK) ===
${JSON.stringify(currentSOPListKlinik.slice(0, 20), null, 2)}

Analisa perintah dokter dan buat respons JSON VALID dalam format berikut (HANYA JSON, tanpa komentar):
{
  "intent": "tambah" | "edit" | "hapus" | "analisa",
  "akun": "dylan" | "nafila",
  "pemicu": "...",
  "polaPikir": "...",
  "contohBalasan": "...",
  "rowIndex": null | number,
  "konfirmasi": "pesan singkat untuk dokter (maks 1 kalimat)"
}`;

        try {
          let jsonRaw = await aiService.panggilDualAIEngine("SOP_EXTRACTOR", sopExtractPrompt, null, "", "dylan", { isKnown: true, nama: "dr. Dylan", jabatan: "Dokter / Owner" }, []);
          // Ekstrak JSON dari respons (clean markdown jika ada)
          let jsonMatch = jsonRaw && jsonRaw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            let cmd = JSON.parse(jsonMatch[0]);
            let akun = (cmd.akun === "nafila") ? "nafila" : "dylan";
            let konfirmasi = cmd.konfirmasi || "";

            if (cmd.intent === "tambah" && cmd.pemicu) {
              await googleService.tambahSOPBaru(cmd.pemicu, cmd.polaPikir || "-", cmd.contohBalasan || "-", akun);
              let balasan = `✅ SOP baru "${cmd.pemicu}" berhasil saya tambahkan ke SOP ${akun === 'nafila' ? 'Klinik' : 'Dylan'} Dok! ${konfirmasi}`;
              googleService.tambahRiwayatPercakapan("JARVIS_AI_ASSISTANT", "assistant", balasan);
              return res.json({ status: "OK", sopAction: "tambah", akun });

            } else if (cmd.intent === "edit" && cmd.rowIndex && cmd.pemicu) {
              await googleService.editSOPItem(akun, cmd.rowIndex, cmd.pemicu, cmd.polaPikir || "-", cmd.contohBalasan || "-");
              let balasan = `✏️ SOP baris #${cmd.rowIndex} "${cmd.pemicu}" berhasil saya perbarui Dok! ${konfirmasi}`;
              googleService.tambahRiwayatPercakapan("JARVIS_AI_ASSISTANT", "assistant", balasan);
              return res.json({ status: "OK", sopAction: "edit", akun });

            } else if (cmd.intent === "hapus" && cmd.rowIndex) {
              await googleService.hapusSOPItem(akun, cmd.rowIndex);
              let balasan = `🗑️ SOP baris #${cmd.rowIndex} berhasil saya hapus Dok! ${konfirmasi}`;
              googleService.tambahRiwayatPercakapan("JARVIS_AI_ASSISTANT", "assistant", balasan);
              return res.json({ status: "OK", sopAction: "hapus", akun });

            } else if (cmd.intent === "analisa") {
              // Analisa percakapan & usulkan SOP baru
              let riwayatText = riwayat.slice(-10).map(m => `${m.role}: ${m.content}`).join("\n");
              let analisaPrompt = `Berdasarkan percakapan Jarvis berikut:
${riwayatText}

Usulkan 1-3 aturan SOP baru yang relevan untuk ditambahkan. Format: singkat, padat, operasional. Pisahkan tiap SOP dengan '|||'.`;
              let usulanText = await aiService.panggilDualAIEngine("SOP_ANALYST", analisaPrompt, null, "", "dylan", { isKnown: true, nama: "dr. Dylan", jabatan: "Dokter / Owner" }, []);
              let balasan = `📊 Dari percakapan tadi, saya usulkan SOP baru: ${usulanText}`;
              googleService.tambahRiwayatPercakapan("JARVIS_AI_ASSISTANT", "assistant", balasan);
              return res.json({ status: "OK", sopAction: "analisa" });
            }
          }
        } catch (eSop) {
          console.error("SOP Command Error:", eSop.message);
          // Lanjutkan ke respons normal jika parse gagal
        }
      }
      // ===== END SOP COMMAND =====

      let promptInternal = `Kamu adalah Jarvis, Asisten Pribadi Cerdas dr. Dylan.
Dokter Dylan sedang berbicara langsung denganmu di ruang diskusi internal.

=== ATURAN BALASAN MANDATORI ===
1. BALASAN WAJIB SINGKAT, PADAT, DAN ALAMI:
   - Maksimal 1-2 kalimat pendek saja per pesan.
   - DILARANG MEMBUAT PARAGRAF PANJANG / WALL OF TEXT!
   - DILARANG menggunakan markdown formal seperti **, ---, #, 1., 2.
2. JIKA ADA LEBIH DARI 1 POIN ➔ PISAHKAN DENGAN SIMBOL '|||' agar terpecah menjadi bubble chat terpisah!
3. JIKA DOKTER MEMERINTAHKAN PERUBAHAN SOP TAPI KAMU TIDAK BISA EKSEKUSI, minta klarifikasi nomor baris SOP yang dimaksud.

=== DATA SOP DR. DYLAN (PERSONAL) ===
${dataSOPDylan}

=== DATA SOP OPERASIONAL KLINIK NAFILA MEDIKA ===
${dataSOPKlinik}

=== DATA GOOGLE CALENDAR MINGGU INI ===
${calendarData}

=== DATA CATATAN GOOGLE TASKS ===
${tasksData}`;

      let jawabanAI = await aiService.panggilDualAIEngine("JARVIS_INTERNAL", message, null, promptInternal, "dylan", { isKnown: true, nama: "dr. Dylan", jabatan: "Dokter / Owner" }, riwayat);

      if (jawabanAI) {
        let bubbles = jawabanAI.split('|||').map(b => b.trim()).filter(b => b !== '');
        if (bubbles.length === 0) bubbles = [jawabanAI];

        for (let b of bubbles) {
          googleService.tambahRiwayatPercakapan("JARVIS_AI_ASSISTANT", "assistant", b);
        }
      }

      return res.json({ status: "OK" });
    }

    let cleanNo = whacenter.formatNomorWA(number);
    let chosenAccount = senderAccount || "dylan";
    let deviceId = (chosenAccount === "nafila") ? config.WA_NAFILA : config.WA_DYLAN;

    googleService.setContactAccountType(cleanNo, chosenAccount);

    // Jika ada fileUrl → Selalu kirim via Pesan Teks WhatsApp berisikan Link Lampiran yang Rapi (100% Instan & Bebas <nil>)
    if (fileUrl) {
      let isPhoto = /\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(fileUrl) || fileUrl.includes('catbox') || fileUrl.includes('cdn');
      let label = isPhoto ? '📷 Foto Lampiran' : '📎 Lampiran Dokumen / File';
      let fullMessage = (message ? (message + "\n\n") : "") + `${label}:\n${fileUrl}`;

      await whacenter.kirimPesan(deviceId, cleanNo, fullMessage);
      googleService.setPengamatMode24Jam(cleanNo);
      googleService.tambahRiwayatPercakapan(cleanNo, "doctor", message || label, { mediaUrl: fileUrl });
    } else {
      await whacenter.kirimPesan(deviceId, cleanNo, message);
      googleService.setPengamatMode24Jam(cleanNo);
      googleService.tambahRiwayatPercakapan(cleanNo, "doctor", message);
    }
    // 📊 Pantau via Dashboard - tidak perlu notifikasi Telegram untuk pesan keluar

    return res.json({ status: "OK", account: chosenAccount });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/toggle-ai-status', async (req, res) => {
  try {
    let { number } = req.body || {};
    if (!number) return res.status(400).json({ error: "Nomor tidak boleh kosong" });

    let cleanNo = whacenter.formatNomorWA(number);
    let paused = googleService.isModePengamat(cleanNo);
    if (paused) {
      googleService.unsetPengamatMode(cleanNo);
    } else {
      googleService.setPengamatMode24Jam(cleanNo);
    }

    broadcastRealtimeUpdate('REFRESH_DASHBOARD', { number: cleanNo, isPaused: !paused });
    return res.json({ status: "OK", isPaused: !paused });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/save-contact', async (req, res) => {
  try {
    let { number, name, category } = req.body || {};
    if (!number || !name) return res.status(400).json({ error: "Nomor atau nama tidak boleh kosong" });

    let cleanNo = whacenter.formatNomorWA(number);
    await googleService.simpanKontakSheet(cleanNo, name, category || "Kontak Terdaftar");
    return res.json({ status: "OK" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// WhaCenter WhatsApp Webhook Endpoint
app.post('/', async (req, res) => {
  return handleWhaCenterWebhook(req, res);
});

app.post('/api/whacenter-webhook', async (req, res) => {
  return handleWhaCenterWebhook(req, res);
});

async function handleWhaCenterWebhook(req, res) {
  try {
    let data = req.body || {};

    if (data.update_id || (data.message && typeof data.message === 'object') || data.callback_query) {
      await telegramService.prosesWebhookTelegram(data);
      return res.json({ status: "Telegram Update Handled" });
    }

    // 1. EXTRACTION + NORMALISASI NOMOR TELEPON (Mencegah split key thread)
    let pengirimRaw = (data.from || data.sender || data.phone || "").toString().trim();
    let penerimaRaw = (data.to   || data.receiver || "").toString().trim();
    
    if (!pengirimRaw) {
      return res.json({ status: "No sender number" });
    }

    let pengirim = whacenter.formatNomorWA(pengirimRaw);
    let penerima = whacenter.formatNomorWA(penerimaRaw);

    // 2. CEK MULTI-PAYLOAD KUNCI PESAN (Mencegah pesan terbuang jika payload menggunakan 'text'/'caption'/'body')
    let pesanMasuk = (data.message || data.text || data.caption || data.body || data.msg || "").toString().trim();
    let mediaUrl   = (data.media || data.mediaUrl || data.url || data.file || "").toString().trim();

    // Prevent Bot Self-Loop
    if (pengirim.includes("81291868456") || pengirim.includes("81398169819")) {
      return res.json({ status: "Loop dicegah" });
    }

    // Tentukan Akun (Dylan vs Nafila)
    let queryAkun = (req.query && req.query.akun) ? req.query.akun.toLowerCase() : "";
    let akun = "dylan";
    let cleanPenerima = (penerima || "").replace(/\D/g, "");

    if (queryAkun === "nafila" || cleanPenerima.includes("81398169819")) {
      akun = "nafila";
    } else if (queryAkun === "dylan" || cleanPenerima.includes("81291868456")) {
      akun = "dylan";
    }

    // Save Account Type untuk Kontak
    googleService.setContactAccountType(pengirim, akun);

    // 3. CEK NOMOR PENGECUALIAN / VIP (Bot diam 100%, TAPI TETAP CATAT DAN TAMPILKAN DI DASHBOARD!)
    let isVIP = await googleService.isNomorPengecualian(pengirim);
    if (isVIP) {
      console.log("Nomor Pengecualian (VIP/Keluarga):", pengirim, ". Bot diam 100%, tapi pesan tetap disimpan ke Dashboard.");
      await googleService.logPesanSheet(data, akun);
      googleService.tambahRiwayatPercakapan(pengirim, "user", pesanMasuk || "📷 Media / Lampiran (VIP)", { mediaUrl: mediaUrl || '' });
      return res.json({ status: "Nomor Pengecualian / VIP - Tersimpan di Dashboard" });
    }

    // 4. JIKA PASIEN MENGIRIM GAMBAR / FOTO / MEDIA → BOT DIAM, TAPI SIMPAN & TAMPILKAN DI DASHBOARD
    let isPhoto = mediaUrl || (pesanMasuk && (pesanMasuk.toLowerCase().includes("http") && (pesanMasuk.toLowerCase().includes(".jpg") || pesanMasuk.toLowerCase().includes(".png") || pesanMasuk.toLowerCase().includes(".jpeg"))));
    if (isPhoto) {
      console.log("📷 Pasien mengirim foto/gambar:", pengirim, ". Bot DIAM, simpan ke dashboard.");
      await googleService.logPesanSheet(data, akun);
      googleService.tambahRiwayatPercakapan(pengirim, "user", pesanMasuk || "📷 Foto / Gambar", { mediaUrl: mediaUrl || '' });
      return res.json({ status: "Gambar Diterima - Bot Diam, Tersimpan di Dashboard" });
    }

    // Log ke Sheets
    await googleService.logPesanSheet(data, akun);

    // Fallback jika pesanKosong (misal lokasi / sticker / vcard) → Beri label fallback agar tidak di-drop!
    if (!pesanMasuk) {
      pesanMasuk = "📎 [Pesan Lampiran / Format Lain]";
    }

    let dataSOP = await googleService.bacaSOP(akun);
    let infoKontak = await googleService.getDetailPetugasAtauKontak(pengirim);
    let isPengamat = googleService.isModePengamat(pengirim);
    let masterAiActive = googleService.isMasterAiActive(akun);

    let riwayat = googleService.getRiwayatPercakapan(pengirim);
    
    // CATAT PESAN MASUK KE MEMORY & DASHBOARD REAL-TIME
    googleService.tambahRiwayatPercakapan(pengirim, "user", pesanMasuk);

    let jawabanAI = "";
    
    if (masterAiActive && !isPengamat) {
      jawabanAI = await aiService.panggilDualAIEngine(pengirim, pesanMasuk, null, dataSOP, akun, infoKontak, riwayat);
      if (jawabanAI && jawabanAI.trim() !== "") {
        let deviceId = (akun === "nafila") ? config.WA_NAFILA : config.WA_DYLAN;
        
        let bubbles = jawabanAI.split('|||').map(b => b.trim()).filter(b => b !== '');
        if (bubbles.length === 0) bubbles = [jawabanAI];

        for (let b of bubbles) {
          googleService.tambahRiwayatPercakapan(pengirim, "assistant", b);
          try {
            await whacenter.kirimPesan(deviceId, pengirim, b);
          } catch (eKirim) {
            console.error("WhaCenter Kirim Pesan Exception:", eKirim.message);
          }
          await new Promise(r => setTimeout(r, 600));
        }

        jawabanAI = bubbles.join("\n");
      }
    }

    return res.json({ status: "OK" });

  } catch (err) {
    console.error("WhaCenter Webhook Error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// Telegram Webhook Endpoint
app.post('/api/telegram-webhook', async (req, res) => {
  try {
    let data = req.body || {};
    await telegramService.prosesWebhookTelegram(data);
    return res.json({ status: "OK" });
  } catch (err) {
    console.error("Telegram Endpoint Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/set-telegram-webhook', async (req, res) => {
  try {
    let host = req.headers.host;
    let protocol = req.headers['x-forwarded-proto'] || 'https';
    let webhookUrl = `${protocol}://${host}/api/telegram-webhook`;
    let result = await telegramService.setTelegramWebhook(webhookUrl);
    return res.json({ webhookUrl, result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log(`Jarvis Bot Engine running locally on port ${config.PORT}`);
  });
}

module.exports = app;
