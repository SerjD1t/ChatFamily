package site.chatfamily.app.share;

import org.junit.Test;
import static org.junit.Assert.*;

public class ShareOpenRequestsTest {
 @Test public void ordinaryEntryAndHistoryAreNotShares(){
  assertFalse(ShareOpenRequests.freshShare("android.intent.action.MAIN",false));
  assertFalse(ShareOpenRequests.freshShare("android.intent.action.SEND",true));
  assertFalse(ShareOpenRequests.freshShare(null,false));
  assertTrue(ShareOpenRequests.freshShare("android.intent.action.SEND",false));
  assertTrue(ShareOpenRequests.freshShare("android.intent.action.SEND_MULTIPLE",false));
 }
 @Test public void navigationIsOneShotAndLateImportCannotOpenOnOrdinaryEntry(){
  ShareOpenRequests.ordinaryEntry();long generation=ShareOpenRequests.generation();
  ShareOpenRequests.received("synthetic",generation);ShareOpenRequests.received("synthetic",generation);
  assertEquals("synthetic",ShareOpenRequests.consume());assertEquals("",ShareOpenRequests.consume());
  ShareOpenRequests.ordinaryEntry();ShareOpenRequests.received("late",generation);assertEquals("",ShareOpenRequests.consume());
  ShareOpenRequests.received("new",ShareOpenRequests.generation());assertEquals("new",ShareOpenRequests.consume());
  ShareOpenRequests.received("dismissed",ShareOpenRequests.generation());ShareOpenRequests.ordinaryEntry();assertEquals("",ShareOpenRequests.consume());
 }
}
