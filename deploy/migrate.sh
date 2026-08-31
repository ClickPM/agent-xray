#!/usr/bin/env bash
# Agent X-Ray 数据库迁移 —— 服务器侧执行(所有者裁定 2026-08-29,方案一)
#
# 为什么需要这个脚本:
#   Encore 的自托管镜像**不执行迁移**。本地 `encore run` 时是 encore CLI 把
#   migrations/*.up.sql 灌进库的(日志里的 "Running database migrations"),
#   而生产镜像里没有 CLI,Encore 运行时本身也没有迁移逻辑。空库直起的表现是
#   /health 200 但任何触库端点 500(relation "sessions" does not exist),
#   健康检查全绿,极易被误判成部署成功。
#
# 设计要点:
#   1. SQL 来自**正在部署的那个镜像**,不从 git 工作区读——服务器上没有仓库,
#      也就不存在「镜像是 A 版、SQL 是 B 版」的漂移。
#   2. 版本记录沿用 Encore/golang-migrate 的 schema_migrations(version, dirty)
#      单行语义,与 `encore run` 本地库完全一致。将来若用 encore CLI 连这个库,
#      它读到的版本是对的,不会重跑。
#   3. 每个迁移在**单个事务**内应用并推进版本号——Postgres 的 DDL 是事务性的,
#      失败即整体回滚,版本号不动,可直接重试。因此 dirty 恒为 false。
#   4. 幂等:只应用 version > 当前版本的文件。重复执行是空操作。
#
# 用法(在 deploy/ 目录下)。**本脚本要在 api/web/caddy 起来之前跑**:
#   docker compose up -d --wait postgres   # 1) 只起库,等到 healthy
#   ./migrate.sh                           # 2) 本脚本
#   docker compose up -d                   # 3) 再起 api / web / caddy
#
#   ./migrate.sh --status   只看当前版本与待执行清单,纯只读、不改库
#
# 为什么要卡在服务启动之前:/health 不触库,先起 api 再迁移会出现一段
# 「Caddy 已对外放流量 + 健康检查全绿 + 业务接口 500」的中间状态,监控发现不了。
# 本脚本只需要 postgres 在跑,不需要 api 在跑。
set -euo pipefail

cd "$(dirname "$0")"

die() { echo "错误: $*" >&2; exit 1; }

# 参数白名单:除 --status 外一律拒绝。打错参数(如 --stats)必须报错停下,
# 不能静默落进写模式把生产迁移执行掉(codex review 2026-08-31 P2)。
DRY_RUN=0
case "${1:-}" in
  "")        ;;
  --status)  DRY_RUN=1 ;;
  *)         die "未知参数 '$1'(仅支持 --status)" ;;
esac
[[ $# -le 1 ]] || die "多余参数(仅支持一个可选的 --status)"

# —— 镜像坐标从 .env 取,与 docker compose up 用的是同一份 —— #
# 只提取需要的两个键,不把 .env 当 shell 执行:compose 的 dotenv 语义与 bash source
# 不同(source 会展开 $、反引号与命令替换,含特殊字符的密码会被执行或改写),
# 且本脚本根本不需要 POSTGRES_PASSWORD——psql 走 postgres 容器内的 unix socket。
# 取最后一次出现的值,与 compose 同键后者覆盖前者的行为一致。
[[ -f .env ]] || die "找不到 .env(先 cp .env.example .env 并填好)"
env_get() { sed -n "s/^[[:space:]]*$1=//p" .env | tail -1 | sed -e "s/^[\"']//" -e "s/[\"']\$//"; }
IMAGE_TAG="$(env_get IMAGE_TAG)"
IMAGE_REGISTRY="$(env_get IMAGE_REGISTRY)"
[[ -n "$IMAGE_TAG" ]] || die ".env 里 IMAGE_TAG 为空;必须是 git SHA"
# ${IMAGE_TAG:?} 只能挡空值,挡不住 latest 等可变 tag;本脚本是部署序列的必经步骤,
# 在这里把「tag 必须是 git SHA」变成硬校验(7–40 位十六进制)。
[[ "$IMAGE_TAG" =~ ^[0-9a-f]{7,40}$ ]] || die "IMAGE_TAG 必须是 git SHA(当前值: '$IMAGE_TAG');禁止 latest 等可变 tag"
API_IMAGE="${IMAGE_REGISTRY:-local}/xray-api:${IMAGE_TAG}"

docker image inspect "$API_IMAGE" >/dev/null 2>&1 \
  || die "本机没有镜像 $API_IMAGE(save/load 流程:先把 tar 传上来 docker load;registry 流程:先 docker pull $API_IMAGE)"

# —— postgres 必须已就绪 —— #
docker compose ps --status running postgres >/dev/null 2>&1 \
  || die "postgres 容器未运行;先 docker compose up -d --wait postgres"
docker compose exec -T postgres pg_isready -U app -d agent >/dev/null 2>&1 \
  || die "postgres 尚未 ready;用 docker compose up -d --wait postgres 等到 healthy 再重试"

psql_q() {
  docker compose exec -T postgres psql -U app -d agent -Atq \
    -v ON_ERROR_STOP=1 --set=client_min_messages=warning -c "$1"
}

# 镜像内取文件:用 sh 覆盖 entrypoint(镜像 ENTRYPOINT 是 bun run,不能直接跑 shell)
img_sh() { docker run --rm --entrypoint sh "$API_IMAGE" -c "$1"; }

echo "镜像 : $API_IMAGE"

# —— 枚举镜像内的迁移目录 —— #
# 约定:apps/api/<name>/migrations/ 里的 <name> 即 Encore 数据库名
# (本仓 agent/db.ts 声明 SQLDatabase("agent"),目录名与库名一致)。
# 若将来两者不一致,这里会因为库名对不上而报错,而不是静默灌错库。
mapfile -t MIG_DIRS < <(img_sh 'ls -d /workspace/apps/api/*/migrations 2>/dev/null' || true)
[[ ${#MIG_DIRS[@]} -gt 0 ]] || die "镜像内没有找到任何 migrations 目录"

for dir in "${MIG_DIRS[@]}"; do
  db="$(basename "$(dirname "$dir")")"
  if [[ "$db" != "agent" ]]; then
    die "发现迁移目录 $dir,但本脚本目前只配置了 agent 库。
     新增数据库时需要在这里补上库名与连接参数(见 deploy/infra-config.json 的 sql_servers)。"
  fi

  echo "数据库: $db"

  # schema_migrations 与 Encore/golang-migrate 同构(单行记当前版本)。
  # --status 是纯只读的:表不存在时不建,直接把当前版本视作 0。
  if [[ "$(psql_q "SELECT to_regclass('public.schema_migrations') IS NOT NULL;")" == "t" ]]; then
    dirty="$(psql_q "SELECT dirty FROM schema_migrations LIMIT 1;")"
    [[ "$dirty" == "t" ]] && die "schema_migrations.dirty = true —— 上一次迁移半途失败。
     需人工确认库状态后手动清理该标记再重试(本脚本用事务应用,正常不会出现此状态;
     出现即说明有人用别的方式改过库)。"
    current="$(psql_q "SELECT COALESCE(MAX(version), 0) FROM schema_migrations;")"
  else
    current=0
    (( DRY_RUN )) || psql_q "CREATE TABLE schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL);" >/dev/null
  fi
  current="${current:-0}"
  echo "当前版本: $current"

  mapfile -t FILES < <(img_sh "ls -1 $dir/*.up.sql 2>/dev/null" || true)
  [[ ${#FILES[@]} -gt 0 ]] || die "$dir 下没有 *.up.sql"

  # 版本号解析 + 数值排序 + 唯一性校验(codex 复审 2026-08-31 第 2 轮 P2):
  # - 字典序 sort 在版本宽度变化时会错序(999 排在 1000 后 → v999 被静默跳过);
  # - 两个分支各自新增同号迁移(002_a / 002_b),第一份应用后第二份会被
  #   「version > current」判断静默跳过,库里永久缺一份变更。
  # 两种情况都必须在执行前拒绝,而不是靠约定。
  ORDERED=()
  for f in "${FILES[@]}"; do
    base="$(basename "$f")"
    # 文件名前缀数字即版本号(001_init.up.sql -> 1)
    ver="$(printf '%s' "$base" | sed -n 's/^0*\([0-9][0-9]*\)_.*/\1/p')"
    [[ -n "$ver" ]] || die "迁移文件名不符合 <数字>_<名字>.up.sql 约定: $base"
    ORDERED+=("$ver $f")
  done
  mapfile -t ORDERED < <(printf '%s\n' "${ORDERED[@]}" | sort -n -k1,1)
  dup="$(printf '%s\n' "${ORDERED[@]}" | awk '{print $1}' | uniq -d | head -1)"
  [[ -z "$dup" ]] || die "发现重复的迁移版本号 v$dup(多个分支各自新增了同号迁移?)。重命名消除冲突后再部署。"

  pending=0
  for entry in "${ORDERED[@]}"; do
    ver="${entry%% *}"
    f="${entry#* }"
    base="$(basename "$f")"
    (( ver > current )) || continue
    pending=$((pending + 1))

    if (( DRY_RUN )); then
      echo "  待执行: v$ver  $base"
      continue
    fi

    sql="$(img_sh "cat '$f'")"

    # CREATE INDEX CONCURRENTLY 等语句不能在事务里跑;宁可报错也不要绕过事务保护
    if printf '%s' "$sql" | grep -qiE '\bCONCURRENTLY\b'; then
      die "$base 含 CONCURRENTLY,无法在事务内执行。
     该迁移需人工按停机窗口单独处理,处理完手动把 schema_migrations 推到 v$ver。"
    fi

    echo "  应用 v$ver  $base"
    # 单事务:SQL 与版本推进同生共死。失败则整体回滚,版本号不动,可直接重跑。
    # 并发保护(codex 复审 2026-08-31 P2):advisory 事务锁串行化所有执行者,
    # 锁下复核版本——若另一执行者已推进版本,RAISE 中止本事务而不是重复应用。
    # 锁 key 为任取的项目常数,随事务结束自动释放,不需要手动解锁。
    {
      echo "BEGIN;"
      echo "SELECT pg_advisory_xact_lock(823567001);"
      echo 'DO $mig$ BEGIN'
      echo "  IF (SELECT COALESCE(MAX(version), 0) FROM schema_migrations) <> $current THEN"
      echo "    RAISE EXCEPTION '并发迁移: schema_migrations 当前版本与预期 $current 不符,另一执行者可能正在迁移';"
      echo "  END IF;"
      echo 'END $mig$;'
      printf '%s\n' "$sql"
      echo "DELETE FROM schema_migrations;"
      echo "INSERT INTO schema_migrations (version, dirty) VALUES ($ver, false);"
      echo "COMMIT;"
    } | docker compose exec -T postgres psql -U app -d agent -v ON_ERROR_STOP=1 -q \
      || die "v$ver 应用失败,已回滚(版本号仍为 $current)。修好后重跑本脚本。"
    current="$ver"
  done

  if (( pending == 0 )); then
    echo "  无待执行迁移(已是最新)"
  elif (( DRY_RUN )); then
    echo "  共 $pending 个待执行(--status 模式,未改库)"
  else
    echo "  完成,当前版本: $(psql_q "SELECT MAX(version) FROM schema_migrations;")"
  fi
done
