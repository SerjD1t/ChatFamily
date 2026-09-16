// Import downloaded Firebase configuration without printing credentials.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../../', import.meta.url));
try {
  execFileSync('git', ['check-ignore', '--quiet', 'settings.local.json'], {cwd:root,stdio:'ignore'});
  try { execFileSync('git', ['ls-files','--error-unmatch','settings.local.json'], {cwd:root,stdio:'ignore'}); throw new Error('tracked'); }
  catch (e) { if (e.message === 'tracked') throw e; }
  const dir = process.argv[2];
  if (!dir) throw new Error('directory required');
  const configs = fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8')));
  const accounts = configs.filter(c=>c.type==='service_account');
  const clients = configs.filter(c=>c.project_info && c.client);
  if (accounts.length!==1 || clients.length!==1) throw new Error('ambiguous configuration');
  const serviceAccount=accounts[0], google=clients[0];
  const client=google.client.find(c=>c.client_info?.android_client_info?.package_name==='site.chatfamily.app');
  if (!client || serviceAccount.project_id!==google.project_info.project_id || !serviceAccount.private_key || !client.api_key?.[0]?.current_key) throw new Error('mismatched configuration');
  const target=path.join(root,'settings.local.json');
  const settings=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')):{};
  settings.firebase={...settings.firebase,android:{applicationId:client.client_info.mobilesdk_app_id,apiKey:client.api_key[0].current_key,projectId:google.project_info.project_id,senderId:google.project_info.project_number},serviceAccount};
  fs.writeFileSync(target,JSON.stringify(settings,null,2)+'\n',{mode:0o600});
  console.log('Firebase configuration validated and imported into gitignored local settings.');
} catch (_) { console.error('Firebase import failed. Check source files, package, project match and Git exclusions. No credentials printed.'); process.exitCode=1; }
