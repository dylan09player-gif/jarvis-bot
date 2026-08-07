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
      file_url: fileUrl,
      url: fileUrl
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

module.exports = {
  kirimPesan,
  kirimMedia,
  formatNomorWA
};
