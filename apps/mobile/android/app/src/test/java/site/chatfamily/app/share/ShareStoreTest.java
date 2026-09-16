package site.chatfamily.app.share;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;

public class ShareStoreTest {
    @Test public void readsBoundedAcknowledgement() throws Exception {
        byte[] expected=new byte[]{1,2,3};
        assertArrayEquals(expected,ShareStore.readLimited(new ByteArrayInputStream(expected),3));
    }
    @Test public void rejectsOversizedResponse() {
        assertThrows(IOException.class,()->ShareStore.readLimited(new ByteArrayInputStream(new byte[5]),4));
    }
}
