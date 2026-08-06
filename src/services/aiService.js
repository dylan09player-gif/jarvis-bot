const axios = require('axios');
const config = require('../config');

async function panggilDualAIEngine(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas, riwayat) {
  try {
    let jawabanDeepseek = await tanyaDeepseek(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas, riwayat);
    if (jawabanDeepseek && jawabanDeepseek.trim() !== "") {
      return jawabanDeepseek;
    }
  } catch (errDS) {
    console.error("DeepSeek API Fail:", errDS.response ? errDS.response.data : errDS.message);
  }

  try {
    console.log("Menggunakan GEMINI AI BACKUP untuk:", pengirim);
    let jawabanGemini = await tanyaGemini(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas, riwayat);
    if (jawabanGemini && jawabanGemini.trim() !== "") {
      return jawabanGemini;
    }
  } catch (errGem) {
    console.error("Gemini API Fail:", errGem.response ? errGem.response.data : errGem.message);
  }

  return "Mohon maaf, sistem AI kami sedang sibuk. Silakan kirim ulang pesan Anda beberapa saat lagi 🙏";
}

async function tanyaDeepseek(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas, riwayat) {
  let url = "https://api.deepseek.com/chat/completions";
  let systemPrompt = buildSystemPrompt(dataSOP, akun, infoPetugas);

  let kontenUser = pesanBaru || "";
  if (mediaUrl) kontenUser += "\n[Lampiran media/foto URL: " + mediaUrl + "]";

  let messages = [{ role: "system", content: systemPrompt }];
  if (riwayat && riwayat.length > 0) {
    messages = messages.concat(riwayat.slice(-8));
  }
  messages.push({ role: "user", content: kontenUser });

  let payload = {
    model: "deepseek-chat",
    messages: messages,
    temperature: 0.3,
    max_tokens: 950
  };

  let response = await axios.post(url, payload, {
    headers: {
      "Authorization": "Bearer " + config.DEEPSEEK_API_KEY,
      "Content-Type": "application/json"
    },
    timeout: 15000
  });

  if (response.data && response.data.choices && response.data.choices.length > 0) {
    return response.data.choices[0].message.content;
  }
  return null;
}

async function tanyaGemini(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas, riwayat) {
  let url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.GEMINI_API_KEY}`;
  let systemPrompt = buildSystemPrompt(dataSOP, akun, infoPetugas);

  let kontenUser = pesanBaru || "";
  if (mediaUrl) kontenUser += "\n[Lampiran media/foto URL: " + mediaUrl + "]";

  let contents = [];
  if (riwayat && riwayat.length > 0) {
    riwayat.slice(-8).forEach(item => {
      contents.push({
        role: item.role === "user" ? "user" : "model",
        parts: [{ text: item.content }]
      });
    });
  }
  contents.push({ role: "user", parts: [{ text: kontenUser }] });

  let payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: contents,
    generationConfig: { temperature: 0.3, maxOutputTokens: 900 }
  };

  let response = await axios.post(url, payload, {
    headers: { "Content-Type": "application/json" },
    timeout: 15000
  });

  if (response.data && response.data.candidates && response.data.candidates.length > 0) {
    return response.data.candidates[0].content.parts[0].text;
  }
  return null;
}

function buildSystemPrompt(dataSOP, akun, infoPetugas) {
  if (!infoPetugas) {
    infoPetugas = { isKnown: false, isPetugas: false, nama: "", jabatan: "" };
  }

  let peran = "";
  
  if (akun === "nafila") {
    peran = `Kamu adalah Customer Service resmi Klinik Nafila Medika (${config.NOMOR_KLINIK}).
=== PENTING: JANGAN MENGARAHKAN KE NOMOR CHAT INI ===
- Pasien saat ini sedang berbincang denganmu langsung di WhatsApp Resmi Klinik Nafila Medika (${config.NOMOR_KLINIK}).
- JANGAN PERNAH menyuruh pasien untuk menghubungi, menelpon, atau mengirim WhatsApp ke nomor klinik ${config.NOMOR_KLINIK} lagi, karena mereka sudah berada di dalam chat ini!

=== KEPRIBADIAN & GAYA BAHASA ===
- Hangat, ramah, sopan dan profesional.
- Sapaan awal wajib: "Halo, selamat datang di Klinik Nafila Medika. Ada yang bisa kami bantu?"
- Kamu adalah CS resmi klinik. JANGAN sebut dirimu Jarvis atau asisten pribadi dokter.`;
  } else {
    let statusKustom = infoPetugas.isKnown
      ? `NAMA PENGIRIM: ${infoPetugas.nama}\nSTATUS HUBUNGAN KUSTOM DENGAN DR. DYLAN: ${infoPetugas.jabatan}`
      : "STATUS PENGIRIM: NOMOR BARU / BELUM TERDAFTAR (Identifikasi secara sopan).";

    peran = `Kamu adalah "Jarvis", Asisten Medis & Asisten Pribadi dr. Dylan via WhatsApp.

=== IDENTITAS & STATUS HUBUNGAN PENGIRIM ===
${statusKustom}

=== ATURAN ADAPTASI BALASAN BERDASARKAN STATUS HUBUNGAN ===
Sangat penting! Sesuaikan gaya bahasa dan perlakuan balasanmu berdasarkan Status Hubungan Pengirim dengan dr. Dylan:
1. Jika pengirim adalah DOSEN / BIMBINGAN TESIS ➔ Gunakan bahasa sangat hormat, sopan santun akademis tinggi, dan fleksibel dengan waktu bimbingan.
2. Jika pengirim adalah PERAWAT / PETUGAS MEDIS RS ➔ Gunakan nada profesional medis cepat, minta format SBAR pasien.
3. Jika pengirim adalah PASIEN (LBP / UMUM) ➔ Jawab sangat ramah, suportif, utamakan Patient Safety & anjurkan periksa fisik langsung.
4. Jika pengirim adalah SALES / MARKETING / PENAWARAN ➔ Jawab sopan ringkas bahwa agenda Dokter sedang padat.
5. Jika pengirim adalah TEMAN / REKAN ➔ Jawab akrab, hangat, dan profesional.

=== KEPRIBADIAN & SAPAAN UTAMA ===
- Sopan, presisi, hangat, dan mengutamakan keselamatan pasien.
- Sapaan awal wajib: "Halo, saya Jarvis asisten dr. Dylan. Ada yang bisa saya bantu hari ini?"`;
  }

  return `${peran}

=== DATA SOP KHUSUS DR. DYLAN ===
${dataSOP}
=== AKHIR SOP ===`;
}

async function parseKontakDenganAI(teksDokter, nomorWA) {
  try {
    let prompt = `Ekstrak Nama Kontak dan Kategori/Status Hubungan dari kalimat berikut:\n"${teksDokter}"\n\nFormat output WAJIB JSON persis seperti ini:\n{"nama": "Nama Kontak", "kategori": "Status Hubungan Kustom"}`;
    let res = await axios.post("https://api.deepseek.com/chat/completions", {
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1
    }, {
      headers: { "Authorization": "Bearer " + config.DEEPSEEK_API_KEY, "Content-Type": "application/json" },
      timeout: 10000
    });
    let raw = res.data.choices[0].message.content;
    let match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) {}

  return { nama: teksDokter, kategori: "Kontak Terdaftar" };
}

module.exports = {
  panggilDualAIEngine,
  parseKontakDenganAI
};
