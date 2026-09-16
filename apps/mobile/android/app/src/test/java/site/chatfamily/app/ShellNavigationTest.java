package site.chatfamily.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class ShellNavigationTest {
 @Test public void onlyTrustedDocumentsStayInside() {
  assertTrue(ShellNavigation.internal("https://www.chatfamily.site/"));
  assertTrue(ShellNavigation.internal("https://www.chatfamily.site/?invite=code"));
  assertTrue(ShellNavigation.internal("https://chatfamily.site/offline.html"));
  for(String url:new String[]{"http://www.chatfamily.site/","https://www.chatfamily.site.evil.test/","https://evil.test/","https://www.chatfamily.site@evil.test/","https://www.chatfamily.site:444/","https://www.chatfamily.site/api/v1/attachments/a","https://www.chatfamily.site/%2f","file:///etc/passwd","javascript:alert(1)","intent://test","https://chatfamily.site/"}) assertFalse(url,ShellNavigation.internal(url));
 }
}
