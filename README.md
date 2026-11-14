# MUSES

Static Three.js photo museum. No package installation or build step is required.

## File structure

```text
public/                     # Deploy this directory
  index.html                # Page and Three.js import map
  css/style.css             # Styles
  js/main.js                # 3D scene and gallery interactions
  js/gallery.js             # Fixed WebP collection and frame-name matching
  js/ui.js                  # UI interactions
  vendor/three-0.160.0/      # Pinned Three.js, loaders, Draco, and licenses
  _headers                  # Generated Netlify security/cache headers
  assets/
    images/
      backgrounds/          # 7 images used by the intro background
      artworks/             # 18 supplied pictures for gallery use
      webp/                 # All 25 unique pictures as WebP, in one folder
    models/yay.glb          # Active museum model
    environments/           # HDR lighting
archive/models/             # Preserved unused models; excluded from deployment
archive/images/             # Preserved duplicate images; excluded from deployment
netlify.toml                # Netlify publish directory
vercel.json                 # Vercel static deployment configuration
```

## Local preview

From the project root:

```sh
python -m http.server 8000 --directory public
```

Open http://localhost:8000. Use an HTTP server because the site loads JavaScript modules and 3D assets.

## Deployment

- **Vercel:** Import the repository and keep the project root as the root directory. The included configuration serves `public/` with no build command.
- **Netlify:** Import the repository. The included configuration sets the publish directory to `public`; leave the build command empty. For manual deployment, upload the `public/` directory.
- **Other static hosts:** Upload the contents of `public/` to the site's document root. For GitHub Pages, publish `public/` as the Pages artifact using Actions.

Keep the folder hierarchy and filename capitalization intact. Relative asset paths support hosting under a subdirectory.

Three.js and Draco decoders are served locally from the versioned `public/vendor/` directory. Google Fonts is the only remaining external resource; system fonts are available as fallbacks. All 36 frames display the fixed WebP collection for every visitor. Upload controls and browser-saved frame overrides are no longer used.

The two unused `yayz.glb` files are preserved in `archive/models/`. The former root copy is named `root-yayz.glb`; the active scene continues to use `yay.glb`.

`public/assets/images/webp/` contains a flat WebP collection of all background and artwork pictures. Originals remain in their existing folders. Existing WebP files are copied unchanged; JPG files are converted at quality 85 with their resolution preserved. The archived duplicate `art.webp` shares the same content as the background copy, so the collection contains one `art.webp`. The intro and 3D gallery use these same WebP URLs to reuse browser downloads.

To regenerate the WebP collection:

```sh
npm.cmd install --prefix .image-tools --no-save --package-lock=false sharp
node scripts/convert-images.cjs
```

Put new source pictures in `public/assets/images/artworks/`, regenerate the WebP collection, and update `artworkFiles` in `public/js/gallery.js` to change the gallery. The current 25 pictures repeat in model traversal order across all 36 frames. Images fill each frame with centered cover cropping. Intro background originals live in `public/assets/images/backgrounds/`; `public/index.html` references their WebP versions. The duplicate root `art.webp` is preserved in `archive/images/`.

## Performance

The renderer stops after the scroll camera settles, resumes on scrolling/resizing, and suspends animation frames when the tab is hidden. The intro still animates continuously. Repeated artwork shares 25 GPU textures and materials across 36 frames, with per-frame UV cropping; source images are downscaled only when needed, to at most 1024px on desktop or 512px on mobile. Replaced model materials/textures and Draco workers are released after loading. Artwork requests run alongside model loading.

The Vercel configuration and Netlify `_headers` file cache assets for one hour. When replacing an asset at the same URL, browsers can retain the previous file for up to an hour; use a new filename for immediate updates.

Local Chrome checks measured artwork texture pixels decreasing from 23,072,768 to 9,689,465 on desktop (58%) and from 5,768,704 to 5,520,482 on mobile (4%). Frame textures decreased from 36 to 25, and renders over a 1.5-second idle interval decreased from about 91 to zero. These are allocation/render-count checks, not a hardware FPS benchmark.

## Deployment security

`vercel.json` and `public/_headers` contain generated security headers. Netlify uses `_headers` for repository deployments and manual uploads. Other hosts must be configured to send equivalent HTTP response headers; an ordinary local static server does not apply these configuration files.

The Content Security Policy permits same-origin JavaScript, the exact hashed inline import map, and WebAssembly for Draco decoding. It allows blob workers and embedded model images, and Google Fonts CSS/font origins. It blocks other script origins, unhashed inline scripts, inline event handlers, object embeds, forms, and framing of the gallery. `nosniff`, a referrer policy, restricted device permissions, same-origin opener isolation, and HTTPS HSTS are also configured. HSTS applies only after an HTTPS response and does not include subdomains or preload.

Regenerate the headers after editing the inline import map:

```sh
node scripts/security-config.cjs
node scripts/security-config.cjs --check
```

Deploy only `public/`. Source scripts, `.env` files, tool dependencies, and archives belong outside that document root. All deployed images/models are public assets; browser security headers do not provide download access control. Third-party code is pinned to Three.js 0.160.0; review and test dependency updates before replacing the versioned vendor directory. Three.js MIT and Draco Apache 2.0 license information are included with the vendored files.

Local Chrome tests with the actual response policy passed on desktop and mobile, including the gallery, WASM decoder, intro, scrolling, and resize. Tests confirmed that injected inline JavaScript and an external script from an unapproved origin were blocked. Hosted headers and HTTPS still need verification after deployment.

Header references: [MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP), [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json), [Netlify custom headers](https://docs.netlify.com/manage/routing/headers/).
