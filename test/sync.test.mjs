import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../dist/server/index.js';

const request = path => new Request('https://ceveca.example' + path);
const feedKey = 'instagram/current.json';
const allowed = {
  'Content-Type': 'application/json',
  'oai-authenticated-user-id': 'authorized-account',
  'oai-authenticated-user-email': 'redazione@example.test',
};
const poster = await readFile('public/assets/visita.webp');

function bucket() {
  const records = new Map();
  let revision = 0;
  return {
    records,
    async get(key) { return records.get(key) ?? null; },
    async put(key, value, { onlyIf, httpMetadata } = {}) {
      const existing = records.get(key);
      if (onlyIf?.has('If-Match') && onlyIf.get('If-Match') !== existing?.httpEtag) return null;
      if (existing && onlyIf?.get('If-None-Match') === '*') return null;
      const record = {
        httpEtag: '"' + ++revision + '"',
        httpMetadata,
        body: value,
        json: async () => JSON.parse(value),
      };
      records.set(key, record);
      return record;
    },
    async head(key) { return records.get(key) ?? null; },
  };
}

function item(n, type = 'IMAGE') {
  return {
    id: String(n),
    media_type: type,
    media_url: 'https://scontent.cdninstagram.com/image-' + n,
    thumbnail_url: 'https://scontent.cdninstagram.com/thumb-' + n,
    permalink: 'https://www.instagram.com/' + (type === 'VIDEO' ? 'reel' : 'p') + '/post' + n + '/?utm_source=example',
    caption: 'Paziente ' + n + '\nSeconda riga',
    timestamp: '2026-11-' + String(n).padStart(2, '0') + 'T09:00:00Z',
  };
}

async function tool(env, name, args = {}, headers = allowed) {
  const response = await worker.fetch(new Request('https://ceveca.example/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), env);
  const { result, error } = await response.json();
  assert.equal(error, undefined);
  return result.isError ? result.content[0].text : JSON.parse(result.content[0].text);
}

test('CEVECA displays its fallback and connects its public resources', async () => {
  const response = await worker.fetch(request('/'), {});
  assert.equal(response.status, 200);
  assert.equal((await response.text()).match(/data-post=/g).length, 6);
  assert.equal((await worker.fetch(request('/foto.js'), {})).status, 200);
  assert.deepEqual(await (await worker.fetch(request('/api/instagram'), {})).json(), { posts: [], syncedAt: null });
});

test('preview, publish, repeat, reject changed previews and preserve the previous carousel on a media failure', async context => {
  const env = {
    BUCKET: bucket(),
    CEVECA_EDITOR_EMAILS: 'redazione@example.test',
    INSTAGRAM_ACCESS_TOKEN: 'test-token',
    INSTAGRAM_USER_ID: '123',
    INSTAGRAM_API_VERSION: 'v27.0',
  };
  let posts = [1, 4, 2, 3, 6, 5, 7].map(n => item(n, n === 7 ? 'VIDEO' : n === 5 ? 'CAROUSEL_ALBUM' : 'IMAGE'));
  let unavailable = false;
  const downloaded = [];
  context.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    if (url.hostname === 'graph.instagram.com') {
      assert.equal(url.pathname, '/v27.0/123/media');
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      return Response.json({ data: structuredClone(posts) });
    }
    assert.equal(url.hostname, 'scontent.cdninstagram.com');
    assert.equal(options.headers, undefined);
    downloaded.push(url.pathname);
    return unavailable ? new Response(null, { status: 404 }) : new Response(poster, {
      headers: { 'Content-Type': 'image/webp' },
    });
  });

  const denied = await tool(env, 'leggi_stato_instagram', {}, { 'Content-Type': 'application/json' });
  assert.match(denied, /non è autorizzato/);
  const preview = await tool(env, 'anteprima_instagram');
  assert.equal(preview.changed, true);
  assert.deepEqual(preview.posts.map(row => row.id), ['7', '6', '5', '4', '3', '2']);
  assert.equal(downloaded.length, 0);
  assert.equal(env.BUCKET.records.size, 0);

  const accepted = await tool(env, 'sincronizza_instagram', { codice_anteprima: preview.codice_anteprima });
  assert.equal(accepted.changed, true);
  assert.equal(downloaded[0], '/thumb-7');
  assert.equal(accepted.posts[0].url, 'https://www.instagram.com/reel/post7/');
  const publicFeed = await (await worker.fetch(request('/api/instagram'), env)).json();
  assert.deepEqual(publicFeed.posts, accepted.posts);
  const media = await worker.fetch(request(publicFeed.posts[0].image), env);
  assert.equal(media.headers.get('Content-Type'), 'image/webp');
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), poster);

  const again = await tool(env, 'sincronizza_instagram', { codice_anteprima: preview.codice_anteprima });
  assert.equal(again.changed, false);
  assert.equal(downloaded.length, 6);

  const oldSnapshot = env.BUCKET.records.get(feedKey);
  posts.push(item(8));
  const stale = await tool(env, 'sincronizza_instagram', { codice_anteprima: preview.codice_anteprima });
  assert.match(stale, /non è più attuale/);
  const updated = await tool(env, 'anteprima_instagram');
  unavailable = true;
  const failed = await tool(env, 'sincronizza_instagram', { codice_anteprima: updated.codice_anteprima });
  assert.match(failed, /fotografia/);
  assert.equal(env.BUCKET.records.get(feedKey), oldSnapshot);
});
