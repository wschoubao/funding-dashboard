// 在最顶部，先把定时脚本都加载一遍
import './fetchFunding.js';        // 注意编译后带 .js
import './combinedFunding.js';     // 同上

import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

// ESM 下模拟 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const publicDir = path.join(__dirname, '../public');
const dataDir = path.join(__dirname, '../data');

// 提供静态资源: public 下的页面、JS、CSS
app.use(express.static(publicDir));

// 原始页面数据接口: all_funding_rates.csv
app.get('/api/data', async (_req, res) => {
  try {
    const csv = await fs.readFile(path.join(dataDir, 'all_funding_rates.csv'), 'utf-8');
    const [headerLine, ...rows] = csv.trim().split('\n');
    const headers = headerLine.split(',');
    const data = rows.map(line => {
      const cols = line.split(',');
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = cols[i] || ''; });
      return obj;
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 合并数据接口: combined_all_fundingfee.csv
app.get('/api/combined-data', async (_req, res) => {
  try {
    const csv = await fs.readFile(path.join(dataDir, 'combined_all_fundingfee.csv'), 'utf-8');
    const [headerLine, ...rows] = csv.trim().split('\n');
    const headers = headerLine.split(',');
    const data = rows.map(line => {
      const cols = line.split(',');
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = cols[i] || ''; });
      return obj;
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 路由: 首页面
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// 路由: 历史+实时页面
app.get('/history', (_req, res) => {
  res.sendFile(path.join(publicDir, 'history.html'));
});

// 兜底: 其他都返回首页
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`服务启动: http://0.0.0.0:${PORT}`);
});

