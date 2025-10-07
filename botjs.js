// server/botjs.js
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const User = require('./models/User');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing in .env');

module.exports = function initBot(app) {
  const bot = new Telegraf(BOT_TOKEN);

  // Helper: attach inviter once (idempotent)
  async function attachInviterIfAny(tgId, username, startPayload) {
    const now = new Date();
    let inviter = null;

    // Resolve inviter by referralCode or tgId
    if (startPayload) {
      inviter = await User.findOne({
        $or: [{ referralCode: startPayload }, { tgId: startPayload }],
      }).lean();
    }

    // Upsert user; set referral only on first insert
    const upsert = {
      $setOnInsert: { tgId, referralCode: tgId, createdAt: now },
      $set: { username: username || null, updatedAt: now },
    };

    if (inviter && inviter.tgId !== tgId) {
      upsert.$setOnInsert.referredBy = inviter.tgId;
      upsert.$setOnInsert.referredByCode = inviter.referralCode || inviter.tgId;
      upsert.$setOnInsert.referredByUsername = inviter.username || null;
    }

    let me = await User.findOneAndUpdate({ tgId }, upsert, {
      new: true,
      upsert: true,
    });

    // If user already existed without referredBy, set it once (still idempotent)
    if (inviter && !me.referredBy && inviter.tgId !== tgId) {
      me.referredBy = inviter.tgId;
      me.referredByCode = inviter.referralCode || inviter.tgId;
      me.referredByUsername = inviter.username || null;
      await me.save();
    }

    return { me, inviter };
  }

  bot.start(async (ctx) => {
    try {
      const u = ctx.from;
      const tgId = String(u.id);
      const username = u.username || null;
      const payload = ctx.startPayload || null;

      const { inviter } = await attachInviterIfAny(tgId, username, payload);

      await ctx.reply(
        [
          `Welcome${username ? ' @' + username : ''}!`,
          inviter
            ? `Referred by: @${inviter.username || inviter.tgId}`
            : undefined,
          `Open the Mini App from the bot menu.`,
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (e) {
      console.error('bot.start error:', e);
      await ctx.reply('Welcome! (ref attached)');
    }
  });

  // Generic fallback
  bot.on('text', async (ctx) => {
    await ctx.reply('Open the Mini App from the bot menu.');
  });

  bot.launch();
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
};
