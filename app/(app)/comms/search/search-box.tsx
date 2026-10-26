"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** The query lives in the URL (?q=), so a search can be refreshed or shared. */
export function SearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [pending, start] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    start(() => router.push(`/comms/search?q=${encodeURIComponent(q.trim())}`));
  }

  return (
    <form onSubmit={submit} className="flex gap-2 border-b border-border p-2" role="search">
      {/* caps-input: exempt -- a search box; the query is not a stored value */}
      <Input
        type="search"
        uppercase={false}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search messages"
        aria-label="Search messages"
        autoFocus
        className="flex-1"
      />
      <Button type="submit" disabled={pending || q.trim().length < 2}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
      </Button>
    </form>
  );
}
