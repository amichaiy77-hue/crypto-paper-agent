// Usage: node scripts/apply-trade.mjs <buy|sell> <COIN> <usdAmount> "<reasoning>"
//
// Executes a paper (virtual money) trade against data/portfolio.json.
// Re-fetches live prices itself rather than trusting a caller-supplied price,
// so the executed price can't be gamed. Enforces the risk rules in
// data/config.json — if a trade would violate them, nothing is written to
// portfolio.json and the attempt is logged to decisions.json as "rejected"
// so the reasoning is still visible on the dashboard.
import {
  loadConfig,
  loadPortfolio,
  saveJson,
  appendDecision,
  fetchPrices,
  computeTotalValueUsd,
  PORTFOLIO_PATH,
} from "./lib.mjs";

const [action, coin, usdAmountRaw, reasoning] = process.argv.slice(2);

function fail(message) {
  console.error(`Trade rejected: ${message}`);
  process.exit(1);
}

if (!["buy", "sell"].includes(action)) {
  fail(`first argument must be "buy" or "sell", got "${action}"`);
}
if (!coin) fail("coin symbol is required, e.g. BTC");
const usdAmount = Number(usdAmountRaw);
if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
  fail(`usdAmount must be a positive number, got "${usdAmountRaw}"`);
}
if (!reasoning || !reasoning.trim()) {
  fail("a reasoning string is required as the 4th argument");
}

const config = await loadConfig();
if (!config.watchlist.includes(coin)) {
  fail(`${coin} is not in the watchlist (${config.watchlist.join(", ")})`);
}
if (config.riskRules.allowShort === false && action === "sell") {
  // selling is only allowed against an existing holding (no shorting) — checked below
}

const portfolio = await loadPortfolio();
const prices = await fetchPrices(config);
const price = prices[coin];

async function reject(reason) {
  await appendDecision({
    timestamp: new Date().toISOString(),
    status: "rejected",
    action,
    coin,
    usdAmount,
    price,
    reasoning,
    rejectReason: reason,
  });
  fail(reason);
}

const existingQty = portfolio.positions[coin]?.qty ?? 0;
const totalValueBefore = computeTotalValueUsd(portfolio, prices);

if (action === "buy") {
  if (usdAmount > portfolio.cashUsd) {
    await reject(`not enough cash (have $${portfolio.cashUsd.toFixed(2)}, need $${usdAmount.toFixed(2)})`);
  }

  const qtyBought = usdAmount / price;
  const newQty = existingQty + qtyBought;
  const newCash = portfolio.cashUsd - usdAmount;
  const newPositionValue = newQty * price;
  // total portfolio value doesn't change on a buy (cash converts to position at market price)
  const totalValueAfter = totalValueBefore;

  const positionPct = newPositionValue / totalValueAfter;
  if (positionPct > config.riskRules.maxPositionPctOfPortfolio) {
    await reject(
      `would put ${(positionPct * 100).toFixed(1)}% of the portfolio in ${coin}, ` +
        `over the ${(config.riskRules.maxPositionPctOfPortfolio * 100).toFixed(0)}% limit`
    );
  }

  const cashPct = newCash / totalValueAfter;
  if (cashPct < config.riskRules.minCashReservePct) {
    await reject(
      `would leave only ${(cashPct * 100).toFixed(1)}% cash, ` +
        `below the ${(config.riskRules.minCashReservePct * 100).toFixed(0)}% minimum reserve`
    );
  }

  portfolio.cashUsd = newCash;
  portfolio.positions[coin] = { qty: newQty };
} else {
  if (config.riskRules.allowShort === false && existingQty <= 0) {
    await reject(`no existing ${coin} position to sell (shorting is disabled)`);
  }
  const qtyToSell = usdAmount / price;
  if (qtyToSell > existingQty + 1e-9) {
    await reject(
      `trying to sell $${usdAmount.toFixed(2)} (${qtyToSell.toFixed(6)} ${coin}) ` +
        `but only holding ${existingQty.toFixed(6)} ${coin}`
    );
  }

  const newQty = existingQty - qtyToSell;
  portfolio.cashUsd += usdAmount;
  if (newQty <= 1e-9) {
    delete portfolio.positions[coin];
  } else {
    portfolio.positions[coin] = { qty: newQty };
  }
}

portfolio.lastUpdated = new Date().toISOString();
const totalValueNow = computeTotalValueUsd(portfolio, prices);
portfolio.equityHistory.push({ timestamp: portfolio.lastUpdated, totalValueUsd: totalValueNow });

await saveJson(PORTFOLIO_PATH, portfolio);
await appendDecision({
  timestamp: portfolio.lastUpdated,
  status: "executed",
  action,
  coin,
  usdAmount,
  price,
  reasoning,
  portfolioAfter: {
    cashUsd: portfolio.cashUsd,
    positions: portfolio.positions,
    totalValueUsd: totalValueNow,
  },
});

console.log(
  `OK: ${action} $${usdAmount.toFixed(2)} of ${coin} @ $${price.toFixed(2)}. ` +
    `Cash now $${portfolio.cashUsd.toFixed(2)}, total portfolio value $${totalValueNow.toFixed(2)}.`
);
