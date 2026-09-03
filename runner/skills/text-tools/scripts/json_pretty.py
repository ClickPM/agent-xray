"""JSON 格式化与结构统计:stdin 读 {json, indent?},stdout 写 {pretty, keys, depth, type}。

准入清单同 wordfreq.py:标准库、无 argv / env、无子进程 / 网络、无 eval、不落盘、确定性。
"""
import json
import sys

MAX_JSON = 4000
DEFAULT_INDENT = 2
MAX_INDENT = 8
# 嵌套深度上限:json.loads 本身对深嵌套会递归到 RecursionError,先按字符粗判一层
MAX_DEPTH = 64


def measure(value, depth=1):
    """返回 (键数, 最大深度)。键数只数对象里的键,数组元素不算键。"""
    if isinstance(value, dict):
        keys = len(value)
        deepest = depth
        for v in value.values():
            k, d = measure(v, depth + 1)
            keys += k
            deepest = max(deepest, d)
        return keys, deepest
    if isinstance(value, list):
        keys = 0
        deepest = depth
        for v in value:
            k, d = measure(v, depth + 1)
            keys += k
            deepest = max(deepest, d)
        return keys, deepest
    return 0, depth


def type_name(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    return "object"


def main() -> int:
    try:
        req = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError) as err:
        json.dump({"error": "invalid_input", "message": str(err)[:200]}, sys.stdout, ensure_ascii=False)
        return 2
    if not isinstance(req, dict) or not isinstance(req.get("json"), str):
        json.dump({"error": "invalid_input", "message": "need {json: string}"}, sys.stdout)
        return 2

    raw = req["json"][:MAX_JSON]
    indent = req.get("indent", DEFAULT_INDENT)
    if not isinstance(indent, int) or isinstance(indent, bool) or not 0 <= indent <= MAX_INDENT:
        indent = DEFAULT_INDENT

    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, RecursionError) as err:
        json.dump({"error": "invalid_json", "message": str(err)[:200]}, sys.stdout, ensure_ascii=False)
        return 2

    keys, depth = measure(value)
    if depth > MAX_DEPTH:
        json.dump({"error": "too_deep", "message": f"nesting deeper than {MAX_DEPTH}"}, sys.stdout)
        return 2

    pretty = json.dumps(value, ensure_ascii=False, indent=indent if indent > 0 else None, separators=None if indent > 0 else (",", ":"))
    json.dump({"pretty": pretty, "keys": keys, "depth": depth, "type": type_name(value)}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
