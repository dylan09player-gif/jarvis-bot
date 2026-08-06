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
  let chatId = googleService.getTelegramChatId();
  if (!chatId) return;

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
    notifText += "\n👉 *Balas notif ini di Telegram untuk meneruskan pesan Dokter langsung ke WhatsApp.*";
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

    // Simpan Chat ID Dokter secara otomatis
    googleService.setTelegramChatId(chatId);

    if (text === "/start") {
      await kirimTelegram(chatId, "🤖 *Jarvis Assistant dr. Dylan Aktif!*\n\nSelamat datang Dok! Semua pesan WhatsApp ke dr. Dylan akan diteruskan ke Telegram ini.\n\n*Cara Penggunaan*:\n1. **Balas WA**: Cukup gunakan fitur **Reply** pada notifikasi pesan masuk di Telegram ini.\n2. **Auto Mode Pengamat**: Begitu Dokter membalas via Telegram, AI otomatis *pause* (mode Pengamat) di hari tersebut untuk kontak itu.\n3. **Simpan Kontak Baru**: Jika ada nomor baru, balas notifikasi dengan nama & statusnya (contoh: *\"Ini Pak Budi Pasien LBP\"*), AI akan menyimpannya ke Google Sheet `Kontak_Dylan`!");
      return;
    }

    if (text === "/status") {
      await kirimTelegram(chatId, "📊 *Status Sistem Jarvis*:\n• WA Dylan: Connected\n• Bot Telegram: Connected\n• Dual AI Engine: DeepSeek V4 + Gemini 3.6\n• Host: Vercel Serverless Node.js");
      return;
    }

    // Cari nomor WA tujuan dari reply Telegram atau cache
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

    // Cek apakah pesan Dokter adalah untuk Menyimpan Kontak Baru
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
      // Kirim balasan Dokter langsung ke WA pasien via WhaCenter
      await whacenter.kirimPesan(config.WA_DYLAN, targetNoWA, text);

      // Otomatis aktifkan Mode Pengamat (AI Paused) untuk nomor ini di hari ini
      googleService.setPengamatModeHariIni(targetNoWA);

      let namaTarget = infoKontak.nama || targetNoWA;
      await kirimTelegram(chatId, "🚀 *Pesan Terkirim ke WA " + namaTarget + "!*\n💬 *" + text + "*\n\n⏸️ *AI Otomatis Mode Pengamat* (diam) untuk nomor " + namaTarget + " sampai akhir hari ini.");
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
