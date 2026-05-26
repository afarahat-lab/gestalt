#!/bin/bash
# setup-github.sh
# Run this once after cloning to initialize git and push to your GitHub repo.
# Usage: ./scripts/setup-github.sh <github-username> <github-token>

set -e

GITHUB_USERNAME=$1
GITHUB_TOKEN=$2
REPO_NAME="openharness"

if [ -z "$GITHUB_USERNAME" ] || [ -z "$GITHUB_TOKEN" ]; then
  echo "Usage: ./scripts/setup-github.sh <github-username> <github-token>"
  echo ""
  echo "To create a GitHub token:"
  echo "  1. Go to https://github.com/settings/tokens"
  echo "  2. Generate new token (classic)"
  echo "  3. Select scopes: repo (full control)"
  exit 1
fi

echo "Creating GitHub repository '$REPO_NAME'..."

curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/user/repos \
  -d "{
    \"name\": \"$REPO_NAME\",
    \"description\": \"Open-source self-hosted agent-first software development platform\",
    \"private\": false,
    \"auto_init\": false
  }"

echo ""
echo "Initializing git and pushing..."

git init
git add .
git commit -m "chore: initial project structure

Sets up the OpenHarness monorepo with:
- Full documentation (ARCHITECTURE.md, DECISIONS.md, DOMAIN.md, GOLDEN_PRINCIPLES.md)
- AGENTS.md for agent orientation
- HARNESS.json machine-readable metadata
- pnpm workspace configuration
- Package structure for core, cli, server, dashboard, agents, and adapters
- Docker Compose deployment configuration
- Environment configuration template"

git branch -M main
git remote add origin "https://$GITHUB_USERNAME:$GITHUB_TOKEN@github.com/$GITHUB_USERNAME/$REPO_NAME.git"
git push -u origin main

echo ""
echo "Done! Repository available at: https://github.com/$GITHUB_USERNAME/$REPO_NAME"
