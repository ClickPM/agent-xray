#!/usr/bin/env bash
# Agent X-Ray egress 执行容器的宿主级出网过滤(R-WEBFETCH,所有者裁定 C8;docs/security.md §5)
#
# 干什么:在 docker 的 DOCKER-USER 链最前面插几条 DROP —— 源是 egress 网络的固定网段
#   (deploy/docker-compose.yml 的 networks.egress.ipam,默认 172.30.0.0/24),目的是私网 / 回环 /
#   link-local / CGNAT 这几个固定 RFC 段。skill-runner-egress 容器于是**在宿主这一层**就到不了
#   169.254.169.254(云元数据)、宿主的私网邻居、10/8 里的任何东西。
#
# 为什么要有这一道:web-fetch 脚本自己会逐地址校验并钉住地址连(第一道),容器不在任何 compose 内部
#   网络里(第二道)。这条是第三道:「脚本有 bug」不等于「内网可达」。它不替代脚本的校验 —— 脚本挡的是
#   任意公网 DNS 解析出来的内网地址,这条只是同一批地址段在宿主上的复述。
#
# 为什么是 DOCKER-USER:docker 自己的 FORWARD 规则每次重启都会重建,而 DOCKER-USER 是 docker 留给
#   使用者的、它只跳转不清空的链(FORWARD 的第一跳),写在这里不会被 docker 覆盖。ufw 的链排在它后面,
#   互不干扰。
#
# 幂等:每条规则先 -C 再 -I,跑一百遍也只有一份。**不持久**:iptables 规则重启即丢,所以有 --install-unit
#   把本脚本装成一个 After=docker.service 的 systemd oneshot(复制到 /usr/local/sbin,root 所有 ——
#   不能让 root 在开机时执行 deploy 用户可写的文件)。
#
# 用法(需要 root;在 deploy/ 目录或任何位置):
#   sudo ./egress-filter.sh                 应用规则(幂等)
#   sudo ./egress-filter.sh --status        只看:现有的相关规则(退出码 0 = 六条齐全,1 = 缺)
#   sudo ./egress-filter.sh --install-unit  复制到 /usr/local/sbin 并装 systemd 单元,开机自动应用
#   EGRESS_SUBNET=172.31.0.0/24 sudo -E ./egress-filter.sh   compose 里改了网段时同步这里
#
# 只管 IPv4:compose 的 egress 网络没开 IPv6,容器里没有全局 v6 地址,v6 目的地在脚本层就连不出去
# (fetch.py 仍会校验 v6 地址段;那是脚本的事)。
set -euo pipefail

EGRESS_SUBNET="${EGRESS_SUBNET:-172.30.0.0/24}"
CHAIN="DOCKER-USER"
UNIT_NAME="xray-egress-filter"
INSTALL_PATH="/usr/local/sbin/${UNIT_NAME}"
# 固定的 RFC 段(与 runner/skills/web-fetch/scripts/fetch.py 的 v4 清单同源;这里只列容器实际能路由到的那几段)
BLOCKED=(
  10.0.0.0/8
  172.16.0.0/12
  192.168.0.0/16
  169.254.0.0/16
  100.64.0.0/10
  127.0.0.0/8
)

die() { echo "错误: $*" >&2; exit 1; }

MODE="apply"
case "${1:-}" in
  "") ;;
  --status) MODE="status" ;;
  --install-unit) MODE="install" ;;
  *) die "未知参数 $1(只接受 --status / --install-unit)" ;;
esac

[[ "$EGRESS_SUBNET" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]] || die "EGRESS_SUBNET 形状不对: $EGRESS_SUBNET"
[[ $EUID -eq 0 ]] || die "需要 root(sudo)"
command -v iptables >/dev/null || die "找不到 iptables"

rule_args() { echo "-s $EGRESS_SUBNET -d $1 -j DROP"; }

wait_for_chain() {
  # docker.service 变成 active 与它建好 iptables 链之间有几百毫秒;开机时由 systemd 单元调用要等一下
  local i
  for i in $(seq 1 30); do
    if iptables -w -n -L "$CHAIN" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  die "$CHAIN 链不存在(docker 没起来,或 docker 的 iptables 集成被关了)"
}

status() {
  local missing=0 net
  for net in "${BLOCKED[@]}"; do
    # shellcheck disable=SC2046
    if iptables -w -C "$CHAIN" $(rule_args "$net") 2>/dev/null; then
      echo "ok      $EGRESS_SUBNET -> $net DROP"
    else
      echo "missing $EGRESS_SUBNET -> $net DROP"
      missing=1
    fi
  done
  echo "--- $CHAIN 现状 ---"
  iptables -w -S "$CHAIN"
  return $missing
}

apply() {
  local net added=0
  for net in "${BLOCKED[@]}"; do
    # shellcheck disable=SC2046
    if ! iptables -w -C "$CHAIN" $(rule_args "$net") 2>/dev/null; then
      # -I 1:放在链首,排在 docker 自己追加的 RETURN 之前
      # shellcheck disable=SC2046
      iptables -w -I "$CHAIN" 1 $(rule_args "$net")
      added=$((added + 1))
    fi
  done
  echo "egress-filter: $EGRESS_SUBNET 的出网过滤已就位(本次新增 $added 条,共 ${#BLOCKED[@]} 条)"
}

install_unit() {
  local self
  self="$(readlink -f "$0")"
  install -o root -g root -m 0755 "$self" "$INSTALL_PATH"
  cat > "/etc/systemd/system/${UNIT_NAME}.service" <<EOF
[Unit]
Description=Agent X-Ray egress runner outbound filter (DOCKER-USER)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
Environment=EGRESS_SUBNET=${EGRESS_SUBNET}
ExecStart=${INSTALL_PATH}

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now "${UNIT_NAME}.service"
  echo "egress-filter: 已安装 ${UNIT_NAME}.service(${INSTALL_PATH});systemctl status ${UNIT_NAME} 可查"
}

case "$MODE" in
  status) wait_for_chain; status ;;
  apply) wait_for_chain; apply ;;
  install) wait_for_chain; apply; install_unit ;;
esac
