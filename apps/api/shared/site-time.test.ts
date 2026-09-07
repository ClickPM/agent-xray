// `siteNowLabel` 是给模型看的「现在」(2026-09-07 修补:系统提示的时间基准段与 web_search 的结果头)。
// 这里钉住三件事:固定 +08:00(跨 UTC 日界时日期按站点时区算)、精确到分、星期对得上;
// 以及日期部分与 `siteDay` 字字一致 —— 两处若各算各的,统计面板与模型看到的「今天」就会在跨日附近错开。
import { describe, expect, it } from "vitest";
import { siteDay, siteDayAgo, siteNowLabel } from "./site-time";

describe("siteNowLabel:站点时区下给模型看的「现在」", () => {
  it("固定 +08:00、精确到分、带星期;跨 UTC 日界时按站点时区算日期", () => {
    // 2026-09-06 17:04:59 UTC → 北京时间 2026-09-07 01:04,星期一
    expect(siteNowLabel(new Date("2026-09-06T17:04:59Z"))).toBe("2026-09-07 01:04(北京时间 UTC+08:00,星期一)");
    expect(siteNowLabel(new Date("2026-09-07T03:30:00Z"))).toBe("2026-09-07 11:30(北京时间 UTC+08:00,星期一)");
    // 整点零分与星期日两个边界
    expect(siteNowLabel(new Date("2026-09-12T16:00:00Z"))).toBe("2026-09-13 00:00(北京时间 UTC+08:00,星期日)");
  });

  it("日期部分与 siteDay 字字一致(同一套偏移算法)", () => {
    const at = new Date("2026-12-31T16:30:00Z"); // 北京时间已是 2027-01-01
    expect(siteNowLabel(at).slice(0, 10)).toBe(siteDay(at));
    expect(siteDay(at)).toBe("2027-01-01");
    expect(siteDayAgo(0, at)).toBe(siteDay(at));
  });

  it("不传时刻时用当前时间,形状不变", () => {
    expect(siteNowLabel()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\(北京时间 UTC\+08:00,星期[一二三四五六日]\)$/);
  });
});
