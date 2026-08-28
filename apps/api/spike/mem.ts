// R1 spike:内存基线测量(ROUNDS.md R1 门禁 5,数字回填 rounds/round-01/round-01.md)。
// - POST /spike/mem/import   pi 动态 import 前后增量
// - POST /spike/mem/sessions 并发空闲会话增量 + create/dispose 循环后回落
// - GET  /spike/mem          当前用量与全部阶段快照
import { api } from "encore.dev/api";
import {
  createSpikeSession,
  disposeSpikeSession,
  getMemLog,
  isPiLoaded,
  loadPi,
  snapshotMem,
  type MemSnapshot,
} from "./runtime";

function tryGc(): boolean {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc === "function") {
    gc();
    return true;
  }
  return false;
}

export const mem = api(
  { expose: true, method: "GET", path: "/spike/mem" },
  async (): Promise<{ piLoaded: boolean; now: MemSnapshot; log: MemSnapshot[] }> => {
    return { piLoaded: isPiLoaded(), now: snapshotMem("probe"), log: getMemLog() };
  },
);

export const memImport = api(
  { expose: true, method: "POST", path: "/spike/mem/import" },
  async (): Promise<{
    alreadyLoaded: boolean;
    before?: MemSnapshot;
    after?: MemSnapshot;
    deltaRss?: number;
    deltaHeapUsed?: number;
  }> => {
    const alreadyLoaded = isPiLoaded();
    await loadPi();
    const log = getMemLog();
    const before = log.find((s) => s.stage === "import_before");
    const after = log.find((s) => s.stage === "import_after");
    return {
      alreadyLoaded,
      before,
      after,
      deltaRss: before && after ? after.rss - before.rss : undefined,
      deltaHeapUsed: before && after ? after.heapUsed - before.heapUsed : undefined,
    };
  },
);

interface MemSessionsParams {
  /** 并发空闲会话数(默认 3,上限 5) */
  count?: number;
  /** create/dispose 循环次数(默认 10,上限 30) */
  cycles?: number;
}

export const memSessions = api(
  { expose: true, method: "POST", path: "/spike/mem/sessions" },
  async (p: MemSessionsParams): Promise<{
    gcForced: boolean;
    count: number;
    cycles: number;
    base: MemSnapshot;
    afterCreate: MemSnapshot;
    perSessionRss: number;
    perSessionHeapUsed: number;
    afterDispose: MemSnapshot;
    afterChurn: MemSnapshot;
    churnResidualRss: number;
  }> => {
    const count = Math.max(1, Math.min(p.count ?? 3, 5));
    const cycles = Math.max(1, Math.min(p.cycles ?? 10, 30));

    await loadPi();
    const gcForced = tryGc();
    const base = snapshotMem("sessions_base");

    // 阶段 A:并发空闲会话增量
    const recs = [];
    for (let i = 0; i < count; i++) {
      recs.push(await createSpikeSession({ track: false }));
    }
    const afterCreate = snapshotMem("sessions_created");

    for (const rec of recs) disposeSpikeSession(rec);
    recs.length = 0;
    tryGc();
    const afterDispose = snapshotMem("sessions_disposed");

    // 阶段 B:create/dispose 循环,验证不单调增长
    for (let i = 0; i < cycles; i++) {
      const rec = await createSpikeSession({ track: false });
      disposeSpikeSession(rec);
    }
    tryGc();
    const afterChurn = snapshotMem("sessions_churn");

    return {
      gcForced,
      count,
      cycles,
      base,
      afterCreate,
      perSessionRss: Math.round((afterCreate.rss - base.rss) / count),
      perSessionHeapUsed: Math.round((afterCreate.heapUsed - base.heapUsed) / count),
      afterDispose,
      afterChurn,
      churnResidualRss: afterChurn.rss - afterDispose.rss,
    };
  },
);
