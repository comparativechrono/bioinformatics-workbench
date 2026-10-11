# Same steps as genomics-wasm tools/deseq2/locfit-build.R, run without network access:
# rwasm::build() first resolves the package with pkgdepends (which downloads
# Bioconductor's config.yaml); here its two build steps are called directly
# with the checksum-verified local source tarball.
args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) == 2L)
source <- normalizePath(args[[1L]], mustWork = TRUE)
output <- normalizePath(args[[2L]], mustWork = TRUE)
stopifnot(getRversion() == "4.6.0")
compiler <- system2("emcc", "--version", stdout = TRUE)
message(compiler[[1L]])
stopifnot(grepl("5.0.7 (263db4cffa6f9fc2ec514a70abac81362ea41849)",
                compiler[[1L]], fixed = TRUE))
library(rwasm)
makevars <- system.file("webr-vars.mk", package = "rwasm", mustWork = TRUE)
fix <- c("# genomics-wasm: select the WebAssembly C17 compiler",
         "override CC = emcc",
         "override CC17 = emcc",
         "override C17FLAGS = $(filter-out -std=%,$(WASM_CFLAGS)) -std=gnu17")
if (!all(fix %in% readLines(makevars))) {
  cat("\n# genomics-wasm: select the WebAssembly C17 compiler\n",
      "override CC = emcc\n",
      "override CC17 = emcc\n",
      "override C17FLAGS = $(filter-out -std=%,$(WASM_CFLAGS)) -std=gnu17\n",
      file = makevars, append = TRUE, sep = "")
}
writeLines(c(paste("R", getRversion()),
             paste("rwasm", packageVersion("rwasm")),
             compiler[[1L]],
             paste("Makevars", makevars)),
           file.path(output, "locfit-build-environment.txt"))
tmp <- tempfile(); dir.create(tmp)
tarball <- file.path(tmp, basename(source))
rwasm:::make_remote_tarball("locfit", paste0("file://", source), tarball)
rwasm:::wasm_build("locfit", tarball, output, TRUE)
stopifnot(file.exists(file.path(output, "locfit_1.5-9.12.tgz")))
