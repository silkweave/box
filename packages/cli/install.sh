#!/usr/bin/env bash
# Silkweave Box installer:  curl -fsSL https://box.silkweave.ai/install | bash
#
# Prepares macOS, Linux or Windows (WSL) for a Box, then hands over to guided setup:
#   1. Git: Apple's Command Line Tools on macOS (system dialog), the package manager on Linux/WSL.
#   2. Bun, the Box runtime, installed or upgraded to the version the Box declares.
#   3. Optionally Claude Code, when no Claude or Codex agent is on this machine.
#   4. A Box checkout (default ./box, confirmed first), its dependencies and the `box` command.
#   5. `bun setup`, which creates the first owner, starts the Box as a user service (systemd or launchd)
#      and prints the sign-in link.
#
# Options (environment):
#   BOX_DIR=<path>     where to create the Box (default: ./box, asked interactively)
#   BOX_REPO=<url>     Box repository to clone (default: https://github.com/silkweave/box.git)
#   BOX_REF=<branch>   branch or tag to check out (default: the repository's default branch)
#   BOX_YES=1          accept every default without asking; setup then runs with --yes
#   BOX_EXPLAIN=1      explain every step and question as it comes; setup then runs with --explain
#   NO_COLOR=1         plain output
#
# Source: https://github.com/silkweave/box/blob/master/packages/cli/install.sh
# Everything runs inside main(), called on the last line, so a truncated download runs nothing.

set -euo pipefail

BOX_REPO=${BOX_REPO:-https://github.com/silkweave/box.git}
BOX_REF=${BOX_REF:-}
BOX_YES=${BOX_YES:-}
START_PATH=$PATH  # the caller's PATH, before this script adds ~/.bun/bin and ~/.local/bin to its own
EXPLAIN=0; [ -n "${BOX_EXPLAIN:-}" ] && EXPLAIN=1
MIN_BUN=1.4.2
LOG=
TICK=0
# Every step's output is kept here across runs, so a failure can be shared or handed to an agent.
INSTALL_LOG="${XDG_STATE_HOME:-$HOME/.local/state}/silkweave/install.log"

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
step() {  # $1 = title, $2 = what it does (shown when explaining)
  STEP=$((STEP + 1))
  printf '\n  %s %s\n' "$(tone accent "$STEP/$STEPS")" "$(tone bold "$1")"
  [ "$EXPLAIN" = 1 ] && [ -n "${2:-}" ] && explain "$2"
  printf '\n'
}

# A question's explanation: shown before it in guided mode, or when the answer is ?.
explain() {  # $1 = text, lines separated by \n
  local text
  while IFS= read -r text; do printf '  %s\n' "$(tone muted "│ $text")" >&2; done <<<"$(printf '%b' "$1")"
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

# Typing ? at a question shows its explanation and asks again.
hint_for() {  # $1 = explanation
  if [ -n "$1" ] && [ "$EXPLAIN" = 0 ]; then printf ' %s' "$(tone muted '(? explains)')"; fi
}

confirm() {  # $1 = question, $2 = default (y|n), $3 = explanation. Returns 0 for yes.
  local default=${2:-y} help=${3:-} hint answer
  if [ -n "$BOX_YES" ] || [ "$TTY" = 0 ]; then [ "$default" = y ]; return; fi
  if [ "$default" = y ]; then hint='[Y/n]'; else hint='[y/N]'; fi
  [ "$EXPLAIN" = 1 ] && [ -n "$help" ] && explain "$help"
  while :; do
    printf '  %s%s %s ' "$(tone text "$1")" "$(hint_for "$help")" "$(tone muted "$hint")"
    read -r answer <&3 || answer=
    case $(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]') in
      y|yes) return 0 ;;
      n|no) return 1 ;;
      '?') explain "${help:-Press Enter to keep the suggestion.}" ;;
      *) [ "$default" = y ]; return ;;
    esac
  done
}

ask() {  # $1 = question, $2 = default, $3 = explanation; prints the answer
  local help=${3:-} answer
  if [ -n "$BOX_YES" ] || [ "$TTY" = 0 ]; then printf '%s' "$2"; return; fi
  [ "$EXPLAIN" = 1 ] && [ -n "$help" ] && explain "$help"
  while :; do
    printf '  %s%s %s ' "$(tone text "$1")" "$(hint_for "$help")" "$(if [ -n "$2" ]; then tone muted "[$2]"; fi)" >&2
    read -r answer <&3 || answer=
    if [ "$answer" = '?' ]; then explain "${help:-Press Enter to keep the suggestion.}"; continue; fi
    printf '%s' "${answer:-$2}"
    return
  done
}

# What happens, before anything does. Guided mode explains every step and question as it comes.
plan() {
  printf '\n'
  line 'Five steps:'
  printf '    %s %s\n' "$(tone accent 1)" "$(tone text 'Check this computer')"
  printf '    %s %s\n' "$(tone accent 2)" "$(tone text 'Prepare the tools the Box runs on')"
  printf '    %s %s\n' "$(tone accent 3)" "$(tone text 'Choose a folder for your Box')"
  printf '    %s %s\n' "$(tone accent 4)" "$(tone text 'Download the Box and add the box command')"
  printf '    %s %s\n' "$(tone accent 5)" "$(tone text 'Set up your account; the Box then starts and gives you a sign-in link')"
  line 'What the Box needs (Git and Bun) is installed or upgraded without asking.' muted
  line 'Downloads take longer on a slow connection; each step shows what it is doing.' muted
  line 'Press Enter to take a suggested answer, or type ? at any question to have it explained.' muted
  printf '\n'
}

# ---------- long-running work ----------

# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() { if [ -n "$LOG" ] && [ -f "$LOG" ]; then rm -f "$LOG"; fi; }
trap cleanup EXIT

# The last line a command printed (progress bars redraw with \r), trimmed to fit the terminal.
last_output() {  # $1 = log file, $2 = width
  tail -c 400 "$1" 2>/dev/null | tr '\r' '\n' | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | grep -v '^[[:space:]]*$' | tail -n 1 | cut -c "1-$2"
}

# Append a finished command's output to the install log.
keep_log() {  # $1 = label, $2 = status
  mkdir -p "$(dirname "$INSTALL_LOG")" 2>/dev/null || return 0
  { printf '\n=== %s: %s (exit %s)\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" "$2"; cat "$LOG"; } >>"$INSTALL_LOG" 2>/dev/null || true
}

# A failed step: its last output, where the full log is, and how to get help.
step_failed() {  # $1 = label, $2 = status
  printf '  %s %s\n\n' "$(tone bad '✕')" "$(tone bad "$1 failed")"
  tail -n 30 "$LOG" | sed 's/^/    /' >&2
  printf '\n  %s %s\n' "$(tone muted 'Full log:')" "$(tone accent "$INSTALL_LOG")" >&2
  if have claude; then
    printf '  %s\n    %s\n' "$(tone muted 'Ask Claude to fix it:')" "$(tone accent "claude \"The Silkweave Box installer failed. Read $INSTALL_LOG and fix the cause.\"")" >&2
  fi
  die "$1 failed (exit $2)." 'Run the installer again when it is fixed; finished steps are skipped. Share the log when you ask for help.'
}

# Run a command with a spinner, its latest output line beneath the label, and a note when it goes
# quiet. Its output goes to the install log; the end of it is shown on failure.
run() {  # $1 = label, rest = command
  local label=$1 pid status frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏' started elapsed=0 size=0 grew quiet=0 detail='' width
  shift
  LOG=$(mktemp "${TMPDIR:-/tmp}/silkweave-box.XXXXXX")
  started=$(date +%s); grew=$started
  "$@" </dev/null >"$LOG" 2>&1 &
  pid=$!
  if [ -t 1 ]; then
    width=$(( $(tput cols 2>/dev/null || echo 80) - 6 ))
    printf '\n'
    while kill -0 "$pid" 2>/dev/null; do
      if [ $((TICK % 5)) = 0 ]; then
        local now; now=$(date +%s)
        local current; current=$(wc -c <"$LOG" 2>/dev/null | tr -d ' ')
        if [ "${current:-0}" != "$size" ]; then size=${current:-0}; grew=$now; detail=$(last_output "$LOG" "$width"); fi
        elapsed=$((now - started)); quiet=$((now - grew))
        if [ $quiet -ge 60 ]; then detail="No new output for ${quiet}s. Still running; large downloads can be quiet."; fi
      fi
      printf '\r\033[1A\033[K  %s %s %s\n\033[K    %s' "$(tone accent "${frames:$((TICK % 10)):1}")" "$(tone text "$label")" "$(tone muted "${elapsed}s")" "$(tone muted "$detail")"
      TICK=$((TICK + 1))
      sleep 0.1
    done
    printf '\r\033[K\033[1A\r\033[K'
  fi
  status=0
  wait "$pid" || status=$?
  keep_log "$label" "$status"
  [ "$status" -eq 0 ] || step_failed "$label" "$status"
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
  keep_log "$label" "$status"
  [ "$status" -eq 0 ] || step_failed "$label" "$status"
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
  line "$reason needs: $* (installing with $manager)." muted
  if [ "$(id -u)" != 0 ] && ! sudo -n true 2>/dev/null; then
    line 'Your computer password is needed to install them.' muted
    sudo -v <&3 || die 'Could not get administrator rights.' "Install them yourself: $command"
  fi
  run_foreground "Installing $*" bash -c "$command"
}

check_system() {
  step 'Checking this computer' 'Makes sure this system can run a Box and has Git, which downloads it and records its changes.'
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
  confirm 'Open the installer now?' y "Git downloads the Box and keeps it up to date. Apple ships it in its free Command Line\nTools. The download takes a few minutes, sometimes up to 15." || die 'The Command Line Tools are required.' 'Install them with: xcode-select --install'
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

# Every change the Box saves (Builder's checkpoints, an agent's commits) is a Git commit, and Git
# refuses to commit without a name and email. A fresh server has neither, so ask once, globally,
# and never replace an identity that is already set.
ensure_git_identity() {
  local name email
  name=$(git config --global user.name 2>/dev/null || true)
  email=$(git config --global user.email 2>/dev/null || true)
  if [ -n "$name" ] && [ -n "$email" ]; then ok "Git identity: $name <$email>"; return; fi
  local help='Git records who made each change to your Box: when the Box saves work you built with it,\nand when an agent commits. It is stored in ~/.gitconfig for this computer account and stays on\nthis computer. Change it later with: git config --global user.name "…" / user.email "…"'
  if [ -n "$BOX_YES" ] || [ "$TTY" = 0 ]; then
    warn 'Git has no name and email yet, so the Box cannot save changes until you set them:'
    printf '    %s\n' "$(tone accent 'git config --global user.name "Your Name" && git config --global user.email you@example.com')"
    return
  fi
  line 'Git needs your name and email to record the changes you make in the Box.' muted
  if [ -z "$name" ]; then
    local suggested
    if [ "$PLATFORM" = macos ]; then suggested=$(id -F 2>/dev/null || true)
    else suggested=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f5 | cut -d, -f1); fi
    name=$(ask 'Your name for Git' "${suggested:-$(id -un)}" "$help")
    git config --global user.name "$name"
  fi
  while [ -z "$email" ]; do
    email=$(ask 'Your email for Git' '' "$help")
    case $email in *@*.*) ;; *) warn 'Enter an email address, like you@example.com.'; email= ;; esac
  done
  git config --global user.email "$email"
  ok "Git identity: $name <$email>"
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
    line "Bun $current is older than the $need this Box needs; upgrading it (your other Bun projects keep working)." muted
    case $(command -v bun) in
      "$BUN_INSTALL"/*) run "Upgrading Bun to $need or newer" bun upgrade ;;
      # A Bun from Homebrew or elsewhere: install the current one into ~/.bun, which this script's
      # PATH (and the profile persist_path writes) puts first.
      *) run "Installing Bun into ~/.bun" bash -c 'curl -fsSL https://bun.sh/install | bash' ;;
    esac
  else
    line 'Installing Bun, the engine the Box runs on, into ~/.bun (no administrator password).' muted
    run 'Installing Bun' bash -c 'curl -fsSL https://bun.sh/install | bash'
  fi
  current=$(bun_version)
  { [ -n "$current" ] && version_at_least "$current" "$need"; } || die "Bun $need or newer is required, found ${current:-none}."
  ok "Bun $current"
}

check_tools() {
  step 'Preparing the tools' 'Installs Bun, the engine the Box runs on, and an AI agent if none is on this computer.'
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
  if confirm 'Install Claude Code?' y "Claude Code is Anthropic's AI agent. The Box uses it to build features for you.\nYou connect your Claude account later, inside the Box."; then
    run 'Installing Claude Code' bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
    case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac
  else
    note 'Skipped. The Box dashboard shows how to connect an agent later.'
  fi
}

is_box() { [ -f "$1/package.json" ] && grep -q '"name": *"silkweave-box"' "$1/package.json"; }

choose_directory() {
  step 'Choosing a place for your Box' 'The Box is one folder with its code and its data. It stays on this computer.'
  local dir=${BOX_DIR:-$PWD/box}
  while :; do
    case $dir in /*) ;; "~"*) dir="$HOME${dir#\~}" ;; *) dir="$PWD/$dir" ;; esac
    if is_box "$dir"; then
      line "There is already a Box at $dir." muted
      if confirm 'Continue setting up that Box?' y 'Finished steps are skipped; nothing in that Box is replaced.'; then RESUME=1; break; fi
    elif [ -e "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
      warn "$dir already exists and is not empty."
      [ -z "$BOX_YES" ] && [ "$TTY" = 1 ] || die "Choose another place with BOX_DIR=<path>."
    else
      if confirm "Create your Box in $(tone accent "$dir")?" y 'To remove the Box later, delete the folder. Answer n to choose another place.'; then RESUME=0; break; fi
    fi
    [ "$TTY" = 1 ] && [ -z "$BOX_YES" ] || die 'No place chosen for the Box.'
    dir=$(ask 'Where should the Box go?' "$HOME/box" 'A folder path. ~ means your home folder. The folder is created if it does not exist.')
  done
  BOX_DIR=$dir
  ok "Box folder: $BOX_DIR"
}

install_box() {
  step 'Installing the Box' 'Downloads the Box, installs its parts and adds the box command to Terminal.'
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
      if confirm 'Point the box command at this new Box?' n 'Outside a Box folder, the box command acts on one Box. Answer y to make that this one.\nInside a Box folder, box always acts on that Box.'; then
        run 'Adding the box command' bun run --silent box:install
      else
        note 'Kept the box command as it is. Inside this Box, box still acts on this Box.'
      fi
      ;;
    *'left alone'*) warn 'Another program is installed as ~/.local/bin/box; it was left alone.' ;;
    *) run 'Adding the box command' bun run --silent box:install ;;
  esac
  persist_path
}

# New Terminal windows need both the box command (~/.local/bin) and Bun (~/.bun/bin): the box command
# runs on Bun. This script put both on its own PATH only; Bun's installer does not reliably add
# ~/.bun/bin to the shell profile (a fresh Ubuntu VM got none), so write what the caller's PATH and
# the profile both lack. The lines must also reach non-interactive shells (`ssh host box status`):
# zsh reads ~/.zshenv for every shell, and bash over SSH reads ~/.bashrc, whose Ubuntu and Debian
# default returns early when not interactive, so the lines go at its top.
persist_path() {
  local profile bun_bin="${BUN_INSTALL:-$HOME/.bun}/bin" add=() lines='' top=0
  case "${SHELL:-}" in
    */zsh) profile="$HOME/.zshenv" ;;
    */bash) if [ "$PLATFORM" = macos ]; then profile="$HOME/.bash_profile"; else profile="$HOME/.bashrc"; top=1; fi ;;
    *) profile="$HOME/.profile" ;;
  esac
  # shellcheck disable=SC2016,SC2088 # shown and written literally; the profile expands $HOME
  if path_lacks "$HOME/.local/bin" && ! grep -qs '.local/bin' "$profile"; then
    add+=('~/.local/bin'); lines+='export PATH="$HOME/.local/bin:$PATH"\n'
  fi
  # Only a Bun this script (or Bun's installer) put in ~/.bun; a Homebrew Bun is already on PATH.
  if [ -x "$bun_bin/bun" ] && path_lacks "$bun_bin" && ! grep -qs "${bun_bin#"$HOME"/}" "$profile"; then
    add+=("${bun_bin/#"$HOME"/\~}"); lines+="export PATH=\"${bun_bin/#"$HOME"/\$HOME}:\$PATH\"\\n"
  fi
  [ ${#add[@]} = 0 ] && return
  local hint="export PATH=\"\$HOME/.local/bin:${bun_bin/#"$HOME"/\$HOME}:\$PATH\""
  if confirm 'Make the box command work in new Terminal windows?' y "Adds ${add[*]} to PATH in $(basename "$profile"), so Terminal finds the box command and Bun.\nWithout it, start each new Terminal with: $hint"; then
    if [ "$top" = 1 ] && [ -s "$profile" ]; then
      # Rewritten in place (not moved), so a symlinked or specially owned profile stays as it was.
      local rest; rest=$(cat "$profile")
      printf '# Silkweave Box: the box command and Bun\n%b\n%s\n' "$lines" "$rest" >"$profile"
    else
      printf '\n# Silkweave Box: the box command and Bun\n%b' "$lines" >>"$profile"
    fi
    ok "Added ${add[*]} to $(basename "$profile")"
  else
    note "In a new Terminal, first run: $hint"
  fi
}

path_lacks() { case ":$START_PATH:" in *":$1:"*) return 1 ;; *) return 0 ;; esac; }

start_setup() {
  step 'Setting up your Box' 'Creates your account and connects the AI agent. The Box then starts in the background and\nprints your sign-in link (it opens in your browser if it can).'
  if [ "$RESUME" = 1 ] && grep -qs '"token"' box.local.json; then
    ok 'This Box is already set up.'
    if [ -z "$BOX_YES" ] && [ "$TTY" = 1 ] && confirm 'Start it in the background now?' y 'Runs the Box as a service of your user: it keeps running after you close this window or\nlog out, and starts with the computer. Stop it any time with: box service stop'; then
      bun --no-env-file packages/cli/src/index.ts service install <&3 3<&- || die 'The Box did not start.' 'See what it printed: box service logs'
      exec bun --no-env-file packages/cli/src/index.ts auth login <&3 3<&-
    fi
    line 'Start it in the background with:' muted
    printf '    %s\n' "$(tone accent "cd $BOX_DIR && box service install")"
    line 'Need a new sign-in link? Run: box auth login' muted
    exit 0
  fi
  if [ -n "$BOX_YES" ] || [ "$TTY" = 0 ]; then
    exec bun run --silent setup --yes </dev/null 3<&-
  fi
  if [ "$EXPLAIN" = 1 ]; then exec bun run --silent setup --explain <&3 3<&-; fi
  exec bun run --silent setup <&3 3<&-
}

main() {
  attach_terminal
  [ "$TTY" = 1 ] || [ -n "$BOX_YES" ] || die 'The installer asks a few questions and needs a terminal.' 'Run it in Terminal, or set BOX_YES=1 to accept every default.'
  detect_platform
  [ "$(id -u)" != 0 ] || die 'The Box does not run as root: its database refuses to start as the root user.' 'Sign in as a normal user (with sudo rights for installing packages) and run the installer again.'
  banner
  plan
  RESUME=0
  check_system
  ensure_git_identity
  check_tools
  choose_directory
  install_box
  start_setup
}

main "$@"; exit $?
