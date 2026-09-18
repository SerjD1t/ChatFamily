package site.chatfamily.app.update;

import java.net.URI;
import java.util.Set;

/** Pure policy, also used by JVM tests. Never accept an arbitrary URL from JS. */
public final class UpdatePolicy {
    public static final String ORIGIN = "https://www.chatfamily.site";
    public static final long MAX_BYTES = 128L * 1024 * 1024;
    public static boolean validPath(String path, long code) {
        return code > 0 && ("/downloads/android/chatfamily-" + code + ".apk").equals(path);
    }
    public static boolean validMetadata(long code, long size, String sha, String path, int minSdk) {
        return validPath(path,code) && size > 0 && size <= MAX_BYTES && minSdk >= 24 &&
            sha != null && sha.matches("[a-f0-9]{64}");
    }
    public static boolean sameSigners(Set<String> installed, Set<String> candidate) {
        return !installed.isEmpty() && installed.equals(candidate);
    }
    public static boolean trustedPage(String value) {
        try {
            URI u = new URI(value);
            return "https".equals(u.getScheme()) && "www.chatfamily.site".equals(u.getHost()) &&
                u.getRawUserInfo()==null && (u.getPort()==-1 || u.getPort()==443) &&
                (u.getRawPath().isEmpty() || u.getRawPath().equals("/") || u.getRawPath().equals("/index.html"));
        } catch(Exception ignored) { return false; }
    }
    private UpdatePolicy() {}
}
