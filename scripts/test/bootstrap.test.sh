#!/usr/bin/env bash
# bootstrap.sh in a plain ubuntu:24.04 container (run-bootstrap-test.sh starts it). Real: apt, the user, its keys,
# sshd -t, visudo, sudo -l, git clone (from a local bare repository), the files written. Faked, because a container
# has no systemd, clock, firewall or swap of its own: systemctl, timedatectl, ufw, swapon, fallocate, mkswap; Docker
# is skipped (BOOTSTRAP_SKIP_DOCKER=1). The fakes keep their state, so a second run sees what the first one did.
#   1. a dry run changes nothing      2. without keys: SSH is left alone (no lockout)
#   3. with keys: everything set up    4. a second run changes nothing; an edited .env is kept
#   5. a configured backup remote enables the timers, and the run after that changes nothing
# The single-quoted scripts and file contents keep their $ for the shell that runs them later.
# shellcheck disable=SC2016
set -euo pipefail
: "${SRC:?}" "${WORK:?}"
B=$SRC/scripts/bootstrap.sh
failures=0
passed=0
pass() { echo "  ok    $1"; passed=$((passed + 1)); }
fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }
check() { local what=$1; shift; if "$@"; then pass "$what"; else fail "$what"; fi; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -q > /dev/null && apt-get install -y -q git openssh-client > /dev/null

# The fakes and their state.
F=/fake
mkdir -p "$F/bin" "$F/state"
cat > "$F/bin/systemctl" << 'EOF'
#!/bin/sh
echo "systemctl $*" >> /fake/state/calls
case "$1" in
  is-enabled) [ "$2" = --quiet ] && shift; grep -qx "$2" /fake/state/enabled 2> /dev/null ;;
  enable) shift; for u in "$@"; do case "$u" in --now) ;; *) echo "$u" >> /fake/state/enabled ;; esac; done ;;
  *) exit 0 ;;
esac
EOF
cat > "$F/bin/timedatectl" << 'EOF'
#!/bin/sh
echo "timedatectl $*" >> /fake/state/calls
case "$1" in
  show) cat /fake/state/tz 2> /dev/null || echo Etc/UTC ;;
  set-timezone) echo "$2" > /fake/state/tz ;;
esac
EOF
cat > "$F/bin/ufw" << 'EOF'
#!/bin/sh
echo "ufw $*" >> /fake/state/calls
case "$1" in
  status) [ -f /fake/state/ufw ] && echo "Status: active" || echo "Status: inactive" ;;
  --force) touch /fake/state/ufw ;;
esac
EOF
cat > "$F/bin/swapon" << 'EOF'
#!/bin/sh
echo "swapon $*" >> /fake/state/calls
case "$1" in --show) cat /fake/state/swap 2> /dev/null ;; *) echo "/swapfile file 4G 0B -2" > /fake/state/swap ;; esac
EOF
# Like the real one, it leaves the file (empty here), so the chmod after it works.
printf '#!/bin/sh\necho "fallocate $*" >> /fake/state/calls\nfor last; do :; done\n: > "$last"\n' > "$F/bin/fallocate"
printf '#!/bin/sh\necho "mkswap $*" >> /fake/state/calls\n' > "$F/bin/mkswap"
chmod +x "$F"/bin/*
export PATH="$F/bin:$PATH"

# The repository bootstrap clones: a bare copy of this checkout, owned by root here. For every user, since deploy
# clones it (on the VPS, deploy clones over SSH and owns its clone).
git config --system --add safe.directory '*'
git clone -q --bare "$WORK/in/repo.bundle" /srv/origin.git
chmod -R a+rX /srv/origin.git
export BOOTSTRAP_REPO_URL=/srv/origin.git BOOTSTRAP_SKIP_DOCKER=1
ssh-keygen -q -t ed25519 -N '' -C test-owner -f /root/owner
cp /root/owner.pub "$WORK/keys"

run() { # run <args>: output in $WORK/out.log, status returned
  local s=0
  bash "$B" "$@" > "$WORK/out.log" 2>&1 || s=$?
  return "$s"
}
said() { grep -qF -- "$1" "$WORK/out.log"; }
mode() { stat -c '%a %U:%G' "$1"; }

echo "1. a dry run"
s=0; run --dry-run --authorized-keys "$WORK/keys" || s=$?
check "exits 0" test "$s" = 0
check "says what it would do" said "would create deploy"
check "and how many changes" grep -qE 'dry run, [0-9]+ change\(s\) would be made' "$WORK/out.log"
check "creates no user" bash -c '! id deploy > /dev/null 2>&1'
check "writes no sudo rule, no cron line, no clone" bash -c '[ ! -e /etc/sudoers.d/sirat-deploy ] && [ ! -e /etc/cron.d/sirat-monitor ] && [ ! -e /srv/sirat ]'

echo "2. without keys: no lockout"
s=0; run || s=$?
check "exits 0 (apt installed the packages)" test "$s" = 0
check "deploy exists, in the docker group" grep -qx docker <<< "$(id -nG deploy | tr ' ' '\n')"
check "deploy has no password (its login is locked)" bash -c '[ "$(passwd -S deploy | cut -d" " -f2)" = L ]'
check "SSH is left alone" test ! -e /etc/ssh/sshd_config.d/50-sirat.conf
check "and it says why" said "SSH stays as it is until deploy has keys"

echo "3. with keys"
s=0; run --authorized-keys "$WORK/keys" || s=$?
check "exits 0" test "$s" = 0
check "authorized_keys holds the key (600, .ssh 700)" bash -c "[ \"\$(cat /home/deploy/.ssh/authorized_keys)\" = \"\$(cat $WORK/keys)\" ] && [ \"\$(stat -c %a /home/deploy/.ssh/authorized_keys)\" = 600 ] && [ \"\$(stat -c %a /home/deploy/.ssh)\" = 700 ]"
check "sshd: no root login, no passwords" bash -c 'grep -qx "PermitRootLogin no" /etc/ssh/sshd_config.d/50-sirat.conf && grep -qx "PasswordAuthentication no" /etc/ssh/sshd_config.d/50-sirat.conf'
check "sshd -t accepts it" bash -c 'mkdir -p /run/sshd && sshd -t'
check "ssh was reloaded" grep -qx "systemctl reload ssh" /fake/state/calls
check "the sudo rule is exactly one command" bash -c '[ "$(grep -v "^#" /etc/sudoers.d/sirat-deploy)" = "deploy ALL=(root) NOPASSWD: /usr/bin/systemctl start sirat-backup.service" ]'
check "visudo accepts it (440 root)" bash -c 'visudo -cqf /etc/sudoers.d/sirat-deploy && [ "$(stat -c "%a %U" /etc/sudoers.d/sirat-deploy)" = "440 root" ]'
rules=$(sudo -l -U deploy | grep -F 'NOPASSWD:' | tr -s ' ' || true)
check "sudo -l: deploy may run exactly that one command" test "$rules" = " (root) NOPASSWD: /usr/bin/systemctl start sirat-backup.service"
check "the clone is this checkout" bash -c "[ \"\$(git -C /srv/sirat rev-parse HEAD)\" = \"\$(git -C /srv/origin.git rev-parse HEAD)\" ] && [ \"\$(stat -c %U /srv/sirat)\" = deploy ]"
check "GitHub's pinned host key has its published fingerprint" \
  grep -q 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU' <<< "$(ssh-keygen -lf /home/deploy/.ssh/known_hosts)"
check ".env from its example, 600 deploy" bash -c '[ "$(stat -c "%a %U:%G" /srv/sirat/.env)" = "600 deploy:deploy" ] && cmp -s /srv/sirat/.env /srv/sirat/.env.example'
check ".env.deploy names the project" bash -c 'grep -qx DEPLOY_PROJECT=sirat /srv/sirat/.env.deploy && [ "$(stat -c %a /srv/sirat/.env.deploy)" = 600 ]'
check ".env.monitor names the project" bash -c 'grep -qx MONITOR_PROJECT=sirat /srv/sirat/.env.monitor && [ "$(stat -c %a /srv/sirat/.env.monitor)" = 600 ]'
check "/etc/sirat/backup.env, 600 root, names the project" bash -c 'grep -qx BACKUP_PROJECT=sirat /etc/sirat/backup.env && [ "$(stat -c "%a %U" /etc/sirat/backup.env)" = "600 root" ]'
check "/var/lib/sirat is deploy's" test "$(mode /var/lib/sirat)" = "755 deploy:deploy"
check "the four backup units are installed" bash -c 'for u in sirat-backup.service sirat-backup.timer sirat-backup-verify.service sirat-backup-verify.timer; do cmp -s /srv/sirat/infra/backup/$u /etc/systemd/system/$u || exit 1; done'
check "the backup timers wait for a remote" bash -c '! grep -q "enable --now sirat-backup.timer" /fake/state/calls && grep -qF "fill /etc/sirat/backup.env" '"$WORK/out.log"
check "the monitor's two cron lines" bash -c 'grep -qx "\*/5 \* \* \* \* deploy /srv/sirat/scripts/monitor.sh 2>&1 | logger -t sirat-monitor" /etc/cron.d/sirat-monitor && grep -qx "0 2 \* \* \* deploy /srv/sirat/scripts/monitor.sh --digest 2>&1 | logger -t sirat-monitor" /etc/cron.d/sirat-monitor'
check "overcommit and swap" bash -c 'grep -qx "vm.overcommit_memory = 1" /etc/sysctl.d/90-sirat.conf && grep -q "^/swapfile " /etc/fstab'
check "updates without an automatic reboot" grep -qx 'Unattended-Upgrade::Automatic-Reboot "false";' /etc/apt/apt.conf.d/52sirat-unattended
check "UTC, chrony, fail2ban and the DOCKER-USER guard enabled" bash -c '[ "$(cat /fake/state/tz)" = UTC ] && for u in chrony fail2ban sirat-docker-user; do grep -qx "$u" /fake/state/enabled || exit 1; done'
check "the DOCKER-USER guard lets only 80 and 443 through" bash -c 'grep -q "ctorigdstport 80 -j RETURN" /usr/local/sbin/sirat-docker-user && grep -q "ctorigdstport 443 -j RETURN" /usr/local/sbin/sirat-docker-user && grep -q -- "-j DROP" /usr/local/sbin/sirat-docker-user && [ -x /usr/local/sbin/sirat-docker-user ]'
check "UFW: deny incoming, allow ssh, 80, 443" bash -c 'grep -q "ufw default deny incoming" /fake/state/calls && grep -q "ufw allow 443/tcp" /fake/state/calls'
check "it lists what is left for the owner" bash -c 'grep -q "left for the owner:" '"$WORK/out.log"' && grep -q "provider.s firewall panel" '"$WORK/out.log"
check "no secret value in the output" bash -c '! grep -qiE "password=|secret=.+|token=.+|PRIVATE KEY" '"$WORK/out.log"

echo "4. a second run"
echo 'JWT_ACCESS_SECRET=typed-by-the-owner' >> /srv/sirat/.env
s=0; run --authorized-keys "$WORK/keys" || s=$?
check "exits 0 and changes nothing" bash -c "[ $s = 0 ] && grep -qx 'bootstrap: 0 change(s) made' $WORK/out.log"
check "the edited .env is kept" grep -qx 'JWT_ACCESS_SECRET=typed-by-the-owner' /srv/sirat/.env

echo "5. a backup remote enables the timers"
sed -i 's|^BACKUP_REMOTE=.*|BACKUP_REMOTE=bucket:sirat|' /etc/sirat/backup.env
grep -q '^BACKUP_REMOTE=' /etc/sirat/backup.env || echo 'BACKUP_REMOTE=bucket:sirat' >> /etc/sirat/backup.env
s=0; run || s=$?
check "both timers enabled" bash -c "[ $s = 0 ] && grep -qx sirat-backup.timer /fake/state/enabled && grep -qx sirat-backup-verify.timer /fake/state/enabled"
s=0; run || s=$?
check "and the run after that changes nothing" bash -c "[ $s = 0 ] && grep -qx 'bootstrap: 0 change(s) made' $WORK/out.log"

if [ "$failures" -gt 0 ]; then
  echo "bootstrap's last output:"
  tail -n 40 "$WORK/out.log"
fi
echo "bootstrap tests: $passed passed, $failures failed"
[ "$failures" = 0 ]
