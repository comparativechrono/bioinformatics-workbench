// R Markdown and Quarto documents for CodeMirror 5 – written for the workbench's RStudio (not part of CodeMirror).
// The text is Markdown; ```{r …} … ``` chunks and `r …` inline code are R; the YAML header (--- … ---) at the
// top is YAML. Built from CodeMirror's own modes and its multiplex and yaml-frontmatter add-ons.
// MIT licence, as CodeMirror.
(function (mod) {
  mod(window.CodeMirror);
})(function (CodeMirror) {
  'use strict';
  CodeMirror.defineMode('rmd-body', function (config) {
    return CodeMirror.multiplexingMode(
      CodeMirror.getMode(config, { name: 'markdown', highlightFormatting: true }),
      {
        // a chunk of R code: ```{r} or ```{r label, echo=FALSE}
        open: /```+\s*\{[rR](?=[\s,}])[^}\n]*\}/,
        close: /```+/,
        mode: CodeMirror.getMode(config, 'r'),
        delimStyle: 'rmd-chunk',
        innerStyle: 'rmd-code'
      },
      {
        // a chunk of another language (python, bash …): shown, not highlighted
        open: /```+\s*\{(?![rR][\s,}])[A-Za-z][^}\n]*\}/,
        close: /```+/,
        mode: CodeMirror.getMode(config, 'text/plain'),
        delimStyle: 'rmd-chunk',
        innerStyle: 'rmd-code'
      },
      {
        // R code in the text: `r nrow(penguins)`
        open: '`r ',
        close: '`',
        mode: CodeMirror.getMode(config, 'r'),
        delimStyle: 'rmd-inline',
        innerStyle: 'rmd-inline-code'
      }
    );
  });
  CodeMirror.defineMode('rmarkdown', function (config) {
    return CodeMirror.getMode(config, { name: 'yaml-frontmatter', base: 'rmd-body' });
  });
  CodeMirror.defineMIME('text/x-rmarkdown', 'rmarkdown');
});
