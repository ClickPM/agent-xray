// 站点时区下的「自然日」(R8)。
//
// 【为什么要有这个共享模块】访问统计的写入方是 metrics 服务(`POST /t` 按天累加
// 计数行),读取方是 mcp 服务的统计 tools(按天切区间)。两边对「今天是哪天」
// 必须字字一致 —— 否则近 30 天的区间会在跨日附近错开一天,而这种错位既不报错
// 也不好复现。按 CLAUDE.md 的既定分工,跨服务共用的中立原语放 `shared/`
// (与 shared/redact、shared/trace-bus 同理),不跨服务 import 内部实现。
//
// 【为什么不用 Postgres 的 CURRENT_DATE】那取的是数据库会话的时区(容器默认 UTC),
// 而落库的 day 是站点时区算出来的 —— 混用两个「今天」正是上面那种错位的来源。
// 现在唯一的时间源在 JS 侧,SQL 只收一个已经算好的日期参数。

/**
 * 站点时区偏移(分钟)。**固定 +08:00,不做成配置项。**
 *
 * 用 UTC 切天的话,所有者早上 8 点前看到的「今天」是昨天 —— 一个自己看的
 * 统计面板上,这种偏移只会制造误读。用 `Intl` 按 IANA 时区算又要依赖容器里
 * 有完整 ICU 数据;而中国自 1991 年起没有夏令时,固定偏移在这里是精确的,
 * 不是近似。站点若将来面向别的时区,改这一个常量即可(并同步统计 tool 输出的
 * `timezone` 字段)。
 */
const SITE_TZ_OFFSET_MIN = 8 * 60;

/** 统计结果里回给所有者的时区标注,免得那些日期被按 UTC 读。 */
export const SITE_TZ_LABEL = "UTC+08:00";

/** 某一时刻归属的自然日,`YYYY-MM-DD`(与 `visits.day` 这一 DATE 列对齐)。 */
export function siteDay(at: Date = new Date()): string {
  return new Date(at.getTime() + SITE_TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** 星期几的中文名,索引与 `Date.prototype.getUTCDay()` 一致(0 = 星期日)。 */
const WEEKDAY_ZH = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const;

/**
 * 站点时区下的「现在」,给**模型**看的人话:`2026-09-07 15:04(北京时间 UTC+08:00,星期一)`。
 *
 * 【用途】进 agent 的系统提示(时间基准段)与 `web_search` 的结果头(2026-09-07 修补)。
 * 模型没有时钟,它的「现在」默认等于训练截止,于是把当年的赛事、版本与新闻判成「尚未发生」,
 * 再把联网检索回来的事实当成虚构 —— Gemini 系模型换上当天就复现,发版记录里也记过一次同款。
 * 精确到分钟即可;与 `siteDay` 同一套固定偏移算法(理由见上),不引入 Intl。
 */
export function siteNowLabel(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() + SITE_TZ_OFFSET_MIN * 60_000);
  // 平移之后的 ISO 串读作站点本地时间:`2026-09-07T07:04:05.123Z` → 日期 + `HH:mm`
  const iso = shifted.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}(北京时间 ${SITE_TZ_LABEL},${WEEKDAY_ZH[shifted.getUTCDay()]})`;
}

/**
 * 从今天往回数 `days` 天的那一天(`days = 0` 即今天)。
 *
 * 直接做毫秒减法而不是改 Date 的日期字段:固定偏移 + 无夏令时,
 * 一天恒等于 86400000 毫秒,这里不存在「某天只有 23 小时」的情况。
 */
export function siteDayAgo(days: number, now: Date = new Date()): string {
  return siteDay(new Date(now.getTime() - days * 86_400_000));
}
