"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, GhostButton } from "@/components/ui";

// 演示期登录:任意非空密码进入(sessionStorage 标记)。
// pi 接入轮替换为 /api/admin/login(argon2 + HttpOnly cookie + 限速锁定,docs/security.md §4)。
export default function AdminLoginPage() {
  const router = useRouter();
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState(false);

  const submit = () => {
    if (!pwd.trim()) {
      setError(true);
      return;
    }
    try {
      sessionStorage.setItem("xray-admin", "1");
    } catch {}
    router.replace("/admin");
  };

  return (
    <div style={{ height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div style={{ width: 360, border: "1px solid var(--border)", borderRadius: 8, padding: "32px 28px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>Agent X-Ray</span>
          <Badge color="var(--text-muted)">ADMIN</Badge>
        </div>
        <input
          type="password"
          placeholder="管理员密码"
          value={pwd}
          onChange={(e) => { setPwd(e.target.value); setError(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          style={{
            width: "100%", boxSizing: "border-box", marginTop: 24, height: 34,
            border: `1px solid ${error ? "var(--err-text)" : "var(--border)"}`, borderRadius: 7,
            padding: "0 12px", fontSize: 13, outline: "none", color: "var(--text)",
            background: "var(--bg)", font: "inherit",
          }}
        />
        {error && <div style={{ fontSize: 12, color: "var(--err-text)", marginTop: 6 }}>密码错误,还可尝试 3 次</div>}
        <GhostButton height={34} onClick={submit} style={{ width: "100%", marginTop: 12, fontSize: 13 }}>
          登录
        </GhostButton>
        <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-dim)", marginTop: 16 }}>
          连续失败 5 次将锁定 15 分钟
        </div>
      </div>
    </div>
  );
}
