// `web_search` 结果头(2026-09-07 修补;codex 复审 P1 收窄):可信度锚**只在带来源时给**。
// 网关偶发「有正文、无 grounding」(rounds/round-gsearch/verify.md),那种正文可能是综述模型凭记忆写的,
// 不能被一行「刚从公网检索到的事实、以此为准」盖章成实时信息;没有来源就明说没有来源,时间戳照给。
import { describe, expect, it } from "vitest";
import { webSearchResultHeader } from "./tools";

describe("webSearchResultHeader:检索时间 + 按有无来源分两种口径", () => {
  const AT = new Date("2026-09-06T17:04:00Z"); // 北京时间 2026-09-07 01:04,星期一
  const STAMP = "[实时检索 · 2026-09-07 01:04(北京时间 UTC+08:00,星期一)]";

  it("带来源:实时检索 + 「不符」不是判虚构的理由 + 带链接让访客核对;不说已核实 / 以来源为准", () => {
    const h = webSearchResultHeader(3, AT);
    expect(h.startsWith(STAMP)).toBe(true);
    expect(h).toContain("不是判它虚构的理由");
    expect(h).toContain("未逐条核验");
    expect(h).not.toContain("以来源为准");
    expect(h).not.toContain("没有带回任何可核对的来源");
    expect(h.endsWith("\n\n")).toBe(true);
  });

  it("无来源:同样带检索时间,但明说未经来源核实,不给「以此为准」的锚", () => {
    const h = webSearchResultHeader(0, AT);
    expect(h.startsWith(STAMP)).toBe(true);
    expect(h).toContain("没有带回任何可核对的来源");
    expect(h).toContain("不要当作已核实的事实");
    expect(h).not.toContain("不是判它虚构的理由");
    expect(h.endsWith("\n\n")).toBe(true);
  });

  it("不传时刻时用当前时间,形状不变", () => {
    expect(webSearchResultHeader(1)).toMatch(/^\[实时检索 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}\(北京时间 UTC\+08:00,星期[一二三四五六日]\)\] /);
  });
});
