docker build -t "$API_IMAGE" "${DOCKER_PROJECT_ROOT:-$PROJECT_ROOT}/api"

docker image inspect "$FE_IMAGE" >/dev/null
docker image inspect "$API_IMAGE" >/dev/null

docker push "$FE_IMAGE"
docker push "$API_IMAGE"
docker pull "$FE_IMAGE"
docker pull "$API_IMAGE"

docker network create gps-net >/dev/null 2>&1 || true
docker volume create gps-db-data >/dev/null 2>&1 || true
docker rm -f gps-fe gps-api gps-db >/dev/null 2>&1 || true

docker run -d --name gps-db --network gps-net -p 5432:5432 -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" -v gps-db-data:/var/lib/postgresql/data postgres:16-alpine
docker run --rm --network gps-net -e PGPASSWORD="$POSTGRES_PASSWORD" postgres:16-alpine sh -c 'until pg_isready -h gps-db -U postgres >/dev/null 2>&1; do sleep 1; done'
docker run -d --name gps-api --network gps-net -p "$API_PORT:3002" -e DATABASE_URL="$DATABASE_URL" -e FIREBASE_SERVICE_ACCOUNT_PATH=/app/secrets/firebase-service-account.json -e FIREBASE_PROJECT_ID="$FIREBASE_PROJECT_ID" -e COMPANY_EMAIL_DOMAIN="$COMPANY_EMAIL_DOMAIN" -v "$FIREBASE_SA_FILE:/app/secrets/firebase-service-account.json:ro" "$API_IMAGE"
api_ready=0
for i in $(seq 1 60); do
	if docker exec gps-api wget --quiet --tries=1 --spider http://localhost:3002/health >/dev/null 2>&1; then
		api_ready=1
		break
	fi

	if ! docker ps --format '{{.Names}}' | grep -q '^gps-api$'; then
		echo "gps-api container exited before becoming healthy"
		docker logs gps-api --tail 200 || true
		exit 1
	fi

	sleep 2
done

if [ "$api_ready" -ne 1 ]; then
	echo "gps-api did not become healthy in time"
	docker logs gps-api --tail 200 || true
	exit 1
fi

docker run -d --name gps-fe --network gps-net -p "$FE_PORT:80" "$FE_IMAGE"

kubectl apply -f "${K8S_PROJECT_ROOT:-$PROJECT_ROOT}/$K8S_DIR/"
kubectl set image deploy/gps-api api="$API_IMAGE"
kubectl set image deploy/gps-frontend frontend="$FE_IMAGE"
kubectl rollout status deploy/gps-api --timeout=300s
kubectl rollout status deploy/gps-frontend --timeout=300s