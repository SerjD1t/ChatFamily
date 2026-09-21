package site.chatfamily.app.widget;

/** Pure policy shared by cache/render code and local JVM tests. */
public final class WidgetPolicy {
    private WidgetPolicy() {}
    public static boolean fresh(long fetchedAt, long now) {
        return fetchedAt > 0 && now >= fetchedAt && now - fetchedAt < 86_400_000L;
    }
    public static int rows(int heightDp, float fontScale) {
        float scale = Math.max(1f, fontScale);
        return Math.max(0, Math.min(4, (int) ((heightDp - 200 * scale) / (88 * scale))));
    }
}
