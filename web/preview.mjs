import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Serve the production export under /preview/ to exercise relative assets. */
export async function createPreview() {
  const root = await realpath(fileURLToPath(new URL('../dist/', import.meta.url)));
  /** @type {Record<string, string>} */
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain' };
  return createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405).end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      if (pathname === '/') { res.writeHead(302, { Location: '/preview/' }).end(); return; }
      if (!pathname.startsWith('/preview/') || pathname.split('/').some(part => part.startsWith('.'))) throw new Error('Invalid path');
      const relative = pathname.slice('/preview/'.length) || 'index.html';
      const file = await realpath(resolve(root, relative));
      if (!file.startsWith(root + sep)) throw new Error('Outside export');
      const content = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(404).end('Not found'); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port from 1024–65535.');
  const server = await createPreview();
  server.listen(port, '127.0.0.1', () => console.log(`Production preview: http://127.0.0.1:${port}/preview/`));
}
