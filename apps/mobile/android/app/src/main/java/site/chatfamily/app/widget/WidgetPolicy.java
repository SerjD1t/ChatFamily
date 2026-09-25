package site.chatfamily.app.widget;

/** Pure policy shared by cache/render code and local JVM tests. */
public final class WidgetPolicy {
    private WidgetPolicy() {}
    public static int backgroundAlpha(int transparency) {return Math.round(255*(100-Math.max(0,Math.min(100,transparency)))/100f);}
    public static int contentHeight(int height,boolean clock,float fontScale) {return Math.max(0,height-(clock?(int)Math.ceil(80*Math.max(1f,fontScale)):0));}
    public static boolean avatarPath(String path) {return path!=null&&path.matches("/api/v1/users/[a-zA-Z0-9_-]{1,100}/avatar");}
    public static int chatCount(int widthDp,int available) {return Math.min(Math.max(0,available),Math.max(1,Math.min(5,(widthDp-20)/48)));}
    public static String badge(long unread) {return unread>99?"99+":Long.toString(Math.max(0,unread));}
    public static String initials(String title) {
        if(title==null||title.trim().isEmpty())return "?";
        String[] words=title.trim().split("\\s+");StringBuilder result=new StringBuilder();
        for(int i=0;i<Math.min(2,words.length);i++)result.appendCodePoint(words[i].codePointAt(0));
        return result.toString().toUpperCase(java.util.Locale.ROOT);
    }
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
