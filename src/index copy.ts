import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import express, { Request, Response } from 'express';
import cron from 'node-cron';
import * as ccxt from 'ccxt'
// 或者
// 在文件顶部已导入：

// ESM 下模拟 __filename 和 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// data 目录和 CSV 路径
const dataDir = path.resolve(__dirname, '../data');
const csvPath = path.join(dataDir, 'all_funding_rates.csv');

const exchangeConfigs = [
    
    { id: 'binance', options: { enableRateLimit: true, defaultType: 'future' } },
    { id: 'bybit', options: { enableRateLimit: true } },
    { id: 'bitget', options: { enableRateLimit: true } },
    { id: 'gate', options: { enableRateLimit: true } },
    { id: 'lbank', options: { enableRateLimit: true } },
    { id: 'bingx', options: { enableRateLimit: true } },
    // { id: 'mexc', options: { enableRateLimit: true } },
    // { id: 'okx', options: { enableRateLimit: false, defaultType: 'future' } },
    // { id: 'bitmart', options: { enableRateLimit: false } },
    // { id: 'kucoinfutures', options: { enableRateLimit: true } },
    // { id: 'whitebit', options: { enableRateLimit: true } },
    // { id: 'coinex', options: { enableRateLimit: true } },
    // { id: 'woo', options: { enableRateLimit: true } },
  ];
interface FundingEntry {
    exchange: string;
    symbol: string;
    fundingRate: number;
  }

// 从单个交易所获取资金费率
async function fetchExchangeFundingRates(id: string, options: any): Promise<FundingEntry[]> {
    const Exchange = (ccxt as any)[id];
    if (!Exchange) {
      console.warn(`Exchange ${id} not supported by CCXT`);
      return [];
    }
    const exchange: ccxt.Exchange = new Exchange(options);
    await exchange.loadMarkets();
    const entries: FundingEntry[] = [];
    console.log(exchange.has['fetchFundingRates'])
  
    // 批量获取
    if (exchange.has['fetchFundingRates']) {
        
      try {
        const raw = await (exchange as any).fetchFundingRates();
        const ratesArray = Array.isArray(raw)
          ? raw
          : (raw && typeof raw === 'object')
            ? Object.values(raw)
            : [];
        for (const rateObj of ratesArray) {
          if (rateObj?.symbol && rateObj.fundingRate != null) {
            entries.push({ exchange: id, symbol: rateObj.symbol, fundingRate: rateObj.fundingRate });
          }
        }
        return entries;
      } catch (error) {
        console.warn(`Bulk fetchFundingRates failed for ${id}, falling back:`, error);
      }
    }
  
    // 回退：逐个币对获取
    for (const symbol of exchange.symbols) {
      const market = exchange.markets[symbol];
      if (!market.contract && !market.future) continue;
      try {
        const rateObj = await (exchange as any).fetchFundingRate(symbol);
        if (rateObj?.fundingRate != null) {
          entries.push({ exchange: id, symbol, fundingRate: rateObj.fundingRate });
        }
      } catch {
        // 忽略错误
      }
    }
    return entries;
  }

// 更新 CSV
async function updateData() {
  await fs.mkdir(dataDir, { recursive: true });

  const all: FundingEntry[] = [];
  for (const { id, options } of exchangeConfigs) {
    console.log(`Fetching ${id}...`);
    const rates = await fetchExchangeFundingRates(id, options);
    all.push(...rates);
  }
  if (all.length === 0) {
    console.error('无数据');
    return;
  }
  const exchanges = exchangeConfigs.map(c => c.id);
  const symbolSet = new Set<string>();
  all.forEach(e => symbolSet.add(e.symbol));
  const symbols = Array.from(symbolSet).sort();
  const map: Record<string, Record<string, number>> = {};
  all.forEach(({ exchange, symbol, fundingRate }) => {
    map[symbol] = map[symbol] || {};
    map[symbol][exchange] = fundingRate;
  });
  const header = ['symbol', ...exchanges];
  const lines = [header.join(',')];
  symbols.forEach(sym => {
    const row = [
      sym,
      ...exchanges.map(ex => (map[sym][ex] != null ? (map[sym][ex] * 100).toFixed(2) : ''))
    ];
    lines.push(row.join(','));
  });
  await fs.writeFile(csvPath, lines.join('\n'));
  console.log(`更新 ${symbols.length} 条`);
}

// 首次更新并定时
updateData().catch(console.error);
cron.schedule('*/30 * * * *', () => updateData());

// Express 服务
const app = express();
const PORT: number = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
// API: 返回 JSON 数据
app.get('/api/data', async (_req: Request, res: Response) => {
  try {
    const csv = await fs.readFile(csvPath, 'utf-8');
    const rows = csv.trim().split('\n').map(line => line.split(','));
    const [header, ...dataRows] = rows;
    const result = dataRows.map(r => {
      const obj: any = {};
      header.forEach((h, i) => (obj[h] = r[i]));
      return obj;
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 根路由: 现代化页面，DataTables 排序
app.get('/', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Funding Rates 仪表盘</title>
  <link rel="stylesheet" href="https://cdn.datatables.net/1.13.4/css/jquery.dataTables.min.css">
  <style>body{font-family:Arial,sans-serif;padding:20px;}h1{text-align:center;}</style>
</head>
<body>
  <h1>Rates 汇总</h1>
  <table id="fundingTable" class="display" style="width:100%"></table>
  <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
  <script src="https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js"></script>
  <script>
    $(document).ready(function() {
      $.getJSON('/api/data', function(data) {
        const columns = Object.keys(data[0] || {}).map(key => ({ title: key, data: key }));
        $('#fundingTable').DataTable({ data, columns });
      });
      // 每 30 分钟刷新页面
      setTimeout(() => location.reload(), 1800 * 1000);
    });
  </script>
</body>
</html>`);
});

// 改成这样
app.listen(PORT, '0.0.0.0', () => {
    console.log(`服务启动: http://0.0.0.0:${PORT}`);
  });