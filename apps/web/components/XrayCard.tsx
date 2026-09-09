"use client";

// R-CARDS:助手正文里的信息卡片(画板 2s / 2t 桌面,4y / 4z 移动)。
//
// **这是第二种卡,不是第三种视觉语言**(画板 2s 裁定):工具卡 = 「agent 做了什么」,信息卡 = 「agent 给你看什么」。
// 外框一律照 2m 的卡片展开体(r6 + `--bg-subtle` 底 + 1px `--border` 描边),与工具卡的唯一区别是描边用中性色、
// 不用状态色;**卡里一处不用语义色** —— 数据里没有「红 = 差」这种字段,染色就是编造。
// 表格照 2c 的 markdown 表格,标题行照展开体的 INPUT / RESULT 小标题,tabs 照 2c 顶栏导航那枚胶囊单选组,
// 动作按钮照 2g 的 `GitHub ↗` ghost 按钮,骨架照 2i。**没有一处新造的 token**。
//
// 数据只从 `lib/xray-card.ts` 校验过的 `CardSpec` 来,所有值都当纯文本(React 转义),没有 dangerouslySetInnerHTML、
// 没有表达式求值、没有外部资源(`docs/security.md` §0 第 11 条)。四种交互(tabs / 折叠 / 排序 / 单选切面板)
// 都是本组件里的本地状态:不产生事件、不落库、刷新回初始态(任务卡派生取舍 8)。**三种都不做动画** ——
// 现有三个动效语义都是「还在跑」,拿来做切换会撒谎(画板 2s)。
//
// 移动端(4y / 4z)的差别只有触控 / 换行 / 横滚,写在 globals.css 的 `.xcard-*` 规则里:
//   - 宽度驱动的几条(`compare` 堆叠、`stat` 两列、表格不折行、kv 键列 104)按**卡内宽**判,用 `@container`(画板 4y 的规则边界是
//     「A / B 列各 ≥ 160 即卡内宽 ≥ 480 时不堆叠」,它说的是卡的宽度、不是视口),但整块只在移动壳里生效 —— 桌面卡片照桌面画板;
//   - 触控语汇(44 命中、胶囊按钮、SegmentedControl)跟移动壳走,用 `@media (max-width: 768px)`。
// 内核 token(字号 / 行高 / 颜色)两端一字不改。
//
// **R-CARDS-2(画板 2u / 5a):两种可回传 kind `choice` / `form`,「这不是第三种卡」** —— 长在同一套信息卡语汇上,唯一新增的两个形状是
// 选择指示(单选 15px 圆点 / 多选 15px r4 方框,常态 1px `--border` + 白底,选中态描边与填充换 `--accent`,多选内嵌 9px 白色对勾)。
// 出口是**发送**而不是预填(`docs/security.md` §0 第 12 条):发出的文本由 `lib/xray-card.ts` 的两个 compose 函数组成、只由可见文本拼成;
// **触发只认 React onClick**(选项行 / submit 按钮;键盘 Enter / Space 走同一 handler),渲染 / 滚动 / hover / 聚焦都不发;
// 一轮生成中(`busy`)禁用;发过即锁(本地状态,刷新回初始态)。两种态都不做动画。
import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { GhostButton } from "@/components/ui";
import { Bar } from "@/components/Skeleton";
import { useComposer } from "@/components/ComposerContext";
import { mono } from "@/lib/styles";
import {
  composeChoiceMessage,
  composeFormMessage,
  formComplete,
  isMonoColumn,
  sortRows,
  CARD_LIMITS,
  type CardSpec,
  type ChoiceBody,
  type CompareBody,
  type FormBody,
  type KvBody,
  type LeafBody,
  type ListBody,
  type StatBody,
  type TableBody,
  type TabsBody,
} from "@/lib/xray-card";

/** 卡片外框 = 2m 展开体(r6 + 淡底 + 中性描边);marginTop 14 是会话区节奏,与代码块 / 表格同一档 */
const frame: CSSProperties = {
  background: "var(--bg-subtle)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  overflow: "hidden",
  marginTop: 14,
  // `@container` 的度量根:卡内宽 = 这个盒子的内容宽(globals.css 里的 `.xcard` 只补 container-type,不写别的)
  minWidth: 0,
};

/** 标题行文字 = INPUT / RESULT 那一枚:mono 10/600 `--text-dim` 0.08em */
const caption: CSSProperties = { ...mono(10, 600), color: "var(--text-dim)", letterSpacing: "0.08em" };

/** 12px 折叠箭头,与 2l 折叠行 / 工具卡是同一枚:› 收起 / ˅ 展开 */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}
    >
      <polyline points={open ? "6 9 12 15 18 9" : "9 6 15 12 9 18"} />
    </svg>
  );
}

/** 表头排序箭头(画板 2s / 2t:10px,当前列品牌色;降 ˅ / 升 ˄) */
function SortArrow({ direction }: { direction: "asc" | "desc" }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}
    >
      <polyline points={direction === "desc" ? "6 9 12 15 18 9" : "18 15 12 9 6 15"} />
    </svg>
  );
}

const cellText: CSSProperties = { fontSize: 13, lineHeight: 1.6, color: "var(--text)" };
const cellMuted: CSSProperties = { fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" };
const rowSep = (i: number): CSSProperties => (i === 0 ? {} : { borderTop: "1px solid var(--border)" });

/** 主体上沿:有标题行时紧贴(标题行自带 8px 下留白),没有时给 10 —— 标题行可选,主体不能因此顶到描边 */
const bodyTop = (hasTitle: boolean) => (hasTitle ? 0 : 10);

function Kv({ body, hasTitle }: { body: KvBody; hasTitle: boolean }) {
  return (
    <div style={{ padding: `${bodyTop(hasTitle)}px 12px 12px`, display: "flex", flexDirection: "column" }}>
      {body.rows.map((r, i) => (
        <div key={i} className="xcard-kv-row" style={{ display: "grid", gridTemplateColumns: "150px minmax(0,1fr)", gap: 12, padding: "5px 0", ...rowSep(i) }}>
          <div style={cellMuted}>{r.k}</div>
          <div style={{ ...cellText, textWrap: "pretty" } as CSSProperties}>{r.v}</div>
        </div>
      ))}
    </div>
  );
}

function List({ body, hasTitle }: { body: ListBody; hasTitle: boolean }) {
  return (
    <div style={{ padding: `${bodyTop(hasTitle)}px 12px 12px`, display: "flex", flexDirection: "column", gap: 7 }}>
      {body.items.map((it, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "22px minmax(0,1fr)", alignItems: "baseline", gap: 2 }}>
          <span style={{ ...mono(13), color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
            {body.ordered ? `${i + 1}.` : "·"}
          </span>
          <div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text)", textWrap: "pretty" } as CSSProperties}>{it.text}</div>
            {it.note !== undefined && (
              <div style={{ fontSize: 11, lineHeight: 1.6, color: "var(--text-dim)", marginTop: 1, textWrap: "pretty" } as CSSProperties}>{it.note}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * stat:2–4 格一排,格间用表格那条 1px 竖分隔(首格不画)。移动端两列网格与它的分隔规则在 globals.css
 * (`.xcard-stat` 的容器查询),这里只给桌面的一排。
 */
function Stat({ body, hasTitle }: { body: StatBody; hasTitle: boolean }) {
  return (
    <div className="xcard-stat" style={{ display: "grid", gridTemplateColumns: `repeat(${body.items.length}, 1fr)` }}>
      {body.items.map((it, i) => (
        <div
          key={i}
          className="xcard-stat-cell"
          style={{ padding: `${hasTitle ? 2 : 10}px 12px 12px`, boxSizing: "border-box", ...(i === 0 ? {} : { borderLeft: "1px solid var(--border)" }) }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span style={{ ...mono(22, 650), color: "var(--text)", letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" }}>{it.value}</span>
            {it.unit !== undefined && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{it.unit}</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--text)", marginTop: 3 }}>{it.label}</div>
          {it.note !== undefined && (
            <div style={{ fontSize: 11, lineHeight: 1.6, color: "var(--text-dim)", marginTop: 2, textWrap: "pretty" } as CSSProperties}>{it.note}</div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * table:全出血 —— 表格的外框就是卡片的描边,不再套第二层 border(画板 2s:套了会出双线)。
 * `sortable` 时点表头排序(字符串序、数值感知、稳定),当前排序列整格品牌色 + 10px 箭头,列宽与行高不随排序变。
 * 移动端把单元格 nowrap、在 `.xcard-scroll` 里横滚(画板 4y:内容超出卡片右缘直接裁切,页面不横滚)。
 */
function Table({ body }: { body: TableBody }) {
  const [sort, setSort] = useState<{ column: number; direction: "asc" | "desc" } | null>(null);
  const rows = sort ? sortRows(body.rows, sort.column, sort.direction) : body.rows;
  const monoCols = body.columns.map((_, i) => isMonoColumn(body.rows, i));
  const toggle = (column: number) =>
    setSort((s) => (s?.column === column ? { column, direction: s.direction === "desc" ? "asc" : "desc" } : { column, direction: "desc" }));
  return (
    <div className="xcard-scroll" style={{ overflowX: "auto", borderTop: "1px solid var(--border)" }}>
      <table className="xcard-table" style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead style={{ background: "var(--bg-panel)" }}>
          <tr>
            {body.columns.map((c, i) => {
              const active = sort?.column === i;
              const head = (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  {c}
                  {active && sort && <SortArrow direction={sort.direction} />}
                </span>
              );
              return (
                <th
                  key={i}
                  scope="col"
                  className={body.sortable ? "xcard-th-sortable" : undefined}
                  aria-sort={active ? (sort!.direction === "asc" ? "ascending" : "descending") : undefined}
                  onClick={body.sortable ? () => toggle(i) : undefined}
                  // 画板 2s:非当前排序列常态正文色、hover 才转品牌色;当前列由 style 定死,不参与 hover
                  onMouseEnter={body.sortable && !active ? (e) => { e.currentTarget.style.color = "var(--accent)"; } : undefined}
                  onMouseLeave={body.sortable && !active ? (e) => { e.currentTarget.style.color = "var(--text)"; } : undefined}
                  style={{
                    textAlign: "left", fontSize: 13, fontWeight: 600, padding: "8px 12px", whiteSpace: "nowrap",
                    borderBottom: "1px solid var(--border)", color: active ? "var(--accent)" : "var(--text)",
                    cursor: body.sortable ? "pointer" : undefined, userSelect: body.sortable ? "none" : undefined,
                  }}
                >
                  {head}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: "8px 12px", verticalAlign: "top", color: "var(--text)",
                    ...(ri === 0 ? {} : { borderTop: "1px solid var(--border)" }),
                    ...(monoCols[ci] ? { ...mono(13), fontVariantNumeric: "tabular-nums" } : { fontSize: 13, lineHeight: 1.6 }),
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * compare:3 列(维度 / A / B),首列次级色。移动端在卡内宽 < 480 时上下堆叠(画板 4y ②屏):
 * 表头隐藏、每行变成「维度一行 + A / B 各一行」,列名降级成行内 mono 10 小标题 —— 那两枚小标题
 * **始终在 DOM 里**(桌面由 CSS 藏起来),这样堆叠与否只是 CSS 的事,回放与实时的 DOM 逐字节相同。
 */
function Compare({ body, hasTitle }: { body: CompareBody; hasTitle: boolean }) {
  const [a, b] = body.columns;
  const head: CSSProperties = { fontSize: 13, fontWeight: 600, padding: "8px 12px" };
  const label: CSSProperties = { ...caption, lineHeight: 1.9 };
  return (
    <div className="xcard-compare" style={{ paddingTop: bodyTop(hasTitle) }}>
      <div
        className="xcard-cmp-head"
        style={{
          display: "grid", gridTemplateColumns: "150px minmax(0,1fr) minmax(0,1fr)", background: "var(--bg-panel)",
          borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ ...head, color: "var(--text-muted)" }}>维度</div>
        <div style={head}>{a}</div>
        <div style={head}>{b}</div>
      </div>
      <div className="xcard-cmp-rows">
        {body.rows.map((r, i) => (
          <div key={i} className="xcard-cmp-row" style={{ display: "grid", gridTemplateColumns: "150px minmax(0,1fr) minmax(0,1fr)", ...rowSep(i) }}>
            <div className="xcard-cmp-dim" style={{ ...cellMuted, padding: "8px 12px" }}>{r.k}</div>
            <div className="xcard-cmp-cell" style={{ ...cellText, padding: "8px 12px", textWrap: "pretty" } as CSSProperties}>
              <span className="xcard-cmp-label" style={label}>{a}</span>
              <span>{r.a}</span>
            </div>
            <div className="xcard-cmp-cell" style={{ ...cellText, padding: "8px 12px", textWrap: "pretty" } as CSSProperties}>
              <span className="xcard-cmp-label" style={label}>{b}</span>
              <span>{r.b}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * tabs:胶囊单选组,取 2c 顶栏导航那一枚(容器 `--bg-panel` + 1px 描边 + r7 + 2px 内边距;
 * 选中 = `--bg` 底 + 1px 描边 + r5 + 600),**唯一改动是选中文字换品牌色**(画板 2s 裁定:卡内没有导航语义,
 * 需要一个「当前是哪一页」的强指示)。切页只换主体,标题行 / 胶囊组位置 / 卡底不动。
 * 移动端换成 4e 的 SegmentedControl 皮(globals.css `.xcard-tabs`),选中态不套品牌色(画板 4y 裁定)。
 */
function Tabs({ body, hasTitle, renderLeaf }: { body: TabsBody; hasTitle: boolean; renderLeaf: (leaf: LeafBody) => ReactNode }) {
  const [active, setActive] = useState(0);
  const current = body.tabs[Math.min(active, body.tabs.length - 1)];
  return (
    <>
      <div className={hasTitle ? "xcard-tabs-wrap" : "xcard-tabs-wrap xcard-tabs-wrap-notitle"} style={{ padding: `${hasTitle ? 2 : 10}px 12px 10px` }}>
        <div
          role="tablist"
          className="xcard-tabs"
          style={{ display: "inline-flex", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 7, padding: 2, gap: 2 }}
        >
          {body.tabs.map((t, i) => {
            const on = i === active;
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={on}
                className="xcard-tab"
                onClick={() => setActive(i)}
                onMouseEnter={(e) => { if (!on) e.currentTarget.style.color = "var(--accent)"; }}
                onMouseLeave={(e) => { if (!on) e.currentTarget.style.color = "var(--text-muted)"; }}
                style={{
                  fontFamily: "inherit", fontSize: 12, fontWeight: on ? 600 : 400, padding: "4px 14px", borderRadius: 5,
                  background: on ? "var(--bg)" : "transparent", color: on ? "var(--accent)" : "var(--text-muted)",
                  borderWidth: 1, borderStyle: "solid", borderColor: on ? "var(--border)" : "transparent",
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      {/* 页身当作「有标题行」来画:上方紧贴胶囊组,胶囊组已经留了 10px */}
      {renderLeaf(current.card)}
    </>
  );
}

/** 题干(画板 2u:13/1.7 次级色,压在标题行下、选项之上;没有标题行时自己给上留白) */
function Prompt({ text, hasTitle }: { text: string | undefined; hasTitle: boolean }) {
  if (text === undefined) return null;
  return <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text-muted)", padding: `${hasTitle ? 0 : 10}px 12px 9px`, textWrap: "pretty" } as CSSProperties}>{text}</div>;
}

/** 选择指示:单选圆点 / 多选方框(画板 2u「唯一新增的两个形状」) */
function Indicator({ on, multiple }: { on: boolean; multiple: boolean }) {
  const box: CSSProperties = {
    width: 15, height: 15, flex: "none", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: multiple ? 4 : "50%", border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
    background: multiple && on ? "var(--accent)" : "var(--bg)",
  };
  return (
    <span className="xcard-ind" style={box} aria-hidden="true">
      {multiple ? (
        on && (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )
      ) : (
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? "var(--accent)" : "transparent" }} />
      )}
    </span>
  );
}

/** 键盘可达:Enter / Space 走与 onClick 同一个 handler(`docs/security.md` §0 第 12 条:只由访客的一次点击触发) */
function keyActivate(e: KeyboardEvent<HTMLElement>, fn: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
}

/**
 * choice(画板 2u 标本①–④ / 5a):单选点选项即发送、没有按钮;多选靠卡底 submit。三种态:
 *   idle —— 全部可点、hover 露一档底色;busy(上一轮还在生成)—— 全部禁用、label 降到 `--text-dim`;
 *   locked(已发送)—— 已选高亮保留、未选 label 降到 `--text-dim`、不可再点、按钮回到禁用视觉、文案不变。
 * 三个都是本地状态(`sent` / `selected`),刷新回初始态。`onSend` 不传时按 busy 画(没有发送通路就没有可点的选项)。
 */
function Choice({ body, hasTitle, busy, onSend, footerLinks }: { body: ChoiceBody; hasTitle: boolean; busy: boolean; onSend?: (text: string) => void; footerLinks: ReactNode }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [sent, setSent] = useState(false);
  const disabled = busy || sent || onSend === undefined;
  const pick = (i: number) => {
    if (disabled) return;
    if (body.multiple) {
      setSelected((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
      return;
    }
    // 单选:点选项即发送并锁定(画板 2u:少一次点击,也少一个「选了但没提交」的中间态)
    setSelected([i]);
    setSent(true);
    onSend!(composeChoiceMessage(body, [i]));
  };
  const submit = () => {
    if (disabled || selected.length === 0) return;
    setSent(true);
    onSend!(composeChoiceMessage(body, selected));
  };
  const idle = !disabled;
  return (
    <>
      <Prompt text={body.prompt} hasTitle={hasTitle} />
      <div role={body.multiple ? "group" : "radiogroup"} aria-disabled={disabled || undefined}>
        {body.options.map((o, i) => {
          const on = selected.includes(i);
          return (
            <div
              key={i}
              className="xcard-opt"
              role={body.multiple ? "checkbox" : "radio"}
              aria-checked={on}
              aria-disabled={disabled || undefined}
              tabIndex={disabled ? -1 : 0}
              onClick={() => pick(i)}
              onKeyDown={(e) => keyActivate(e, () => pick(i))}
              onMouseEnter={idle ? (e) => { e.currentTarget.style.background = "rgba(0,0,0,0.02)"; } : undefined}
              onMouseLeave={idle ? (e) => { e.currentTarget.style.background = "transparent"; } : undefined}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 12px", borderTop: "1px solid var(--border)",
                cursor: idle ? "pointer" : "default", userSelect: "none", outlineOffset: -2,
              }}
            >
              <span className="xcard-ind-wrap" style={{ display: "flex", flex: "none", marginTop: 2 }}>
                <Indicator on={on} multiple={body.multiple} />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: idle || on ? "var(--text)" : "var(--text-dim)" }}>{o.label}</div>
                {o.note !== undefined && (
                  <div style={{ fontSize: 11, lineHeight: 1.6, color: "var(--text-dim)", marginTop: 1, textWrap: "pretty" } as CSSProperties}>{o.note}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {(body.multiple || footerLinks !== null) && (
        <div className="xcard-foot" style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
          {footerLinks}
          <div className="xcard-spacer" style={{ flex: 1 }} />
          {body.multiple && (
            <GhostButton className="xcard-submit" height={32} style={{ padding: "0 14px" }} disabled={disabled || selected.length === 0} onClick={submit}>
              {body.submit}
            </GhostButton>
          )}
        </div>
      )}
    </>
  );
}

/** 输入框 = 1a 底部那一枚的缩小版(画板 2u:1px `--border`、r7、32 高、13px,聚焦描边转品牌色);锁定态底色降一档、不可点 */
const fieldBox: CSSProperties = {
  display: "block", width: "100%", height: 32, boxSizing: "border-box", background: "var(--bg)", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 7, padding: "0 10px", fontFamily: "inherit", fontSize: 13, outline: "none",
};

/**
 * form(画板 2u 标本⑤–⑥ / 5a):1–5 个字段,text 输入框 `maxLength = 100`(浏览器按 UTF-16 单位计,与解析期那把尺相同),
 * select 收起态值走 placeholder 次级色;全部 required 非空前 submit 禁用;发出后字段 `disabled`、值保留、按钮回禁用视觉。
 */
function Form({ body, hasTitle, busy, onSend, footerLinks }: { body: FormBody; hasTitle: boolean; busy: boolean; onSend?: (text: string) => void; footerLinks: ReactNode }) {
  const [values, setValues] = useState<string[]>(() => body.fields.map(() => ""));
  const [sent, setSent] = useState(false);
  const disabled = busy || sent || onSend === undefined;
  const set = (i: number, v: string) => setValues((vs) => vs.map((x, j) => (j === i ? v : x)));
  const submit = () => {
    if (disabled || !formComplete(body, values)) return;
    setSent(true);
    onSend!(composeFormMessage(body, values));
  };
  const lockedBox: CSSProperties = sent ? { background: "rgba(0,0,0,0.02)", cursor: "default" } : {};
  return (
    <>
      <Prompt text={body.prompt} hasTitle={hasTitle} />
      <div style={{ padding: `${hasTitle || body.prompt !== undefined ? 0 : 10}px 12px 12px`, display: "flex", flexDirection: "column", gap: 10 }}>
        {body.fields.map((f, i) => (
          <label key={i} className="xcard-field" style={{ display: "block" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}>{f.label}</span>
              {f.required && <span style={{ ...mono(10), color: "var(--text-dim)" }}>必填</span>}
            </div>
            {f.type === "select" ? (
              <select
                className="xcard-input"
                value={values[i]}
                disabled={disabled}
                onChange={(e) => set(i, e.target.value)}
                style={{ ...fieldBox, ...lockedBox, color: values[i] === "" ? "var(--text-dim)" : "var(--text)", cursor: disabled ? "default" : "pointer" }}
              >
                <option value="">{f.placeholder ?? "请选择"}</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                className="xcard-input"
                type="text"
                value={values[i]}
                disabled={disabled}
                maxLength={CARD_LIMITS.textInput}
                placeholder={f.placeholder}
                onChange={(e) => set(i, e.target.value)}
                onFocus={(e) => { if (!disabled) e.currentTarget.style.borderColor = "var(--accent)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
                style={{ ...fieldBox, ...lockedBox }}
              />
            )}
          </label>
        ))}
      </div>
      <div className="xcard-foot" style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
        {footerLinks}
        <div className="xcard-spacer" style={{ flex: 1 }} />
        <GhostButton className="xcard-submit" height={32} style={{ padding: "0 14px" }} disabled={disabled || !formComplete(body, values)} onClick={submit}>
          {body.submit}
        </GhostButton>
      </div>
    </>
  );
}

function Leaf({ body, hasTitle }: { body: LeafBody; hasTitle: boolean }) {
  switch (body.kind) {
    case "kv":
      return <Kv body={body} hasTitle={hasTitle} />;
    case "list":
      return <List body={body} hasTitle={hasTitle} />;
    case "stat":
      return <Stat body={body} hasTitle={hasTitle} />;
    case "table":
      return <Table body={body} />;
    case "compare":
      return <Compare body={body} hasTitle={hasTitle} />;
  }
}

/**
 * 一张信息卡。`onAsk` = R-CROSSLINK 的预填原语(把 `action.ask` 放进输入框、永不自动发送);
 * 不传时**动作按钮整个不渲染**(任务卡验收 #8:没有预填通路就没有这枚按钮)。
 *
 * R-CARDS-2:两种可回传 kind 的发送通路(`onSend`,容器里的 `sendFromCard`,经既有 composer 的发送函数)与 `busy`(一轮生成中,
 * 与 composer 发送按钮同一判据、同一禁用视觉)从 `ComposerContext` 读,不走 props(理由见那个文件)。既有六种卡的路径一字不差。
 */
export function XrayCard({ spec, onAsk }: { spec: CardSpec; onAsk?: (text: string) => void }) {
  const { busy, onSend } = useComposer();
  const [open, setOpen] = useState(!spec.collapsed);
  const hasTitle = spec.title !== undefined;
  const collapsible = spec.collapsed; // 只有初始折叠的卡才有把手(画板 2s / 2t 段③-3:成对的收起 / 展开态)
  const sendable = spec.kind === "choice" || spec.kind === "form";
  const footer = !sendable && (spec.links.length > 0 || (spec.action !== undefined && onAsk !== undefined));
  // 可回传的卡自己画卡底(submit 与链接同一行),链接部分与既有卡底同一块标记
  const links =
    spec.links.length > 0 ? (
      <div className="xcard-links" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
        {spec.links.map((l, i) =>
          l.external ? (
            <a key={i} href={l.href} target="_blank" rel="noreferrer noopener" style={{ fontSize: 13, color: "var(--accent)" }}>
              {l.text} ↗
            </a>
          ) : (
            <a key={i} href={l.href} rel="noreferrer noopener" style={{ fontSize: 13, color: "var(--accent)" }}>
              {l.text}
            </a>
          ),
        )}
      </div>
    ) : null;
  const body =
    spec.kind === "tabs" ? (
      <Tabs body={spec} hasTitle={hasTitle} renderLeaf={(leaf) => <Leaf body={leaf} hasTitle />} />
    ) : spec.kind === "choice" ? (
      <Choice body={spec} hasTitle={hasTitle} busy={busy} onSend={onSend} footerLinks={links} />
    ) : spec.kind === "form" ? (
      <Form body={spec} hasTitle={hasTitle} busy={busy} onSend={onSend} footerLinks={links} />
    ) : (
      <Leaf body={spec} hasTitle={hasTitle} />
    );
  return (
    <div className="xcard" style={frame} data-xray-card={spec.kind}>
      {hasTitle &&
        (collapsible ? (
          <div
            className="xcard-head xcard-head-toggle"
            role="button"
            aria-expanded={open}
            tabIndex={0}
            onClick={() => setOpen((o) => !o)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.02)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", cursor: "pointer", userSelect: "none" }}
          >
            <Chevron open={open} />
            <span style={caption}>{spec.title}</span>
          </div>
        ) : (
          <div className="xcard-head" style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px 8px" }}>
            <span style={caption}>{spec.title}</span>
          </div>
        ))}
      {open && body}
      {open && footer && (
        <div className="xcard-foot" style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
          {links}
          <div className="xcard-spacer" style={{ flex: 1 }} />
          {spec.action !== undefined && onAsk !== undefined && (
            <GhostButton className="xcard-action" height={32} style={{ padding: "0 14px" }} onClick={() => onAsk(spec.action!.ask)}>
              {spec.action.label}
            </GhostButton>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 正在到达的卡(画板 2t 段① / 4z ①屏):围栏已开、未闭合期间显示。卡框先立住(它就是最终卡的外框,
 * 所以一开始就用最终态的 r6),里面一条标题骨架条(r6)+ 三条正文骨架条(r4)—— **不预测行数**,
 * 因为 kind 与行数都还没读到。骨架色叠在灰面上降一档取 `--border`(2i 规则),`omPulseBg` 只挂标题条一处锚点。
 */
export function XrayCardSkeleton() {
  return (
    <div className="xcard" style={frame} data-xray-card="skeleton" aria-busy="true">
      <div style={{ padding: "9px 12px 8px" }}>
        <Bar w={210} h={12} radius={6} tone="onGrey" pulse style={{ maxWidth: "100%" }} />
      </div>
      <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 9 }}>
        <Bar w="100%" h={11} tone="onGrey" />
        <Bar w="100%" h={11} tone="onGrey" />
        <Bar w="62%" h={11} tone="onGrey" />
      </div>
    </div>
  );
}
