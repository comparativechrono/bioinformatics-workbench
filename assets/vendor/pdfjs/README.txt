PDF.js 6.3.289 – the PDF viewer of the Files tab (assets/js/pdfview.js)

From the npm package pdfjs-dist 6.3.289 (https://www.npmjs.com/package/pdfjs-dist; integrity
sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==), built by
Mozilla from https://github.com/mozilla/pdf.js. The files are unchanged.

  pdf.min.mjs, pdf.worker.min.mjs   legacy/build/ of the package (the build for older browsers too)
                                    Apache License 2.0: LICENSE
  standard_fonts/Foxit*.pfb         the fonts that stand in for the 14 standard fonts of PDF where a PDF does not
                                    include them (Symbol, ZapfDingbats, Times, Courier): BSD licence, LICENSE_FOXIT
  cmaps/                            Adobe's character maps for Chinese, Japanese and Korean text:
                                    BSD licence, cmaps/LICENSE
  wasm/openjpeg.wasm                JPEG 2000 pictures (OpenJPEG: BSD 2-clause, LICENSE_OPENJPEG; its build for
                                    PDF.js: LICENSE_PDFJS_OPENJPEG)
  wasm/jbig2.wasm                   JBIG2 pictures – scanned pages (PDFium: BSD 3-clause, LICENSE_JBIG2; its build
                                    for PDF.js: Apache 2.0, LICENSE_PDFJS_JBIG2)
  wasm/qcms_bg.wasm                 colour profiles (qcms: MIT, LICENSE_QCMS; LICENSE_PDFJS_QCMS)
  iccs/                             a CMYK colour profile: CC0 1.0, iccs/LICENSE

Left out: the source maps, the build for the newest browsers only (build/), the viewer application (web/), the
JavaScript of the PDF scripting sandbox (scripts in PDFs are not run here), the JavaScript stand-ins for the
WebAssembly decoders, and the Liberation Sans fonts of standard_fonts/ (GNU GPL 2 with a font exception) – where a
PDF uses Helvetica or Arial without including it, the computer's own Helvetica, Arial or another sans-serif font
takes its place.
