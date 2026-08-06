# 🚀 Jarvis WhatsApp & Telegram Bot (Node.js Engine)

Sistem Asisten WhatsApp & Telegram cerdas berbasis **Node.js (Express)** dengan **Dual Engine AI** (DeepSeek V4 Flash + Gemini 3.6 Flash) dan integrasi **Google Sheets**, **Telegram Push Notification**, serta **WhaCenter Gateway**.

---

## 🛠️ Langkah-Langkah Push ke GitHub & Deploy ke Vercel (Panduan 3 Menit)

### LANGKAH 1: Inisialisasi Git & Upload ke GitHub
Buka terminal/PowerShell di folder project ini:
```bash
git init
git add .
git commit -m "Initial commit Jarvis Node.js Engine"
git branch -M main
git remote add origin https://github.com/USERNAME_DOKTER/jarvis-bot.git
git push -u origin main
```
*(Ganti `USERNAME_DOKTER/jarvis-bot` dengan nama repositori GitHub milik Dokter).*

---

### LANGKAH 2: Deploy Gratis ke Vercel
1. Buka [Vercel.com](https://vercel.com) dan login pakai akun GitHub Dokter.
2. Klik **Add New...** ➔ **Project**.
3. Pilih repositori **`jarvis-bot`** yang baru saja di-push.
4. Di bagian **Environment Variables**, tambahkan variabel berikut:

| Key | Value (Nilai) |
| :--- | :--- |
| `DEEPSEEK_API_KEY` | `sk-4bf40636962449828a6d370279dd4828` |
| `GEMINI_API_KEY` | `AIzaSyCdURtv7PzTbB2vsJ2E4Dp2MtK1Y4JEVKY` |
| `TELEGRAM_BOT_TOKEN` | `8800297410:AAGXrrUkZJmZ4q51U79Yg80RjZUkKIUBXlY` |
| `WA_DYLAN` | `19196c01c4263f86a1dd678b472ac597` |
| `WA_NAFILA` | `83f3428d66d811ef2f2d78e289bae57c` |
| `SPREADSHEET_ID` | `1FkuO3Ix04dFWriI3Q-65HZQjUMOiPwgjmrpQKobO9q4` |

5. Klik **Deploy**.
6. Setelah selesai, Vercel akan memberikan domain publik (contoh: `https://jarvis-bot-dylan.vercel.app`).

---

### LANGKAH 3: Hubungkan Webhook Telegram & WhaCenter
1. **Set Telegram Webhook (Otomatis)**:
   Buka browser dan akses URL Vercel Dokter:
   `https://DOMAIN-VERCEL-DOKTER.vercel.app/api/set-telegram-webhook`
   *(Bot Telegram Dokter akan langsung terhubung otomatis!)*

2. **Set WhaCenter Webhook**:
   Buka Dashboard WhaCenter ➔ Masukkan URL Webhook Dokter:
   `https://DOMAIN-VERCEL-DOKTER.vercel.app/api/whacenter-webhook`

---

## 🔑 Opsional: Hubungkan Google Sheets Service Account (Akses Edit Penuh)
Jika Dokter ingin aplikasi di Vercel bisa langsung menambah tab `Kontak_Dylan` dan menulis log ke Google Sheet:
1. Buka [Google Cloud Console](https://console.cloud.google.com/).
2. Buat **Service Account** baru ➔ Buat Key (format JSON).
3. Salin `client_email` dan `private_key` dari file JSON tersebut.
4. Tambahkan ke Environment Variables di Vercel:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`: *email_service_account@gserviceaccount.com*
   - `GOOGLE_PRIVATE_KEY`: *isi private key*
5. Buka Google Sheet Dokter (`Dashboard Jarvis Bot`) ➔ Klik **Bagikan (Share)** ➔ Masukkan email Service Account tersebut sebagai **Editor**.
