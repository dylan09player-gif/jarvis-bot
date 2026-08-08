const axios = require('axios');
const config = require('../config');

async function panggilDualAIEngine(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas, riwayat) {
  let deskripsiGambar = null;

  // 1. PEMBACAAN GAMBAR DENGAN GEMINI VISION (JIKA ADA MEDIA & GEMINI API KEY VALID)
  if (mediaUrl) {
    try {
      deskripsiGambar = await analisaGambarDenganGemini(mediaUrl);
    } catch (err) {
      console.log("Gemini Vision skipped silently:", err.message);
      deskripsiGambar = null;
    }
  }

  // 2. TIER 1: UTAMAKAN DEEPSEEK CHAT (TIMEOUT 7s)
  try {
    let jawabanDeepseek = await tanyaDeepseek(pengirim, pesanBaru, deskripsiGambar, dataSOP, akun, infoPetugas, riwayat);
    if (jawabanDeepseek && jawabanDeepseek.trim() !== "") {
      return jawabanDeepseek;
    }
  } catch (errDS) {
    console.error("DeepSeek API Fail:", errDS.message);
  }

  // 3. TIER 2: FALLBACK KE GEMINI 2.0 FLASH (ULTRA FAST - TIMEOUT 7s)
  try {
    console.log("Menggunakan GEMINI 2.0 FLASH BACKUP untuk:", pengirim);
    let jawabanGemini = await tanyaGemini(pengirim, pesanBaru, deskripsiGambar, dataSOP, akun, infoPetugas, riwayat, "gemini-2.0-flash");
    if (jawabanGemini && jawabanGemini.trim() !== "") {
      return jawabanGemini;
    }
  } catch (errGem) {
    console.error("Gemini 2.0 API Fail:", errGem.message);
  }

  // 4. TIER 3: FALLBACK KE GEMINI 1.5 FLASH (TIMEOUT 6s)
  try {
    console.log("Menggunakan GEMINI 1.5 FLASH BACKUP untuk:", pengirim);
    let jawabanGemini15 = await tanyaGemini(pengirim, pesanBaru, deskripsiGambar, dataSOP, akun, infoPetugas, riwayat, "gemini-1.5-flash");
    if (jawabanGemini15 && jawabanGemini15.trim() !== "") {
      return jawabanGemini15;
    }
  } catch (errGem15) {
    console.error("Gemini 1.5 API Fail:", errGem15.message);
  }

  // JIKA SEMUA ENGINE GAGAL: Return null agar TIDAK MENGIRIM PESAN SIBUK KE WA PASIEN!
  // Dokter bisa membalas manual dari Dashboard.
  console.error("⚠️ Semua AI Engine sedang mengalami peak load / timeout untuk:", pengirim);
  return null;
}

// FUNGSI MULTIMODAL VISION: MEMBACA PIKSEL GAMBAR MENGGUNAKAN GEMINI (SILENT SAFETY ENFORCED)
async function analisaGambarDenganGemini(mediaUrl) {
  if (!mediaUrl || !config.GEMINI_API_KEY) return null;

  try {
    let imgRes = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 6000 });
    let mimeType = imgRes.headers['content-type'] || 'image/jpeg';
    let base64Image = Buffer.from(imgRes.data).toString('base64');

    let models = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.5-flash"];

    for (let modelName of models) {
      try {
        let url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${config.GEMINI_API_KEY}`;
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
          timeout: 7000
        });

        if (response.data && response.data.candidates && response.data.candidates.length > 0) {
          let desc = response.data.candidates[0].content.parts[0].text;
          if (desc && desc.trim()) {
            console.log(`✅ Hasil Analisa Gambar Gemini (${modelName}):`, desc.trim());
            return desc.trim();
          }
        }
      } catch (errModel) {
        // Abaikan error per-model
      }
    }
  } catch (errVision) {
    // Silent error - jangan pernah gagalkan flow DeepSeek!
  }

  return null;
}

async function tanyaDeepseek(pengirim, pesanBaru, deskripsiGambar, dataSOP, akun, infoPetugas, riwayat) {
  let url = "https://api.deepseek.com/chat/completions";
  let systemPrompt = buildSystemPrompt(dataSOP, akun, infoPetugas);

  let kontenUser = pesanBaru || "";
  if (deskripsiGambar) {
    kontenUser += (kontenUser ? "\n" : "") + "[Konteks Gambar Terdeteksi Gemini Vision: " + deskripsiGambar + "]";
  } else if (!kontenUser) {
    kontenUser = "(Pasien menyapa atau mengirim dokumen/lampiran)";
  }

  let messages = [{ role: "system", content: systemPrompt }];
  
  // SANITASI RIWAYAT: FILTER PESAN ERROR SIBUK & RIWAYAT KOSONG
  if (riwayat && riwayat.length > 0) {
    riwayat.slice(-10).forEach(item => {
      let content = (item.content || "").trim();
      if (!content || content.includes("sistem AI sedang sibuk")) return;

      let r = (item.role === "doctor" || item.role === "user") ? "user" : "assistant";
      messages.push({ role: r, content: content });
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
    timeout: 7000 // 7 detik agar cepat failover jika DeepSeek sibuk
  });

  if (response.data && response.data.choices && response.data.choices.length > 0) {
    let text = response.data.choices[0].message && response.data.choices[0].message.content;
    if (text && text.trim()) return text;
  }
  return null;
}

async function tanyaGemini(pengirim, pesanBaru, deskripsiGambar, dataSOP, akun, infoPetugas, riwayat, modelName = "gemini-2.0-flash") {
  if (!config.GEMINI_API_KEY) return null;

  let url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${config.GEMINI_API_KEY}`;
  let systemPrompt = buildSystemPrompt(dataSOP, akun, infoPetugas);

  let kontenUser = pesanBaru || "";
  if (deskripsiGambar) {
    kontenUser += (kontenUser ? "\n" : "") + "[Konteks Gambar Terdeteksi Gemini Vision: " + deskripsiGambar + "]";
  } else if (!kontenUser) {
    kontenUser = "(Pasien menyapa atau mengirim dokumen/lampiran)";
  }

  let contents = [];
  if (riwayat && riwayat.length > 0) {
    riwayat.slice(-10).forEach(item => {
      let content = (item.content || "").trim();
      if (!content || content.includes("sistem AI sedang sibuk")) return;

      let r = (item.role === "doctor" || item.role === "user") ? "user" : "model";
      contents.push({
        role: r,
        parts: [{ text: content }]
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
    timeout: 7000 // 7 detik
  });

  if (
    response.data &&
    response.data.candidates &&
    response.data.candidates.length > 0 &&
    response.data.candidates[0].content &&
    response.data.candidates[0].content.parts &&
    response.data.candidates[0].content.parts.length > 0
  ) {
    let text = response.data.candidates[0].content.parts[0].text;
    if (text && text.trim()) return text;
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
   - DILARANG MEMBUAT TEKS PANJANG / PARAGRAF PANJANG kecuali saat mengirimkan FORMULIR PENDAFTARAN LENGKAP!
   - DILARANG menggunakan karakter markdown seperti **, ---, #, kecuali format formulir resmi.

2. ATURAN FORMULIR & TEMPLAT (CRITICAL!):
   - Jika ada aturan SOP yang memuat 'BALASAN / FORMULIR UTUH', kamu WAJIB mengirimkan formulir/templat tersebut SECARA UTUH tanpa memotong atau mengubah daftar pertanyaan di dalamnya.

3. DILARANG SAMA SEKALI MEMBALAS "TIDAK BISA MELIHAT GAMBAR / FOTO":
   - DILARANG KERAS mengatakan "Maaf saya tidak bisa melihat gambar", "Foto tidak kelihatan", atau sejenisnya!
   - Jika pasien mengirimkan foto/lampiran tanpa teks, sapa ramah saja 1 kalimat:
     Contoh: "Halo Kak, ada yang bisa dibantu?" atau "Halo Kak, mohon sampaikan keluhan/keperluannya ya 🙏"

4. ATURAN MULTI-BUBBLE CHAT (GUNAKAN SIMBOL '|||'):
   - Jika kamu ingin menyampaikan lebih dari 1 poin / pesan terpisah, gunakan simbol '|||' di antara kalimat.
   - Contoh balasan ideal:
     "Halo Kak, ada yang bisa dibantu? ||| Untuk info pendaftaran, boleh sampaikan nama & poli tujuan ya."
   - Sistem akan memotong '|||' dan mengirimkannya menjadi 2 bubble chat terpisah di WhatsApp!`;

  let peran = "";
  
  if (akun === "nafila") {
    peran = `=== IDENTITAS KAMU: CUSTOMER SERVICE KLINIK NAFILA MEDIKA ===
Kamu adalah Customer Service resmi Klinik Nafila Medika (${config.NOMOR_KLINIK}).
- Sapaan awal: "Halo, selamat datang di Klinik Nafila Medika. Ada yang bisa dibantu Kak?"
- Penutup pesan: Akhiri balasan ramah dengan "Dengan senang hati Kak 😊🙏"
- Kamu CS resmi klinik. JANGAN PERNAH sebut dirimu Jarvis atau asisten dokter!`;
  } else {
    let statusKustom = infoPetugas.isKnown
      ? `PENGIRIM: ${infoPetugas.nama}\nSTATUS HUBUNGAN DENGAN DR. DYLAN: ${infoPetugas.jabatan}`
      : "PENGIRIM: NOMOR BARU / BELUM DISIMPAN.";

    peran = `=== IDENTITAS KAMU: JARVIS (ASISTEN DR. DYLAN) ===
Kamu me-representasikan "Jarvis", Asisten Medis & Pribadi dr. Dylan via WhatsApp.

=== IDENTITAS PENGIRIM ===
${statusKustom}

=== PENYESUAIAN PERLAKUAN BALASAN ===
- DOSEN / TESIS ➔ Gunakan bahasa sangat hormat, sopan, dan singkat.
- PERAWAT / PETUGAS ➔ Nada medis cepat, minta format SBAR singkat.
- PASIEN ➔ Ramah, suportif, singkat, anjurkan periksa fisik ke Klinik Nafila Medika.
- SALES ➔ Jawab sopan singkat bahwa agenda Dokter padat.`;
  }

  return `${gayaChatManusia}

${peran}

=== DATA ATURAN & FORMULIR SOP (${akun.toUpperCase()}) ===
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
