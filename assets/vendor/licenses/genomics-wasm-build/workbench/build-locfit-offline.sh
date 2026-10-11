#!/usr/bin/env bash
# How locfit_1.5-9.12.tgz of this site was built: genomics-wasm's own recipe (scripts/build-deseq2-locfit.sh with
# tools/deseq2/locfit-build.R), in the webR build image that recipe pins, but with no network inside the image.
# rwasm::build() first asks pkgdepends to resolve the package, which downloads Bioconductor's config.yaml;
# locfit-build-offline.R instead calls the two steps of rwasm::build that do the work (make_remote_tarball and
# wasm_build) on the same checksum-pinned source tarball. Everything else is as in locfit-build.R.
#
#   1. Unpack the three layers of ghcr.io/r-wasm/webr@sha256:3fbf3dc3537c5b31bca94dd797dc25364693b18d71b1d0975f318fbfd6269d86
#      (webR 0.6.0, R 4.6.0, Emscripten 5.0.7, rwasm 0.3.0.9000) into a folder ROOTFS – or run the image with docker.
#   2. Put the recipe into ROOTFS/project in genomics-wasm's layout: scripts/build-deseq2-locfit-offline.sh and
#      tools/deseq2/locfit-build-offline.R (both in this folder: genomics-wasm's build-deseq2-locfit.sh and
#      locfit-build.R with the change above), and the CRAN source build/downloads/locfit_1.5-9.12.tar.gz
#      (SHA-256 fa31b9d407f3557a6fcb7105cbd7b16a32a6fb868a7c60bc38a3e33cb7a39343; a copy is in ../sources/).
#   3. Run it in the image without network (here: user, mount and PID namespaces and chroot):
set -euo pipefail
ROOTFS=${ROOTFS:?set ROOTFS to the unpacked image}
exec unshare -rmnpf --mount-proc="$ROOTFS/proc" bash -c '
  mount --rbind /dev "$0/dev"
  exec chroot "$0" /usr/bin/env -i HOME=/root TZ=UTC LANG=C.UTF-8 EMSDK=/opt/emsdk WEBR_ROOT=/opt/webr \
    EM_NODE_JS=/usr/bin/node EMFC=/opt/flang/host/bin/flang \
    PATH=/opt/emsdk:/opt/emsdk/upstream/emscripten:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    /bin/bash -c "cd /project && bash scripts/build-deseq2-locfit-offline.sh --container"' "$ROOTFS"
# Output: /project/build/deseq2/locfit/locfit_1.5-9.12.tgz and locfit-build-environment.txt (the copy here).
