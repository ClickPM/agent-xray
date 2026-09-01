// R-VISITOR 验收:cookie 口径(纯函数)、身份认领与滑动续期(库)、保留期清理。
// 约束来源 docs/security.md §6 的 R-VISITOR 补记;经 `dev.ps1 test` 运行(规则 2)。
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { appendMessage, createSession, getSession, listMessages } from "./store";
import { ensureVisitor, resolveVisitor, type Visitor } from "./visitor";
import { purgeExpired, SESSION_RETENTION_DAYS } from "./purge";
import {
  buildSetCookie,
  hashVisitorToken,
  isSecureRequest,
  newVisitorToken,
  readVisitorCookie,
  VISITOR_COOKIE,
  VISITOR_TTL_SECONDS,
} from "../shared/visitor-cookie";

const NO_HEADERS = { cookie: undefined, proto: undefined };
const cookieHeaderFor = (v: Visitor) => ({
  cookie: `${VISITOR_COOKIE}=${v.token}`,
  proto: undefined,
});

beforeEach(async () => {
  await db.exec`DELETE FROM sessions`;
  await db.exec`DELETE FROM visitors`;
});

describe("cookie 口径(纯函数)", () => {
  it("只认自己的键,并挡掉形状不合法的值", () => {
    const token = newVisitorToken();
    expect(readVisitorCookie(`${VISITOR_COOKIE}=${token}`)).toBe(token);
    // 与别的 cookie 混在一起、带空格、顺序靠后都要认得出
    expect(readVisitorCookie(`a=1; ${VISITOR_COOKIE}=${token} ; b=2`)).toBe(token);
    expect(readVisitorCookie(undefined)).toBeNull();
    expect(readVisitorCookie("")).toBeNull();
    expect(readVisitorCookie("other=x")).toBeNull();
    // 前缀相同的另一个 cookie 名不能被误认
    expect(readVisitorCookie(`${VISITOR_COOKIE}_x=${token}`)).toBeNull();
    // 形状白名单:长度越界与非法字符一律 null(不设上界的话它会带着进 sha256 与索引查询)
    expect(readVisitorCookie(`${VISITOR_COOKIE}=short`)).toBeNull();
    expect(readVisitorCookie(`${VISITOR_COOKIE}=${"a".repeat(65)}`)).toBeNull();
    expect(readVisitorCookie(`${VISITOR_COOKIE}=abcdefghijklmnop!`)).toBeNull();
  });

  it("同名 cookie 出现多次时取第一个合法的", () => {
    const token = newVisitorToken();
    expect(readVisitorCookie(`${VISITOR_COOKIE}=bad; ${VISITOR_COOKIE}=${token}`)).toBe(token);
  });

  it("Set-Cookie 属性齐全;Secure 跟着 X-Forwarded-Proto 走", () => {
    const token = newVisitorToken();
    const insecure = buildSetCookie(token, false);
    expect(insecure).toContain(`${VISITOR_COOKIE}=${token}`);
    expect(insecure).toContain("Path=/");
    expect(insecure).toContain(`Max-Age=${VISITOR_TTL_SECONDS}`);
    expect(insecure).toContain("HttpOnly");
    expect(insecure).toContain("SameSite=Lax");
    // 备案期站点跑在 HTTP 上:写死 Secure 会让浏览器静默丢弃整个 cookie
    expect(insecure).not.toContain("Secure");
    expect(buildSetCookie(token, true)).toContain("Secure");

    expect(isSecureRequest("https")).toBe(true);
    expect(isSecureRequest("HTTPS")).toBe(true);
    // 多层代理时这个头会是逗号分隔的列表,取第一段
    expect(isSecureRequest("https,http")).toBe(true);
    expect(isSecureRequest("http")).toBe(false);
    expect(isSecureRequest(undefined)).toBe(false);
  });

  it("token 是高熵随机值,库里只落它的摘要", () => {
    const a = newVisitorToken();
    const b = newVisitorToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashVisitorToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashVisitorToken(a)).toBe(hashVisitorToken(a));
    expect(hashVisitorToken(a)).not.toBe(hashVisitorToken(b));
  });
});

describe("身份认领与发放", () => {
  it("发放的身份能被自己的 cookie 认回来;明文不入库", async () => {
    const issued = await ensureVisitor(NO_HEADERS);
    const again = await resolveVisitor(cookieHeaderFor(issued));
    expect(again?.id).toBe(issued.id);

    const row = await db.rawQueryRow<{ hash: string }>(
      `SELECT token_hash AS hash FROM visitors WHERE id = $1::uuid`,
      issued.id,
    );
    expect(row?.hash).toBe(hashVisitorToken(issued.token));
    expect(row?.hash).not.toBe(issued.token);
  });

  it("带 cookie 时 ensureVisitor 不发新身份(否则每次请求都会长一行)", async () => {
    const first = await ensureVisitor(NO_HEADERS);
    const second = await ensureVisitor(cookieHeaderFor(first));
    expect(second.id).toBe(first.id);
    const { n } = (await db.rawQueryRow<{ n: number }>(
      `SELECT COUNT(*)::double precision AS n FROM visitors`,
    ))!;
    expect(n).toBe(1);
  });

  it("没有 cookie / 认不出的 cookie:resolveVisitor 返回 null 且不建行", async () => {
    expect(await resolveVisitor(NO_HEADERS)).toBeNull();
    expect(await resolveVisitor({ cookie: `${VISITOR_COOKIE}=${newVisitorToken()}`, proto: undefined })).toBeNull();
    const { n } = (await db.rawQueryRow<{ n: number }>(
      `SELECT COUNT(*)::double precision AS n FROM visitors`,
    ))!;
    expect(n).toBe(0);
  });

  it("滑动续期:每次认领把 expires_at 推到 now()+24h", async () => {
    const v = await ensureVisitor(NO_HEADERS);
    // 人为把有效期压到只剩一小时,再认领一次
    await db.exec`UPDATE visitors SET expires_at = now() + interval '1 hour' WHERE id = ${v.id}::uuid`;
    expect(await resolveVisitor(cookieHeaderFor(v))).not.toBeNull();

    const row = (await db.rawQueryRow<{ secs: number }>(
      `SELECT extract(epoch FROM (expires_at - now()))::double precision AS secs
         FROM visitors WHERE id = $1::uuid`,
      v.id,
    ))!;
    // 允许几秒执行误差,但必须已经远离「只剩一小时」
    expect(row.secs).toBeGreaterThan(VISITOR_TTL_SECONDS - 60);
  });

  it("过期的 token 认不回来,访客拿到全新身份、看不到旧会话", async () => {
    const v = await ensureVisitor(NO_HEADERS);
    const old = await createSession(v.id);
    await db.exec`UPDATE visitors SET expires_at = now() - interval '1 second' WHERE id = ${v.id}::uuid`;

    expect(await resolveVisitor(cookieHeaderFor(v))).toBeNull();

    const fresh = await ensureVisitor(cookieHeaderFor(v));
    expect(fresh.id).not.toBe(v.id);
    expect(fresh.token).not.toBe(v.token);
    expect(await getSession(old.id, fresh.id)).toBeNull();
  });

  it("续期后的 cookie 明文不变(浏览器侧只刷新 Max-Age)", async () => {
    const v = await ensureVisitor(NO_HEADERS);
    const renewed = await resolveVisitor(cookieHeaderFor(v));
    expect(renewed?.token).toBe(v.token);
    expect(renewed?.setCookie).toBe(buildSetCookie(v.token, false));
  });

  it("Secure 由请求头决定,不由库状态决定", async () => {
    const v = await ensureVisitor({ cookie: undefined, proto: "https" });
    expect(v.secure).toBe(true);
    expect(v.setCookie).toContain("Secure");
    const overHttp = await resolveVisitor({ cookie: `${VISITOR_COOKIE}=${v.token}`, proto: "http" });
    expect(overHttp?.secure).toBe(false);
    expect(overHttp?.setCookie).not.toContain("Secure");
  });
});

describe("保留期清理", () => {
  /** 把会话的最后活跃时间往前推 N 天(库侧时钟,不依赖测试进程时钟)。 */
  async function ageSession(id: string, days: number): Promise<void> {
    await db.exec`
      UPDATE sessions SET last_active_at = now() - make_interval(days => ${days}::int)
      WHERE id = ${id}::uuid
    `;
  }

  it("最后活跃满 3 天的会话被删,连同消息;新会话不受影响", async () => {
    const v = await ensureVisitor(NO_HEADERS);
    const stale = await createSession(v.id);
    const fresh = await createSession(v.id);
    await appendMessage(stale.id, "user", "三天前说的话");
    await ageSession(stale.id, SESSION_RETENTION_DAYS + 1);

    const result = await purgeExpired();
    expect(result.sessions).toBe(1);
    expect(await getSession(stale.id, v.id)).toBeNull();
    expect(await listMessages(stale.id)).toHaveLength(0);
    expect(await getSession(fresh.id, v.id)).not.toBeNull();
  });

  it("刚好没到保留期的会话不被删", async () => {
    const v = await ensureVisitor(NO_HEADERS);
    const s = await createSession(v.id);
    await ageSession(s.id, SESSION_RETENTION_DAYS - 1);
    expect((await purgeExpired()).sessions).toBe(0);
    expect(await getSession(s.id, v.id)).not.toBeNull();
  });

  it("存量无归属会话按同一条规则清理(不需要为它们单写规则)", async () => {
    const legacy = await createSession(null);
    await ageSession(legacy.id, SESSION_RETENTION_DAYS + 1);
    expect((await purgeExpired()).sessions).toBe(1);
  });

  it("过期满 3 天的访客行被删;还在有效期内的不动", async () => {
    const stale = await ensureVisitor(NO_HEADERS);
    const live = await ensureVisitor(NO_HEADERS);
    await db.exec`
      UPDATE visitors SET expires_at = now() - interval '4 days' WHERE id = ${stale.id}::uuid
    `;

    expect((await purgeExpired()).visitors).toBe(1);
    expect(
      await db.rawQueryRow(`SELECT 1 FROM visitors WHERE id = $1::uuid`, stale.id),
    ).toBeNull();
    expect(
      await db.rawQueryRow(`SELECT 1 FROM visitors WHERE id = $1::uuid`, live.id),
    ).not.toBeNull();
  });

  it("清理是幂等的:连跑两次第二次是空操作", async () => {
    const v = await ensureVisitor(NO_HEADERS);
    const s = await createSession(v.id);
    await ageSession(s.id, SESSION_RETENTION_DAYS + 1);
    expect((await purgeExpired()).sessions).toBe(1);
    expect((await purgeExpired()).sessions).toBe(0);
  });
});
