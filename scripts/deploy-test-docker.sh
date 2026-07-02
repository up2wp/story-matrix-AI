#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$HOME/Projects/story-matrix-AI}"
DEPLOY_BRANCH="dev"
IMAGE_NAME="story-matrix-ai:test"
CONTAINER_NAME="story-matrix-ai"
DATA_DIR="$HOME/docker/story-matrix-data"
HOST_PORT="3001"
CONTAINER_PORT="3001"
NOTIFY_DEPLOY="1"

log() {
  printf '[deploy-test] %s\n' "$1"
}

fail() {
  printf '[deploy-test] ERROR: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

send_ntfy_notification() {
  local status="$1"

  if [[ "$NOTIFY_DEPLOY" != "1" ]]; then
    return 0
  fi

  if [[ -z "${NTFY_URL:-}" || -z "${NTFY_TOPIC:-}" ]]; then
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    printf '[deploy-test] WARN: curl is required to send ntfy notification.\n' >&2
    return 0
  fi

  local ntfy_url="${NTFY_URL%/}"
  local ntfy_topic="${NTFY_TOPIC#/}"
  local status_text="成功"
  local tag="white_check_mark"

  if [[ "$status" != "success" ]]; then
    status_text="失败"
    tag="x"
  fi

  local title="Story Matrix AI 测试环境部署${status_text}"
  local message="Story Matrix AI 测试环境部署${status_text}。"

  if ! curl -fsS -X POST "${ntfy_url}/${ntfy_topic}" \
    -H "Title: ${title}" \
    -H "Tags: docker,${tag}" \
    --data-binary "${message}" >/dev/null; then
    printf '[deploy-test] WARN: Failed to send ntfy notification.\n' >&2
  fi
}

notify_on_exit() {
  local exit_code="$?"
  local status="success"

  if [[ "$exit_code" -ne 0 ]]; then
    status="failed"
  fi

  send_ntfy_notification "$status"
}

ensure_clean_worktree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    fail "Project worktree is not clean. Commit or stash local changes before deploying."
  fi
}

sync_dev_branch() {
  local branch="$DEPLOY_BRANCH"
  local remote_ref="origin/$branch"
  local local_commit=""
  local remote_commit

  if ! git show-ref --verify --quiet "refs/remotes/$remote_ref"; then
    fail "Remote branch does not exist: $remote_ref"
  fi

  remote_commit="$(git rev-parse "$remote_ref")"

  if git show-ref --verify --quiet "refs/heads/$branch"; then
    local_commit="$(git rev-parse "$branch")"
    if [[ "$local_commit" == "$remote_commit" ]]; then
      log "No new commits on $remote_ref; skipping Docker build."
      return 1
    fi

    if ! git merge-base --is-ancestor "$local_commit" "$remote_commit"; then
      fail "Local $branch is not behind $remote_ref. Resolve branch divergence before deploying."
    fi

    git switch "$branch"
    git merge --ff-only "$remote_ref"
  else
    git switch --track -c "$branch" "$remote_ref"
  fi
}

replace_container() {
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
    log "Removing existing container: $CONTAINER_NAME"
    docker rm -f "$CONTAINER_NAME" >/dev/null
  fi

  mkdir -p "$DATA_DIR"

  docker run -itd \
    --name "$CONTAINER_NAME" \
    --restart always \
    -p "$HOST_PORT:$CONTAINER_PORT" \
    -v "$DATA_DIR:/app/server/data" \
    "$IMAGE_NAME"
}

main() {
  trap notify_on_exit EXIT

  require_command git
  require_command docker

  [[ -d "$PROJECT_DIR" ]] || fail "Project directory does not exist: $PROJECT_DIR"
  cd "$PROJECT_DIR"
  [[ -d .git ]] || fail "Project directory is not a git repository: $PROJECT_DIR"

  ensure_clean_worktree

  log "Fetching all remotes in $PROJECT_DIR"
  git fetch --all --prune

  log "Syncing deploy branch: $DEPLOY_BRANCH"
  if ! sync_dev_branch; then
    NOTIFY_DEPLOY="0"
    return 0
  fi

  log "Building Docker image: $IMAGE_NAME"
  docker build -t "$IMAGE_NAME" .

  log "Starting test container: $CONTAINER_NAME"
  replace_container

  log "Cleaning dangling Docker images"
  docker image prune -f

  log "Test environment is running at http://localhost:$HOST_PORT"
}

main "$@"
