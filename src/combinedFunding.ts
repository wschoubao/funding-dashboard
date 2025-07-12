import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import cron from 'node-cron';
import * as ccxt from 'ccxt';

// ESM 下模拟 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// data 目录和文件路径
const dataDir = path.resolve(__dirname, '../data');
const combinedCsvPath = path.join(dataDir, 'combined_all_fundingfee.csv');


const binanceFutures = new ccxt.binance({
    options: { defaultType: 'future' },
  });
  
  const bybitFutures = new ccxt.bybit({
    options: { defaultType: 'future' },
  });
  
  // Hyperliquid 实例
  const hyperliquid = new ccxt.hyperliquid({
  
  });
  
  // ----------------------------
  // 第一部分：历史资金费率（计算过去 1、2、3、5、7 天内的平均资金费率）
  // ----------------------------
  
  /**
   * 币安资金费率（包含资金费率间隔合并）
   */
  async function fetchBinanceFundingRates(exchange: ccxt.binance, symbols: string[], params = {}): Promise<void> {
    try {
      if (exchange.has['fetchFundingRates']) {
        const fundingRatesDict = await exchange.fetchFundingRates(symbols, { subType: 'linear', ...params });
        const fundingRates: Array<{ symbol: string; [key: string]: any }> = Object.values(fundingRatesDict);
        if (exchange.has['fetchFundingIntervals']) {
          const fundingIntervalsDict = await exchange.fetchFundingIntervals(symbols);
          const fundingIntervals: Array<{ symbol: string; interval?: string; [key: string]: any }> = Object.values(fundingIntervalsDict);
          const mergedData: Array<{ symbol: string; interval: string | null; [key: string]: any }> = fundingRates.map(rate => {
            const intervalData = fundingIntervals.find(interval => interval.symbol === rate.symbol);
            return { ...rate, interval: intervalData?.interval ?? "8h" };
          });
          console.table(mergedData);
        } else {
          console.table(fundingRates);
        }
      } else {
        console.error(`${exchange.id} does not support fetching funding rates.`);
      }
    } catch (error) {
      console.error(`Error fetching funding rates for ${exchange.id}:`, (error as Error).message);
    }
  }
  
  /**
   * Bybit 资金费率
   */
  async function fetchBybitFundingRates(exchange: ccxt.bybit, symbols: string[], params = {}): Promise<void> {
    try {
      if (exchange.has['fetchFundingRates']) {
        const fundingRates = await exchange.fetchFundingRates(symbols, params);
        console.table(fundingRates);
      } else {
        console.error(`${exchange.id} does not support fetching funding rates.`);
      }
    } catch (error) {
      console.error(`Error fetching funding rates for ${exchange.id}:`, error);
    }
  }
  
  /**
   * Hyperliquid 资金费率
   */
  async function fetchHyperliquidFundingRates(exchange: ccxt.Exchange, symbols: string[], params = {}): Promise<void> {
    try {
      if (exchange.has['fetchFundingRates']) {
        const fundingRates = await exchange.fetchFundingRates(symbols, params);
        console.table(fundingRates);
      } else {
        console.error(`${exchange.id} does not support fetching funding rates.`);
      }
    } catch (error) {
      console.error(`Error fetching funding rates for ${exchange.id}:`, (error as Error).message);
    }
  }
  
  /**
   * 获取所有期货交易对（仅选择合约市场）
   */
  async function getFuturesSymbols(exchange: ccxt.Exchange): Promise<string[]> {
    try {
      await exchange.loadMarkets();
      return Object.keys(exchange.markets)
        .filter(symbol => exchange.markets[symbol].contract)
        .map(symbol => exchange.markets[symbol].symbol);
    } catch (error) {
      console.error(`Error fetching futures symbols for ${exchange.id}:`, error);
      return [];
    }
  }
  
  /**
   * 计算单个交易对在过去 1、2、3、5、7 天内的平均每天资金费率总和
   */
  async function calculateAvgFundingRatesForSymbol(
    exchange: ccxt.Exchange,
    symbol: string
  ): Promise<{ [key: string]: number }> {
    const now = Date.now();
    const periods = [1, 2, 3, 5, 7];
    const result: { [key: string]: number } = {};
    const msPerDay = 24 * 60 * 60 * 1000;
    const since7 = now - 7 * msPerDay;
    try {
      const history = await exchange.fetchFundingRateHistory(symbol, since7);
      for (const days of periods) {
        const since = now - days * msPerDay;
        const filtered = history.filter(item => item.timestamp !== undefined && item.timestamp >= since);
        const total = filtered.reduce((acc, cur) => acc + Number(cur.fundingRate), 0);
        result[`${days}d`] = total / days;
      }
    } catch (error) {
      console.error(`Error fetching funding rate history for ${symbol}:`, (error as Error).message);
      for (const days of periods) {
        result[`${days}d`] = NaN;
      }
    }
    return result;
  }

  /**
 * 通用处理函数：
 * 1. 获取交易所期货交易对；
 * 2. 调用资金费率接口（期间抑制中间日志输出）；
 * 3. 计算各交易对在 1、2、3、5、7 天内的平均资金费率；
 * 4. 返回带有 exchange 标签的记录数组。
 */
async function processExchangeFunding(
    exchange: ccxt.Exchange,
    exchangeLabel: string,
    fetchFundingRatesFn: (ex: any, symbols: string[], params?: any) => Promise<void>
  ): Promise<FundingRateAvg[]> {
    // 暂时抑制 console 输出，避免中间日志干扰
    const originalConsoleLog = console.log;
    const originalConsoleTable = console.table;
    const originalConsoleError = console.error;
    console.log = () => {};
    console.table = () => {};
    console.error = () => {};
  
    const fundingRateAverages: FundingRateAvg[] = [];
    try {
      const symbols = await getFuturesSymbols(exchange);
      await fetchFundingRatesFn(exchange, symbols);
      
      for (const symbol of symbols) {
        const averages = await calculateAvgFundingRatesForSymbol(exchange, symbol);
        fundingRateAverages.push({
          exchange: exchangeLabel,
          symbol,
          '1d': averages['1d'],
          '2d': averages['2d'],
          '3d': averages['3d'],
          '5d': averages['5d'],
          '7d': averages['7d']
        });
      }
    } finally {
      // 恢复原始 console 方法
      console.log = originalConsoleLog;
      console.table = originalConsoleTable;
      console.error = originalConsoleError;
    }
    return fundingRateAverages;
  }

// ----------------------------
// 第二部分：实时资金费率（直接获取资金费率数据，并格式化后写入 CSV）
// （此处为避免与第一部分函数重名，函数名增加了 Current 后缀）
// ----------------------------

/**
 * Fetch funding rates for Binance（移除 info 字段，并增加 exchange 字段）
 */
async function fetchBinanceFundingRatesCurrent(exchange: ccxt.binance, symbols: string[], params = {}): Promise<any[]> {
    try {
      if (exchange.has['fetchFundingRates']) {
        const fundingRatesDict = await exchange.fetchFundingRates(symbols, { subType: 'linear', ...params });
        const fundingRates: Array<{ symbol: string; [key: string]: any }> = Object.values(fundingRatesDict);
        let resultData: Array<{ symbol: string; [key: string]: any }> = [];
        if (exchange.has['fetchFundingIntervals']) {
          const fundingIntervalsDict = await exchange.fetchFundingIntervals(symbols);
          const fundingIntervals: Array<{ symbol: string; interval?: string; [key: string]: any }> = Object.values(fundingIntervalsDict);
          resultData = fundingRates.map(rate => {
            const intervalData = fundingIntervals.find(interval => interval.symbol === rate.symbol);
            return { ...rate, interval: intervalData?.interval ?? "8h" };
          });
        } else {
          resultData = fundingRates;
        }
        return resultData.map(record => {
          const { info, ...rest } = record;
          return { ...rest, exchange: exchange.id };
        });
      }
    } catch (error) {
      // 出现错误时返回空数组
    }
    return [];
  }
  
  /**
   * Fetch funding rates for Bybit（移除 info 字段，并增加 exchange 字段）
   */
  async function fetchBybitFundingRatesCurrent(exchange: ccxt.bybit, symbols: string[], params = {}): Promise<any[]> {
    try {
      if (exchange.has['fetchFundingRates']) {
        const fundingRates = await exchange.fetchFundingRates(symbols, params);
        const ratesArray = Array.isArray(fundingRates) ? fundingRates : Object.values(fundingRates);
        return ratesArray.map((record: any) => {
          const { info, ...rest } = record;
          return { ...rest, exchange: exchange.id };
        });
      }
    } catch (error) {
      // 出现错误时返回空数组
    }
    return [];
  }
  
  /**
   * Fetch funding rates for Hyperliquid（移除 info 字段，并增加 exchange 字段）
   */
  async function fetchHyperliquidFundingRatesCurrent(exchange: ccxt.Exchange, symbols: string[], params = {}): Promise<any[]> {
    try {
      if (exchange.has['fetchFundingRates']) {
        const fundingRates = await exchange.fetchFundingRates(symbols, params);
        const ratesArray = Array.isArray(fundingRates) ? fundingRates : Object.values(fundingRates);
        return ratesArray.map((record: any) => {
          const { info, ...rest } = record;
          return { ...rest, exchange: exchange.id };
        });
      }
    } catch (error) {
      // 出现错误时返回空数组
    }
    return [];
  }
  
  // 定义实时资金费率 CSV 记录类型
  interface FundingRateData {
    exchange: string;
    symbol: string;
    datetime: string;
    fundingRate: string;
    interval: string;
    markPrice: string;
  }
  
  /**
   * 处理各交易所的实时资金费率数据：
   * 1. 获取期货交易对；
   * 2. 调用各交易所资金费率接口；
   * 3. 格式化数据（如 timestamp 转 datetime、资金费率乘以 100 保留 4 位小数、markPrice 保留 4 位小数）；
   * 4. 返回格式化后的记录数组。
   */
  async function processCurrentFundingRates(): Promise<FundingRateData[]> {
    // 币安
    const symbolsBinance = await getFuturesSymbols(binanceFutures);
    const dataBinance = await fetchBinanceFundingRatesCurrent(binanceFutures, symbolsBinance);
  
    // Bybit
    const symbolsBybit = await getFuturesSymbols(bybitFutures);
    const dataBybit = await fetchBybitFundingRatesCurrent(bybitFutures, symbolsBybit);
  
    // Hyperliquid
    const symbolsHyperliquid = await getFuturesSymbols(hyperliquid);
    const dataHyperliquid = await fetchHyperliquidFundingRatesCurrent(hyperliquid, symbolsHyperliquid);
  
    const combined = [...dataBinance, ...dataBybit, ...dataHyperliquid];
  
    const formatted: FundingRateData[] = combined.map(record => {
      const exchange = record.exchange || "";
      const symbol = record.symbol || "";
      const datetime = record.timestamp
        ? new Date(record.timestamp).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
        : "";
      let fundingRate = "";
      if (record.fundingRate !== undefined && record.fundingRate !== null && !isNaN(record.fundingRate)) {
        fundingRate = (Number(record.fundingRate) * 100).toFixed(4);
      }
      const interval = record.interval ? String(record.interval) : "";
      let markPrice = "";
      if (record.markPrice !== undefined && record.markPrice !== null && !isNaN(record.markPrice)) {
        markPrice = Number(record.markPrice).toFixed(4);
      }
      return { exchange, symbol, datetime, fundingRate, interval, markPrice };
    });
  
    return formatted;
  }

type FundingRateAvg = {
  exchange: string;
  symbol: string;
  '1d': number;
  '2d': number;
  '3d': number;
  '5d': number;
  '7d': number;
};

interface FundingRateData {
  exchange: string;
  symbol: string;
  datetime: string;
  fundingRate: string;
  interval: string;
  markPrice: string;
}

interface CombinedFundingRate {
  exchange: string;
  symbol: string;
  '1d'?: number;
  '2d'?: number;
  '3d'?: number;
  '5d'?: number;
  '7d'?: number;
  datetime?: string;
  fundingRate?: string;
  interval?: string;
  markPrice?: string;
}

async function updateCombinedData() {
  const timestamp = new Date().toISOString();
  try {
    // 1. 处理历史资金费率
    const binanceHist = await processExchangeFunding(
      new ccxt.binance({ options: { defaultType: 'future' } }),
      'binance',
      fetchBinanceFundingRates
    );
    const bybitHist = await processExchangeFunding(
      new ccxt.bybit({ options: { defaultType: 'future' } }),
      'bybit',
      fetchBybitFundingRates
    );
    const hyperHist = await processExchangeFunding(
      new ccxt.hyperliquid({}),
      'hyperliquid',
      fetchHyperliquidFundingRates
    );
    const allHist = [...binanceHist, ...bybitHist, ...hyperHist];
    
    // 过滤 & 格式化历史数据
    const periods: Array<'1d'|'2d'|'3d'|'5d'|'7d'> = ['1d','2d','3d','5d','7d'];
    const histFiltered = allHist
      .filter(r => periods.some(p => !isNaN(Number(r[p])) && Number(r[p])!==0))
      .map(r => {
        periods.forEach(p => { r[p] = parseFloat((Number(r[p])*100).toFixed(4)); });
        return r;
      });

    // 2. 获取实时数据
    const current = await processCurrentFundingRates();

    // 3. 全外连接合并
    const map = new Map<string, any>();
    histFiltered.forEach(r => {
      map.set(`${r.exchange}||${r.symbol}`, { ...r });
    });
    current.forEach(r => {
      const key = `${r.exchange}||${r.symbol}`;
      const prev = map.get(key) || { exchange: r.exchange, symbol: r.symbol };
      map.set(key, { ...prev, ...r });
    });
    const combined = Array.from(map.values());

    // 4. 生成 CSV 内容
    const headers = ['exchange','symbol','1d','2d','3d','5d','7d','datetime','fundingRate','interval','markPrice'];
    const lines = [ headers.join(',') ];
    combined.forEach(rec => {
      const row = headers.map(h => {
        const v = rec[h as keyof typeof rec];
        if (v === undefined || v === null) return '';
        const s = String(v);
        return (s.includes(',') || s.includes('"')) ? `"${s.replace(/"/g, '""')}"` : s;
      });
      lines.push(row.join(','));
    });

    // 确保 data 目录存在
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(combinedCsvPath, lines.join('\n'), 'utf8');
    console.log(`[${timestamp}] 已更新合并资金费 CSV，共 ${combined.length} 条记录`);
  } catch (error) {
    console.error(`[${timestamp}] 更新合并资金费 CSV 失败：`, error);
  }
}
// 启动立即执行一次，并每 20 分钟执行一次
updateCombinedData();
// combinedFunding.ts
cron.schedule('*/20 * * * *', () => {
  console.log(`[${new Date().toISOString()}] Cron(combined) 任务触发`);
  updateCombinedData().catch(console.error);
});
