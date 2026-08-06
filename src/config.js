require('dotenv').config();

module.exports = {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  TELEGRAM_CHAT_ID_DOKTER: process.env.TELEGRAM_CHAT_ID_DOKTER || "",
  WA_DYLAN: process.env.WA_DYLAN || "19196c01c4263f86a1dd678b472ac597",
  WA_NAFILA: process.env.WA_NAFILA || "83f3428d66d811ef2f2d78e289bae57c",
  SPREADSHEET_ID: process.env.SPREADSHEET_ID || "1FkuO3Ix04dFWriI3Q-65HZQjUMOiPwgjmrpQKobO9q4",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
  GOOGLE_PRIVATE_KEY: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, '\n'),
  NOMOR_DOKTER: process.env.NOMOR_DOKTER || "6281291868456",
  NOMOR_KLINIK: process.env.NOMOR_KLINIK || "081398169819",
  NOMOR_KLINIK_WA_LINK: "https://wa.me/6281398169819",
  NOMOR_CASMIX_MAK_SRI: process.env.NOMOR_CASMIX_MAK_SRI || "6282216368421",
  PORT: process.env.PORT || 3000
};
