import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { syncFacebook } from '../scripts/sync-facebook.mjs';

const photo = await readFile('public/assets/visita.webp');
const env = { FACEBOOK_PAGE_ACCESS_TOKEN: 'test-page-token' };
const post = n => ({
  id: '42_' + n,
  message: 'In clinica ' + n + '\nSeconda riga',
  created_time: '2026-11-' + String(n).padStart(2, '0') + 'T12:00:00+0000',
  full_picture: 'https://scontent.fbcdn.net/image-' + n + '?signature=temporary',
  permalink_url: 'https://www.facebook.com/centroveterinario.catanzaro/posts/' + n,
  privacy: { value: 'EVERYONE' },
});

test('Facebook sync paginates, filters, and produces six stable local photos under the Pages project URL', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ceveca-fb-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fetchImpl = async (url, options) => {
    if (url.hostname === 'graph.facebook.com') {
      assert.equal(url.pathname, '/v27.0/me/published_posts');
      assert.equal(options.headers.Authorization, 'Bearer test-page-token');
      assert.equal(url.searchParams.has('access_token'), false);
      if (url.searchParams.get('after') === 'page2') return Response.json({ data: [6, 3, 2, 1].map(post) });
      return Response.json({
        data: [post(7), post(6), post(5), post(4),
          { ...post(12), is_hidden: true }, { ...post(11), privacy: { value: 'CUSTOM' } },
          { ...post(10), targeting: { countries: ['IT'] } }, { ...post(9), full_picture: null },
          { ...post(8), full_picture: 'https://example.test/not-a-facebook-photo' }],
        paging: { next: 'https://example.test/unused', cursors: { after: 'page2' } },
      });
    }
    assert.equal(url.hostname, 'scontent.fbcdn.net');
    assert.equal(options.headers, undefined);
    return new Response(photo, { headers: { 'Content-Type': 'image/webp' } });
  };
  for (const folder of ['first', 'repeat']) {
    const stage = join(root, folder);
    await syncFacebook(stage, env, fetchImpl);
    const { posts } = JSON.parse(await readFile(join(stage, 'posts.json')));
    assert.deepEqual(posts.map(p => p.caption), [7, 6, 5, 4, 3, 2].map(n => 'In clinica ' + n));
    for (const entry of posts) {
      assert.match(entry.image, /^feed\/[a-f0-9]{64}\.webp$/);
      const base = 'https://example.github.io/ceveca-website/';
      assert.equal(new URL(entry.image, base).pathname, '/ceveca-website/' + entry.image);
      assert.deepEqual(await readFile(join(stage, entry.image.slice('feed/'.length))), photo);
    }
  }
  assert.deepEqual(await readFile(join(root, 'first/posts.json')), await readFile(join(root, 'repeat/posts.json')));
});

test('a missing token, denied Graph request or broken photo cannot produce a publishable snapshot', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ceveca-fb-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stage = join(root, 'staging');
  await assert.rejects(syncFacebook(stage, {}), /FACEBOOK_PAGE_ACCESS_TOKEN/);
  await assert.rejects(syncFacebook(stage, env, async () => new Response(null, { status: 403 })), /HTTP 403/);
  await assert.rejects(syncFacebook(stage, env, async url => {
    if (url.hostname === 'graph.facebook.com') return Response.json({ data: [post(1)] });
    return new Response('broken', { headers: { 'Content-Type': 'image/webp' } });
  }), /invalid photo/);
  await assert.rejects(stat(join(stage, 'posts.json')), { code: 'ENOENT' });
});
