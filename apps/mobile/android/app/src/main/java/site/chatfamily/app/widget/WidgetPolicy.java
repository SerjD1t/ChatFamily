package site.chatfamily.app.widget;

/** Pure policy shared by cache/render code and local JVM tests. */
public final class WidgetPolicy {
    private WidgetPolicy() {}
    public static boolean acceptsAction(String expectedUser,String currentUser,long expectedEpoch,long currentEpoch,long expectedVersion,long currentVersion) {
        return expectedUser!=null&&!expectedUser.isEmpty()&&expectedUser.equals(currentUser)
            && expectedEpoch==currentEpoch&&expectedVersion>0&&expectedVersion==currentVersion;
    }
    public static boolean acceptsAccount(String expected, String actual, boolean discovery, String sentCookie, String currentCookie) {
        return actual != null && actual.matches("[a-zA-Z0-9_-]{1,100}")
            && (discovery || actual.equals(expected))
            && sentCookie != null && sentCookie.equals(currentCookie);
    }
    public static boolean fresh(long fetchedAt, long now) {
        return fetchedAt > 0 && now >= fetchedAt && now - fetchedAt < 86_400_000L;
    }
    public static int rows(int heightDp, float fontScale) {
        float scale = Math.max(1f, fontScale);
        return Math.max(0, Math.min(4, (int) ((heightDp - 200 * scale) / (88 * scale))));
    }
}
