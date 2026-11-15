#!/bin/sh
# The boosted-tree models (CatBoost, XGBoost) train through boosted-tree-worker.py, and
# neither package is in this VM's system interpreter — pip cannot write to its
# site-packages. This builds a project-local environment instead; the training engine
# finds .venv/bin/python on its own, so nothing has to be exported.
#
# Dependencies are not part of a workspace checkpoint, so run this again after a restore.
set -e

cd "$(dirname "$0")/.."

if [ ! -x .venv/bin/python ]; then
  echo "creating .venv"
  python3 -m venv .venv
fi

.venv/bin/python -m pip install --upgrade pip >/dev/null
.venv/bin/python -m pip install xgboost catboost

.venv/bin/python - <<'PY'
import catboost
import xgboost

print(f"catboost {catboost.__version__} and xgboost {xgboost.__version__} are importable")
PY
