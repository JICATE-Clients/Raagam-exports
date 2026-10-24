import { MessagesSquare } from "lucide-react";

/**
 * Messages — the hub's home. On a wide pane the conversation list sits beside
 * this placeholder; on a narrow one the shell shows only the list here.
 */
export default function CommsHomePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <MessagesSquare className="h-10 w-10 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-foreground">Pick a conversation</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Choose one on the left, or press New to message a colleague or start a group.
      </p>
    </div>
  );
}
