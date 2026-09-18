import {readFile,writeFile,mkdir,copyFile,rename,stat,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function metadata(badging,apk,notes='') {
 const match=badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
 const minSdk=Number(badging.match(/^sdkVersion:'(\d+)'/m)?.[1]);
 if(!match || match[1]!=='site.chatfamily.app' || !Number.isSafeInteger(Number(match[2])) || Number(match[2])<1 ||
    !Number.isInteger(minSdk) || minSdk<24 || match[3].length>80 || notes.length>4000 || apk.length<1 || apk.length>128*1024*1024)throw new Error('Invalid APK metadata or size');
 return {packageName:match[1],versionCode:Number(match[2]),versionName:match[3],minSdk,
  size:apk.length,sha256:createHash('sha256').update(apk).digest('hex'),path:`/downloads/android/chatfamily-${match[2]}.apk`,
  debug:/^application-debuggable\s*$/m.test(badging),notes};
}

async function main() {
 const [apkArgument,toolsArgument,notesArgument]=process.argv.slice(2);
 if(!apkArgument||!toolsArgument)throw new Error('Usage: node apps/mobile/scripts/prepare-update.mjs <signed.apk> <SDK/build-tools/version> [notes.txt]');
 const root=fileURLToPath(new URL('../../../',import.meta.url)),apkPath=resolve(apkArgument),buildTools=resolve(toolsArgument);
 // verify() is essential: badging alone does not validate an APK signature.
 execFileSync('java',['-jar',join(buildTools,'lib','apksigner.jar'),'verify',apkPath],{stdio:'pipe'});
 const badging=execFileSync(join(buildTools,process.platform==='win32'?'aapt.exe':'aapt'),['dump','badging',apkPath],{encoding:'utf8'});
 const bytes=await readFile(apkPath),notes=notesArgument?(await readFile(resolve(notesArgument),'utf8')).trim():'';
 const info=metadata(badging,bytes,notes),directory=join(root,'downloads','android'),name=`chatfamily-${info.versionCode}.apk`;
 execFileSync('git',['check-ignore','--quiet',`downloads/android/${name}`],{cwd:root,stdio:'pipe'});
 execFileSync('git',['check-ignore','--quiet','downloads/android/latest.json'],{cwd:root,stdio:'pipe'});
 await mkdir(directory,{recursive:true});
 const target=join(directory,name),manifest=join(directory,'latest.json');
 let previous;
 try{previous=JSON.parse(await readFile(manifest,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(previous && previous.versionCode>info.versionCode)throw new Error('Refusing to downgrade the published version');
 try {
  await access(target);
  if((await stat(target)).size!==info.size || createHash('sha256').update(await readFile(target)).digest('hex')!==info.sha256)throw new Error('Version code already exists with different APK; increment versionCode');
 }catch(e){if(e.code!=='ENOENT')throw e;await copyFile(apkPath,target,constants.COPYFILE_EXCL);}
 // Publish manifest last; never announce an incomplete binary.
 const temporary=join(directory,`latest-${process.pid}.tmp`);
 await writeFile(temporary,JSON.stringify(info,null,2)+'\n',{flag:'wx'});await rename(temporary,manifest);
 console.log(`Prepared Android ${info.versionName} (code ${info.versionCode}, ${info.debug?'debug':'release'}). Local downloads/android only; nothing uploaded.`);
 if(info.debug)console.log('Debug build is allowed. Preserve its signing key for future updates.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Update preparation failed. Check arguments, APK signature, version code, existing files and Git exclusions. No secrets or tool output printed.');process.exitCode=1;});
