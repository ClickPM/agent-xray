// ICP 备案号占位(R8)。
//
// 【为什么设计稿里没有它却要加】境内服务器绑域名必须 ICP 备案,备案通过后
// **网站底部必须挂备案号并链到工信部**(`docs/deploy-cn-lightweight.md` §1 第 6 步、
// 上线检查单「备案号已挂 footer」)。这属于 docs 里的部署约束,不是新功能
// ——CLAUDE.md 规则 8 明确「docs/ 的安全与部署要求是约束不是功能」。
//
// 【为什么不会破坏画板】`ICP_BEIAN` 没配就整块不渲染。开发机、130 预发都不配,
// 三个 Tab 的版式与画板一字不差;只有生产(R11 备案通过后)会多出这一条 26px 的
// 底栏。规则 7 要求的「写明理由与影响范围」即此。
//
// 只在 Server Component 里读,所以不加 NEXT_PUBLIC_ 前缀:那个前缀意味着构建期
// 内联,而备案号要到部署时才有(与 lib/site.ts 的 SITE_ORIGIN 同理)。
//
// 【为什么要 await connection()】Runtime Tab(`/`)是静态页,不加这一句的话
// 本组件会在 `next build` 期间被预渲染,`process.env.ICP_BEIAN` 于是被**烧进
// 构建产物**——而镜像是不可变制品、预发与生产共用同一个 SHA(规则 10),
// 备案号只可能在部署期由 compose 注入。表现会是:配了 ICP_BEIAN 也不显示,
// 且只在 `/` 上不显示(Notes/About 是 force-dynamic,它们正常)。
// `connection()` 把这次渲染推到请求期,env 才是运行期的值。
import { connection } from "next/server";
import { mono } from "@/lib/styles";

/** 工信部备案查询入口,备案号必须链到这里。 */
const MIIT = "https://beian.miit.gov.cn/";

export async function SiteFooter() {
  await connection();
  const beian = process.env.ICP_BEIAN?.trim();
  if (!beian) return null;

  return (
    <div
      style={{
        flex: "none", height: 26, display: "flex", alignItems: "center", justifyContent: "center",
        borderTop: "1px solid var(--border)", background: "var(--bg)", boxSizing: "border-box",
      }}
    >
      <a
        href={MIIT}
        target="_blank"
        rel="noreferrer"
        style={{ ...mono(11), color: "var(--text-dim)", textDecoration: "none" }}
      >
        {beian}
      </a>
    </div>
  );
}
