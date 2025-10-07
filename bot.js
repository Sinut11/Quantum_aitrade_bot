// server/bot.js
// Telegraf bot that:
//  - replies to /start
//  - captures referral (ctx.startPayload)
//  - ensures the user exists in Mongo with referredBy set once
//  - gives a "Open App" button to your mini-app

const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const User = require('./models/User');

const {
  BOT_TOKEN,
  BOT_USERNAME,
  APP_BASE_URL, // e.g. https://xxxx.ngrok-free.app
} = process.env;

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN missing in .env');
}
if (!APP_BASE_URL) {
  throw new Error('APP_BASE_URL missing in .env');
}

function miniAppUrl(ctx, startParam) {
  // Deep-link into your mini app (webapp). We pass start param (if any) so the UI can also see it
  const url = new URL(APP_BASE_URL);
  // optional: expose ?start= to the UI for extra safety (server still captures referral)
  if (startParam) url.searchParams.set('start', startParam);
  return url.toString();
}

// idempotent create/update user and referral
async function upsertUserFromStart(ctx) {
  const me = ctx.from;
  const tgId = String(me.id);
  const username = me.username || null;
  const startParam = (ctx.startPayload || '').trim(); // inviter code (referralCode or inviter tgId)

  // Resolve inviter if present
  let inviter = null;
  if (startParam && startParam !== tgId) {
    inviter = await User.findOne({
      $or: [{ referralCode: startParam }, { tgId: startParam }],
    }).lean();
  }

  const now = new Date();
  const upd = {
    $setOnInsert: {
      tgId,
      referralCode: tgId, // user’s own code is tgId
      createdAt: now,
    },
    $set: {
      username,
      updatedAt: now,
    },
  };

  // Only set referral once (on insert). If user exists, we don’t overwrite.
  if (inviter && inviter.tgId !== tgId) {
    upd.$setOnInsert.referredBy = inviter.tgId;
    upd.$setOnInsert.referredByCode = inviter.referralCode || inviter.tgId;
    upd.$setOnInsert.referredByUsername = inviter.username || null;
  }

  let user = await User.findOneAndUpdate({ tgId }, upd, { new: true, upsert: true });

  // If user existed but had no referral yet (rare), set it exactly once
  if (inviter && !user.referredBy && inviter.tgId !== tgId) {
    user.referredBy = inviter.tgId;
    user.referredByCode = inviter.referralCode || inviter.tgId;
    user.referredByUsername = inviter.username || null;
    await user.save();
  }

  return { user, inviter, startParam };
}

function buildOpenAppKeyboard(ctx, startParam) {
  const webAppUrl = miniAppUrl(ctx, startParam);
  // If you want Telegram’s native web_app button:
  return Markup.inlineKeyboard([
    Markup.button.webApp('Open Quantum AI Earn', webAppUrl),
  ]);
}

function buildStartText({ user, inviter, startParam }) {
  const lines = [];
  lines.push('👋 Welcome to **Quantum AI Earn**');
  if (inviter || startParam) {
    const who =
      inviter?.username
        ? `@${inviter.username}`
        : inviter?.tgId
        ? inviter.tgId
        : startParam || '—';
    lines.push(`You joined with referral: **${who}**`);
  }
  lines.push('');
  lines.push('Tap the button below to open the app.');
  return lines.join('\n');
}

async function attachHandlers(bot) {
  bot.start(async (ctx) => {
    try {
      const info = await upsertUserFromStart(ctx);
      const text = buildStartText(info);
      await ctx.replyWithMarkdown(text, buildOpenAppKeyboard(ctx, info.startParam));
    } catch (e) {
      console.error('start handler error:', e);
      await ctx.reply('Something went wrong. Please try again.');
    }
  });

  // simple /help
  bot.hears(/help/i, async (ctx) => {
    await ctx.reply('Use /start to get your app button.');
  });

  // fallback message
  bot.on('message', async (ctx) => {
    await ctx.reply('Use /start to get your app button.');
  });
}

async function initBotPolling() {
  // Ensure Mongo is connected (index.js already connects — but if you run bot alone, it’s still fine)
  if (mongoose.connection.readyState !== 1) {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI missing for bot');
    await mongoose.connect(process.env.MONGO_URI);
  }

  const bot = new Telegraf(BOT_TOKEN);
  await attachHandlers(bot);

  // Use long polling (zero webhook setup, super reliable)
  await bot.launch();
  console.log('Bot started with long polling');

  // Proper shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { initBotPolling };
