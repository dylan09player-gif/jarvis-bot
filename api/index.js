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

app.post('/api/send-doctor-message', async (req, res) => {
  try {
    let { number, message } = req.body || {};
    if (!number || !message) return res.status(400).json({ error: "Nomor atau pesan tidak boleh kosong" });

    let cleanNo = whacenter.formatNomorWA(number);
    await whacenter.kirimPesan(config.WA_DYLAN, cleanNo, message);

    // AI JEDA 24 JAM OTOMATIS SAAT DOKTER BALAS MANUAL
    googleService.setPengamatMode24Jam(cleanNo);
    googleService.tambahRiwayatPercakapan(cleanNo, "doctor", message);

    let chatId = await googleService.getTelegramChatId();
    if (chatId) {
      await telegramService.kirimTelegram(chatId, "🚀 *Pesan Dokter Terkirim via Dashboard ke WA " + cleanNo + "*:\n💬 *" + message + "*\n\n⏸️ *AI Otomatis JEDA 24 JAM*.");
    }

    return res.json({ status: "OK" });
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

    await googleService.logPesanSheet(data, akun);

    if (!pesanMasuk && !mediaUrl) {
      return res.json({ status: "Kosong" });
    }

    let dataSOP = await googleService.bacaSOP(akun);
    let infoKontak = await googleService.getDetailPetugasAtauKontak(pengirim);
    let isPengamat = googleService.isModePengamat(pengirim);
    let riwayat = googleService.getRiwayatPercakapan(pengirim);

    googleService.tambahRiwayatPercakapan(pengirim, "user", pesanMasuk);

    let jawabanAI = "";
    if (!isPengamat) {
      jawabanAI = await aiService.panggilDualAIEngine(pengirim, pesanMasuk, mediaUrl, dataSOP, akun, infoKontak, riwayat);
      if (jawabanAI && jawabanAI.trim() !== "") {
        let deviceId = (akun === "nafila") ? config.WA_NAFILA : config.WA_DYLAN;
        await whacenter.kirimPesan(deviceId, pengirim, jawabanAI);
        googleService.tambahRiwayatPercakapan(pengirim, "assistant", jawabanAI);
      }
    }

    if (akun === "dylan") {
      await telegramService.kirimNotifikasiTelegramDylan(pengirim, pesanMasuk, isPengamat ? "⏸️ (MODE PENGAMAT / JEDA 24 JAM - Dokter Balas Manual)" : jawabanAI, infoKontak);
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
    console.error("Telegram Endpoint Error:", err);
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
