package site.chatfamily.app.share;

import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import org.json.JSONArray;
import android.content.Context;
import java.util.UUID;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ShareStoreInstrumentedTest {
    @Test public void draftSurvivesReloadAndCanBeRemoved() throws Exception {
        Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
        String id=UUID.randomUUID().toString();
        try {
            ShareStore.write(c,new JSONObject().put("id",id).put("state","draft").put("body","test").put("files",new JSONArray()));
            assertEquals("test",ShareStore.read(c,id).getString("body"));
        } finally { if(ShareStore.folder(c,id).exists()) ShareStore.remove(c,id); }
        assertFalse(ShareStore.folder(c,id).exists());
    }
    @Test public void rejectsPathTraversal() {
        Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertThrows(Exception.class,()->ShareStore.folder(c,"../../other"));
    }
}
