"""词频统计:stdin 读一个 JSON 对象 {text, top?},stdout 写 JSON 结果。

准入清单(rounds/round-skills/research.md §2.2):只用标准库;不读 argv / 环境变量;
不 import subprocess / socket / ctypes;不 eval;不写文件;确定性;单次远小于超时。
"""
import json
import re
import sys
from collections import Counter

MAX_TEXT = 4000
DEFAULT_TOP = 10
MAX_TOP = 50

# 英文单词(含数字与撇号)或单个 CJK 字符;其余字符(标点 / 空白)不算 token
TOKEN_RE = re.compile(r"[A-Za-z0-9']+|[一-鿿㐀-䶿]")


def main() -> int:
    try:
        req = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError) as err:
        json.dump({"error": "invalid_input", "message": str(err)[:200]}, sys.stdout, ensure_ascii=False)
        return 2
    if not isinstance(req, dict) or not isinstance(req.get("text"), str):
        json.dump({"error": "invalid_input", "message": "need {text: string}"}, sys.stdout)
        return 2

    text = req["text"][:MAX_TEXT]
    top = req.get("top", DEFAULT_TOP)
    if not isinstance(top, int) or isinstance(top, bool) or not 1 <= top <= MAX_TOP:
        top = DEFAULT_TOP

    tokens = [t.lower() for t in TOKEN_RE.findall(text)]
    counts = Counter(tokens)
    # 次数相同按 token 码点序,输出确定
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:top]
    json.dump(
        {
            "totalTokens": len(tokens),
            "uniqueTokens": len(counts),
            "top": [{"token": t, "count": c} for t, c in ranked],
        },
        sys.stdout,
        ensure_ascii=False,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
