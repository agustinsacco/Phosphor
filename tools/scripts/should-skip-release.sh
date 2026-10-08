#!/usr/bin/env sh
# Decide whether a commit asks to skip publishing a release.
#
# The directive is a git trailer in the commit's trailer block:
#
#     Skip-Release: true
#
# Parsing is delegated to `git interpret-trailers`, NOT to a regex. Three
# attempts failed before this, each because the rule could be tripped by text
# that merely discussed the rule:
#
#   1. Match anywhere in the message — the commit introducing the pipeline
#      documented the marker in its body; v0.1.37 never shipped.
#   2. Match the subject only — the commit fixing THAT had the marker in its own
#      subject; v0.1.38 never shipped.
#   3. Match a `Skip-Release:` line by regex — the commit fixing THAT had an
#      indented `Skip-Release: true` in an example in its body. (Caught locally
#      before it shipped.)
#
# git already knows what a trailer is: the last paragraph, tokens only, not an
# indented code block. Deferring to it makes prose about the directive
# structurally incapable of triggering it.
#
# Usage: should-skip-release.sh "<full commit message>"
# Exits 0 to skip, 1 to publish.

set -eu

MESSAGE=${1:-}

# --only-trailers --unfold: emit just the trailer block, one logical trailer per
# line. Anything git does not recognise as a trailer never appears here.
VALUE=$(
  printf '%s\n' "$MESSAGE" |
    git interpret-trailers --only-trailers --unfold 2>/dev/null |
    sed -n 's/^[Ss][Kk][Ii][Pp]-[Rr][Ee][Ll][Ee][Aa][Ss][Ee]:[[:space:]]*//p' |
    tail -n 1 |
    tr '[:upper:]' '[:lower:]' |
    tr -d '[:space:]'
)

case "$VALUE" in
  true | yes | 1) exit 0 ;;
  *) exit 1 ;;
esac
