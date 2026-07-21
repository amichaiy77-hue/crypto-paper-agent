// Usage: node scripts/fetch-prices.mjs
// Prints current USD prices for the configured watchlist as JSON.
import { loadConfig, fetchPrices } from "./lib.mjs";

const config = await loadConfig();
const prices = await fetchPrices(config);
console.log(JSON.stringify({ timestamp: new Date().toISOString(), prices }, null, 2));
