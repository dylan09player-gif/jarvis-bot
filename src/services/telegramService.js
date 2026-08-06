const axios = require('axios');
const config = require('../config');
const whacenter = require('./whacenterService');
const googleService = require('./googleService');
const aiService = require('./aiService');

let lastTargetWA = new Map();

async function kirimTelegram(chatId, isiPesan) {
  if (!chatId) return;
  try {
    let url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
    let payload = {
      chat_id: chatId,
      text: isiPesan,
      parse_mode: "Markdown"
    };
    await axios.post(url, payload, { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Kirim Telegram Error:", err.message);
  }
}

async function kirimNotifikasiTelegramDylan(pengirim, pesanMasuk, jawabanAI, infoKontak) {
  let chatId = await googleService.getTelegramChatId();
  if (!chatId) {
    console.log("Telegram notif skipped: TELEGRAM_CHAT_ID_DOKTER is empty. Please send /start to bot in Telegram.");
    return;
  }

  let cleanNo = whacenter.formatNomorWA(pengirim);
  let namaLabel = infoKontak.isKnown ? `${infoKontak.nama} (${infoKontak.jabatan})` : `${cleanNo} *(Belum Disimpan)*`;

  lastTargetWA.set(chatId.toString(), cleanNo);

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
    notifText += "\n👉 *Balas notif ini di Telegram untuk meneruskan pesan Dokter langsung ke WhatsApp (AI otomatis Jeda 24 Jam).*";
  }

  await kirimTelegram(chatId, notifText);
}

async function prosesWebhookTelegram(data) {
  try {
    let msg = data.message;
    if (!msg || typeof msg !== 'object') return;

    let chatId = msg.chat ? msg.chat.id : null;
    if (!chatId) return;
    let text = msg.text || "";
    let replyToMsg = msg.reply_to_message;

    await googleService.setTelegramChatId(chatId);

    if (text === "/start") {
      await kirimTelegram(chatId, "🤖 *Jarvis Assistant dr. Dylan Aktif!*\n\nSelamat datang Dok! Semua pesan WhatsApp ke dr. Dylan akan diteruskan ke Telegram ini.\n\n*Cara Penggunaan*:\n1. **Balas WA**: Cukup gunakan fitur **Reply** pada notifikasi pesan masuk di Telegram ini.\n2. **Auto Jeda 24 Jam**: Begitu Dokter membalas via Telegram/Dashboard, AI otomatis *pause* (Jeda 24 jam) untuk kontak itu.\n3. **Simpan Kontak Baru**: Jika ada nomor baru, balas notifikasi dengan nama & statusnya (contoh: *\"Ini Pak Budi Pasien LBP\"*), AI akan menyimpannya ke Google Sheet `Kontak_Dylan`!");
      return;
    }

    if (text === "/status") {
      await kirimTelegram(chatId, "📊 *Status Sistem Jarvis*:\n• WA Dylan: Connected\n• Bot Telegram: Connected\n• Dual AI Engine: DeepSeek V4 + Gemini 3.6\n• Host: Vercel Serverless Node.js");
      return;
    }

    let targetNoWA = null;
    if (replyToMsg && replyToMsg.text) {
      let replyText = replyToMsg.text;
      let matchNo = replyText.match(/(?:📱|Nomor WA|No WA|Nomor):\s*(\+?62\d+|08\d+)/i) || replyText.match(/(628\d{8,12}|08\d{8,12})/);
      if (matchNo) {
        targetNoWA = whacenter.formatNomorWA(matchNo[1]);
      }
    }

    if (!targetNoWA && lastTargetWA.has(chatId.toString())) {
      targetNoWA = lastTargetWA.get(chatId.toString());
    }

    if (!targetNoWA) {
      await kirimTelegram(chatId, "⚠️ *Nomor WA tujuan tidak ditemukan.*\nMohon gunakan fitur **Reply / Balas** pada pesan notifikasi WA yang ingin Dokter jawab.");
      return;
    }

    let infoKontak = await googleService.getDetailPetugasAtauKontak(targetNoWA);

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
      let parsed = await aiService.parseKontakDenganAI(text, targetNoWA);
      await googleService.simpanKontakSheet(targetNoWA, parsed.nama, parsed.kategori);
      await kirimTelegram(chatId, "✅ *Kontak Berhasil Disimpan ke Google Sheet `Kontak_Dylan`!*\n• **Nama**: " + parsed.nama + "\n• **Nomor**: " + targetNoWA + "\n• **Status**: " + parsed.kategori);
    } else {
      await whacenter.kirimPesan(config.WA_DYLAN, targetNoWA, text);
      
      // JEDA 24 JAM OTOMATIS SAAT DOKTER BALAS VIA TELEGRAM
      googleService.setPengamatMode24Jam(targetNoWA);
      googleService.tambahRiwayatPercakapan(targetNoWA, "doctor", text);

      let namaTarget = infoKontak.nama || targetNoWA;
      await kirimTelegram(chatId, "🚀 *Pesan Terkirim ke WA " + namaTarget + "!*\n💬 *" + text + "*\n\n⏸️ *AI Otomatis JEDA 24 JAM* untuk nomor " + namaTarget + ".");
    }
  } catch (err) {
    console.error("Telegram Webhook Process Error:", err.message);
  }
}

async function setTelegramWebhook(webhookUrl) {
  try {
    let url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
    let response = await axios.get(url);
    return response.data;
  } catch (err) {
    console.error("Set Telegram Webhook Error:", err.message);
    return null;
  }
}

module.exports = {
  kirimTelegram,
  kirimNotifikasiTelegramDylan,
  prosesWebhookTelegram,
  setTelegramWebhook
};
