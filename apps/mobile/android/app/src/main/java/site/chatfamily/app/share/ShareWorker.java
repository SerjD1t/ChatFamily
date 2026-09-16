package site.chatfamily.app.share;

import android.app.*;
import android.content.Context;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.webkit.CookieManager;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

public class ShareWorker extends Worker {
    public static final String ORIGIN="https://www.chatfamily.site";
    public ShareWorker(@NonNull Context c,@NonNull WorkerParameters p) { super(c,p); }
    public static void enqueue(Context c,String id) {
        OneTimeWorkRequest work=new OneTimeWorkRequest.Builder(ShareWorker.class)
            .setInputData(new Data.Builder().putString("id",id).build())
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build();
        WorkManager.getInstance(c).enqueueUniqueWork("share-"+id,ExistingWorkPolicy.KEEP,work);
    }
    @NonNull @Override public ForegroundInfo getForegroundInfo() {
        Context c=getApplicationContext(); NotificationManager nm=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
        if(Build.VERSION.SDK_INT>=26) nm.createNotificationChannel(new NotificationChannel("uploads","Отправка вложений",NotificationManager.IMPORTANCE_LOW));
        Notification n=new NotificationCompat.Builder(c,"uploads").setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("ChatFamily").setContentText("Отправка вложений").setOngoing(true).build();
        int notificationId=("share-"+getInputData().getString("id")).hashCode() & Integer.MAX_VALUE;
        return Build.VERSION.SDK_INT>=29 ? new ForegroundInfo(notificationId,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) : new ForegroundInfo(notificationId,n);
    }
    private static void text(OutputStream out,String s) throws IOException { out.write(s.getBytes(StandardCharsets.UTF_8)); }
    private static void field(OutputStream out,String boundary,String name,String value) throws IOException {
        text(out,"--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n");
    }
    @NonNull @Override public Result doWork() {
        Context c=getApplicationContext(); String id=getInputData().getString("id"); HttpURLConnection conn=null;
        try {
            JSONObject job=ShareStore.read(c,id);
            if("sent".equals(job.getString("state"))) return Result.success();
            if(!job.has("userId") || !job.has("conversationId")) return Result.failure();
            String cookie=CookieManager.getInstance().getCookie(ORIGIN);
            if(cookie==null || !cookie.contains("family_session=")) { ShareStore.status(c,id,"failed","Войдите в исходный аккаунт и повторите отправку",0); return Result.failure(); }
            // Foreground eligibility and quotas are controlled by Android; failure remains retryable.
            setForegroundAsync(getForegroundInfo()).get();
            ShareStore.status(c,id,"uploading","",0);
            String boundary="ChatFamily"+id;
            conn=(HttpURLConnection)new URL(ORIGIN+"/api/v1/mobile/shares/"+id).openConnection();
            conn.setInstanceFollowRedirects(false); conn.setRequestMethod("POST"); conn.setConnectTimeout(20000); conn.setReadTimeout(60000);
            conn.setDoOutput(true); conn.setChunkedStreamingMode(65536);
            conn.setRequestProperty("Cookie",cookie); conn.setRequestProperty("X-Expected-User",job.getString("userId"));
            conn.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);
            JSONArray files=job.getJSONArray("files"); long size=0,done=0,last=0;
            for(int i=0;i<files.length();i++) size+=files.getJSONObject(i).getLong("bytes");
            try(OutputStream out=conn.getOutputStream()) {
                field(out,boundary,"conversationId",job.getString("conversationId")); field(out,boundary,"body",job.getString("body"));
                for(int i=0;i<files.length();i++) {
                    JSONObject file=files.getJSONObject(i);
                    String name=file.getString("name").replace("\"","_");
                    String type=file.getString("type"); if(!type.matches("[a-zA-Z0-9.+_-]+/[a-zA-Z0-9.+_-]+")) type="application/octet-stream";
                    text(out,"--"+boundary+"\r\nContent-Disposition: form-data; name=\"files\"; filename=\""+name+"\"\r\nContent-Type: "+type+"\r\n\r\n");
                    try(InputStream in=new FileInputStream(new File(ShareStore.folder(c,id),"file-"+i))) {
                        byte[] buf=new byte[65536]; int n;
                        while((n=in.read(buf))!=-1) {
                            if(isStopped()) throw new IOException("Interrupted");
                            out.write(buf,0,n); done+=n;
                            if(System.currentTimeMillis()-last>1000) { ShareStore.status(c,id,"uploading","",(int)(done*100/Math.max(1,size))); last=System.currentTimeMillis(); }
                        }
                    }
                    text(out,"\r\n");
                }
                text(out,"--"+boundary+"--\r\n");
            }
            int status=conn.getResponseCode();
            if(status==200) {
                try(InputStream in=conn.getInputStream()) {
                    JSONObject response=new JSONObject(new String(ShareStore.readLimited(in,65536),StandardCharsets.UTF_8));
                    if(response.optString("messageId").isEmpty()) throw new IOException("Missing acknowledgement");
                }
                ShareStore.status(c,id,"sent","",100); ShareStore.deletePayload(c,id); return Result.success();
            }
            if(status==429 || status>=500) throw new IOException("Temporary server error");
            String error=switch(status) {
                case 401,409 -> "Проверьте вход в исходный аккаунт. При повторе нельзя менять содержимое отправки.";
                case 403 -> "Нет прав на отправку в выбранный чат";
                case 413 -> "Превышен серверный лимит вложений";
                case 404 -> "Сервер ещё не обновлён для мобильной отправки";
                default -> "Сервер отклонил отправку ("+status+")";
            };
            ShareStore.status(c,id,"failed",error,0); return Result.failure();
        } catch(Exception e) {
            try { ShareStore.status(c,id,getRunAttemptCount()<5?"queued":"failed",getRunAttemptCount()<5?"Ожидание повторной попытки":"Не удалось отправить. Проверьте сеть и повторите",0); } catch(Exception ignored) {}
            return getRunAttemptCount()<5?Result.retry():Result.failure();
        } finally { if(conn!=null) conn.disconnect(); }
    }
}
