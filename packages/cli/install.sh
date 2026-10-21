#!/usr/bin/env bash
# Silkweave Box installer:  curl -fsSL https://box.silkweave.dev/install | bash
#
# Prepares macOS, Linux or Windows (WSL) for a Box, then hands over to guided setup:
#   1. Git: Apple's Command Line Tools on macOS (system dialog), the package manager on Linux/WSL.
#   2. Bun, the Box runtime, installed or upgraded to the version the Box declares.
#   3. Optionally Claude Code, when no Claude or Codex agent is on this machine.
#   4. A Box checkout (default ./box, confirmed first), its dependencies and the `box` command.
#   5. `bun setup`, which creates the first owner, starts the Box and opens the sign-in page.
#
# Options (environment):
#   BOX_DIR=<path>     where to create the Box (default: ./box, asked interactively)
#   BOX_REPO=<url>     Box repository to clone (default: https://github.com/silkweave/box.git)
#   BOX_REF=<branch>   branch or tag to check out (default: the repository's default branch)
#   BOX_YES=1          accept every default without asking; setup then runs with --yes
#   NO_COLOR=1         plain output
#
# Source: https://github.com/silkweave/box/blob/master/packages/cli/install.sh
# Everything runs inside main(), called on the last line, so a truncated download runs nothing.

set -euo pipefail

BOX_REPO=${BOX_REPO:-https://github.com/silkweave/box.git}
BOX_REF=${BOX_REF:-}
BOX_YES=${BOX_YES:-}
MIN_BUN=1.4.2
LOG=
TICK=0

# ---------- presentation (the box CLI palette: packages/cli/src/ui.ts) ----------

COLOR=0
if [ -z "${NO_COLOR:-}" ] && [ -t 1 ]; then
  case "${COLORTERM:-}" in truecolor|24bit) COLOR=24 ;; *) COLOR=8 ;; esac
fi

tone() {  # $1 = tone, $2 = text
  local code
  if [ "$COLOR" = 24 ]; then
    case $1 in
      text) code='38;2;228;228;239' ;; muted) code='38;2;136;136;160' ;; accent) code='38;2;123;126;245' ;;
      good) code='38;2;134;217;176' ;; warn) code='38;2;243;199;120' ;; bad) code='38;2;245;142;155' ;;
      bold) code='1' ;;
    esac
  elif [ "$COLOR" = 8 ]; then
    case $1 in
      text) code='39' ;; muted) code='90' ;; accent) code='94' ;; good) code='32' ;; warn) code='33' ;;
      bad) code='31' ;; bold) code='1' ;;
    esac
  else
    printf '%s' "$2"; return
  fi
  printf '\033[%sm%s\033[0m' "$code" "$2"
}

line()    { printf '  %s\n' "$(tone "${2:-text}" "$1")"; }
ok()      { printf '  %s %s\n' "$(tone good '✓')" "$(tone text "$1")"; }
note()    { printf '  %s %s\n' "$(tone muted '·')" "$(tone muted "$1")"; }
warn()    { printf '  %s %s\n' "$(tone warn '!')" "$(tone warn "$1")"; }
die()     { printf '\n  %s\n' "$(tone bad "✕ $1")" >&2; [ -n "${2:-}" ] && printf '  %s\n' "$(tone muted "$2")" >&2; exit 1; }
have()    { command -v "$1" >/dev/null 2>&1; }

STEP=0
STEPS=5
step() {
  STEP=$((STEP + 1))
  printf '\n  %s %s\n\n' "$(tone accent "$STEP/$STEPS")" "$(tone bold "$1")"
}

banner() {
  # The five-stop silk gradient from the CLI, one stop per letter group.
  local word='silkweave' i=0 out='' stops
  if [ "$COLOR" = 24 ]; then
    stops=('197;163;232' '197;163;232' '163;164;232' '163;164;232' '123;126;245' '123;126;245' '138;174;234' '138;174;234' '168;229;237')
    while [ $i -lt ${#word} ]; do
      out="$out$(printf '\033[1;38;2;%sm%s' "${stops[$i]}" "${word:$i:1}")"
      i=$((i + 1))
    done
    out="$out$(printf '\033[0m')"
  else
    out=$(tone accent "$word")
  fi
  printf '\n  %s%s\n' "$out" "$(tone muted ' / install')"
  printf '  %s\n' "$(tone muted "Your team's own Box, set up on this computer.")"
}

# ---------- input ----------

# `curl | bash` gives the script on stdin, so stdin is never redirected (bash would read the rest
# of the script from the terminal) and never handed to a child. Questions read descriptor 3, the
# terminal's own device (/dev/ttys…). Not /dev/tty: macOS cannot poll /dev/tty with kqueue, so Bun
# would never see a keystroke typed into setup.
TTY=0
attach_terminal() {
  local device
  device=$(tty <&1 2>/dev/null || tty <&2 2>/dev/null || true)
  case $device in /dev/*) ;; *) device=$(ps -o tty= -p $$ 2>/dev/null | tr -d ' '); device=${device:+/dev/$device} ;; esac
  if [ -n "$device" ] && [ -r "$device" ] && { exec 3<"$device"; } 2>/dev/null; then TTY=1; return; fi
  # A device owned by someone else (after su) still has /dev/tty; only macOS needs the real device.
  if [ "$(uname -s)" != Darwin ] && { exec 3</dev/tty; } 2>/dev/null; then TTY=1; fi
}

confirm() {  # $1 = question, $2 = default (y|n). Returns 0 for yes.
  local default=${2:-y} hint answer
  if [ -n "$BOX_YES" ] || [ "$TTY" = 0 ]; then [ "$default" = y ]; return; fi
  if [ "$default" = y ]; then hint='[Y/n]'; else hint='[y/N]'; fi
  printf '  %s %s ' "$(tone text "$1")" "$(tone muted "$hint")"
  read -r answer <&3 || answer=
  case $(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]') in
    y|yes) return 0 ;;
    n|no) return 1 ;;
    *) [ "$default" = y ] ;;
  esac
}

ask() {  # $1 = question, $2 = default; prints the answer
  local answer
  if [ -n "$BOX_YES" ] || [ "$TTY" = 0 ]; then printf '%s' "$2"; return; fi
  printf '  %s %s ' "$(tone text "$1")" "$(tone muted "[$2]")" >&2
  read -r answer <&3 || answer=
  printf '%s' "${answer:-$2}"
}

# ---------- long-running work ----------

# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() { if [ -n "$LOG" ] && [ -f "$LOG" ]; then rm -f "$LOG"; fi; }
trap cleanup EXIT

# Run a command with a spinner and keep its output in a log that is shown only on failure.
run() {  # $1 = label, rest = command
  local label=$1 pid status frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏' started elapsed
  shift
  LOG=$(mktemp "${TMPDIR:-/tmp}/silkweave-box.XXXXXX")
  started=$(date +%s)
  "$@" </dev/null >"$LOG" 2>&1 &
  pid=$!
  if [ -t 1 ]; then
    while kill -0 "$pid" 2>/dev/null; do
      elapsed=$(( $(date +%s) - started ))
      printf '\r\033[K  %s %s %s' "$(tone accent "${frames:$((TICK % 10)):1}")" "$(tone text "$label")" "$(tone muted "${elapsed}s")"
      TICK=$((TICK + 1))
      sleep 0.1
    done
    printf '\r\033[K'
  fi
  status=0
  wait "$pid" || status=$?
  if [ "$status" -ne 0 ]; then
    printf '  %s %s\n\n' "$(tone bad '✕')" "$(tone bad "$label failed")"
    tail -n 30 "$LOG" | sed 's/^/    /' >&2
    die "$label failed (exit $status)." 'The output above shows why. Fix it, then run the installer again; finished steps are skipped.'
  fi
  ok "$label"
  rm -f "$LOG"; LOG=
}

# Like run, but in the foreground without a spinner: sudo (with use_pty) takes the terminal's
# foreground, which stops a script that keeps drawing from the background.
run_foreground() {  # $1 = label, rest = command
  local label=$1 status=0
  shift
  LOG=$(mktemp "${TMPDIR:-/tmp}/silkweave-box.XXXXXX")
  printf '  %s %s' "$(tone accent '…')" "$(tone text "$label")"
  "$@" </dev/null >"$LOG" 2>&1 || status=$?
  printf '\r\033[K'
  if [ "$status" -ne 0 ]; then
    printf '  %s %s\n\n' "$(tone bad '✕')" "$(tone bad "$label failed")"
    tail -n 30 "$LOG" | sed 's/^/    /' >&2
    die "$label failed (exit $status)." 'The output above shows why. Fix it, then run the installer again; finished steps are skipped.'
  fi
  ok "$label"
  rm -f "$LOG"; LOG=
}

version_at_least() {  # $1 = have, $2 = need
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$2" ]
}

# ---------- steps ----------

PLATFORM=
detect_platform() {
  case $(uname -s) in
    Darwin) PLATFORM=macos ;;
    Linux) if grep -qsi microsoft /proc/version; then PLATFORM=wsl; else PLATFORM=linux; fi ;;
    MINGW*|MSYS*|CYGWIN*)
      die 'On Windows, the Box runs inside WSL.' 'In PowerShell run: wsl --install. Then open Ubuntu and run this command there.' ;;
    *) die "This installer supports macOS, Linux and Windows (WSL). Found $(uname -s)." ;;
  esac
}

# The first line of step 1, e.g. "macOS 26.5 on Apple silicon", "Ubuntu 24.04.1 LTS on x86_64",
# "Ubuntu 24.04.1 LTS (WSL) on x86_64".
platform_label() {
  local arch name
  arch=$(uname -m)
  if [ "$PLATFORM" = macos ]; then
    printf 'macOS %s on %s' "$(sw_vers -productVersion 2>/dev/null)" "$( [ "$arch" = arm64 ] && echo 'Apple silicon' || echo 'Intel')"
    return
  fi
  name=$(sed -n 's/^PRETTY_NAME="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' /etc/os-release 2>/dev/null | head -1)
  printf '%s%s on %s' "${name:-Linux}" "$( [ "$PLATFORM" = wsl ] && echo ' (WSL)')" "$arch"
}

# Install system packages on Linux through whichever package manager is present. Asks first and
# runs in the foreground so sudo can ask for the password.
linux_install() {  # $1 = reason, rest = packages
  local reason=$1 manager command
  shift
  if have apt-get; then manager=apt; command="sudo apt-get update && sudo apt-get install -y $*"
  elif have dnf; then manager=dnf; command="sudo dnf install -y $*"
  elif have pacman; then manager=pacman; command="sudo pacman -S --noconfirm $*"
  elif have zypper; then manager=zypper; command="sudo zypper install -y $*"
  else die "$reason needs: $*." 'Install them with your package manager, then run the installer again.'
  fi
  if [ "$(id -u)" = 0 ]; then command=${command//sudo /}; fi
  line "$reason needs: $* (installed with $manager)." muted
  confirm 'Install them now?' y || die "$* required." "Install with: $command"
  if [ "$(id -u)" != 0 ] && ! sudo -n true 2>/dev/null; then
    line 'Your computer password is needed to install them.' muted
    sudo -v <&3 || die 'Could not get administrator rights.' "Install them yourself: $command"
  fi
  run_foreground "Installing $*" bash -c "$command"
}

check_system() {
  step 'Checking this computer'
  ok "$(platform_label)"
  have curl || die 'curl is missing.' 'Install curl with your package manager, then run the installer again.'

  if [ "$PLATFORM" != macos ]; then
    local missing=()
    git --version >/dev/null 2>&1 || missing+=(git)
    have unzip || missing+=(unzip)  # the Bun installer unpacks a zip
    [ ${#missing[@]} = 0 ] || linux_install 'The Box' "${missing[@]}"
    ok "Git $(git --version | awk '{print $3}')"
    return
  fi

  if git_ready; then
    ok "Git $(git --version | awk '{print $3}')"
    return
  fi
  line "Your Mac needs Apple's Command Line Tools (they include Git)." muted
  line 'A system window opens: click Install and wait for it to finish.' muted
  confirm 'Open the installer now?' y || die 'The Command Line Tools are required.' 'Install them with: xcode-select --install'
  xcode-select --install >/dev/null 2>&1 || true
  local waited=0 frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  until git_ready; do
    [ $waited -lt 3600 ] || die 'Timed out waiting for the Command Line Tools.' 'Finish their installation, then run the installer again.'
    printf '\r\033[K  %s %s' "$(tone accent "${frames:$((TICK % 10)):1}")" "$(tone text 'Waiting for the Command Line Tools to finish installing…')"
    TICK=$((TICK + 1)); sleep 1; waited=$((waited + 1))
  done
  printf '\r\033[K'
  ok "Git $(git --version | awk '{print $3}')"
}

# On macOS /usr/bin/git is a stub that opens the install dialog itself, so probe the tools first.
git_ready() {
  if [ "$PLATFORM" = macos ] && ! xcode-select -p >/dev/null 2>&1; then return 1; fi
  git --version >/dev/null 2>&1
}

bun_version() { bun --version 2>/dev/null || true; }

ensure_bun() {  # $1 = minimum version
  local need=$1 current
  export BUN_INSTALL=${BUN_INSTALL:-$HOME/.bun}
  case ":$PATH:" in *":$BUN_INSTALL/bin:"*) ;; *) export PATH="$BUN_INSTALL/bin:$PATH" ;; esac
  current=$(bun_version)
  if [ -n "$current" ] && version_at_least "$current" "$need"; then
    ok "Bun $current"
    return
  fi
  if [ -n "$current" ]; then
    line "Bun $current is older than the $need this Box needs." muted
    confirm "Upgrade Bun?" y || die "Bun $need or newer is required." 'Upgrade with: bun upgrade'
    run "Upgrading Bun" bun upgrade
  else
    line 'Bun runs the Box. It installs into ~/.bun and needs no administrator password.' muted
    confirm 'Install Bun?' y || die 'Bun is required.' 'Install it from https://bun.sh, then run the installer again.'
    run 'Installing Bun' bash -c 'curl -fsSL https://bun.sh/install | bash'
  fi
  current=$(bun_version)
  { [ -n "$current" ] && version_at_least "$current" "$need"; } || die "Bun $need or newer is required, found ${current:-none}."
  ok "Bun $current"
}

check_tools() {
  step 'Preparing the tools'
  ensure_bun "$MIN_BUN"
  if have node; then note "Node.js $(node --version) found; the Box does not need it."; else note 'Node.js is not needed; the Box runs on Bun.'; fi

  if have claude || have codex || [ -d "$HOME/.claude" ] || [ -d "$HOME/.codex" ]; then
    local found=()
    { have claude || [ -d "$HOME/.claude" ]; } && found+=(Claude)
    { have codex || [ -d "$HOME/.codex" ]; } && found+=(Codex)
    if [ ${#found[@]} = 2 ]; then ok 'AI agents: Claude and Codex'; else ok "AI agent: ${found[0]}"; fi
    return
  fi
  line 'The Box builds with an AI agent. No Claude or Codex was found on this computer.' muted
  if confirm 'Install Claude Code? (you can sign in later from the Box)' y; then
    run 'Installing Claude Code' bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
    case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac
  else
    note 'Skipped. The Box dashboard shows how to connect an agent later.'
  fi
}

is_box() { [ -f "$1/package.json" ] && grep -q '"name": *"silkweave-box"' "$1/package.json"; }

choose_directory() {
  step 'Choosing a place for your Box'
  local dir=${BOX_DIR:-$PWD/box}
  while :; do
    case $dir in /*) ;; "~"*) dir="$HOME${dir#\~}" ;; *) dir="$PWD/$dir" ;; esac
    if is_box "$dir"; then
      line "There is already a Box at $dir." muted
      if confirm 'Continue setting up that Box?' y; then RESUME=1; break; fi
    elif [ -e "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
      warn "$dir already exists and is not empty."
      [ -z "$BOX_YES" ] && [ "$TTY" = 1 ] || die "Choose another place with BOX_DIR=<path>."
    else
      line 'The Box is a folder with its code and its data. It stays on this computer.' muted
      if confirm "Create your Box in $(tone accent "$dir")?" y; then RESUME=0; break; fi
    fi
    [ "$TTY" = 1 ] && [ -z "$BOX_YES" ] || die 'No place chosen for the Box.'
    dir=$(ask 'Where should the Box go?' "$HOME/box")
  done
  BOX_DIR=$dir
  ok "Box folder: $BOX_DIR"
}

install_box() {
  step 'Installing the Box'
  if [ "$RESUME" = 1 ]; then
    ok "Using the Box at $BOX_DIR"
  else
    mkdir -p "$(dirname "$BOX_DIR")"
    if [ -n "$BOX_REF" ]; then
      run 'Downloading the Box' git clone --branch "$BOX_REF" "$BOX_REPO" "$BOX_DIR"
    else
      run 'Downloading the Box' git clone "$BOX_REPO" "$BOX_DIR"
    fi
  fi
  cd "$BOX_DIR"

  # The Box declares its own Bun; a newer Box may need a newer runtime than this installer knows.
  local declared
  declared=$(sed -n 's/.*"packageManager": *"bun@\([0-9.]*\)".*/\1/p' package.json | head -1)
  if [ -n "$declared" ] && ! version_at_least "$(bun_version)" "$declared"; then ensure_bun "$declared"; fi

  run 'Installing dependencies (this takes a minute)' bun install
  # `box` acts on the Box it is run inside; outside any Box it falls back to the registered one.
  # Re-pointing a shim that belongs to another Box changes that default, so ask first.
  local shim
  shim=$(bun run --silent box:install --check 2>/dev/null || true)
  case $shim in
    *'pointing at another Box'*)
      line 'The box command currently belongs to another Box on this computer.' muted
      if confirm 'Point the box command at this new Box?' n; then
        run 'Adding the box command' bun run --silent box:install
      else
        note 'Kept the box command as it is. Inside this Box, box still acts on this Box.'
      fi
      ;;
    *'left alone'*) warn 'Another program is installed as ~/.local/bin/box; it was left alone.' ;;
    *) run 'Adding the box command' bun run --silent box:install ;;
  esac
  local bin="$HOME/.local/bin"
  case ":$PATH:" in
    *":$bin:"*) ;;
    *)
      export PATH="$bin:$PATH"
      local profile
      case "${SHELL:-}" in
        */zsh) profile="$HOME/.zshrc" ;;
        */bash) if [ "$PLATFORM" = macos ]; then profile="$HOME/.bash_profile"; else profile="$HOME/.bashrc"; fi ;;
        *) profile="$HOME/.profile" ;;
      esac
      if grep -qs '.local/bin' "$profile"; then
        :
      elif confirm "Make the box command available in new terminals (adds one line to $(basename "$profile"))?" y; then
        # shellcheck disable=SC2016 # written literally so the profile expands it
        printf '\n# Silkweave Box: the box command\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$profile"
        ok "Added ~/.local/bin to $(basename "$profile")"
      else
        note "Run the Box later with: $BOX_DIR/packages/cli/bin/box dev"
      fi
      ;;
  esac
}

start_setup() {
  step 'Setting up your Box'
  if [ "$RESUME" = 1 ] && grep -qs '"token"' box.local.json; then
    ok 'This Box is already set up.'
    line 'Start it with:' muted
    printf '    %s\n' "$(tone accent "cd $BOX_DIR && bun dev")"
    line 'Need a new sign-in link? Run: box auth login <your owner id>' muted
    exit 0
  fi
  line 'A few questions create your owner account. The Box then starts and opens in your browser.' muted
  if [ -n "$BOX_YES" ] || [ "$TTY" = 0 ]; then
    exec bun run --silent setup --yes </dev/null 3<&-
  fi
  exec bun run --silent setup <&3 3<&-
}

main() {
  attach_terminal
  [ "$TTY" = 1 ] || [ -n "$BOX_YES" ] || die 'The installer asks a few questions and needs a terminal.' 'Run it in Terminal, or set BOX_YES=1 to accept every default.'
  detect_platform
  banner
  RESUME=0
  check_system
  check_tools
  choose_directory
  install_box
  start_setup
}

main "$@"; exit $?
