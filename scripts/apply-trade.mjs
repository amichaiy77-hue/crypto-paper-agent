// Usage: node scripts/apply-trade.mjs <buy|sell> <SYMBOL> <usdAmount> "<reasoning>"
//
// Executes a paper (virtual money) trade against data/portfolio.json.
// Re-fetches live prices itself rather than trusting a caller-supplied price,
// so the executed price can't be gamed. Supports leverage (cash can go
// negative, i.e. borrowed) and short selling (position qty can go negative)
// when enabled in data/config.json. The only guardrail is gross exposure
// (sum of |position value| across everything held) staying within
// maxLeverage x equity. If a trade would violate that — or shorting/leverage
// is disabled and the trade needs it — nothing is written to portfolio.json
// and the attempt is logged to decisions.json as "rejected" so the reasoning
// is still visible on the dashboard.
import {
  loadConfig,
  loadPortfolio,
  saveJson,
  appendDecision,
  fetchPrices,
  computeTotalValueUsd,
  computeGrossExposureUsd,
  PORTFOLIO_PATH,
} from "./lib.mjs";

const [action, symbol, usdAmountRaw, reasoning] = process.argv.slice(2);

function fail(message) {
  console.error(`Trade rejected: ${message}`);
  process.exit(1);
}

if (!["buy", "sell"].includes(action)) {
  fail(`first argument must be "buy" or "sell", got "${action}"`);
}
if (!symbol) fail("symbol is required, e.g. BTC or QQQ");
const usdAmount = Number(usdAmountRaw);
if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
  fail(`usdAmount must be a positive number, got "${usdAmountRaw}"`);
}
if (!reasoning || !reasoning.trim()) {
  fail("a reasoning string is required as the 4th argument");
}

const config = await loadConfig();
if (!config.watchlist.includes(symbol)) {
  fail(`${symbol} is not in the watchlist (${config.watchlist.join(", ")})`);
}

const portfolio = await loadPortfolio();
const prices = await fetchPrices(config);
const price = prices[symbol];

async function reject(reason) {
  await appendDecision({
    timestamp: new Date().toISOString(),
    status: "rejected",
    action,
    symbol,
    usdAmount,
    price,
    reasoning,
    rejectReason: reason,
  });
  fail(reason);
}

const existingQty = portfolio.positions[symbol]?.qty ?? 0;
const qtyDelta = usdAmount / price;
const newQty = action === "buy" ? existingQty + qtyDelta : existingQty - qtyDelta;
const newCash = action === "buy" ? portfolio.cashUsd - usdAmount : portfolio.cashUsd + usdAmount;

const { allowShort, allowLeverage, maxLeverage } = config.riskRules;

if (!allowShort && newQty < -1e-9) {
  await reject(`would open a short position in ${symbol} (shorting is disabled)`);
}
if (!allowLeverage && newCash < -1e-9) {
  await reject(
    `would require borrowing $${Math.abs(newCash).toFixed(2)} (leverage is disabled)`
  );
}

// Build the hypothetical post-trade portfolio to check leverage against.
const hypotheticalPositions = { ...portfolio.positions };
if (Math.abs(newQty) < 1e-9) {
  delete hypotheticalPositions[symbol];
} else {
  hypotheticalPositions[symbol] = { qty: newQty };
}
const hypotheticalPortfolio = { cashUsd: newCash, positions: hypotheticalPositions };

const equityAfter = computeTotalValueUsd(hypotheticalPortfolio, prices);
const grossExposureAfter = computeGrossExposureUsd(hypotheticalPortfolio, prices);
const usingLeverageOrShort = newCash < -1e-9 || grossExposureAfter > equityAfter + 1e-6;

if (usingLeverageOrShort) {
  if (equityAfter <= 0) {
    await reject(
      `equity would be $${equityAfter.toFixed(2)} (zero or negative) after this trade — no further leveraged/short trades allowed`
    );
  }
  const impliedLeverage = grossExposureAfter / equityAfter;
  if (impliedLeverage > maxLeverage + 1e-9) {
    await reject(
      `would use ${impliedLeverage.toFixed(2)}x leverage (gross exposure $${grossExposureAfter.toFixed(2)} vs equity $${equityAfter.toFixed(2)}), over the ${maxLeverage}x limit`
    );
  }
}

portfolio.cashUsd = newCash;
if (Math.abs(newQty) < 1e-9) {
  delete portfolio.positions[symbol];
} else {
  portfolio.positions[symbol] = { qty: newQty };
}
portfolio.lastUpdated = new Date().toISOString();
portfolio.lastPrices = prices;
portfolio.equityHistory.push({ timestamp: portfolio.lastUpdated, totalValueUsd: equityAfter });

await saveJson(PORTFOLIO_PATH, portfolio);
await appendDecision({
  timestamp: portfolio.lastUpdated,
  status: "executed",
  action,
  symbol,
  usdAmount,
  price,
  reasoning,
  portfolioAfter: {
    cashUsd: portfolio.cashUsd,
    positions: portfolio.positions,
    totalValueUsd: equityAfter,
  },
});

console.log(
  `OK: ${action} $${usdAmount.toFixed(2)} of ${symbol} @ $${price.toFixed(2)}. ` +
    `Cash now $${portfolio.cashUsd.toFixed(2)}, equity $${equityAfter.toFixed(2)}, gross exposure $${grossExposureAfter.toFixed(2)}.`
);
