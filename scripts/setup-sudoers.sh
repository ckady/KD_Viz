#!/usr/bin/env bash
#
# Grants the current user passwordless access to `powermetrics` so the
# visualizer can read live GPU utilization, package temperature and thermal
# pressure (powermetrics requires root). This is the ONLY elevated capability
# the app uses, and it's read-only sampling.
#
# Run once:  npm run setup-gpu   (will prompt for your admin password)
#
set -euo pipefail

PM_BIN="$(command -v powermetrics || echo /usr/bin/powermetrics)"
USER_NAME="$(id -un)"
SUDOERS_FILE="/etc/sudoers.d/visualizer-powermetrics"

LINE="${USER_NAME} ALL=(root) NOPASSWD: ${PM_BIN}"

echo "This will allow '${USER_NAME}' to run:"
echo "    sudo ${PM_BIN}"
echo "without a password, via ${SUDOERS_FILE}"
echo

TMP="$(mktemp)"
echo "${LINE}" > "${TMP}"

# Validate syntax before installing — never write an unvalidated sudoers file.
if ! sudo visudo -c -f "${TMP}" >/dev/null; then
  echo "ERROR: generated sudoers line failed validation. Aborting." >&2
  rm -f "${TMP}"
  exit 1
fi

sudo install -m 0440 -o root -g wheel "${TMP}" "${SUDOERS_FILE}"
rm -f "${TMP}"

echo "Installed ${SUDOERS_FILE}"
echo "Verifying passwordless access..."
if sudo -n "${PM_BIN}" -n 1 -i 200 --samplers gpu_power >/dev/null 2>&1; then
  echo "OK — GPU/thermal sampling is enabled."
else
  echo "WARNING: test invocation did not succeed. The app will still run, but"
  echo "GPU/thermal signals may be unavailable."
fi

echo
echo "To remove later:  sudo rm ${SUDOERS_FILE}"
