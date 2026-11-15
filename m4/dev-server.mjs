#!/usr/bin/env node
/**
 * 本地跑 M4 服务端（不依赖 Vercel）。
 *
 *   node dev-server.mjs            # http://127.0.0.1:8790
 *
 * 没有配置 KV_REST_API_URL 时用内存存储，重启即丢——只适合本地联调。
 */

import { createApp } from './lib/app.js';
import { hasRemoteStore } from './lib/store.js';

const PORT = Number(process.argv[2]) || 8790;
const server = createApp();

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 被占用，换一个：node dev-server.mjs ${PORT + 1}`);
  } else {
    console.error('启动失败：', err && err.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`M4 server: http://127.0.0.1:${PORT}/api/v1/health`);
  console.log(`storage: ${hasRemoteStore ? 'Upstash / Vercel KV' : 'memory (dev only, lost on restart)'}`);
});
