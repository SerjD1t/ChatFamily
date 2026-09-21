// Deterministic exports of the approved Dialog / Indigo vector mark.
// Usage: NODE_PATH=<directory containing sharp> node deploy/build-branding.mjs
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),sharp=require('sharp');
const root=new URL('../',import.meta.url);
const mark=await readFile(new URL('assets/branding/dialog-mark.svg',root),'utf8');
const paths=[...mark.matchAll(/<path d="([^"]+)"/g)].map(match=>match[1]);
if(paths.length!==2)throw new Error('Expected the two approved mark paths');
const color='#4A4B88';
const colored=mark.replace('<g fill=',`<rect width="1000" height="1000" fill="${color}"/><g fill=`);
for(const size of [192,512])await sharp(Buffer.from(colored)).resize(size,size).png().toFile(new URL(`web/icon-indigo-${size}.png`,root).pathname.replace(/^\/(\w:)/,'$1'));
await sharp(Buffer.from(mark)).resize(96,96).png().toFile(new URL('web/badge-dialog.png',root).pathname.replace(/^\/(\w:)/,'$1'));
await writeFile(new URL('web/icon-dialog.svg',root),colored);
const vector=(notification=false)=>`<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="${notification?24:108}dp" android:height="${notification?24:108}dp" android:viewportWidth="1000" android:viewportHeight="1000">\n${notification?'':`  <path android:fillColor="${color}" android:pathData="M0,0H1000V1000H0Z"/>\n`}  <group android:translateX="-127" android:translateY="-51">\n${paths.map(d=>`    <path android:fillColor="#FFFFFF" android:pathData="${d}"/>`).join('\n')}\n  </group>\n</vector>\n`;
for(const [name,notification] of [['ic_chatfamily',false],['ic_stat_chat',true]])await writeFile(new URL(`apps/mobile/android/app/src/main/res/drawable/${name}.xml`,root),vector(notification));
console.log('Web icons and Android vectors generated from the approved mark.');
