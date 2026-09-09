// R-CARDS-2 验收 #1 / #9 / #11 / #12 的纯函数半边:info string 与高度夹取、字节上限、两个清洗判定函数、srcdoc 拼装。
// 纯函数测试,不起 Next、不需要 DOMParser(`sanitizeFragment` 那层薄壳在 faux 剧本 + Browser pane 里用夹具核)。
// 经 `dev.ps1 test` → `bun test lib` 运行(node:test 写法,零新增依赖)。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HTML_LIMITS,
  buildSrcdoc,
  clampHeight,
  declaredHeight,
  fenceInfo,
  htmlWithinLimit,
  shouldDropAttribute,
  shouldDropElement,
  type FrameTheme,
} from "./xray-html";

const F = "```";

describe("info string 与高度", () => {
  it("fenceInfo:从开围栏行取语言标签之后的整个 info string;容器前缀 / 列表标记 / 波浪线都认;取不到回空串", () => {
    const src = ["a", `${F}xray-html height=320`, "x", F, `> ~~~xray-html   height=200  `, `1. ${F}xray-html`, "不是围栏"].join("\n");
    assert.equal(fenceInfo(src, 2), "xray-html height=320");
    assert.equal(fenceInfo(src, 5), "xray-html   height=200");
    assert.equal(fenceInfo(src, 6), "xray-html");
    assert.equal(fenceInfo(src, 7), "");
    assert.equal(fenceInfo(src, 99), "");
    // 列表续行里的围栏前面是四个空格的容器缩进 —— 这一行是不是围栏由 micromark 定,这里只负责读得出 info string
    assert.equal(fenceInfo(`    ${F}xray-html height=200`, 1), "xray-html height=200");
  });
  it("declaredHeight:只认 height=<整数>;缺省 / 非整数 / 小数 / 负号都是 null", () => {
    assert.equal(declaredHeight("xray-html height=320"), 320);
    assert.equal(declaredHeight("xray-html"), null);
    assert.equal(declaredHeight("xray-html height=abc"), null);
    assert.equal(declaredHeight("xray-html height=12.5"), null);
    assert.equal(declaredHeight("xray-html height=-40"), null);
    assert.equal(declaredHeight("xray-html height="), null);
    assert.equal(declaredHeight("xray-html width=900 height=240 title=x"), 240);
    assert.equal(declaredHeight("xray-html height=100 height=400"), 100);
  });
  it("clampHeight:缺省 320;9999 → 480;10 → 160;移动端上限 360", () => {
    assert.equal(clampHeight(null, false), 320);
    assert.equal(clampHeight(9999, false), 480);
    assert.equal(clampHeight(10, false), 160);
    assert.equal(clampHeight(480, false), 480);
    assert.equal(clampHeight(480, true), 360);
    assert.equal(clampHeight(null, true), 320);
    assert.equal(clampHeight(160, true), 160);
    assert.equal(HTML_LIMITS.heightDefault, 320);
  });
  it("htmlWithinLimit:16 KB 恰好通过、+1 字节回落;按 UTF-8 字节而非字符数", () => {
    assert.equal(htmlWithinLimit("x".repeat(HTML_LIMITS.fenceBytes)), true);
    assert.equal(htmlWithinLimit("x".repeat(HTML_LIMITS.fenceBytes + 1)), false);
    // 一个汉字 3 字节:5462 个 = 16386 字节 > 16384
    assert.equal(htmlWithinLimit("汉".repeat(5462)), false);
    assert.equal(htmlWithinLimit("汉".repeat(5461)), true);
  });
});

describe("shouldDropElement:去脚本 / 嵌入 / 表单控件 / 头部元数据 / 媒体,留排版与 details", () => {
  it("任务卡名单里的每一个都去", () => {
    for (const t of [
      "script", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "textarea", "select", "button",
      "meta", "link", "base", "img", "picture", "source", "video", "audio", "track",
    ]) assert.equal(shouldDropElement(t), true, t);
  });
  it("同类补三个:SVG image / template / portal", () => {
    for (const t of ["image", "template", "portal", "fencedframe"]) assert.equal(shouldDropElement(t), true, t);
  });
  it("SVG SMIL 动画元素都去(codex 第 1 轮 P1:<set attributeName=href> 能在清洗之后改写锚点)", () => {
    for (const t of ["set", "animate", "animateMotion", "animateTransform", "animateColor", "discard", "mpath", "SET"]) assert.equal(shouldDropElement(t), true, t);
  });
  it("大小写变体同样去(SVG 元素名区分大小写,判定统一小写)", () => {
    for (const t of ["SCRIPT", "Script", "IMG", "Meta"]) assert.equal(shouldDropElement(t), true, t);
  });
  it("保留:style / details / summary / svg / use / math / 表格 / 列表 / 标题 / pre / code / blockquote / a / span", () => {
    for (const t of [
      "style", "details", "summary", "svg", "use", "path", "g", "text", "math", "mi", "table", "thead", "tr", "td", "ul", "ol", "li",
      "h1", "h3", "pre", "code", "blockquote", "a", "span", "div", "p", "strong", "em", "hr", "br", "kbd", "dl", "dt", "dd", "title", "noscript", "label",
    ]) assert.equal(shouldDropElement(t), false, t);
  });
});

describe("shouldDropAttribute:去 on* / target / 承载 URL 的属性(除帧内锚点)", () => {
  it("所有 on* 事件属性都去,大小写不敏感", () => {
    for (const n of ["onclick", "onload", "onerror", "ONMOUSEOVER", "onAnimationEnd"]) assert.equal(shouldDropAttribute(n, "x"), true, n);
  });
  it("target 一律去", () => {
    assert.equal(shouldDropAttribute("target", "_blank"), true);
    assert.equal(shouldDropAttribute("TARGET", "_self"), true);
  });
  it("URL 属性:http(s) / 协议相对 / javascript: / data: / 相对路径都去", () => {
    for (const v of ["https://evil.example/", "//evil.example", "javascript:alert(1)", "data:text/html,x", "/notes/a", "a.html", "mailto:x@y", ""]) {
      for (const n of ["href", "src", "srcset", "xlink:href", "action", "formaction", "poster", "ping", "background", "data", "cite", "longdesc", "usemap"]) {
        assert.equal(shouldDropAttribute(n, v), true, `${n}=${v}`);
      }
    }
  });
  it("帧内锚点放行:# 开头;两侧空白与控制字符不算", () => {
    assert.equal(shouldDropAttribute("href", "#sec-2"), false);
    assert.equal(shouldDropAttribute("xlink:href", "#icon"), false);
    assert.equal(shouldDropAttribute("HREF", "  #top"), false);
    assert.equal(shouldDropAttribute("href", "\t\n#x"), false);
    assert.equal(shouldDropAttribute("href", "#"), false);
  });
  it("变体绕不过:大小写 / 空白与控制字符夹在 javascript: 里 / 前置空白的 http", () => {
    assert.equal(shouldDropAttribute("HREF", "JAVASCRIPT:alert(1)"), true);
    assert.equal(shouldDropAttribute("href", "java\tscript:alert(1)"), true);
    assert.equal(shouldDropAttribute("href", String.fromCharCode(1) + "javascript:x"), true); // 前置控制字符去掉后仍不以 # 开头
    assert.equal(shouldDropAttribute("href", "   https://x"), true);
    assert.equal(shouldDropAttribute("href", "​#x"), true); // 零宽空格不是空白也不是控制符:值不以 # 开头,去
    assert.equal(shouldDropAttribute("srcset", "a.png 1x, #b 2x"), true);
    assert.equal(shouldDropAttribute("formaction", "https://x"), true);
    assert.equal(shouldDropAttribute("ping", "https://x"), true);
  });
  it("非 URL、非事件的属性保留:style / class / id / title / open / aria-* / data-* / colspan / viewBox", () => {
    for (const [n, v] of [["style", "background:url(https://x)"], ["class", "a"], ["id", "sec"], ["title", "t"], ["open", ""], ["aria-label", "x"], ["data-x", "https://x"], ["colspan", "2"], ["viewBox", "0 0 24 24"], ["d", "M0 0"]]) {
      assert.equal(shouldDropAttribute(n, v), false, n);
    }
  });
});

const theme: FrameTheme = {
  bg: "#ffffff", fg: "#1a1a1a", muted: "#6b7280", dim: "#9ca3af", panel: "#f5f5f5", border: "#e0e0e0", brand: "#2563eb",
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', mono: '"JetBrains Mono", monospace',
};

describe("buildSrcdoc:CSP 在任何模型内容之前,主题变量注入,片段只占 body", () => {
  it("结构:doctype → charset → CSP → style → body;CSP 原文精确", () => {
    const doc = buildSrcdoc("<p>hi</p>", theme, false);
    assert.ok(doc.startsWith('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">'));
    assert.ok(doc.indexOf("Content-Security-Policy") < doc.indexOf("<p>hi</p>"));
    assert.ok(doc.endsWith("<body><p>hi</p></body></html>"));
  });
  it("九个 --xh-* 变量都在,值原样(字体栈的引号与逗号保留)", () => {
    const doc = buildSrcdoc("", theme, false);
    for (const k of ["bg", "fg", "muted", "dim", "panel", "border", "brand", "sans", "mono"]) assert.ok(doc.includes(`--xh-${k}:`), k);
    assert.ok(doc.includes("--xh-brand:#2563eb"));
    assert.ok(doc.includes('--xh-sans:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'));
  });
  it("主题值里能改 CSS 结构的字符被剥掉(值来自站点样式表,这里只是兜底)", () => {
    const doc = buildSrcdoc("", { ...theme, bg: "#fff;}</style><script>1</script>" }, false);
    assert.ok(doc.includes("--xh-bg:#fff/style>script>1/script>"));
    assert.equal((doc.match(/<script>/g) ?? []).length, 0);
  });
  it("片段原样进 body(清洗在别处):模型写的 </body></html> 逃逸无效 —— 整段仍在同一个文档里", () => {
    const doc = buildSrcdoc("<p>a</p></body></html><p>b</p>", theme, false);
    assert.ok(doc.endsWith("<body><p>a</p></body></html><p>b</p></body></html>"));
  });
  it("基础样式:body 用变量;移动端多一条 summary 44 命中,桌面没有", () => {
    const desktop = buildSrcdoc("", theme, false);
    const mobile = buildSrcdoc("", theme, true);
    assert.ok(desktop.includes("body{padding:12px;font:14px/1.6 var(--xh-sans);color:var(--xh-fg);background:var(--xh-bg);overflow-wrap:anywhere}"));
    assert.ok(desktop.includes("svg,table{max-width:100%}"));
    assert.equal(desktop.includes("summary{min-height:44px"), false);
    assert.ok(mobile.includes("summary{min-height:44px"));
  });
  it("确定性:同一(片段, 主题, 端)两次拼出一字不差(回放 = 实时的前提)", () => {
    assert.equal(buildSrcdoc("<b>x</b>", theme, false), buildSrcdoc("<b>x</b>", theme, false));
  });
});
