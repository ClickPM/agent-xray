// R-CARDS:会话区信息卡片的 DSL —— 围栏文本 → `CardSpec | null`(画板 2s / 2t / 4y / 4z)。
//
// 这是 `docs/security.md` §0 第 11 条的**第一道也是唯一一道**边界:模型输出第一次绕过 markdown 渲染器
// 直接变成 DOM 结构,兜底在「闭集」—— JSON → 字段白名单 → React 元素,所有值都当纯文本(React 转义),
// `kind` 六种闭集,行 / 列 / 字数 / 嵌套深度全部有上界,**任一不符整卡回落**(回 null,渲染器画普通代码块)。
// 没有表达式求值、没有模型给的 HTML / JS、没有外部资源;链接口径与 markdown 相同。
//
// **纯函数、零依赖、不 import React**:`bun test lib` 直接钉住每一条上限与口径(任务卡验收 #1)。
// 两条与「整卡回落」不同的宽松处理,写在这里免得看代码时以为是漏了:
//   - **不认识的字段丢弃**(任务卡交付物一栏原话):模型多写一个 `"icon"` 不该让访客看到裸 JSON;
//   - **单条链接不合口径只丢那一条**(派生取舍 3):`javascript:` 是要挡的,但挡它不需要毁掉整张卡。
// 其余一律严格:类型不对、超限、空表、tabs 里套 tabs、行长与列数不等 —— 都是 null。

export const CARD_KINDS = ["kv", "table", "list", "stat", "compare", "tabs"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** 任务卡派生取舍 2 的上限,任一超限整卡回落 */
export const CARD_LIMITS = {
  /** 围栏原文(UTF-8 字节) */
  fenceBytes: 8 * 1024,
  /** `rows` / `items` 条数 */
  rows: 20,
  /** `table` 列数 */
  columns: 6,
  /** `tabs` 页数 */
  tabs: 5,
  /** 普通字符串字段的字符数 */
  text: 200,
  /** `title` 字符数 */
  title: 60,
  /** 卡底链接条数 */
  links: 5,
  /** `action.ask` 字符数 */
  ask: 500,
  /** `stat` 格数区间(画板 2s:2–4 格一排) */
  statMin: 2,
  statMax: 4,
  /** 链接地址的字符数(与 R-CROSSLINK 的 URL 上限同量级;超出丢该条链接) */
  href: 2048,
} as const;

export interface CardLink {
  text: string;
  href: string;
  /** `http(s)://` 站外链接:画板 2s「`↗` 只给站外」,并带 `rel="noreferrer noopener"` */
  external: boolean;
}

export interface CardAction {
  label: string;
  /** 点击后放进输入框的那句话(R-CROSSLINK 预填原语,永不自动发送) */
  ask: string;
}

export interface KvBody {
  kind: "kv";
  rows: { k: string; v: string }[];
}
export interface TableBody {
  kind: "table";
  columns: string[];
  /** 每行长度 === columns.length(不等整卡回落,不补空、不截断) */
  rows: string[][];
  sortable: boolean;
}
export interface ListBody {
  kind: "list";
  ordered: boolean;
  items: { text: string; note?: string }[];
}
export interface StatBody {
  kind: "stat";
  items: { label: string; value: string; unit?: string; note?: string }[];
}
export interface CompareBody {
  kind: "compare";
  /** A / B 两方的列名;首列「维度」由渲染器画,不在数据里 */
  columns: [string, string];
  rows: { k: string; a: string; b: string }[];
}
export interface TabsBody {
  kind: "tabs";
  tabs: { label: string; card: LeafBody }[];
}

/** tabs 里每页装的那张卡:五种主体之一,没有标题 / 卡底 / 折叠(它们属于外层 tabs 卡) */
export type LeafBody = KvBody | TableBody | ListBody | StatBody | CompareBody;
export type CardBody = LeafBody | TabsBody;

export type CardSpec = CardBody & {
  title?: string;
  /** 初始折叠(画板 2s 的收起态)。只在有 `title` 时成立:标题行是收起态唯一的把手 */
  collapsed: boolean;
  links: CardLink[];
  action?: CardAction;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 读一个字符串字段。`required` 缺省时缺字段 / 空串都回 undefined(调用方决定要不要);
 * 类型不对或超长回 **null** —— 与 undefined 区分开,null 让整卡回落。
 *
 * 有限数字放行并转成字符串:`"value": 34` 这种写法模型几乎一定会写(stat 卡的数字),
 * 它仍然是纯文本,没有理由为此让访客看裸 JSON。布尔 / null / 对象不转 —— 那不是「值」。
 */
function str(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return null;
  if (v.length > max) return null;
  return v;
}

/** 必填字符串:缺、空、类型不对、超长都回 null */
function req(v: unknown, max: number = CARD_LIMITS.text): string | null {
  const s = str(v, max);
  return s === undefined || s === null || s === "" ? null : s;
}

/** 可选字符串:缺 / 空 → undefined(不渲染);类型不对、超长 → null(整卡回落) */
function opt(v: unknown, max: number = CARD_LIMITS.text): string | null | undefined {
  const s = str(v, max);
  return s === "" ? undefined : s;
}

/** 可选布尔:缺 → 默认;不是布尔 → null(整卡回落) */
function bool(v: unknown, fallback: boolean): boolean | null {
  if (v === undefined) return fallback;
  return typeof v === "boolean" ? v : null;
}

/** 非空数组且条数在 [min, max] 内,否则 null */
function arr(v: unknown, min: number, max: number): unknown[] | null {
  return Array.isArray(v) && v.length >= min && v.length <= max ? v : null;
}

/** 站内路径解析用的假基址:只用来问「解析后还在不在同一个源」,不会出现在任何 href 里 */
const SAME_ORIGIN_PROBE = "https://xray.invalid";

/**
 * 链接口径 = markdown 的(任务卡派生取舍 3;`lib/external.ts` 的 `safeExternal` 是同一套协议判断):
 * `http(s)://` 且有主机名,或以 `/` 开头且**解析后仍在本源**的站内路径。
 * 其余(`javascript:` / `data:` / `mailto:` / 不带 `/` 的相对路径 / 超长)回 null,调用方**丢该条**。
 *
 * 【站内路径为什么要真的解析一遍,不能只看前两个字符】`//evil` 是协议相对地址,谁都知道要挡;
 * 但 WHATWG URL 对 http(s) 这类 special scheme 把反斜杠**当正斜杠**,`/\evil.com` 解析出来同样是 `https://evil.com/` ——
 * 只判 `startsWith("//")` 就放过了它。所以拿一个假基址解析,`origin` 变了就不是站内。
 */
export function cardHref(raw: unknown): { href: string; external: boolean } | null {
  if (typeof raw !== "string" || raw === "" || raw.length > CARD_LIMITS.href) return null;
  if (raw.startsWith("/")) {
    let resolved: URL;
    try {
      resolved = new URL(raw, SAME_ORIGIN_PROBE);
    } catch {
      return null;
    }
    return resolved.origin === SAME_ORIGIN_PROBE ? { href: raw, external: false } : null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hostname === "") return null;
  return { href: raw, external: true };
}

function parseLinks(v: unknown): CardLink[] | null {
  if (v === undefined) return [];
  const list = arr(v, 0, CARD_LIMITS.links);
  if (!list) return null;
  const out: CardLink[] = [];
  for (const item of list) {
    if (!isObj(item)) return null;
    const text = req(item.text);
    if (text === null) return null;
    const target = cardHref(item.href);
    if (!target) continue; // 只丢这一条
    out.push({ text, ...target });
  }
  return out;
}

function parseAction(v: unknown): CardAction | null | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) return null;
  const label = req(v.label);
  const ask = req(v.ask, CARD_LIMITS.ask);
  if (label === null || ask === null) return null;
  return { label, ask };
}

/** 六种主体各自的字段白名单;不认识的字段在这里自然被丢掉(只读点名的键) */
function parseBody(o: Obj, allowTabs: boolean): CardBody | null {
  switch (o.kind) {
    case "kv": {
      const rows = arr(o.rows, 1, CARD_LIMITS.rows);
      if (!rows) return null;
      const out: KvBody["rows"] = [];
      for (const r of rows) {
        if (!isObj(r)) return null;
        const k = req(r.k);
        const v = req(r.v);
        if (k === null || v === null) return null;
        out.push({ k, v });
      }
      return { kind: "kv", rows: out };
    }
    case "table": {
      const columns = arr(o.columns, 1, CARD_LIMITS.columns);
      const rows = arr(o.rows, 1, CARD_LIMITS.rows);
      const sortable = bool(o.sortable, false);
      if (!columns || !rows || sortable === null) return null;
      const cols: string[] = [];
      for (const c of columns) {
        const s = req(c);
        if (s === null) return null;
        cols.push(s);
      }
      const out: string[][] = [];
      for (const r of rows) {
        if (!Array.isArray(r) || r.length !== cols.length) return null;
        const cells: string[] = [];
        for (const c of r) {
          // 单元格允许空串(表格里空格子是常态),但类型与长度照旧
          const s = str(c, CARD_LIMITS.text);
          if (s === undefined || s === null) return null;
          cells.push(s);
        }
        out.push(cells);
      }
      return { kind: "table", columns: cols, rows: out, sortable };
    }
    case "list": {
      const items = arr(o.items, 1, CARD_LIMITS.rows);
      const ordered = bool(o.ordered, false);
      if (!items || ordered === null) return null;
      const out: ListBody["items"] = [];
      for (const it of items) {
        if (!isObj(it)) return null;
        const text = req(it.text);
        const note = opt(it.note);
        if (text === null || note === null) return null;
        out.push(note === undefined ? { text } : { text, note });
      }
      return { kind: "list", ordered, items: out };
    }
    case "stat": {
      const items = arr(o.items, CARD_LIMITS.statMin, CARD_LIMITS.statMax);
      if (!items) return null;
      const out: StatBody["items"] = [];
      for (const it of items) {
        if (!isObj(it)) return null;
        const label = req(it.label);
        const value = req(it.value);
        const unit = opt(it.unit);
        const note = opt(it.note);
        if (label === null || value === null || unit === null || note === null) return null;
        out.push({ label, value, ...(unit !== undefined && { unit }), ...(note !== undefined && { note }) });
      }
      return { kind: "stat", items: out };
    }
    case "compare": {
      const columns = arr(o.columns, 2, 2);
      const rows = arr(o.rows, 1, CARD_LIMITS.rows);
      if (!columns || !rows) return null;
      const a = req(columns[0]);
      const b = req(columns[1]);
      if (a === null || b === null) return null;
      const out: CompareBody["rows"] = [];
      for (const r of rows) {
        if (!isObj(r)) return null;
        const k = req(r.k);
        const va = str(r.a, CARD_LIMITS.text);
        const vb = str(r.b, CARD_LIMITS.text);
        // 对比里某一方空着是合法信息(「无对应接口」通常就写成空),所以 a / b 允许空串
        if (k === null || va === undefined || va === null || vb === undefined || vb === null) return null;
        out.push({ k, a: va, b: vb });
      }
      return { kind: "compare", columns: [a, b], rows: out };
    }
    case "tabs": {
      if (!allowTabs) return null; // tabs 里不能再套 tabs(嵌套深度上界)
      const tabs = arr(o.tabs, 1, CARD_LIMITS.tabs);
      if (!tabs) return null;
      const out: TabsBody["tabs"] = [];
      for (const t of tabs) {
        if (!isObj(t) || !isObj(t.card)) return null;
        const label = req(t.label);
        const card = parseBody(t.card, false);
        if (label === null || card === null || card.kind === "tabs") return null;
        out.push({ label, card });
      }
      return { kind: "tabs", tabs: out };
    }
    default:
      return null; // 未知 kind
  }
}

/**
 * 围栏文本 → 卡片。null = 回落成普通代码块(画板 2t 段②:没有错误提示,原文还在)。
 *
 * `v` 必填且等于 1(任务卡派生取舍 1):以后改形状时旧卡不会被新解析器误读。
 */
export function parseCard(raw: string): CardSpec | null {
  // 字节上限按**围栏原文**算,先于 trim(codex 第 1 轮 P2):trim 之后再量,一段小 JSON 前后垫任意空白就能绕过上限
  if (utf8Length(raw) > CARD_LIMITS.fenceBytes) return null;
  const text = raw.trim();
  if (text === "") return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(json) || json.v !== 1) return null;
  const body = parseBody(json, true);
  if (!body) return null;
  const title = opt(json.title, CARD_LIMITS.title);
  const collapsed = bool(json.collapsed, false);
  const links = parseLinks(json.links);
  const action = parseAction(json.action);
  if (title === null || collapsed === null || links === null || action === null) return null;
  return {
    ...body,
    ...(title !== undefined && { title }),
    // 没有标题行就没有把手,折叠态无从打开 —— 这一位不生效,卡照常展开画(画板 2s:collapsed 卡的标题行不可省)
    collapsed: collapsed && title !== undefined,
    links,
    ...(action !== undefined && { action }),
  };
}

/** UTF-8 字节数(浏览器与 bun 都有 TextEncoder;这里不引 Buffer,lib 要在两边跑) */
function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * 「围栏还没闭合」的判据(画板 2t 段①:未闭合显示骨架、闭合后才换成卡或回落代码块;
 * codex 第 1 轮 P2:**闭合之前即使 JSON 已经完整也不能画卡**,流结束了仍没闭合的按代码块)。
 *
 * 入参是渲染器从 hast 拿到的开围栏所在**行号**(1 起,remark 的 position)。用行号不用 offset:
 * `remarkDollarGuard` 重解析时只往源码里插反斜杠、不增减行,行号在两边对得上,offset 对不上。
 * 从那一行往后找一行**独立的闭围栏**:同种记号、长度不短于开围栏、行上只有它(CommonMark 闭围栏规则);
 * 找不到 = 未闭合。行首允许任意空白与 `>`:卡片写在列表项 / 引用块里时,容器前缀会跟着每一行,
 * 而 JSON 里不会出现一整行只有反引号,放宽不会误判。
 *
 * 开围栏那一行本身不是围栏(理论上到不了:缩进代码块没有 info string)时当作**已闭合** ——
 * 宁可少画一次骨架,也不把一张闭合的卡压成骨架。
 *
 * 早先用「代码正文是整篇正文的后缀」判,闭合的卡后面若正好跟着同样的文字会误判成未闭合;按行号找闭围栏没有这个洞。
 */
export function fenceUnterminated(source: string, openerLine: number): boolean {
  const lines = source.split(/\r?\n/);
  const opener = /^[\s>]*(`{3,}|~{3,})/.exec(lines[openerLine - 1] ?? "");
  if (!opener) return false;
  const mark = opener[1][0];
  const len = opener[1].length;
  for (let i = openerLine; i < lines.length; i++) {
    const m = /^[\s>]*(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
    if (m && m[1][0] === mark && m[1].length >= len) return false;
  }
  return true;
}

/**
 * 表头排序用的比较器(画板 2s:「按入参上限降序」—— 300 / 128 / 120 / 64 / 60,是**数值感知**的字符串序,
 * 纯字典序会把 "64" 排到 "300" 前面)。`sensitivity: "base"` 让大小写与重音不参与,结果稳定。
 * 排序本身是纯前端状态,刷新回初始行序(任务卡派生取舍 8)。
 */
const collator = new Intl.Collator("zh", { numeric: true, sensitivity: "base" });
export function compareCells(a: string, b: string): number {
  return collator.compare(a, b);
}

/** 稳定排序:同值保持原行序(`Array.prototype.sort` 自 ES2019 起稳定,这里再显式带上下标兜底) */
export function sortRows(rows: string[][], column: number, direction: "asc" | "desc"): string[][] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => {
      const c = compareCells(x.row[column] ?? "", y.row[column] ?? "");
      return (direction === "asc" ? c : -c) || x.index - y.index;
    })
    .map((x) => x.row);
}

/**
 * 表格里「数字列走 mono tabular」(画板 2s 裁定)的判据:一列里每个非空格子都以数字开头
 * (允许正负号 / 货币符号),或者都长得像标识符(`web_search` 这种无空格的 ASCII 词 —— 画板上工具名那一列就是 mono)。
 * 只影响字体,判错的代价是一列字体不同,不影响数据。
 */
export function isMonoColumn(rows: string[][], column: number): boolean {
  let seen = false;
  for (const row of rows) {
    const cell = (row[column] ?? "").trim();
    if (cell === "") continue;
    seen = true;
    if (!/^[+\-$¥€£]?\d/.test(cell) && !/^[A-Za-z_][A-Za-z0-9_.\-:/]*$/.test(cell)) return false;
  }
  return seen;
}
