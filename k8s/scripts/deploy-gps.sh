#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$SCRIPT_DIR/deploy-gps.config.sh"

DOCKER_IS_EXE=0
KUBECTL_IS_EXE=0

REGISTRY="${1:-${REGISTRY:-}}"
if [ -z "$REGISTRY" ]; then
	echo "Usage: bash deploy-gps.sh <registry>"
	exit 1
fi

command -v docker >/dev/null 2>&1 || {
	command -v docker.exe >/dev/null 2>&1 && docker(){ docker.exe "$@"; } && DOCKER_IS_EXE=1 || {
		echo "docker is not available (neither docker nor docker.exe)"
		exit 1
	}
}

command -v kubectl >/dev/null 2>&1 || {
	command -v kubectl.exe >/dev/null 2>&1 && kubectl(){ kubectl.exe "$@"; } && KUBECTL_IS_EXE=1 || {
		echo "kubectl is not available (neither kubectl nor kubectl.exe)"
		exit 1
	}
}

docker info >/dev/null 2>&1 || {
	echo "Docker daemon is not running. Start Docker Desktop, wait until it shows 'Engine running', then retry."
	exit 1
}

[ -f "$FIREBASE_SA_FILE" ] || {
	echo "Firebase service account JSON not found at: $FIREBASE_SA_FILE"
	exit 1
}

TAG="v$(( $(cat "$PROJECT_ROOT/$TAG_STATE_FILE" 2>/dev/null || echo 0) + 1 ))"
printf '%s\n' "${TAG#v}" > "$PROJECT_ROOT/$TAG_STATE_FILE"

API_IMAGE="$REGISTRY/$REPO:api-$TAG"
FE_IMAGE="$REGISTRY/$REPO:fe-$TAG"

DOCKER_PROJECT_ROOT="$PROJECT_ROOT"
K8S_PROJECT_ROOT="$PROJECT_ROOT"
if [ -f /proc/version ] && grep -qi microsoft /proc/version && command -v wslpath >/dev/null 2>&1; then
	[ "$DOCKER_IS_EXE" -eq 1 ] && DOCKER_PROJECT_ROOT="$(wslpath -w "$PROJECT_ROOT")"
	[ "$KUBECTL_IS_EXE" -eq 1 ] && K8S_PROJECT_ROOT="$(wslpath -w "$PROJECT_ROOT")"
fi

echo "Building frontend image: $FE_IMAGE"
docker build \
	--build-arg BACKEND_API_URL="$BACKEND_API_URL" \
	-t "$FE_IMAGE" \
	"$DOCKER_PROJECT_ROOT/frontend"

source "$SCRIPT_DIR/deploy-gps.run.sh"