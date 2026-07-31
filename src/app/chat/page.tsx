import type { Metadata } from "next";
import { ChatWorkspace } from "@/features/chat/components/chat-workspace";

export const metadata: Metadata = {
  title: "AI Data Chat · Diamond Edge",
  description: "Ask natural-language questions about the MLB slate, projections, PrizePicks edges, and data health — answered from Diamond Edge's controlled analytics tools.",
};

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return <ChatWorkspace />;
}
