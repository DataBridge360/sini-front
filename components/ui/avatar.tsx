"use client";

import Image from "next/image";
import { User } from "lucide-react";
import { initials } from "@/lib/format";

export function Avatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    return <Image className="sp-user-avatar" src={avatarUrl} alt="" width={56} height={56} unoptimized />;
  }

  return <div className="sp-user-avatar">{initials(name) || <User size={14} />}</div>;
}

