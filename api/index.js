const express = require('express');
const cors = require('cors');
const config = require('../src/config');
const whacenter = require('../src/services/whacenterService');
const googleService = require('../src/services/googleService');
const aiService = require('../src/services/aiService');
const telegramService = require('../src/services/telegramService');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root Health Check Route
app.get('/', (req, res) => {
  res.send({
    status: "OK",
    service: "Jarvis Bot Engine (Node.js)",
    account_dylan: config.NOMOR_DOKTER,
    account_nafila: config.NOMOR_KLINIK,
    timestamp: new Date().toISOString()
  });
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

    // Deteksi jika request dikirim oleh Telegram Webhook (Telegram update_id atau message object)
    if (data.update_id || (data.message && typeof data.message === 'object') || data.callback_query) {
      await telegramService.prosesWebhookTelegram(data);
      return res.json({ status: "Telegram Update Handled" });
    }

    let pengirim   = data.from    || "";
    let penerima   = data.to      || "";
    let pesanMasuk = data.message || "";
    let mediaUrl   = data.media   || "";

    // Anti-loop
    if (pengirim.includes("81291868456") || pengirim.includes("81398169819")) {
      return res.json({ status: "Loop dicegah" });
    }

    // PENGECUALIAN (Keluarga / VIP / Blacklist 100% Diam)
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

    let jawabanAI = "";
    if (!isPengamat) {
      jawabanAI = await aiService.panggilDualAIEngine(pengirim, pesanMasuk, mediaUrl, dataSOP, akun, infoKontak, riwayat);
      if (jawabanAI && jawabanAI.trim() !== "") {
        let deviceId = (akun === "nafila") ? config.WA_NAFILA : config.WA_DYLAN;
        await whacenter.kirimPesan(deviceId, pengirim, jawabanAI);

        // Simpan percakapan ke memori konteks AI
        googleService.tambahRiwayatPercakapan(pengirim, "user", pesanMasuk);
        googleService.tambahRiwayatPercakapan(pengirim, "assistant", jawabanAI);
      }
    }

    if (akun === "dylan") {
      await telegramService.kirimNotifikasiTelegramDylan(pengirim, pesanMasuk, isPengamat ? "⏸️ (MODE PENGAMAT - Bot Diam Karena Dokter Sudah Balas)" : jawabanAI, infoKontak);
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

// Helper route untuk set Telegram Webhook
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
