#!/bin/sh










set -eu

PROFILE="${1:-web}"


case "$PROFILE" in
  *[!a-zA-Z0-9_-]*|'') fail_early=1 ;;
  *) fail_early=0 ;;
esac
if [ "$fail_early" = 1 ]; then
  printf '\033[31m✗ 非法的 profile 名 "%s"（仅允许字母、数字、_、-）\033[0m\n' "$PROFILE"
  exit 1
fi

PACKAGE_SPEC="@changfenhuang/dsh-genui"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"



AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}"
RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; BOLD='\033[1m'; NC='\033[0m'

fail() { printf "${RED}✗ %s${NC}\n" "$1"; exit 1; }
ok()   { printf "${GREEN}✓ %s${NC}\n" "$1"; }
warn() { printf "${YELLOW}! %s${NC}\n" "$1"; }









sync_skill_to() {
  SKILL_FILE="$1"
  DEST="$2"
  DEST_LABEL="$3"


  if [ -L "$DEST" ]; then
    LINK_TARGET=$(readlink "$DEST")
    case "$LINK_TARGET" in
      /*) RESOLVED="$LINK_TARGET" ;;
      *)  RESOLVED="$(cd "$(dirname "$DEST")" && pwd -P)/$LINK_TARGET" ;;
    esac


    canonical() {
      ( cd "$(dirname "$1")" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$(basename "$1")" ) || printf '%s\n' "$1"
    }
    if [ "$RESOLVED" = "$SKILL_FILE" ] || [ "$(canonical "$RESOLVED")" = "$(canonical "$SKILL_FILE")" ]; then
      ok "skill 已是最新（$DEST_LABEL 符号链接指向同一文件）"
      return 0
    fi
    if [ -e "$RESOLVED" ] || [ -L "$RESOLVED" ]; then
      fail "目标 $DEST 是指向其他文件的符号链接（-> ${RESOLVED}），拒绝写入。请手动处理后重试。"
    fi
    fail "目标 $DEST 是悬空符号链接（-> ${RESOLVED}），拒绝写入。请手动处理后重试。"
  fi
  if [ -d "$DEST" ]; then
    fail "目标 $DEST 是目录，拒绝覆盖。请手动处理后重试。"
  fi


  mkdir -p "$(dirname "$DEST")"
  TMP_FILE="$DEST.tmp.$$"
  trap 'rm -f "$TMP_FILE"' EXIT HUP INT TERM
  cp "$SKILL_FILE" "$TMP_FILE"
  mv "$TMP_FILE" "$DEST"
  trap - EXIT HUP INT TERM
  ok "skill 已同步到 ${DEST_LABEL}（${SKILL_FILE}）"
}

sync_skill() {
  echo "同步 genui skill ..."



  mkdir -p "$DSH_HOME"
  SKILL_FILE=$(cd "$DSH_HOME" && DSH_HOME="$DSH_HOME" PROFILE="$PROFILE" node -e "
const path = require('path')
try {
  const pkg = require.resolve('@changfenhuang/dsh-genui/package.json', { paths: [process.env.DSH_HOME + '/profiles/' + process.env.PROFILE] })
  console.log(path.join(path.dirname(pkg), 'SKILL.md'))
} catch { process.exit(1) }
" 2>/dev/null || true)
  if [ -z "$SKILL_FILE" ] || [ ! -f "$SKILL_FILE" ]; then
    fail "无法定位已安装包内的 SKILL.md —— 安装不完整，请先修复插件安装再重试。"
  fi

  sync_skill_to "$SKILL_FILE" "$DSH_HOME/skills/genui/SKILL.md" "DSH_HOME/skills/genui"
  sync_skill_to "$SKILL_FILE" "$AGENTS_HOME/skills/genui/SKILL.md" "AGENTS_HOME/skills/genui"
}

echo "${BOLD}== dsh-genui 安装（profile: ${PROFILE}）==${NC}"


if ! command -v dsh >/dev/null 2>&1; then
  fail "未找到 dsh 命令。请先安装 DeepSeek Harness（开源版），再跑本脚本。"
fi
ok "dsh: $(dsh --version 2>/dev/null || echo present)"


if ! command -v pnpm >/dev/null 2>&1; then
  fail "未找到 pnpm。请手动执行: 'corepack enable'（或 'npm i -g pnpm'），新开终端确认 'pnpm -v' 有输出后重跑本脚本。"
fi
ok "pnpm: $(pnpm --version)"


PROFILE_PKG="$DSH_HOME/profiles/$PROFILE/package.json"
if [ -f "$PROFILE_PKG" ] && grep -q "dsh-genui" "$PROFILE_PKG" 2>/dev/null; then
  warn "插件已在 profile '$PROFILE' 中。"
  sync_skill
  printf "  想重装就手动执行: dsh plugin --profile %s remove @changfenhuang/dsh-genui，再跑本脚本。\n" "$PROFILE"
  printf "  否则直接: 重启 dsh web + 硬刷新 即可验证。\n"
  exit 0
fi


echo "安装中（从 npm 拉取公开包并安装依赖）..."
dsh plugin --profile "$PROFILE" add "$PACKAGE_SPEC"
sync_skill

echo
ok "安装完成！"
echo
echo "${BOLD}接下来:${NC}"
echo "  1. 重启 dsh web（退出后重新执行 dsh web）"
echo "  2. 浏览器硬刷新（Cmd+Shift+R）"
echo "  3. 新会话里说: 用 dsh-ui 画个统计看板"
echo
