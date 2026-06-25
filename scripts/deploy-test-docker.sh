#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-${1:-$HOME/Projects/story-matrix-AI}}"
IMAGE_NAME="story-matrix-ai:test"
CONTAINER_NAME="story-matrix-ai"
DATA_DIR="$HOME/docker/story-matrix-data"
HOST_PORT="3001"
CONTAINER_PORT="3001"

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

ensure_clean_worktree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    fail "Project worktree is not clean. Commit or stash local changes before deploying."
  fi
}

checkout_latest_remote_branch() {
  local latest_ref
  local latest_branch

  latest_ref="$(git for-each-ref refs/remotes --sort=-committerdate --format='%(refname:short)' | grep -v '/HEAD$' | head -n 1)"
  [[ -n "$latest_ref" ]] || fail "No remote branches found after fetch."

  latest_branch="${latest_ref#*/}"
  [[ "$latest_branch" != "HEAD" ]] || fail "Latest remote ref is not a deployable branch: $latest_ref"

  if git show-ref --verify --quiet "refs/heads/$latest_branch"; then
    git switch "$latest_branch"
    git merge --ff-only "$latest_ref"
  else
    git switch --track -c "$latest_branch" "$latest_ref"
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
  require_command git
  require_command docker

  [[ -d "$PROJECT_DIR" ]] || fail "Project directory does not exist: $PROJECT_DIR"
  cd "$PROJECT_DIR"
  [[ -d .git ]] || fail "Project directory is not a git repository: $PROJECT_DIR"

  ensure_clean_worktree

  log "Fetching all remotes in $PROJECT_DIR"
  git fetch --all --prune

  log "Switching to latest remote branch"
  checkout_latest_remote_branch

  log "Building Docker image: $IMAGE_NAME"
  docker build -t "$IMAGE_NAME" .

  log "Starting test container: $CONTAINER_NAME"
  replace_container

  log "Cleaning dangling Docker images"
  docker image prune -f

  log "Test environment is running at http://localhost:$HOST_PORT"
}

main "$@"
