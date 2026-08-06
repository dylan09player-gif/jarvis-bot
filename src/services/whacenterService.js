const axios = require('axios');
const config = require('../config');

async function kirimPesan(deviceId, nomorTujuan, isiPesan) {
  try {
    let url = "https://app.whacenter.com/api/send";
    let payload = {
      device_id: deviceId,
      number: nomorTujuan,
      message: isiPesan
    };
    let response = await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" }
    });
    return response.data;
  } catch (error) {
    console.error("WhaCenter Send Error:", error.message);
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
  formatNomorWA
};
