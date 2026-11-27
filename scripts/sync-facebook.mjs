import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const maxPhotoBytes = 8 * 1024 * 1024;
const fields = 'id,message,created_time,permalink_url,full_picture,is_hidden,privacy,targeting';

function httpsUrl(value, hosts) {
  if (typeof value !== 'string' || !URL.canParse(value)) return null;
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.test(url.hostname) ? url : null;
}

async function recentPhotos(token, version, fetchImpl) {
  // With a Page access token, /me identifies the Page that issued it.
  const url = new URL('https://graph.facebook.com/' + version + '/me/published_posts');
  url.search = new URLSearchParams({ fields, limit: '50' });
  const posts = new Map();
  const cursors = new Set();
  for (let page = 0; page < 10; page++) {
    const response = await fetchImpl(url, {
      headers: { Authorization: 'Bearer ' + token },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('Facebook Graph API returned HTTP ' + response.status + '. Check the Page token and its permissions.');
    const { data, paging } = await response.json();
    if (!Array.isArray(data)) throw new Error('Facebook returned an invalid post list.');
    for (const entry of data) {
      const picture = httpsUrl(entry?.full_picture, /(?:^|\.)fbcdn\.net$/);
      const link = httpsUrl(entry?.permalink_url, /^(?:www\.|m\.)?facebook\.com$/);
      const date = Date.parse(entry?.created_time);
      if (!entry?.id || !picture || !link || !Number.isFinite(date) || entry.is_hidden ||
          (entry.privacy?.value && entry.privacy.value !== 'EVERYONE') || Object.keys(entry.targeting ?? {}).length) continue;
      const caption = (entry.message || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || 'Un post di CEVECA';
      posts.set(entry.id, { url: link.href, picture, date, caption: Array.from(caption).slice(0, 100).join('') });
    }
    const after = paging?.cursors?.after;
    if (posts.size >= 6 || !paging?.next || !after || cursors.has(after)) break;
    cursors.add(after);
    url.searchParams.set('after', after);
  }
  if (!posts.size) throw new Error('Facebook returned no eligible public photo posts. The existing carousel is retained.');
  return [...posts.values()].sort((a, b) => b.date - a.date).slice(0, 6);
}

async function savePhoto(picture, directory, fetchImpl) {
  const response = await fetchImpl(picture, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxPhotoBytes) {
    throw new Error('Could not download a Facebook photo within the size limit.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxPhotoBytes) throw new Error('Facebook photo exceeds the size limit.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const formats = {
    'image/jpeg': ['jpg', bytes.subarray(0, 3).toString('hex') === 'ffd8ff'],
    'image/png': ['png', bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'],
    'image/webp': ['webp', bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'],
  };
  const format = formats[type];
  if (!format?.[1]) throw new Error('Facebook returned an unsupported or invalid photo.');
  const filename = createHash('sha256').update(bytes).digest('hex') + '.' + format[0];
  await writeFile(join(directory, filename), bytes);
  return 'feed/' + filename;
}

export async function syncFacebook(directory, env = process.env, fetchImpl = fetch) {
  const token = env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error('Set the FACEBOOK_PAGE_ACCESS_TOKEN repository secret for the CEVECA Facebook Page.');
  const version = env.FACEBOOK_GRAPH_VERSION || 'v27.0';
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('Invalid FACEBOOK_GRAPH_VERSION.');
  const photos = await recentPhotos(token, version, fetchImpl);
  // Only a new staging directory is accepted. The workflow promotes complete snapshots.
  await mkdir(directory);
  const posts = [];
  for (const { caption, url, picture } of photos) {
    posts.push({ caption, url, image: await savePhoto(picture, directory, fetchImpl) });
  }
  await writeFile(join(directory, 'posts.json'), JSON.stringify({ posts }, null, 2) + '\n');
  console.log('Prepared ' + posts.length + ' Facebook posts for the carousel.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw new Error('Pass a new staging directory as the first argument.');
    await syncFacebook(process.argv[2]);
  } catch (error) {
    // Omit provider response bodies, request details and signed media URLs from Actions logs.
    console.error(error.message);
    process.exitCode = 1;
  }
}
