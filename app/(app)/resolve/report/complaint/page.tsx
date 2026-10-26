import { requireUser } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { loadAssistChat } from "@/lib/resolve/assist-service";
import { AssistLayout } from "@/components/resolve/chat/assist";
import { AssistChat } from "@/components/resolve/chat/assist-chat";

/**
 * RAISE A CONCERN — Raagam Assist, the one tap-first chat
 * (doc/resolve/assist-catalog-plan.md). `requireUser`, not a permission
 * redirect: a login without Resolve Hub access is told so in the chat.
 */
export default async function Page() {
  await requireUser();
  const props = await loadAssistChat();
  return (
    <div className="space-y-4">
      <PageHeader title="Raise a concern" back={{ href: "/resolve/report", label: "Report a problem" }} />
      <AssistLayout replyMinutes={props.replyMinutes}>
        <AssistChat {...props} startLane="concern" />
      </AssistLayout>
    </div>
  );
}
