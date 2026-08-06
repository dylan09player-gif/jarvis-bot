const googleService = require('./src/services/googleService');
const aiService = require('./src/services/aiService');
const telegramService = require('./src/services/telegramService');
const whacenter = require('./src/services/whacenterService');
const app = require('./api/index');

async function test() {
  try {
    console.log("Testing Google Service...");
    let info = await googleService.getDetailPetugasAtauKontak("628123456789");
    console.log("Info Kontak:", info);

    console.log("Testing SOP...");
    let sop = await googleService.bacaSOP("dylan");
    console.log("SOP:", sop.substring(0, 100));

    console.log("Testing AI Engine...");
    let aiRes = await aiService.panggilDualAIEngine("628123456789", "Tes pesan medis demam anak", null, sop, "dylan", info);
    console.log("AI Respon:", aiRes);

  } catch (err) {
    console.error("TEST ERROR STACK:", err);
  }
}

test();
