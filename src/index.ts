import './fetchFunding.js'  // ← 加这一行，启动时就会跑拉取和定时任务
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// 静态资源
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

// API: 读 CSV，返回 JSON
app.get('/api/data', async (_req, res) => {
  try {
    const csv = await fs.readFile(path.join(__dirname, '../data/all_funding_rates.csv'), 'utf-8');
    const [head, ...rows] = csv.trim().split('\n').map(r => r.split(','));
    const result = rows.map(cols => {
      const o: any = {};
      head.forEach((h, i) => o[h] = cols[i]);
      return o;
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
// 其余请求都返回 index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`服务启动：http://0.0.0.0:${PORT}`);
});