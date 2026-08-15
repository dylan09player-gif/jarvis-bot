const axios = require('axios');
const config = require('../config');

// Kirim pesan TEKS ke WhatsApp via WhaCenter
async function kirimPesan(deviceId, nomorTujuan, isiPesan) {
  try {
    let url = "https://app.whacenter.com/api/send";
    let payload = {
      device_id: deviceId,
      number: nomorTujuan,
      message: isiPesan
    };
    let response = await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 12000
    });
    return response.data;
  } catch (error) {
    console.error("WhaCenter Send Error:", error.message);
    return null;
  }
}

// Kirim GAMBAR / FILE ke WhatsApp via WhaCenter (fileUrl harus URL publik)
async function kirimMedia(deviceId, nomorTujuan, caption, fileUrl) {
  try {
    let url = "https://app.whacenter.com/api/send";
    let payload = {
      device_id: deviceId,
      number: nomorTujuan,
      message: caption || "",
      file: fileUrl,
      url: fileUrl,
      file_url: fileUrl
    };
    let response = await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 12000
    });
    return response.data;
  } catch (error) {
    console.error("WhaCenter Send Media Error:", error.message);
    return null;
  }
}

function formatNomorWA(nomor) {
  if (!nomor) return "";
  let clean = nomor.toString().replace(/\D/g, "");
  if (clean.startsWith("0")) clean = "62" + clean.substring(1);
  return clean;
}

// BROADCAST JADWAL KONSULTASI ONLINE DENGAN PILIHAN DOKTER & CHECKLIST PENERIMA
async function broadcastJadwalKonsultasiOnline(dataPasien) {
  let deviceId = config.WA_NAFILA;
  let { 
    nama, 
    nik, 
    nomor_wa, 
    jam_konsultasi, 
    meet_url, 
    keluhan, 
    nama_dokter, 
    nomor_dokter,
    kirim_ke_pasien = true,
    kirim_ke_dokter = true,
    kirim_ke_apotik = true,
    kirim_ke_klinik = true
  } = dataPasien;
  
  let dokterName = nama_dokter || "dr. Dylan";
  let targetPasien = formatNomorWA(nomor_wa);
  let targetDokter = formatNomorWA(nomor_dokter || config.NOMOR_DOKTER);
  let targetKlinik = formatNomorWA(config.NOMOR_KLINIK);
  let targetApotik = formatNomorWA(config.NOMOR_APOTIK);

  // 1. Pesan ke Pasien
  let msgPasien = `🔔 *JADWAL KONSULTASI ONLINE — KLINIK NAFILA MEDIKA*\n\nHalo Kak *${nama}*,\nPendaftaran Konsultasi Online Anda telah terkonfirmasi! ✅\n\n📅 *Jadwal Konsultasi*: ${jam_konsultasi}\n👨‍⚕️ *Dokter Pemeriksa*: ${dokterName}\n🩺 *Keluhan*: ${keluhan}\n\n💻 *Link Video Call (Google Meet)*:\n${meet_url}\n\n*Petunjuk*:\nSilakan klik link Google Meet di atas 5 menit sebelum jadwal. Dokter akan menyapa Anda di ruang Meet. Terima kasih 🙏`;

  // 2. Pesan ke Dokter
  let msgDokter = `🩺 *JADWAL KONSULTASI TELEMEDIS DOKTER (NAFILA MEDIKA)*\n\nHalo Dokter *${dokterName}*,\nAda jadwal konsultasi online pasien:\n\n👤 Pasien: *${nama}* (NIK: ${nik || '-'})\n📞 WA Pasien: https://wa.me/${targetPasien}\n📅 Waktu: *${jam_konsultasi}*\n💬 Keluhan: ${keluhan}\n\n💻 *Link Google Meet Dokter*:\n${meet_url}\n\nMohon bersiap di jam tersebut Dokter. Terima kasih 🙏`;

  // 3. Pesan ke Klinik Frontdesk
  let msgKlinik = `🏥 *LOG TELEMEDIS TERJADWAL*\n\nPasien *${nama}* telah dijadwalkan Konsultasi Online bersama *${dokterName}* pada *${jam_konsultasi}*.\nLink Meet: ${meet_url}`;

  // 4. Pesan ke Apotik
  let msgApotik = `💊 *ALERT APOTIK TELEMEDIS*\n\nAda jadwal Konsultasi Online: *${nama}* bersama *${dokterName}* (${jam_konsultasi}). Tim farmasi mohon bersiap menerima resep obat setelah sesi konsultasi selesai.`;

  try {
    if (kirim_ke_pasien && targetPasien) await kirimPesan(deviceId, targetPasien, msgPasien);
    if (kirim_ke_dokter && targetDokter) await kirimPesan(deviceId, targetDokter, msgDokter);
    if (kirim_ke_klinik && targetKlinik) await kirimPesan(deviceId, targetKlinik, msgKlinik);
    if (kirim_ke_apotik && targetApotik) await kirimPesan(deviceId, targetApotik, msgApotik);
    console.log("✅ Broadcast WA Berhasil Terkirim ke Pihak Terpilih!");
    return true;
  } catch(e) {
    console.error("Broadcast WA error:", e.message);
    return false;
  }
}

// KIRIM BILLING OBAT & ONGKIR SERTA LINK TRACKING OJOL
async function kirimBillingDanTrackingOjol(nomorWA, namaPasien, rincianObat, biayaObat, ongkir, jarakKm, trackingUrl = "", pdfUrl = "", gmapsUrl = "", items = []) {
  let deviceId = config.WA_NAFILA;
  let target = formatNomorWA(nomorWA);
  let subtotal = parseInt(biayaObat) || 0;
  let ongkirNominal = parseInt(ongkir) || 0;
  let total = subtotal + ongkirNominal;

  let msg = "";
  if (!trackingUrl) {
    let itemsText = "";
    if (items && Array.isArray(items) && items.length > 0) {
      itemsText = items.map((it, idx) => {
        let hargaStr = (parseInt(it.harga) || 0).toLocaleString('id-ID');
        let qtyStr = it.qty ? ` (${it.qty})` : '';
        return `${idx + 1}. *${it.nama}*${qtyStr} : Rp ${hargaStr}`;
      }).join('\n');
    } else {
      itemsText = rincianObat || "-";
    }

    msg = `🏥 *KLINIK NAFILA MEDIKA*\n_Layanan Telemedis & Farmasi Online_\n━━━━━━━━━━━━━━━━━━━━\n\nHalo Bpk/Ibu *${namaPasien}*,\nKonsultasi online Anda telah selesai. Berikut adalah rincian tagihan resep obat & layanan farmasi:\n\n📋 *RINCIAN TAGIHAN:*\n${itemsText}\n\n💰 *TOTAL PEMBAYARAN:*\n• Subtotal Layanan : Rp ${subtotal.toLocaleString('id-ID')}\n• Ongkos Kirim Ojol: Rp ${ongkirNominal.toLocaleString('id-ID')} _(Jarak ~${jarakKm || 0} KM)_\n━━━━━━━━━━━━━━━━━━━━\n👉 *TOTAL TRANSFER : Rp ${total.toLocaleString('id-ID')}*\n━━━━━━━━━━━━━━━━━━━━\n\n💳 *REKENING PEMBAYARAN:*\n• *Bank Mandiri*: *1730002202969*\n  a.n. *Nafila*\n• *QRIS*: _(Dapat diminta bila bayar via E-Wallet/GoPay/Shopee/OVO/Dana)_\n${pdfUrl ? `\n📎 *Lampiran Resep / Invoice PDF:*\n${pdfUrl}\n` : ''}${gmapsUrl ? `\n📍 *Alamat Antar:* ${gmapsUrl}\n` : ''}\n_Mohon kirimkan bukti transfer ke nomor ini ya kak. Setelah terverifikasi, obat akan segera disiapkan & dipesankan kurir Grab/Gojek ke alamat Anda._ 🙏\n\n*Apotik Klinik Nafila*: 0852-1071-0328`;
  } else {
    msg = `🛵 *OBAT DALAM PENGIRIMAN OJEK ONLINE — KLINIK NAFILA MEDIKA*\n━━━━━━━━━━━━━━━━━━━━\n\nHalo Bpk/Ibu *${namaPasien}*,\nPembayaran obat & pengantaran telah terkonfirmasi lunas! ✅\nObat telah disiapkan dan sedang dalam perjalanan diantar oleh kurir Grab/Gojek.\n\n📍 *Lacak Perjalanan Driver Ojol Real-time:*\n${trackingUrl}\n\nMohon pastikan nomor telepon aktif saat kurir tiba di lokasi. Terima kasih & lekas sembuh! 🌸🙏\n*Apotik Klinik Nafila*: 0852-1071-0328`;
  }

  return await kirimPesan(deviceId, target, msg);
}

module.exports = {
  kirimPesan,
  kirimMedia,
  formatNomorWA,
  broadcastJadwalKonsultasiOnline,
  kirimBillingDanTrackingOjol
};

