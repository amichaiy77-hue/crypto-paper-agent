const fmtUsd = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const fmtPct = (n) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const fmtQty = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 6 });
const fmtTime = (iso) =>
  new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });

const ACTION_LABELS = { buy: "קנייה", sell: "מכירה", hold: "החזקה" };

async function loadJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function isDark() {
  const stamped = document.documentElement.getAttribute("data-theme");
  if (stamped) return stamped === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function renderStats(portfolio, config) {
  const startingBalance = config.startingBalanceUsd;
  const totalValue = portfolio.equityHistory.at(-1)?.totalValueUsd ?? startingBalance;
  const pnl = totalValue - startingBalance;
  const pnlPct = pnl / startingBalance;

  document.getElementById("totalValue").textContent = fmtUsd(totalValue);
  document.getElementById("cashValue").textContent = fmtUsd(portfolio.cashUsd);

  const pnlEl = document.getElementById("pnlValue");
  pnlEl.textContent = `${pnl >= 0 ? "+" : ""}${fmtUsd(pnl)}`;
  const pnlDeltaEl = document.getElementById("pnlDelta");
  pnlDeltaEl.textContent = fmtPct(pnlPct);
  pnlDeltaEl.className = `delta ${pnl >= 0 ? "up" : "down"}`;
  pnlEl.className = `value ${pnl >= 0 ? "" : ""}`;

  document.getElementById("lastUpdated").textContent = portfolio.lastUpdated
    ? `עודכן לאחרונה: ${fmtTime(portfolio.lastUpdated)}`
    : "";
}

function renderChart(portfolio) {
  const history = portfolio.equityHistory.filter((p) => p.timestamp);
  const ctx = document.getElementById("equityChart");
  const seriesColor = cssVar("--series-1");
  const gridColor = cssVar("--gridline");
  const mutedColor = cssVar("--text-muted");

  new Chart(ctx, {
    type: "line",
    data: {
      labels: history.map((p) => fmtTime(p.timestamp)),
      datasets: [
        {
          data: history.map((p) => p.totalValueUsd),
          borderColor: seriesColor,
          backgroundColor: seriesColor + "1a",
          borderWidth: 2,
          pointRadius: (ctx) => (ctx.dataIndex === history.length - 1 ? 4 : 0),
          pointBackgroundColor: seriesColor,
          pointBorderColor: cssVar("--surface"),
          pointBorderWidth: 2,
          fill: true,
          tension: 0.15,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => fmtUsd(ctx.parsed.y) },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: mutedColor, maxTicksLimit: 6, font: { size: 11 } },
        },
        y: {
          grid: { color: gridColor, drawTicks: false },
          border: { display: false },
          ticks: {
            color: mutedColor,
            font: { size: 11 },
            callback: (v) => fmtUsd(v).replace(".00", ""),
          },
        },
      },
    },
  });
}

function renderPositions(portfolio, prices) {
  const wrap = document.getElementById("positionsTableWrap");
  const coins = Object.keys(portfolio.positions);
  if (coins.length === 0) {
    wrap.innerHTML = '<p class="empty-note">אין פוזיציות פתוחות כרגע.</p>';
    return;
  }
  const totalValue = portfolio.equityHistory.at(-1)?.totalValueUsd ?? 1;
  const rows = coins
    .map((coin) => {
      const qty = portfolio.positions[coin].qty;
      const price = prices?.[coin];
      const value = price ? qty * price : null;
      const pct = value ? value / totalValue : null;
      return `<tr>
        <td>${coin}</td>
        <td>${fmtQty(qty)}</td>
        <td>${price ? fmtUsd(price) : "–"}</td>
        <td>${value ? fmtUsd(value) : "–"}</td>
        <td>${pct ? fmtPct(pct).replace("+", "") : "–"}</td>
      </tr>`;
    })
    .join("");
  wrap.innerHTML = `<table>
    <thead><tr><th>מטבע</th><th>כמות</th><th>מחיר נוכחי</th><th>שווי</th><th>% מהתיק</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderDecisions(decisions) {
  const list = document.getElementById("decisionsList");
  if (decisions.length === 0) {
    list.innerHTML = '<p class="empty-note">עדיין אין החלטות מתועדות.</p>';
    return;
  }
  const items = [...decisions]
    .reverse()
    .slice(0, 200)
    .map((d) => {
      const badgeClass = d.status === "rejected" ? "rejected" : d.action;
      const badgeLabel =
        d.status === "rejected" ? `נדחה: ${ACTION_LABELS[d.action] ?? d.action}` : ACTION_LABELS[d.action] ?? d.action;
      const amount =
        d.action !== "hold" && d.usdAmount ? ` · ${d.coin} · ${fmtUsd(d.usdAmount)}` : "";
      return `<div class="decision">
        <div class="meta">
          <span class="badge ${badgeClass}">${badgeLabel}</span>
          <span>${fmtTime(d.timestamp)}${amount}</span>
        </div>
        <div class="reasoning">${d.reasoning ?? ""}${d.rejectReason ? ` — <em>${d.rejectReason}</em>` : ""}</div>
      </div>`;
    })
    .join("");
  list.innerHTML = items;
}

async function main() {
  try {
    const [config, portfolio, decisions] = await Promise.all([
      loadJson("data/config.json"),
      loadJson("data/portfolio.json"),
      loadJson("data/decisions.json"),
    ]);

    renderStats(portfolio, config);
    renderChart(portfolio);
    renderDecisions(decisions);

    // best-effort live prices for the positions table; falls back gracefully if blocked
    let prices = null;
    try {
      const ids = Object.values(config.coingeckoIds).join(",");
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
      if (res.ok) {
        const data = await res.json();
        prices = {};
        for (const [symbol, id] of Object.entries(config.coingeckoIds)) {
          prices[symbol] = data[id]?.usd;
        }
      }
    } catch {
      // ignore — table just shows without live price/value columns
    }
    renderPositions(portfolio, prices);
  } catch (err) {
    document.querySelector(".wrap").insertAdjacentHTML(
      "afterbegin",
      `<div class="disclaimer">שגיאה בטעינת הנתונים: ${err.message}</div>`
    );
    console.error(err);
  }
}

main();
