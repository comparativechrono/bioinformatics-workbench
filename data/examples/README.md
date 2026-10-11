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

Positions on the slices: add 96,530,000 (human_CYP2C19) or 96,699,000 (human_CYP2C9) to get the GRCh37
chromosome 10 position. The variant *CYP2C19\*2* (rs4244285, hg19 chr10:96,541,616) is at position 11,616 of
`human_CYP2C19`. The GFF3 file keeps the GRCh37 positions of each feature as `hg19_start`/`hg19_end`;
features that reach beyond a slice are cut at its ends and marked `partial=true`.

All of it is public data: NA12878 is the widely used public reference sample (Coriell cell line GM12878); no
patient data is included. Sources: 1000 Genomes Project; UCSC (genome sequence); Ensembl GRCh37
(annotation, from grch37.rest.ensembl.org); NCBI GenBank; UniProt (CC BY 4.0); SGD (CC BY 4.0) and the other databases named above; RCSB PDB (CC0);
for `rnaseq/`, nf-core/test-datasets (MIT licence) and the Bioconductor package airway 1.26.0 (LGPL), both as prepared by the
genomics-wasm project – see `rnaseq/NOTICE.txt`.

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
