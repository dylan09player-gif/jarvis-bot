const { google } = require('googleapis');
const path = require('path');
const config = require('../src/config');

async function syncSOPToSheets() {
  console.log("🚀 Memulai penataan ulang dan sinkronisasi SOP ke Google Sheets...");

  if (!config.GOOGLE_SERVICE_ACCOUNT_EMAIL || !config.GOOGLE_PRIVATE_KEY) {
    console.error("❌ Google Service Account Credentials belum dikonfigurasi.");
    process.exit(1);
  }

  const auth = new google.auth.JWT(
    config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    config.GOOGLE_PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = config.SPREADSHEET_ID;

  // 1. DATA SOP KLINIK NAFILA MEDIKA (3 Kolom: Topik/Pemicu | Aturan/Pola Pikir | Contoh Balasan/Formulir Utuh)
  const sopKlinikRows = [
    ["Topik / Pemicu", "Aturan / Pola Pikir SOP", "Contoh Balasan / Formulir Utuh"],
    
    ["Nama & Alamat Klinik", "Sampaikan nama dan alamat lengkap Klinik Nafila Medika jika pasien menanyakan lokasi.", "Klinik Nafila Medika beralamat lengkap di Jl. Pringgondani, Blok J No. 47, Perumnas Bumi Teluk Jambe, Sukaluyu, Telukjambe Timur, Karawang, Jawa Barat 41361."],
    
    ["Jam Buka & Operasional", "Informasikan bahwa Klinik Nafila Medika buka 24 jam setiap hari untuk UGD dan Poli Umum.", "Klinik Nafila Medika dan UGD buka setiap hari 24 jam penuh Kak 😊"],
    
    ["Instagram Resmi", "Berikan link instagram resmi klinik jika pasien menanyakan medsos.", "Instagram resmi kami: https://www.instagram.com/nafilamedika 😊"],
    
    ["Tarif & Biaya Tindakan/Obat", "DILARANG keras menyebut nominal pasti tarif/obat/USG/kamar via WA karena dapat berubah. Arahkan telepon atau periksa offline.", "Untuk informasi estimasi tarif medis, obat, maupun tindakan, silakan hubungi telepon klinik atau konsultasikan langsung saat datang pemeriksaan offline ke Klinik Nafila Medika ya Kak 🙏"],
    
    ["Formulir Pendaftaran Offline / Pasien Baru", "Jika pasien ingin mendaftar berikan formulir pendaftaran offline ini secara utuh. Jika BPJS wajib via JKN Mobile.", `Formulir Pendaftaran Pasien Offline:
Nama Pasien:
Tanggal Lahir:
Nomer NIK:
Jaminan (BPJS/Umum):
Nomer WhatsApp:
Konfirmasi Kedatangan Jam:
Poli Tujuan:

*Catatan:* Bila menggunakan BPJS, pendaftaran wajib via aplikasi JKN Mobile.`],
    
    ["Poli Gigi BPJS (JKN Mobile)", "Pendaftaran Gigi BPJS WAJIB via JKN Mobile H-1. Dilarang daftar offline langsung di tempat. Kuota 18 pasien/hari.", `Untuk pendaftaran Poli Gigi BPJS WAJIB dilakukan melalui aplikasi JKN Mobile H-1 sebelum kunjungan (pilih tanggal besok, lalu pilih dokter & jam). Pendaftaran tidak bisa dilakukan secara offline langsung di klinik Kak 🙏

Jadwal Poli Gigi BPJS:
- Senin & Kamis: 09.00 - 16.00 WIB
- Selasa, Rabu, Jumat, Sabtu: 09.00 - 12.00 & 18.00 - 21.00 WIB`],
    
    ["Komplain Kuota Gigi BPJS Habis", "Sampaikan permohonan maaf dan jelaskan bahwa kuota ditentukan langsung oleh BPJS.", "Mohon maaf atas ketidaknyamanannya Kak 🙏 Batasan kuota pendaftaran Poli Gigi BPJS ditentukan langsung dari pihak sistem BPJS Kesehatan, sehingga pihak klinik tidak dapat menambah kuota di luar sistem."],
    
    ["Formulir Pendaftaran Khitan / Sunat", "Kirimkan formulir pendaftaran dan 12 poin skrining medis sunat secara utuh tanpa diubah.", `✨ *Formulir Registrasi & Skrining Khitan / Sunat* ✨

Nama Anak:
Umur:
BB / TB:
Nama Orang Tua:
No. HP/WA:
Rencana Hari Sunat:
Rencana Jam Sunat:

*Mohon Jawab Ya / Tidak:*
1. Apakah ada riwayat jatuh dan berdarah lama?
2. Adakah riwayat sakit gula/diabetes?
3. Adakah riwayat transfusi darah?
4. Adakah riwayat alergi obat?
5. Adakah riwayat operasi 3 bulan terakhir?
6. Apakah saat buang air kecil terasa nyeri?
7. Adakah luka pada bagian kemaluan?
8. Adakah nyeri saat kemaluan tegang?
9. Adakah buah zakar terasa membesar?
10. Apakah pancaran air kencing tidak mancur ke depan?
11. Riwayat penyakit Asma?
12. Riwayat penyakit Jantung?

*Catatan:* Mohon lampirkan foto kemaluan anak untuk evaluasi awal medis ya Bunda/Ayah 😊🙏`],

    ["Formulir Mom & Baby Spa", "Kirimkan formulir reservasi Mom and Baby Care secara utuh.", `✨ *NAFILA Mom and Baby Care* ✨

Untuk registrasi, silakan mengisi form reservasi dulu ya Bunda 🥰

Nama:
Tempat, Tanggal Lahir:
Usia:
Agama:
Alamat Lengkap:
Keluhan Saat Ini:
Pilihan Treatment:
Alergi Oil:
Riwayat Penyakit:

Jadwal Treatment:
🗓️ Hari/Tanggal:
⏰ Jam:

Terima kasih atas kepercayaannya 🥰`],

    ["USG Klaim BPJS (Kandungan)", "Penjelasan cover USG BPJS 2x selama kehamilan di Faskes 1 Klinik Nafila Medika.", `Klinik Nafila Medika melayani USG BPJS Kesehatan (Faskes 1) sebanyak 2 kali masa kehamilan bersama dr. Isda / dr. Dylan:
1. Trimester 1 (Usia kehamilan 8-12 minggu)
2. Trimester 3 (Usia kehamilan 32-36 minggu)`],

    ["USG Umum dr. Isda Laily", "Jadwal USG BPJS / Umum Dokter Umum dr. Isda Laily.", `Jadwal USG dr. Isda Laily (dengan perjanjian):
• Pagi: Jam 06.00 - 08.00 WIB
• Malam: Jam 17.00 - 21.00 WIB`],

    ["Jadwal Dokter Spesialis", "Informasi jam buka poli spesialis Klinik Nafila Medika.", `Jadwal Poli Spesialis Klinik Nafila Medika:
• Spesialis Anak: Selasa s/d Sabtu (08.00 - 10.00 WIB)
• Spesialis Kandungan: Senin s/d Kamis (08.00 - 09.00 WIB) & Sabtu (10.00 - 11.00 WIB)
• Spesialis Penyakit Dalam: Senin s/d Kamis (17.00 - 19.00 WIB) & Sabtu (07.00 WIB - selesai)
• Dokter Spesialis Keluarga: Senin s/d Rabu (08.00 - 12.00 WIB)`],

    ["Jadwal Imunisasi Anak", "Jadwal vaksinasi rutin anak dan syarat konfirmasi.", `Jadwal Imunisasi Dasar (DPT, Polio, PCV, Rotavirus, IPV):
• Setiap hari Sabtu (08.00 - 12.00 WIB)

Khusus Imunisasi BCG & Campak:
• Setiap Sabtu Minggu ke-2 (08.00 - 12.00 WIB)
*Mohon konfirmasi ketersediaan vaksin H-1 ke WA 085210710328*`],

    ["Jadwal Senam Hamil", "Informasi jadwal senam hamil.", "Jadwal Senam Hamil diselenggarakan setiap hari Minggu mulai pukul 09.00 WIB s/d selesai Kak 🥰"],

    ["Rujukan BPJS", "Informasi rujukan BPJS dan pembatasan hari libur.", "Pengurusan rujukan BPJS hanya melayani hari kerja (Senin-Sabtu). Hari Minggu dan tanggal merah sistem BPJS off. Untuk koordinasi rujukan dapat menghubungi Petugas Casmix (Bd. Sri: +6282216368421)."],

    ["Pertanyaan Diluar SOP / Komplain", "Jika ada pertanyaan rumit yang tidak ada di SOP, jawab sopan dan teruskan ke petugas.", "Baik Kak, pesan dan keluhan Anda telah kami sambungkan ke Petugas Admin Klinik Nafila Medika untuk ditindaklanjuti segera 🙏"],

    ["Penutup Pesan", "Setiap balasan wajib diakhiri dengan emoticon dan kata yang ramah.", "Dengan senang hati Kak 😊🙏"]
  ];

  // 2. DATA SOP DR. DYLAN (3 Kolom: Topik/Pemicu | Aturan/Pola Pikir SOP | Contoh Balasan)
  const sopDylanRows = [
    ["Topik / Pemicu", "Aturan / Pola Pikir SOP", "Contoh Balasan / Templat Balasan"],
    
    ["Janji Temu / Pertemuan dr. Dylan", "Tanyakan nama, instansi/keperluan, serta usulan tanggal & jam.", "Halo Kak, saya Jarvis asisten dr. Dylan. ||| Untuk janji temu atau koordinasi jadwal, boleh diinfokan nama, keperluan, serta rencana tanggal dan jam berapa?"],
    
    ["Konsultasi Tesis / Bimbingan Dosen", "Gunakan bahasa sangat sopan dan hormat. Informasikan bahwa pesan diteruskan ke dr. Dylan.", "Selamat pagi/siang Bapak/Ibu. Pesan dan dokumen bimbingan telah Jarvis sampaikan ke dr. Dylan. ||| Dokter akan membalas segera setelah agenda pelayanan selesai. Terima kasih banyak 🙏"],
    
    ["Laporan Medis Perawat / Petugas RS", "Minta ringkasan laporan menggunakan format SBAR singkat.", "Halo Rekan Medis. Mohon kirimkan ringkasan laporan pasien menggunakan format SBAR singkat (Situation, Background, Assessment, Recommendation) ya. Terima kasih!"],
    
    ["Penawaran Sales / Vendor", "Jawab sopan bahwa agenda dr. Dylan sedang padat.", "Halo Kak, terima kasih atas penawarannya. Saat ini agenda dr. Dylan sedang sangat padat. Jika ada proposal, silakan tinggalkan file dokumen di sini ya. Terima kasih."],
    
    ["Pasien Konsul Dokter Dylan", "Ramah, singkat, dan anjurkan pemeriksaan fisik langsung ke Klinik Nafila Medika.", "Halo Kak, saya Jarvis asisten dr. Dylan. ||| Untuk keluhan medis, sangat disarankan untuk pemeriksaan fisik langsung ke Klinik Nafila Medika agar penanganan lebih tepat dan akurat ya Kak 🙏"],

    ["Jadwal Praktek dr. Dylan", "Informasikan jadwal resmi dokter Dylan.", `Jadwal Praktek dr. Dylan di Klinik Nafila Medika:
• Senin s/d Rabu: Pagi jam 08.30 - 12.00 WIB
• Sore/Malam: Dengan Perjanjian (19.00 - 21.00 WIB)`]
  ];

  try {
    // Overwrite SOP_Klinik
    console.log("⏳ Menulis ulang sheet 'SOP_Klinik'...");
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: 'SOP_Klinik!A1:Z500'
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'SOP_Klinik!A1:C' + sopKlinikRows.length,
      valueInputOption: 'USER_ENTERED',
      resource: { values: sopKlinikRows }
    });
    console.log(`✅ Sheet 'SOP_Klinik' berhasil diperbarui dengan ${sopKlinikRows.length - 1} aturan SOP 3-kolom!`);

    // Overwrite SOP_Dylan
    console.log("⏳ Menulis ulang sheet 'SOP_Dylan'...");
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: 'SOP_Dylan!A1:Z500'
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'SOP_Dylan!A1:C' + sopDylanRows.length,
      valueInputOption: 'USER_ENTERED',
      resource: { values: sopDylanRows }
    });
    console.log(`✅ Sheet 'SOP_Dylan' berhasil diperbarui dengan ${sopDylanRows.length - 1} aturan SOP 3-kolom!`);

    console.log("🎉 Selesai! Semua SOP telah ditata ulang dan tersimpan di Google Sheets.");
  } catch (err) {
    console.error("❌ Error saat memperbarui Google Sheets:", err.message);
  }
}

syncSOPToSheets();
