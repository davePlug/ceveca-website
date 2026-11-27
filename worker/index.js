const feedKey = 'instagram/current.json';
const limit = 6;
const maxImageBytes = 4 * 1024 * 1024;
const posterTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const tools = [
  {
    name: 'leggi_stato_instagram',
    description: 'Mostra i post Instagram attualmente visibili sul sito CEVECA.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'anteprima_instagram',
    description: 'Legge i post recenti dell’account Instagram della clinica e mostra quali sei appariranno sul sito. Nessuna pubblicazione.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'sincronizza_instagram',
    description: 'Dopo conferma della persona, pubblica i post dell’anteprima sul sito CEVECA usando il codice restituito dall’anteprima.',
    inputSchema: {
      type: 'object',
      properties: { codice_anteprima: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
      required: ['codice_anteprima'],
      additionalProperties: false,
    },
  },
];

function error(message, status = 400) {
  return new Response(message, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function sha(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function state(bucket) {
  const object = await bucket?.get(feedKey);
  if (!object) return { posts: [], syncedAt: null, sourceRevision: null, etag: null };
  return { ...await object.json(), etag: object.httpEtag };
}

function instagramUrl(value) {
  try {
    const url = new URL(value);
    if (['www.instagram.com', 'instagram.com'].includes(url.hostname) &&
        url.protocol === 'https:' && !url.port && !url.username && !url.password &&
        /^\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
      return 'https://www.instagram.com' + url.pathname.replace(/\/$/, '') + '/';
    }
  } catch {
    // Invalid records are skipped.
  }
  return null;
}

function imageSource(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)) return url;
  } catch {
    // Ignore malformed URLs returned by the provider.
  }
  return null;
}

function shortCaption(raw) {
  const line = String(raw || '').split(/\r?\n/).map(s => s.trim()).find(Boolean) || 'Un post di CEVECA';
  const characters = Array.from(line);
  return characters.length > 72 ? characters.slice(0, 69).join('').trimEnd() + '…' : line;
}

async function readInstagram(env) {
  if (!env.BUCKET) throw new Error('Lo spazio per salvare il carosello non è configurato.');
  const { INSTAGRAM_ACCESS_TOKEN: token, INSTAGRAM_USER_ID: account, INSTAGRAM_API_VERSION: version } = env;
  if (!token || !/^\d+$/.test(account ?? '') || !/^v\d+\.\d+$/.test(version ?? '')) {
    throw new Error('Il collegamento all’account Instagram professionale deve ancora essere configurato.');
  }
  const url = new URL('https://graph.instagram.com/' + version + '/' + account + '/media');
  url.searchParams.set('fields', 'id,media_type,media_url,thumbnail_url,caption,permalink,timestamp');
  url.searchParams.set('limit', '50');
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!response?.ok) throw new Error('Instagram non ha risposto. Verifica la connessione dell’account e riprova.');
  const { data } = await response.json();
  if (!Array.isArray(data)) throw new Error('Instagram ha restituito un elenco non valido.');
  const posts = [];
  const seen = new Set();
  for (const entry of data.sort((a, b) => Date.parse(b?.timestamp) - Date.parse(a?.timestamp))) {
    const link = instagramUrl(entry?.permalink);
    const type = entry?.media_type;
    const picture = imageSource(type === 'VIDEO' ? entry.thumbnail_url : entry?.media_url);
    const date = Date.parse(entry?.timestamp);
    if (!/^\d+$/.test(entry?.id ?? '') || !link || !picture || !Number.isFinite(date) ||
        !['IMAGE', 'CAROUSEL_ALBUM', 'VIDEO'].includes(type) || seen.has(link)) continue;
    seen.add(link);
    posts.push({
      post: { id: String(entry.id), url: link, caption: shortCaption(entry.caption), publishedAt: new Date(date).toISOString() },
      picture,
    });
    if (posts.length === limit) break;
  }
  if (!posts.length) throw new Error('Nessun post Instagram compatibile trovato. Il carosello resta disponibile.');
  return posts;
}

async function copyPoster(bucket, picture) {
  const response = await fetch(picture, {
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  const type = response?.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const size = Number(response?.headers.get('content-length'));
  if (!response?.ok || !response.body || !posterTypes.has(type) || size > maxImageBytes) {
    await response?.body?.cancel();
    throw new Error('Una fotografia di Instagram non è disponibile. Riprova più tardi.');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxImageBytes) throw new Error('Una fotografia supera il limite di 4 MB.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const tag = new TextDecoder().decode(bytes.subarray(0, 12));
  const matches = {
    'image/jpeg': bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    'image/png': bytes[0] === 137 && tag.slice(1, 4) === 'PNG',
    'image/webp': tag.startsWith('RIFF') && tag.slice(8) === 'WEBP',
  };
  if (!matches[type]) throw new Error('Instagram ha restituito una fotografia non valida.');
  const digest = await sha(bytes);
  await bucket.put('instagram/media/' + digest, bytes, { httpMetadata: { contentType: type } });
  return '/media/instagram/' + digest;
}

async function runTool(name, args, env) {
  if (!env.BUCKET) throw new Error('Lo spazio per salvare il carosello non è configurato.');
  const current = await state(env.BUCKET);
  if (name === 'leggi_stato_instagram') {
    return { source: current.posts.length ? 'Instagram' : 'Facebook', syncedAt: current.syncedAt, posts: current.posts };
  }
  const candidates = await readInstagram(env);
  const posts = candidates.map(row => row.post);
  const sourceRevision = await sha(JSON.stringify(posts));
  const preview = await sha(JSON.stringify([sourceRevision, current.etag]));
  const changed = sourceRevision !== current.sourceRevision;
  if (name === 'anteprima_instagram') return { changed, posts, codice_anteprima: preview };
  if (!changed) return { changed: false, posts: current.posts, syncedAt: current.syncedAt };
  if (args.codice_anteprima !== preview) {
    throw new Error('L’anteprima non è più attuale. Chiedi una nuova anteprima prima di pubblicare.');
  }
  const published = [];
  for (const { post, picture } of candidates) {
    published.push({ ...post, image: await copyPoster(env.BUCKET, picture) });
  }
  const syncedAt = new Date().toISOString();
  const guard = current.etag
    ? new Headers({ 'If-Match': current.etag })
    : new Headers({ 'If-None-Match': '*' });
  const saved = await env.BUCKET.put(feedKey, JSON.stringify({ posts: published, syncedAt, sourceRevision }), {
    onlyIf: guard,
    httpMetadata: { contentType: 'application/json' },
  });
  if (!saved) throw new Error('Un altro aggiornamento è appena arrivato. Chiedi una nuova anteprima.');
  return { changed: true, posts: published, syncedAt };
}

function operatorAllowed(request, env) {
  // Sites authenticates /mcp and supplies its verified account identity.
  const email = request.headers.get('oai-authenticated-user-email')?.toLowerCase();
  const allowed = (env.CEVECA_EDITOR_EMAILS ?? '').toLowerCase().split(',').map(value => value.trim());
  return Boolean(email && request.headers.get('oai-authenticated-user-id') && allowed.includes(email));
}

function rpc(id, result) {
  return Response.json({ jsonrpc: '2.0', id, ...result }, { headers: { 'Cache-Control': 'no-store' } });
}

async function mcp(request, env) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return error('Unsupported content type', 415);
  let body;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const decoder = new TextDecoder();
    let text = '';
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 8192) return error('Request too large', 413);
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    body = JSON.parse(text + decoder.decode());
  } catch {
    return rpc(null, { error: { code: -32700, message: 'Invalid JSON' } });
  }
  const id = body?.id ?? null;
  if (!body || body.jsonrpc !== '2.0') return rpc(id, { error: { code: -32600, message: 'Invalid request' } });
  if (body.method === 'server/discover') {
    return rpc(id, { result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } } });
  }
  if (body.method === 'tools/list') return rpc(id, { result: { tools } });
  if (body.method !== 'tools/call') return rpc(id, { error: { code: -32601, message: 'Unknown method' } });
  const name = body.params?.name;
  if (!tools.some(tool => tool.name === name)) return rpc(id, { error: { code: -32602, message: 'Unknown tool' } });
  const args = body.params?.arguments ?? {};
  if (!operatorAllowed(request, env)) {
    return rpc(id, { result: { isError: true, content: [{ type: 'text', text: 'Questo account non è autorizzato a gestire il sito CEVECA.' }] } });
  }
  if (typeof args !== 'object' || Array.isArray(args) ||
      (name === 'sincronizza_instagram' && !/^[a-f0-9]{64}$/.test(args.codice_anteprima ?? ''))) {
    return rpc(id, { error: { code: -32602, message: 'Invalid arguments' } });
  }
  try {
    const result = await runTool(name, args, env);
    return rpc(id, { result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
  } catch (e) {
    // Only operator-facing errors created here are safe to return. Runtime errors can contain provider URLs.
    const text = e instanceof Error && /^(?:Lo spazio|Il collegamento|Instagram|Nessun post|Una fotografia|L’anteprima|Un altro aggiornamento)/.test(e.message)
      ? e.message : 'Sincronizzazione non riuscita. Il carosello pubblicato resta disponibile.';
    return rpc(id, { result: { isError: true, content: [{ type: 'text', text }] } });
  }
}

const publicHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/mcp' && request.method === 'POST') return mcp(request, env);
    const head = request.method === 'HEAD';
    if (request.method !== 'GET' && !head) return error('Method not allowed', 405);

    if (path === '/feed/posts.json' || path === '/api/instagram') {
      try {
        const { posts, syncedAt } = await state(env.BUCKET);
        return new Response(head ? null : JSON.stringify({ posts, syncedAt }), {
          headers: { ...publicHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      } catch {
        return error('Feed unavailable', 503);
      }
    }

    const media = /^\/media\/instagram\/([a-f0-9]{64})$/.exec(path);
    if (media) {
      const key = 'instagram/media/' + media[1];
      const object = head ? await env.BUCKET?.head(key) : await env.BUCKET?.get(key);
      if (!object) return error('Not found', 404);
      return new Response(head ? null : object.body, {
        headers: { ...publicHeaders, 'Content-Type': object.httpMetadata.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
      });
    }

    const file = SITE_ASSETS[path === '/' ? '/index.html' : path];
    if (!file) return error('Not found', 404);
    return new Response(head ? null : Uint8Array.from(atob(file.data), character => character.charCodeAt(0)), {
      headers: { ...publicHeaders, 'Content-Type': file.type, 'Cache-Control': 'public, max-age=300' },
    });
  },
};
