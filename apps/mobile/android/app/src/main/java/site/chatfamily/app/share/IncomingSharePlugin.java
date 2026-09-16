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
    @PluginMethod public void openAttachment(PluginCall call) {
        String id=call.getString("id"), name=call.getString("name","attachment");
        if(id==null || !id.matches("[a-zA-Z0-9_-]{1,100}")) { call.reject("Некорректное вложение"); return; }
        DOWNLOADS.execute(()->{
            HttpURLConnection conn=null;
            try {
                conn=(HttpURLConnection)new URL(ShareWorker.ORIGIN+"/api/v1/attachments/"+id).openConnection();
                conn.setInstanceFollowRedirects(false); conn.setConnectTimeout(20000); conn.setReadTimeout(60000);
                String cookies=CookieManager.getInstance().getCookie(ShareWorker.ORIGIN);
                if(cookies!=null) conn.setRequestProperty("Cookie",cookies);
                if(conn.getResponseCode()!=200) throw new IOException("Download failed");
                File dir=new File(getContext().getCacheDir(),"shared-downloads"); dir.mkdirs();
                // A unique child folder preserves the original filename without collisions.
                File targetDir=new File(dir,java.util.UUID.randomUUID().toString()); targetDir.mkdirs();
                File file=new File(targetDir,name.replaceAll("[\\\\/\\r\\n\\x00]","_"));
                if(!file.getCanonicalPath().startsWith(targetDir.getCanonicalPath()+File.separator)) throw new IOException("Invalid filename");
                try(InputStream in=conn.getInputStream(); OutputStream out=new FileOutputStream(file)) {
                    byte[] buf=new byte[65536]; long size=0; int n;
                    while((n=in.read(buf))!=-1) { size+=n; if(size>ShareStore.MAX_TOTAL) throw new IOException("File too large"); out.write(buf,0,n); }
                }
                String mime=conn.getContentType();
                Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file),mime==null?"application/octet-stream":mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().runOnUiThread(()->{
                    try { getActivity().startActivity(Intent.createChooser(intent,"Открыть вложение")); call.resolve(); }
                    catch(Exception e) { call.reject("Нет приложения для открытия файла"); }
                });
            } catch(Exception e) { call.reject("Не удалось загрузить вложение"); }
            finally { if(conn!=null) conn.disconnect(); }
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
