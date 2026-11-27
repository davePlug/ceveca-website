import { cp, rm } from 'node:fs/promises';

const site = 'dist/pages';
await rm(site, { recursive: true, force: true });
await cp('public', site, { recursive: true });
await cp('feed', site + '/feed', { recursive: true });
