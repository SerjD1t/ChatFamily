package site.chatfamily.app;

import java.net.URI;

/** Exact HTTPS origins and documents only; never grant uploaded files a native bridge. */
public final class ShellNavigation {
    public static boolean internal(String value) {
        try {
            URI uri=new URI(value);
            if (!"https".equals(uri.getScheme()) || uri.getRawUserInfo()!=null || (uri.getPort()!=-1 && uri.getPort()!=443)) return false;
            String path=uri.getRawPath();
            return ("www.chatfamily.site".equals(uri.getHost()) && (path.isEmpty() || path.equals("/") || path.equals("/index.html")))
                || ("chatfamily.site".equals(uri.getHost()) && path.equals("/offline.html"));
        } catch(Exception ignored) { return false; }
    }
    private ShellNavigation() {}
}
