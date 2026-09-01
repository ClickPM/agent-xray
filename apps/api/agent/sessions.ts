// R2:会话创建 / 续接 / 列表端点(ROUNDS.md R2 明文范围)。
// 对话流本身(POST /agent/ask SSE)是 R3,本文件不涉及。
//
// R-VISITOR:全部端点按访客归属过滤,并新增删除端点。约束来源 docs/security.md §6
// 的 R-VISITOR 补记。三条口径贯穿本文件:
//   1. 读路径只**认领**已有 cookie(`resolveVisitor`),从不发新的;只有会真的建会话的
//      `createSession` 用 `ensureVisitor`。理由见 visitor.ts 文件头。
//   2. 归属不匹配一律 `not_found`,不回 403 —— 403 等于确认「这个 id 存在」。
//   3. **成功**响应把 cookie 重发一次,24h 窗口靠这个滑动。
//      错误响应带不了 —— Encore 的 `APIError` 没有响应头这一层(实测,`api/error.ts` 里
//      没有任何 header 支持),要在 404/409 上重发就得把错误改成 200 加错误字段,那是
//      更糟的接口。实际影响可以忽略:工作台每次挂载与每轮对话结束都会调用会成功的
//      `listSessions`(`Workbench.tsx` 的 `refreshSessions`),真实访客的 cookie 一直在续。
//      仅当一个调用方**连续 24h 只收到错误响应**时,库里的身份还活着而浏览器那份已过期
//      —— 那是 curl/爬虫的形态,不是访客的。已记 BACKLOG(codex 复审 P2,写明理由不采纳)。
import { api, APIError, type Header, type Query } from "encore.dev/api";
// 副作用 import:启动保留期清理定时器(自托管镜像不执行 Encore CronJob,见 purge.ts)
import "./purge";
import { claim, disposeSession, getRuntimeSession, SessionBusyError } from "./runtime";
import * as store from "./store";
import { ensureVisitor, headersOfTyped, resolveVisitor } from "./visitor";

export interface SessionSummary {
  id: string;
  title: string;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  lastActiveAt: string;
}

export interface ChatMessage {
  seq: number;
  role: "user" | "assistant" | "tool";
  content: string;
  /** ISO 8601 */
  createdAt: string;
}

// 【关于下面每个响应接口里的 `visitorCookie: Header<string, "Set-Cookie">`】
//
// **这个类型必须逐处内联写全,不能抽成 `type VisitorCookie = Header<…>` 再复用。**
// 实测(encore 1.57.13 + bun):Encore 的静态解析器**不穿透类型别名**,一旦写成别名,
// 它就把这个字段当成普通响应体字段 —— 不发 `Set-Cookie` 头,而是把值序列化进 JSON。
// 用 `Cookie<>` 写别名时后果最严重,响应体会变成:
//
//     {"session":{…},"visitorCookie":{"httpOnly":true,"maxAge":86400,"value":"<明文 token>"}}
//
// 即:①浏览器没收到 Set-Cookie,访客身份永远建立不起来;②身份 token 明文进响应体,
// 页面里任何 JS 都读得到,`httpOnly:true` 成了一句写在 JSON 里的空话。
// **这是静默失败**:编译过、请求 200、字段也在,只有抓响应头才看得出来。
// 改动这几个字段之后必须实跑一次 `curl -i`(任务卡验收 #5)。
//
// 【为什么用 `Header<"Set-Cookie">` 而不是内联的 `Cookie<>`】两者内联时都工作正常
// (实测)。选前者是因为 cookie 属性只能有一个来源:`shared/visitor-cookie.ts` 的
// `buildSetCookie` —— 两条 `api.raw`(`/agent/ask`、`/trace/stream`)只能拼字符串,
// 用 `Cookie<>` 就等于让同一个 cookie 的属性在两处各写一遍,漂掉一个 `httpOnly`
// 在浏览器里是看不出来的(后一个 Set-Cookie 直接覆盖前一个)。

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toIso = (ms: number) => new Date(ms).toISOString();

function toSummary(row: store.SessionRow): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: toIso(row.createdAt),
    lastActiveAt: toIso(row.lastActiveAt),
  };
}

interface CreateSessionResponse {
  session: SessionSummary;
  visitorCookie: Header<string, "Set-Cookie">;
}

/**
 * 创建会话(标题留空,由首条用户消息派生)。
 *
 * **这是两个会发放新访客身份的地方之一**(另一个是 `/agent/ask` 建新会话时)。
 * 会话必然属于某个访客,所以这里用 `ensureVisitor` 而不是 `resolveVisitor`。
 */
export const createSession = api(
  {
    expose: true,
    method: "POST", path: "/agent/sessions",
    // 【R-VISITOR】访客 cookie 是**可冒充身份的凭据**,而 Encore 默认把请求头、响应头与
    // 处理函数的返回值原样写进 trace —— 三处都有明文 token(本轮实测,见任务卡)。
    // `sensitive: true` 把它们排除出 trace,与 R8 给 `/t` 加它是同一条理由:
    // 不设的话等于在承诺「凭据不外泄」的同时把它抄进了另一个地方(docs/security.md §6)。
    sensitive: true,
  },
  async (): Promise<CreateSessionResponse> => {
    const visitor = await ensureVisitor(headersOfTyped());
    return {
      session: toSummary(await store.createSession(visitor.id)),
      visitorCookie: visitor.setCookie,
    };
  },
);

interface ListSessionsRequest {
  /** 默认 50,上限 200 */
  limit?: Query<number>;
}

interface ListSessionsResponse {
  sessions: SessionSummary[];
  visitorCookie?: Header<string, "Set-Cookie">;
}

/**
 * 会话列表,按最近活跃倒序(工作台左栏)。**只有本访客的**。
 *
 * 没有可认领的 cookie 时返回空列表而不是错误:一个没建过会话的访客看到的
 * 就该是「一个空站点」,而不是「你未登录」——站点没有登录这个概念。
 */
export const listSessions = api(
  {
    expose: true,
    method: "GET", path: "/agent/sessions",
    // 访客 cookie 不能进 trace,理由见本文件 createSession 上方(docs/security.md §6)
    sensitive: true,
  },
  async (req: ListSessionsRequest): Promise<ListSessionsResponse> => {
    const limit = Math.min(Math.max(req.limit ?? 50, 1), 200);
    const visitor = await resolveVisitor(headersOfTyped());
    if (!visitor) return { sessions: [] };
    const rows = await store.listSessions(visitor.id, limit);
    return { sessions: rows.map(toSummary), visitorCookie: visitor.setCookie };
  },
);

interface GetSessionRequest {
  id: string;
}

interface GetSessionResponse {
  session: SessionSummary;
  /** 会话内历史消息,按 seq 有序(刷新后恢复对话) */
  messages: ChatMessage[];
  visitorCookie: Header<string, "Set-Cookie">;
}

/** 续接:单会话 + 历史消息回放。只能取到本访客自己的会话。 */
export const getSession = api(
  {
    expose: true,
    method: "GET", path: "/agent/sessions/:id",
    // 访客 cookie 不能进 trace,理由见本文件 createSession 上方(docs/security.md §6)
    sensitive: true,
  },
  async (req: GetSessionRequest): Promise<GetSessionResponse> => {
    if (!UUID_RE.test(req.id)) {
      throw APIError.invalidArgument("id must be a UUID");
    }
    const visitor = await resolveVisitor(headersOfTyped());
    // 没有身份 = 不拥有任何会话。与「会话不存在」同一个回答,不另设一档
    if (!visitor) throw APIError.notFound(`session ${req.id} not found`);
    const row = await store.getSession(req.id, visitor.id);
    if (!row) throw APIError.notFound(`session ${req.id} not found`);
    const messages = await store.listMessages(req.id);
    return {
      session: toSummary(row),
      messages: messages.map((m) => ({
        seq: m.seq,
        role: m.role,
        content: m.content,
        createdAt: toIso(m.createdAt),
      })),
      visitorCookie: visitor.setCookie,
    };
  },
);

interface DeleteSessionRequest {
  id: string;
}

interface DeleteSessionResponse {
  visitorCookie: Header<string, "Set-Cookie">;
}

/**
 * 删除本访客的一个会话(R-VISITOR;所有者裁定新增,设计稿没有这个入口)。
 *
 * 硬删,`messages` / `trace_events` 由外键级联清掉 —— 这是隐私功能,
 * 「删了但还在库里」不满足访客按下那个按钮时的预期(store.deleteSession)。
 *
 * 删不到(不存在 / 不是本访客的)一律 `not_found`:与 `getSession` 同一个口径,
 * 不让删除端点变成一个「这个 id 存在吗」的探测器。
 *
 * 【顺序敏感:先判归属,再动运行时会话,最后删库行】
 *   - 归属必须排在最前:否则任何人都能拿一个别人的 id 把对方内存里的 pi 会话 dispose 掉,
 *     那是一条不需要任何凭据的拒绝服务。
 *   - 运行时会话必须先 dispose 再删库行:`disposeSession` 会把在途轨迹**排干落库**,
 *     反过来做的话那次 flush 撞上已被级联删掉的 `sessions` 行,外键失败刷一屏错误日志。
 *   - 正在回复中一律拒绝而不是硬删:那一轮的助手消息正等着写进这张表,
 *     删了只会让访客看到一句「本轮回复未能保存」。回 409,与 `/agent/ask` 的并发口径一致。
 *
 * 【必须用 `claim()`,不能读一眼 `rec.busy` 就往下走】(codex 初审 P2)
 * `claim` 是**同步**的检查+置位,与 `/agent/ask` 用的是同一把闸:置位之后那个会话对
 * 逐出、空闲回收与并发 ask 都不可用。只读 `busy` 的话,另一个标签页的 ask 完全可以在
 * 「读到 false」与「dispose 完成」之间挤进来认领同一个会话,于是那一轮跑在一个正在被
 * 释放的 pi 会话上。认领失败 → 409,访客得到的是一句明确的「上一轮还在跑」。
 *
 * 认领**不需要在成功路径上释放**:`disposeSession` 之后这条记录已经退出注册表,
 * `busy` 跟着它一起消失;只有「认领成功但后续步骤抛错」才需要还回去(见下面的 try/catch)。
 */
export const deleteSession = api(
  {
    expose: true,
    method: "DELETE", path: "/agent/sessions/:id",
    // 访客 cookie 不能进 trace,理由见本文件 createSession 上方(docs/security.md §6)
    sensitive: true,
  },
  async (req: DeleteSessionRequest): Promise<DeleteSessionResponse> => {
    if (!UUID_RE.test(req.id)) {
      throw APIError.invalidArgument("id must be a UUID");
    }
    const visitor = await resolveVisitor(headersOfTyped());
    if (!visitor) throw APIError.notFound(`session ${req.id} not found`);
    if (!(await store.sessionOwnedBy(req.id, visitor.id))) {
      throw APIError.notFound(`session ${req.id} not found`);
    }

    const rec = getRuntimeSession(req.id);
    if (rec) {
      try {
        claim(rec);
      } catch (err) {
        if (err instanceof SessionBusyError) throw APIError.aborted("session is already streaming");
        throw err;
      }
      try {
        await disposeSession(rec);
      } catch (err) {
        rec.busy = false; // 认领了就要还:释放失败时不能把会话永久钉在 busy 上
        throw err;
      }
    }

    // 到这里还删不到只有一种可能:另一条请求刚把它删了。回 404 是诚实的答案。
    if (!(await store.deleteSession(req.id, visitor.id))) {
      throw APIError.notFound(`session ${req.id} not found`);
    }
    return { visitorCookie: visitor.setCookie };
  },
);
