import { requireUser } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { loadAssistChat } from "@/lib/resolve/assist-service";
import { AssistLayout } from "@/components/resolve/chat/assist";
import { AssistChat } from "@/components/resolve/chat/assist-chat";

/**
 * REPORT A PROBLEM — Raagam Assist, the one tap-first chat
 * (doc/resolve/assist-catalog-plan.md). Every lane starts here. `requireUser`, not a permission
 * redirect: a login without Resolve Hub access is told so in the chat.
 */
export default async function Page() {
  await requireUser();
  const props = await loadAssistChat();
  return (
    <div className="space-y-4">
      <PageHeader title="Report a problem" />
      <AssistLayout replyMinutes={props.replyMinutes}>
        <AssistChat {...props} />
      </AssistLayout>
    </div>
  );
}
