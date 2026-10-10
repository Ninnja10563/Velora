"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import Velora from "./velora";
import { AuthConfirmation } from "./account-access";
export default function Application({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path === "/auth/confirm") return <AuthConfirmation />;
  return path?.startsWith("/admin") ? <>{children}</> : <Velora />;
}
