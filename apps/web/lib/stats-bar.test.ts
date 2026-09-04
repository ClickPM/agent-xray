// R-USAGE 验收 #10 的前端半边:统计条的三个格式化函数是纯函数,这里直接断言。
// 经 `dev.ps1 test` → `bun test lib` 运行(node:test 写法,零新增依赖)。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatCtx, formatTokens, STAT_PLACEHOLDER } from "./stats-bar";

describe("formatTokens", () => {
  it("千位以下原样,千位以上一位小数,百万以上换 M", () => {
    assert.equal(formatTokens(0), "0 tokens");
    assert.equal(formatTokens(999), "999 tokens");
    assert.equal(formatTokens(1_000), "1.0k tokens");
    assert.equal(formatTokens(12_400), "12.4k tokens"); // 画板 1a 的样本
    assert.equal(formatTokens(999_999), "1000.0k tokens");
    assert.equal(formatTokens(1_240_000), "1.2M tokens");
  });

  it("小数入参先取整,不出现 1.5 tokens", () => {
    assert.equal(formatTokens(12.4), "12 tokens");
    assert.equal(formatTokens(999.6), "1.0k tokens");
  });

  it("拿不到值(旧服务端 / 未提问)显示占位,不显示 NaN 或 undefined", () => {
    for (const bad of [undefined, null, NaN, Infinity, -1]) {
      assert.equal(formatTokens(bad as number), `${STAT_PLACEHOLDER} tokens`);
    }
  });
});

describe("formatCtx", () => {
  it("入参是 0–100 的百分数,四舍五入到整数", () => {
    assert.equal(formatCtx(6), "ctx 6%");
    assert.equal(formatCtx(6.234567), "ctx 6%"); // pi 回的是未取整的浮点
    assert.equal(formatCtx(6.5), "ctx 7%");
    assert.equal(formatCtx(0), "ctx 0%");
  });

  it("超过 100 不夹断:压缩前的真实状态要能看见", () => {
    assert.equal(formatCtx(104.2), "ctx 104%");
  });

  it("缺席(会话不在运行时里 / pi 刚压缩过回 null)显示占位", () => {
    for (const bad of [undefined, null, NaN, -3]) {
      assert.equal(formatCtx(bad as number), `ctx ${STAT_PLACEHOLDER}`);
    }
  });
});
