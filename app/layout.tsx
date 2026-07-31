import type React from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { ClientLayoutWrapper } from "@/components/client-layout-wrapper";
import { SiteProvider } from "@/lib/site-context";
import { SWRProvider } from "@/components/swr-provider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  generator: "v0.dev",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AuthProvider>
            <SWRProvider>
              <SiteProvider>
                <ClientLayoutWrapper>
                  {children}
                </ClientLayoutWrapper>
              </SiteProvider>
            </SWRProvider>
          </AuthProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
