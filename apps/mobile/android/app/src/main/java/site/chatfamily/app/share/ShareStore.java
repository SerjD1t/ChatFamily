package site.chatfamily.app.share;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Only app-private copies are queued. Incoming content URI grants may expire. */
public final class ShareStore {
    public static final long MAX_FILE = 25L * 1024 * 1024, MAX_TOTAL = 100L * 1024 * 1024;
    public static final int MAX_FILES = 10;
    private static File root(Context c) { File f = new File(c.getNoBackupFilesDir(), "incoming-shares"); f.mkdirs(); return f; }
    public static File folder(Context c, String id) throws IOException {
        if (id == null || !id.matches("[a-f0-9-]{36}") || !UUID.fromString(id).toString().equals(id)) throw new IOException("Invalid share id");
        return new File(root(c), id);
    }
    public static synchronized JSONObject read(Context c, String id) throws Exception {
        try (InputStream in = new AtomicFile(new File(folder(c,id),"job.json")).openRead()) {
            return new JSONObject(new String(readLimited(in,1048576), StandardCharsets.UTF_8));
        }
    }
    public static synchronized void write(Context c, JSONObject job) throws Exception {
        File dir = folder(c, job.getString("id")); dir.mkdirs();
        AtomicFile target = new AtomicFile(new File(dir,"job.json"));
        FileOutputStream out = target.startWrite();
        try { out.write(job.toString().getBytes(StandardCharsets.UTF_8)); target.finishWrite(out); }
        catch (Exception e) { target.failWrite(out); throw e; }
    }
    public static synchronized void status(Context c, String id, String state, String error, int progress) throws Exception {
        JSONObject job=read(c,id); job.put("state",state); job.put("error",error); job.put("progress",progress);
        if(state.equals("sent")) job.put("sentAt",System.currentTimeMillis());
        write(c,job);
    }
    public static synchronized JSONArray list(Context c) throws Exception {
        JSONArray result=new JSONArray(); File[] dirs=root(c).listFiles(); if(dirs==null) return result;
        Arrays.sort(dirs, Comparator.comparing(File::getName));
        for(File dir:dirs) {
            if (!new File(dir,"job.json").exists()) continue;
            JSONObject j=read(c,dir.getName());
            result.put(j);
        }
        return result;
    }
    public static synchronized void remove(Context c,String id) throws Exception {
        JSONObject j=read(c,id);
        String state=j.getString("state");
        if(!state.equals("draft") && !state.equals("sent") && !state.equals("failed")) throw new IOException("Дождитесь окончания отправки");
        deleteFolder(folder(c,id));
    }
    private static void deleteFolder(File dir) {
        File[] files=dir.listFiles(); if(files!=null) for(File f:files) if(f.isFile()) f.delete();
        dir.delete();
    }
    public static byte[] readLimited(InputStream in,int max) throws IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream(); byte[] buf=new byte[8192]; int n;
        while((n=in.read(buf))!=-1) { if(out.size()+n>max) throw new IOException("Response too large"); out.write(buf,0,n); }
        return out.toByteArray();
    }
    public static synchronized void deletePayload(Context c,String id) throws Exception {
        File[] files=folder(c,id).listFiles(); if(files!=null) for(File f:files) if(f.getName().matches("file-[0-9]+")) f.delete();
        ArrayList<JSONObject> sent=new ArrayList<>(); JSONArray jobs=list(c);
        for(int i=0;i<jobs.length();i++) if("sent".equals(jobs.getJSONObject(i).optString("state"))) sent.add(jobs.getJSONObject(i));
        sent.sort(Comparator.comparingLong(j->-j.optLong("sentAt",j.optLong("createdAt"))));
        for(int i=50;i<sent.size();i++) deleteFolder(folder(c,sent.get(i).getString("id")));
    }
    @SuppressWarnings("deprecation")
    public static synchronized String receive(Context c, Intent intent) throws Exception {
        JSONArray jobs=list(c); int pending=0;
        for(int i=0;i<jobs.length();i++) if(!"sent".equals(jobs.getJSONObject(i).optString("state"))) pending++;
        if(pending>=5) throw new IOException("Очередь заполнена: завершите отправки или удалите черновики");
        LinkedHashSet<Uri> uris=new LinkedHashSet<>();
        if(Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            ArrayList<Uri> incoming=intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM); if(incoming!=null) uris.addAll(incoming);
        } else { Uri uri=intent.getParcelableExtra(Intent.EXTRA_STREAM); if(uri!=null) uris.add(uri); }
        if(intent.getClipData()!=null) for(int i=0;i<intent.getClipData().getItemCount();i++) {
            Uri uri=intent.getClipData().getItemAt(i).getUri(); if(uri!=null) uris.add(uri);
        }
        if(uris.size()>MAX_FILES) throw new IOException("Не более 10 файлов за отправку");
        String id=UUID.randomUUID().toString(); File dir=folder(c,id); dir.mkdirs();
        try {
            JSONArray files=new JSONArray(); long total=0;
            for(Uri uri:uris) {
                // Do not accept file:// or paths supplied by another app.
                if(!"content".equals(uri.getScheme()) || (c.getPackageName()+".fileprovider").equals(uri.getAuthority())) throw new IOException("Источник не предоставил безопасный доступ к файлу");
                String name="file";
                try(Cursor cur=c.getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)) {
                    if(cur!=null && cur.moveToFirst()) name=cur.getString(0);
                }
                if(name==null || name.isBlank()) name="file";
                name=name.replaceAll("[\\\\/\\r\\n\\x00]","_");
                if(name.getBytes(StandardCharsets.UTF_8).length>512) throw new IOException("Слишком длинное имя файла");
                long size=0; File dest=new File(dir,"file-"+files.length());
                try(InputStream in=c.getContentResolver().openInputStream(uri); OutputStream out=new FileOutputStream(dest)) {
                    if(in==null) throw new IOException("Файл недоступен");
                    byte[] buf=new byte[65536]; int n;
                    while((n=in.read(buf))!=-1) {
                        size+=n; total+=n;
                        if(size>MAX_FILE || total>MAX_TOTAL) throw new IOException("Лимит: 25 МиБ на файл, 100 МиБ на отправку");
                        out.write(buf,0,n);
                    }
                }
                if(size==0) throw new IOException("Нельзя отправить пустой файл");
                String type=c.getContentResolver().getType(uri);
                files.put(new JSONObject().put("name",name).put("bytes",size).put("type",type==null?"application/octet-stream":type));
            }
            CharSequence text=intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            String body=text==null?"":text.toString();
            if(body.codePointCount(0,body.length())>4000) throw new IOException("Текст длиннее 4000 символов");
            if(files.length()==0 && body.isBlank()) throw new IOException("Приложение не передало файл или текст");
            JSONObject job=new JSONObject().put("id",id).put("state","draft").put("body",body).put("files",files).put("createdAt",System.currentTimeMillis()).put("progress",0);
            write(c,job); return id;
        } catch(Exception e) { deleteFolder(dir); throw e; }
    }
}
