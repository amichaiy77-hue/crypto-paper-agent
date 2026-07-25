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

async function fetchCryptoPrices(coingeckoIds) {
  const entries = Object.entries(coingeckoIds || {});
  if (entries.length === 0) return {};
  const ids = entries.map(([, id]) => id).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko request failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const prices = {};
  for (const [symbol, id] of entries) {
    const price = data[id]?.usd;
    if (typeof price !== "number") throw new Error(`No price returned for ${symbol} (${id})`);
    prices[symbol] = price;
  }
  return prices;
}

// Yahoo Finance's public (keyless) per-symbol chart endpoint. Outside US
// market hours this just returns the last regular-session close, which is
// expected (stocks don't trade 24/7 like crypto). Requires a browser-like
// User-Agent or Yahoo's edge returns a block page instead of JSON.
async function fetchStockPrices(tickers) {
  if (!tickers || tickers.length === 0) return {};
  const prices = {};
  await Promise.all(
    tickers.map(async (ticker) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (!res.ok) throw new Error(`Yahoo Finance request failed for ${ticker}: ${res.status}`);
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (typeof price !== "number") throw new Error(`No price returned for ${ticker} from Yahoo Finance`);
      prices[ticker] = price;
    })
  );
  return prices;
}

// Fetches current USD prices for everything in config.watchlist — crypto via
// CoinGecko, stocks via Yahoo Finance — and returns one merged { SYMBOL: price } map.
export async function fetchPrices(config) {
  const [crypto, stocks] = await Promise.all([
    fetchCryptoPrices(config.coingeckoIds),
    fetchStockPrices(config.stockTickers),
  ]);
  return { ...crypto, ...stocks };
}

export function computeTotalValueUsd(portfolio, prices) {
  let total = portfolio.cashUsd;
  for (const [symbol, position] of Object.entries(portfolio.positions)) {
    const price = prices[symbol];
    if (typeof price === "number") total += position.qty * price;
  }
  return total;
}

// Gross exposure = sum of |position value| across all holdings, long or
// short. This is what gets compared against maxLeverage * equity.
export function computeGrossExposureUsd(portfolio, prices) {
  let gross = 0;
  for (const [symbol, position] of Object.entries(portfolio.positions)) {
    const price = prices[symbol];
    if (typeof price === "number") gross += Math.abs(position.qty * price);
  }
  return gross;
}
