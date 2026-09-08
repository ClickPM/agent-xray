// R-CROSSLINK 验收 #9:章节页「在 Runtime 里聊这一章」的模板与链接。
// 纯函数测试,不起 Next。经 `dev.ps1 test` → `bun test lib` 运行(node:test 写法,零新增依赖)。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tryInRuntimeHref, tryInRuntimeText } from "./try-in-runtime";
import { readAskParam, MAX_PREFILL } from "./ask-why";

const ref = {
  seriesName: "pi SDK 内核",
  title: "第3章:Agent Loop — 让模型转动起来的引擎",
  seriesSlug: "pi-sdk",
  chapterSlug: "03-agent-loop",
};

describe("tryInRuntimeText", () => {
  it("模板只用章节页拿得到的字段:系列名 / 标题 / slug 路径", () => {
    assert.equal(
      tryInRuntimeText(ref),
      "我在读本站教程《pi SDK 内核 · 第3章:Agent Loop — 让模型转动起来的引擎》(/notes/pi-sdk/03-agent-loop)。" +
        "请用 notes_get_chapter 读这一章,先用三句话概括核心观点,然后等我提问。",
    );
  });

  it("不塞字数与更新时间(画板 2r 裁定)", () => {
    const text = tryInRuntimeText(ref);
    assert.ok(!text.includes("分钟"));
    assert.ok(!text.includes("更新于"));
  });

  it("点名 notes_get_chapter —— 正文不在预填里,模型得自己去读", () => {
    assert.ok(tryInRuntimeText(ref).includes("notes_get_chapter"));
  });

  it("超长字段收住,整句不至于被读取侧整段丢弃", () => {
    const text = tryInRuntimeText({ ...ref, title: "标".repeat(500), seriesName: "系".repeat(500) });
    assert.ok(text.length <= MAX_PREFILL, `实际 ${text.length}`);
    assert.ok(text.includes("…"));
  });

  it("标题里的换行 / 连续空白压成一个空格(它要进单行输入框)", () => {
    assert.ok(!tryInRuntimeText({ ...ref, title: "上\n下" }).includes("\n"));
    assert.equal(tryInRuntimeText({ ...ref, title: "上   下" }).includes("《pi SDK 内核 · 上 下》"), true);
  });
});

describe("tryInRuntimeHref", () => {
  it("是 /?ask= 的形状,且读取侧解出来与模板一字不差(两条边界对得上)", () => {
    const href = tryInRuntimeHref(ref);
    assert.ok(href.startsWith("/?ask="));
    assert.equal(readAskParam(href.slice(1)), tryInRuntimeText(ref));
  });

  it("特殊字符走 encodeURIComponent,不会把 & 或 # 泄成新参数", () => {
    const href = tryInRuntimeHref({ ...ref, title: "A&B#C=D" });
    assert.equal(href.split("?").length, 2);
    assert.ok(!href.slice(6).includes("&"));
    assert.ok(!href.includes("#"));
    assert.ok(readAskParam(href.slice(1))?.includes("A&B#C=D"));
  });
});
