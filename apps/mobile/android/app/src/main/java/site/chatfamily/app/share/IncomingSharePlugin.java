package site.chatfamily.app.share;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.*;
import android.content.Intent;
import android.webkit.CookieManager;
import androidx.core.content.FileProvider;
import java.io.*;
import java.net.*;
import java.util.concurrent.Executors;

@CapacitorPlugin(name="IncomingShare")
public class IncomingSharePlugin extends Plugin {
    private static final java.util.concurrent.ExecutorService DOWNLOADS=Executors.newSingleThreadExecutor();
    private android.content.SharedPreferences storagePrefs() {return getContext().getSharedPreferences("device-storage",android.content.Context.MODE_PRIVATE);}
    private long cacheLimit(){return storagePrefs().getInt("limitMiB",200)*AttachmentCache.MIB;}
    private int cacheDays(){return storagePrefs().getInt("days",7);}
    @Override public void load() { DOWNLOADS.execute(()->{try{new AttachmentCache(getContext().getCacheDir()).trim(cacheLimit(),cacheDays(),0,false,System.currentTimeMillis());}catch(Exception ignored){}}); }
    @Override protected void handleOnResume(){load();}
    private JSObject storageInfo() throws Exception {
        JSObject out=new JSObject();out.put("cacheBytes",new AttachmentCache(getContext().getCacheDir()).bytes());
        out.put("pendingBytes",ShareStore.pendingBytes(getContext()));out.put("freeBytes",getContext().getFilesDir().getUsableSpace());
        out.put("limitMiB",storagePrefs().getInt("limitMiB",200));out.put("days",cacheDays());return out;
    }
    @PluginMethod public void storageStatus(PluginCall call) {DOWNLOADS.execute(()->{try{call.resolve(storageInfo());}catch(Exception e){call.reject("Не удалось прочитать хранилище / Cannot read storage");}});}
    @PluginMethod public void storageSettings(PluginCall call) {
        Integer limit=call.getInt("limitMiB"),days=call.getInt("days");
        if(limit==null||limit<100||limit>1000||days==null||days<1||days>30){call.reject("Допустимо: 100–1000 МиБ, 1–30 дней / Invalid limits");return;}
        DOWNLOADS.execute(()->{try{
            storagePrefs().edit().putInt("limitMiB",limit).putInt("days",days).apply();
            new AttachmentCache(getContext().getCacheDir()).trim(cacheLimit(),cacheDays(),0,false,System.currentTimeMillis());call.resolve(storageInfo());
        }catch(Exception e){call.reject("Настройки сохранены, но очистка не завершена / Settings saved; cleanup incomplete");}});
    }
    @PluginMethod public void clearStorageCache(PluginCall call) {
        if(!Boolean.TRUE.equals(call.getBoolean("confirm",false))){call.reject("Требуется подтверждение / Confirmation required");return;}
        DOWNLOADS.execute(()->{try{
            new AttachmentCache(getContext().getCacheDir()).trim(cacheLimit(),cacheDays(),0,true,System.currentTimeMillis());
            JSObject info=storageInfo();getActivity().runOnUiThread(()->{getBridge().getWebView().clearCache(true);call.resolve(info);});
        }catch(Exception e){call.reject("Не удалось очистить кэш / Cache cleanup failed");}});
    }
    @PluginMethod public void openAttachment(PluginCall call) {
        String id=call.getString("id"), name=call.getString("name","attachment");
        if(id==null || !id.matches("[a-zA-Z0-9_-]{1,100}")) { call.reject("Некорректное вложение"); return; }
        DOWNLOADS.execute(()->{
            HttpURLConnection conn=null;
            File partial=null;
            try {
                AttachmentCache cache=new AttachmentCache(getContext().getCacheDir());
                String cookies=CookieManager.getInstance().getCookie(ShareWorker.ORIGIN);
                if(cookies==null||cookies.isBlank())throw new IOException("Login required");
                cache.trim(cacheLimit(),cacheDays(),0,false,System.currentTimeMillis());
                File targetDir=cache.folder(AttachmentCache.key(cookies,id));
                File existing=cache.cached(targetDir);
                conn=(HttpURLConnection)new URL(ShareWorker.ORIGIN+"/api/v1/attachments/"+id).openConnection();
                conn.setInstanceFollowRedirects(false); conn.setConnectTimeout(20000); conn.setReadTimeout(60000);
                conn.setRequestProperty("Cookie",cookies);
                if(existing!=null)conn.setRequestMethod("HEAD"); // Recheck authorization even for cached copies.
                if(conn.getResponseCode()!=200){if(existing!=null)cache.remove(targetDir);throw new IOException("Download failed");}
                if(existing!=null&&conn.getContentLengthLong()>0&&existing.length()!=conn.getContentLengthLong()){cache.remove(targetDir);throw new IOException("Cached copy changed; retry");}
                File file=existing;
                if(file==null){
                long expected=conn.getContentLengthLong();if(expected>ShareStore.MAX_TOTAL)throw new IOException("File too large");
                long reservation=expected>0?expected:ShareStore.MAX_TOTAL;
                cache.trim(cacheLimit(),cacheDays(),reservation,false,System.currentTimeMillis());
                AttachmentCache.checkSpace(getContext().getCacheDir(),reservation);
                if(!targetDir.mkdirs()&&!targetDir.isDirectory())throw new IOException("Cache unavailable");
                String filename=name.replaceAll("[\\\\/\\r\\n\\x00]","_");if(filename.isBlank()||filename.equals(".")||filename.equals("..")||filename.equals(".part")||filename.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>200)filename="attachment";
                file=new File(targetDir,filename);
                if(!file.getCanonicalPath().startsWith(targetDir.getCanonicalPath()+File.separator)) throw new IOException("Invalid filename");
                partial=new File(targetDir,".part");
                try(InputStream in=conn.getInputStream(); OutputStream out=new FileOutputStream(partial)) {
                    byte[] buf=new byte[65536]; long size=0; int n;
                    while((n=in.read(buf))!=-1) { size+=n; if(size>reservation) throw new IOException("File too large"); AttachmentCache.checkSpace(getContext().getCacheDir(),n); out.write(buf,0,n); }
                    if(size==0||(expected>=0&&size!=expected))throw new IOException("Incomplete download");
                }
                if(!partial.renameTo(file))throw new IOException("Cannot save download");partial=null;
                }
                if(!cookies.equals(CookieManager.getInstance().getCookie(ShareWorker.ORIGIN)))throw new IOException("Account changed");
                cache.touch(file);
                String mime=conn.getContentType();
                Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file),mime==null?"application/octet-stream":mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().runOnUiThread(()->{
                    if(!cookies.equals(CookieManager.getInstance().getCookie(ShareWorker.ORIGIN))){call.reject("Аккаунт изменился / Account changed");return;}
                    try { getActivity().startActivity(Intent.createChooser(intent,"Открыть вложение")); call.resolve(); }
                    catch(Exception e) { call.reject("Нет приложения для открытия файла"); }
                });
            } catch(Exception e) { call.reject("Не удалось открыть файл. Проверьте доступ, свободное место и лимит кэша / Check access, free space and cache limit"); }
            finally { if(partial!=null)partial.delete();if(conn!=null) conn.disconnect(); }
        });
    }
    @PluginMethod public void list(PluginCall call) {
        try { JSObject out=new JSObject(); out.put("jobs",ShareStore.list(getContext())); call.resolve(out); }
        catch(Exception e) { call.reject("Не удалось прочитать очередь"); }
    }
    @PluginMethod public void submit(PluginCall call) {
        try {
            String id=call.getString("id"), user=call.getString("userId"), conversation=call.getString("conversationId"), body=call.getString("body","");
            if(user==null || user.isBlank() || conversation==null || conversation.isBlank() || body.codePointCount(0,body.length())>4000) { call.reject("Выберите чат и проверьте подпись"); return; }
            synchronized(ShareStore.class) {
                JSONObject j=ShareStore.read(getContext(),id);
                if("draft".equals(j.getString("state"))) {
                    j.put("userId",user).put("conversationId",conversation).put("body",body).put("state","queued");
                    ShareStore.write(getContext(),j);
                } else if(!user.equals(j.optString("userId")) || !conversation.equals(j.optString("conversationId")) || !body.equals(j.optString("body"))) {
                    call.reject("Повтор возможен только из исходного аккаунта с неизменным содержимым"); return;
                } else if("failed".equals(j.getString("state"))) {
                    j.put("state","queued").put("error",""); ShareStore.write(getContext(),j);
                }
            }
            ShareWorker.enqueue(getContext(),id); call.resolve();
        } catch(Exception e) { call.reject("Не удалось поставить отправку в очередь"); }
    }
    @PluginMethod public void discard(PluginCall call) {
        try { ShareStore.remove(getContext(),call.getString("id")); call.resolve(); }
        catch(Exception e) { call.reject("Дождитесь завершения отправки"); }
    }
}
