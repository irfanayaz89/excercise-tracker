#!/usr/bin/env node
/**
 * Development only: receives the one-line-a-second engine diagnostics that a
 * dev build of Trueline posts while a set is running, and prints them. Used to
 * tune thresholds on a real phone. Release builds never send anything.
 *
 *   node scripts/diag-server.mjs            # listens on port 8099
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8099);
createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(200).end('trueline diagnostics\n');
    return;
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c) => {
    body += c;
    if (body.length > 10_000) req.destroy();
  });
  req.on('end', () => {
    const time = new Date().toTimeString().slice(0, 8);
    for (const line of body.split('\n')) if (line.trim()) console.log(`${time} ${line}`);
    res.writeHead(204).end();
  });
}).listen(PORT, '0.0.0.0', () => console.log(`trueline diagnostics on :${PORT}`));
