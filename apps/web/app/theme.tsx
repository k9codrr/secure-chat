"use client";
import { ThemeProvider } from "next-themes";

export function Theme({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem nonce={nonce}>
      {children}
    </ThemeProvider>
  );
}
