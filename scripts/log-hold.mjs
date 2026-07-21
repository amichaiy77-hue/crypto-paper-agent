// Usage: node scripts/log-hold.mjs "<reasoning>"
//
// Records a "hold" decision (no trade) with the reasoning behind it, and adds
// a fresh equity-curve datapoint so the dashboard chart still moves with the
// market even on cycles where nothing was bought or sold.
import {
  loadConfig,
  loadPortfolio,
  saveJson,
  appendDecision,
  fetchPrices,
  computeTotalValueUsd,
  PORTFOLIO_PATH,
} from "./lib.mjs";

const reasoning = process.argv[2];
if (!reasoning || !reasoning.trim()) {
  console.error("Usage: node scripts/log-hold.mjs \"<reasoning>\"");
  process.exit(1);
}

const config = await loadConfig();
const portfolio = await loadPortfolio();
const prices = await fetchPrices(config);
const totalValueUsd = computeTotalValueUsd(portfolio, prices);
const timestamp = new Date().toISOString();

portfolio.lastUpdated = timestamp;
portfolio.equityHistory.push({ timestamp, totalValueUsd });
await saveJson(PORTFOLIO_PATH, portfolio);

await appendDecision({
  timestamp,
  status: "executed",
  action: "hold",
  prices,
  reasoning,
  portfolioAfter: {
    cashUsd: portfolio.cashUsd,
    positions: portfolio.positions,
    totalValueUsd,
  },
});

console.log(`OK: logged hold. Total portfolio value $${totalValueUsd.toFixed(2)}.`);
