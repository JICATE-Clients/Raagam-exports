import { redirect } from "next/navigation";

/** The Community caption is a group, not a screen: its first row is Messages. */
export default function CommunityPage() {
  redirect("/comms");
}
