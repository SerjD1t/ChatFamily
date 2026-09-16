package site.chatfamily.app.share;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Only app-private downloaded attachments. Never touches shares, cookies or Downloads. */
public final class AttachmentCache {
    public static final long MIB=1024L*1024, RESERVE=64*MIB, PIN_MS=15*60*1000L;
    private final File root;
    public AttachmentCache(File cacheDir) throws IOException {
        root=new File(cacheDir.getCanonicalFile(),"shared-downloads");
        if(!root.getCanonicalFile().equals(root.getAbsoluteFile())) throw new IOException("Unsafe cache path");
        if(!root.isDirectory()&&!root.mkdirs()) throw new IOException("Cache unavailable");
    }
    public static String key(String session,String id) throws Exception {
        byte[] digest=MessageDigest.getInstance("SHA-256").digest((session+"\n"+id).getBytes(StandardCharsets.UTF_8));
        StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();
    }
    public static void checkSpace(File location,long bytes) throws IOException {
        if(bytes<0||location.getUsableSpace()<RESERVE+bytes) throw new IOException("Недостаточно места: освободите память устройства / Not enough free storage");
    }
    public File folder(String key) throws IOException {
        if(!key.matches("[a-f0-9]{64}"))throw new IOException("Invalid cache key");
        File dir=new File(root,key);safe(dir);return dir;
    }
    private void safe(File file) throws IOException {
        if(!file.getCanonicalFile().equals(file.getAbsoluteFile())||!file.getCanonicalPath().startsWith(root.getCanonicalPath()+File.separator)) throw new IOException("Unsafe cache entry");
    }
    private List<File> entries() throws IOException {
        List<File> result=new ArrayList<>();File[] dirs=root.listFiles();if(dirs==null)throw new IOException("Cannot read cache");
        for(File dir:dirs){safe(dir);if(!dir.isDirectory())continue;
            if(!dir.getName().matches("[a-f0-9]{64}|[a-f0-9-]{36}"))continue;
            result.add(dir);
        }return result;
    }
    private long size(File dir) throws IOException {
        long sum=0;File[] files=dir.listFiles();if(files==null)throw new IOException("Cannot read cache entry");
        for(File file:files){safe(file);if(file.isFile())sum+=file.length();else throw new IOException("Unexpected cache directory");}return sum;
    }
    private long accessed(File dir) {long at=dir.lastModified();File[] files=dir.listFiles();if(files!=null)for(File f:files)at=Math.max(at,f.lastModified());return at;}
    public long bytes() throws IOException {long sum=0;for(File dir:entries())sum+=size(dir);return sum;}
    public File cached(File dir) throws IOException {
        safe(dir);if(!dir.exists())return null;File[] files=dir.listFiles();if(files==null)return null;
        for(File file:files){safe(file);if(file.isFile()&&!file.getName().equals(".part")&&file.length()>0)return file;}return null;
    }
    public void touch(File file) throws IOException {safe(file);long now=System.currentTimeMillis();if(!file.setLastModified(now)||!file.getParentFile().setLastModified(now))throw new IOException("Cannot retain cache entry");}
    public void remove(File dir) throws IOException {
        safe(dir);if(!dir.exists())return;size(dir); // Validate all children before deletion.
        File[] files=dir.listFiles();if(files==null)throw new IOException("Cannot read cache entry");
        for(File file:files)if(!file.delete())throw new IOException("Cannot remove cached file");
        if(!dir.delete())throw new IOException("Cannot remove cache entry");
    }
    public long trim(long limit,int days,long reserve,boolean clear,long now) throws IOException {
        List<File> dirs=entries();dirs.sort(Comparator.comparingLong(this::accessed));long total=bytes(),removed=0;
        for(File dir:dirs){long age=now-accessed(dir);boolean incomplete=cached(dir)==null;
            if((incomplete||age>=PIN_MS)&&(clear||incomplete||age>days*86400000L||total+reserve>limit)){
                long bytes=size(dir);remove(dir);total-=bytes;removed+=bytes;
            }
        }
        if(!clear&&reserve>0&&total+reserve>limit)throw new IOException("Кэш занят недавно открытыми файлами. Повторите позже или увеличьте лимит / Cache limit reached");
        return removed;
    }
}
