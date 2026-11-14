// Stable order: all 25 pictures appear before the remaining frames repeat.
export const artworkFiles = [
    'art.webp', 'art1.webp', 'art2.webp', 'art3.webp', 'art5.webp',
    'art6.webp', 'rt4.webp', 'artic.webp', 'ascend.webp', 'bruno.webp',
    'car.webp', 'cat.webp', 'jb.webp', 'joji.webp', 'la.webp',
    'mask.webp', 'meoww.webp', 'onep.webp', 'punk.webp', 'queen.webp',
    'rap.webp', 'shark.webp', 'spidey.webp', 'tri.webp', 'up.webp',
];

// Blender duplicates use .001; GLTFLoader also strips dots from node names.
export function isPictureFrame(name) {
    return /^(?:frame|phone)_\d+(?:\.\d+)?$/i.test(name);
}

export function artworkForFrame(index) {
    return new URL(`../assets/images/webp/${artworkFiles[index % artworkFiles.length]}`, import.meta.url).href;
}

export async function loadGalleryImages() {
    return Promise.all(artworkFiles.map((_, index) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load gallery picture: ${artworkFiles[index]}`));
        image.src = artworkForFrame(index);
    })));
}
