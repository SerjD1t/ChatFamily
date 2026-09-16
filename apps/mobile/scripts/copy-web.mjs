import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
// The script lives one level deeper than the mobile package.
const target = fileURLToPath(new URL('../www/', import.meta.url));
// Only this generated directory is replaced; no source or private queue data.
await rm(target, {recursive:true, force:true});
await mkdir(target, { recursive: true });
await cp(new URL('../shell/', import.meta.url), target, {recursive:true});
// Serve the pinned official runtime to remote pages, including older installed shells.
await cp(new URL('../node_modules/@capacitor/core/dist/index.js', import.meta.url), new URL('../../../web/mobile/capacitor-core.js', import.meta.url));
