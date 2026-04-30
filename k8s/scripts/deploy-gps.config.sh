#!/usr/bin/env bash

# Centralized deployment parameters. Update these here instead of the launcher.
REGISTRY="${REGISTRY:-}"
REPO="${REPO:-gps_installation}"
TAG_STATE_FILE="${TAG_STATE_FILE:-.deploy-tag}"
GCP_NAMESPACE="${GCP_NAMESPACE:-}"

FIREBASE_SA_DEFAULT="./gps-integration-b1a2e-firebase-adminsdk-fbsvc-85d47bd9e0.json"
FIREBASE_SA_FILE="${FIREBASE_SERVICE_ACCOUNT_FILE:-$FIREBASE_SA_DEFAULT}"

if [ -f /proc/version ] && grep -qi microsoft /proc/version && [[ "$FIREBASE_SA_FILE" == /mnt/[a-zA-Z]/* ]]; then
	DRIVE_LETTER="${FIREBASE_SA_FILE:5:1}"
	FIREBASE_SA_FILE="${DRIVE_LETTER^}:/${FIREBASE_SA_FILE:7}"
fi

BACKEND_API_URL="${BACKEND_API_URL:-/api}"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:pass@gps-db:5432/postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-pass}"
FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-gps-integration-b1a2e}"
COMPANY_EMAIL_DOMAIN="${COMPANY_EMAIL_DOMAIN:-letstransport.team}"
API_PORT="${API_PORT:-3002}"
FE_PORT="${FE_PORT:-4174}"
K8S_DIR="${K8S_DIR:-k8s}"