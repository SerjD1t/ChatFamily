package site.chatfamily.app.update;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.Set;

public class UpdatePolicyTest {
 @Test public void onlyFixedDownloadPathAndBoundedMetadata() {
  assertTrue(UpdatePolicy.validMetadata(5,100,"a".repeat(64),"/downloads/android/chatfamily-5.apk",24));
  for(String path:new String[]{"https://evil.test/a.apk","/downloads/android/../other.apk","/downloads/android/chatfamily-4.apk","/downloads/android/chatfamily-5.apk?x"})assertFalse(UpdatePolicy.validMetadata(5,100,"a".repeat(64),path,24));
  assertFalse(UpdatePolicy.validMetadata(5,UpdatePolicy.MAX_BYTES+1,"a".repeat(64),"/downloads/android/chatfamily-5.apk",24));
  assertFalse(UpdatePolicy.validMetadata(5,100,"bad","/downloads/android/chatfamily-5.apk",24));
 }
 @Test public void certificateIdentityIsRequiredNotBuildType() {
  assertTrue(UpdatePolicy.sameSigners(Set.of("debug-or-release-cert"),Set.of("debug-or-release-cert")));
  assertFalse(UpdatePolicy.sameSigners(Set.of("installed"),Set.of("other")));
  assertFalse(UpdatePolicy.sameSigners(Set.of(),Set.of()));
 }
 @Test public void originCannotBeAnAttachmentOrExternalPage() {
  assertTrue(UpdatePolicy.trustedPage("https://www.chatfamily.site/"));
  assertFalse(UpdatePolicy.trustedPage("https://www.chatfamily.site/api/v1/attachments/file"));
  assertFalse(UpdatePolicy.trustedPage("https://www.chatfamily.site.evil.test/"));
  assertFalse(UpdatePolicy.trustedPage("http://www.chatfamily.site/"));
  assertFalse(UpdatePolicy.trustedPage("https://user@www.chatfamily.site/"));
 }
}
