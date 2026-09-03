---
name: text-tools
description: 文本小工具:统计一段文本的词频、把一段 JSON 文本格式化并做结构统计。纯标准库 Python 脚本,从 stdin 读一个 JSON 对象、结果写 stdout。
---

# text-tools

两个只依赖 Python 标准库的小脚本,用来演示「skill 自带脚本在隔离的执行容器里运行」这条链路。
脚本**从 stdin 读一个 JSON 对象、把结果以 JSON 写到 stdout**,不读命令行参数、不读环境变量、不碰网络与文件系统。

## 何时用

- 访客给了一段文本,想知道哪些词出现得最多 → `scripts/wordfreq.py`
- 访客贴了一段 JSON,想把它格式化、或想知道它有多少键 / 多深 → `scripts/json_pretty.py`

## 脚本

### `scripts/wordfreq.py` —— 词频统计

输入:

```json
{ "text": "要统计的文本", "top": 10 }
```

- `text`(必填,≤ 4000 字符):中英文均可。英文按单词切、统一小写;中文按单字切(不做分词)。
- `top`(可选,1–50,默认 10):返回出现次数最多的前几个。

输出:

```json
{ "totalTokens": 27, "uniqueTokens": 19, "top": [{ "token": "agent", "count": 3 }] }
```

### `scripts/json_pretty.py` —— JSON 格式化与结构统计

输入:

```json
{ "json": "{\"a\":1,\"b\":[1,2]}", "indent": 2 }
```

- `json`(必填,≤ 4000 字符):一段 JSON 文本。
- `indent`(可选,0–8,默认 2):缩进空格数;0 表示压成一行。

输出:

```json
{ "pretty": "{\n  \"a\": 1,\n  \"b\": [\n    1,\n    2\n  ]\n}", "keys": 2, "depth": 2, "type": "object" }
```

解析失败时 stdout 是 `{ "error": "invalid_json", "message": "…" }` 且以退出码 2 结束。

## 本地怎么跑(给 Claude Code / Codex 用户)

```bash
echo '{"text":"a b a c"}' | python scripts/wordfreq.py
echo '{"json":"{\"a\":1}"}' | python scripts/json_pretty.py
```
