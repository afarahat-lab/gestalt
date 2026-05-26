#!/bin/bash
# setup-github.sh
# Run this once to initialize git and push to your GitHub repo.
# Usage: ./scripts/setup-github.sh <github-username> <github-token>

set -e

GITHUB_USERNAME=$1
GITHUB_TOKEN=$2
REPO_NAME="agentforge-sdlc"

if [ -z "$GITHUB_USERNAME" ] || [ -z "$GITHUB_TOKEN" ]; then
  echo "Usage: ./scripts/setup-github.sh <github-username> <github-token>"
  echo ""
  echo "To create a GitHub token:"
  echo "  1. Go to https://github.com/settings/tokens"
  echo "  2. Generate new token (classic)"
  echo "  3. Select scopes: repo (full control)"
  exit 1
fi

echo "Initializing git and pushing to github.com/$GITHUB_USERNAME/$REPO_NAME..."

git init
git add .
git commit -m "chore: initial project structure

Sets up the AgentForge SDLC monorepo with:
- Full documentation (ARCHITECTURE.md, DECISIONS.md, DOMAIN.md,
  GOLDEN_PRINCIPLES.md, INITIALIZER.md)
- AGENTS.md for agent orientation
- HARNESS.json with Layer 2 initializer spec
- pnpm workspace configuration
- Package structure for core, cli, server, dashboard, agents, and adapters
- Docker Compose deployment configuration
- Environment configuration template
- Session archive in .github/DISCUSSION/"

git branch -M main
git remote add origin "https://$GITHUB_USERNAME:$GITHUB_TOKEN@github.com/$GITHUB_USERNAME/$REPO_NAME.git"
git push -u origin main

echo ""
echo "Done! Repository: https://github.com/$GITHUB_USERNAME/$REPO_NAME"
