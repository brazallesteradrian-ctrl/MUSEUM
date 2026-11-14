/**
 * MUSES — main.js
 * - Draco-compressed GLB (yay.glb)
 * - HDR environment (shanghai_bund_1k.hdr)
 * - Intro animation on keypress → white flash → Camera 2 + scroll mode
 * - Scroll drives Camera 2's animation (exponential damping, frame-rate independent)
 * - All 36 picture frames display a fixed collection of WebP artwork
 */

import * as THREE from 'three';
import { isPictureFrame, loadGalleryImages } from './gallery.js';

// Begin picture requests alongside the model rather than after model decoding.
const galleryImagesPromise = loadGalleryImages().then(images => ({ images }), error => ({ error }));
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/* Prevent scroll-position jank on reload */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

/* ─── Device Detection ────────────────────────────────────────────────────── */
const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    window.innerWidth / window.innerHeight < 1;
// Low-end = mobile with fewer than 4 CPU threads (older/budget Android phones)
const isLowEnd = isMobile && (navigator.hardwareConcurrency ?? 4) < 4;

/* ─── Scene ───────────────────────────────────────────────────────────────── */
const scene = new THREE.Scene();

/* ─── Cameras (replaced by GLB cameras on load) ──────────────────────────── */
let camera1 = null;
let camera2 = null;
let activeCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
activeCamera.position.set(0, 5, 15);

/* ─── Renderer ────────────────────────────────────────────────────────────── */
const renderer = new THREE.WebGLRenderer({
    antialias: !isMobile,
    alpha: true,
    powerPreference: isMobile ? 'low-power' : 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
// Low-end mobile: 1.0x. Regular mobile: 1.5x. Desktop: up to 2x.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isLowEnd ? 1.0 : isMobile ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false; // Shadows are baked, no real-time needed
document.body.appendChild(renderer.domElement);

/* ─── Pause render when tab is hidden (saves battery on low-end devices) ─── */
let isTabVisible = true;
document.addEventListener('visibilitychange', () => {
    isTabVisible = !document.hidden;
    document.documentElement.classList.toggle('tab-hidden', !isTabVisible);
    if (isTabVisible) {
        clock.getDelta();
        requestRender();
    } else {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
});


/* ─── Environment (HDR — 1.56MB vs 3MB EXR, faster decode, same lighting quality) */
new RGBELoader().load(new URL('../assets/environments/shanghai_bund_1k.hdr', import.meta.url).href, (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
    requestRender();
    // Used for PBR lighting/reflections only — not set as background
});

/* ─── Scroll Animation State ──────────────────────────────────────────────── */
let mixer = null;
let allActions = [];
let scrollProgress = 0;
let targetTimeline = 0;
let smoothTimeline = 0;

// Exponential damping constants (frame-rate independent, from reference)
// Mobile: higher damp (5.5) so camera catches finger faster.
// Desktop: slower (2.2) for cinematic feel.
const SCROLL_DAMP = isMobile ? 5.5 : 2.2;

/* ─── App State ───────────────────────────────────────────────────────────── */
let galleryReady = false;
let appState = 'waiting'; // waiting | playing_intro | scroll_mode
let introTime = 0;
let hasFlashed = false;

/* ─── Picture Frame State ─────────────────────────────────────────────────── */
const frameMeshes = [];       // All frame meshes found in scene
const artworkMaterials = new Map(); // image URL → shared material/texture
// Aspect ratio used for cover cropping.
function getFrameAspect(mesh) {
    if (!mesh) return 1.0;

    // Primary: If we generated a code-based plane, use its physical aspect ratio
    if (mesh.userData.aspectRatio) return mesh.userData.aspectRatio;

    const geo = mesh.geometry;

    // Fallback: UV-space (rotation-proof, matches how Blender UV-unwrapped the face)
    const uvAttr = geo.attributes.uv;
    if (uvAttr && uvAttr.count > 0) {
        let uMin = Infinity, uMax = -Infinity;
        let vMin = Infinity, vMax = -Infinity;
        for (let i = 0; i < uvAttr.count; i++) {
            const u = uvAttr.getX(i);
            const v = uvAttr.getY(i);
            if (u < uMin) uMin = u;
            if (u > uMax) uMax = u;
            if (v < vMin) vMin = v;
            if (v > vMax) vMax = v;
        }
        const uvW = uMax - uMin;
        const uvH = vMax - vMin;
        if (uvW > 0.001 && uvH > 0.001) {
            return uvW / uvH;
        }
    }

    // Fallback: local bounding box X vs Y (ignores Z depth and world rotation)
    if (!geo.boundingBox) geo.computeBoundingBox();
    const s = new THREE.Vector3();
    geo.boundingBox.getSize(s);
    if (Math.abs(s.x) > 0.001 && Math.abs(s.y) > 0.001) {
        return Math.abs(s.x) / Math.abs(s.y);
    }

    return 1.0; // absolute fallback: square
}

/* ─── Apply Image to Frame Helper ─────────────────────────────────────────── */
function applyImageToFrame(mesh, image) {
    let material = artworkMaterials.get(image.src);
    if (!material) {
        const maxSize = isMobile ? 512 : 1024;
        const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
        let source = image;
        if (scale < 1) {
            source = document.createElement('canvas');
            source.width = Math.max(1, Math.round(image.naturalWidth * scale));
            source.height = Math.max(1, Math.round(image.naturalHeight * scale));
            source.getContext('2d').drawImage(image, 0, 0, source.width, source.height);
        }
        const texture = new THREE.Texture(source);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        texture.generateMipmaps = !isLowEnd;
        texture.minFilter = isLowEnd ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
        texture.needsUpdate = true;
        material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: true });
        artworkMaterials.set(image.src, material);
    }

    // Crop each frame's own UVs so repeated pictures share one GPU texture.
    const frameAspect = getFrameAspect(mesh);
    const imageAspect = image.naturalWidth / image.naturalHeight;
    const visibleWidth = Math.min(1, frameAspect / imageAspect);
    const visibleHeight = Math.min(1, imageAspect / frameAspect);
    const uv = mesh.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (1 - visibleWidth) / 2 + uv.getX(i) * visibleWidth,
            (1 - visibleHeight) / 2 + uv.getY(i) * visibleHeight);
    }
    uv.needsUpdate = true;
    mesh.material = material;
}

function disposeUnusedMaterials(model, originals) {
    const usedMaterials = new Set();
    const usedTextures = new Set();
    const textures = material => Object.values(material).filter(value => value?.isTexture);
    model.traverse(object => {
        if (!object.isMesh) return;
        for (const material of [].concat(object.material)) {
            usedMaterials.add(material);
            textures(material).forEach(texture => usedTextures.add(texture));
        }
    });
    const disposedTextures = new Set();
    for (const material of originals) {
        if (usedMaterials.has(material)) continue;
        for (const texture of textures(material)) {
            if (!usedTextures.has(texture) && !disposedTextures.has(texture)) {
                texture.dispose();
                disposedTextures.add(texture);
            }
        }
        material.dispose();
    }
}

/* ─── DRACO + GLTF Loader ─────────────────────────────────────────────────── */
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(new URL('../vendor/three-0.160.0/draco/', import.meta.url).href);
dracoLoader.setWorkerLimit(2);

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

/* ─── Helper: update camera aspect + mobile zoom ─────────────────────────── */
function updateCamera(cam, isScrollCamera = false) {
    if (!cam || !cam.isPerspectiveCamera) return;
    const aspect = window.innerWidth / window.innerHeight;
    cam.aspect = aspect;

    if (isScrollCamera) {
        // Widen view on portrait/mobile so sides aren't cut off (0.5 zoom as requested)
        const isPortrait = aspect < 1 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        cam.zoom = isPortrait ? 0.5 : 1.0;
    } else {
        // Starting camera (intro view)
        const isPortrait = aspect < 1 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isPortrait) {
            // Match exactly 1080x1920 (9:16) framing on mobile!
            const targetAspect = 1080 / 1920;
            // If screen is narrower than 9:16, zoom out to fit the sides perfectly
            let calculatedZoom = aspect < targetAspect ? (aspect / targetAspect) : 1.0;
            // Zoom out nang konti para mas lumawak yung view (25% wider)
            cam.zoom = calculatedZoom * 0.65;
        } else {
            cam.zoom = 0.6; // Desktop wide view
        }
    }
    cam.updateProjectionMatrix();
}

/* ─── Helper: scrub all actions to a specific time ───────────────────────── */
function setTimeline(time) {
    allActions.forEach(action => {
        action.time = Math.min(time, action.getClip().duration);
    });
    if (mixer) mixer.update(0);
}

/* ─── Load GLB ────────────────────────────────────────────────────────────── */
gltfLoader.load(
    new URL('../assets/models/yay.glb', import.meta.url).href,
    async (gltf) => {
        dracoLoader.dispose(); // Decoding is complete; release worker threads.
        const model = gltf.scene;
        const originalMaterials = new Set();
        model.traverse(object => {
            if (object.isMesh) [].concat(object.material).forEach(material => originalMaterials.add(material));
        });
        scene.add(model);

        /* ── Cameras ── */
        if (gltf.cameras && gltf.cameras.length > 0) {
            // Sort cameras alphabetically as fallback, but prefer names
            const sortedCams = [...gltf.cameras].sort((a, b) => a.name.localeCompare(b.name));

            // Try to identify cameras by common names
            camera1 = sortedCams.find(c => c.name.toLowerCase().match(/intro|cam1|camera1|first/)) || sortedCams[0];
            activeCamera = camera1;

            if (sortedCams.length > 1) {
                camera2 = sortedCams.find(c => c !== camera1 && c.name.toLowerCase().match(/scroll|cam2|camera2|second/))
                    || sortedCams.find(c => c !== camera1);
                updateCamera(camera2, true);
            }

            updateCamera(activeCamera, false);
            console.log('Cameras detected:', gltf.cameras.map(c => c.name));
        }

        /* ── Animations ── */
        if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(model);

            gltf.animations.forEach(clip => {
                const action = mixer.clipAction(clip);
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
                action.play();
                action.paused = true;
                allActions.push(action);
            });

            // Intelligently find intro duration:
            // Usually intro is the shorter clip, scroll is the longer clip.
            const durs = gltf.animations.map(c => c.duration).sort((a, b) => a - b);

            // If they have distinct names, use them:
            const introClip = gltf.animations.find(a => a.name.toLowerCase().includes('intro'));
            if (introClip) {
                window.introDuration = introClip.duration;
            } else {
                // Assume the shortest animation (that is > 0) is the intro
                window.introDuration = durs.find(d => d > 0.1) || durs[0];
            }

            window.maxDuration = durs[durs.length - 1];

            console.log('Animations:', gltf.animations.map(a => `${a.name}(${a.duration.toFixed(2)}s)`));
            console.log('Selected Intro dur:', window.introDuration, '| Max dur:', window.maxDuration);
            setTimeline(0);
        }

        /* ── Collect picture frames (frame_1 … frame_36) ── */
        model.traverse(obj => {
            if (!obj.isMesh) return;
            const name = obj.name || '';
            // Include all Blender duplicate frame names.
            if (isPictureFrame(name)) {
                /* ── Create custom code-generated plane based on anchor ── */
                const match = name.match(/\d+/);
                const frameNum = match ? parseInt(match[0], 10) : -1;

                obj.geometry.computeBoundingBox();
                const size = new THREE.Vector3();
                obj.geometry.boundingBox.getSize(size);
                const center = new THREE.Vector3();
                obj.geometry.boundingBox.getCenter(center);

                let w = size.x, h = size.y;
                let isXZ = false, isYZ = false;

                // Find the flattest dimension to assume it's the depth
                if (size.z < size.x && size.z < size.y) {
                    w = size.x; h = size.y;
                } else if (size.y < size.x && size.y < size.z) {
                    w = size.x; h = size.z;
                    isXZ = true;
                } else {
                    w = size.z; h = size.y;
                    isYZ = true;
                }

                if (w === 0) w = 0.1;
                if (h === 0) h = 0.1;

                const newGeo = new THREE.PlaneGeometry(w, h);
                if (isXZ) newGeo.rotateX(-Math.PI / 2);
                else if (isYZ) newGeo.rotateY(Math.PI / 2);

                newGeo.translate(center.x, center.y, center.z);

                const worldScale = new THREE.Vector3();
                obj.getWorldScale(worldScale);
                let trueW = w * worldScale.x;
                let trueH = h * worldScale.y;
                if (isXZ) trueH = h * worldScale.z;
                if (isYZ) { trueW = w * worldScale.z; trueH = h * worldScale.y; }

                // Adjust UVs
                const uv = newGeo.attributes.uv;
                for (let i = 0; i < uv.count; i++) {
                    let u = uv.getX(i);
                    let v = uv.getY(i);

                    if (frameNum === 36) {
                        // For frame 36, head is on right, rotate UVs 90 deg CW
                        u -= 0.5;
                        v -= 0.5;
                        uv.setXY(i, v + 0.5, -u + 0.5);
                    } else {
                        // Standard GLTF behavior: invert V
                        uv.setXY(i, u, 1.0 - v);
                    }
                }
                uv.needsUpdate = true;

                const oldGeo = obj.geometry; // Capture before replacing
                obj.geometry = newGeo;
                oldGeo.dispose();             // Free original GLB geometry from GPU

                if (frameNum === 36) {
                    obj.userData.aspectRatio = trueH / trueW; // swapped because we rotated UVs
                } else {
                    obj.userData.aspectRatio = trueW / trueH;
                }
                /* ──────────────────────────────────────────────────────── */

                frameMeshes.push(obj);
                obj.userData.frameName = name;

                // Preserve double-sided visibility until artwork is applied.
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(mat => {
                    if (mat.roughness != null) mat.roughness = Math.min(mat.roughness, 0.4);
                    // DoubleSide ensures it's visible even if anchor normals were inverted
                    mat.side = THREE.DoubleSide;
                    mat.needsUpdate = true;
                });
            }
        });
        console.log(`Found ${frameMeshes.length} picture frames`);

        // Load each unique WebP once, then repeat the collection across 36 frames.
        try {
            const { images, error } = await galleryImagesPromise;
            if (error) throw error;
            frameMeshes.forEach((mesh, index) => {
                applyImageToFrame(mesh, images[index % images.length]);
            });
        } catch (error) {
            console.error('Gallery image load error:', error);
            document.getElementById('loading-text').textContent = 'Could not load gallery pictures. Please reload.';
            return;
        }
        disposeUnusedMaterials(model, originalMaterials);
        galleryReady = true;
        requestRender();
        window.dispatchEvent(new Event('gallery-ready'));

        // After loading: slide model in from below + fade in hero UI
        const loadingEl = document.getElementById('loading');
        if (loadingEl) {
            loadingEl.style.opacity = '0';
            loadingEl.style.transition = 'opacity 0.6s ease';
            setTimeout(() => {
                loadingEl.remove();
                const startHint = document.getElementById('start-hint');
                if (startHint) startHint.hidden = false;
            }, 600);
        }

        // Sequence: 1. Text fades in first, 2. Model slides up after text is visible
        window.entryOffsetY = -16; // Start even lower for a more dramatic entrance
        window.entrySlideUpTriggered = false; // Don't animate yet

        // Show hero text shortly after loading finishes
        setTimeout(() => {
            const heroUi = document.getElementById('hero-ui');
            if (heroUi) heroUi.classList.add('show');
        }, 500);

        // Slide the 3D model up ONLY after the text has faded in (e.g. 1.8s delay)
        setTimeout(() => {
            window.entrySlideUpTriggered = true;
            requestRender();
        }, 1600);
    },
    (xhr) => {
        const percent = xhr.total > 0 ? Math.round((xhr.loaded / xhr.total) * 100) : 0;
        const textEl = document.getElementById('loading-text');
        const barEl = document.getElementById('loading-bar-fill');
        if (textEl) textEl.innerText = `Loading... ${percent}%`;
        if (barEl) barEl.style.width = percent + '%';
    },
    (error) => {
        console.error('GLB load error:', error);
        const textEl = document.getElementById('loading-text');
        if (textEl) textEl.innerText = 'Error loading model!';
    }
);

/* ─── Intro Lights (Golden Hour — removed when entering scroll mode) ────────── */
const introAmbient = new THREE.AmbientLight(0xffd6a0, 1.2);  // warm peachy golden
const introSun = new THREE.DirectionalLight(0xff9e4a, 3.5);   // deep orange sun
introSun.position.set(-8, 12, 6);                              // coming from upper-left
const introFill = new THREE.HemisphereLight(0xffe0b2, 0x8b6914, 0.6); // sky/ground fill
scene.add(introAmbient, introSun, introFill);
let introLightsActive = true;

function removeIntroLights() {
    if (!introLightsActive) return;
    introLightsActive = false;
    scene.remove(introAmbient, introSun, introFill);
    // Dispose light targets to free any GPU memory
    introSun.dispose?.();
}

// Click or tap starts the intro; frames are display-only.
renderer.domElement.addEventListener('click', startIntro);
renderer.domElement.addEventListener('touchstart', startIntro, { passive: true });

/* ─── Key press → start intro ────────────────────────────────────────────── */
function startIntro() {
    if (galleryReady && appState === 'waiting') {
        appState = 'playing_intro';
        clock.getDelta(); // drain any accumulated delta from waiting
        window.dispatchEvent(new Event('gallery-start'));
        requestRender();
    }
}

document.getElementById('start-hint')?.addEventListener('click', startIntro);
window.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' || event.ctrlKey || event.metaKey || event.altKey ||
        event.target.closest('a, button')) return;
    startIntro();
});

/* ─── Scroll listener ─────────────────────────────────────────────────────── */
window.addEventListener('scroll', () => {
    if (appState !== 'scroll_mode') return;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll > 0) {
        scrollProgress = window.scrollY / maxScroll;
        // Map 0% scroll to introDuration, 100% scroll to maxDuration
        targetTimeline = window.introDuration + scrollProgress * (window.maxDuration - window.introDuration);
        requestRender();
    }
}, { passive: true });

/* ─── Resize ──────────────────────────────────────────────────────────────── */
window.addEventListener('resize', () => {
    requestRender();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isLowEnd ? 1.0 : isMobile ? 1.5 : 2));
    updateCamera(camera1, false);
    updateCamera(camera2, true);
    // Sync activeCamera aspect manually if it wasn't camera1 or camera2 (though it should be)
    if (activeCamera && activeCamera !== camera1 && activeCamera !== camera2) {
        updateCamera(activeCamera, false);
    }
});

/* ─── Animation Loop ──────────────────────────────────────────────────────── */
const clock = new THREE.Clock();
let animationFrame = null;

function scheduleFrame() {
    if (isTabVisible && animationFrame === null) animationFrame = requestAnimationFrame(animate);
}

function requestRender() {
    // Restart damping with a fresh delta after the renderer has been idle.
    if (animationFrame === null) clock.getDelta();
    scheduleFrame();
}

function animate() {
    animationFrame = null;

    // Skip rendering when tab is hidden — saves battery and CPU on low-end devices
    if (!isTabVisible) return;

    const dt = Math.min(clock.getDelta(), 0.05); // cap delta to avoid huge jumps

    // Floating effect for the entire 3D model on the first cam
    if (appState === 'waiting') {
        scene.position.y = Math.sin(performance.now() * 0.0012) * 0.35;
    } else {
        // Entrance slide animation logic
        if (typeof window.entryOffsetY !== 'undefined' && window.entryOffsetY < 0 && window.entrySlideUpTriggered) {
            // Smoothly lerp entry offset to 0 (slower multiplier = smoother glide)
            window.entryOffsetY = THREE.MathUtils.lerp(window.entryOffsetY, 0, dt * 2.2);
            if (Math.abs(window.entryOffsetY) < 0.02) window.entryOffsetY = 0;
            scene.position.y = window.entryOffsetY;
        } else if (window.entryOffsetY >= 0) {
            // After entry is finished, allow internal logic to take over (e.g. scroll modes)
            scene.position.y = 0;
        }
    }

    if (mixer) {
        if (appState === 'playing_intro') {
            introTime += dt;
            const clampedTime = Math.min(introTime, window.introDuration);

            setTimeline(clampedTime);

            // Trigger white flash 0.5s before intro ends
            if (introTime >= window.introDuration - 0.5 && !hasFlashed) {
                hasFlashed = true;
                document.getElementById('white-flash').style.opacity = '1';
            }

            // Intro done → switch to Camera 2 + scroll mode
            if (introTime >= window.introDuration) {
                appState = 'scroll_mode';
                activeCamera = camera2 || camera1;

                // ── Cleanup: remove intro-only elements to free GPU/VRAM ──
                removeIntroLights();

                // Fade out hero-bg (masonry images) and hero-ui (text)
                const heroBg = document.getElementById('hero-bg');
                const heroUi = document.getElementById('hero-ui');
                if (heroBg) {
                    heroBg.style.transition = 'opacity 0.8s ease';
                    heroBg.style.opacity = '0';
                    setTimeout(() => heroBg.remove(), 900);
                }
                if (heroUi) {
                    heroUi.style.transition = 'opacity 0.6s ease';
                    heroUi.style.opacity = '0';
                    setTimeout(() => heroUi.remove(), 700);
                }

                // Completely unlock scrolling using CSS class
                document.documentElement.classList.add('scrollable');

                const sc = document.getElementById('scroll-container');
                if (sc) sc.style.display = 'block';

                setTimeout(() => {
                    document.getElementById('white-flash').style.opacity = '0';
                }, 100);

                // Reset scroll/timeline to start of Camera 2 view (starts after intro)
                scrollProgress = 0;
                targetTimeline = window.introDuration;
                smoothTimeline = window.introDuration;
                setTimeline(window.introDuration);
            }
        }
        else if (appState === 'scroll_mode') {
            // Exponential damping — frame-rate independent and feels natural
            const alpha = 1 - Math.exp(-SCROLL_DAMP * dt);
            smoothTimeline += (targetTimeline - smoothTimeline) * alpha;
            if (Math.abs(targetTimeline - smoothTimeline) < 0.001) smoothTimeline = targetTimeline;
            setTimeline(smoothTimeline);
        }
    }

    renderer.render(scene, activeCamera);
    const cameraMoving = appState === 'scroll_mode' && smoothTimeline !== targetTimeline;
    const entryMoving = window.entrySlideUpTriggered && window.entryOffsetY < 0;
    if ((galleryReady && appState === 'waiting') || appState === 'playing_intro' || cameraMoving || entryMoving) {
        scheduleFrame();
    }
}
animate();
