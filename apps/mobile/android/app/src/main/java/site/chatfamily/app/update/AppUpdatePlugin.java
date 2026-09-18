package site.chatfamily.app.update;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

@CapacitorPlugin(name="AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private volatile boolean cancelled, destroyed;
    private boolean english, waitingPermission;
    private AlertDialog dialog;
    private JSONObject pending;
    private String text(String ru,String en) { return english ? en : ru; }
    private boolean foreground() {
        return !destroyed && getActivity()!=null && !getActivity().isFinishing() &&
            getActivity().getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED);
    }
    private void ui(Runnable action) { if(!destroyed) getActivity().runOnUiThread(()->{if(!destroyed)action.run();}); }
    private boolean trusted(PluginCall call) {
        if(!UpdatePolicy.trustedPage(getBridge().getWebView().getUrl())) {call.reject("Untrusted origin");return false;}
        return true;
    }
    private PackageInfo installed() throws Exception { return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(),signatureFlags()); }
    private static int signatureFlags() { return Build.VERSION.SDK_INT>=28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES; }
    private static long version(PackageInfo p) { return Build.VERSION.SDK_INT>=28 ? p.getLongVersionCode() : p.versionCode; }
    @PluginMethod public void status(PluginCall call) {
        getActivity().runOnUiThread(()->statusOnUI(call));
    }
    private void statusOnUI(PluginCall call) {
        if(!trusted(call))return;
        try { PackageInfo p=installed(); JSObject result=new JSObject();result.put("versionName",p.versionName);result.put("versionCode",version(p));call.resolve(result); }
        catch(Exception ignored){call.reject("Version unavailable");}
    }
    @PluginMethod public void check(PluginCall call) {
        getActivity().runOnUiThread(()->checkOnUI(call));
    }
    private void checkOnUI(PluginCall call) {
        if(!trusted(call))return;
        english="en".equals(call.getString("locale","ru"));
        boolean manual=Boolean.TRUE.equals(call.getBoolean("manual",false));
        var prefs=getContext().getSharedPreferences("app-updates",Context.MODE_PRIVATE);
        long now=System.currentTimeMillis();
        if(!manual && (now-prefs.getLong("success",0)<86400000L || now-prefs.getLong("attempt",0)<3600000L)) {call.resolve();return;}
        if(waitingPermission || !busy.compareAndSet(false,true)){call.resolve();return;}
        prefs.edit().putLong("attempt",now).apply();
        call.resolve();
        worker.execute(()->{
            try {
                // A stale installer cache is expendable and separate from shares/attachments.
                File dir=directory(); File apk=new File(dir,"update.apk");
                delete(new File(dir,"update.part"));
                if(apk.exists() && now-apk.lastModified()>7*86400000L) delete(apk);
                JSONObject release=fetchManifest();
                prefs.edit().putLong("success",System.currentTimeMillis()).apply();
                PackageInfo current=installed();
                if(release==null || release.getLong("versionCode")<=version(current)) {
                    delete(apk);pending=null;
                    ui(()->{busy.set(false);if(manual)message(text("Установлена версия ","Installed version ")+current.versionName+text(". Опубликованных обновлений нет.",". No published updates."));});return;
                }
                if(release.getInt("minSdk")>Build.VERSION.SDK_INT) {
                    ui(()->{busy.set(false);if(manual)message(text("Обновление требует более новой версии Android.","The update requires a newer Android version."));});return;
                }
                ui(()->offer(release));
            } catch(Exception ignored) {
                ui(()->{busy.set(false);if(manual)message(text("Не удалось проверить обновления. Проверьте соединение и повторите.","Could not check for updates. Check your connection and retry."));});
            }
        });
    }
    private JSONObject fetchManifest() throws Exception {
        HttpURLConnection connection=connect("/downloads/android/latest.json");
        try {
            int status=connection.getResponseCode();if(status==404)return null;
            if(status!=200)throw new IOException("HTTP");
            ByteArrayOutputStream body=new ByteArrayOutputStream();
            long deadline=android.os.SystemClock.elapsedRealtime()+30000;
            try(InputStream input=connection.getInputStream()) {
                byte[] buffer=new byte[4096];int n;
                while((n=input.read(buffer))!=-1){if(body.size()+n>32768 || android.os.SystemClock.elapsedRealtime()>deadline)throw new IOException("Manifest limit");body.write(buffer,0,n);}
            }
            JSONObject r=new JSONObject(body.toString(StandardCharsets.UTF_8.name()));
            if(!"site.chatfamily.app".equals(r.getString("packageName")) ||
                !UpdatePolicy.validMetadata(r.getLong("versionCode"),r.getLong("size"),r.getString("sha256"),r.getString("path"),r.getInt("minSdk")) ||
                r.getString("versionName").length()>80 || r.optString("notes").length()>4000) throw new IOException("Invalid manifest");
            return r;
        } finally {connection.disconnect();}
    }
    private HttpURLConnection connect(String path) throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(UpdatePolicy.ORIGIN+path).openConnection();
        c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(20000);
        c.setUseCaches(false);c.setRequestProperty("Accept-Encoding","identity");return c;
    }
    private void offer(JSONObject release) {
        if(!foreground()){busy.set(false);return;}
        String title=text("Доступно обновление ","Update available ")+release.optString("versionName");
        String body=release.optString("notes")+"\n\n"+String.format(java.util.Locale.ROOT,"%.1f MiB",release.optLong("size")/1048576.0);
        if(release.optBoolean("debug")) body+=text("\nТестовая (debug) сборка.","\nTest (debug) build.");
        dialog=new AlertDialog.Builder(getActivity()).setTitle(title).setMessage(body)
            .setNegativeButton(text("Позже","Later"),(d,w)->busy.set(false))
            .setPositiveButton(text("Обновить","Update"),(d,w)->download(release)).create();
        dialog.setOnCancelListener(d->busy.set(false));dialog.show();
    }
    private File directory() throws IOException {
        File dir=new File(getContext().getCacheDir(),"app-updates");
        if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("Cache unavailable");return dir;
    }
    private void download(JSONObject release) {
        cancelled=false;
        dialog=new AlertDialog.Builder(getActivity()).setTitle(text("Загрузка обновления","Downloading update"))
            .setMessage(text("Дождитесь загрузки и проверки APK…","Please wait while the APK is downloaded and verified…"))
            .setNegativeButton(text("Отмена","Cancel"),(d,w)->cancelled=true).setCancelable(false).create();dialog.show();
        worker.execute(()->{
            try {
                File dir=directory(),part=new File(dir,"update.part"),apk=new File(dir,"update.apk");
                delete(part);delete(apk);
                if(dir.getUsableSpace()<release.getLong("size")+16*1024*1024)throw new IOException("Space");
                HttpURLConnection connection=connect(release.getString("path"));
                long deadline=android.os.SystemClock.elapsedRealtime()+300000;
                try {
                    if(connection.getResponseCode()!=200)throw new IOException("HTTP");
                    try(InputStream input=connection.getInputStream();FileOutputStream output=new FileOutputStream(part)) {
                        byte[] buffer=new byte[65536];int n;long count=0;
                        while((n=input.read(buffer))!=-1) {
                            if(cancelled||Thread.currentThread().isInterrupted()||android.os.SystemClock.elapsedRealtime()>deadline)throw new IOException("Cancelled");
                            count+=n;if(count>release.getLong("size"))throw new IOException("Size");output.write(buffer,0,n);
                        }
                        output.getFD().sync();
                    }
                } finally {connection.disconnect();}
                verify(part,release);
                if(cancelled)throw new IOException("Cancelled");
                if(!part.renameTo(apk))throw new IOException("Rename");
                pending=release;
                ui(()->{if(dialog!=null)dialog.dismiss();busy.set(false);if(foreground())installOrPermission();});
            } catch(Exception ignored) {
                try{delete(new File(directory(),"update.part"));delete(new File(directory(),"update.apk"));}catch(Exception unused){}
                ui(()->{if(dialog!=null)dialog.dismiss();busy.set(false);if(!cancelled)message(text("Обновление не установлено: не удалось скачать или проверить APK. Проверьте сеть, свободное место и совместимость подписи. Можно повторить проверку в меню пользователя.","Update not installed: APK download or verification failed. Check connection, free space and signing compatibility. Retry from the user menu."));});
            }
        });
    }
    private static String hex(byte[] bytes) {
        StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return s.toString();
    }
    private static Set<String> signers(PackageInfo p) throws Exception {
        Signature[] values=Build.VERSION.SDK_INT>=28 && p.signingInfo!=null ? p.signingInfo.getApkContentsSigners() : p.signatures;
        Set<String> result=new HashSet<>();if(values!=null)for(Signature s:values)result.add(hex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray())));return result;
    }
    private void verify(File file,JSONObject release) throws Exception {
        if(file.length()!=release.getLong("size"))throw new IOException("Size");
        MessageDigest hash=MessageDigest.getInstance("SHA-256");
        try(InputStream input=new FileInputStream(file)){byte[] buffer=new byte[65536];int n;while((n=input.read(buffer))!=-1)hash.update(buffer,0,n);}
        if(!hex(hash.digest()).equals(release.getString("sha256")))throw new IOException("Hash");
        PackageInfo candidate=getContext().getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(),signatureFlags()),current=installed();
        if(candidate==null || !current.packageName.equals(candidate.packageName) || version(candidate)!=release.getLong("versionCode") ||
            version(candidate)<=version(current) || !UpdatePolicy.sameSigners(signers(current),signers(candidate)) ||
            !release.getString("versionName").equals(candidate.versionName) || candidate.applicationInfo==null ||
            candidate.applicationInfo.minSdkVersion!=release.getInt("minSdk") || candidate.applicationInfo.minSdkVersion>Build.VERSION.SDK_INT) throw new IOException("Package identity");
    }
    private void installOrPermission() {
        if(Build.VERSION.SDK_INT>=26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            dialog=new AlertDialog.Builder(getActivity()).setTitle(text("Разрешение на обновление","Update permission"))
                .setMessage(text("Разрешите установку приложений из ChatFamily в системных настройках. Установку APK затем подтвердите отдельно.","Allow ChatFamily to install apps in system settings. You will confirm APK installation separately."))
                .setNegativeButton(text("Позже","Later"),null).setPositiveButton(text("Настройки","Settings"),(d,w)->{
                    try{waitingPermission=true;getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getContext().getPackageName())));}
                    catch(Exception ignored){waitingPermission=false;message(text("Откройте разрешение установки в настройках Android.","Open installation permission in Android settings."));}
                }).show();return;
        }
        if(pending==null || !busy.compareAndSet(false,true))return;
        worker.execute(()->{
            try {
                File apk=new File(directory(),"update.apk");verify(apk,pending);
                ui(()->{
                    busy.set(false);if(!foreground())return;
                    try {
                        Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",apk);
                        Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        getActivity().startActivity(intent);
                    } catch(Exception ignored){message(text("Не удалось открыть установщик Android.","Could not open Android installer."));}
                });
            } catch(Exception ignored){ui(()->{busy.set(false);message(text("APK больше недоступен. Повторите проверку обновлений.","APK no longer available. Check for updates again."));});}
        });
    }
    @Override protected void handleOnResume() {
        if(waitingPermission){waitingPermission=false;getBridge().getWebView().postDelayed(()->{if(foreground() && Build.VERSION.SDK_INT>=26 && getContext().getPackageManager().canRequestPackageInstalls())installOrPermission();},400);}
    }
    private void message(String value) {if(foreground())new AlertDialog.Builder(getActivity()).setTitle("ChatFamily").setMessage(value).setPositiveButton("OK",null).show();}
    private static void delete(File file) throws IOException {if(file.exists()&&!file.delete())throw new IOException("Cache cleanup");}
    @Override protected void handleOnDestroy() {destroyed=true;cancelled=true;if(dialog!=null)dialog.dismiss();worker.shutdownNow();}
}
