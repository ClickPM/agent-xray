// metrics 服务的 secret 声明(CLAUDE.md 规则 5:secret() 只能在 service 目录内声明)。
//
// MetricsIpSalt —— 访客标识哈希的盐。`docs/security.md` §6 要求「IP 加盐哈希后落库,
// 不存原始 IP」,盐就是这条要求里「加盐」那一半的全部安全性来源:没有它,
// 一份泄漏的 visits 表可以被 2^32 次 sha256 反推回 IPv4 地址。
//
// **未配置时打点整个停摆**(beacon 回 204、不写库并打 error 日志),不是回落成
// 「不加盐直接哈希」—— 那等于把 §6 的承诺悄悄降级成一句谎话。
// compose 侧用 `${METRICS_IP_SALT:?}` 让漏配在启动时就炸,不留到运行期。
import { secret } from "encore.dev/config";

export const metricsIpSalt = secret("MetricsIpSalt");
