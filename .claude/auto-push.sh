#!/usr/bin/env bash
# Auto-sync Float to the GitHub "Budgeting" repo.
# Wired as a Claude Code Stop hook (see ../../.claude/settings.local.json) so it
# fires whenever a turn ends. It only acts when budget-app actually has changes,
# so turns that don't touch this app produce no commits. data.json is gitignored,
# so personal financial data is never pushed.

REPO="C:/Users/jacobsalisbury/Desktop/Claude Projects/budget-app"

cd "$REPO" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Nothing staged/unstaged/untracked (respecting .gitignore)? Do nothing, silently.
[ -n "$(git status --porcelain)" ] || exit 0

git add -A
git commit -q -m "Auto-sync: $(date '+%Y-%m-%d %H:%M:%S')" >/dev/null 2>&1 || exit 0

if git push -q origin main >/dev/null 2>&1; then
  printf '{"systemMessage":"Synced Float to the Budgeting repo \\u2713"}'
else
  printf '{"systemMessage":"Float committed locally; GitHub push failed (offline?). It will push on the next change."}'
fi
exit 0
