#!/usr/bin/env bash
# A fresh Ubuntu 24.04 VPS, ready for scripts/deploy.sh --first (L12, LAUNCH-PLAN section 2; RUNBOOK section 6).
# Run as root. Idempotent: every step looks first and changes only what differs, so a second run changes nothing.
#
#   bootstrap.sh --authorized-keys <file> [--swap-gb <n>] [--dry-run]
#
#   --authorized-keys  the public keys that may log in as `deploy` (the owner and one named backup person). Needed
#                      until deploy has keys; password and root logins are turned off only once it has.
#   --swap-gb          swap file size when the host has none (default 4)
#   --dry-run          prints each change it would make, changes nothing
#
# It sets up: Docker from Docker's own apt repository; UTC and chrony; swap and vm.overcommit_memory=1; security
# updates without automatic reboot; the `deploy` user (SSH keys only, no root or password login); UFW for the host
# and a DOCKER-USER guard (UFW does not see Docker's published ports: only 80 and 443 may reach a container);
# fail2ban for SSH; the clone in /srv/sirat through a read-only deploy key; /var/lib/sirat; `.env`, `.env.deploy` and
# `.env.monitor` from their examples (mode 600, never overwritten: the owner types the secrets); the backup units and
# /etc/sirat/backup.env; the monitor's cron lines; and one sudo rule: deploy may start sirat-backup.service.
# It prints what is left for the owner at the end. It never prints a secret.
# The single-quoted scripts and file contents keep their $ for the shell that runs them later.
# shellcheck disable=SC2016
set -euo pipefail
umask 022

REPO_URL="${BOOTSTRAP_REPO_URL:-git@github.com:RaselMridha792/sirat-olympiad.git}"
CLONE=/srv/sirat
STATE=/var/lib/sirat
ETC=/etc/sirat
USER_NAME=deploy
DRY=0
KEYS=''
SWAP_GB=4
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --authorized-keys)
      KEYS="${2:?--authorized-keys needs a file}"
      shift
      ;;
    --swap-gb)
      SWAP_GB="${2:?--swap-gb needs a number}"
      shift
      ;;
    *)
      echo "usage: bootstrap.sh --authorized-keys <file> [--swap-gb <n>] [--dry-run]" >&2
      exit 2
      ;;
  esac
  shift
done
[[ "$SWAP_GB" =~ ^[0-9]+$ ]] || { echo "bootstrap: --swap-gb must be a whole number" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "bootstrap: run as root" >&2; exit 1; }
grep -qE '^VERSION_ID="(24|26)\.04"' /etc/os-release 2> /dev/null ||
  echo "bootstrap: WARNING: written for Ubuntu 24.04 and 26.04 LTS"

CHANGES=0
LEFT=()
step() { echo "== $*"; }
ok() { echo "   ok    $*"; }
# change <what> <command...>: runs the command, or only says so in a dry run.
change() {
  local what=$1
  shift
  CHANGES=$((CHANGES + 1))
  if [ "$DRY" = 1 ]; then echo "   would $what"; else
    echo "   do    $what"
    "$@"
  fi
}
left() { LEFT+=("$*"); }
# put <path> <mode> <owner> <content>: writes the file when its content, mode or owner differ.
put() {
  local path=$1 mode=$2 owner=$3 content=$4
  if [ -f "$path" ] && [ "$(cat "$path")" = "$content" ] && [ "$(stat -c '%a %U:%G' "$path")" = "$mode $owner" ]; then
    ok "$path"
    return 0
  fi
  change "write $path ($mode $owner)" install_content "$path" "$mode" "$owner" "$content"
}
install_content() {
  local tmp
  tmp=$(mktemp)
  printf '%s\n' "$4" > "$tmp"
  install -D -m "$2" -o "${3%%:*}" -g "${3##*:}" "$tmp" "$1"
  rm -f "$tmp"
}
# A file from the clone's example, only when missing (the owner fills it; never overwritten).
from_example() { # from_example <example> <target> <owner> [KEY=value ...]
  local example=$1 target=$2 owner=$3
  shift 3
  if [ -f "$target" ]; then
    ok "$target exists (left as it is)"
    [ "$(stat -c '%a' "$target")" = 600 ] || change "chmod 600 $target" chmod 600 "$target"
    return 0
  fi
  if [ ! -f "$example" ]; then
    left "$target: the clone is not there yet; run bootstrap again after it is"
    return 0
  fi
  change "create $target from $(basename "$example") (mode 600)" from_example_now "$example" "$target" "$owner" "$@"
  left "type the values into $target (it was copied from its example)"
}
from_example_now() {
  local example=$1 target=$2 owner=$3 kv
  shift 3
  install -m 600 -o "${owner%%:*}" -g "${owner##*:}" "$example" "$target"
  for kv in "$@"; do sed -i "s|^${kv%%=*}=.*|$kv|" "$target"; done
}

# ---------------- packages and Docker ----------------
step "packages"
PKGS=(ca-certificates curl git jq gnupg chrony fail2ban unattended-upgrades ufw age rclone util-linux cron sudo
  openssh-server iptables iproute2)
missing=()
for p in "${PKGS[@]}"; do dpkg -s "$p" > /dev/null 2>&1 || missing+=("$p"); done
if [ "${#missing[@]}" -gt 0 ]; then
  change "apt install ${missing[*]}" bash -c "apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q ${missing[*]}"
else
  ok "all packages present"
fi

step "Docker (Docker's apt repository)"
if [ "${BOOTSTRAP_SKIP_DOCKER:-0}" = 1 ]; then
  ok "skipped (BOOTSTRAP_SKIP_DOCKER=1, tests only)"
  getent group docker > /dev/null || change "add the docker group" groupadd docker
elif dpkg -s docker-ce > /dev/null 2>&1 && dpkg -s docker-compose-plugin > /dev/null 2>&1; then
  ok "docker-ce and the compose plugin are installed"
else
  change "install docker-ce, its CLI, containerd, buildx and compose from download.docker.com" bash -c '
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    . /etc/os-release
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -q
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker'
fi

# ---------------- time, memory, updates ----------------
step "time: UTC with chrony (the monitor's 02:00 UTC digest is 08:00 Asia/Dhaka)"
# Etc/UTC is the same zone under its other name (cloud images ship it).
case "$(timedatectl show -p Timezone --value 2> /dev/null || true)" in
  UTC | Etc/UTC) ok "timezone UTC" ;;
  *) change "set the timezone to UTC" timedatectl set-timezone UTC ;;
esac
if systemctl is-enabled --quiet chrony 2> /dev/null; then ok "chrony enabled"; else change "enable chrony" systemctl enable --now chrony; fi

step "memory: swap and overcommit (Redis needs vm.overcommit_memory=1)"
if [ -n "$(swapon --show --noheadings 2> /dev/null || true)" ] || grep -q '^/swapfile ' /etc/fstab 2> /dev/null; then
  ok "swap present"
else
  change "make a ${SWAP_GB} GB /swapfile" bash -c "fallocate -l ${SWAP_GB}G /swapfile && chmod 600 /swapfile && mkswap /swapfile > /dev/null && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab"
fi
put /etc/sysctl.d/90-sirat.conf 644 root:root '# scripts/bootstrap.sh (L12): Redis background saves need overcommit; swap only under pressure.
vm.overcommit_memory = 1
vm.swappiness = 10'
[ "$DRY" = 1 ] || sysctl -q --system > /dev/null 2>&1 || true

step "security updates, never an automatic reboot"
put /etc/apt/apt.conf.d/20auto-upgrades 644 root:root 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";'
put /etc/apt/apt.conf.d/52sirat-unattended 644 root:root '// scripts/bootstrap.sh (L12): security updates install by themselves; a reboot is a decision for a person.
Unattended-Upgrade::Automatic-Reboot "false";'

# ---------------- the deploy user and SSH ----------------
step "the $USER_NAME user"
if id "$USER_NAME" > /dev/null 2>&1; then ok "$USER_NAME exists"; else change "create $USER_NAME (no password: its login is locked)" useradd --create-home --shell /bin/bash "$USER_NAME"; fi
if grep -qx docker <<< "$(id -nG "$USER_NAME" 2> /dev/null | tr ' ' '\n')"; then
  ok "$USER_NAME is in the docker group"
else
  change "add $USER_NAME to the docker group" usermod -aG docker "$USER_NAME"
fi
HOME_DIR=/home/$USER_NAME
AUTH=$HOME_DIR/.ssh/authorized_keys
if [ -n "$KEYS" ]; then
  [ -s "$KEYS" ] || { echo "bootstrap: $KEYS is empty or missing" >&2; exit 1; }
  keys=$(grep -E '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp[0-9]+|sk-ssh-ed25519@openssh.com) ' "$KEYS" || true)
  [ -n "$keys" ] || { echo "bootstrap: $KEYS holds no public key" >&2; exit 1; }
  [ -d "$HOME_DIR/.ssh" ] || change "create $HOME_DIR/.ssh" install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$HOME_DIR/.ssh"
  put "$AUTH" 600 "$USER_NAME:$USER_NAME" "$keys"
fi
HAS_KEYS=0
if [ -s "$AUTH" ] || { [ "$DRY" = 1 ] && [ -n "$KEYS" ]; }; then HAS_KEYS=1; fi

step "SSH: keys only, no root login"
if [ "$HAS_KEYS" = 1 ]; then
  SSHD_CONF='# scripts/bootstrap.sh (L12): the deploy user logs in with a key; nobody logs in as root or with a password.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes'
  # sshd keeps the first value it reads, and it reads the drop-ins in lexical order: the file must sort first, or a
  # cloud image's 50-cloud-init.conf (PasswordAuthentication yes) wins. The name used before this rule is removed.
  DROPIN=/etc/ssh/sshd_config.d/00-sirat.conf
  OLD_DROPIN=/etc/ssh/sshd_config.d/50-sirat.conf
  before=$(cat "$DROPIN" 2> /dev/null || true)
  [ ! -e "$OLD_DROPIN" ] || { change "remove the old $OLD_DROPIN" rm -f "$OLD_DROPIN"; before=changed; }
  put "$DROPIN" 644 root:root "$SSHD_CONF"
  if [ "$DRY" = 0 ]; then
    mkdir -p /run/sshd
    if [ "$before" != "$SSHD_CONF" ]; then
      if sshd -t; then
        change "reload ssh" systemctl reload ssh
      else
        rm -f "$DROPIN"
        echo "bootstrap: sshd -t refused the new settings; they were removed" >&2
        exit 1
      fi
    fi
    # What sshd really does, whatever else sits in sshd_config.d: every run checks it, not only the one that wrote.
    effective=$(sshd -T 2> /dev/null || true)
    for want in 'passwordauthentication no' 'permitrootlogin no' 'kbdinteractiveauthentication no'; do
      if ! grep -qx "$want" <<< "$effective"; then
        rm -f "$DROPIN"
        systemctl reload ssh || true
        echo "bootstrap: sshd -T does not show '$want' in effect (an earlier file in /etc/ssh/sshd_config.d overrides it); $DROPIN was removed and ssh reloaded" >&2
        exit 1
      fi
    done
    ok "sshd -T: no passwords, no root login, no keyboard-interactive login"
  fi
else
  left "SSH stays as it is until $USER_NAME has keys: run again with --authorized-keys <file> (no lockout)"
fi

# ---------------- firewall ----------------
step "firewall: UFW for the host, and a DOCKER-USER guard for containers"
if grep -q '^Status: active' <<< "$(ufw status 2> /dev/null || true)"; then
  ok "UFW active"
else
  change "UFW: deny incoming; allow ssh, 80 and 443; enable" bash -c 'ufw default deny incoming > /dev/null && ufw default allow outgoing > /dev/null && ufw allow OpenSSH > /dev/null && ufw allow 80/tcp > /dev/null && ufw allow 443/tcp > /dev/null && ufw --force enable > /dev/null'
fi
# Docker publishes ports through its own iptables chains, ahead of UFW: from outside, only connections to 80 and 443
# (nginx) may reach a container, so a stray `ports:` in compose can never expose Postgres, PgBouncer or Redis.
put /usr/local/sbin/sirat-docker-user 755 root:root '#!/bin/sh
# scripts/bootstrap.sh (L12), started by sirat-docker-user.service after Docker.
set -e
ext=$(ip -4 route show default | awk "NR == 1 {print \$5}")
[ -n "$ext" ] || exit 0
iptables -N DOCKER-USER 2>/dev/null || true
iptables -F DOCKER-USER
iptables -A DOCKER-USER -i "$ext" -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
iptables -A DOCKER-USER -i "$ext" -p tcp -m conntrack --ctorigdstport 80 -j RETURN
iptables -A DOCKER-USER -i "$ext" -p tcp -m conntrack --ctorigdstport 443 -j RETURN
iptables -A DOCKER-USER -i "$ext" -j DROP
iptables -A DOCKER-USER -j RETURN'
put /etc/systemd/system/sirat-docker-user.service 644 root:root '[Unit]
Description=Sirat: only ports 80 and 443 may reach a container from outside (scripts/bootstrap.sh, L12)
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/sirat-docker-user
RemainAfterExit=yes

[Install]
WantedBy=docker.service'
if systemctl is-enabled --quiet sirat-docker-user 2> /dev/null; then ok "sirat-docker-user enabled"; else change "enable sirat-docker-user" bash -c 'systemctl daemon-reload && systemctl enable --now sirat-docker-user'; fi
left "the provider's firewall panel: allow only 22, 80 and 443 (the outside port scan in RUNBOOK section 9 checks it)"

step "fail2ban for SSH"
put /etc/fail2ban/jail.d/sirat.conf 644 root:root '# scripts/bootstrap.sh (L12)
[sshd]
enabled = true
backend = systemd
maxretry = 5
bantime = 1h'
if systemctl is-enabled --quiet fail2ban 2> /dev/null; then ok "fail2ban enabled"; else change "enable fail2ban" systemctl enable --now fail2ban; fi

# ---------------- the clone ----------------
step "the clone in $CLONE (read-only deploy key)"
KEY=$HOME_DIR/.ssh/id_ed25519
if [ -f "$KEY" ]; then ok "$USER_NAME has an SSH key for GitHub"; else
  [ -d "$HOME_DIR/.ssh" ] || change "create $HOME_DIR/.ssh" install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$HOME_DIR/.ssh"
  change "make $USER_NAME's deploy key" su -s /bin/sh "$USER_NAME" -c "ssh-keygen -q -t ed25519 -N '' -C sirat-vps-deploy-key -f $KEY"
fi
# GitHub's published SSH host key (GitHub docs, "GitHub's SSH key fingerprints"), pinned, never trusted on first use.
GITHUB_KEY='github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'
put "$HOME_DIR/.ssh/known_hosts" 644 "$USER_NAME:$USER_NAME" "$GITHUB_KEY"
if [ -d "$CLONE/.git" ]; then
  ok "$CLONE is a clone"
elif [ "$DRY" = 1 ]; then
  CHANGES=$((CHANGES + 1))
  echo "   would clone $REPO_URL into $CLONE (once the deploy key is added on GitHub)"
elif su -s /bin/sh "$USER_NAME" -c "git ls-remote '$REPO_URL' HEAD" > /dev/null 2>&1; then
  install -d -m 755 -o "$USER_NAME" -g "$USER_NAME" "$CLONE"
  change "clone the repository into $CLONE" su -s /bin/sh "$USER_NAME" -c "git clone -q '$REPO_URL' $CLONE"
else
  left "add $USER_NAME's public key below on GitHub as a READ-ONLY deploy key, then run bootstrap again:"
  if [ -f "$KEY.pub" ]; then left "    $(cat "$KEY.pub")"; fi
fi

# ---------------- state, settings, backups, monitor, sudo ----------------
step "$STATE (the release file, the deploy lock, the monitor state)"
if [ -d "$STATE" ] && [ "$(stat -c '%a %U' "$STATE")" = "755 $USER_NAME" ]; then ok "$STATE"; else change "create $STATE (755 $USER_NAME)" install -d -m 755 -o "$USER_NAME" -g "$USER_NAME" "$STATE"; fi

step "settings from their examples (the owner types the values)"
from_example "$CLONE/.env.example" "$CLONE/.env" "$USER_NAME:$USER_NAME"
from_example "$CLONE/infra/deploy/deploy.env.example" "$CLONE/.env.deploy" "$USER_NAME:$USER_NAME" DEPLOY_PROJECT=sirat
from_example "$CLONE/infra/monitor/monitor.env.example" "$CLONE/.env.monitor" "$USER_NAME:$USER_NAME" MONITOR_PROJECT=sirat
if [ -d "$ETC" ]; then ok "$ETC"; else change "create $ETC" install -d -m 755 -o root -g root "$ETC"; fi
from_example "$CLONE/infra/backup/backup.env.example" "$ETC/backup.env" root:root BACKUP_PROJECT=sirat

step "backup units (root-owned; the timers start once $ETC/backup.env names its remote)"
for unit in sirat-backup.service sirat-backup.timer sirat-backup-verify.service sirat-backup-verify.timer; do
  src=$CLONE/infra/backup/$unit
  if [ ! -f "$src" ]; then
    left "$unit: the clone is not there yet"
    continue
  fi
  if cmp -s "$src" "/etc/systemd/system/$unit"; then ok "$unit"; else change "install $unit" bash -c "install -m 644 '$src' /etc/systemd/system/ && systemctl daemon-reload"; fi
done
if grep -qE '^BACKUP_REMOTE=.+' "$ETC/backup.env" 2> /dev/null; then
  for t in sirat-backup.timer sirat-backup-verify.timer; do
    if systemctl is-enabled --quiet "$t" 2> /dev/null; then ok "$t enabled"; else change "enable $t" systemctl enable --now "$t"; fi
  done
else
  left "fill $ETC/backup.env (RUNBOOK section 5), then: systemctl enable --now sirat-backup.timer sirat-backup-verify.timer"
fi

step "the monitor's cron lines (every 5 minutes; the digest at 02:00 UTC = 08:00 Asia/Dhaka)"
put /etc/cron.d/sirat-monitor 644 root:root "# scripts/bootstrap.sh (L12): the server checks (L11). Output goes to the journal (tag sirat-monitor).
*/5 * * * * $USER_NAME $CLONE/scripts/monitor.sh 2>&1 | logger -t sirat-monitor
0 2 * * * $USER_NAME $CLONE/scripts/monitor.sh --digest 2>&1 | logger -t sirat-monitor"

step "sudo: $USER_NAME may start the backup unit, and nothing else"
SUDOERS="# scripts/bootstrap.sh (L12): deploy.sh takes a backup before a release that adds migrations.
$USER_NAME ALL=(root) NOPASSWD: /usr/bin/systemctl start sirat-backup.service"
if [ -f /etc/sudoers.d/sirat-deploy ] && [ "$(cat /etc/sudoers.d/sirat-deploy)" = "$SUDOERS" ] &&
  [ "$(stat -c '%a %U' /etc/sudoers.d/sirat-deploy)" = '440 root' ]; then
  ok "/etc/sudoers.d/sirat-deploy"
else
  tmp=$(mktemp)
  printf '%s\n' "$SUDOERS" > "$tmp"
  # A dry run on a fresh host has no sudo yet (the packages step installs it); a real run always checks.
  { [ "$DRY" = 1 ] && ! command -v visudo > /dev/null; } || visudo -cqf "$tmp" || {
    rm -f "$tmp"
    echo "bootstrap: visudo refused the sudo rule; nothing changed" >&2
    exit 1
  }
  change "install /etc/sudoers.d/sirat-deploy (checked with visudo -cf)" install -m 440 -o root -g root "$tmp" /etc/sudoers.d/sirat-deploy
  rm -f "$tmp"
fi

# ---------------- summary ----------------
echo
if [ "$DRY" = 1 ]; then echo "bootstrap: dry run, $CHANGES change(s) would be made"; else echo "bootstrap: $CHANGES change(s) made"; fi
if [ "${#LEFT[@]}" -gt 0 ]; then
  echo "left for the owner:"
  for l in "${LEFT[@]}"; do echo "  - $l"; done
fi
echo "then: the origin certificate (RUNBOOK section 15), scripts/deploy.sh --first, and the first release (RUNBOOK section 2)"
