package site.chatfamily.app.widget;

import org.junit.Test;
import static org.junit.Assert.*;

public class WidgetPolicyTest {
    @Test public void clockReservesSpaceAndTransparencyIsBounded() {
        assertEquals(255,WidgetPolicy.backgroundAlpha(0));
        assertEquals(128,WidgetPolicy.backgroundAlpha(50));
        assertEquals(0,WidgetPolicy.backgroundAlpha(100));
        assertEquals(0,WidgetPolicy.backgroundAlpha(200));
        assertEquals(255,WidgetPolicy.backgroundAlpha(-1));
        assertEquals(300,WidgetPolicy.contentHeight(300,false,1));
        assertEquals(220,WidgetPolicy.contentHeight(300,true,1));
        assertEquals(140,WidgetPolicy.contentHeight(300,true,2));
        assertEquals(0,WidgetPolicy.contentHeight(60,true,1));
    }
    @Test public void unreadCirclesFitWidthAndKeepCounts() {
        assertEquals(4,WidgetPolicy.chatCount(250,8));
        assertEquals(5,WidgetPolicy.chatCount(320,8));
        assertEquals(3,WidgetPolicy.chatCount(180,8));
        assertEquals(0,WidgetPolicy.chatCount(320,0));
        assertEquals("99+",WidgetPolicy.badge(120));
        assertEquals("4",WidgetPolicy.badge(4));
        assertEquals("AB",WidgetPolicy.initials(" Alpha Beta "));
        assertEquals("?",WidgetPolicy.initials(""));
        assertTrue(WidgetPolicy.avatarPath("/api/v1/users/user-1/avatar"));
        assertFalse(WidgetPolicy.avatarPath("https://foreign.test/avatar"));
        assertFalse(WidgetPolicy.avatarPath("/api/v1/users/../settings"));
        assertFalse(WidgetPolicy.avatarPath("/api/v1/users/u/avatar?token=x"));
    }
    @Test public void checklistActionsRejectStaleAccountConfigurationAndVersion() {
        assertTrue(WidgetPolicy.acceptsAction("a","a",4,4,2,2));
        assertFalse(WidgetPolicy.acceptsAction("a","b",4,4,2,2));
        assertFalse(WidgetPolicy.acceptsAction("a","a",3,4,2,2));
        assertFalse(WidgetPolicy.acceptsAction("a","a",4,4,1,2));
        assertFalse(WidgetPolicy.acceptsAction("a","a",4,4,0,0));
        assertFalse(WidgetPolicy.acceptsAction(null,"a",4,4,2,2));
    }
    @Test public void configurationDiscoversAccountWithoutWebBridge() {
        assertTrue(WidgetPolicy.acceptsAccount("", "user-1", true, "session-a", "session-a"));
        assertTrue(WidgetPolicy.acceptsAccount("old-user", "user-1", true, "session-a", "session-a"));
        assertFalse(WidgetPolicy.acceptsAccount("", "", true, "session-a", "session-a"));
    }
    @Test public void backgroundRequestsRemainAccountBound() {
        assertTrue(WidgetPolicy.acceptsAccount("user-1", "user-1", false, "session-a", "session-a"));
        assertFalse(WidgetPolicy.acceptsAccount("user-1", "user-2", false, "session-a", "session-a"));
        assertFalse(WidgetPolicy.acceptsAccount("user-1", "user-1", false, "session-a", null));
        assertFalse(WidgetPolicy.acceptsAccount("", "user-1", true, "session-a", "session-b"));
    }
    @Test public void cacheExpiresAndRejectsFutureTimestamps() {
        assertTrue(WidgetPolicy.fresh(1_000, 2_000));
        assertFalse(WidgetPolicy.fresh(0, 2_000));
        assertFalse(WidgetPolicy.fresh(3_000, 2_000));
        assertFalse(WidgetPolicy.fresh(1_000, 86_401_000));
    }
    @Test public void contentFitsSmallAndLargeWidgets() {
        assertEquals(0, WidgetPolicy.rows(180, 1));
        assertEquals(1, WidgetPolicy.rows(300, 1));
        assertEquals(2, WidgetPolicy.rows(450, 1));
        assertEquals(4, WidgetPolicy.rows(700, 1));
        assertEquals(0, WidgetPolicy.rows(300, 2));
    }
    @Test public void identifiersCannotInjectQueriesOrPaths() {
        assertTrue(WidgetStore.validID("family-123_abc"));
        assertFalse(WidgetStore.validID("../another"));
        assertFalse(WidgetStore.validID("f&mine=false"));
        assertFalse(WidgetStore.validID(""));
        assertFalse(WidgetStore.validID(null));
    }
}
