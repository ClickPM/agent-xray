import { GlobalNav } from "@/components/GlobalNav";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <GlobalNav />
      {children}
    </div>
  );
}
