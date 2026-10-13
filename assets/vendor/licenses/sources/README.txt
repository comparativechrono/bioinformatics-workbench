The source code of the bundled programs that are under the GNU General Public License or the Mozilla Public License
===================================================================================================================
Twenty-six archives belong in this folder (../README.txt and ../source-archives.json describe them):

  bowtie2-2.4.2.tar.xz    coreutils-8.32.tar.xz   diffutils-3.10.tar.xz   FastTree-2.1.11.c.xz
  gawk-5.1.0.tar.xz       grep-3.7.tar.xz         grep-3.11.tar.xz        kalign-3.3.1.tar.xz
  pcre2-10.42.tar.bz2     sed-4.8.tar.xz
  bwa-b92993c1161e73167181558856567ef2f367e3f0.tar.gz      zlib-1.3.1.tar.gz
  hisat2-99583d7536b9ee017ac07de8834017a3bf99a2fe.tar.gz   freebayes-1.3.6-recursive.tar.xz
  simde-0.8.2.tar.gz      locfit_1.5-9.12.tar.gz           subread-2.1.1-source.tar.gz (featureCounts)
  strelka-2.9.10.release_src.tar.bz2 (Strelka2)            bracken-3.1.tar.gz (Bracken)
  prodigal-2.6.3.tar.gz (Prodigal)                         bustools-0.45.1.tar.gz (bustools, with Eigen)
  pyodide-314.0.7.tar.gz  hiwire-6a1e67280a15d929ebeceee54a6358c9c8d5f697.tar.gz (the Python of Cutadapt, Bracken and MACS3)
  pyodide-recipes-314-20260911.tar.gz (the recipes with which Pyodide built the packages that MACS3 uses: NumPy, SciPy …)
  plink-ng-72119068234ce0acf7189e53dfe67a527bc53e2c.tar.gz (PLINK 2)   zlib-1.3.2-github.tar.gz (zlib, in PLINK 2)

The GNU General Public License asks whoever passes these programs on – and a public web site does –
to offer their source code with them. Keep the archives here, with the site. (zlib, SIMDe and PCRE2
are not GPL themselves; they are part of GPL programs here – BWA, featureCounts, FreeBayes, PLINK 2 and grep -P.
Pyodide, hiwire and Pyodide's recipes are under the Mozilla Public License 2.0, which likewise asks for their source
code to be offered with the programs; so is Eigen, a part of bustools – whose own licence is BSD.)

If this folder holds only this file: the workbench was handed over as two zip files, because the
archives are large (139 MB together). They are in bioinformatics-workbench-sources.zip. Unzip it and
move the twenty-six archives into this folder. Their checksums are in ../SHA256SUMS:

  cd .. && sha256sum -c SHA256SUMS
