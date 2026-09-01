# 自托管字体(R9)

`JetBrainsMono-latin.woff2` —— JetBrains Mono **变量字体**(weight 100–800)的 latin 子集,
取自 Google Fonts v24 的 `fonts.gstatic.com` 产物,40.4 KB。

## 为什么自托管

原先 `app/layout.tsx` 用 `<link rel="stylesheet" href="https://fonts.googleapis.com/…">` 引入。
那是一张**渲染阻塞样式表**:境内首访要先等 `fonts.googleapis.com` 解析 + 建连 + 返回 CSS,
再去 `fonts.gstatic.com` 取 woff2,两跳都不稳,超时期间整页白屏(架构评审 2026-08-29 的 P1-4)。
自托管后字体与页面同源同连接,断外网也是 JetBrains Mono。

## 为什么只要 latin 子集

Google 把这个家族切成 cyrillic-ext / cyrillic / greek / vietnamese / latin-ext / latin 六份。
本站的等宽字体只用在代码与技术文本(`pre` / `code`,见 `globals.css` 的 `--font-mono`),
内容是中文 + 英文;JetBrains Mono 本身不含 CJK,中文一律落到 `--font-mono` 后面的
`Noto Sans Mono` / Consolas。取 latin 一份即可覆盖实际用到的全部字形,
其余五份对本站是纯粹的体积。

`next/font/local` 的 `src` 数组不能表达 `unicode-range`,所以多子集也没法合成一个
`@font-face` —— 这是"只要 latin"的第二个理由。

## 为什么是变量字体不是四个字重文件

设计稿用到 400/500/600/700 四个字重。变量字体一份 40 KB 覆盖 100–800,
四个静态字重加起来反而更大,且 `next/font/local` 要写四条 `src`。

## 升级

Google Fonts 的 URL 带版本号(v24)与内容哈希,不会原地变。要换版本时:

```bash
curl -A "Mozilla/5.0" "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@100..800&display=swap"
# 从返回的 CSS 里取 /* latin */ 那段的 woff2 URL,下载覆盖本目录的文件
```

`OFL.txt` 是 SIL Open Font License 1.1 原文,随字体分发是许可要求,不要删。
