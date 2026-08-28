// R1 spike:GET /spike/events/audit — 34 事件订阅核验与四模式计数核对
// (ROUNDS.md R1 门禁 3/4:与 docs/architecture.md 比对,有出入以实测为准回改文档)。
import { api } from "encore.dev/api";
import {
  ALL_EVENTS,
  EVENT_MODES,
  modeCounts,
  PI_SDK_VERSION,
  runSanitizeSelfTests,
  type SanitizeSelfTest,
} from "./events";
import { listSessions } from "./runtime";

interface EventInfo {
  name: string;
  mode: string;
}

interface CountByKey {
  key: string;
  count: number;
}

interface SessionAudit {
  sessionId: string;
  disposed: boolean;
  createdAt: number;
  /** pi.on 成功订阅的事件数(期望 34) */
  subscribedCount: number;
  subscribeErrors: { name: string; error: string }[];
  capturedTotal: number;
  capturedByType: CountByKey[];
  capturedByMode: CountByKey[];
}

interface ModeCounts {
  notify: number;
  veto: number;
  chain: number;
  takeover: number;
  total: number;
}

interface AuditResponse {
  piPackage: string;
  piVersion: string;
  catalog: EventInfo[];
  /** 实测(以 SDK 类型面 + 运行时订阅为准) */
  measured: ModeCounts;
  /** docs/architecture.md 修订前的记载,留作核对痕迹 */
  architectureDocBefore: ModeCounts;
  matchesArchitectureDocBefore: boolean;
  /** 脱敏自测(凭据键变体/嵌套/字符串值/headers/未知字段/超大对象),须全 pass */
  sanitizeSelfTests: SanitizeSelfTest[];
  sessions: SessionAudit[];
}

export const eventsAudit = api(
  { expose: true, method: "GET", path: "/spike/events/audit" },
  async (): Promise<AuditResponse> => {
    const measured = modeCounts();
    const docBefore: ModeCounts = { notify: 18, veto: 6, chain: 7, takeover: 2, total: 33 };

    const sessions: SessionAudit[] = listSessions().map((rec) => {
      const byType = new Map<string, number>();
      const byMode = new Map<string, number>();
      for (const e of rec.events) {
        byType.set(e.eventType, (byType.get(e.eventType) ?? 0) + 1);
        byMode.set(e.mode, (byMode.get(e.mode) ?? 0) + 1);
      }
      return {
        sessionId: rec.id,
        disposed: rec.disposed,
        createdAt: rec.createdAt,
        subscribedCount: rec.subscribed.length,
        subscribeErrors: rec.subscribeErrors,
        capturedTotal: rec.events.length,
        capturedByType: [...byType].map(([key, count]) => ({ key, count })),
        capturedByMode: [...byMode].map(([key, count]) => ({ key, count })),
      };
    });

    return {
      piPackage: "@earendil-works/pi-coding-agent",
      piVersion: PI_SDK_VERSION,
      catalog: ALL_EVENTS.map((name) => ({ name, mode: EVENT_MODES[name] })),
      measured,
      architectureDocBefore: docBefore,
      matchesArchitectureDocBefore:
        measured.notify === docBefore.notify &&
        measured.veto === docBefore.veto &&
        measured.chain === docBefore.chain &&
        measured.takeover === docBefore.takeover,
      sanitizeSelfTests: runSanitizeSelfTests(),
      sessions,
    };
  },
);
