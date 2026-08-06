const axios = require('axios');
const config = require('../config');

async function panggilDualAIEngine(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas) {
  try {
    let jawabanDeepseek = await tanyaDeepseek(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas);
    if (jawabanDeepseek && jawabanDeepseek.trim() !== "") {
      return jawabanDeepseek;
    }
  } catch (errDS) {
    console.error("DeepSeek API Fail:", errDS.message);
  }

  try {
    console.log("Menggunakan GEMINI AI BACKUP untuk:", pengirim);
    let jawabanGemini = await tanyaGemini(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas);
    if (jawabanGemini && jawabanGemini.trim() !== "") {
      return jawabanGemini;
    }
  } catch (errGem) {
    console.error("Gemini API Fail:", errGem.message);
  }

  return "Mohon maaf, sistem AI kami sedang sibuk. Silakan kirim ulang pesan Anda beberapa saat lagi 🙏";
}

async function tanyaDeepseek(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas) {
  let url = "https://api.deepseek.com/chat/completions";
  let systemPrompt = buildSystemPrompt(dataSOP, akun, infoPetugas);

  let kontenUser = pesanBaru || "";
  if (mediaUrl) kontenUser += "\n[Lampiran media/foto URL: " + mediaUrl + "]";

  let messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: kontenUser }
  ];

  let payload = {
    model: "deepseek-v4-flash",
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

async function tanyaGemini(pengirim, pesanBaru, mediaUrl, dataSOP, akun, infoPetugas) {
  let url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${config.GEMINI_API_KEY}`;
  let systemPrompt = buildSystemPrompt(dataSOP, akun, infoPetugas);

  let kontenUser = pesanBaru || "";
  if (mediaUrl) kontenUser += "\n[Lampiran media/foto URL: " + mediaUrl + "]";

  let payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: kontenUser }] }],
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
- Jika pasien menanyakan biaya, tarif, layanan BPJS spesialis yang tidak tercover, atau jika pertanyaan pasien tidak ada aturannya di SOP:
  ➔ Jawab secara sopan: "Baik, pesan Kakak kami koordinasikan ke admin Klinik Nafila Medika terlebih dahulu agar diteruskan ke petugas kami ya."
  ➔ DAN kamu WAJIB menyertakan kode aksi: [CATAT|NamaPasien atau Pasien|Pertanyaan/keperluan pasien|Admin] [FORWARD] di bagian paling akhir balasanmu agar sistem otomatis meneruskan pesan tersebut ke WhatsApp petugas leader/admin.

=== KEPRIBADIAN & GAYA BAHASA ===
- Hangat, ramah, sopan dan profesional.
- Sapaan awal wajib: "Halo, selamat datang di Klinik Nafila Medika. Ada yang bisa kami bantu?"
- Panggil pasien dengan "Bapak/Ibu" atau nama mereka.
- Kamu adalah CS resmi klinik. JANGAN sebut dirimu Jarvis atau asisten pribadi dokter.

=== ATURAN OPERASIONAL KLINIK NAFILA MEDIKA ===
1. Berikan info layanan, jam buka, dokter spesialis, jadwal BPJS, & pendaftaran.
2. Jika pasien pendaftaran offline / Baby Spa / Sunat ➔ Kumpulkan form & kirimkan [DAFTAR_DATANG], [DAFTAR_BABYSPA], [DAFTAR_KHITAN].
3. Jika pertanyaan Rujukan BPJS ➔ Kumpulkan data & gunakan [KIRIM_CASMIX].
4. Jika Poli Gigi BPJS ➔ Arahkan ke JKN Mobile H-1.`;
  } else {
    let statusPengirim = infoPetugas.isKnown
      ? "PENGIRIM TERDAFTAR DI DATABASE DOKTER: " + infoPetugas.nama + " (Status/Kategori: " + infoPetugas.jabatan + ")"
      : "PENGIRIM ADALAH PIHAK LUAR / NOMOR BARU (Belum terdaftar di database kontak dr. Dylan).";

    peran = `Kamu adalah "Jarvis", Asisten Medis & Asisten Pribadi dr. Dylan via WhatsApp.
=== STATUS PENGIRIM ===
${statusPengirim}

=== KEPRIBADIAN & GAYA BAHASA ===
- Sangat profesional, hangat, ramah, presisi, dan mengutamakan keselamatan pasien (Patient Safety).
- Sapaan awal wajib: "Halo, saya Jarvis asisten dr. Dylan. Ada yang bisa saya bantu hari ini?"

=== PENGGUNAAN TABEL DOKUMEN & SOP DR. DYLAN ===
1. Gunakan SOP dan panduan dari tabel data untuk memberikan respon yang persis menggambarkan alur berpikir dr. Dylan.
2. Jika pesan berhubungan dengan bimbingan/tesis/agenda/kuliah ➔ Tanya detail singkat & gunakan kode [TASK_SCHEDULE|judul|catatan|YYYY-MM-DD HH:mm] atau [BUAT_JADWAL|judul|mulai|selesai].
3. Jika perawat medis konsul pasien rawat inap ➔ Rekomendasikan terapi awal & susun SBAR dengan kode [LAPOR_DOKTER|SBAR_Text].
4. Jika pasien umum bertanya seputar Klinik Nafila Medika ➔ Arahkan ramah ke WA Resmi Klinik: ${config.NOMOR_KLINIK} (${config.NOMOR_KLINIK_WA_LINK}).`;
  }

  return `${peran}

=== DATA SOP KHUSUS DR. DYLAN ===
${dataSOP}
=== AKHIR SOP ===`;
}

async function parseKontakDenganAI(teksDokter, nomorWA) {
  try {
    let prompt = `Ekstrak Nama Kontak dan Kategori/Status dari kalimat berikut:\n"${teksDokter}"\n\nFormat output WAJIB JSON persis seperti ini:\n{"nama": "Nama Kontak", "kategori": "Kategori/Status"}`;
    let res = await axios.post("https://api.deepseek.com/chat/completions", {
      model: "deepseek-v4-flash",
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
