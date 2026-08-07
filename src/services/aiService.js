const axios = require('axios');
const config = require('../config');

async function panggilDualAIEngine(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas, riwayat) {
  let deskripsiGambar = null;

  // JIKA ADA GAMBAR/MEDIA ➔ BACA GAMBAR PAKAI GEMINI VISION API
  if (mediaUrl) {
    deskripsiGambar = await analisaGambarDenganGemini(mediaUrl);
  }

  // PANGGIL DEEPSEEK CHAT DENGAN KONTEKS HASIL PEMBACAAN GEMINI VISION
  try {
    let jawabanDeepseek = await tanyaDeepseek(pengirim, pesanBaru, deskripsiGambar, dataSOP, akun, infoPetugas, riwayat);
    if (jawabanDeepseek && jawabanDeepseek.trim() !== "") {
      return jawabanDeepseek;
    }
  } catch (errDS) {
    console.error("DeepSeek API Fail:", errDS.response ? JSON.stringify(errDS.response.data) : errDS.message);
  }

  // FALLBACK UNTUK GEMINI AI JIKA DEEPSEEK FAIL
  try {
    console.log("Menggunakan GEMINI AI BACKUP untuk:", pengirim);
    let jawabanGemini = await tanyaGemini(pengirim, pesanBaru, deskripsiGambar, dataSOP, akun, infoPetugas, riwayat);
    if (jawabanGemini && jawabanGemini.trim() !== "") {
      return jawabanGemini;
    }
  } catch (errGem) {
    console.error("Gemini API Fail:", errGem.response ? JSON.stringify(errGem.response.data) : errGem.message);
  }

  return "Mohon maaf, sistem AI sedang sibuk. Boleh kirim ulang pesan beberapa saat lagi ya 🙏";
}

// FUNGSI KHUSUS PEMBACAAN GAMBAR PIXEL MULTIMODAL GEMINI VISION API
async function analisaGambarDenganGemini(mediaUrl) {
  if (!mediaUrl) return null;

  try {
    console.log("🔍 Membaca piksel gambar dengan Gemini Vision API:", mediaUrl);
    let imgRes = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 7000 });
    let mimeType = imgRes.headers['content-type'] || 'image/jpeg';
    let base64Image = Buffer.from(imgRes.data).toString('base64');

    let url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.GEMINI_API_KEY}`;
    let payload = {
      contents: [{
        parts: [
          { text: "Analisa dan deskripsikan secara ringkas (1-2 kalimat) isi gambar/foto medis/dokumen/ruam ini untuk bantuan konsultasi dr. Dylan. Jika bukan gambar medis, sebutkan isi gambarnya secara singkat." },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Image
            }
          }
        ]
      }],
      generationConfig: { maxOutputTokens: 150, temperature: 0.2 }
    };

    let response = await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000
    });

    if (response.data && response.data.candidates && response.data.candidates.length > 0) {
      let desc = response.data.candidates[0].content.parts[0].text;
      if (desc && desc.trim()) {
        console.log("✅ Hasil Analisa Gambar Gemini Vision:", desc.trim());
        return desc.trim();
      }
    }
  } catch (errVision) {
    console.error("Gemini Vision Analysis skipped (silent error):", errVision.message);
  }

  // SILENT FALLBACK: Jika gambar gagal dibaca, jangan spam error ke user. Cukup kembalikan null!
  return null;
}

async function tanyaDeepseek(pengirim, pesanBaru, deskripsiGambar, dataSOP, akun, infoPetugas, riwayat) {
  let url = "https://api.deepseek.com/chat/completions";
  let systemPrompt = buildSystemPrompt(dataSOP, akun, infoPetugas);

  let kontenUser = pesanBaru || "";
  if (deskripsiGambar) {
    kontenUser += (kontenUser ? "\n" : "") + "[Konteks Gambar Terdeteksi Gemini Vision: " + deskripsiGambar + "]";
  } else if (!kontenUser) {
    kontenUser = "(Pasien mengirim foto/gambar)";
  }

  let messages = [{ role: "system", content: systemPrompt }];
  
  if (riwayat && riwayat.length > 0) {
    riwayat.slice(-8).forEach(item => {
      let r = (item.role === "doctor" || item.role === "user") ? "user" : "assistant";
      messages.push({ role: r, content: item.content || "" });
    });
  }
  messages.push({ role: "user", content: kontenUser });

  let payload = {
    model: "deepseek-chat",
    messages: messages,
    temperature: 0.3,
    max_tokens: 350
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

async function tanyaGemini(pengirim, pesanBaru, deskripsiGambar, dataSOP, akun, infoPetugas, riwayat) {
  let url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.GEMINI_API_KEY}`;
  let systemPrompt = buildSystemPrompt(dataSOP, akun, infoPetugas);

  let kontenUser = pesanBaru || "";
  if (deskripsiGambar) {
    kontenUser += (kontenUser ? "\n" : "") + "[Konteks Gambar Terdeteksi Gemini Vision: " + deskripsiGambar + "]";
  } else if (!kontenUser) {
    kontenUser = "(Pasien mengirim foto/gambar)";
  }

  let contents = [];
  if (riwayat && riwayat.length > 0) {
    riwayat.slice(-8).forEach(item => {
      let r = (item.role === "doctor" || item.role === "user") ? "user" : "model";
      contents.push({
        role: r,
        parts: [{ text: item.content || "" }]
      });
    });
  }
  contents.push({ role: "user", parts: [{ text: kontenUser }] });

  let payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: contents,
    generationConfig: { temperature: 0.3, maxOutputTokens: 350 }
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

  let gayaChatManusia = `=== ATURAN WAKTU & GAYA BALASAN WA (CRITICAL!) ===
1. CHAT WAJIB SINGKAT, PADAT, DAN LANGSUNG KE POKOK INTI:
   - Balas santai & alami seperti manusia chatting di WA (1-2 kalimat pendek saja).
   - DILARANG MEMBUAT TEKS PANJANG / WADAH TEKS / PARAGRAF PANJANG!
   - DILARANG menggunakan karakter markdown seperti **, ---, #, atau nomor 1,2,3 yang terlalu formal.

2. ATURAN MULTI-BUBBLE CHAT (GUNAKAN SIMBOL '|||'):
   - Jika kamu ingin menyampaikan lebih dari 1 poin / pesan terpisah, gunakan simbol '|||' di antara kalimat.
   - Contoh balasan ideal:
     "Halo Kak, saya Jarvis asisten dr. Dylan. ||| Untuk janji ketemu, boleh info nama & rencana tanggal berapa?"
   - Sistem akan memotong '|||' dan mengirimkannya menjadi 2 bubble chat terpisah di WhatsApp!`;

  let peran = "";
  
  if (akun === "nafila") {
    peran = `Kamu adalah Customer Service resmi Klinik Nafila Medika (${config.NOMOR_KLINIK}).
- Sapaan awal singkat: "Halo, selamat datang di Klinik Nafila Medika. Ada yang bisa dibantu?"
- Kamu CS resmi klinik. JANGAN sebut dirimu Jarvis atau asisten dokter.`;
  } else {
    let statusKustom = infoPetugas.isKnown
      ? `PENGIRIM: ${infoPetugas.nama}\nSTATUS HUBUNGAN DENGAN DR. DYLAN: ${infoPetugas.jabatan}`
      : "PENGIRIM: NOMOR BARU / BELUM DISIMPAN.";

    peran = `Kamu adalah "Jarvis", Asisten Medis & Pribadi dr. Dylan via WhatsApp.

=== IDENTITAS PENGIRIM ===
${statusKustom}

=== PENYESUAIAN PERLAKUAN BALASAN ===
- DOSEN / TESIS ➔ Gunakan bahasa sangat hormat, sopan, dan singkat.
- PERAWAT / PETUGAS ➔ Nada medis cepat, minta format SBAR singkat.
- PASIEN ➔ Ramah, suportif, singkat, anjurkan periksa fisik.
- SALES ➔ Jawab sopan singkat bahwa agenda Dokter padat.`;
  }

  return `${gayaChatManusia}

${peran}

=== DATA SOP KHUSUS DR. DYLAN ===
${dataSOP}
=== AKHIR SOP ===`;
}

async function parseKontakDenganAI(teksDokter, nomorWA) {
  try {
    let prompt = `Ekstrak Nama Kontak dan Kategori dari: "${teksDokter}". Output JSON: {"nama": "Nama", "kategori": "Kategori"}`;
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
  analisaGambarDenganGemini,
  parseKontakDenganAI
};
