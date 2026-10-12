#!/usr/bin/env bash
# Make again an archive that GitHub makes of a tag or a commit (codeload.github.com), from the git repository:
#   recreate-github-archive.sh <repo-url> <ref> <prefix> <output> <sha256> [tar.gz|zip]
# The ref is a tag name or a full commit id. The archive is checked against the pinned SHA-256 of the lock file.
# The clones are kept in $ARCHIVE_CACHE (default: build/git-archives in the current folder).
set -euo pipefail
url=$1 ref=$2 prefix=$3 out=$4 want=$5 format=${6:-tar.gz}
cache=${ARCHIVE_CACHE:-$PWD/build/git-archives}
name=$(basename "$url" .git)
repo="$cache/$name-$(echo "$ref" | tr '/' '_').git"
if [[ ! -d "$repo" ]]; then
    git init -q --bare "$repo"
    if [[ "$ref" =~ ^[0-9a-f]{40}$ ]]; then
        git -C "$repo" fetch -q --depth 1 "$url" "$ref"
        git -C "$repo" update-ref refs/heads/pinned "$ref"
    else
        git -C "$repo" fetch -q --depth 1 "$url" "refs/tags/$ref:refs/tags/$ref"
    fi
fi
mkdir -p "$(dirname "$out")"
tmp="$out.partial"
case "$format" in
    tar.gz) git -C "$repo" archive --format=tar --prefix="$prefix/" "$ref" | gzip -n > "$tmp" ;;
    zip) git -C "$repo" archive --format=zip --prefix="$prefix/" "$ref" > "$tmp" ;;
esac
got=$(sha256sum "$tmp" | cut -d' ' -f1)
if [[ "$got" == "$want" ]]; then
    mv "$tmp" "$out"
    echo "OK $out"
else
    # git's own gzip implementation, used by some git versions behind GitHub's archive service
    if [[ "$format" == tar.gz ]]; then
        git -C "$repo" -c tar.tar.gz.command="git archive gzip" archive --format=tar.gz --prefix="$prefix/" "$ref" > "$tmp" 2>/dev/null || true
        got2=$(sha256sum "$tmp" | cut -d' ' -f1)
        if [[ "$got2" == "$want" ]]; then mv "$tmp" "$out"; echo "OK (internal gzip) $out"; exit 0; fi
    fi
    echo "MISMATCH $out: $got (wanted $want)"; exit 1
fi
