import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import worker from '../dist/server/index.js';

const port = Number(process.env.PORT || 4173);
createServer(async (request, response) => {
  // Local preview serves the public pages with the bundled Facebook posts.
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405).end();
    return;
  }
  try {
    const result = await worker.fetch(new Request('http://127.0.0.1:' + port + request.url, {
      method: request.method,
    }), {});
    response.writeHead(result.status, Object.fromEntries(result.headers));
    if (result.body) Readable.fromWeb(result.body).pipe(response);
    else response.end();
  } catch {
    response.writeHead(500).end();
  }
}).listen(port, '127.0.0.1', () => console.log('CEVECA preview: http://127.0.0.1:' + port));
