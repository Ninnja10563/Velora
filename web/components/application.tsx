"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import Velora from "./velora";
export default function Application({ children }: { children: ReactNode }) {
  const path = usePathname();
  return path?.startsWith("/admin") ? <>{children}</> : <Velora />;
}
