"use client";

import { useEffect, useRef, useState, Fragment, type CSSProperties } from "react";
import { askWhyText } from "@/lib/ask-why";
import { barWidth, barWidthPct } from "@/lib/trace-view";
import type { CrossLink, TraceRow, TraceRowDetail, TraceTurn } from "@/lib/types";
import { mono } from "@/lib/styles";

/**
 * 进行中行的「从左向右」波浪扫光。keyframes 在 app/globals.css(omWaveSweep)。
 *
 * `row.streaming` 由 `toTimelineTurns(events, streaming)` 给出,而那个 streaming
 * 是 Workbench 的整轮状态:从点发送到 askStream 结束(finally)之间恒为 true。
 * 动画本身是 infinite,所以**这一轮没结束之前波浪一直在走**,不会自己停。
 *
 * 两处用同一条 keyframe、同一个周期,行背景与时长条同相位(demo 方案 E)。
 * 时长条的高光取白色而不是品牌蓝:条的底色是事件模式色(notify 灰 / chain 蓝 /
 * veto 红 / takeover 黄),白色高光对四种底色都是「提亮」,蓝色高光会把红黄两种
 * 染脏、在蓝底上又几乎看不见。
 */
const WAVE_PERIOD = "1.8s";

const waveRow: CSSProperties = {
  backgroundColor: "rgba(37,99,235,0.05)",
  backgroundImage:
    "linear-gradient(90deg, rgba(37,99,235,0) 0%, rgba(37,99,235,0.16) 50%, rgba(37,99,235,0) 100%)",
  backgroundSize: "200% 100%",
  backgroundRepeat: "no-repeat",
  animation: `omWaveSweep ${WAVE_PERIOD} linear infinite`,
};

const waveBar: CSSProperties = {
  backgroundImage:
    "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0) 100%)",
  backgroundSize: "200% 100%",
  backgroundRepeat: "no-repeat",
  animation: `omWaveSweep ${WAVE_PERIOD} linear infinite`,
};

/**
 * 详情卡右上那两条链接的画法(画板 1b / 2q 注释)。**一个像素也没新造**:
 * 「查看卡片 ↗」直接复制 `Ask why ↗` 的画法(11px 品牌色 + r5 + padding 2/6 +
 * hover 露 `--bg-hover` + 尾部 ↗),两条并排、间距 6、右对齐,**Ask why 永远在最右**
 * (它是既有元素,位置不该因为多了一条链接而移动)。
 *
 * 注意这里用的是 11px **系统字**而不是 mono —— 1b 里那枚角标本来就是系统字,
 * 本组件照 1b 抄,不照 token 表里的「mono 11」抄,以免两处漂移(画板 2q 注释原话)。
 */
const linkStyle = {
  color: "var(--accent)", fontSize: 11, borderRadius: 5, padding: "2px 6px",
  cursor: "pointer", background: "none", border: "none", whiteSpace: "nowrap",
} as const;

function DetailLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      style={linkStyle}
      onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
    >
      {label}
    </button>
  );
}

function DetailCard({
  detail,
  compact,
  onAskWhy,
  onLocateCard,
}: {
  detail: TraceRowDetail;
  compact?: boolean;
  /** R-CROSSLINK C1:点了把一句追问放进输入框(不弹层、不自动发送);始终存在 */
  onAskWhy: () => void;
  /**
   * R-CROSSLINK C2 行 → 卡:只有 `tool_call` 行、且 `toolCallId` 能在当前会话里
   * 找到那张卡时才给;对不上就是 undefined,整条链接不渲染(不画禁用态、不弹「定位失败」)。
   */
  onLocateCard?: () => void;
}) {
  return (
    <div
      style={{
        position: "relative", background: "var(--bg-subtle)", border: "1px solid var(--border)",
        borderRadius: 6, padding: "10px 12px",
        // 移动端左缩进 18(桌面 20):按 8px 节奏与 390 的行内缩进对齐(画板 4f)
        margin: compact ? "4px 0 8px 18px" : "4px 0 8px 20px",
      }}
    >
      {/* R-MOBILE(画板 4f):桌面这枚是 absolute 在右上角、靠 hover 露出的角标。
          移动端没有 hover,而且角标会压住 INPUT 第一行 —— 改成 INPUT 同排右侧的
          次按钮胶囊(44 命中)。**它是既有功能,不是新增。**
          R-CROSSLINK:桌面这里从一条变两条(见 DetailLink 上方注释);移动端**仍只有 Ask why 这一枚胶囊** ——
          详情块内宽只有约 308,两枚胶囊会把 INPUT 挤到 148、一条命令连开头都露不出来(画板 4w 裁定),
          「查看卡片」因此下沉到块底部一行链接,与会话区那条「在 Timeline 里查看 ↗」互为镜像。 */}
      {compact ? (
        <button
          className="m-tap"
          style={{
            position: "absolute", top: 6, right: 8, color: "var(--accent)",
            fontSize: 13, fontWeight: 600, height: 30, borderRadius: 15,
            padding: "0 12px", background: "var(--m-fill)", border: "none",
          }}
          onClick={onAskWhy}
          title="把一句追问放进输入框"
        >
          Ask why ↗
        </button>
      ) : (
        <div style={{ position: "absolute", top: 6, right: 8, display: "flex", alignItems: "center", gap: 6 }}>
          {onLocateCard && <DetailLink label="查看卡片 ↗" onClick={onLocateCard} />}
          <DetailLink label="Ask why ↗" onClick={onAskWhy} />
        </div>
      )}
      <div style={{ ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.06em", marginBottom: 3 }}>INPUT</div>
      <div className={compact ? "m-xscroll m-payload" : undefined} style={{ ...mono(11), lineHeight: 1.6, color: "var(--text)" }}>{detail.input}</div>
      <div style={{ ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.06em", margin: "10px 0 3px" }}>
        EXTENSION RETURNED · <span style={{ color: "var(--accent)" }}>{detail.extension}</span>
      </div>
      <div className={compact ? "m-xscroll m-payload" : undefined} style={{ ...mono(11), lineHeight: 1.6, color: "var(--text)" }}>{detail.returned}</div>
      <div style={{ ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.06em", margin: "10px 0 3px" }}>DIFF</div>
      <div className={compact ? "m-xscroll m-payload" : undefined} style={{ ...mono(11), lineHeight: 1.6, color: "var(--ok-text)" }}>{detail.diff}</div>
      {/* 移动端的「查看卡片」(画板 4w):块底部一行 mono 11 品牌色链接,
          44 命中靠上下 padding 补,**行高 mono 11/1.6 一字不改** ——
          展开体里所有正文共用这个行高,单独抬高它会破坏那一栏的节奏。 */}
      {compact && onLocateCard && (
        <button
          className="m-tap"
          onClick={onLocateCard}
          style={{
            ...mono(11), color: "var(--accent)", minHeight: 44, boxSizing: "border-box",
            padding: "13px 0 10px", display: "flex", alignItems: "center", whiteSpace: "nowrap",
            background: "none", border: "none",
          }}
        >
          查看卡片 ↗
        </button>
      )}
    </div>
  );
}

function Row({
  row,
  turnLabel,
  expanded,
  onToggle,
  compact,
  onAskWhy,
  cardLink,
}: {
  row: TraceRow;
  /** 追问文案里的「在 {Turn 2} 里…」;行本身不带它,由所属 turn 传下来 */
  turnLabel: string;
  expanded: boolean;
  onToggle?: () => void;
  compact?: boolean;
  onAskWhy?: (text: string) => void;
  cardLink?: CrossLink;
}) {
  const selectable = !!row.expandable;
  // R-CROSSLINK C2:「查看卡片」只在这个 toolCallId 在当前会话里真的能找到那张卡时出现;
  // 对不上整条不渲染(画板 2q / 1b 裁定)。「只在 tool_call 行」由 `toolCallId` 本身保证 ——
  // 投影只给那一种行(见 lib/trace-view.ts),这里不再判一次 eventType,免得两处口径漂移。
  const cardId =
    row.toolCallId !== undefined && cardLink?.has(row.toolCallId) ? row.toolCallId : undefined;
  return (
    <>
      <div
        data-row-key={row.key}
        onClick={selectable ? onToggle : undefined}
        // 内核层行高 26 是刻意的密度(照搬桌面);命中区靠 ::after 上下各外扩 9px
        // 补到 44,**不改变布局**(画板 4e 裁定:视觉密度与触控尺寸分开算)
        className={compact && selectable ? "m-row-tap" : undefined}
        style={{
          display: "grid",
          // R-MOBILE(画板 4e):移动端把弹性列**换到名字上**、色条固定 32%。
          // 桌面那套 `200px 1fr 52px` 在 390 宽下会让名字占死 200、色条几乎没地方。
          // 多出来的 8px 首列是模式色点:色条最窄只有 3px,光靠它读不出模式色。
          gridTemplateColumns: compact ? "8px minmax(0,1fr) 32% 40px" : "200px 1fr 52px",
          alignItems: "center",
          gap: compact ? 8 : 10,
          padding: compact ? "7px 4px" : "3px 4px",
          borderRadius: 4,
          // 底色用 backgroundColor 而不是 background 简写:波浪那几条是 background-*
          // 长写,简写与长写混着用,streaming 翻回 false 时 React 会报
          // 「Removing a style property … when a conflicting property is set」。
          // 尾行每来一个新事件就翻一次,那条警告会一直刷。
          backgroundColor: expanded ? "rgba(37,99,235,0.06)" : "transparent",
          // 进行中的行盖掉上面那句静态底色(同名长写,后者赢)。展开态与进行中
          // 同时成立时以波浪为准:「还在跑」比「已选中」更需要被看见。
          ...(row.streaming ? waveRow : null),
          cursor: selectable ? "pointer" : "default",
        }}
      >
        {compact && (
          <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: row.color }} />
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", overflow: "hidden" }}>
          {selectable && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={expanded ? "var(--accent)" : "var(--text-dim)"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "none" : "rotate(-90deg)", transition: "transform 0.12s", flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
          <span style={{ ...mono(11, expanded ? 600 : 400), color: expanded ? "var(--accent)" : "var(--text)" }}>{row.name}</span>
          {row.hasBadge && (
            <span style={{ ...mono(10, 600), background: "var(--err-text)", color: "#fff", borderRadius: 4, padding: "1px 5px" }}>blocked</span>
          )}
        </div>
        <div style={{ minWidth: 0, overflow: "hidden" }}>
          <div
            style={{
              height: 10, borderRadius: 2, maxWidth: "100%",
              width: compact ? barWidthPct(row.ms) : barWidth(row.ms),
              backgroundColor: row.color, // 同上:不能写 background 简写
              ...(row.streaming ? waveBar : null),
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.dur}</div>
      </div>
      {row.hasNote && (
        <div style={{ ...mono(11), color: "var(--err-text)", padding: "1px 4px 3px 22px" }}>
          {/* 画板 1a 的注记格式不变;扩展名从事件的 handlers 取(R-SKILLS-2),不再写死 permission-gate */}
          └ {row.blockedBy ?? "xray-guard"} returned {"{"}block: true{"}"}
        </div>
      )}
      {expanded && row.detail && (
        <DetailCard
          detail={row.detail}
          compact={compact}
          onAskWhy={() => onAskWhy?.(askWhyText(row, turnLabel))}
          {...(cardId !== undefined && { onLocateCard: () => cardLink?.go(cardId) })}
        />
      )}
    </>
  );
}

/** DevTools 式事件瀑布(画板 1a/1b),消费 /trace/stream 的真实事件投影 */
export function TimelineView({
  turns,
  compact,
  onExpand,
  onAskWhy,
  cardLink,
  locate,
}: {
  turns: TraceTurn[];
  compact?: boolean;
  /**
   * R-MOBILE(画板 4f):某一行**展开**时通知外层。移动端的运行时面板是 Sheet,
   * medium 档只有 ~50% 屏高,详情块加三段 payload 在里面只剩两行可见 ——
   * 所以展开的同时把 Sheet 升到 large。收起时不回落(读者可能还想看别的行)。
   */
  onExpand?: () => void;
  /** R-CROSSLINK C1:Ask why 点击 —— 把拼好的一句追问交给外层放进输入框 */
  onAskWhy?: (text: string) => void;
  /** R-CROSSLINK C2 行 → 卡:`has` 决定链接渲不渲染,`go` 去会话区定位那张卡 */
  cardLink?: CrossLink;
  /**
   * R-CROSSLINK C2 卡 → 行:外层要求定位到某一行。`nonce` 是「又点了一次」的信号 ——
   * 同一行连点两次时 `key` 不变,没有它就不会再滚一次。
   */
  locate?: { key: string; nonce: number } | null;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 「贴底跟随」开关。用 ref 不用 state:它每次滚动事件都会重算,进 state 会让整条
  // 瀑布(最多 MAX_TRACE_EVENTS 行)跟着重渲染一次。
  const stuck = useRef(true);

  // 新事件到达就跟到底部 —— **但只在用户本来就贴着底时跟**。不加这个条件的话,
  // 用户往上翻查某一行时会被每一帧新事件一路拽回底部,等于没法看历史事件。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stuck.current) return;
    // 直接赋 scrollTop,不用 scrollTo({behavior:"smooth"}):流式期间事件是逐帧到的,
    // 平滑动画会被下一次调用不断打断,表现是永远追不上底部还一直在抖。
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  /**
   * R-CROSSLINK C2(画板 2q / 4w):「定位」= **既有展开态 + 滚入视野**,没有第三种状态 ——
   * 不新增高亮色、不加「已定位」徽标、滚动不画动效(现有三个动效都是「还在跑」的语义)。
   *
   * 【必须解除贴底跟随】否则下一个事件一到,上面那个 effect 就把刚滚进视野的行拽回底部,
   * 定位等于没发生(任务卡验收 #5)。用户滚回底部时 onScroll 会把它恢复回来。
   *
   * 【滚两次,且不用 requestAnimationFrame】第一次在 effect 里立刻滚(此时行本身已在 DOM 里);
   * 第二次挂 `setTimeout(…, 0)`,补上「这一帧才挂载」的情形 —— 移动端这个组件装在 Sheet 里,
   * Sheet 关着时它压根没挂载(Sheet 的 `if (!open) return null`),被定位打开的那一次是「挂载 + 定位」同一帧。
   * **不用 rAF**:页面不可见时 rAF 根本不回调(本机验收实测:Browser pane 隐藏着,行展开了却没滚),
   * 而定位这件事对「可见性」没有依赖 —— 它要的是「DOM 好了就滚」,那是 setTimeout 的语义。
   */
  useEffect(() => {
    if (!locate) return;
    setExpandedKey(locate.key);
    stuck.current = false;
    const scroll = () =>
      scrollRef.current?.querySelector(`[data-row-key="${locate.key}"]`)?.scrollIntoView({ block: "center" });
    scroll();
    const timer = setTimeout(scroll, 0);
    return () => clearTimeout(timer);
  }, [locate]);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        // 24px 容差:行高不是整数,scrollTop 也可能是小数,严格贴底几乎不成立。
        // 用户往上滚一点就脱离跟随,再滚回底部自动恢复跟随。
        stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
      }}
      style={{ flex: 1, overflow: "auto", padding: "10px 14px" }}
    >
      {turns.map((turn) => {
        const rows = turn.rows;
        if (rows.length === 0) return null;
        return (
          <Fragment key={turn.label}>
            <div
              style={{
                ...mono(11, 600), color: "var(--text-muted)", letterSpacing: "0.05em",
                padding: "4px 0 6px", borderBottom: "1px solid var(--border)", marginBottom: 6,
                marginTop: turn.label === "Turn 1" ? 0 : 14,
              }}
            >
              {turn.label}
            </div>
            {rows.map((row) => {
              const key = row.key;
              return (
                <Row
                  key={key}
                  row={row}
                  turnLabel={turn.label}
                  onAskWhy={onAskWhy}
                  cardLink={cardLink}
                  expanded={expandedKey === key}
                  onToggle={() =>
                    setExpandedKey((cur) => {
                      const next = cur === key ? null : key;
                      if (next !== null) onExpand?.();
                      return next;
                    })
                  }
                  compact={compact}
                />
              );
            })}
          </Fragment>
        );
      })}
    </div>
  );
}
