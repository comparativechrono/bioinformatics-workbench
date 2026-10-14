/* Real, pinned programs compiled to WebAssembly (Biowasm builds; Bowtie 2, diff and cmp built for
 * this practical; BWA, BWA-MEM2, HISAT2, FreeBayes, StringTie, kallisto, mosdepth, featureCounts, Salmon, Cutadapt,
 * MACS3, LoFreq, SomaticSniper, Strelka2, Kraken2, Bracken, Prodigal, HMMER, bustools and PLINK 2 from the genomics-wasm
 * ports). One shared filesystem backs the terminal and the AI agent. Pipes use byte-preserving temporary files (run one
 * after another, not as concurrent processes). Aioli's local execIO patch binds real file descriptors and reports each
 * exit status. featureCounts, Salmon, PLINK 2, Cutadapt, MACS3, LoFreq, SomaticSniper, Strelka2's, Kraken2's and Bracken's
 * programs, Prodigal, HMMER and bustools run as genomics-wasm built them: each command in a worker of its own
 * (threads-worker.mjs; python-worker.mjs for the Python
 * programs – Cutadapt, MACS3, Bracken's), with the files it needs, and what it writes comes back into the shared file system
 * (see execWorker). lofreq somatic and Strelka's runWorkflow.py are workflows of several such commands (somatic.js), and
 * so are Kraken2's and Bracken's commands, wrapper scripts upstream (metagenomics.js).
 */
(function () {
  'use strict';
  const MG = window.MG;
  const ROOT = '/shared/vfs', TMP = ROOT + '/tmp/.pipes';
  // copies of files the AI agent could change (see keep): in the file system of the page, where no program looks
  const KEEP = '/keep';
  const TEXT_MAX = 262144;
  const CORE = ['cat','head','tail','wc','sort','uniq','cut','tr','tee','comm','join','paste','seq','fold','shuf','md5sum','date'];
  class FileRef { constructor(apath, binary=false) { this.apath=apath; this.binary=binary; } }
  // While a command of the AI agent runs, the shell's file system notes every path that is worked out through it
  // (terminal.js: watched). What is done here looks at all files, whatever the command names: it uses the file system itself.
  const real=fs=>(fs&&fs.__real)||fs;
  MG.FileRef=FileRef;
  /** The environment of a program, as NAME=value: the variables that the shell exports (export NAME, declare -x,
      NAME=value COMMAND, env NAME=value COMMAND) – awk's ENVIRON, jq's env and getenv() in every program see them,
      and LC_ALL=C means bytes to sort, grep, sed, wc and awk as it does on Linux. PWD and _ are there as bash sets
      them. Left out: TMPDIR when it names a folder outside the home folder (a program's own /tmp is not the /tmp of
      this terminal: sort would look for a folder that it cannot see). */
  function envOf(ctx,program,fs){
    const st=ctx.opts&&ctx.opts.st,vars=ctx.env||{},out=[],home=fs.home;
    const names=st&&st.exported?Array.from(st.exported):Object.keys(vars);
    let pwd=false;
    for(const k of names){
      let v=vars[k];
      // (a variable that a function declared local and gave no value: the program still gets the value from outside)
      if(v===undefined&&st&&st.locals&&st.locals.has(k))v=st.locals.get(k);
      if(typeof v!=='string'||k==='_'||!/^[A-Za-z_]\w*$/.test(k)||v.includes('\0'))continue;
      if(k==='TMPDIR'&&!(v===home||v.startsWith(home+'/')))continue;
      if(k==='PWD')pwd=true;
      // (cmp says "differ: byte 7" – and "char 7" where the language of the messages is C or POSIX; diff -c dates
      // its files "2024-03-05 12:34:56.000000000 +0000" – and "Tue Mar  5 12:34:56 2024" where the language of
      // times is C or POSIX. The C library of these builds takes C.UTF-8 for C in these respects, Linux's does
      // not: the two programs get the name of a language instead.)
      out.push(k+'='+((program==='cmp'||program==='diff')&&/^(LANG|LC_ALL|LC_MESSAGES|LC_TIME)$/.test(k)&&/^C\.utf-?8$/i.test(v)?'en_US.UTF-8':v));
    }
    if(!pwd&&(!st||!st.exported||st.exported.has('PWD')))out.push('PWD='+fs.cwd);
    if(ctx.shell&&ctx.shell.oldpwd&&(!st||!st.exported||st.exported.has('OLDPWD'))&&typeof vars.OLDPWD!=='string')out.push('OLDPWD='+ctx.shell.oldpwd);
    const name=String(ctx.name||program);
    if(!(st&&st.envEmptied))out.push('_='+(name.includes('/')?name:'/usr/bin/'+name));
    return out;
  }
  /* Programs that run as genomics-wasm built them, each command in a worker of its own: their modules are in
     assets/vendor/genomics-wasm/. threads: the program counts on several threads (Emscripten pthreads,
     SharedArrayBuffer), which needs a cross-origin isolated page. worker: the worker that runs it (Cutadapt is a
     Python program: its own worker starts the Python that comes with it). outputs: the options whose value the program
     writes (a file, or a folder) – it is not handed over (salmon quant -o OUT: OUT may hold the results of an earlier
     run). flow: a workflow of several commands, in place of one (lofreq somatic; Strelka's runWorkflow.py – somatic.js). */
  const OWN_WORKER={
    featurecounts:{name:'featureCounts',module:'featurecounts/2.1.1/featurecounts.mjs',threads:true,outputs:()=>['-o','--tmpDir']},
    salmon:{name:'salmon',module:'salmon/2.8.0/salmon.mjs',threads:true,outputs:a=>a[0]==='index'?['-i','--index','-o','--output','--tmpdir']:['-o','--output','--auxDir','--tmpdir']},
    cutadapt:{name:'cutadapt',module:'cutadapt/5.2/manifest.json',worker:'assets/js/python-worker.mjs',pyodide:'pyodide/314.0.7/',outputs:()=>['-o','--output','-p','--paired-output','--info-file','--rest-file','--wildcard-file','--too-short-output','--too-short-paired-output','--too-long-output','--too-long-paired-output','--untrimmed-output','--untrimmed-paired-output','--json']},
    lofreq:{name:'lofreq',module:'lofreq/2.1.5/lofreq.mjs',outputs:()=>['-o','--out','--outprefix'],flow:a=>a[0]==='somatic'&&MG.somatic?MG.somatic.lofreq:null},
    somaticsniper:{name:'bam-somaticsniper',module:'somaticsniper/1.0.5.0/somaticsniper.mjs',outputs:()=>[]},
    // Strelka's workflow script: python2 RUNDIR/runWorkflow.py (made by configureStrelkaSomaticWorkflow.py)
    strelka2:{name:'runWorkflow.py',module:'strelka2/2.9.10/strelka2.mjs',outputs:()=>[],flow:()=>MG.somatic&&MG.somatic.strelka},
    // Kraken2's commands (kraken2, kraken2-inspect, kraken2-build) and Bracken's (bracken, bracken-build and its three
    // programs): wrapper scripts upstream, run by the terminal – each program of theirs in a worker of its own
    // (metagenomics.js); Bracken's Python programs in the Python that comes with them, as Cutadapt's
    kraken2:{name:'kraken2',module:'kraken2/2.17.2/classify.mjs',outputs:()=>[],flow:()=>MG.metagenomics&&MG.metagenomics.kraken2},
    bracken:{name:'bracken',module:'bracken/3.1/manifest.json',worker:'assets/js/python-worker.mjs',pyodide:'pyodide/314.0.7/',outputs:()=>[],flow:()=>MG.metagenomics&&MG.metagenomics.bracken},
    // MACS3 (the peaks of ChIP-seq, ATAC-seq …): a Python program too, in the same Python – with NumPy, SciPy,
    // scikit-learn, pandas, h5py and AnnData (Pyodide's own packages, next to the shared Python) and the two wheels
    // compiled for it (hmmlearn, MACS3). Its options that name what it writes: --outdir, -o (one file; three for
    // bdgdiff, several for bdgcmp), --o-prefix, -n (the prefix of callpeak's and hmmratac's files) and --rfile
    // (prewarm: after a command, the next one's worker gets its Python ready in the background – see W.prewarm)
    macs3:{name:'macs3',module:'macs3/3.0.5/manifest.json',worker:'assets/js/python-worker.mjs',pyodide:'pyodide/314.0.7/',prewarm:true,outputs:()=>['--outdir','-o','--ofile','--o-prefix','-n','--name','--rfile']},
    // Prodigal (the genes of bacteria and archaea) and bustools (single-cell BUS files): one thread each, in any page.
    // Prodigal reads a genome from its standard input twice (it learns the genome's model first): see prodigalFlow
    prodigal:{name:'prodigal',module:'prodigal/2.6.3/prodigal.mjs',outputs:()=>PRODIGAL_OUTS,flow:()=>prodigalFlow},
    bustools:{name:'bustools',module:'bustools/0.45.1/bustools.mjs',outputs:()=>['-o','--output','-T','--temp']},
    // PLINK 2: threads even with --threads 1 (it reads its files on threads of their own), so a cross-origin isolated
    // page, as featureCounts and Salmon. Its inputs are often filesets named by a prefix: see plink2Flow
    plink2:{name:'plink2',module:'plink2/2.0.0-b.1-dev/plink2.mjs',threads:true,outputs:()=>['--out','-out'],flow:()=>plink2Flow}
  };
  // HMMER 3.4: thirteen programs, a module each (the SIMD of WebAssembly stands in for SSE2: every browser of the last
  // years has it). Their options that name a file they write:
  const HMMER=['hmmbuild','hmmsearch','hmmscan','hmmpress','hmmfetch','hmmalign','hmmconvert','hmmemit','hmmstat','phmmer','jackhmmer','nhmmer','nhmmscan'];
  const HMMER_OUTS=['-o','-A','-O','--tblout','--domtblout','--pfamtblout','--dfamtblout','--aliscoresout','--chkhmm','--chkali','--hmmout'];
  for(const p of HMMER)OWN_WORKER[p]={name:p,module:`hmmer/3.4/${p}.mjs`,outputs:()=>HMMER_OUTS};
  // Prodigal's options with a file it writes (-t: the training file is written when it is not there, and read when it is)
  const PRODIGAL_OUTS=['-o','-O','-a','-A','-d','-s','-S'];
  /* Prodigal and its standard input. In single-genome mode (no -p meta, no -t) Prodigal reads the genome twice – to learn
     its model, then to find the genes – so it rewinds its input: a file given with < it reads as it is, and a pipe it
     first copies into a file of the working folder (tmp.prodigal.stdin.PID; "Piped input detected, copying stdin to a
     tmp file...done!"), which it removes at the end. Its WebAssembly build sees a character device there (as a terminal
     is), and would print its help. So the terminal hands the input over as a file – outside the folders of the terminal
     – and says what Prodigal says for a pipe. (-i, -I: a file given; without input, Prodigal prints its help, as here.) */
  async function prodigalFlow(args,h){
    const T={name:'prodigal',module:'prodigal/2.6.3/prodigal.mjs'};
    const has=(...o)=>args.some(a=>o.includes(a)),val=(...o)=>{let v=null;args.forEach((a,i)=>{if(o.includes(a)&&i+1<args.length)v=args[i+1];});return v;};
    const mode=val('-p','-P'),train=val('-t','-T');
    const copy=!!(h.stdin&&!has('-i','-I')&&!(mode&&mode!=='single')&&train==null&&!has('-h','-H','-v','-V'));
    const STDIN='/.prodigal/stdin';
    const files=await h.inputsOf(args,PRODIGAL_OUTS);
    if(copy)files.push({path:STDIN,data:h.stdin});
    // (what Prodigal writes: below the working folder, and the folders of the files it is asked to write)
    const outs=[];args.forEach((a,i)=>{if(i+1<args.length&&(PRODIGAL_OUTS.includes(a)||((a==='-t'||a==='-T')&&!h.isFile(h.abs(args[i+1])))))outs.push(h.abs(args[i+1]));});
    const roots=[...new Set([h.cwd,...outs.map(p=>p.slice(0,p.lastIndexOf('/'))||'/')])];
    const r=await h.spawn(T,{args:copy?[...args,'-i',STDIN]:args,thisProgram:'prodigal',files,roots,dirs:roots.filter(d=>d==='/'||h.isDir(d)),stdin:copy?null:h.stdin});
    if(r.error)throw new Error(r.error);
    let stderr=r.stderr,order=r.order||[];
    if(copy&&h.stdinPipe&&!has('-q','-Q')){
      // after Prodigal's header (its first five lines): the lines of the copy, as on Linux
      const text=new TextDecoder().decode(stderr),head=text.split('\n').slice(0,5).join('\n')+'\n';
      if(text.startsWith(head)&&/^-+\nPRODIGAL v/.test(head)){
        const add=new TextEncoder().encode('Piped input detected, copying stdin to a tmp file...done!\n-------------------------------------\n');
        const at=new TextEncoder().encode(head).length,all=new Uint8Array(stderr.length+add.length);
        all.set(stderr.subarray(0,at));all.set(add,at);all.set(stderr.subarray(at),at+add.length);stderr=all;
        // (the header is in the first stretch of messages)
        if(order[0]===2&&order[1]>=at)order=[2,order[1]+add.length,...order.slice(2)];
      }
    }
    return {exitCode:r.exitCode,stdout:r.stdout,stderr,order,files:r.files,stdinPos:copy?h.stdin.length:r.stdinPos};
  }
  /* PLINK 2 and its files. Its inputs are often filesets named by a prefix: --pfile NAME reads NAME.pgen, NAME.pvar (or
     NAME.pvar.zst) and NAME.psam, --bfile NAME the PLINK 1 files NAME.bed, .bim and .fam – and so do --bpfile, --pmerge,
     --pgen-diff …; --pmerge-list FILE names filesets in a file (in the folder of --pmerge-list-dir, if given). The
     program is given every file that an argument names and, for an argument NAME, every file NAME.EXT of a fileset
     (PLINK_EXTS). It writes its files with the prefix of --out (plink2 without it) – PREFIX.log, PREFIX.afreq … – in the
     folder of the prefix; temporary files (PREFIX-temporary.pgen …) it removes itself. The paths are the terminal's: the
     log names the files and the working folder as they were typed. */
  const PLINK_EXTS=['pgen','pgen.pgi','pvar','pvar.zst','psam','bed','bim','bim.zst','fam','gen','gen.zst','sample','bgen','bgen.bgi'];
  // (an argument of PLINK 2 is an option when it starts with - and goes on with neither a digit nor a dot: -1 is a number)
  const plinkFlag=a=>a.length>1&&a[0]==='-'&&!/[\d.]/.test(a[1])?a.replace(/^--?/,''):null;
  async function plink2Flow(args,h){
    const T={name:'plink2',module:OWN_WORKER.plink2.module};
    let out='plink2',list=null,listDir='';
    args.forEach((a,i)=>{
      const f=plinkFlag(a),v=args[i+1];
      if(v==null||plinkFlag(v)!=null)return;
      if(f==='out')out=v;else if(f==='pmerge-list')list=v;else if(f==='pmerge-list-dir')listDir=v.replace(/\/?$/,'/');
    });
    // (and the files of modifiers: --glm local-covar=FILE, --freq refbins-file=FILE …)
    const words=[];
    args.forEach((a,i)=>{
      if(plinkFlag(a)!=null||(i&&plinkFlag(args[i-1])==='out'))return;
      words.push(a);
      if(a.indexOf('=')>0)words.push(a.slice(a.indexOf('=')+1));
    });
    // (the filesets that --pmerge-list names: a prefix, or the files of a fileset, on each line)
    if(list&&h.isFile(h.abs(list)))for(const w of (await h.readText(h.abs(list))).split(/\s+/).filter(Boolean))words.push(w.startsWith('/')?w:listDir+w);
    const files=await h.inputsOf([...words,...words.flatMap(w=>PLINK_EXTS.map(e=>`${w}.${e}`))],[]);
    const outDir=(p=>p.slice(0,p.lastIndexOf('/'))||'/')(h.abs(out));
    const roots=[...new Set([h.cwd,outDir])];
    const r=await h.spawn(T,{args,thisProgram:'plink2',files,roots,dirs:roots.filter(d=>d==='/'||h.isDir(d)),stdin:h.stdin});
    if(r.error)throw new Error(r.error);
    return {exitCode:r.exitCode,stdout:r.stdout,stderr:r.stderr,order:r.order||[],files:r.files,stdinPos:r.stdinPos};
  }
  /* PLINK 2's threads and working memory. In the browser it computes on one or two threads, in 640 to 1024 MiB (640 is
     the least PLINK 2 takes): without --threads and --memory the terminal adds  --threads 1 --memory 640 require , as
     genomics-wasm's runner does; more threads become 2, more memory 1024 – with a note. --script and --rerun (options
     read from a file) are not available: the terminal must see those two options – and in this development version of
     PLINK 2, --script stops even the native program (a buffer overflow). --help, -h, --version and --zst-decompress need
     no memory; plink2 alone prints its summary. → the arguments, or {refuse: message} */
  function plink2Args(args,io){
    const names=args.map(plinkFlag);
    const bad=args.find((a,i)=>names[i]==='script'||names[i]==='rerun');
    if(bad)return {refuse:`plink2: ${bad} is not available here – the terminal must see every option of PLINK 2 (it sets its threads and its memory). Give the options on the command line, or read them from the file:  plink2 $(cat FILE)`};
    if(!args.length||['zst-decompress','zd'].includes(names[0])||names.some(n=>['help','h','version'].includes(n)))return args;
    const out=[];let threads=false,memory=false;
    for(let i=0;i<args.length;i++){
      const a=args[i],n=names[i];
      // (the values of an option: the arguments up to the next option)
      let j=i+1;while(j<args.length&&names[j]==null)j++;
      const vals=args.slice(i+1,j);
      if(['threads','thread-num','num_threads'].includes(n)){
        threads=true;
        if(vals.length===1&&/^\d+$/.test(vals[0])&&+vals[0]>2){
          out.push(a,'2');
          if(io&&io.note)io.note(`plink2: ${a} ${vals[0]} is ${a} 2 here – in the browser PLINK 2 computes on two threads at most.`);
        }else out.push(a,...vals);
        i=j-1;continue;
      }
      if(n==='memory'){
        memory=true;
        const k=vals.findIndex(v=>/^\d+$/.test(v));
        if(vals.length<=2&&k>=0&&+vals[k]>1024){
          const was=vals.join(' ');vals[k]='1024';
          if(io&&io.note)io.note(`plink2: ${a} ${was} is ${a} ${vals.join(' ')} here – in the browser PLINK 2 works in 1024 MiB of memory at most.`);
        }
        out.push(a,...vals);
        i=j-1;continue;
      }
      out.push(a);
    }
    if(!threads)out.push('--threads','1');
    if(!memory)out.push('--memory','640','require');
    return out;
  }
  // the index files that a program finds next to a file it is given (NAME.bam: NAME.bam.bai or NAME.bai; a FASTA file:
  // its .fai, and the .gzi of a compressed one; a compressed VCF or BED: its .tbi or .csi; HMMER's profiles: the four
  // files of hmmpress, and the SSI index of hmmfetch --index – of the pressed file, .h3m.ssi, when it is pressed) – handed
  // over with it
  const INDEX_SUFFIXES=['.bai','.csi','.crai','.fai','.gzi','.tbi','.h3m','.h3i','.h3f','.h3p','.ssi','.h3m.ssi'];
  // how long a worker made ready in advance (W.prewarm) waits for its command before it is stopped
  const SPARE_MS=15*60*1000;
  const W = {
    ready:false, loading:null, cli:null, pipeN:0, mountN:0,
    synced:new Map(), placed:new Map(), managed:new Set(), dirs:new Set(), gone:[], denied:[], refused:[],
    gen:0, kept:new Map(), keepN:0,
    versions:{fastp:'0.20.1',minimap2:'2.22',bowtie2:'2.4.2',bwa:'0.7.19','bwa-mem2':'2.2.1',hisat2:'2.2.2',freebayes:'1.3.6',stringtie:'3.0.3',kallisto:'0.52.0',mosdepth:'0.3.14',featurecounts:'2.1.1',salmon:'2.8.0',cutadapt:'5.2',macs3:'3.0.5',lofreq:'2.1.5',somaticsniper:'1.0.5.0',strelka2:'2.9.10',kraken2:'2.17.2',bracken:'3.1',prodigal:'2.6.3',hmmer:'3.4',bustools:'0.45.1',plink2:'2.0.0-b.1-dev',samtools:'1.17',bcftools:'1.10',htslib:'1.17',seqtk:'1.4',bedtools:'2.31.0',jq:'1.7',gawk:'5.1.0',grep:'3.7',sed:'4.8',coreutils:'8.32',diffutils:'3.10',kalign:'3.3.1',muscle:'3.8.1551',fasttree:'2.1.11','seq-align':'2017.10.18',wgsim:'0.3.1-r13',gffread:'0.12.7',lastz:'1.04.52'},
    apath(abs) { return ROOT+abs; },
    ensure(status) {
      if(this.ready)return Promise.resolve(this.cli);
      if(this.loading)return this.loading;
      const base=new URL(MG.config.biowasmBase||'assets/vendor/biowasm',location.href).href.replace(/\/$/,'');
      this.loading=(async()=>{
        if(!window.Aioli)await loadScript(base+'/aioli.js');
        status?.('Starting the local WebAssembly filesystem…');
        // 'base' holds the shared file system and never runs a program: a tool that aborts is replaced without losing the files
        const specs=[['base','1.0.0'],['samtools','1.17'],['bcftools','1.10'],['htslib','1.17','bgzip'],['htslib','1.17','tabix'],['minimap2','2.22'],['bowtie2','2.4.2','bowtie2-align-s'],['bowtie2','2.4.2','bowtie2-build-s'],['bwa','0.7.19'],['bwa-mem2','2.2.1'],['hisat2','2.2.2'],['freebayes','1.3.6'],['stringtie','3.0.3'],['kallisto','0.52.0'],['mosdepth','0.3.14'],['fastp','0.20.1'],['seqtk','1.4'],['bedtools','2.31.0'],['jq','1.7'],['gawk','5.1.0'],['grep','3.7'],['grep','3.11','grep-perl'],['sed','4.8'],['diffutils','3.10','diff'],['diffutils','3.10','cmp'],['kalign','3.3.1'],['muscle','3.8.1551'],['fasttree','2.1.11'],['seq-align','2017.10.18','needleman_wunsch'],['seq-align','2017.10.18','smith_waterman'],['seq-align','2017.10.18','lcs'],['wgsim','2011.10.17'],['gffread','0.12.7'],['lastz','1.04.52'],...CORE.map(p=>['coreutils','8.32',p])];
        const tools=specs.map(([tool,version,program])=>({tool,version,program:program||tool,urlPrefix:`${base}/${tool}/${version}`,loading:'lazy',features:{}}));
        this.cli=await new window.Aioli(tools,{printInterleaved:false,urlCDN:base,debug:false});
        await mkdirp(this.cli,TMP); await mkdirp(this.cli,KEEP); this.ready=true; MG.bus.emit('wasm:ready',{}); return this.cli;
      })().catch(e=>{this.loading=null;throw e;});
      return this.loading;
    },
    // (decoded here, not by the programs' file system: that one stops at the first NUL byte – find -print0 | sort -z)
    async readText(p){return new TextDecoder('utf-8',{ignoreBOM:true}).decode(await (await this.ensure()).fs.readFile(p));},
    async readBytes(p){return (await this.ensure()).fs.readFile(p);},
    /* how many bytes a file of the programs holds (what one program wrote for the next) */
    async sizeOf(p){const s=await stat(await this.ensure(),p);return s?s.size:0;},
    async readTextSmart(p){return this.readText(p);},
    async stat(p){return stat(await this.ensure(),p);},
    /* known: what is in the programs' file system (see snapshot) – asked once for all files, not once per file. */
    async syncIn(fs,abs,known){
      fs=real(fs);
      const e=fs.entries.get(abs), cli=this.cli, dest=this.apath(abs);
      if(!e)return;
      // (what is under ROOT, and no file of a pipe, is in the list – or is not there)
      const look=p=>known&&p.startsWith(ROOT+'/')&&!p.startsWith(TMP)?Promise.resolve(known.get(p)||null):stat(cli,p);
      const folder=async d=>{
        if(known&&(d===ROOT||(known.get(d)||{}).isDir))return;
        await mkdirp(cli,d);
        if(known)for(let q=d;q.length>ROOT.length;q=MG.path.dirname(q))known.set(q,{size:0,mtime:0,isDir:true,sig:''});
      };
      if(e.kind==='dir'){await folder(dest);this.dirs.add(abs);return;}
      await folder(MG.path.dirname(dest));
      // a folder of that name that is still there (it could not be removed) must not stop every later program
      const there=await look(dest);
      if(there&&there.isDir){await rmtree(cli,dest);if(known)known.delete(dest);}
      if(e.kind==='virtual')throw MG.shellUtil.userErr('This lab requires actual file bytes; simulated files cannot be processed.');
      const prior=this.synced.get(abs);
      // a read-only file is read-only for the programs too (they get "Permission denied")
      const locked=!!(e.readonly||e.protected);
      // (the file keeps the time of its last change: diff -u and diff -c print it. Last of all: in this file system
      // a change of the permissions sets the time, too)
      const stamp=async()=>{if(e.mtime)try{await cli.fs.utime(dest,e.mtime,e.mtime);}catch(x){}};
      const write=async data=>{if(await stat(cli,dest))await cli.fs.chmod(dest,0o644);await cli.fs.writeFile(dest,data);if(locked)await cli.fs.chmod(dest,0o444);await stamp();};
      if(e.kind==='text'){
        if(prior!==e||e.dirty||!(await look(dest))){await write(e.text);e.dirty=false;}
      }else if(e.kind==='aioli'){
        if(prior!==e||e.apath!==dest){
          if(!(await look(e.apath))){
            // its bytes are gone: a name without contents must not stay behind (every later program would stop)
            fs.entries.delete(abs);fs._changed(abs,'remove');this.synced.delete(abs);this.managed.delete(abs);this.gone.push(abs);return;
          }
          if(e.apath!==dest){await write(await cli.fs.readFile(e.apath));e.apath=dest;}
          else{await cli.fs.chmod(dest,locked?0o444:0o644);await stamp();}
        }
      }else if(e.kind==='url'||e.kind==='blob'){
        // the course data is copied in as real bytes
        if(prior!==e||!(await look(dest)))await write(await fs.readBytes(abs));
      }else throw MG.shellUtil.userErr(`Unsupported file entry: ${e.kind}`);
      this.synced.set(abs,e);this.managed.add(abs);
    },
    /* A file that was copied or moved (cp, mv) still has its bytes at the old place, until a program
       needs it. settle gives every such file its own bytes: all of them are read first, then written –
       so that it does not matter in which order they are, or what else is written to the old places.
       between() runs after the reading and before the writing. */
    async settle(fs,between){
      fs=real(fs);
      const cli=this.cli,moved=[];
      for(const [abs,e] of Array.from(fs.entries))if(e.kind==='aioli'&&e.apath!==this.apath(abs)){
        if(await stat(cli,e.apath))moved.push([abs,e,await cli.fs.readFile(e.apath)]);
        else{fs.entries.delete(abs);fs._changed(abs,'remove');this.gone.push(abs);}
      }
      if(between)await between();
      for(const [abs,e,bytes] of moved){
        if(fs.entries.get(abs)!==e)continue;
        const dest=this.apath(abs);
        await place(cli,dest,bytes);e.apath=dest;this.noteDirs(abs);
        if(e.readonly||e.protected)await cli.fs.chmod(dest,0o444);
        this.synced.set(abs,e);this.managed.add(abs);
      }
    },
    /** the folders above abs exist in the programs' file system: remember them (syncAll removes those the page no longer has) */
    noteDirs(abs){for(let d=MG.path.dirname(abs);d&&d!=='/';d=MG.path.dirname(d))this.dirs.add(d);},
    /* Make the programs' file system the same as the page's.
       1. Copied and moved files get their own bytes (settle).
       2. In between: files that are no longer there are removed – and folders too, deepest first.
          (Left there, a folder that was removed with rm -r would come back, empty, after the next
          program.) The programs first leave the folder they were in: a folder cannot be removed while
          it is somebody's working directory.
       3. Everything else is brought up to date. */
    async syncAll(fs){
      fs=real(fs);
      const cli=this.cli;
      await this.settle(fs,async()=>{
        await cli.cd(ROOT);
        for(const abs of Array.from(this.managed)){
          const e=fs.entries.get(abs);
          if(!e||e.kind==='dir'){
            try{await cli.fs.unlink(this.apath(abs));}catch(x){}
            this.managed.delete(abs);this.synced.delete(abs);
          }
        }
        for(const abs of Array.from(this.dirs).sort((a,b)=>b.length-a.length))if(!fs.isDir(abs)){
          try{await cli.fs.rmdir(this.apath(abs));}catch(x){}
          this.dirs.delete(abs);
        }
      });
      // (what is there now: one answer for the whole tree)
      const known=await this.snapshot();
      for(const [abs] of Array.from(fs.entries))await this.syncIn(fs,abs,known);
    },
    /* ---- for the AI agent: what it changes outside its own folder is put back (assistant.js) ----
       A file of kind 'aioli' has its bytes only here, in the programs' memory. Before a command of the
       agent runs, each such file outside the agent's folder is copied (once per run of the agent);
       putBack writes the copy back where a command changed or removed the file. */
    async keep(list){
      if(!this.ready)return 0;
      const cli=this.cli;let n=0;
      for(const [,e] of list){
        if(e.kind!=='aioli')continue;
        const had=this.kept.get(e);
        if(had&&had.gen===this.gen)continue;
        const s=await stat(cli,e.apath);
        if(!s||s.isDir)continue;
        const path=`${KEEP}/${++this.keepN}`;
        await cli.fs.writeFile(path,await cli.fs.readFile(e.apath));
        this.kept.set(e,{path,sig:s.size+':'+s.mtime,gen:this.gen});n++;
      }
      return n;
    },
    /** the entry e is at abs in the page's file system again: make sure its bytes are there too.
        since: when the command started (ms). → false: the bytes are lost */
    async putBack(abs,e,since){
      if(!this.ready)return false;
      const cli=this.cli,dest=this.apath(abs),now=await stat(cli,e.apath);
      let k=this.kept.get(e);if(k&&k.gen!==this.gen)k=null;
      // untouched: the file is as it was when the copy was made. (Without a copy: there, of the size the
      // entry records, and not written since the command started.)
      const same=!!now&&!now.isDir&&(k?now.size+':'+now.mtime===k.sig:now.size===e.size&&(!since||now.mtime<since));
      if(!same&&!k)return false;
      const moved=!same||e.apath!==dest;
      if(moved){await place(cli,dest,await cli.fs.readFile(same?e.apath:k.path));e.apath=dest;this.noteDirs(abs);}
      await cli.fs.chmod(dest,e.readonly||e.protected?0o444:0o644);
      // (the time of the file changes with chmod: the mark of "untouched" is taken afterwards)
      if(k){const s=await stat(cli,dest);k.sig=s.size+':'+s.mtime;}
      this.synced.set(abs,e);this.managed.add(abs);
      return true;
    },
    async dropKept(){
      const all=Array.from(this.kept.values());this.kept.clear();
      if(!this.ready)return;
      for(const k of all)if(k.gen===this.gen)try{await this.cli.fs.unlink(k.path);}catch(x){}
    },
    /* everything in the programs' file system (but the files of pipes): path → {size, mtime, isDir, sig}. The
       worker answers for the whole tree at once (statTree, a local addition to aioli.js): asked file by file,
       a folder of a thousand files made every program take a second longer. */
    async snapshot(){
      const out=new Map();
      for(const [p,size,mtime,isDir] of await this.cli.statTree(ROOT,'.pipes'))out.set(p,{size,mtime,isDir,sig:size+':'+mtime});
      return out;
    },
    /* A file that a program wrote joins the page's file system. A small text file (a table, a log,
       a JSON report, an edited script) becomes an ordinary text file: it can be edited and is saved
       with the student's work. Anything else (BAM, .gz, large files) stays in the programs' memory. */
    async adopt(fs,abs,apath,size,bytes,like){
      fs=real(fs);
      const there=fs.get(abs),was=there&&there.kind!=='dir'?there:(like||null),keep={};
      // (a file that took the place of a read-only one is read-only, too: sed -i gives the new file the old one's permissions.
      // like: the file that a program renamed to this name – it keeps its permissions under the new name, see importChanges)
      if(was&&was.kind!=='dir'){if(was.mode)keep.mode=was.mode;if(was.perm!=null)keep.perm=was.perm;if(was.readonly&&!was.protected)keep.readonly=true;}
      let text=null;
      if(size<=TEXT_MAX){
        try{
          if(!bytes)bytes=await this.cli.fs.readFile(apath);
          const t=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
          if(t.indexOf('\u0000')<0)text=t;
        }catch(e){text=null;}
      }
      // (its time is the time at which the program wrote it)
      const made=await stat(this.cli,apath);if(made&&made.mtime)keep.mtime=made.mtime;
      if(text!=null){fs.put(abs,Object.assign({kind:'text',text,fresh:true},keep));fs.get(abs).dirty=false;}
      else fs.put(abs,Object.assign({kind:'aioli',apath,size,fresh:true},keep));
      this.synced.set(abs,fs.get(abs));this.managed.add(abs);
    },
    /* what a program changed in the WebAssembly file system becomes part of the page's file system.
       A file of the course data that a program changed or removed is put back (the folder is not the student's).
       A read-only file of the student's own is another matter: the programs cannot write into it (it has mode 444
       in their file system: "Permission denied"), but a program may put a new file in its place or remove it
       – sed -i, gzip, bgzip do: that takes a folder one may write to, as on Linux.
       The inputs of an agent's run (~/runs/N-…/data/NAME: read-only copies of the course data) are such files:
       an agent can replace its own copies, and the script made from the run does the same – which is why the
       practical tests a script on a fresh copy of the course data. */
    async importChanges(fs,before){
      fs=real(fs);
      const after=await this.snapshot(),created=[];this.denied=[];this.refused=[];
      const guarded=abs=>{const e=fs.get(abs);return !!e&&e.kind!=='aioli'&&e.kind!=='dir'&&!!e.protected;};
      // A new name in a folder of the example data (samtools faidx /data/examples/…/x.fasta writes x.fasta.fai next to
      // it): those folders take nothing new – see refusesNew in vfs.js. It is removed again, and the run says so
      // (refused). (What was there before the program ran and is unchanged is a leftover: removed without a word.)
      const out=[],underOut=abs=>out.some(r=>abs.startsWith(r+'/'));
      // A file that a program renamed – sed -i.bak: FILE becomes FILE.bak, and a new FILE is written – keeps its
      // permissions under the new name, as on Linux. The programs' file system does not hold them (the page does), so
      // a renamed file is told by what a rename leaves as it was, its size and its time: a name that is new and has the
      // size and time that another file had before the program ran – a file that is gone now, or has changed. Where
      // several files had that size and time (three files written by one loop), the names decide: FILE.bak begins with
      // FILE, and a backup in a folder of its own (sed -i'bak/*') has the name of its file.
      const moved=new Map();
      for(const [p,s] of before){if(s.isDir)continue;const now=after.get(p);if(!now||now.isDir||now.sig!==s.sig){if(!moved.has(s.sig))moved.set(s.sig,[]);moved.get(s.sig).push(p.slice(ROOT.length));}}
      const last=x=>x.slice(x.lastIndexOf('/')+1);
      const renamedFrom=(old,s,abs)=>{
        const c=old?null:moved.get(s.sig);
        if(!c)return null;
        const from=c.filter(q=>abs.length>q.length&&abs.startsWith(q)).sort((a,b)=>b.length-a.length)[0]||c.find(q=>last(q)===last(abs))||(c.length===1?c[0]:null);
        const e=from?fs.get(from):null;
        return e&&e.kind!=='dir'&&!e.protected?e:null;
      };
      for(const [p,s] of after){
        const abs=p.slice(ROOT.length), old=before.get(p);
        if(underOut(abs))continue;
        if(fs.refusesNew(abs)){out.push(abs);if(!old||(!s.isDir&&old.sig!==s.sig))this.refused.push(abs);continue;}
        if(s.isDir){
          this.dirs.add(abs);
          if(!fs.exists(abs))fs.mkdirp(abs);
          // (a program that made, renamed or removed a name in a folder – sed -i does all three – has changed the folder:
          // its time moves on, as on Linux; see _dirTouched in vfs.js)
          else if(old&&s.mtime>old.mtime){const d=fs.entries.get(abs);if(d&&d.kind==='dir'&&s.mtime>(d.mtime||0))d.mtime=s.mtime;}
          continue;
        }
        if(old&&old.sig===s.sig)continue;
        if(guarded(abs)){this.denied.push(abs);this.synced.delete(abs);continue;}
        await this.adopt(fs,abs,p,s.size,undefined,renamedFrom(old,s,abs));created.push(abs);
      }
      for(const [p,s] of before)if(!s.isDir&&!after.has(p)){
        const abs=p.slice(ROOT.length);
        if(guarded(abs)){this.denied.push(abs);this.synced.delete(abs);continue;}
        fs.remove(abs);this.managed.delete(abs);
      }
      for(const abs of out){
        const p=ROOT+abs;
        try{const st=await stat(this.cli,p);if(st&&st.isDir)await rmtree(this.cli,p);else if(st)await this.cli.fs.unlink(p);}catch(x){}
      }
      return created;
    },
    /* Bytes that the shell has in hand (what a block printed: { samtools view -b …; } > x.bam, f | samtools …):
       writeBytes makes them a file of the page; tempBytes a file for the next command of a pipe to read. */
    async writeBytes(fs,abs,bytes){
      fs=real(fs);
      // (nothing new in a folder of the example data – refused before anything is written)
      if(fs.refusesNew(abs))fs._refuseNew(abs);
      const cli=await this.ensure(),dest=this.apath(abs);
      // (a file that was copied or moved – cp, mv – may still have its bytes at this very place: see settle.
      // Each such file gets its own bytes before anything is written here.)
      await this.settle(fs);
      await mkdirp(cli,MG.path.dirname(dest));
      const there=await stat(cli,dest);
      if(there&&there.isDir)await rmtree(cli,dest);else if(there)await cli.fs.chmod(dest,0o644);
      await cli.fs.writeFile(dest,bytes);
      await this.adopt(fs,abs,dest,bytes.length,bytes);
      this.noteDirs(abs);
    },
    async tempBytes(bytes,binary){
      const cli=await this.ensure(),path=`${TMP}/i${++this.pipeN}`;
      await cli.fs.writeFile(path,bytes);
      return new FileRef(path,!!binary);
    },
    /* a file of a pipe that is still needed (the input of a block or a script that runs several programs) is not
       tidied away: see cleanupPipes */
    held:new Map(),
    hold(p){this.held.set(p,(this.held.get(p)||0)+1);},
    release(p){const n=(this.held.get(p)||0)-1;if(n>0)this.held.set(p,n);else this.held.delete(p);},
    /* one WebAssembly program at a time */
    lock:Promise.resolve(),
    async run(ctx,program,args,opts={}){
      let release;const prev=this.lock;this.lock=new Promise(r=>(release=r));
      await prev;
      try{return await this._run(ctx,program,args,opts);}finally{release();}
    },
    async _run(ctx,program,args,opts={}){
      const start=performance.now(),fs=real(ctx.fs);
      // … but the arguments that name a file or a folder that is there are paths the command uses: they are noted.
      // (A pattern or a program – /^#/d, /human_CYP2C19/ – names none. A file that the command makes is seen
      // afterwards, when the page looks at what has changed.)
      if(ctx.fs!==fs){
        const kinds=MG.shellLang&&MG.shellLang.argKinds?MG.shellLang.argKinds(ctx.name||program,args):[];
        args.forEach((v,i)=>{
          const m=/^--[^=]+=(.+)$/.exec(v),w=m?m[1]:v;
          if(kinds[i]!=='skip'&&w&&!w.startsWith('-')&&fs.exists(w))ctx.fs.resolve(w);
        });
      }
      const status=s=>{if(ctx.term?.statusEl)ctx.term.statusEl.textContent=s;};
      await this.ensure(status);this.gone=[];await this.syncAll(fs);
      const cli=this.cli;let stdin=null,inherit=null;
      if(ctx.stdin instanceof FileRef)stdin=ctx.stdin.apath;
      else if(ctx.stdin!=null){
        if(typeof ctx.stdin!=='string')throw MG.shellUtil.userErr('Only real byte streams can enter a tool.');
        stdin=`${TMP}/i${++this.pipeN}`;await cli.fs.writeFile(stdin,ctx.stdin);
      }else if(ctx.inherit&&ctx.inherit.pos<ctx.inherit.text.length){
        // No input of its own: the program stands in a block, a function or a script that has one
        // ({ head -n 1; sort; } < FILE,  f() { wc -l; }; f < FILE,  while read x; do PROGRAM; done < FILE).
        // It gets what is left of that input, and afterwards the page looks at how much of it the program read:
        // a program that does not read leaves it to the commands after it. From the start of a file the program
        // gets the file itself (byte for byte); otherwise the rest of the text.
        inherit=ctx.inherit;
        const own=inherit.pos===0?(inherit.apath||(inherit.path&&fs.exists(inherit.path)&&!fs.isDir(inherit.path)?this.apath(inherit.path):null)):null;
        if(own&&await stat(cli,own))stdin=own;
        else{stdin=`${TMP}/i${++this.pipeN}`;await cli.fs.writeFile(stdin,inherit.text.slice(inherit.pos));}
        inherit.size=((await stat(cli,stdin))||{}).size||0;
      }
      await this.cleanupPipes(fs,stdin);
      // Paths in the student's home and in the example data are given to the programs as typed: each program has the
      // links /home/user (the home folder) and /data -> the shared folder (see links below), and prints the names it was given (in the
      // @PG lines of SAM files, the headers of VCF files). Other absolute paths (/tmp/…) are in the shared folder under ROOT.
      const home=fs.home,inHome=p=>p===home||p.startsWith(home+'/'),inData=p=>p==='/data'||p.startsWith('/data/');
      // (a path below /home/student – the home folder until October 2026 – is one below the home folder: see vfs.js)
      const pathToken=p=>(p=MG.VFS.unalias(fs,p),p.startsWith(ROOT)||p.startsWith('/dev/')||inHome(p)||(inData(p)&&p===MG.path.norm(p))?p:(p.startsWith('/')?this.apath(MG.path.norm(p)):p));
      // What is no path goes to the program as it was typed: a pattern (grep /tmp, awk '/chr1/'), a set of characters
      // (tr / _), a delimiter (cut -d /). Of the rest, absolute paths and absolute output destinations are rewritten.
      const kinds=MG.shellLang&&MG.shellLang.argKinds?MG.shellLang.argKinds(ctx.name||program,args):args.map(()=>'path');
      const stdoutPath=`${TMP}/o${++this.pipeN}`,stderrPath=`${TMP}/e${this.pipeN}`;
      // /dev/stdin, /dev/stdout and /dev/stderr as arguments (sort /dev/stdin, samtools sort -o /dev/stdout): the files
      // that are the program's input and output here. (In what the program prints they get their names back.)
      const dev={'/dev/stdin':()=>stdin||'/dev/null','/dev/fd/0':()=>stdin||'/dev/null','/dev/stdout':()=>stdoutPath,'/dev/fd/1':()=>stdoutPath,'/dev/stderr':()=>ctx.mergeStderr?stdoutPath:stderrPath,'/dev/fd/2':()=>ctx.mergeStderr?stdoutPath:stderrPath};
      const devUsed=new Map();
      // An operand that names nothing because of the way it is written – "FILE/", "nosuch/../x" (see VFS.forShell):
      // the programs' file system would take the dots and the slash away and find the file. So the program is given a
      // name in a folder that is not there (it can neither read nor make anything under it), and in what it prints the
      // name that was typed is put back (the same way as for /dev/stdin, see named below).
      let nowhere=0;const notDir=[];
      // (the shell is in a folder that was removed – a script after  rm -rf "$PWD" : the program cannot be started
      // there. An operand that names something that is there – ../a.txt – is handed over with its whole path.)
      const adrift=!fs.isDir(fs.cwd);
      const a=args.map((v,i)=>{
        if(kinds[i]==='skip')return v;
        if(adrift&&v&&!v.startsWith('-')&&!v.startsWith('/')&&v.includes('/')){const abs=ctx.fs.resolve(v);if(fs.entries.has(abs)){const full=pathToken(abs);devUsed.set(full,v);return full;}}
        if(v.includes('/')&&!v.startsWith('-')&&ctx.fs.pathError&&ctx.fs.pathError(v)){const fake=`.no-such-folder-${++nowhere}/x`;devUsed.set(fake,v);if(ctx.fs.pathError(v)==='Not a directory')notDir.push(v);return fake;}
        const d=/^(-[A-Za-z]|--[^=]+=)?(\/dev\/(?:stdin|stdout|stderr|fd\/[012]))$/.exec(v);
        if(d&&!(d[1]&&/^-[A-Za-z]$/.test(d[1])&&MG.shellLang&&MG.shellLang.optionSkips&&MG.shellLang.optionSkips(ctx.name||program,d[1]))){const real=dev[d[2]]();if(real!=='/dev/null')devUsed.set(real,d[2].replace('/dev/fd/0','/dev/stdin').replace('/dev/fd/1','/dev/stdout').replace('/dev/fd/2','/dev/stderr'));return (d[1]||'')+real;}
        if(v.startsWith('/')&&(fs.exists(v)||fs.isDir(MG.path.dirname(v))))return pathToken(v);
        // -o/tmp/x.bam, -f/tmp/patterns.txt: a path glued to its option (not the value of an option that takes a
        // pattern or a delimiter: -F/, -d/, -e/x/d)
        const o=/^(-[A-Za-z])(\/[^/]+\/.*)$/.exec(v);
        if(o&&!(MG.shellLang&&MG.shellLang.optionSkips&&MG.shellLang.optionSkips(ctx.name||program,o[1]))&&(fs.exists(o[2])||fs.isDir(MG.path.dirname(o[2]))))return o[1]+pathToken(o[2]);
        const m=/^(--[^=]+=)(\/.*)$/.exec(v);return m?m[1]+pathToken(m[2]):v;
      });
      if(ctx.mergeStderr)await cli.fs.writeFile(stdoutPath,'');
      // date -u, TZ=UTC date, TZ=America/New_York date: the clock of that zone (the programs take the time zone from the
      // browser, and no notice of TZ); and the short name of the time zone (BST), as date prints it on Linux.
      // The same for awk's strftime and mktime, and for the times of the files in the headers of diff -u and diff -c.
      let clock={};
      if(program==='date'||program==='gawk'||program==='diff'){
        const tz=ctx.env&&typeof ctx.env.TZ==='string'&&(!(ctx.opts&&ctx.opts.st&&ctx.opts.st.exported)||ctx.opts.st.exported.has('TZ'))?ctx.env.TZ:null;
        let zone=MG.time.zoneOf(ctx);
        if(program==='date'&&dateUTC(args))zone='UTC';
        if(tz&&!zone)ctx.io.note(`${ctx.name||program}: the time zone ${tz} (TZ) is not known in this browser – the time is that of this computer's zone`);
        clock={zoneName:true,zone:zone||null};
      }
      // sed in a block whose input is a file ({ sed 1q; cat; } < FILE): what sed did not use is left for the next command.
      // On Linux the C library puts the rest back when sed ends; here sed is handed its input a line at a time.
      const lines=program==='sed'&&!!inherit&&!inherit.pipe;
      // wc sets the width of its columns by what its input is: 7 for a pipe ("cat f | wc" →  "      3       3      17"),
      // the digits of the size for a file ("wc < f" → " 3  3 17"). Here a pipe is a file too – so wc is told. (bash
      // hands a here-document over as a pipe when it has 64 KiB at most, as a file when it has more.)
      // (… and Prodigal, which copies a pipe into a file before it reads it: see prodigalFlow)
      const piped=stdin!=null&&(ctx.stdin instanceof FileRef?(!ctx.stdin.fromFile||!!ctx.stdin.psub):ctx.stdin!=null?!(ctx.hereInput&&new Blob([ctx.stdin]).size>65536):!!(inherit&&inherit.pipe));
      const fifo=program==='wc'&&piped;
      const before=await this.snapshot();await cli.cd(this.apath(fs.isDir(fs.cwd)?fs.cwd:fs.home));
      status(`${program} is running locally…`);
      // (a workflow says which of its programs runs: lofreq somatic – lofreq call · 12 s)
      const timer=setInterval(()=>status(`${this.running||program}${this.stage?' – '+this.stage:''} · ${((performance.now()-start)/1000).toFixed(0)} s`),1000);
      let result;
      const killed=new Promise((_,reject)=>{this._killed=reject;});
      this.running=OWN_WORKER[program]?(ctx.name||OWN_WORKER[program].name):program;
      const job=OWN_WORKER[program]?this.execWorker(program,a,{stdin,stdout:stdoutPath,stderr:stderrPath,merge:!!ctx.mergeStderr,fs,before,name:ctx.name,io:ctx.io,flowOpts:opts.flow,devUsed,piped})
        :cli.execIO(program,a,{stdin,stdout:stdoutPath,stderr:ctx.mergeStderr?stdoutPath:stderrPath,merge:!!ctx.mergeStderr,links:[[this.apath(home),home],[this.apath('/data'),'/data']],lines,fifo,env:envOf(ctx,program,fs),...clock});
      try{result=await Promise.race([job,killed]);}
      catch(e){
        // not a forced stop (then there is nothing left to look at): the page's file system must still learn what was written.
        // No program is running any more: a forced stop that came now would end the worker under this very call.
        this._killed=null;this.running=null;
        if(this.ready&&this.cli===cli)try{await this.importChanges(fs,before);}catch(x){}
        throw e;
      }finally{clearInterval(timer);this._killed=null;this.running=null;}
      if(inherit){
        // how far the program read: in a file, where it left off (head -n 1 goes back behind the first line);
        // in what came through a pipe, the furthest byte it took
        const n=devUsed.has(stdin)?Infinity:inherit.pipe?Math.max(result.stdinMax||0,result.stdinPos||0):(result.stdinPos||0);
        if(n>0){
          // (n bytes of the file are so many characters of the text)
          const t=inherit.text;let k=inherit.pos,b=0;
          if(n>=inherit.size)k=t.length;
          else while(k<t.length&&b<n){const c=t.codePointAt(k);b+=c<0x80?1:c<0x800?2:c<0x10000?3:4;k+=c>0xffff?2:1;}
          inherit.pos=k;
        }
      }
      const created=await this.importChanges(fs,before);
      if(ctx.mergeStderr){
        // 2>&1: what the program wrote to stderr is in the output file – tidy it like stderr (see tidy)
        const st=await stat(cli,stdoutPath);
        if(st&&st.size&&st.size<=1048576)try{
          const t=new TextDecoder('utf-8',{fatal:true}).decode(await this.readBytes(stdoutPath)),t2=tidy(t,ctx.name||program);
          if(t2!==t)await cli.fs.writeFile(stdoutPath,t2);
        }catch(e){}
      }
      // (a file that stood for /dev/stdin … is called that again in what the program printed – also as a workflow
      // names it, with the terminal's path: bracken -o /dev/stdout)
      // (… and of a name that asks for a folder where a file is – "a.txt/", "a.txt/../x" – the program is told, in
      // Linux's words, why it was not found)
      const named=t=>{for(const [real,name] of devUsed){t=t.split(real).join(name);if(real.startsWith(TMP+'/'))t=t.split(real.slice(ROOT.length)).join(name);}if(notDir.length)t=t.split('\n').map(l=>notDir.some(v=>l.includes(v))?l.replace('No such file or directory','Not a directory'):l).join('\n');return t;};
      if(devUsed.size){
        const st=await stat(cli,stdoutPath);
        if(st&&st.size&&st.size<=1048576)try{
          const t=new TextDecoder('utf-8',{fatal:true}).decode(await this.readBytes(stdoutPath)),t2=named(t);
          if(t2!==t)await cli.fs.writeFile(stdoutPath,t2);
        }catch(e){}
      }
      const stderr=ctx.mergeStderr?'':named(await this.readText(stderrPath)),outStat=await stat(cli,stdoutPath);
      // exit(-1) in C gives status 255 on Linux (bcftools' error() does this)
      const raw=result.code==null?(result.error?1:0):result.code,code=((raw%256)+256)%256;
      const stdout=opts.binaryOut?'':tidy(await this.readText(stdoutPath),ctx.name||program);
      for(const path of created)MG.bus.emit('vfs:created',{path,program,sub:args[0]});
      // (how many changes were put back so far: the agent's run asks, see agentRun – the message may go to /dev/null)
      if(this.denied.length)this.deniedN=(this.deniedN||0)+this.denied.length;
      const undone=this.denied.map(abs=>`${program}: ${fs.pretty(abs)} is read-only (the example data): the change to it was undone\n`).join('')
        +this.refused.map(abs=>`${program}: ${fs.pretty(abs)} was not kept – nothing new can be written into the example data (/data/examples is read-only): write into your home folder instead\n`).join('');
      const gone=this.gone.map(abs=>`${fs.pretty(abs)}: the contents of this file were lost when the programs were stopped – make it again\n`).join('');this.gone=[];
      const failure=result.error?(/FS error/.test(result.error)?`${ctx.name||program}: stopped – it could not read or write a file. Check the file names in the command.`:result.error):'';
      // The two outputs in the order in which the program wrote to them (wc -l a nosuch b: the count of a, the
      // message, the count of b): the run reports that order, and where both go the same way – to the terminal, to
      // the file or the pipe of a block or a script – they are passed on in it (see runReal). parts: [1 or 2,
      // bytes] in turn; only when the list accounts for every byte of both files.
      let parts=null;const ord=result.order||[],tail=(failure?`\n${failure}\n`:'')+undone+gone;
      if(!ctx.mergeStderr&&!opts.binaryOut&&!devUsed.size&&ord.length>2){
        const ob=await this.readBytes(stdoutPath),eb=await this.readBytes(stderrPath);let no=0,ne=0;
        for(let k=0;k<ord.length;k+=2){if(ord[k]===1)no+=ord[k+1];else ne+=ord[k+1];}
        if(no===ob.length&&ne===eb.length){
          let oi=0,ei=0;parts=[];
          for(let k=0;k<ord.length;k+=2){
            const n=ord[k+1];
            if(ord[k]===1){parts.push([1,ob.subarray(oi,oi+n)]);oi+=n;}
            else{parts.push([2,eb.subarray(ei,ei+n)]);ei+=n;}
          }
        }
      }
      // how far the program read what was piped in (see "the reader left early" in runPipeline) – Infinity: it was
      // named as a file (cat - , sort /dev/stdin), and so read as one
      const stdinUsed=stdin&&!inherit?(devUsed.has(stdin)?Infinity:Math.max(result.stdinMax||0,result.stdinPos||0)):null;
      return {stdout,stderr:stderr+tail,parts,tail,stdoutPath,stdoutSize:outStat?.size||0,created,secs:(performance.now()-start)/1000,code:code||(undone?1:0),statusKnown:result.code!=null,stdinUsed};
    },
    /* A program of OWN_WORKER: the command runs in a worker of its own (threads-worker.mjs, or the program's own). It
       gets the files that its arguments name – of a folder, everything in it; not what it is told to write (-o) – with
       their index files (INDEX_SUFFIXES), at the paths they have in the programs' file system, the links of the home
       folder and /data, every folder (it may write into any of them), its working folder and its input. What it wrote
       is put into the programs' file system, and the run goes on as for any other program: importChanges finds the new
       files. A workflow (T.flow) runs its commands that way one after another, and hands back what they made. The
       answer has the form of execIO's. */
    threadedWorker:null,
    /** the files of the programs' file system that the arguments name (with their index files), read for a worker:
        [{path, data, readonly}]. cwd: the folder relative names are in (a path of the programs' file system). */
    async inputsOf(args,outs,{fs,before,cwd}){
      const cli=this.cli;
      const toProg=v=>{
        if(!v||v==='-')return null;
        if(v===ROOT||v.startsWith(ROOT+'/'))return MG.path.norm(v);
        // (an absolute path that is not one of the programs' file system – /dev/stdin – names no file there)
        if(v.startsWith('/'))return ROOT+MG.path.norm(v);
        return MG.path.norm(cwd+'/'+v);
      };
      const want=new Set();
      for(let i=0;i<args.length;i++){
        const v=args[i];
        if(i&&outs.includes(args[i-1]))continue;
        const m=/^(--?[^=]+)=(.*)$/.exec(v);
        if(m&&outs.includes(m[1]))continue;
        // (a list of files after an option: lofreq call -S a.vcf.gz,b.vcf.gz; Cutadapt's adapters from a file: -a file:adapters.fa)
        for(const w of (m?m[2]:v).split(',')){
          const p=toProg(w.replace(/^\^?file\$?:/,''));
          // (the files of pipes – /dev/stdin, <(COMMAND) – are not in the list of the programs' files: asked for one by one)
          const st=!p?null:p.startsWith(TMP+'/')?await stat(cli,p):before.get(p);
          if(!st)continue;
          if(!st.isDir){
            want.add(p);
            for(const x of [...INDEX_SUFFIXES.map(s=>p+s),...(/\.(bam|cram)$/.test(p)?[p.replace(/\.(bam|cram)$/,'.bai'),p.replace(/\.(bam|cram)$/,'.crai')]:[])]){const t=before.get(x);if(t&&!t.isDir)want.add(x);}
            continue;
          }
          for(const [q,t] of before)if(!t.isDir&&q.startsWith(p+'/'))want.add(q);
        }
      }
      const files=[];
      for(const p of want){
        const e=fs.entries.get(p.slice(ROOT.length));
        files.push({path:p,data:await cli.fs.readFile(p),readonly:!!(e&&(e.readonly||e.protected))});
      }
      return files;
    },
    /** one command in a worker of its own → {exitCode, error, stdout, stderr, order, dirs, files, removed, stdinPos}
        T: the program (OWN_WORKER, or {name, module, worker}); the rest as threads-worker.mjs takes it */
    async spawn(T,{args,thisProgram,cwd,dirs,files,links,stdin,roots}){
      // (stopped between two commands of a workflow: the next one does not start)
      if(this.ownRun&&this.ownRun.stopped)throw Object.assign(new Error('Killed'),{userMessage:`${this.running||'program'}: Killed`,code:137});
      const {moduleUrl,pyodideUrl}=this.workerUrls(T);
      // (a worker made ready after the last command of this program – see prewarm – or a new one)
      const worker=this.takeSpare(T)||new Worker(new URL(T.worker||'assets/js/threads-worker.mjs',location.href),{type:'module',name:thisProgram||T.name});
      this.threadedWorker=worker;
      try{
        return await new Promise((resolve,reject)=>{
          this._threadedStop=reject;
          worker.onmessage=e=>{const m=e.data||{};if(m.type==='ready'||m.type==='prepare-error')return;if(m.type==='result')resolve(m.result);else reject(new Error((m.error&&m.error.message)||'the program gave no answer'));};
          worker.onerror=e=>{if(e.preventDefault)e.preventDefault();reject(new Error(e.message||'the program could not be started'));};
          // (the files are copied, not moved: a workflow hands the same bytes to its next command)
          worker.postMessage({moduleUrl,pyodideUrl,args,thisProgram:thisProgram||T.name,cwd,dirs,files,links,stdin,roots});
        });
      }finally{this._threadedStop=null;if(this.threadedWorker===worker)this.threadedWorker=null;try{worker.terminate();}catch(e){}if(T.prewarm)this.prewarm(T);}
    },
    workerUrls(T){
      const base=new URL(String(MG.config.threadsBase||'assets/vendor/genomics-wasm').replace(/\/?$/,'/'),location.href);
      return {moduleUrl:new URL(T.module,base).href,pyodideUrl:T.pyodide?new URL(T.pyodide,base).href:undefined};
    },
    /* MACS3's Python takes many seconds to start with all its packages (NumPy, SciPy, scikit-learn, pandas …). After a
       command of it, a new worker starts its Python in the background (python-worker.mjs: the message 'prepare'), so
       that the next command finds it ready. Every command still has a worker and a Python of its own, as genomics-wasm
       runs MACS3. A worker that is not used within SPARE_MS is stopped: it holds a few hundred MB of memory. */
    spares:new Map(),
    prewarm(T){
      if(this.spares.has(T.module))return;
      let worker;
      try{worker=new Worker(new URL(T.worker||'assets/js/threads-worker.mjs',location.href),{type:'module',name:T.name});}catch(e){return;}
      const spare={worker,timer:null};
      const drop=()=>{if(this.spares.get(T.module)===spare)this.spares.delete(T.module);clearTimeout(spare.timer);try{worker.terminate();}catch(e){}};
      spare.timer=setTimeout(drop,SPARE_MS);
      // (a worker that could not get ready is not used: the next command starts afresh)
      worker.onmessage=e=>{if(e.data&&e.data.type==='prepare-error')drop();};
      worker.onerror=e=>{if(e.preventDefault)e.preventDefault();drop();};
      this.spares.set(T.module,spare);
      worker.postMessage(Object.assign({type:'prepare'},this.workerUrls(T)));
    },
    takeSpare(T){
      const spare=T.prewarm&&this.spares.get(T.module);
      if(!spare)return null;
      this.spares.delete(T.module);clearTimeout(spare.timer);
      return spare.worker;
    },
    async execWorker(program,args,{stdin,stdout,stderr,merge,fs,before,name,io,flowOpts,devUsed,piped}){
      const T=OWN_WORKER[program],cli=this.cli,home=fs.home,cwd=this.apath(fs.isDir(fs.cwd)?fs.cwd:fs.home);
      const links=[[ROOT+home,home],[ROOT+'/data','/data']];
      const dirs=[ROOT,TMP,...Array.from(before).filter(([p,t])=>t.isDir&&!p.startsWith(TMP)).map(([p])=>p),cwd];
      const input=stdin?await cli.fs.readFile(stdin):null;
      const flow=T.flow&&T.flow(args);
      let r;
      const run=this.ownRun={stopped:false};
      try{
      if(flow){
        // A workflow: its commands one after another, each in a worker of its own (see somatic.js). Its files have the
        // paths of the terminal (/home/user/…, /data/…, /tmp/…) – also in the workers, where they are folders of their
        // own: a program that writes a path into its output (Strelka's VCF header names the reference file) writes the
        // path the person knows. What the workflow made is put below ROOT here.
        const term=p=>p===ROOT?'/':p.startsWith(ROOT+'/')?p.slice(ROOT.length):p,tcwd=term(cwd);
        // (the arguments as they were typed: ROOT is in none of them – see pathToken in _run. /dev/stdin is given back its
        // name: the workflow has what came in as h.stdin – kraken2 … /dev/stdin)
        const ins=[...(devUsed||new Map())].filter(([,n])=>n==='/dev/stdin').map(([real])=>real);
        const typed=args.map(v=>{for(const real of ins)v=v.split(real).join('/dev/stdin');return v.split(ROOT+'/').join('/');});
        const h={cwd:tcwd,io,opts:flowOpts||{},name:name||T.name,stdin:input,stdinPipe:!!piped,
          abs:p=>MG.path.norm(p.startsWith('/')?p:tcwd+'/'+p),
          // (the folder of the files that stand for /dev/stdout and /dev/stderr is not in the snapshot – it is there)
          isDir:p=>{if(p===term(TMP))return true;const t=before.get(p==='/'?ROOT:ROOT+p);return !!(t&&t.isDir);},
          isFile:p=>{const t=before.get(ROOT+p);return !!(t&&!t.isDir);},
          readText:async p=>new TextDecoder('utf-8').decode(await cli.fs.readFile(ROOT+p)),
          pretty:p=>(fs.pretty?fs.pretty(p):p),
          stage:t=>{this.stage=t;},
          inputsOf:async(a,outs,at)=>(await this.inputsOf(a,outs||[],{fs,before,cwd:at?ROOT+at:cwd})).map(f=>({path:term(f.path),data:f.data,readonly:f.readonly})),
          spawn:(t,o)=>this.spawn(t,Object.assign({cwd:tcwd,dirs:[tcwd],links:[],stdin:null},o))};
        r=await flow(typed,h);
        r.files=(r.files||[]).map(f=>({path:ROOT+f.path,data:f.data}));
        // (what the workflow removes – kraken2-build --clean: in the programs' file system, and in the terminal's)
        r.removeTerm=r.remove||[];
        r.remove=r.removeTerm.map(p=>ROOT+p);
      }else{
        const files=await this.inputsOf(args,T.outputs(args),{fs,before,cwd});
        r=await this.spawn(T,{args,thisProgram:name||T.name,cwd,dirs,files,links,stdin:input,roots:[ROOT]});
        // (a file it was given that the program removed is removed here too – hmmpress on a pressed file removes three of
        // the four, as on Linux; not a file of the course data, nor a read-only one)
        const kept=p=>{const e=fs.get(p);return p==='/data'||p.startsWith('/data/')||!!(e&&(e.readonly||e.protected));};
        r.removeTerm=(r.removed||[]).filter(p=>p.startsWith(ROOT+'/')).map(p=>p.slice(ROOT.length)).filter(p=>!kept(p));
        r.remove=r.removeTerm.map(p=>ROOT+p);
      }
      }finally{if(this.ownRun===run)this.ownRun=null;this.stage=null;}
      if(run.stopped)throw Object.assign(new Error('Killed'),{userMessage:`${this.running||name||T.name}: Killed`,code:137});
      for(const d of r.dirs||[])if(!before.has(d))await mkdirp(cli,d);
      for(const p of r.remove||[]){const st=await stat(cli,p);if(st&&st.isDir)await rmtree(cli,p);else if(st)await cli.fs.unlink(p);}
      for(const p of r.removeTerm||[])fs.remove(p);
      // (-o /dev/stdout: the program wrote into the file that stands for its output – it joins what it printed)
      const join=(a,b)=>{const all=new Uint8Array(a.length+b.length);all.set(a);all.set(b,a.length);return all;};
      for(const f of r.files){
        if(f.path===stdout){r.stdout=join(r.stdout,f.data);if(r.order.length)r.order.push(1,f.data.length);continue;}
        if(f.path===stderr){r.stderr=join(r.stderr,f.data);if(r.order.length)r.order.push(2,f.data.length);continue;}
        await place(cli,f.path,f.data);
      }
      if(merge){
        // 2>&1: the two outputs in one file, in the order in which they were written
        const all=new Uint8Array(r.stdout.length+r.stderr.length);let o=0,i1=0,i2=0;
        // (a workflow that kept no order: what it printed, then its messages)
        const ord=r.order&&r.order.length?r.order:[1,r.stdout.length,2,r.stderr.length];
        for(let k=0;k<ord.length;k+=2){const n=ord[k+1];if(ord[k]===1){all.set(r.stdout.subarray(i1,i1+n),o);i1+=n;}else{all.set(r.stderr.subarray(i2,i2+n),o);i2+=n;}o+=n;}
        await cli.fs.writeFile(stdout,all);
      }else{await cli.fs.writeFile(stdout,r.stdout);await cli.fs.writeFile(stderr,r.stderr);}
      return {code:r.exitCode,error:r.error?`${name||T.name}: stopped – ${r.error}`:null,order:merge?[]:r.order||[],stdinPos:r.stdinPos||0,stdinMax:r.stdinPos||0};
    },
    /* A program that does not end blocks every later command. kill() stops the worker that runs the
       programs; the next command starts a new one. What programs had written lived in that worker's
       memory and is lost (returned as a list); the course data and text files are not.
       The programs of OWN_WORKER run in a worker of their own: stopping one loses nothing else (lastKill 'threads') – nor
       does stopping a workflow of them (lofreq somatic, runWorkflow.py) between two of its commands. */
    lastKill:'',
    ownRun:null,
    kill(fs){
      fs=real(fs);
      if(this.threadedWorker||this.ownRun){
        const program=this.running,err=Object.assign(new Error('Killed'),{userMessage:`${program||'program'}: Killed`,code:137});
        if(this.ownRun)this.ownRun.stopped=true;
        try{if(this.threadedWorker)this.threadedWorker.terminate();}catch(e){}
        this.threadedWorker=null;this.lastKill='threads';
        if(this._threadedStop)this._threadedStop(err);
        if(this._killed)this._killed(err);
        MG.bus.emit('wasm:killed',{program,lost:0});
        return [];
      }
      this.lastKill='runner';
      const w=window.Aioli&&window.Aioli.lastWorker;
      if(!this.cli||!w)return [];
      const program=this.running;
      try{w.terminate();}catch(e){}
      window.Aioli.lastWorker=null;
      this.ready=false;this.loading=null;this.cli=null;this.synced.clear();this.placed.clear();this.managed.clear();this.dirs.clear();this.gen++;
      const lost=[];this.lostTimes=new Map();this.lostEntries=new Map();
      for(const [abs,e] of Array.from(fs.entries))if(e.kind==='aioli'){this.lostTimes.set(abs,e.mtime||0);this.lostEntries.set(abs,e);fs.entries.delete(abs);fs._changed(abs,'remove');lost.push(abs);}
      if(this._killed)this._killed(Object.assign(new Error('Killed'),{userMessage:`${program||'program'}: Killed`,code:137}));
      MG.bus.emit('wasm:killed',{program,lost:lost.length});
      return lost;
    },
    async gunzipText(ctx,file){const r=await this.run({...ctx,stdin:null,inherit:null},'bgzip',['-dc',file]);if(r.code)throw MG.shellUtil.userErr(r.stderr||'Decompression failed');return r.stdout;},
    async cleanupPipes(fs,keep){
      fs=real(fs);
      if(!this.ready)return;
      const refs=new Set(keep?[keep]:[]);for(const e of fs.entries.values())if(e.apath)refs.add(e.apath);for(const p of this.held.keys())refs.add(p);
      for(const n of await readdir(this.cli,TMP)){const p=TMP+'/'+n;if(n!=='.'&&n!=='..'&&!refs.has(p))try{await this.cli.fs.unlink(p);}catch(e){}}
    }
  };
  async function stat(cli,p){try{const s=await cli.fs.lstat(p);return {size:s.size,mtime:+new Date(s.mtime),isDir:(s.mode&0o170000)===0o040000};}catch(e){return null;}}
  async function readdir(cli,p){try{return await cli.fs.readdir(p);}catch(e){return [];}}
  async function mkdirp(cli,p){let cur='';for(const part of p.split('/').filter(Boolean)){cur+='/'+part;const s=await stat(cli,cur);if(s&&!s.isDir)try{await cli.fs.unlink(cur);}catch(e){}if(!s||!s.isDir)try{await cli.mkdir(cur);}catch(e){}}}
  /* write a file at dest, whatever is in the way: a folder of that name, a file where a folder should be */
  async function place(cli,dest,data){
    const parts=dest.split('/').filter(Boolean);let cur='';
    for(let i=0;i<parts.length-1;i++){
      cur+='/'+parts[i];const s=await stat(cli,cur);
      if(s&&!s.isDir)await cli.fs.unlink(cur);
      if(!s||!s.isDir)await cli.mkdir(cur); // Aioli's mkdir: FS.mkdir returns a node, which cannot be sent to the page
    }
    const s=await stat(cli,dest);
    if(s&&s.isDir)await rmtree(cli,dest);else if(s)await cli.fs.chmod(dest,0o644);
    await cli.fs.writeFile(dest,data);
  }
  async function rmtree(cli,p){
    for(const n of await readdir(cli,p)){
      if(n==='.'||n==='..')continue;
      const q=p+'/'+n,s=await stat(cli,q);
      if(s&&s.isDir)await rmtree(cli,q);else if(s)await cli.fs.unlink(q);
    }
    await cli.fs.rmdir(p);
  }
  function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('Could not load '+src));document.head.appendChild(s);});}
  MG.wasm=W;
  /* date -u …: is the time asked for in UTC? (-u among the letters of an option – not in the value of -d or -I) */
  function dateUTC(args){
    for(let i=0;i<args.length;i++){
      const v=args[i];
      if(v==='--utc'||v==='--universal')return true;
      if(v==='--')break;
      if(!/^-[A-Za-z]/.test(v))continue;
      for(let j=1;j<v.length;j++){
        const c=v[j];
        if(c==='u')return true;
        if(c==='I')break;
        if('dfrs'.includes(c)){if(j===v.length-1)i++;break;}
      }
    }
    return false;
  }
  /* date -r FILE: the time of the last change of a file. The page knows it; the programs' copy of the file is newer. */
  function dateArgs(ctx){
    const a=ctx.args,out=[];
    for(let i=0;i<a.length;i++){
      const v=a[i],m=/^--reference=(.*)$/.exec(v),c=/^-([uR]*)r(.*)$/.exec(v);
      let f=null;
      if(m)f=m[1];
      else if(v==='--reference')f=a[++i];
      else if(c){if(c[1])out.push('-'+c[1]);f=c[2]!==''?c[2]:a[++i];}
      else{out.push(v);if(/^-[uR]*[dfs]$/.test(v)&&i+1<a.length)out.push(a[++i]);continue;}
      const e=f!=null?ctx.fs.get(f):null;
      if(!e)throw MG.shellUtil.userErr(`date: ${f==null?'option requires an argument -- \'r\'':f+': No such file or directory'}`);
      out.push('-d','@'+Math.floor((e.mtime||Date.now())/1000));
    }
    return out;
  }
  /* cat FILE >> FILE, cat A FILE > FILE: GNU cat does not read a file that it is itself writing to once something is
     in it ("input file is output file") – it names the file, leaves it out, and ends with status 1. (After > the file
     is empty at first: cat FILE > FILE reads nothing, and nothing is said.) */
  async function catRun(ctx){
    const out=ctx.redirectTarget?ctx.fs.resolve(ctx.redirectTarget):ctx.toCaller&&ctx.io.outFile?ctx.io.outFile.path:null;
    const e=out&&ctx.redirectTarget!=='/dev/null'?ctx.fs.get(out):null;
    if(!e||e.kind==='dir')return runReal(ctx,'cat');
    const fromIt=ctx.stdin instanceof FileRef&&ctx.stdin.fromFile&&ctx.stdin.apath===W.apath(out);
    const names=[];let opts=true;
    for(const a of ctx.args){if(opts&&a==='--')opts=false;else if(!(opts&&a.startsWith('-')&&a!=='-'))names.push(a);}
    if(!fromIt&&!names.some(a=>a!=='-'&&ctx.fs.resolve(a)===out))return runReal(ctx,'cat');
    // how much is in the output file when cat comes to each of its inputs: with >> what was there, with > what cat
    // itself has written by then
    const sizeOf=async a=>{
      if(a!=='-'){const f=ctx.fs.get(a);return f&&f.kind!=='dir'?ctx.fs.size(f):0;}
      const s=ctx.stdin;
      return s==null?(ctx.inherit?1:0):s instanceof FileRef?(await W.readBytes(s.apath)).length:String(s).length;
    };
    // (the file of a block – { echo start; cat FILE; } > FILE –: what the block has written into it so far counts)
    let written=ctx.redirectTarget?(ctx.redirectAppend?ctx.fs.size(e):0):ctx.fs.size(e);
    const args=[];let files=0,bad=0;opts=true;
    for(const a of ctx.args){
      if(opts&&a==='--'){opts=false;args.push(a);continue;}
      if(opts&&a.startsWith('-')&&a!=='-'){args.push(a);continue;}
      files++;
      const same=a==='-'?fromIt:ctx.fs.resolve(a)===out;
      if(same&&written>0){ctx.err(`cat: ${a}: input file is output file\n`);bad++;}
      else{args.push(a);if(!same)written+=await sizeOf(a);}
    }
    if(!files&&fromIt&&written>0){ctx.err('cat: -: input file is output file\n');return 1;}
    if(!bad)return runReal(ctx,'cat');
    if(bad===files)return 1;
    await withArgs(ctx,args,'cat');
    return 1;
  }
  /* tee /dev/stdout, tee /dev/stderr: one more copy of the input on the output (or among the messages). The page
     makes the copy: tee writes its input into a file of its own, too, and that file is printed once more. */
  async function teeRun(ctx){
    const isOut=a=>a==='/dev/stdout'||a==='/dev/fd/1',isErr=a=>a==='/dev/stderr'||a==='/dev/fd/2'||a==='/dev/tty';
    let opts=true,outs=0,errs=0;const args=[];
    for(const a of ctx.args){
      if(opts&&a==='--'){opts=false;args.push(a);}
      else if(opts&&a.startsWith('-')&&a!=='-')args.push(a);
      else if(isOut(a))outs++;
      else if(isErr(a))errs++;
      else args.push(a);
    }
    if(!outs&&!errs)return runReal(ctx,'tee');
    const copy=`${TMP}/t${++W.pipeN}`;
    const code=await withArgs(ctx,[...args,copy],'tee');
    let bytes;
    try{bytes=await W.readBytes(copy);}catch(e){return code;}
    try{await W.cli.fs.unlink(copy);}catch(e){}
    // (tee /dev/stdout > FILE: on Linux both copies are written to the same place in FILE – it holds the input once)
    if(!ctx.redirectTarget)for(let k=0;k<outs;k++)if(bytes.length)ctx.out(bytes);
    for(let k=0;k<errs;k++)if(bytes.length)ctx.err(MG.shellUtil.bytesText(bytes));
    return code;
  }
  function binaryOutput(program,a){
    if(program==='samtools')return ['sort','merge','markdup','fixmate','collate'].includes(a[0])&&!a.some(x=>x==='SAM'||x==='sam'||/^(-O|--output-fmt=)sam(,|$)/i.test(x))||a[0]==='view'&&a.some(x=>/^-[A-Za-z]*[bu]/.test(x))&&!a.some(x=>x==='-c'||x==='--count');
    if(program==='bcftools')return a.some((x,i)=>/^-[A-Za-z]*O[buz]/.test(x)||x==='-O'&&/^[buz]/.test(a[i+1]||'')||/^--output-type=[buz]/.test(x));
    // lofreq indelqual and viterbi write BAM to the standard output unless -o names a file; alnqual with -b or -u
    if(program==='lofreq'){
      if(a[0]==='alnqual')return a.slice(1).some(x=>/^-[A-Za-z]*[bu]/.test(x));
      if(a[0]!=='indelqual'&&a[0]!=='viterbi')return false;
      let o=null;
      for(let i=1;i<a.length;i++){if(a[i]==='-o'||a[i]==='--out')o=a[++i];else if(/^--out=/.test(a[i]))o=a[i].slice(6);else if(/^-o./.test(a[i]))o=a[i].slice(2);}
      return o==null||o==='-';
    }
    return program==='bgzip'&&!a.some(x=>/^-\w*d/.test(x)||x==='--decompress');
  }
  /* Messages of the programs: paths as the student sees them, and the program's name where the
     WebAssembly build has none ("(null): cannot open …"). */
  function tidy(text,name){
    text=text.replace(/\/shared\/vfs/g,'').replace(/^\(null\):/gm,name+':');
    // Salmon (Rust) adds the number of a system error to its message: "No such file or directory (os error 44)" – the
    // numbering of WebAssembly's C library (WASI). Linux's number is put in its place (ENOENT is 2 there).
    if(name==='salmon')text=text.replace(/\(os error (\d+)\)/g,(x,n)=>`(os error ${LINUX_ERRNO[n]||n})`);
    return text;
  }
  const LINUX_ERRNO={63:1,44:2,29:5,8:9,48:12,2:13,20:17,54:20,31:21,28:22,33:24,22:27,51:28,70:29,69:30,64:32,37:36,55:39};
  async function runReal(ctx,program,opts={}){
    // this build of jq does not know its own version number
    if(program==='jq'&&ctx.args.length===1&&(ctx.args[0]==='--version'||ctx.args[0]==='-V')){ctx.out('jq-'+W.versions.jq+'\n');return 0;}
    const binary=binaryOutput(program,ctx.args),r=await W.run(ctx,program,ctx.args,{...opts,binaryOut:binary});
    if(r.stdinUsed!=null)ctx.stdinUsed=r.stdinUsed;
    // Messages and output that go the same way – to the terminal, or to whoever takes the output of the block or
    // the script this command stands in – are passed on in the order in which the program wrote them. (To the
    // terminal as text; to a block's file or pipe the output goes as bytes, as it is.)
    const inTurn=!!r.parts&&!ctx.redirectTarget&&!!ctx.toCaller;
    // (> FILE 2>&1: the program's messages are in its output already; what the page adds – "… is read-only: the
    // change to it was undone" – follows them into the file)
    const tailBytes=ctx.mergeStderr&&ctx.redirectTarget&&r.tail?new TextEncoder().encode(tidy(r.tail,ctx.name||program).replace(/^\n/,'')):null;
    if(inTurn){
      const name=ctx.name||program,od=new TextDecoder('utf-8',{ignoreBOM:true}),ed=new TextDecoder('utf-8',{ignoreBOM:true});
      for(const [fd,bytes] of r.parts){
        if(!bytes.length)continue;
        if(fd===2)ctx.err(tidy(ed.decode(bytes,{stream:true}),name));
        else if(ctx.isPipedOut)ctx.out(bytes);
        else ctx.out(tidy(od.decode(bytes,{stream:true}),name));
      }
      if(r.tail)ctx.err(tidy(r.tail,name));
    }else if(r.stderr&&!tailBytes)ctx.err(tidy(r.stderr,ctx.name||program));
    if(inTurn){/* (passed on above) */}
    else if(ctx.redirectTarget){
      if(ctx.redirectTarget!=='/dev/null'){
        const target=ctx.fs.resolve(ctx.redirectTarget);let bytes=await W.readBytes(r.stdoutPath);
        if(tailBytes){const all=new Uint8Array(bytes.length+tailBytes.length);all.set(bytes);all.set(tailBytes,bytes.length);bytes=all;}
        // (The program printed nothing: the file stays as it was opened – made, or emptied, before the program ran –
        // or as the program itself wrote it by name:  samtools sort x.bam -o s.bam > s.bam 2>&1,  sort -o F a > F.)
        const nothing=!bytes.length&&ctx.fs.exists(target)&&!ctx.fs.isDir(target);
        if(!nothing){
        if(ctx.redirectAppend&&ctx.fs.exists(target)){const old=await ctx.fs.readBytes(target),joined=new Uint8Array(old.length+bytes.length);joined.set(old);joined.set(bytes,old.length);bytes=joined;}
        const dest=W.apath(target);await mkdirp(W.cli,MG.path.dirname(dest));await W.cli.fs.writeFile(dest,bytes);
        await W.adopt(ctx.fs,target,dest,bytes.length,bytes);
        }
        r.created.push(target);MG.bus.emit('vfs:created',{path:target,program,sub:ctx.args[0]});
      }
      ctx.wroteRedirect=true;
    }else if(ctx.isPipedOut)ctx.out(new FileRef(r.stdoutPath,binary));
    else if(binary&&r.stdoutSize){
      // (what the options promise is not always what was written: samtools view -b -c prints a count, and so text)
      let text=null;
      if(r.stdoutSize<=4194304)try{const t=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await W.readBytes(r.stdoutPath));if(t.indexOf('\u0000')<0)text=t;}catch(e){}
      if(text!=null)ctx.out(tidy(text,ctx.name||program));
      else ctx.io.note(`Binary output: ${MG.humanSize(r.stdoutSize)} bytes. Save with > FILE, or inspect using samtools/bcftools view.`);
    }
    // (… and the other way round: BAM where the options did not say so – samtools view --bam, -1 – is not text for the screen)
    else if(r.stdout&&r.stdout.slice(0,4096).indexOf('\u0000')>=0&&/^(samtools|bcftools|bgzip)$/.test(program))ctx.io.note(`Binary output: ${MG.humanSize(r.stdoutSize)} bytes. Save with > FILE, or inspect using samtools/bcftools view.`);
    else if(r.stdout)ctx.out(r.stdout);
    MG.bus.emit('tool:run',{program,sub:ctx.args[0]||'',args:ctx.args,code:r.code,secs:r.secs,created:r.created,real:true,line:ctx.rawLine,statusKnown:r.statusKnown});
    return r.code;
  }
  MG.runReal=runReal;
  /* A browser tab runs these programs on one thread. Asked for more, these builds stop (minimap2, BWA, HISAT2) or
     abort (samtools, bcftools), so the option is left out – and the terminal says so.
     short/long: the options that ask for threads; one: the values that ask for no more than there is (the option then
     stays as it was written); when: only for these subcommands (bwa index has no -t); why: the reason the note gives;
     cap: instead of leaving the option out, ask for this many (featureCounts counts on up to four threads here). */
  const THREADS={
    samtools:{short:'-@',long:'--threads',one:v=>v==='0'},
    bcftools:{long:'--threads',one:v=>v==='0'},
    minimap2:{short:'-t',one:v=>v==='1'},
    bgzip:{short:'-@',long:'--threads',one:v=>v==='0'||v==='1'},
    bwa:{short:'-t',one:v=>v==='1',when:a=>/^(mem|aln|bwasw)$/.test(a[0]||'')},
    'bwa-mem2':{short:'-t',one:v=>v==='1',when:a=>a[0]==='mem'},
    hisat2:{short:'-p',long:'--threads',one:v=>v==='1'},
    'hisat2-build':{short:'-p',long:'--threads',one:v=>v==='1'},
    stringtie:{short:'-p',one:v=>v==='1'},
    kallisto:{short:'-t',long:'--threads',one:v=>v==='1',when:a=>/^(index|quant)$/.test(a[0]||'')},
    // (mosdepth's -t: threads that unpack the BAM file besides the main one – 0, its default, is the only value here)
    mosdepth:{short:'-t',long:'--threads',one:v=>v==='0'},
    featureCounts:{short:'-T',one:v=>/^[1-4]$/.test(v),cap:'4',why:'in the browser featureCounts counts on four threads at most'},
    salmon:{short:'-p',long:'--threads',one:v=>v==='1',when:a=>/^(index|quant)$/.test(a[0]||''),why:'in the browser Salmon runs one worker thread'},
    cutadapt:{short:'-j',long:'--cores',one:v=>v==='1',why:'in the browser Cutadapt runs on one core'},
    lofreq:{long:'--threads',one:v=>v==='1',when:a=>a[0]==='somatic',why:'in the browser lofreq somatic runs its steps one after another'},
    // (bustools sort -t: threads; bustools count -t is a file of transcript names)
    bustools:{short:'-t',long:'--threads',one:v=>v==='1',when:a=>a[0]==='sort',why:'in the browser bustools sorts on one thread'},
    // (HMMER without threads has no --cpu at all: the option goes, whatever its value)
    ...Object.fromEntries(HMMER.map(p=>[p,{long:'--cpu',one:()=>false,why:'in the browser HMMER runs on one thread'}]))
  };
  function oneThread(name,args,io){
    const t=THREADS[name];
    if(!t||(t.when&&!t.when(args)))return args;
    const glued=a=>t.short&&a.length>t.short.length&&a.startsWith(t.short)&&/^\d+$/.test(a.slice(t.short.length))?a.slice(t.short.length):t.long&&a.startsWith(t.long+'=')&&/^\d+$/.test(a.slice(t.long.length+1))?a.slice(t.long.length+1):null;
    const out=[];let dropped='';
    for(let i=0;i<args.length;i++){
      const a=args[i];
      if(a==='--'){out.push(...args.slice(i));break;}
      const sep=a===t.short||a===t.long,g=sep?null:glued(a);
      if(sep){if(t.one(args[i+1])){out.push(a,args[++i]);}else{dropped=a+' '+(args[i+1]||'');if(t.cap&&/^\d+$/.test(args[i+1]||''))out.push(a,t.cap);i++;}continue;}
      if(g!=null){if(t.one(g))out.push(a);else{dropped=a;if(t.cap)out.push(t.short,t.cap);}continue;}
      out.push(a);
    }
    if(dropped&&io&&io.note)io.note(t.cap?`${name}: ${dropped.trim()} is ${t.short} ${t.cap} here – ${t.why}.`:`${name}: ${dropped.trim()} left out – ${t.why||'in the browser every program runs on one thread'}.`);
    return out;
  }
  /* Run with other arguments on the same context object: the shell reads what a program did
     (a redirect already written, for one) from that object afterwards. */
  async function withArgs(ctx,args,program){
    const given=ctx.args;ctx.args=args;
    try{return await runReal(ctx,program);}finally{ctx.args=given;}
  }
  const T=MG.shellTools=MG.shellTools||{};
  // [program, version, summary, example] – the name typed in the terminal can differ from the program file
  const definitions={
    fastp:['fastp','0.20.1','Quality control, adapter and quality trimming of FASTQ files; writes an HTML and a JSON report','fastp -i /data/examples/reads/NA12878_R1.fastq -I /data/examples/reads/NA12878_R2.fastq -o trimmed_R1.fastq -O trimmed_R2.fastq -h fastp.html -j fastp.json\nopen fastp.html'],
    minimap2:['minimap2','2.22','Minimizer-based alignment; use -ax sr for short paired reads','minimap2 -ax sr /data/examples/reads/reference.fa /data/examples/reads/NA12878_R1.fastq /data/examples/reads/NA12878_R2.fastq > mapped.sam'],
    bowtie2:['bowtie2-align-s','2.4.2','Bowtie 2 short-read aligner (needs an index from bowtie2-build)','bowtie2-build /data/examples/reads/reference.fa reference\nbowtie2 -x reference -1 /data/examples/reads/NA12878_R1.fastq -2 /data/examples/reads/NA12878_R2.fastq -S mapped.sam'],
    'bowtie2-align-s':['bowtie2-align-s','2.4.2','Bowtie 2 aligner (the program behind the bowtie2 command)','bowtie2-align-s -x reference -1 /data/examples/reads/NA12878_R1.fastq -2 /data/examples/reads/NA12878_R2.fastq -S mapped.sam'],
    'bowtie2-build':['bowtie2-build-s','2.4.2','Builds a Bowtie 2 index from a FASTA file (six .bt2 files)','bowtie2-build /data/examples/reads/reference.fa reference'],
    'bowtie2-build-s':['bowtie2-build-s','2.4.2','Builds a Bowtie 2 index (the program behind bowtie2-build)','bowtie2-build-s /data/examples/reads/reference.fa reference'],
    samtools:['samtools','1.17','Inspect, sort, index and transform SAM/BAM/CRAM','samtools sort -o mapped.bam mapped.sam\nsamtools index mapped.bam\nsamtools flagstat mapped.bam'],
    bcftools:['bcftools','1.10','Genotype likelihoods, calling models, normalisation and VCF operations','bcftools mpileup -f /data/examples/reads/reference.fa mapped.bam | bcftools call -mv -Oz -o calls.vcf.gz\nbcftools view -H calls.vcf.gz | head\nUse bcftools COMMAND --help for the options of a command.'],
    bgzip:['bgzip','1.17','Block gzip compression / decompression (BGZF files are valid gzip files)','bgzip -c INPUT > OUTPUT.gz'],
    tabix:['tabix','1.17','Index and query sorted tabular BGZF data','tabix -p vcf calls.vcf.gz'],
    seqtk:['seqtk','1.4','Toolkit for FASTA/FASTQ files: subsample, convert, trim, statistics','seqtk fqchk /data/examples/reads/NA12878_R1.fastq | head\nseqtk sample -s 11 /data/examples/reads/NA12878_R1.fastq 1000 > sample.fastq'],
    bedtools:['bedtools','2.31.0','Genome arithmetic on BED, VCF, SAM/BAM files','bedtools genomecov -ibam mapped.bam -bg | head'],
    jq:['jq','1.7','Command-line JSON processor','jq .summary fastp.json'],
    kalign:['kalign','3.3.1','Multiple sequence alignment of DNA, RNA or protein sequences (fast and accurate)','kalign -i /data/examples/sequences/myoglobins.fasta -o myoglobins.afa\nkalign -i seqs.fasta -f clu -o aligned.aln      (Clustal format; also msf)\n\nAlways give the output file with -o: this version of kalign prints its banner on the standard output\ntoo, so  kalign -i seqs.fasta > aligned.afa  would put the banner into the file.\n(The warning about AVX2 means only that this build does not use the processor\'s vector instructions.)'],
    muscle:['muscle','3.8.1551','Multiple sequence alignment (MUSCLE version 3)','muscle -in /data/examples/sequences/myoglobins.fasta -out myoglobins.afa\nmuscle -in seqs.fasta -clw -out aligned.aln      (Clustal format)\nmuscle -in seqs.fasta -maxiters 2 -out quick.afa  (faster, for many sequences)'],
    fasttree:['fasttree','2.1.11','Approximately-maximum-likelihood phylogenetic trees from a multiple alignment','fasttree myoglobins.afa > myoglobins.nwk          (protein: JTT+CAT)\nfasttree -nt -gtr dna_aligned.fasta > tree.nwk   (DNA: GTR+CAT)\nopen myoglobins.nwk                              (draws the tree)'],
    FastTree:['fasttree','2.1.11','FastTree (the same program as fasttree)','FastTree aligned.fasta > tree.nwk'],
    needleman_wunsch:['needleman_wunsch','2017.10.18','Global pairwise alignment (Needleman–Wunsch), from seq-align','needleman_wunsch GATTACA GCATGCT\nneedleman_wunsch --match 1 --mismatch -1 --gapopen 0 --gapextend -1 GATTACA GCATGCT\nneedleman_wunsch --printscores --file two_sequences.fasta\nneedleman_wunsch --help'],
    smith_waterman:['smith_waterman','2017.10.18','Local pairwise alignment (Smith–Waterman), from seq-align','smith_waterman ACACACTA AGCACACA\nsmith_waterman --printscores --file two_sequences.fasta\nsmith_waterman --help'],
    lcs:['lcs','2017.10.18','Repeated substrings of a sequence, longest first (from seq-align)','lcs GATTACAGATTACA\n(each line: a substring that occurs twice, and the two positions where it starts, counted from 0)'],
    wgsim:['wgsim','0.3.1-r13','Simulates paired-end reads from a reference, with sequencing errors and mutations','wgsim -N 1000 -1 100 -2 100 -S 11 /data/examples/reads/reference.fa sim_R1.fastq sim_R2.fastq\n(-e error rate, -r mutation rate, -d/-s fragment length and its spread, -S seed: the same seed gives the same reads)'],
    gffread:['gffread','0.12.7','GFF/GTF files: check, convert, and write transcript, CDS or protein sequences','gffread /data/examples/annotation/cyp2c_slices.gff3 -T -o cyp2c.gtf          (GFF3 to GTF)\ngffread /data/examples/annotation/cyp2c_slices.gff3 -g /data/examples/reads/reference.fa -w transcripts.fa -y proteins.fa'],
    lastz:['lastz','1.04.52','Pairwise alignment of long DNA sequences (regions, chromosomes, small genomes)',"lastz '/data/examples/reads/reference.fa[multiple]' query.fa --format=general > hits.tsv\nlastz target.fa query.fa --format=maf > aln.maf\n([multiple]: the target file holds more than one sequence)"],
    bwa:['bwa','0.7.19','BWA: indexes a reference and maps short reads to it (bwa index, bwa mem)',"cp /data/examples/reads/reference.fa .        (bwa index writes five files next to the FASTA file)\nbwa index reference.fa\nbwa mem reference.fa /data/examples/reads/NA12878_R1.fastq /data/examples/reads/NA12878_R2.fastq > bwa.sam\nbwa mem -R '@RG\\tID:NA12878\\tSM:NA12878' reference.fa R1.fastq R2.fastq > bwa.sam    (with a read group)\n\nbwa mem reads .fastq.gz files too. bwa mem -t N: one thread in the browser."],
    hisat2:['hisat2','2.2.2','HISAT2: maps RNA-seq reads, across splice junctions (needs an index from hisat2-build)',"hisat2-build /data/examples/rnaseq/yeast_chrI.fa yeast_chrI\nhisat2 -x yeast_chrI -1 /data/examples/rnaseq/SRR6357070_1.fastq -2 /data/examples/rnaseq/SRR6357070_2.fastq -S rnaseq.sam\nhisat2 -x yeast_chrI -U reads.fastq -S out.sam --no-unal                (single reads; leave out the reads that do not map)\nhisat2 ... --known-splicesite-infile /data/examples/rnaseq/yeast_chrI.splice_sites.tsv    (known junctions)\n\n.gz files are unpacked first, as hisat2's wrapper script does. hisat2 -p N: one thread in the browser."],
    'hisat2-build':['hisat2','2.2.2','Builds a HISAT2 index from a FASTA file (eight .ht2 files)','hisat2-build /data/examples/rnaseq/yeast_chrI.fa yeast_chrI\n(writes yeast_chrI.1.ht2 … yeast_chrI.8.ht2; hisat2 -x yeast_chrI uses them)'],
    'hisat2-inspect':['hisat2','2.2.2','Shows what is in a HISAT2 index','hisat2-inspect -s yeast_chrI       (a summary: the sequences and their lengths)\nhisat2-inspect -n yeast_chrI       (the names of the sequences)'],
    'bwa-mem2':['bwa-mem2','2.2.1','BWA-MEM2: bwa mem\'s algorithm, rewritten for speed – indexes a reference and maps short reads (bwa-mem2 index, bwa-mem2 mem)',"cp /data/examples/reads/reference.fa .        (bwa-mem2 index writes five files next to the FASTA file)\nbwa-mem2 index reference.fa\nbwa-mem2 mem reference.fa /data/examples/reads/NA12878_R1.fastq /data/examples/reads/NA12878_R2.fastq > bwamem2.sam\nbwa-mem2 mem -R '@RG\\tID:NA12878\\tSM:NA12878' reference.fa R1.fastq R2.fastq > bwamem2.sam    (with a read group)\n\nbwa-mem2 needs an index of its own (.0123, .amb, .ann, .bwt.2bit.64, .pac): one made by bwa index does not do.\nIt takes a few hundred MB of memory even for a small reference, and in the browser it is not faster than bwa.\nbwa-mem2 mem -t N: one thread in the browser."],
    stringtie:['stringtie','3.0.3','StringTie: assembles transcripts from RNA-seq alignments and estimates their abundance (BAM sorted by position)',"stringtie rnaseq.bam -G /data/examples/rnaseq/yeast_chrI.gtf -o transcripts.gtf -A gene_abundance.tsv\nstringtie -e -B rnaseq.bam -G /data/examples/rnaseq/yeast_chrI.gtf -o ballgown/rnaseq/rnaseq.gtf   (-e: the annotated transcripts only; -B: the tables of Ballgown)\nstringtie --merge -G /data/examples/rnaseq/yeast_chrI.gtf -o merged.gtf sample1.gtf sample2.gtf\n\nMap the reads with hisat2 --dta (alignments made for transcript assembly) and sort them (samtools sort).\nstringtie -p N: one thread in the browser."],
    kallisto:['kallisto','0.52.0','kallisto: transcript abundances from RNA-seq reads by pseudoalignment – no alignments, no BAM file',"gffread -w transcripts.fa -g /data/examples/rnaseq/yeast_chrI.fa /data/examples/rnaseq/yeast_chrI.gtf   (the transcript sequences)\nkallisto index -i transcripts.idx transcripts.fa\nkallisto quant -i transcripts.idx -o kallisto_out /data/examples/rnaseq/SRR6357070_1.fastq /data/examples/rnaseq/SRR6357070_2.fastq\nhead kallisto_out/abundance.tsv      (est_counts and tpm of every transcript)\nkallisto quant -i transcripts.idx -o single --single -l 200 -s 20 reads.fastq    (single reads: give the fragment length and its spread)\n\nThe results are abundance.tsv and run_info.json: this build writes no .h5 file and no BAM file (bootstraps: -b N --plaintext).\nkallisto -t N: one thread in the browser."],
    mosdepth:['mosdepth','0.3.14','mosdepth: read depth (coverage) of a BAM file – per base, in windows or in regions, with a summary',"samtools index rnaseq.bam                    (mosdepth needs the index of the BAM file, .bai)\nmosdepth yeast rnaseq.bam                    (yeast.mosdepth.summary.txt, yeast.mosdepth.global.dist.txt, yeast.per-base.bed.gz)\ncat yeast.mosdepth.summary.txt               (the length, the bases and the mean depth of each sequence)\nmosdepth -n --by 1000 windows rnaseq.bam     (the mean depth in windows of 1000 bp; -n: no per-base file)\nmosdepth --by /data/examples/annotation/cyp2c_exons.bed --thresholds 1,10,20 exons mapped.bam   (the regions of a BED file)\nzcat yeast.per-base.bed.gz | head\n\nmosdepth keeps an array as long as the longest sequence of the BAM file: fine for yeast chromosomes and the example\nslices, too big for a whole human chromosome in a browser. mosdepth -t N: not in the browser."],
    featureCounts:['featurecounts','2.1.1','featureCounts (Subread): counts the reads in each gene of an annotation – the count table for DESeq2 or edgeR',"featureCounts -p --countReadPairs -a /data/examples/rnaseq/yeast_chrI.gtf -o counts.txt rnaseq.bam   (paired reads: a count per fragment)\ntail -n +3 counts.txt | sort -k7,7nr | head        (the genes with the most reads)\ncat counts.txt.summary      (why reads were not counted: Unassigned_NoFeatures, _Ambiguity, _MultiMapping …)\nfeatureCounts -a genes.gtf -o counts.txt single.bam                       (single reads)\nfeatureCounts -s 2 -p --countReadPairs -a genes.gtf -o counts.txt s1.bam s2.bam s3.bam   (a reverse-stranded library; a column per file)\n\nPaired reads need -p: without it featureCounts 2.1 stops (\"Paired-end reads were detected in single-end read library\").\nfeatureCounts counts on several threads (-T 1 to 4; one unless asked for more). That needs a page that is\ncross-origin isolated, which the workbench makes its page as it starts – see Limits in the help."],
    salmon:['salmon','2.8.0','Salmon: transcript abundances from RNA-seq reads, by selective alignment to the transcript sequences',"gffread -w transcripts.fa -g /data/examples/rnaseq/yeast_chrI.fa /data/examples/rnaseq/yeast_chrI.gtf   (the transcript sequences)\nsalmon index -t transcripts.fa -i salmon_index\nsalmon quant -i salmon_index -l A -1 /data/examples/rnaseq/SRR6357070_1.fastq -2 /data/examples/rnaseq/SRR6357070_2.fastq -o salmon_out\nhead salmon_out/quant.sf        (NumReads and TPM of every transcript)\nsalmon quant -i salmon_index -l U -r reads.fastq --fldMean 200 --fldSD 20 -o single    (single reads)\n\n-l A: Salmon works out the library type (salmon_out/lib_format_counts.json says which).\nAn index made by Salmon on a 64-bit computer cannot be read here, nor one made here there: make it where you use it.\nsalmon -p N: one worker thread in the browser. Like featureCounts, Salmon needs a cross-origin isolated page."],
    cutadapt:['cutadapt','5.2','Cutadapt: removes adapters, primers and poly-A tails from reads, trims low-quality ends and filters reads by length',"cutadapt -a AGATCGGAAGAGCACACGTCTGAACTCCAGTCA -A AGATCGGAAGAGCGTCGTGTAGGGAAAGAGTGT -o trimmed_1.fastq -p trimmed_2.fastq /data/examples/trimming/SRR6357070_adapters_1.fastq /data/examples/trimming/SRR6357070_adapters_2.fastq\ncutadapt -q 20 -m 50 -a AGATCGGAAGAGC -o trimmed.fastq reads.fastq      (also trim 3' ends below quality 20; keep reads of 50 bases or more)\ncutadapt -g ^ACGTACGT -o out.fastq.gz reads.fastq.gz                    (a 5' adapter anchored at the start; .gz in and out)\ncutadapt --discard-untrimmed -a ADAPTER -o with_adapter.fastq reads.fastq   (keep only the reads that had the adapter)\ncutadapt ... --json report.json                                         (the report as JSON too, for MultiQC)\n\n-a/-A: the 3' adapter of read 1/read 2 (-g/-G: 5'); -e: error rate (0.1); -O: shortest overlap that counts (3).\nThe report (on the screen, or > report.txt) says how many reads had the adapter and how many bases were removed.\nCutadapt runs on one core here (-j N is left out, with a note). It is a Python program: each command starts the Python\nthat comes with it, which takes a few seconds."],
    lofreq:['lofreq','2.1.5','LoFreq: calls variants, also those at low frequencies (lofreq call), and somatic variants from a tumour and its normal (lofreq somatic)',"lofreq call -f /data/examples/somatic/reference.fa -o tumor_calls.vcf /data/examples/somatic/tumor.bam     (SNVs, at any allele frequency)\n\nSomatic variants – first give the reads indel qualities (needed for --call-indels), then index:\nlofreq indelqual --dindel -f /data/examples/somatic/reference.fa -o tumor.iq.bam /data/examples/somatic/tumor.bam\nlofreq indelqual --dindel -f /data/examples/somatic/reference.fa -o normal.iq.bam /data/examples/somatic/normal.bam\nsamtools index tumor.iq.bam && samtools index normal.iq.bam\nlofreq somatic -n normal.iq.bam -t tumor.iq.bam -f /data/examples/somatic/reference.fa --call-indels -o lofreq_\nzcat lofreq_somatic_final.snvs.vcf.gz | grep -v '^##'       (the somatic SNVs; lofreq_somatic_final.indels.vcf.gz: the indels)\n\nlofreq somatic runs lofreq call, filter, vcfset and uniq one after another, as upstream's script does; its options\nare upstream's (lofreq somatic -h), with --threads 1. LoFreq's authors call this workflow experimental.\nNot here: lofreq call-parallel and lofreq vcfplot (Python scripts that start other programs)."],
    'bam-somaticsniper':['somaticsniper','1.0.5.0','SomaticSniper: somatic SNVs from a tumour BAM and its matched normal BAM',"bam-somaticsniper -F vcf -f /data/examples/somatic/reference.fa /data/examples/somatic/tumor.bam /data/examples/somatic/normal.bam somaticsniper.vcf\ngrep -v '^##' somaticsniper.vcf | head      (the columns NORMAL and TUMOR; SS=2 in FORMAT: somatic)\nbam-somaticsniper -F vcf -Q 40 -L -G -f ref.fa tumor.bam normal.bam strict.vcf    (somatic score 40 or more; no LOH, no gain of reference)\n\nThe tumour BAM comes first, then the normal BAM, then the output file. Both BAM files must be sorted by position and\nmust name the same chromosomes, in the same order; the reference needs its .fai index (samtools faidx).\n-F vcf|classic|bed: output format (classic by default); -q: minimum mapping quality; -Q: minimum somatic score (15);\n-n/-t: the sample names in the VCF. -t is the name of the tumour sample, not a number of threads."],
    somaticsniper:['somaticsniper','1.0.5.0','SomaticSniper (the program behind bam-somaticsniper)',"somaticsniper -F vcf -f ref.fa tumor.bam normal.bam calls.vcf     (the same as bam-somaticsniper)"],
    prodigal:['prodigal','2.6.3',"Prodigal: finds the protein-coding genes of bacteria and archaea in a genome (GFF, GenBank, proteins)","prodigal -i /data/examples/bacteria/ecoli.fna -o ecoli.gff -f gff -a ecoli.faa -d ecoli.ffn\nhead -4 ecoli.gff        (each gene: where it starts and ends, its strand and Prodigal's scores)\ngrep -c '>' ecoli.faa    (the proteins, one per gene)\nprodigal -p meta -i /data/examples/bacteria/combined.fna -o meta.gff -f gff     (contigs of several genomes)\n\n-p single (the default): Prodigal learns the genome's own model first – it needs 20,000 bases at least, and 100,000\nare better; -p meta: preset models, for metagenomes and short sequences. -f gbk|gff|sco (gbk by default); -o FILE (else\nthe standard output); -a FILE: the proteins; -d FILE: the genes' DNA; -s FILE: every possible start, with its scores;\n-c: no genes running off the ends of a sequence; -g 4: another genetic code (11, bacteria and archaea, by default);\n-t FILE: save the training (or use it, when FILE is there); -q: no messages. Prodigal reads plain FASTA, GenBank or\nEMBL – not .gz files."],
    hmmbuild:['hmmbuild','3.4',"HMMER: builds a profile HMM from a multiple sequence alignment","hmmbuild globins4.hmm /data/examples/hmmer/globins4.sto      (a profile of the four globins of the alignment)\nhmmbuild -n kinase kinase.hmm /data/examples/hmmer/Pkinase.sto\n\nThe alignment: Stockholm (.sto), aligned FASTA or Clustal; the profile is written to the first file. --amino, --dna,\n--rna: the alphabet, when HMMER cannot tell; -n NAME: the profile's name; --seed N: the seed of the calibration (42).\n\nOne thread here: --cpu is left out, with a note. Files compressed with gzip (.gz) cannot be read here – HMMER would\nstart gzip for them: unpack them first (gunzip -k FILE.gz). -h lists every option; the HMMER User's Guide explains them."],
    hmmsearch:['hmmsearch','3.4',"HMMER: searches a sequence database with a profile HMM","hmmsearch globins4.hmm /data/examples/hmmer/globins45.fa > globins.out\nhmmsearch --tblout hits.tbl --domtblout domains.tbl -E 1e-5 globins4.hmm proteins.faa\n\nThe output ranks the sequences by E-value, then shows each one's domains and alignments; --tblout and --domtblout write\nthe hits as tables (one line per sequence, one per domain). -E, -T: the thresholds of what is reported; --cut_ga: the\nprofile's own (Pfam's gathering) thresholds; --noali: no alignments.\n\nOne thread here: --cpu is left out, with a note. Files compressed with gzip (.gz) cannot be read here – HMMER would\nstart gzip for them: unpack them first (gunzip -k FILE.gz). -h lists every option; the HMMER User's Guide explains them."],
    hmmscan:['hmmscan','3.4',"HMMER: searches a database of profile HMMs with sequences (which domains does a protein have?)","cat /data/examples/hmmer/globins4.hmm /data/examples/hmmer/fn3.hmm /data/examples/hmmer/Pkinase.hmm > minifam.hmm\nhmmpress minifam.hmm            (hmmscan needs the four files of hmmpress next to the profiles)\nhmmscan minifam.hmm /data/examples/hmmer/7LESS_DROME\nhmmscan --domtblout domains.tbl minifam.hmm proteins.faa\n\nFor a few sequences against many profiles (Pfam): hmmscan; for profiles against many sequences: hmmsearch.\n\nOne thread here: --cpu is left out, with a note. Files compressed with gzip (.gz) cannot be read here – HMMER would\nstart gzip for them: unpack them first (gunzip -k FILE.gz). -h lists every option; the HMMER User's Guide explains them."],
    hmmpress:['hmmpress','3.4',"HMMER: prepares a file of profile HMMs for hmmscan (writes .h3m, .h3i, .h3f and .h3p)","cat /data/examples/hmmer/globins4.hmm /data/examples/hmmer/fn3.hmm /data/examples/hmmer/Pkinase.hmm > minifam.hmm\nhmmpress minifam.hmm\n\nThe four files are written next to the profiles (not in /data: copy the profiles first). -f writes them again.\n\nOne thread here: --cpu is left out, with a note. Files compressed with gzip (.gz) cannot be read here – HMMER would\nstart gzip for them: unpack them first (gunzip -k FILE.gz). -h lists every option; the HMMER User's Guide explains them."],
    hmmfetch:['hmmfetch','3.4',"HMMER: takes one profile (or several) out of a file of profiles","hmmfetch minifam.hmm fn3 > fn3.hmm\nhmmfetch --index minifam.hmm         (an SSI index, minifam.hmm.ssi: quicker for large files)\nhmmfetch -f minifam.hmm names.txt > some.hmm   (the profiles named in a file)\n\nOne thread here: --cpu is left out, with a note. Files compressed with gzip (.gz) cannot be read here – HMMER would\nstart gzip for them: unpack them first (gunzip -k FILE.gz). -h lists every option; the HMMER User's Guide explains them."],
    hmmalign:['hmmalign','3.4',"HMMER: aligns sequences to a profile HMM","hmmalign globins4.hmm /data/examples/hmmer/globins45.fa > globins45.sto\nhmmalign --outformat afa -o globins45.afa globins4.hmm /data/examples/hmmer/globins45.fa      (aligned FASTA)\n\nThe alignment is Stockholm by default: columns of the profile in upper case, insertions in lower case; the #=GR … PP\nlines are the confidence of each residue (0-9, * for the most).\n\nOne thread here: --cpu is left out, with a note. Files compressed with gzip (.gz) cannot be read here – HMMER would\nstart gzip for them: unpack them first (gunzip -k FILE.gz). -h lists every option; the HMMER User's Guide explains them."],
    hmmconvert:['hmmconvert','3.4',"HMMER: converts profile HMMs between file formats","hmmconvert globins4.hmm > globins4.v3.hmm       (HMMER3's own format, written again)\nhmmconvert -2 globins4.hmm > globins4.hmm2      (HMMER2 format)\nhmmconvert -b globins4.hmm > globins4.bin       (binary)\n\nOne thread here: --cpu is left out, with a note. Files compressed with gzip (.gz) cannot be read here – HMMER would\nstart gzip for them: unpack them first (gunzip -k FILE.gz). -h lists every option; the HMMER User's Guide explains them."],
    hmmemit:['hmmemit','3.4',"HMMER: writes sequences that a profile HMM would produce – or its consensus","hmmemit -N 5 --seed 42 globins4.hmm       (five sampled sequences)\nhmmemit -c globins4.hmm                   (the consensus sequence)\n\nOne thread here: --cpu is left out, with a note. Files compressed with gzip (.gz) cannot be read here – HMMER would\nstart gzip for them: unpack them first (gunzip -k FILE.gz). -h lists every option; the HMMER User's Guide explains them."],
    hmmstat:['hmmstat','3.4',"HMMER: one line about each profile in a file (its length, the sequences it was built from …)","hmmstat minifam.hmm\n\nOne thread here: --cpu is left out, with a note. Files compressed with gzip (.gz) cannot be read here – HMMER would\nstart gzip for them: unpack them first (gunzip -k FILE.gz). -h lists every option; the HMMER User's Guide explains them."],
    phmmer:['phmmer','3.4',"HMMER: searches a sequence database with one protein sequence (like BLASTP, with HMMER's statistics)","phmmer /data/examples/hmmer/HBB_HUMAN /data/examples/hmmer/globins45.fa\nphmmer --tblout hits.tbl -E 1e-10 query.faa proteins.faa\n\nOne thread here: --cpu is left out, with a note. Files compressed with gzip (.gz) cannot be read here – HMMER would\nstart gzip for them: unpack them first (gunzip -k FILE.gz). -h lists every option; the HMMER User's Guide explains them."],
    jackhmmer:['jackhmmer','3.4',"HMMER: searches a sequence database again and again with a profile it builds from what it finds","jackhmmer -N 3 /data/examples/hmmer/HBB_HUMAN /data/examples/hmmer/globins45.fa      (at most three rounds; it stops when nothing new comes)\njackhmmer --chkhmm round -N 3 query.faa proteins.faa   (the profile of each round: round-1.hmm …)\n\nOne thread here: --cpu is left out, with a note. Files compressed with gzip (.gz) cannot be read here – HMMER would\nstart gzip for them: unpack them first (gunzip -k FILE.gz). -h lists every option; the HMMER User's Guide explains them."],
    nhmmer:['nhmmer','3.4',"HMMER: searches DNA sequences with a DNA profile HMM (or a sequence, or an alignment) – on both strands","nhmmer /data/examples/hmmer/MADE1.hmm /data/examples/hmmer/dna_target.fa\nnhmmer --tblout made1.tbl /data/examples/hmmer/MADE1.hmm /data/examples/hmmer/dna_target.fa\n\nOne thread here: --cpu is left out, with a note. Files compressed with gzip (.gz) cannot be read here – HMMER would\nstart gzip for them: unpack them first (gunzip -k FILE.gz). -h lists every option; the HMMER User's Guide explains them."],
    nhmmscan:['nhmmscan','3.4',"HMMER: searches DNA sequences against a database of DNA profile HMMs","cp /data/examples/hmmer/MADE1.hmm . && hmmpress MADE1.hmm\nnhmmscan MADE1.hmm /data/examples/hmmer/dna_target.fa\n\nOne thread here: --cpu is left out, with a note. Files compressed with gzip (.gz) cannot be read here – HMMER would\nstart gzip for them: unpack them first (gunzip -k FILE.gz). -h lists every option; the HMMER User's Guide explains them."],
    bustools:['bustools','0.45.1',"bustools: single-cell RNA-seq – sorts, corrects and counts the BUS records of kallisto bus (cells × genes)","bustools sort -o sorted.bus /data/examples/singlecell/input.bus\nbustools correct -w /data/examples/singlecell/whitelist.txt -o corrected.bus sorted.bus\nbustools sort -o corrected.sorted.bus corrected.bus\nmkdir -p counts\nbustools count --genecounts -g /data/examples/singlecell/transcripts-to-genes.txt -e /data/examples/singlecell/matrix.ec \\\n    -t /data/examples/singlecell/transcripts.txt -o counts/cells_x_genes corrected.sorted.bus\nbustools inspect corrected.sorted.bus        bustools text -p corrected.sorted.bus | head\n\nA BUS file has a record for each molecule seen: the cell's barcode, the UMI, the equivalence class (the transcripts the\nread fits) and how often it was seen – kallisto bus writes it from single-cell reads. sort; correct (cell barcodes, against\nthe technology's list); count (cells × genes, in Matrix Market format, with .barcodes.txt and .genes.txt); inspect, text,\ncapture, allowlist, umicorrect, compress … – bustools COMMAND without arguments lists its options.\nOne thread here: sort -t N becomes -t 1, with a note; sort keeps 64 MB in memory by default, 1 GB at most (-m 4G becomes\n-m 64M)."],
    macs3:['macs3','3.0.5',"MACS3: finds peaks – where reads pile up more than chance and the control would put them – in ChIP-seq, ATAC-seq, CUT&RUN …","macs3 callpeak -t /data/examples/chipseq/CTCF_SE_ChIP_chr22_50k.bed.gz -c /data/examples/chipseq/CTCF_SE_CTRL_chr22_50k.bed.gz \\\n    -f BED -g 52000000 -n ctcf -B --outdir ctcf\nhead -3 ctcf/ctcf_peaks.narrowPeak     (the peaks: chromosome, start, end, name, score, strand, fold enrichment, -log10 p, -log10 q, summit)\nmacs3 bdgcmp -t ctcf/ctcf_treat_pileup.bdg -c ctcf/ctcf_control_lambda.bdg -m FE -o ctcf/ctcf_FE.bdg   (fold enrichment along the genome)\nigv --genome hg19 ctcf/ctcf_peaks.narrowPeak ctcf/ctcf_FE.bdg\nmacs3 callpeak -t chip.bam -c input.bam -f BAMPE -g hs -n sample      (paired reads: the fragments themselves, no model)\nmacs3 callpeak -t chip.bam -c input.bam -g hs --broad -n mark          (broad regions: histone marks)\nmacs3 hmmratac -i /data/examples/atacseq/yeast_SRR1822137_chrI.bedpe.gz -f BEDPE --randomSeed 12345 -n atac --outdir atac   (ATAC-seq)\n\n-t: the ChIP (treatment); -c: the control (input); -f: BED, BAM, BAMPE, BEDPE, FRAG … (AUTO, the default, does not find the\npaired formats); -g: the effective genome size – hs (human), mm (mouse), ce (worm), dm (fly) or a number; -n: the name of the\nfiles; --outdir: their folder; -B: the pile-ups as bedGraph files too; -q 0.05: the q-value of a peak (-p: a p-value instead);\n--nomodel --extsize 200: no model, every read extended to 200 bases. callpeak writes NAME_peaks.narrowPeak, NAME_peaks.xls\n(a tab-separated table), NAME_summits.bed and NAME_model.r (an R script: Rscript NAME_model.r draws NAME_model.pdf).\n\nThe commands: callpeak, hmmratac, bdgcmp, bdgpeakcall, bdgbroadcall, bdgopt, cmbreps, bdgdiff, filterdup, predictd, pileup,\nrandsample, refinepeak, callvar. macs3 COMMAND -h lists the options of a command.\nMACS3 is a Python program: each command starts the Python that comes with it, with NumPy, SciPy, scikit-learn and pandas,\nwhich takes a few seconds (the first time about 45 MB are loaded). It runs as one process (callvar -m N works through its N\nparts one after another) and keeps the reads in memory: a chromosome or a small genome, not a whole human experiment."],
    plink2:['plink2','2.0.0-b.1-dev',"PLINK 2: the genotypes of many people – quality control, allele frequencies, LD, kinship, association (GWAS) and scores","plink2 --vcf /data/examples/plink2/1kg-phase3-chr21.vcf.gz --make-pgen --out chr21   (PLINK's own files: chr21.pgen, .pvar, .psam)\nplink2 --pfile chr21 --freq --out chr21                    (allele frequencies: chr21.afreq)\nplink2 --pfile chr21 --missing --hardy --het --out qc      (missing calls, Hardy-Weinberg, heterozygosity)\nplink2 --pfile chr21 --maf 0.05 --indep-pairwise 50 5 0.2 --out ld      (LD pruning: ld.prune.in, ld.prune.out)\nplink2 --pfile chr21 --keep /data/examples/plink2/keep48.samples.txt --make-king-table --out king   (kinship)\nplink2 --vcf /data/examples/plink2/synthetic_glm.vcf --pheno /data/examples/plink2/synthetic_phenotypes.tsv \\\n    --pheno-name BINARY --covar /data/examples/plink2/synthetic_covariates.tsv --glm hide-covar --out assoc   (association)\nplink2 --help --glm                                         (what an option does)\n\nEach command writes NAME.log and the files of what it was asked for, named by --out NAME (plink2.* without --out).\n--pfile NAME reads NAME.pgen, NAME.pvar and NAME.psam; --bfile NAME the PLINK 1 files NAME.bed, NAME.bim and NAME.fam.\nPLINK 2 computes here on one thread, in 640 MiB of working memory: the terminal adds  --threads 1 --memory 640 require\nunless you give them (--threads 2 at most; --memory 640 to 1024). It needs a cross-origin isolated page, as featureCounts.\nNot in this build of PLINK 2, which has no LAPACK: --pca and --pheno-svd. Not here: --script and --rerun."],
    freebayes:['freebayes','1.3.6','FreeBayes: haplotype-based variant caller – SNPs, indels and MNPs from aligned reads (BAM)','freebayes -f /data/examples/reads/reference.fa mapped.bam > freebayes.vcf\nfreebayes -f /data/examples/reads/reference.fa -r human_CYP2C19:11000-12500 mapped.bam    (one region: needs mapped.bam.bai – samtools index mapped.bam)\nfreebayes -f /data/examples/reads/reference.fa --min-alternate-count 3 --min-mapping-quality 20 mapped.bam > strict.vcf\n\nThe reads must be sorted by position (samtools sort); the reference needs its .fai index (samtools faidx).']
  };
  for(const [name,[program,version,summary,man]] of Object.entries(definitions))T[name]={version,summary,man:`${name} ${version} · compiled program, running in your browser\n\n${man}`,run:ctx=>{
    const here=(what,err)=>{if(MG.shellUtil.notHere)MG.shellUtil.notHere(what);return err;};
    // (tview draws on a terminal; with -d T or -d H it prints text or HTML and needs none)
    if(name==='samtools'&&ctx.args[0]==='tview'&&!ctx.args.some((x,i)=>/^-d[TH]$/.test(x)||(x==='-d'&&/^[TH]$/.test(ctx.args[i+1]||''))))throw here('samtools tview without -d',MG.shellUtil.userErr('samtools tview requires a terminal device; use samtools view instead – or samtools tview -d T -p CHR:POS FILE.bam REF.fa, which prints text.'));
    // samtools reheader -c CMD hands the header to another program – which a program cannot start here
    if(name==='samtools'&&ctx.args[0]==='reheader'&&ctx.args.some(x=>x==='-c'||x==='--command'||/^--command=/.test(x)))throw here('samtools reheader -c',MG.shellUtil.userErr("samtools reheader: -c (--command) runs another program on the header, and a program cannot start a program in this terminal. Do it in two steps:  samtools view -H in.bam | sed 's/old/new/' > header.sam  and then  samtools reheader header.sam in.bam > out.bam"));
    // bcftools +NAME loads a plugin from a shared library, which a WebAssembly program in a web page cannot do
    if(name==='bcftools'&&(/^\+/.test(ctx.args[0]||'')||(ctx.args[0]==='plugin'&&ctx.args.length>1&&ctx.args[1]!=='-l'&&ctx.args[1]!=='--list-plugins')))throw here('the plugins of bcftools',MG.shellUtil.userErr(`bcftools: plugins (${ctx.args[0]==='plugin'?'bcftools plugin NAME':ctx.args[0]}) are not available in this build. The built-in commands are: view, query, filter, norm, stats, annotate, call, mpileup, index, sort, concat, merge, isec, consensus, reheader.`));
    // bowtie2 and bowtie2-build are wrapper scripts around these programs; like them, say that a wrapper made the call
    if(name==='bowtie2'){
      // these options are carried out by the wrapper script itself (it reads the aligner's output), which is not here
      const w=ctx.args.find(a=>/^--(un|al)(-conc|-mates)?(-gz|-bz2|-lz4)?(=|$)/.test(a));
      if(w)throw here('bowtie2 '+w.split('=')[0],MG.shellUtil.userErr(`bowtie2: ${w.split('=')[0]} is not available here: it is done by bowtie2's wrapper script (perl), and this terminal runs the aligner itself. To get the reads that did not align:  samtools fastq -f 4 mapped.bam > unaligned.fastq`));
    }
    if(name==='bowtie2')return bowtie2Run(ctx,program);
    if(name==='bowtie2-build')return withArgs(ctx,['--wrapper','basic-0',...ctx.args],program);
    if(name==='hisat2')return hisat2Run(ctx,here);
    if(name==='hisat2-build'||name==='hisat2-inspect')return hisat2Tool(ctx,name,here);
    if(name==='samtools')seedNote(ctx);
    // lofreq call-parallel and vcfplot are Python scripts that start other programs – which a web page cannot do
    if(name==='lofreq'&&(ctx.args[0]==='call-parallel'||ctx.args[0]==='vcfplot')){
      here('lofreq '+ctx.args[0]);
      ctx.err(ctx.args[0]==='call-parallel'?'lofreq call-parallel: not available here – it is a Python script that runs several lofreq call processes at once, and a browser page cannot start processes. Use lofreq call: one process, the same calls (but for rare differences where call-parallel splits the genome).\n':'lofreq vcfplot: not available here – it is a Python script that plots with matplotlib. For the numbers use bcftools stats; to plot, read the VCF into a notebook.\n');
      return 2;
    }
    if(OWN_WORKER[program]&&OWN_WORKER[program].threads&&!window.crossOriginIsolated)return notIsolated(ctx,name);
    // PLINK 2: its threads and memory (--threads 1 --memory 640 require unless given; at most 2 and 1024), not --script
    if(name==='plink2'){
      const a=plink2Args(ctx.args,ctx.io);
      if(a.refuse){here('plink2 '+(ctx.args.find(x=>/^--?(script|rerun)$/.test(x))||'--script'));ctx.err(a.refuse+'\n');return 1;}
      return withArgs(ctx,a,program);
    }
    // bustools sort -m: the memory for sorting (bustools' own default, 4 GB, is more than a browser tab has: here the
    // default is 64 MB, and 1 GB the most). A larger value becomes 64M, with a note
    if(name==='bustools'&&ctx.args[0]==='sort')return withArgs(ctx,bustoolsMemory(oneThread(name,ctx.args,ctx.io),ctx.io),program);
    // HMMER reads a file ending in .gz through gzip, a program it starts – which a web page cannot do
    if(HMMER.includes(name)){
      const gz=ctx.args.find((a,i)=>/\.gz$/.test(a)&&!(i&&HMMER_OUTS.includes(ctx.args[i-1]))&&ctx.fs.exists(ctx.fs.resolve(a))&&!ctx.fs.isDir(ctx.fs.resolve(a)));
      if(gz){here(name+' with a .gz file');ctx.err(`${name}: ${gz}: files compressed with gzip cannot be read here – HMMER starts gzip to read them, and a web page cannot start programs. Unpack it first:  gunzip -k ${gz}\n`);return 1;}
    }
    return withArgs(ctx,oneThread(name,ctx.args,ctx.io),program);
  }};
  // bustools sort -m SIZE (M or G at the end; a number below 128 without them is gigabytes, as bustools reads it)
  function bustoolsMemory(args,io){
    const bytes=v=>{const m=/^(\d+)([mMgG]?)$/.exec(v||'');if(!m)return null;const n=+m[1];return /[gG]/.test(m[2])?n*2**30:/[mM]/.test(m[2])?n*2**20:n<128?n*2**30:n;};
    const out=[];let dropped=null;
    for(let i=0;i<args.length;i++){
      const a=args[i],g=/^(-m|--memory=)(.+)$/.exec(a);
      if((a==='-m'||a==='--memory')&&i+1<args.length&&bytes(args[i+1])>2**30){dropped=`${a} ${args[i+1]}`;out.push(a,'64M');i++;continue;}
      if(g&&bytes(g[2])>2**30){dropped=a;out.push(g[1]+'64M');continue;}
      out.push(a);
    }
    if(dropped&&io&&io.note)io.note(`bustools: ${dropped} becomes ${dropped.replace(/(\s|=|^-m)\S+$/,'$164M')} here – in the browser bustools sorts in 1 GB of memory at most.`);
    return out;
  }
  /* featureCounts, Salmon and PLINK 2 outside a cross-origin isolated page: why they cannot run here, and what to do */
  function notIsolated(ctx,name){
    const why=(window.WB_ISOLATION||{}).reason||'';
    const how=why==='insecure'?'Only a page opened over https, or from localhost, can be isolated – this one was not.'
      :why==='no-service-worker'?'The workbench isolates its page with a service worker, which this browser does not allow here (a private window can be the reason).'
      :why==='off'?'Isolation is turned off: the address of the page has ?isolation=off. Open the workbench without it.'
      :'The workbench isolates its page as it starts: reload the page.';
    ctx.err(`${name}: this program counts on several threads that share their memory, and a browser allows that only in a page that is cross-origin isolated – this page is not. ${how} (See Limits in the help.)\n`);
    // (once, also as a note – which is seen where the program's messages go into a file: 2> log.txt)
    if(!W.isolationNoted&&ctx.io&&ctx.io.note){W.isolationNoted=true;ctx.io.note(`featureCounts, salmon and plink2 cannot run in this page: it is not cross-origin isolated. ${how}`);}
    return 1;
  }
  /* bowtie2 is a wrapper script (perl) around the aligner, bowtie2-align-s. This terminal runs the aligner itself –
     and does here the two things of the wrapper that a script or a person meets:
     - before anything else it looks for the index (-x NAME: any file NAME*.bt2 or NAME*.bt2l, also below
       $BOWTIE2_INDEXES): if there is none it says so in its own words and ends with status 255;
     - when the aligner fails, it adds its line "(ERR): bowtie2-align exited with value N" and ends with N. */
  async function bowtie2Run(ctx,program){
    const a=ctx.args,xi=a.indexOf('-x');
    if(xi>=0&&a[xi+1]!=null){
      const fs=ctx.fs,there=base=>{
        const abs=fs.resolve(base),dir=/\/$/.test(base)?abs:MG.path.dirname(abs),stem=/\/$/.test(base)?'':abs.slice(dir.length).replace(/^\//,'');
        return fs.isDir(dir)&&fs.list(dir).some(c=>c.entry.kind!=='dir'&&c.name.startsWith(stem)&&/\.bt2l?$/.test(c.name.slice(stem.length)));
      };
      const env=(ctx.env&&ctx.env.BOWTIE2_INDEXES)||'';
      if(!there(a[xi+1])&&!(env&&there(env.replace(/\/+$/,'')+'/'+a[xi+1]))){
        ctx.err(`(ERR): "${env?env+'/':''}${a[xi+1]}" does not exist or is not a Bowtie 2 index\nExiting now ...\n`);
        return 255;
      }
    }
    const code=await withArgs(ctx,['--wrapper','basic-0',...a],program);
    if(code)ctx.err(`(ERR): bowtie2-align exited with value ${code}\n`);
    return code;
  }
  /* HISAT2. hisat2 is a wrapper script (perl) around the aligner, hisat2-build and hisat2-inspect are wrapper scripts
     (python) around theirs. Here the three programs are one module: "hisat2 build|inspect ARGS", and the aligner when
     the first argument is an option (see its NOTICE.txt). The terminal does what the wrappers do that a person meets:
     - the programs are told --wrapper basic-0, as the wrappers tell them (their messages then name hisat2 and hisat2-build);
     - hisat2 first looks for the read files ("(ERR): Read file 'X' doesn't exist"), then for the index (-x NAME: any
       file NAME*.ht2): if it is not there it says so in its own words and ends with status 255;
     - read files packed with gzip (.gz) are unpacked first: the aligner reads only plain FASTQ/FASTA files;
     - when the aligner fails it adds "(ERR): hisat2-align exited with value N" and ends with N.
     Done by the wrapper itself, and so not here: --un, --al, --un-conc, --al-conc (it reads the aligner's output). */
  const hisat2Fail=(ctx,msg)=>{ctx.err(`(ERR): ${msg}\nExiting now ...\n`);return 255;};
  async function hisat2Run(ctx,here){
    const a=ctx.args,fs=ctx.fs,u=MG.shellUtil;
    const w=a.find(x=>/^--(un|al|un-conc|al-conc|al-conc-disc)(-gz|-bz2|-lz4)?(=|$)/.test(x));
    if(w)throw here('hisat2 '+w.split('=')[0],u.userErr(`hisat2: ${w.split('=')[0]} is not available here: it is done by hisat2's wrapper script (perl), and this terminal runs the aligner itself. To get the reads that did not align:  samtools fastq -f 4 mapped.bam > unaligned.fastq  (or leave them out of the SAM file with --no-unal)`));
    if(a.includes('--large-index'))throw here('hisat2 --large-index',u.userErr('hisat2: --large-index is not available here: indexes are the small kind (.ht2), enough for anything that fits into a browser.'));
    // the read files: -U, --unpaired, -1, -2 (also -1FILE), each a list separated by commas
    const groups={U:[],1:[],2:[]},at={U:[],1:[],2:[]};
    let inline=false;
    for(let i=0;i<a.length;i++){
      const x=a[i];
      if(x==='--')break;
      if(x==='-c')inline=true;
      let k=null,v=null;
      if(x==='-U'||x==='--unpaired'){k='U';v=a[i+1];}
      else{const m=/^--?([12])(.*)$/.exec(x);if(m&&!/^--?12/.test(x)){k=m[1];if(m[2])v=m[2];else v=a[i+1];}}
      if(k==null||v==null)continue;
      const glued=!(x==='-U'||x==='--unpaired'||/^--?[12]$/.test(x));
      at[k].push(glued?[i,x.slice(0,x.length-v.length)]:[i+1,'']);
      groups[k].push(...v.split(',').filter(Boolean));
      if(!glued)i++;
    }
    const files=[...groups.U,...groups[1],...groups[2]];
    if(!inline)for(const f of files)if(f!=='-'&&!(fs.exists(f)&&!fs.isDir(f)))return hisat2Fail(ctx,`Read file '${f}' doesn't exist`);
    const args=a.slice(),held=[];
    try{
      // packed read files: each group (-U, -1, -2) becomes one plain file, as the wrapper makes one pipe of each
      if(!inline&&files.some(f=>/\.(gz|bz2)$/.test(f))){
        const bz=files.find(f=>/\.bz2$/.test(f));
        if(bz)throw here('hisat2 with .bz2 reads',u.userErr(`hisat2: ${bz}: bzip2 files cannot be unpacked in this terminal. Unpack it elsewhere, or pack it with gzip.`));
        for(const k of ['U','1','2']){
          if(!groups[k].length)continue;
          const parts=[];
          for(const f of groups[k]){
            if(/\.gz$/.test(f)){
              const r=await W.run({...ctx,stdin:null,inherit:null,redirectTarget:null,mergeStderr:false},'bgzip',['-dc',f],{binaryOut:true});
              if(r.code){ctx.err(tidy(r.stderr,'hisat2'));return hisat2Fail(ctx,`Could not open gzipped read file: ${f} `);}
              parts.push(await W.readBytes(r.stdoutPath));
            }else parts.push(await fs.readBytes(f));
          }
          let n=0;for(const b of parts)n+=b.length;
          const all=new Uint8Array(n);let o=0;for(const b of parts){all.set(b,o);o+=b.length;}
          const ref=await W.tempBytes(all,false);W.hold(ref.apath);held.push(ref.apath);
          // (the first place of the group gets the plain file; the others go)
          at[k].forEach(([idx,prefix],j)=>{args[idx]=j?null:prefix+ref.apath;if(j&&!prefix)args[idx-1]=null;});
        }
      }
      // the index: -x NAME
      const xi=args.indexOf('-x');
      if(xi>=0&&args[xi+1]!=null){
        const base=args[xi+1],abs=fs.resolve(base),dir=/\/$/.test(base)?abs:MG.path.dirname(abs),stem=/\/$/.test(base)?'':abs.slice(dir.length).replace(/^\//,'');
        if(!(fs.isDir(dir)&&fs.list(dir).some(c=>c.entry.kind!=='dir'&&c.name.startsWith(stem)&&/\.ht2l?$/.test(c.name.slice(stem.length)))))return hisat2Fail(ctx,`"${base}" does not exist`);
      }
      const code=await withArgs(ctx,['--wrapper','basic-0',...oneThread('hisat2',args.filter(x=>x!=null),ctx.io)],'hisat2');
      if(code)ctx.err(`(ERR): hisat2-align exited with value ${code}\n`);
      return code;
    }finally{for(const p of held)W.release(p);}
  }
  /* hisat2-build and hisat2-inspect: their wrappers take away --verbose, --debug and --large-index (the last two
     choose another program) and tell the program --wrapper basic-0. */
  function hisat2Tool(ctx,name,here){
    const a=ctx.args.filter(x=>x!=='--verbose'&&x!=='--debug');
    if(a.includes('--large-index'))throw here(name+' --large-index',MG.shellUtil.userErr(`${name}: --large-index is not available here: indexes are the small kind (.ht2), enough for anything that fits into a browser.`));
    const args=name==='hisat2-build'?oneThread('hisat2-build',a,ctx.io):a;
    return withArgs(ctx,[name==='hisat2-build'?'build':'inspect','--wrapper','basic-0',...args],'hisat2');
  }
  /* samtools view -s SEED.FRACTION (and --subsample-seed): samtools turns the seed into a pseudo-random number with
     the C library's rand(), and the C library of these WebAssembly programs (musl) gives other numbers than the
     one on Linux (glibc). So with a seed other than 0 the same command keeps other reads on Linux – about as many,
     not the same. With seed 0 samtools does not call rand(): -s 0.25 gives the same reads everywhere. */
  function seedNote(ctx){
    const a=ctx.args;
    if(a[0]!=='view'||!ctx.io||!ctx.io.note)return;
    let seed=null;
    for(let i=1;i<a.length;i++){
      let m;
      if(a[i]==='-s'&&(m=/^(\d+)\.\d+$/.exec(a[i+1]||'')))seed=m[1];
      else if((m=/^-s(\d+)\.\d+$/.exec(a[i])))seed=m[1];
      else if(a[i]==='--subsample-seed'&&/^\d+$/.test(a[i+1]||''))seed=a[i+1];
      else if((m=/^--subsample-seed=(\d+)$/.exec(a[i])))seed=m[1];
    }
    if(seed!=null&&+seed!==0)ctx.io.note(`samtools view: with the seed ${seed} this program keeps other reads than samtools on Linux does (about as many, but not the same ones): samtools feeds the seed through the C library's random numbers, and the library of this terminal's programs is another one. With seed 0 (-s 0.25, or --subsample 0.25 alone) the reads are the same everywhere; so are those of seqtk sample -s.`);
  }
  /* gzip, gunzip, zcat: bgzip does the work (what it writes, BGZF, is a valid gzip file). gzip takes any number of
     files, bgzip one: each file is done by itself –  gzip a.txt b.txt  makes two .gz files,  zcat x.gz y.gz  prints
     both, one after the other. */
  const gzLong={'--recursive':'r','--stdout':'c','--to-stdout':'c','--decompress':'d','--uncompress':'d','--keep':'k','--force':'f','--best':'9','--fast':'1','--quiet':'q','--verbose':'v','--test':'t','--no-name':'n','--name':'N'};
  async function gzRun(ctx,name){
    const u=MG.shellUtil;
    let toStdout=name==='zcat'||name==='gzcat',decompress=name!=='gzip',keep=false,force=false,test=false,level=null,noMore=false,quiet=false,recursive=false;
    const files=[];
    for(const a of ctx.args){
      if(noMore||a==='-'||!a.startsWith('-')){files.push(a);continue;}
      if(a==='--'){noMore=true;continue;}
      if(a==='--help'||a==='--version'){ctx.out(`${name}: ${name==='gzip'?'compress':'decompress'} gzip files – in this terminal bgzip ${W.versions.htslib} does the work.\nUsage: ${name} [-c] [-d] [-k] [-f] [-r] [-t] [-q] [-1 … -9] [FILE …]\n`);return 0;}
      const letters=a.startsWith('--')?(gzLong[a]||''):a.slice(1);
      if(!letters)throw u.userErr(`${name}: unrecognized option '${a}'\nTry \`${name} --help' for more information.`);
      for(const c of letters){
        if(c==='c')toStdout=true;else if(c==='d')decompress=true;else if(c==='k')keep=true;else if(c==='f')force=true;else if(c==='t')test=true;
        else if(/[1-9]/.test(c))level=c;else if(c==='q')quiet=true;else if(c==='r')recursive=true;else if('vnN'.includes(c))continue;
        else if(c==='l'||c==='S')throw u.userErr(`${name}: -${c} is not available in this terminal (the work is done by bgzip). The size of what is in a .gz file:  zcat FILE.gz | wc -c`);
        else throw u.userErr(`${name}: invalid option -- '${c}'\nTry \`${name} --help' for more information.`);
      }
    }
    // (gzip -t looks at compressed files, as gzip -d does: NAME stands for NAME.gz where there is no NAME)
    if(test)decompress=true;
    // -r: a folder stands for every file in it and below it (and gzip then says nothing about the files it leaves alone)
    if(recursive){
      const all=[];
      for(const f of files){
        if(f==='-'||f===''||!ctx.fs.isDir(f)){all.push(f);continue;}
        const abs=ctx.fs.resolve(f),pre=abs==='/'?'/':abs+'/',lead=f.endsWith('/')?f:f+'/';
        all.push(...Array.from(real(ctx.fs).entries).filter(([k,e])=>k.startsWith(pre)&&e.kind!=='dir').map(([k])=>lead+k.slice(pre.length)).sort());
      }
      // (folders without a file in them: there is nothing to do – and nothing is read from the input)
      if(files.length&&!all.length)return 0;
      files.length=0;files.push(...all);
    }
    const one=f=>[...(test?['-t']:[]),...(decompress&&!test?['-d']:[]),...(toStdout&&!test?['-c']:[]),...(keep?['-k']:[]),...(force&&!toStdout?['-f']:[]),...(level&&!decompress?['-l',level]:[]),...(f==null||f==='-'?[]:[f])];
    // zcat -f, gunzip -cf: a file that is not compressed is given as it is
    const plain=async f=>{
      if(!(force&&decompress&&toStdout)||f==null||f==='-'||!ctx.fs.exists(f)||ctx.fs.isDir(f))return null;
      const bytes=await ctx.fs.readBytes(f);
      return bytes.length>=2&&bytes[0]===0x1f&&bytes[1]===0x8b?null:bytes;
    };
    // The suffixes that gzip knows (in any case of the letters): a file that has one is compressed already – gzip leaves
    // it alone –, and only a file that has one is decompressed (.tgz and .taz give .tar, the others are cut off).
    const sfx=f=>{const b=String(f).split('/').pop(),m=/(\.gz|\.tgz|\.taz|\.z|-gz|-z|_z)$/i.exec(b);return m&&m[1].length<b.length?m[1]:null;};
    const result=f=>{const s=sfx(f);return f.slice(0,f.length-s.length)+(/^\.t[ag]z$/i.test(s)?'.tar':'');};
    // What gzip refuses before it reads anything, in gzip's words and with its statuses (1: an error, 2: a warning;
    // an error counts more): a folder ("-- ignored" – bgzip would make DIR.gz), a file that is not there, a file that
    // has the suffix already (gzip *  in a folder where some files are compressed: bgzip would compress them again), a
    // file without the suffix that is to be decompressed, and a result that is there already.
    const refused=f=>{
      if(f==null||f==='-')return null;
      const e=f===''?null:ctx.fs.get(f),s=sfx(f);
      if(!e&&!(decompress&&!s&&f!==''&&ctx.fs.exists(f+'.gz')))return [`gzip: ${decompress&&!s?f+'.gz':f}: ${(ctx.fs.pathError&&ctx.fs.pathError(f))||'No such file or directory'}\n`,1];
      if(e&&e.kind==='dir')return [quiet?'':`gzip: ${f} is a directory -- ignored\n`,2];
      // (gzip -rt: of what is in a folder only the files with the suffix are looked at)
      if(e&&recursive&&test&&!s)return ['',0];
      if(!e||toStdout||test)return null;
      if(!decompress){
        if(s&&!force)return [quiet||recursive?'':`gzip: ${f} already has ${s} suffix -- unchanged\n`,0];
        if(!force&&ctx.fs.exists(f+'.gz'))return [`gzip: ${f}.gz already exists;\tnot overwritten\n`,2];
        return null;
      }
      if(!s)return [quiet||recursive?'':`gzip: ${f}: unknown suffix -- ignored\n`,quiet||recursive?0:2];
      if(!force&&ctx.fs.exists(result(f)))return [`gzip: ${result(f)} already exists;\tnot overwritten\n`,2,'result'];
      return null;
    };
    // How a file that is to be unpacked begins: 'short' – it ends before its second byte –, 'other' – not as a
    // compressed file does (gzip, and the older formats that gzip reads) –, or null.
    const begins=async f=>{
      if(f==null||f==='-'||f==='')return null;
      const n=ctx.fs.exists(f)?f:f+'.gz';
      if(!ctx.fs.exists(n)||ctx.fs.isDir(n))return null;
      const b=await ctx.fs.readBytes(n);
      if(b.length<2)return ['short',n];
      const two=(b[0]<<8)|b[1];
      return two===0x1f8b||two===0x1f9e||two===0x1f1e||two===0x1f9d||two===0x1fa0||two===0x504b?null:['other',n];
    };
    let said=0;
    const count=c=>{if(c===1||said===1)said=1;else if(c)said=Math.max(said,c);};
    // gzip gives the file it makes the permissions and the time of the file it was made from: a script is still
    // executable after gzip and gunzip, and "is the .gz older than the file?" (make-like checks) is answered as on Linux
    const carry=(src,name)=>{
      const fs=real(ctx.fs),abs=ctx.fs.resolve(name),out=fs.entries.get(abs);
      if(!src||!out||out.kind==='dir'||out===src)return;
      const n=Object.assign({},out);
      if(src.mode)n.mode=src.mode;else delete n.mode;
      if(src.perm!=null)n.perm=src.perm;else delete n.perm;
      // (a read-only file of one's own gives a read-only .gz, and the other way round; the course data's protection is not handed on)
      if(src.readonly&&!src.protected)n.readonly=true;else delete n.readonly;
      if(src.mtime)n.mtime=src.mtime;
      fs.entries.set(abs,n);
    };
    if(files.length&&(!toStdout||test)){
      // each file is replaced by its .gz (or the .gz by the file) – one after the other, each looked at when its turn comes
      for(let f of files){
        const r=refused(f);
        // gzip looks into a file before it looks at the name of the result. A file that ends before its second byte
        // ends gzip itself ("unexpected end of file", status 1: the files after it are not looked at); one that does
        // not begin as a compressed file is an error (status 1) – whether or not the result is there already.
        if(decompress&&!test&&(!r||r[2]==='result')){
          const g=await begins(f);
          if(g&&g[0]==='short'){ctx.err(`\ngzip: ${g[1]}: unexpected end of file\n`);return 1;}
          if(g){ctx.err(`\ngzip: ${g[1]}: not in gzip format\n`);count(1);continue;}
        }
        if(r){if(r[0])ctx.err(r[0]);count(r[1]);continue;}
        // (gunzip NAME: NAME.gz is meant where there is no NAME)
        if(f!=='-'&&decompress&&!ctx.fs.exists(f))f+='.gz';
        if(f!=='-'&&decompress&&!test&&!/\.gz$/.test(f)){
          // a suffix that bgzip does not know (.tgz, .GZ, .z, -gz …): its output is written under the name gzip gives the result
          const run=await W.run({...ctx,redirectTarget:null,mergeStderr:false},'bgzip',['-dc',f],{binaryOut:true});
          if(run.stderr)ctx.err(tidy(run.stderr,name));
          if(run.code){count(1);continue;}
          const from=ctx.fs.get(f);
          await W.writeBytes(ctx.fs,ctx.fs.resolve(result(f)),await W.readBytes(run.stdoutPath));
          carry(from,result(f));
          if(!keep)ctx.fs.remove(f);
          continue;
        }
        const from=f==='-'?null:ctx.fs.get(f);
        // (-f: a result that is there already is removed first, as gzip does – so a read-only one is no obstacle)
        if(force&&from&&!test){const old=ctx.fs.get(decompress?result(f):f+'.gz');if(old&&old.kind!=='dir'&&old.readonly&&!old.protected)ctx.fs.remove(decompress?result(f):f+'.gz');}
        if(await withArgs(ctx,one(f),'bgzip'))count(1);
        else if(from&&!test)carry(from,decompress?result(f):f+'.gz');
      }
      return said;
    }
    const todo=[];
    for(const f of files){const r=refused(f);if(r){if(r[0])ctx.err(r[0]);count(r[1]);}else todo.push(f!=='-'&&decompress&&!ctx.fs.exists(f)?f+'.gz':f);}
    if(files.length&&!todo.length)return said;
    if(todo.length<=1&&!(await plain(todo[0]))){const c=await withArgs(ctx,one(todo[0]),'bgzip');return c?(said===1?1:c):said;}
    // to the output: what each file gives, one after the other
    const sink=new u.Sink();let code=said;
    for(const f of todo){
      const raw=await plain(f);
      if(raw){sink.add(raw);continue;}
      const r=await W.run({...ctx,redirectTarget:null,mergeStderr:false},'bgzip',one(f),{binaryOut:true});
      if(r.stderr)ctx.err(tidy(r.stderr,name));
      if(r.code)code=r.code;
      sink.add(await W.readBytes(r.stdoutPath));
      MG.bus.emit('tool:run',{program:'bgzip',sub:'',args:one(f),code:r.code,secs:r.secs,created:r.created,real:true,line:ctx.rawLine,statusKnown:r.statusKnown});
    }
    if(ctx.takesBytes)ctx.out(sink.bytes());
    else if(!decompress){if(!sink.empty)ctx.io.note(`Binary output: ${MG.humanSize(sink.bytes().length)} bytes. Save with > FILE, or inspect using samtools/bcftools view.`);}
    else ctx.out(sink.text());
    return code;
  }
  for(const name of ['gzip','gunzip','zcat','gzcat'])T[name]={hidden:true,summary:'gzip files (done by bgzip)',man:`${name}: ${name==='gzip'?'compress':'decompress'} gzip files. In this terminal bgzip ${W.versions.htslib} does the work.`,run:ctx=>gzRun(ctx,name)};
  /* zgrep PATTERN FILE… = for each file: zcat -f FILE | grep --label=FILE PATTERN. A file that is not compressed is
     searched as it is; with several files each line is given with the name of its file (not with -h), as grep
     does; the status is 0 if something was found in any file, 2 after an error, else 1. */
  T.zgrep={hidden:true,summary:'grep in gzip files',man:'zgrep [OPTIONS] PATTERN FILE…: search gzip files (for each: zcat -f FILE | grep PATTERN).',run:async ctx=>{
    const opts=[],rest=[];
    for(let i=0;i<ctx.args.length;i++){const a=ctx.args[i];if(a==='-e'||a==='-m'||a==='-A'||a==='-B'||a==='-C')opts.push(a,ctx.args[++i]);else if(a.startsWith('-')&&a.length>1)opts.push(a);else rest.push(a);}
    if(!rest.length&&!opts.includes('-e'))throw MG.shellUtil.userErr('usage: zgrep [OPTIONS] PATTERN FILE.gz',2);
    const pattern=opts.includes('-e')?[]:[rest.shift()];
    const io=MG.shellUtil.innerIO(ctx);
    if(!rest.length){
      // (what comes in is searched as it is when it is not compressed: zgrep PATTERN < plain.txt)
      let packed=true;
      try{const s=ctx.stdin;if(typeof s==='string')packed=s.charCodeAt(0)===0x1f&&s.charCodeAt(1)===0x8b;else if(s instanceof FileRef){const b=await W.readBytes(s.apath);packed=b.length>=2&&b[0]===0x1f&&b[1]===0x8b;}}catch(e){}
      const parts=packed?[{argv:['gzip','-dcfq'],redirs:[]},{argv:['grep',...opts,...pattern],redirs:[]}]:[{argv:['grep',...opts,...pattern],redirs:[]}];
      return ctx.shell.runPipeline(parts,io,ctx.rawLine,Object.assign({},ctx.opts,{stdin:ctx.stdin}));
    }
    const named=rest.length>1&&!opts.some(a=>a==='--no-filename'||(/^-[A-Za-z]+$/.test(a)&&a.includes('h')));
    let found=false,failed=false;
    for(const f of rest){
      const o=Object.assign({},ctx.opts,{stdin:undefined});
      const c=await ctx.shell.runPipeline([{argv:['gzip','-dcfq',f],redirs:[]},{argv:['grep',...opts,...(named?['-H']:[]),'--label='+f,...pattern],redirs:[]}],io,ctx.rawLine,o);
      if((o.codes&&o.codes[0])||c>1)failed=true;else if(c===0)found=true;
    }
    return failed?2:found?0:1;
  }};
  /* grep -P. The Biowasm build of grep 3.7 has no PCRE ("Perl matching not supported in a --disable-perl-regexp
     build"), so a command line that asks for Perl patterns is carried out by a second program: GNU grep 3.11 with
     PCRE2 10.42, built for this practical (grep-perl; see its NOTICE.txt). Whether a command line asks for them is
     decided as grep's getopt decides it: -P alone or in a group of letters (-oP, -oPm1 – but not behind a letter that
     takes a value: -eP is the pattern "P"), --perl-regexp or a beginning of that word, anywhere before "--". */
  const GREP_VALUE='ABCDXdefm',GREP_LONG={'after-context':1,'before-context':1,'binary-files':1,'context':1,'devices':1,'directories':1,'exclude':1,'exclude-from':1,'exclude-dir':1,'file':1,'group-separator':1,'include':1,'label':1,'max-count':1,'regexp':1,
    'basic-regexp':0,'extended-regexp':0,'fixed-regexp':0,'fixed-strings':0,'perl-regexp':0,'byte-offset':0,'color':0,'colour':0,'count':0,'files-with-matches':0,'files-without-match':0,'help':0,'ignore-case':0,'no-ignore-case':0,'initial-tab':0,'line-buffered':0,'line-number':0,'line-regexp':0,'no-filename':0,'no-group-separator':0,'no-messages':0,'null':0,'null-data':0,'only-matching':0,'quiet':0,'recursive':0,'dereference-recursive':0,'invert-match':0,'silent':0,'text':0,'binary':0,'unix-byte-offsets':0,'version':0,'with-filename':0,'word-regexp':0};
  function wantsPerl(args){
    let perl=false;
    for(let i=0;i<args.length;i++){
      const a=String(args[i]);
      if(a==='--')break;
      if(a.startsWith('--')){
        const word=a.slice(2).split('=')[0];
        // (the whole word, or a beginning that only one word has)
        const hits=word in GREP_LONG?[word]:Object.keys(GREP_LONG).filter(k=>k.startsWith(word));
        if(hits.length!==1)continue;
        if(hits[0]==='perl-regexp')perl=true;
        else if(GREP_LONG[hits[0]]&&!a.includes('='))i++;
      }else if(a.length>1&&a[0]==='-'){
        for(let k=1;k<a.length;k++){
          if(a[k]==='P')perl=true;
          else if(GREP_VALUE.includes(a[k])){if(k===a.length-1)i++;break;}
        }
      }
    }
    return perl;
  }
  MG.wantsPerl=wantsPerl;
  const grepRun=(ctx,name)=>{
    const first=name==='egrep'?['-E']:name==='fgrep'?['-F']:[],program=wantsPerl(ctx.args)?'grep-perl':'grep';
    return first.length?withArgs(ctx,[...first,...ctx.args],program):runReal(ctx,program);
  };
  for(const name of ['awk','gawk','grep','egrep','fgrep','sed','diff','cmp',...CORE]){
    const program=name==='awk'?'gawk':name==='egrep'||name==='fgrep'?'grep':name;
    T[name]={summary:'GNU '+name+' (real WebAssembly executable)',man:`GNU ${name}: use ${name} --help for its supported options. Shell constructs are documented in help.`,run:ctx=>program==='grep'?grepRun(ctx,name):name==='date'?withArgs(ctx,dateArgs(ctx),program):name==='cat'?catRun(ctx):name==='tee'?teeRun(ctx):runReal(ctx,program)};
    delete MG.shellBuiltins[name];
  }
})();
