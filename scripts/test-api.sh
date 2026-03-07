#!/usr/bin/env bash
# Quick smoke test for backend API after review fixes.
# Usage: AGEMON_KEY=test bun run src/server.ts &  (in backend/ dir)
#        ./scripts/test-api.sh

set -eo pipefail

BASE="${API_BASE:-http://127.0.0.1:3000}"
KEY="${AGEMON_KEY:-test}"
AUTH="Authorization: Bearer $KEY"
PASS=0
FAIL=0

check() {
  local desc="$1" expected_status="$2" method="$3" path="$4"
  shift 4

  local status
  if [[ $# -gt 0 ]]; then
    status=$(curl -s -o /tmp/agemon_test_body -w "%{http_code}" \
      -X "$method" \
      -H "$AUTH" \
      -H "Content-Type: application/json" \
      -d "$1" \
      "$BASE$path")
  else
    status=$(curl -s -o /tmp/agemon_test_body -w "%{http_code}" \
      -X "$method" \
      -H "$AUTH" \
      -H "Content-Type: application/json" \
      "$BASE$path")
  fi

  if [[ "$status" == "$expected_status" ]]; then
    echo "  PASS  $desc ($status)"
    PASS=$((PASS+1))
  else
    echo "  FAIL  $desc (expected $expected_status, got $status)"
    cat /tmp/agemon_test_body 2>/dev/null; echo
    FAIL=$((FAIL+1))
  fi
}

body() { cat /tmp/agemon_test_body; }
jq_field() { body | python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

echo "=== Health ==="
check "health endpoint" 200 GET /api/health

echo ""
echo "=== Auth ==="
BAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer wrong" "$BASE/api/tasks")
if [[ "$BAD_STATUS" == "401" ]]; then
  echo "  PASS  bad key returns 401"
  PASS=$((PASS+1))
else
  echo "  FAIL  bad key returns 401 (got $BAD_STATUS)"
  FAIL=$((FAIL+1))
fi

echo ""
echo "=== Create Tasks ==="
check "create task (no repos)" 201 POST /api/tasks \
  '{"title":"Test task A"}'

TASK_A=$(jq_field "['id']")

check "create task (with repos)" 201 POST /api/tasks \
  '{"title":"Test task B","repos":["git@github.com:acme/web.git"],"agent":"claude-code"}'

TASK_B=$(jq_field "['id']")

check "create task (bad SSH url)" 400 POST /api/tasks \
  '{"title":"Bad","repos":["https://github.com/acme/web"]}'

check "create task (no title)" 400 POST /api/tasks \
  '{"description":"missing title"}'

echo ""
echo "=== Read Tasks ==="
check "list tasks" 200 GET /api/tasks
check "get task A" 200 GET "/api/tasks/$TASK_A"
check "get task B" 200 GET "/api/tasks/$TASK_B"
check "tasks by-project" 200 GET /api/tasks/by-project

# Verify by-project has no leaking join columns
PROJ_BODY=$(body)
if echo "$PROJ_BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for tasks in d.get('projects', {}).values():
    for t in tasks:
        assert 'repo_url' not in t, 'repo_url leaked'
        assert 'repo_name' not in t, 'repo_name leaked'
for t in d.get('ungrouped', []):
    assert 'repo_url' not in t
    assert 'repo_name' not in t
" 2>/dev/null; then
  echo "  PASS  by-project no leaked join columns"
  PASS=$((PASS+1))
else
  echo "  FAIL  by-project has leaked join columns"
  FAIL=$((FAIL+1))
fi

echo ""
echo "=== Update Tasks ==="
check "update title" 200 PATCH "/api/tasks/$TASK_A" \
  '{"title":"Updated task A"}'

check "add repos to task" 200 PATCH "/api/tasks/$TASK_A" \
  '{"repos":["git@github.com:acme/api.git"]}'

REPOS_COUNT=$(jq_field "['repos'].__len__()")
if [[ "$REPOS_COUNT" == "1" ]]; then
  echo "  PASS  repos attached after update (count=$REPOS_COUNT)"
  PASS=$((PASS+1))
else
  echo "  FAIL  repos count should be 1, got $REPOS_COUNT"
  FAIL=$((FAIL+1))
fi

echo ""
echo "=== Repos Registry ==="
check "list repos" 200 GET /api/repos

echo ""
echo "=== Start/Stop Agent ==="
# Use a task with no repos so worktree creation is skipped
check "create task for agent test" 201 POST /api/tasks \
  '{"title":"Agent test task"}'
TASK_AGENT=$(jq_field "['id']")

# If claude-agent-acp is on PATH, start succeeds (202); otherwise 500
if command -v claude-agent-acp &>/dev/null; then
  check "start agent (binary on PATH)" 202 POST "/api/tasks/$TASK_AGENT/start"
  # Agent may exit quickly if not configured — stop may find it already gone
  sleep 1
  STOP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "$AUTH" "$BASE/api/tasks/$TASK_AGENT/stop")
  if [[ "$STOP_STATUS" == "200" || "$STOP_STATUS" == "404" ]]; then
    echo "  PASS  stop agent ($STOP_STATUS — agent may have already exited)"
    PASS=$((PASS+1))
  else
    echo "  FAIL  stop agent (expected 200 or 404, got $STOP_STATUS)"
    FAIL=$((FAIL+1))
  fi
else
  check "start agent (no binary on PATH)" 500 POST "/api/tasks/$TASK_AGENT/start"
  check "stop agent (no running session)" 404 POST "/api/tasks/$TASK_AGENT/stop"
fi

# Clean up agent test task
curl -s -o /dev/null -X DELETE -H "$AUTH" "$BASE/api/tasks/$TASK_AGENT"

echo ""
echo "=== Delete Task ==="
check "delete task A" 204 DELETE "/api/tasks/$TASK_A"
check "get deleted task A" 404 GET "/api/tasks/$TASK_A"

echo ""
echo "=== Events ==="
check "list events" 200 GET "/api/tasks/$TASK_B/events"

echo ""
echo "=== Archive Tasks ==="
# Create a task to test archiving
check "create archive test task" 201 POST /api/tasks \
  '{"title":"Archive me"}'
TASK_ARC=$(jq_field "['id']")

# Verify archived defaults to false
ARC_VAL=$(jq_field "['archived']")
if [[ "$ARC_VAL" == "False" ]]; then
  echo "  PASS  new task archived=false"
  PASS=$((PASS+1))
else
  echo "  FAIL  expected archived=False, got $ARC_VAL"
  FAIL=$((FAIL+1))
fi

# Archive the task
check "archive task" 200 PATCH "/api/tasks/$TASK_ARC" \
  '{"archived":true}'
ARC_VAL=$(jq_field "['archived']")
if [[ "$ARC_VAL" == "True" ]]; then
  echo "  PASS  task archived=true after PATCH"
  PASS=$((PASS+1))
else
  echo "  FAIL  expected archived=True, got $ARC_VAL"
  FAIL=$((FAIL+1))
fi

# Default list excludes archived
check "list tasks (default)" 200 GET /api/tasks
TASK_COUNT=$(body | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
# Should still have TASK_B (not archived) but not TASK_ARC
if echo "$TASK_COUNT" | grep -qE '^[0-9]+$'; then
  # Check that TASK_ARC is NOT in the list
  ARC_IN_LIST=$(body | python3 -c "import sys,json; ids=[t['id'] for t in json.load(sys.stdin)]; print('$TASK_ARC' in ids)")
  if [[ "$ARC_IN_LIST" == "False" ]]; then
    echo "  PASS  archived task excluded from default list"
    PASS=$((PASS+1))
  else
    echo "  FAIL  archived task should be excluded from default list"
    FAIL=$((FAIL+1))
  fi
fi

# ?archived=true includes it
check "list tasks (archived=true)" 200 GET "/api/tasks?archived=true"
ARC_IN_LIST=$(body | python3 -c "import sys,json; ids=[t['id'] for t in json.load(sys.stdin)]; print('$TASK_ARC' in ids)")
if [[ "$ARC_IN_LIST" == "True" ]]; then
  echo "  PASS  archived task included with ?archived=true"
  PASS=$((PASS+1))
else
  echo "  FAIL  archived task should be in ?archived=true list"
  FAIL=$((FAIL+1))
fi

# Unarchive
check "unarchive task" 200 PATCH "/api/tasks/$TASK_ARC" \
  '{"archived":false}'

# Clean up
curl -s -o /dev/null -X DELETE -H "$AUTH" "$BASE/api/tasks/$TASK_ARC"

echo ""
echo "=== Cleanup ==="
check "delete task B" 204 DELETE "/api/tasks/$TASK_B"

echo ""
echo "================================"
echo "  Results: $PASS passed, $FAIL failed"
echo "================================"

rm -f /tmp/agemon_test_body
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
