import { fileURLToPath } from 'url';
import path from 'path';
import * as ccxt from 'ccxt';
import express from 'express';
import cron from 'node-cron';
import fs from 'fs/promises';
import { parse } from 'csv-parse/sync';

// ESM 模式下模拟 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
const PORT   = process.env.PORT || 3000;
const dataDir = path.resolve(__dirname, 'data');
const csvPath  = path.join(dataDir, 'all_funding_rates.csv');

// … 其余逻辑不变 …

const exchangeConfigs = [
  { id: 'binance', options: { enableRateLimit: true, defaultType: 'future' } },
  { id: 'bybit', options: { enableRateLimit: true } },
  { id: 'bitget', options: { enableRateLimit: true } },
  { id: 'gate', options: { enableRateLimit: true } },
  { id: 'lbank', options: { enableRateLimit: true } },
//   { id: 'bingx', options: { enableRateLimit: true } },
//   { id: 'mexc', options: { enableRateLimit: true } },
//   { id: 'okx', options: { enableRateLimit: false, defaultType: 'future' } },
//   { id: 'bitmart', options: { enableRateLimit: false } },
//   { id: 'kucoinfutures', options: { enableRateLimit: true } },
//   { id: 'whitebit', options: { enableRateLimit: true } },
//   { id: 'coinex', options: { enableRateLimit: true } },
//   { id: 'woo', options: { enableRateLimit: true } },
];

async function fetchExchangeFundingRates(id, options) {
  const Exchange = ccxt[id];
  if (!Exchange) return [];
  const exchange = new Exchange(options);
  await exchange.loadMarkets();
  const entries = [];

  if (exchange.has['fetchFundingRates']) {
    try {
      const raw = await exchange.fetchFundingRates();
      const arr = Array.isArray(raw) ? raw : Object.values(raw);
      for (const o of arr) {
        if (o.symbol && o.fundingRate != null) {
          entries.push({ exchange: id, symbol: o.symbol, fundingRate: o.fundingRate });
        }
      }
      return entries;
    } catch { /* bulk 请求失败 */ }
  }

  for (const symbol of exchange.symbols) {
    const m = exchange.markets[symbol];
    if (!m.contract && !m.future) continue;
    try {
      const o = await exchange.fetchFundingRate(symbol);
      if (o.fundingRate != null) {
        entries.push({ exchange: id, symbol, fundingRate: o.fundingRate });
      }
    } catch { }
  }
  return entries;
}

async function updateCsv() {
  await fs.mkdir(dataDir, { recursive: true });
  const all = [];
  for (const { id, options } of exchangeConfigs) {
    console.log(`Fetching ${id}...`);
    const rates = await fetchExchangeFundingRates(id, options);
    all.push(...rates);
  }
  const exs = exchangeConfigs.map(c => c.id);
  const syms = Array.from(new Set(all.map(e => e.symbol))).sort();
  const map = {};
  all.forEach(({ exchange, symbol, fundingRate }) => {
    map[symbol] ??= {};
    map[symbol][exchange] = fundingRate;
  });
  const lines = [['symbol', ...exs].join(',')];
  syms.forEach(sym => {
    const row = [sym, ...exs.map(ex => map[sym][ex] != null ? (map[sym][ex] * 100).toFixed(2) : '')];
    lines.push(row.join(','));
  });
  await fs.writeFile(csvPath, lines.join('\n'));
  console.log(`CSV updated: ${syms.length} symbols`);
}

// 服务端每 30 分钟更新一次
cron.schedule('*/30 * * * *', () => {
  console.log('Scheduled update...');
  updateCsv();
});

// 启动时先跑一次
updateCsv().catch(console.error);

// 首页：展示表格，并且自动每 30 分钟刷新页面
app.get('/', async (req, res) => {
  let html = `
    <meta http-equiv="refresh" content="1800">
    <h1>Funding Rates 汇总（每 30 分钟刷新）</h1>
    <table border="1" cellpadding="4" cellspacing="0">
  `;
  try {
    const csv = await fs.readFile(csvPath, 'utf-8');
    const records = parse(csv, { columns: false, skip_empty_lines: true });
    records.forEach((row, i) => {
      html += '<tr>' + row.map(cell => (i === 0 ? `<th>${cell}</th>` : `<td>${cell}</td>`)).join('') + '</tr>';
    });
  } catch (e) {
    html += `<tr><td colspan="100%">数据暂不可用: ${e.message}</td></tr>`;
  }
  html += '</table>';
  res.send(html);
});

app.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});