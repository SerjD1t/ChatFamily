package site.chatfamily.app.share;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class AttachmentCacheTest {
    @Rule public TemporaryFolder temp=new TemporaryFolder();
    private File entry(AttachmentCache cache,String id,long age) throws Exception {
        File dir=cache.folder(AttachmentCache.key("test-session",id));assertTrue(dir.mkdirs());
        File file=new File(dir,"file.txt");Files.write(file.toPath(),new byte[10]);long at=System.currentTimeMillis()-age;
        assertTrue(file.setLastModified(at));assertTrue(dir.setLastModified(at));return file;
    }
    @Test public void keysAreStableAndSessionScoped() throws Exception {
        assertEquals(AttachmentCache.key("a","file"),AttachmentCache.key("a","file"));
        assertNotEquals(AttachmentCache.key("a","file"),AttachmentCache.key("b","file"));
    }
    @Test public void evictsOldestForBudgetAndKeepsRecentViewer() throws Exception {
        AttachmentCache cache=new AttachmentCache(temp.getRoot());
        File old=entry(cache,"old",2*86400000L),recent=entry(cache,"recent",1000);
        cache.trim(20,7,10,false,System.currentTimeMillis());assertFalse(old.exists());assertTrue(recent.exists());
        assertThrows(IOException.class,()->cache.trim(10,7,10,false,System.currentTimeMillis()));
        cache.trim(20,7,0,true,System.currentTimeMillis());assertTrue(recent.exists());
    }
    @Test public void expiresCacheAndClearsOnlyDownloadTree() throws Exception {
        AttachmentCache cache=new AttachmentCache(temp.getRoot());File old=entry(cache,"old",8*86400000L);
        File queue=new File(temp.getRoot(),"incoming-shares");assertTrue(queue.mkdir());File draft=new File(queue,"draft");Files.write(draft.toPath(),new byte[]{1});
        cache.trim(100,7,0,false,System.currentTimeMillis());assertFalse(old.exists());assertTrue(draft.exists());
    }
    @Test public void removesPartialAndRejectsTraversal() throws Exception {
        AttachmentCache cache=new AttachmentCache(temp.getRoot());File dir=cache.folder(AttachmentCache.key("a","b"));assertTrue(dir.mkdir());
        Files.write(new File(dir,".part").toPath(),new byte[]{1});cache.trim(100,7,0,false,System.currentTimeMillis());assertFalse(dir.exists());
        assertThrows(IOException.class,()->cache.folder("../outside"));assertThrows(IOException.class,()->cache.remove(temp.getRoot()));
    }
    @Test public void cachedCopyIsReusedAndTouchProtectsIt() throws Exception {
        AttachmentCache cache=new AttachmentCache(temp.getRoot());File file=entry(cache,"same",2*86400000L);
        assertEquals(file,cache.cached(file.getParentFile()));cache.touch(file);cache.trim(100,7,0,true,System.currentTimeMillis());assertTrue(file.exists());assertEquals(10,cache.bytes());
    }
}
