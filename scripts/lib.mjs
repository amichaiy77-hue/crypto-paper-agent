import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, "..", "data");
export const CONFIG_PATH = path.join(DATA_DIR, "config.json");
export const PORTFOLIO_PATH = path.join(DATA_DIR, "portfolio.json");
export const DECISIONS_PATH = path.join(DATA_DIR, "decisions.json");

export async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function saveJson(filePath, data) {
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function loadConfig() {
  return loadJson(CONFIG_PATH);
}

export async function loadPortfolio() {
  return loadJson(PORTFOLIO_PATH);
}

export async function appendDecision(entry) {
  const decisions = await loadJson(DECISIONS_PATH);
  decisions.push(entry);
  // keep the log bounded so it doesn't grow forever
  const MAX_ENTRIES = 2000;
  const trimmed = decisions.length > MAX_ENTRIES ? decisions.slice(-MAX_ENTRIES) : decisions;
  await saveJson(DECISIONS_PATH, trimmed);
}

// Fetches current USD prices for every coin in config.watchlist from CoinGecko's
// free public API (no key required). Returns { BTC: 65000, ETH: 3400, ... }.
export async function fetchPrices(config) {
  const ids = Object.values(config.coingeckoIds).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CoinGecko request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const prices = {};
  for (const [symbol, id] of Object.entries(config.coingeckoIds)) {
    const price = data[id]?.usd;
    if (typeof price !== "number") {
      throw new Error(`No price returned for ${symbol} (${id})`);
    }
    prices[symbol] = price;
  }
  return prices;
}

export function computeTotalValueUsd(portfolio, prices) {
  let total = portfolio.cashUsd;
  for (const [coin, position] of Object.entries(portfolio.positions)) {
    const price = prices[coin];
    if (typeof price === "number") {
      total += position.qty * price;
    }
  }
  return total;
}
