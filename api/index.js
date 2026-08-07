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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let dashboardHtmlContent = "";
try {
  dashboardHtmlContent = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
} catch (e) {
  console.error("Initial read dashboard HTML error:", e.message);
}

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

// Render Dashboard Web App UI
app.get('/dashboard', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  if (dashboardHtmlContent) {
    return res.send(dashboardHtmlContent);
  }
  try {
    let content = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
    return res.send(content);
  } catch (e) {
    return res.status(500).send("Dashboard HTML not found: " + e.message);
  }
});

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
    let { account, pemicu, polaPikir, contohBalasan } = req.body || {};
    let akun = account || "dylan";
    
    if (!pemicu) return res.status(400).json({ error: "Aturan / Poin SOP tidak boleh kosong" });

    await googleService.tambahSOPBaru(pemicu, polaPikir || "Aturan Tambahan via Dashboard", contohBalasan || "-", akun);
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

app.post('/api/toggle-master-ai', async (req, res) => {
  try {
    let { account, status } = req.body || {};
    if (!account) return res.status(400).json({ error: "Account wajib diisi ('dylan' atau 'nafila')" });

    let updatedStatuses = googleService.setMasterAiStatus(account, status);
    return res.json({ status: "OK", masterAiStatus: updatedStatuses });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/send-doctor-message', async (req, res) => {
  try {
    let { number, message, senderAccount } = req.body || {};
    if (!number || !message) return res.status(400).json({ error: "Nomor atau pesan tidak boleh kosong" });

    // RUANG DISKUSI KHUSUS 🤖 JARVIS ASSISTANT
    if (number === "JARVIS_AI_ASSISTANT" || number.includes("JARVIS")) {
      googleService.tambahRiwayatPercakapan("JARVIS_AI_ASSISTANT", "doctor", message);

      let dataSOPDylan = await googleService.bacaSOP("dylan");
      let dataSOPKlinik = await googleService.bacaSOP("nafila");
      let calendarData = await googleService.bacaGoogleCalendar();
      let tasksData = await googleService.bacaGoogleTasks();

      let promptInternal = `Kamu adalah Jarvis, Asisten Pribadi Cerdas dr. Dylan.
Dokter Dylan sedang berbicara langsung denganmu di ruang diskusi internal.

=== ATURAN BALASAN MANDATORI ===
1. BALASAN WAJIB SINGKAT, PADAT, DAN ALAMI:
   - Maksimal 1-2 kalimat pendek saja per pesan.
   - DILARANG MEMBUAT PARAGRAF PANJANG / WALL OF TEXT!
   - DILARANG menggunakan markdown formal seperti **, ---, #, 1., 2.
2. JIKA ADA LEBIH DARI 1 POIN ➔ PISAHKAN DENGAN SIMBOL '|||' agar terpecah menjadi bubble chat terpisah!

=== DATA SOP DR. DYLAN (PERSONAL) ===
${dataSOPDylan}

=== DATA SOP OPERASIONAL KLINIK NAFILA MEDIKA ===
${dataSOPKlinik}

=== DATA GOOGLE CALENDAR MINGGU INI ===
${calendarData}

=== DATA CATATAN GOOGLE TASKS ===
${tasksData}`;

      let riwayat = googleService.getRiwayatPercakapan("JARVIS_AI_ASSISTANT");
      let jawabanAI = await aiService.panggilDualAIEngine("JARVIS_INTERNAL", message, null, promptInternal, "dylan", { isKnown: true, nama: "dr. Dylan", jabatan: "Dokter / Owner" }, riwayat);

      if (jawabanAI) {
        let bubbles = jawabanAI.split('|||').map(b => b.trim()).filter(b => b !== '');
        if (bubbles.length === 0) bubbles = [jawabanAI];

        for (let b of bubbles) {
          googleService.tambahRiwayatPercakapan("JARVIS_AI_ASSISTANT", "assistant", b);
        }
        
        if (message.toLowerCase().includes("sop") || message.toLowerCase().includes("catat") || message.toLowerCase().includes("aturan")) {
          await googleService.tambahSOPBaru(message, "Aturan Diskusi Langsung Dokter", jawabanAI.substring(0, 100));
        }
      }

      return res.json({ status: "OK" });
    }

    let cleanNo = whacenter.formatNomorWA(number);
    let chosenAccount = senderAccount || "dylan";
    let deviceId = (chosenAccount === "nafila") ? config.WA_NAFILA : config.WA_DYLAN;

    googleService.setContactAccountType(cleanNo, chosenAccount);

    await whacenter.kirimPesan(deviceId, cleanNo, message);

    googleService.setPengamatMode24Jam(cleanNo);
    googleService.tambahRiwayatPercakapan(cleanNo, "doctor", message);
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

    let pengirim   = data.from    || "";
    let penerima   = data.to      || "";
    let pesanMasuk = data.message || "";
    let mediaUrl   = data.media   || "";

    if (pengirim.includes("81291868456") || pengirim.includes("81398169819")) {
      return res.json({ status: "Loop dicegah" });
    }

    let isVIP = await googleService.isNomorPengecualian(pengirim);
    if (isVIP) {
      console.log("Nomor Pengecualian (VIP/Keluarga):", pengirim, ". Bot diam 100%.");
      return res.json({ status: "Nomor Pengecualian / VIP" });
    }

    let queryAkun = (req.query && req.query.akun) ? req.query.akun.toLowerCase() : "";
    let akun = "dylan";
    let cleanPenerima = (penerima || "").toString().replace(/\D/g, "");

    if (queryAkun === "nafila" || cleanPenerima.includes("81398169819")) {
      akun = "nafila";
    } else if (queryAkun === "dylan" || cleanPenerima.includes("81291868456")) {
      akun = "dylan";
    }

    // MANDATORI: JIKA PASIEN MENGIRIM GAMBAR / FOTO ➔ BOT DIAM 100% (JANGAN BALAS SAMA SEKALI!)
    if (mediaUrl || (pesanMasuk && (pesanMasuk.toLowerCase().includes("http") && (pesanMasuk.toLowerCase().includes(".jpg") || pesanMasuk.toLowerCase().includes(".png") || pesanMasuk.toLowerCase().includes(".jpeg"))))) {
      console.log("📷 Pasien mengirim foto/gambar:", pengirim, ". Bot DIAM 100% sesuai instruksi dr. Dylan.");
      
      await googleService.logPesanSheet(data, akun);
      let infoKontak = await googleService.getDetailPetugasAtauKontak(pengirim);
      
      googleService.tambahRiwayatPercakapan(pengirim, "user", pesanMasuk || "(Foto / Gambar)");

      if (akun === "dylan") {
        await telegramService.kirimNotifikasiTelegramDylan(pengirim, pesanMasuk || "(Foto / Gambar)", "📷 [FOTO DITERIMA] - Bot DIAM 100% (Tidak Membalas Sesuai Instruksi Dokter).", infoKontak);
      }

      return res.json({ status: "Gambar Diterima - Bot Diam 100%" });
    }

    await googleService.logPesanSheet(data, akun);

    if (!pesanMasuk) {
      return res.json({ status: "Kosong" });
    }

    let dataSOP = await googleService.bacaSOP(akun);
    let infoKontak = await googleService.getDetailPetugasAtauKontak(pengirim);
    let isPengamat = googleService.isModePengamat(pengirim);
    let masterAiActive = googleService.isMasterAiActive(akun);

    let riwayat = googleService.getRiwayatPercakapan(pengirim);
    googleService.tambahRiwayatPercakapan(pengirim, "user", pesanMasuk);

    let jawabanAI = "";
    
    if (masterAiActive && !isPengamat) {
      // ✅ FIX BUG: `infoKontak` bukan `infoPetugas` (infoPetugas tidak pernah dideklarasikan!)
      jawabanAI = await aiService.panggilDualAIEngine(pengirim, pesanMasuk, null, dataSOP, akun, infoKontak, riwayat);
      if (jawabanAI && jawabanAI.trim() !== "") {
        let deviceId = (akun === "nafila") ? config.WA_NAFILA : config.WA_DYLAN;
        
        let bubbles = jawabanAI.split('|||').map(b => b.trim()).filter(b => b !== '');
        if (bubbles.length === 0) bubbles = [jawabanAI];

        for (let b of bubbles) {
          // CATAT KE DASHBOARD DISKUSI
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

    // 📊 Monitoring dipusatkan di Dashboard - tidak perlu kirim notifikasi Telegram per pesan
    // Telegram tetap bisa dipakai untuk BALAS WA via telegramService webhook (fitur tetap aktif)

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
