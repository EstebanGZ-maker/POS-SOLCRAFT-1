"use client";

import type React from "react";
import { usePathname } from "next/navigation";
import { ProtectedRoute } from "@/components/protected-route";
import { DashboardLayout } from "@/components/dashboard-layout";

export function ClientLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Rutas públicas (sin auth ni sidebar)
  const isPublic = pathname === "/login" || pathname === "/catalog" || pathname.startsWith("/catalog/");
  if (isPublic) {
    return <>{children}</>;
  }

  // For all other pages, wrap with protection and dashboard layout
  return (
    <ProtectedRoute>
      <DashboardLayout>{children}</DashboardLayout>
    </ProtectedRoute>
  );
}
