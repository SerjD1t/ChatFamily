package site.chatfamily.app.share;

import java.util.ArrayDeque;

/** One-shot navigation, separate from the durable upload queue. No file contents. */
public final class ShareOpenRequests {
    private static final ArrayDeque<String> pending=new ArrayDeque<>();
    private static long generation;
    private ShareOpenRequests() {}
    public static boolean freshShare(String action,boolean fromHistory) {
        return !fromHistory && ("android.intent.action.SEND".equals(action)||"android.intent.action.SEND_MULTIPLE".equals(action));
    }
    public static synchronized long generation(){return generation;}
    public static synchronized void ordinaryEntry(){generation++;pending.clear();}
    public static synchronized void received(String id,long expected){
        if(expected!=generation||id==null||pending.contains(id))return;
        if(pending.size()==5)pending.removeFirst();pending.addLast(id);
    }
    public static synchronized String consume(){return pending.isEmpty()?"":pending.removeFirst();}
}
