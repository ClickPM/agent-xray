// 备案号占位(R8 = ICP;2026-09-10 补公安联网备案号)。
//
// 【为什么设计稿里没有它却要加】境内服务器绑域名必须 ICP 备案,备案通过后
// **网站底部必须挂备案号并链到工信部**(`docs/deploy-cn-lightweight.md` §1 第 6 步、
// 上线检查单「备案号已挂 footer」)。这属于 docs 里的部署约束,不是新功能
// ——CLAUDE.md 规则 8 明确「docs/ 的安全与部署要求是约束不是功能」。
//
// 【公安联网备案是第二个号,同一条约束】ICP 之外还要办公安联网备案(网站开通后
// 30 个工作日内),备案系统的格式要求是「备案编号图标在前,备案编号在右」且号码
// 链到公安部查询页。图标用备案系统「点击下载备案编号图标」下来的原文件
// `public/beian-mps.png`(36×40 PNG,一个字节都没改),号码同 ICP 走运行期 env。
// `docs/deploy-cn-lightweight.md` §1 第 6 步原本记着「当前 SiteFooter 只支持一个
// ICP 号,要挂第二个得改组件」——这次就是那次改动。
//
// 【为什么不会破坏画板】两个 env 都没配就整块不渲染。开发机、130 预发都不配,
// 各 Tab 的版式与画板一字不差;只有生产会多出这一条 26px 的底栏。规则 7 要求的
// 「写明理由与影响范围」即此:桌面上两个号并排在同一行,底栏仍是 26px;只有窄到
// 一行放不下(≲320px 的手机)时才折行、底栏随之变高——比把号码截掉好,
// 备案号**必须可见**(docs/deploy-cn-lightweight.md 的部署约束)。
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

/** 工信部备案查询入口,ICP 号必须链到这里。 */
const MIIT = "https://beian.miit.gov.cn/";

/** 公安部备案查询页。备案系统给的 HTML 代码形状是 `<这个地址>?code=<号码里的数字串>`
 *  ——`?code=` 挂在 `#` 后面是对的,那是 hash 路由自己的 query。 */
const MPS = "https://beian.mps.gov.cn/#/query/webSearch";

/** 公安备案编号图标(备案系统下载的原文件,36×40;这里按 18×20 显示 = 正好半尺寸,不变形)。 */
const MPS_ICON = "/beian-mps.png";

export async function SiteFooter() {
  await connection();
  const icp = process.env.ICP_BEIAN?.trim();
  const mps = process.env.MPS_BEIAN?.trim();
  if (!icp && !mps) return null;

  // 号码里的数字串就是查询用的 code(「苏公网安备32011402012723号」→ 32011402012723)。
  // 万一填成了取不到数字的东西,退到查询页首页:链接必须在,让访客自己搜也比没链接好。
  const code = mps?.match(/\d{6,}/)?.[0];
  const link = { ...mono(11), color: "var(--text-dim)", textDecoration: "none" };

  return (
    <div
      style={{
        flex: "none", minHeight: 26, display: "flex", alignItems: "center", justifyContent: "center",
        flexWrap: "wrap", columnGap: 14, rowGap: 2, padding: "0 10px",
        borderTop: "1px solid var(--border)", background: "var(--bg)", boxSizing: "border-box",
      }}
    >
      {icp ? (
        <a href={MIIT} target="_blank" rel="noreferrer" style={link}>
          {icp}
        </a>
      ) : null}
      {mps ? (
        <a
          href={code ? `${MPS}?code=${code}` : MPS}
          target="_blank"
          rel="noreferrer"
          style={{ ...link, display: "flex", alignItems: "center", gap: 5 }}
        >
          {/* 图标必须在号码左边(备案系统的格式要求);alt 留空 —— 号码就在它右边,图标是装饰 */}
          <img src={MPS_ICON} alt="" width={18} height={20} style={{ display: "block" }} />
          {mps}
        </a>
      ) : null}
    </div>
  );
}
