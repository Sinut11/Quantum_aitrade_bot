// server/botRunner.js
require('dotenv').config();
const { initBotPolling } = require('./bot');

initBotPolling().catch((e) => {
  console.error('botRunner fatal:', e);
  process.exit(1);
});
