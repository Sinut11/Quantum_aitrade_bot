/**
 * services/withdrawSender.js (FULL VERSION – stubbed queue + confirmer)
 * --------------------------------------------------------------------
 * Exposes startWithdrawConfirmer(), resolving your index.js warning:
 * "./services/withdrawSender.js loaded, but no startWithdrawConfirmer export"
 *
 * What it does now:
 * - Starts a harmless background loop that you can extend to:
 *   * fetch queued withdraw requests from DB
 *   * send USDT tx from treasury
 *   * update status/txHash
 *
 * It never throws fatally; logs and sleeps instead.
 */

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

export async function startWithdrawConfirmer() {
  console.log("🔁 Withdraw confirmer loop (stub) started");
  while (true) {
    try {
      // TODO: Replace this with your real logic:
      // 1) pull one "queued" withdraw from DB
      // 2) send token transfer (ensure gas, nonce mgmt, etc.)
      // 3) mark "sent" with txHash, wait confirmations, then "confirmed"
      // For now: noop + short sleep
      await sleep(5000);
    } catch (e) {
      console.error("[withdraw] loop error:", e?.message || e);
      await sleep(3000);
    }
  }
}

// default export for convenience
export default startWithdrawConfirmer;