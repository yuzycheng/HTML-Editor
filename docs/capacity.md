# Capacity policy

The editor uses separate limits for source files and the resulting collaborative
document. This avoids presenting one misleading “upload size” number.

The product interface uses the familiar **MB** label with rounded values. The
technical limits below remain exact binary **MiB** values, so enforcement has
not changed (for example, 10 MiB is about 10.49 MB).

| Resource | Limit |
|---|---:|
| Source `.html` / `.htm` file | 10 MiB |
| Processed collaborative document | 12 MiB |
| Inline media, total | 5 MiB |
| One inline image after processing | 2 MiB |
| Raw inline audio/video | 3.5 MiB |
| DOM elements | warning at 20,000; reject above 50,000 |
| Comments | 500 total; 16 KiB each; 512 KiB combined |
| Selected project folder | 5,000 files; 512 MiB raw total |

Files above 5 MiB display a performance warning. Remote media URLs do not add
their payload to the collaborative document.

Still photos are not rejected merely because the source file is above 5 MB.
JPEG, PNG, WebP, AVIF, GIF and BMP uploads up to 64 MiB are accepted for
processing; when needed, the editor automatically adjusts quality and
dimensions so the final encoded image fits both the per-image and remaining
document limits. Small images that already fit are kept unchanged. Oversized
animated images are left out with a hosted-link suggestion rather than being
silently flattened to a still frame. The 64 MiB source guard bounds browser
decode memory and is not additional collaboration storage.

## Why these limits exist

The complete document is parsed into a DOM and synchronized through Yjs. Large
inline media also expands by roughly one third when converted to Base64. The
limits protect browser memory, first-sync latency, and the 128 MB Cloudflare
Workers/Durable Objects isolate memory boundary.

The landing page stores the temporary upload in IndexedDB rather than
`sessionStorage`, allowing files above the old 5 MiB browser-storage ceiling.
Small files retain a bounded legacy fallback for older cached deployments.
Temporary local drafts expire after 24 hours, and at most five draft records are
retained per browser origin.

Editable text is stored once in Yjs text blocks rather than duplicated inside
the shared HTML skeleton. Style edits use per-element patches, avoiding a full
skeleton write for every color or sizing change. Incoming y-partykit batches
and cumulative room state above 20 MiB are rejected at the room boundary;
batch chunk counts and presence messages are bounded as well.
