# Security model

HTML opened by the editor is treated as untrusted content.

## Editor preview

The editor keeps the original parsed skeleton as its source of truth, but uses
a sanitized copy for iframe rendering and live structural patches. The preview:

- removes `script`, `object`, and `embed` elements;
- removes inline event handlers, `srcdoc`, redirect/CSP meta tags, and `base`;
- rejects executable, local-file, and active data-URL schemes;
- sandboxes nested iframes and opens preview links without opener access;
- prevents form submission through the outer iframe sandbox; and
- accepts editor protocol messages only from the expected parent/iframe window.

The editor's own injected script remains enabled because it implements editing,
selection, comments, and structural controls.

## Export behavior

Sanitization applies to the editor preview, not to the stored source skeleton.
Scripts and other original markup therefore remain in downloaded HTML unless the
user removes them outside the editor. This preserves interactive documents while
preventing their code from running inside the editor origin.

Only open exported files when their original source is trusted.
