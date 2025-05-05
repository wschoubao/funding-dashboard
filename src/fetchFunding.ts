import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import cron from 'node-cron';
import * as ccxt from 'ccxt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// data 目录和 CSV 路径
const dataDir = path.resolve(__dirname, '../data');
const csvPath = path.join(dataDir, 'all_funding_rates.csv');

interface FundingEntry {
  exchange: string;
  symbol: string;
  fundingRate: number;
}

const exchangeConfigs = [
  { id: 'binance', options: { enableRateLimit: true, defaultType: 'future' } },
  { id: 'bybit',   options: { enableRateLimit: true } },
  { id: 'bitget',  options: { enableRateLimit: true } },
  { id: 'gate',    options: { enableRateLimit: true } },
  { id: 'lbank',   options: { enableRateLimit: true } },
  { id: 'bingx',   options: { enableRateLimit: true } },
  { id: 'mexc', options: { enableRateLimit: true } },
  { id: 'okx', options: { enableRateLimit: false, defaultType: 'future' } },
  { id: 'bitmart', options: { enableRateLimit: false } },
  { id: 'kucoinfutures', options: { enableRateLimit: true } },
  { id: 'whitebit', options: { enableRateLimit: true } },
  { id: 'coinex', options: { enableRateLimit: true } },
  { id: 'woo', options: { enableRateLimit: true } },
];

// 单个交易所拉 funding rates
async function fetchExchangeFundingRates(id: string, options: any): Promise<FundingEntry[]> {
  const Exchange = (ccxt as any)[id];
  if (!Exchange) throw new Error(`Exchange ${id} not supported`);
  const ex: ccxt.Exchange = new Exchange(options);
  await ex.loadMarkets();
  const out: FundingEntry[] = [];
  // 尝试 bulk 接口
  if (ex.has['fetchFundingRates']) {
    try {
      const raw = await (ex as any).fetchFundingRates();
      const arr = Array.isArray(raw) ? raw : Object.values(raw);
      for (const o of arr) {
        if (o?.symbol && o.fundingRate != null) {
          out.push({ exchange: id, symbol: o.symbol, fundingRate: o.fundingRate });
        }
      }
      return out;
    } catch (e) {
      console.error(`Bulk fetchFundingRates failed for ${id}:`, e);
    }
  }
  // 回退：逐个 market
  for (const sy of ex.symbols) {
    const m = ex.markets[sy];
    if (!m.contract && !m.future) continue;
    try {
      const o = await (ex as any).fetchFundingRate(sy);
      if (o?.fundingRate != null) {
        out.push({ exchange: id, symbol: sy, fundingRate: o.fundingRate });
      }
    } catch {
      // 忽略单个符号错误
    }
  }
  return out;
}

async function updateData() {
  const timestamp = new Date().toISOString();
  await fs.mkdir(dataDir, { recursive: true });
  const all: FundingEntry[] = [];

  for (const cfg of exchangeConfigs) {
    console.log(`[${timestamp}] Fetching ${cfg.id}...`);
    let list: FundingEntry[] = [];
    let success = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        list = await fetchExchangeFundingRates(cfg.id, cfg.options);
        success = true;
        break;
      } catch (e) {
        console.error(`[${timestamp}] ${cfg.id} 拉取失败，正在重试（第 ${attempt} 次）`, e);
      }
    }
    if (!success) {
      console.error(`[${timestamp}] ${cfg.id} 拉取失败，已跳过`);
    } else {
      all.push(...list);
    }
  }

  if (all.length === 0) {
    console.error(`[${timestamp}] 无数据，跳过写入`);
    return;
  }

  // 构表
  const exIds = exchangeConfigs.map(c => c.id);
  const symbols = Array.from(new Set(all.map(e => e.symbol))).sort();
  const map: Record<string, Record<string, number>> = {};
  all.forEach(({ exchange, symbol, fundingRate }) => {
    map[symbol] = map[symbol] || {};
    map[symbol][exchange] = fundingRate;
  });

  const header = ['symbol', ...exIds];
  const lines = [header.join(',')];
  symbols.forEach(sym => {
    const row = [ sym, ...exIds.map(ex => {
      const v = map[sym][ex];
      return v != null ? (v * 100).toFixed(2) : '';
    }) ];
    lines.push(row.join(','));
  });

  await fs.writeFile(csvPath, lines.join('\n'), 'utf-8');
  console.log(`[${timestamp}] 更新完成 ${symbols.length} 个 symbol`);
}

// 首次执行 & 每 10 分钟执行一次
updateData().catch(console.error);
cron.schedule('*/10 * * * *', () => {
  updateData().catch(console.error);
});