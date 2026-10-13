# Example data

Read-only copies that come with the workbench. To change one, copy it into your home folder first:

    cp -r /data/examples/reads ~/reads

| Folder | Files | What they are |
| --- | --- | --- |
| `reads/` | `NA12878_R1.fastq`, `NA12878_R2.fastq` | 3,519 pairs of real 76-base Illumina exome reads of sample NA12878 (1000 Genomes Project, run SRR098401), from two regions of chromosome 10 |
| | `reference.fa`, `reference.fa.fai` | the reference for them: two slices of the human genome (GRCh37/hg19) – `human_CYP2C19` = chr10:96,530,001–96,560,000 and `human_CYP2C9` = chr10:96,699,001–96,725,000 – and its index |
| | `provenance.json` | where the reads and the reference came from, and how they were extracted |
| `variants/` | `NA12878.calls.vcf.gz` (+ `.tbi`) | variants called from those reads (bcftools 1.10 mpileup + call, filtered QUAL ≥ 20 and depth ≥ 5) |
| `annotation/` | `cyp2c_slices.gff3`, `cyp2c_exons.bed` | genes, transcripts, exons and CDS of the two slices (Ensembl, GRCh37), in the coordinates of `reference.fa` |
| `sequences/` | `pBR322.fasta` | the cloning vector pBR322 (GenBank J01749.1) |
| | `myoglobins.fasta`, `unknown_myoglobin.fasta` | myoglobin protein sequences of eight animals (UniProt), and one "unknown" one |
| | `tRNA-Thr.afa` | six human threonine tRNAs, aligned (FASTA) |
| `tables/` | `yeast_genes.csv` | 5,481 yeast (S. cerevisiae) genes × 19 columns: essential or not, protein length, GC content, abundance, interaction partners, structure confidence … (SGD, PaxDb, BioGRID, UniProt, AlphaFold DB; downloaded 30 September 2026) |
| `structures/` | `1mbn.pdb` | sperm whale myoglobin, the first protein structure solved at high resolution (RCSB PDB 1MBN) |
| `rnaseq/` | `yeast_chrI.fa`, `yeast_chrI.fa.fai` | chromosome I of baker's yeast (*S. cerevisiae* S288C, R64-1-1, Ensembl; 230,218 bases; the sequence is named `I`) and its index |
| | `yeast_chrI.gtf`, `yeast_chrI.splice_sites.tsv` | its genes, transcripts and exons (Ensembl), and its 5 annotated introns in HISAT2's format (`hisat2 --known-splicesite-infile`) |
| | `SRR6357070_1.fastq`, `SRR6357070_2.fastq` | 256 pairs of 101-base RNA-seq reads of wild-type yeast (SRA run SRR6357070, GEO GSE110004), all from chromosome I; 128 of the pairs were chosen because they span an annotated intron. The library is reverse-stranded (Salmon finds `ISR`: `featureCounts -s 2`). With `gffread -w` the GTF file gives the 124 transcript sequences for kallisto and Salmon |
| | `airway_counts.tsv`, `airway_samples.tsv` | the gene counts of a published RNA-seq experiment – 63,677 genes (Ensembl 75, GRCh37) × 8 samples: airway smooth muscle cells of four cell lines, untreated and treated with dexamethasone (Himes et al. 2014, GEO GSE52778) – and the table of the samples, for DESeq2 and edgeR |
| | `provenance.json`, `NOTICE.txt` | where these files came from, and their licences |
| `trimming/` | `SRR6357070_adapters_1.fastq`, `SRR6357070_adapters_2.fastq` | 384 pairs of 101-base reads of the same yeast RNA-seq run (SRR6357070), chosen because many of them run into the adapter – for cutadapt and fastp. Read 1's adapter: `AGATCGGAAGAGCACACGTCTGAACTCCAGTCA`, read 2's: `AGATCGGAAGAGCGTCGTGTAGGGAAAGAGTGT` |
| | `provenance.json`, `NOTICE.txt` | where they came from, how they were chosen, and their licence |
| `somatic/` | `tumor.bam`, `normal.bam` (+ `.bai`) | real Illumina reads of the breast-cancer cell line HCC1395 (tumour; 6,565 pairs) and of HCC1395BL, a cell line from the blood of the same donor (normal; 8,411 pairs), sequenced by the SEQC2 consortium – the reads of two windows of chromosome 21 (GRCh38) |
| | `reference.fa`, `reference.fa.fai` | those two windows, the reference of the BAM files: `chr21_10572001_10582000` (10 kb) and `chr21_21404501_21423500` (19 kb) |
| | `regions.bed`, `regions.bed.gz` (+ `.tbi`) | the windows less 2 kb at each end, where the variants are evaluated (the `.gz` for Strelka's `--callRegions`) |
| | `truth.vcf` | the four SEQC2 high-confidence somatic variants in these windows: two SNVs and two one-base deletions |
| | `provenance.json`, `NOTICE.txt` | where these files came from, and how they were made |
| `metagenomics/` | `reads_1.fastq.gz`, `reads_2.fastq.gz` | 4,096 pairs of real 151-base Illumina reads of a mock microbial community – the ZymoBIOMICS Microbial Community DNA Standard (D6305): DNA of eight bacteria (12 % each) and two yeasts (2 % each) (ENA run ERR2984773) – for Kraken2 |
| | `db/` | a small Kraken2 database: `hash.k2d`, `opts.k2d`, `taxo.k2d`, built from the first 1,000,000 bases of three chromosomes – *Escherichia coli*, *Salmonella enterica*, *Shigella flexneri* – in `library/reference.fna`, with `seqid2taxid.map` and `taxonomy/`; and `database151mers.kmer_distrib`, Bracken's distribution for 151-base reads |
| | `provenance.json`, `NOTICE.txt` | where these files came from, and how they were made |
| `bacteria/` | `ecoli.fna`, `salmonella.fna` | the first 60,000 bases of the chromosomes of *Escherichia coli* K-12 MG1655 and *Salmonella enterica* Typhimurium LT2 (NCBI RefSeq) – for Prodigal; both begin with the threonine operon |
| | `combined.fna` | the two, as contigs of a small metagenome (`prodigal -p meta`) |
| | `provenance.json`, `NOTICE.txt` | where these files came from |
| `hmmer/` | `globins4.sto`, `globins4.hmm`, `globins45.fa`, `HBB_HUMAN` | the tutorial files of HMMER 3.4, unchanged and under their own names: four globins aligned and their profile HMM; 45 globins and human beta-haemoglobin to search |
| | `fn3.sto`, `fn3.hmm`, `Pkinase.sto`, `Pkinase.hmm`, `7LESS_DROME` | Pfam's fibronectin type III and protein kinase domains (seed alignments and profiles), and the UniProt record of the *Drosophila* Sevenless receptor, which has both |
| | `MADE1.sto`, `MADE1.hmm`, `dna_target.fa` | the human DNA transposon MADE1 (Dfam), and 330 kb of human chromosome 1 with copies of it – for `nhmmer` |
| | `LICENSE`, `provenance.json`, `NOTICE.txt` | HMMER's licence; where these files came from |
| `singlecell/` | `input.bus`, `matrix.ec`, `transcripts.txt` | a BUS file of single-cell RNA-seq (mouse, 10x Chromium v2, SRA run SRR8599150) written by `kallisto bus` – 34 records –, and its equivalence classes and transcripts |
| | `transcripts-to-genes.txt`, `whitelist.txt` | the gene of each transcript; the 10x v2 barcodes near those in `input.bus` (for `bustools correct`) |
| | `R1.fastq`, `R2.fastq` | 2,500 read pairs of the experiment: R1 holds the 16-base cell barcode and the 10-base UMI, R2 the cDNA |
| | `large/` | 10,235 records of 358 barcodes, already corrected and sorted, with their own `matrix.ec`, `transcripts.txt`, `transcripts-to-genes.txt` and `whitelist.txt` – for `bustools count` |
| | `LICENSE.kb_python`, `provenance.json`, `NOTICE.txt` | the licence of the kb_python test files; where these files came from, and how they were made |
| `plink2/` | `1kg-phase3-chr21.vcf.gz` | the genotypes of the 2,504 people of the 1000 Genomes Project (Phase 3) at the first 600 variants of chromosome 21 (GRCh37), phased – the test file of PLINK 2 itself, unchanged |
| | `keep48.samples.txt` | 48 of their sample IDs, for `--keep` |
| | `synthetic_scores.tsv` | 20 of the variants with made-up weights, to try `--score` (not effect sizes of anything) |
| | `synthetic_glm.vcf`, `synthetic_phenotypes.tsv`, `synthetic_covariates.tsv` | synthetic genotypes of 603 invented people at 30 variants, with three phenotypes and two covariates, from PLINK 2's own tests – for `--glm` |
| | `provenance.json`, `NOTICE.txt` | where these files came from, and how they were made |
| `chipseq/` | `CTCF_SE_ChIP_chr22_50k.bed.gz`, `CTCF_SE_CTRL_chr22_50k.bed.gz` | the test data of MACS: 49,622 reads of a ChIP-seq of CTCF and 50,837 of its control (input), on human chromosome 22 (hg19 positions) – BED, one 101-base read per line – for `macs3 callpeak` |
| | `CTCF_PE_ChIP_chr22_50k.bedpe.gz`, `CTCF_PE_CTRL_chr22_50k.bedpe.gz` | the same experiments read from both ends: one fragment per line (MACS's three-column BEDPE) |
| | `run_callpeak_narrow0_peaks.narrowPeak` | the peaks that MACS's own test expects from the single-end reads (`-g 52000000`) |
| | `LICENSE.MACS3`, `provenance.json`, `NOTICE.txt` | MACS's licence; where these files came from |
| `atacseq/` | `yeast_SRR1822137_chrI.bedpe.gz` | 5,771 ATAC-seq fragments of baker's yeast, those on chromosome I (sacCer3 positions), from MACS's test of HMMRATAC (SRA run SRR1822137; Schep et al. 2015) – for `macs3 hmmratac` |
| | `LICENSE.MACS3`, `provenance.json`, `NOTICE.txt` | MACS's licence; where the file came from, and how it was made |
| `networks/` | `airway_deseq2.csv` | DESeq2's results for the airway experiment (dexamethasone-treated against untreated cells; 22,369 genes) – the table the RNA-seq recipe writes |
| | `airway_string_nodes.tsv`, `airway_string_network.tsv` | the STRING network (version 12.5, 13 October 2026) of the 409 genes with padj < 0.01 and a log2 fold change of at least 1.5 either way: their 357 proteins and the 512 associations among them with a score of at least 0.4 – the Networks tab's example |
| | `karate_club.graphml` | Zachary's karate club (1977): 34 members, the 78 pairs who met outside the club, and the side each member joined when it split – a classic small network |
| | `provenance.json`, `NOTICE.txt` | where these files came from, and how they were made |

Positions on the slices: add 96,530,000 (human_CYP2C19) or 96,699,000 (human_CYP2C9) to get the GRCh37
chromosome 10 position. In `somatic/`, add 10,572,000 (`chr21_10572001_10582000`) or 21,404,500
(`chr21_21404501_21423500`) to get the GRCh38 chromosome 21 position. The variant *CYP2C19\*2* (rs4244285, hg19 chr10:96,541,616) is at position 11,616 of
`human_CYP2C19`. The GFF3 file keeps the GRCh37 positions of each feature as `hg19_start`/`hg19_end`;
features that reach beyond a slice are cut at its ends and marked `partial=true`.

All of it is public data: NA12878 is the widely used public reference sample (Coriell cell line GM12878);
HCC1395 and HCC1395BL are public research cell lines (ATCC), whose sequences SEQC2 released for benchmarking; the
metagenomic reads are of a commercial mock community; the single-cell reads are of mouse cells; the genotypes of `plink2/` are of the
1000 Genomes Project's participants, released openly with their consent, and of invented people. No patient data is included. Sources: 1000 Genomes Project; UCSC (genome sequence); Ensembl GRCh37
(annotation, from grch37.rest.ensembl.org); NCBI GenBank; UniProt (CC BY 4.0); SGD (CC BY 4.0) and the other databases named above; RCSB PDB (CC0);
for `rnaseq/` and `trimming/`, nf-core/test-datasets (MIT licence) and the Bioconductor package airway 1.26.0 (LGPL), as prepared by the
genomics-wasm project – see `rnaseq/NOTICE.txt` and `trimming/NOTICE.txt`; for `somatic/`, the SEQC2 consortium (NCBI) and
UCSC – see `somatic/NOTICE.txt`; for `metagenomics/`, ENA (study PRJEB29504; Nicholls et al. 2019) and NCBI RefSeq and
Taxonomy, as prepared by the genomics-wasm project – see `metagenomics/NOTICE.txt`; for `bacteria/`, NCBI RefSeq; for `hmmer/`, the HMMER 3.4
release (BSD licence; Pfam and Dfam, CC0; UniProt, CC BY 4.0); for `singlecell/`, the SRA (SRR8599150) by way of kb_python (BSD licence) and
the BUStools getting_started release, as prepared by the genomics-wasm project; for `plink2/`, the 1000 Genomes Project (Phase 3; The 1000 Genomes
Project Consortium 2015) by way of PLINK 2's test files (GPL 3), as prepared by the genomics-wasm project; for `networks/`, STRING 12.5 (CC BY 4.0)
and NetworkX's copy of Zachary's karate club (1977); for `chipseq/` and `atacseq/`, the test data of MACS 3.0.5 (BSD licence), from
the SRA (SRR1822137) for the yeast – see the `NOTICE.txt` of each.

## The columns of `tables/yeast_genes.csv`

One row per gene of *Saccharomyces cerevisiae* (S288C) that has a deletion phenotype in SGD.

| Column | What it is |
| --- | --- |
| `orf`, `gene` | the systematic name (YAL001C) and the gene name (TFC3) |
| `essential` | 1 if the yeast cannot live without the gene (deletion inviable), 0 if it can |
| `protein_length` | length of the protein, in amino acids |
| `gc_content` | GC content of the coding sequence, % |
| `codon_bias` | codon adaptation index (0–1): how much the gene uses the codons of highly expressed genes |
| `protein_abundance` | protein abundance, parts per million (PaxDb v6.1, integrated dataset); empty when not measured |
| `interaction_partners` | number of distinct partners in physical interactions (BioGRID 5.0.261) |
| `transmembrane_helices` | number of transmembrane helices (UniProt) |
| `human_homolog` | 1 if the protein has a clear counterpart in the human proteome (DIAMOND, E ≤ 1e-10) |
| `paralog_identity` | highest % identity to another yeast protein; 0 = none |
| `plddt`, `disorder` | AlphaFold model: mean pLDDT, and the fraction of residues with pLDDT < 50 |
| `conditional_mutant_phenotypes` | number of SGD phenotype records for conditional or reduced-function alleles. Such alleles are made mostly *because* a gene is essential – so this column partly gives away the answer when you predict `essential` |
| `location` | main cell compartment (from SGD's GO annotations, grouped into 7 compartments; `Unknown` = none) |
| `chromosome`, `uniprot`, `alphafold_id`, `description` | chromosome (1–16), UniProt accession, AlphaFold model, SGD's description |
