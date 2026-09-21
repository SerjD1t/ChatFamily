package site.chatfamily.app.widget;

import org.junit.Test;
import static org.junit.Assert.*;

public class WidgetPolicyTest {
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
