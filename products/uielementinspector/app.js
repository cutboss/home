/**
 * UI Element Inspector - Core Logic
 * Powered by OpenCV.js
 */

const state = {
    imageLoaded: false,
    cvReady: false,
    originalMat: null,
    detectedElements: [],
    dpr: 1.0
};

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const analyzeBtn = document.getElementById('analyze-btn');
const imageCanvas = document.getElementById('image-canvas');
const overlayCanvas = document.getElementById('overlay-canvas');
const dprInput = document.getElementById('dpr-input');
const loadingOverlay = document.getElementById('loading-overlay');

// 1. Initial Setup & OpenCV Loading
window.onOpenCvReady = () => {
    console.log('OpenCV.js is ready.');
    state.cvReady = true;
    checkState();
};

// Check if cv is already loaded (async script might finish before this script runs)
if (typeof cv !== 'undefined') {
    window.onOpenCvReady();
} else {
    // If not ready, wait for it
    const checkCV = setInterval(() => {
        if (typeof cv !== 'undefined' && cv.Mat) {
            clearInterval(checkCV);
            window.onOpenCvReady();
        }
    }, 100);
}

function checkState() {
    analyzeBtn.disabled = !(state.imageLoaded && state.cvReady);
}

// Initialize DPR from LocalStorage
const savedDPR = localStorage.getItem('element-analyzer-dpr');
if (savedDPR) {
    state.dpr = parseFloat(savedDPR);
    dprInput.value = state.dpr;
}

// 2. Event Listeners
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
        handleImageUpload(file);
    }
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleImageUpload(file);
});

analyzeBtn.addEventListener('click', analyzeImage);

dprInput.addEventListener('change', (e) => {
    state.dpr = parseFloat(e.target.value) || 1.0;
    localStorage.setItem('element-analyzer-dpr', state.dpr);
    if (state.detectedElements.length > 0) {
        renderResults(); // Re-render with new DPR if we have results
    }
});

// 3. Image Handling
function handleImageUpload(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            setupCanvases(img);
            state.imageLoaded = true;
            checkState();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function setupCanvases(img) {
    const ctx = imageCanvas.getContext('2d');
    imageCanvas.width = img.width;
    imageCanvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    overlayCanvas.width = img.width;
    overlayCanvas.height = img.height;

    // Convert canvas to OpenCV Mat
    if (state.originalMat) state.originalMat.delete();
    state.originalMat = cv.imread(imageCanvas);
}

// 4. Core Analysis Logic (OpenCV Processing)
async function analyzeImage() {
    if (!state.cvReady || !state.originalMat) {
        console.warn("Analysis skipped: OpenCV not ready or No image mat.");
        return;
    }

    toggleLoading(true);

    // Allow UI to render loading state
    await new Promise(r => setTimeout(r, 100));

    try {
        const src = state.originalMat.clone();
        const gray = new cv.Mat();
        const binary = new cv.Mat();
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();

        // 4.1 Preprocessing
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        // 4.2 Thresholding
        cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        // 4.3 Text Grouping Morphology (Aggressively horizontal)
        const kernelSize = new cv.Size(18, 3);
        const M = cv.getStructuringElement(cv.MORPH_RECT, kernelSize);
        const anchor = new cv.Point(-1, -1);
        cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, M, anchor, 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());

        // 4.4 Contour Detection
        cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        const minArea = 200; // Hardcoded noise threshold (sensible default)
        let rawElements = [];

        for (let i = 0; i < contours.size(); ++i) {
            const cnt = contours.get(i);
            const rect = cv.boundingRect(cnt);
            const area = rect.width * rect.height;

            if (area > minArea && rect.width > 3 && rect.height > 3) {
                rawElements.push({
                    x: rect.x,
                    y: rect.y,
                    w: rect.width,
                    h: rect.height,
                    area: area
                });
            }
        }

        // 4.5 Bounding Box Merging (Group close elements)
        state.detectedElements = mergeBoundingBoxes(rawElements).map((el, index) => ({
            ...el,
            id: index + 1,
            type: estimateType(el)
        }));

        renderResults();

        // Cleanup
        src.delete(); gray.delete(); binary.delete(); contours.delete(); hierarchy.delete(); M.delete();
    } catch (err) {
        let errMsg = "An error occurred during image analysis.";
        if (typeof err === "number") {
            const cvErr = cv.exceptionFromPtr(err);
            errMsg += ` (OpenCV Error: ${cvErr.msg})`;
            console.error("OpenCV exception:", cvErr);
        } else {
            errMsg += ` (${err.message || err})`;
            console.error("Analysis error:", err);
        }
        alert(errMsg);
    } finally {
        toggleLoading(false);
    }
}

/**
 * Merges overlapping or very close bounding boxes
 */
function mergeBoundingBoxes(rects) {
    if (rects.length === 0) return [];

    // Sort by X position to optimize merging
    rects.sort((a, b) => a.x - b.x);

    let merged = [];
    let used = new Set();

    for (let i = 0; i < rects.length; i++) {
        if (used.has(i)) continue;

        let current = { ...rects[i] };
        used.add(i);

        let expanded = true;
        while (expanded) {
            expanded = false;
            for (let j = 0; j < rects.length; j++) {
                if (used.has(j)) continue;

                const r2 = rects[j];

                // Threshold for merging (horizontal and vertical pixels)
                // We use a larger horizontal gap to group text words/lines
                const marginX = 12;
                const marginY = 4;

                const overlapX = (current.x <= r2.x + r2.w + marginX) && (r2.x <= current.x + current.w + marginX);
                const overlapY = (current.y <= r2.y + r2.h + marginY) && (r2.y <= current.y + current.h + marginY);

                if (overlapX && overlapY) {
                    const x1 = Math.min(current.x, r2.x);
                    const y1 = Math.min(current.y, r2.y);
                    const x2 = Math.max(current.x + current.w, r2.x + r2.w);
                    const y2 = Math.max(current.y + current.h, r2.y + r2.h);

                    current.x = x1;
                    current.y = y1;
                    current.w = x2 - x1;
                    current.h = y2 - y1;
                    current.area = current.w * current.h;

                    used.add(j);
                    expanded = true;
                }
            }
        }
        merged.push(current);
    }

    return merged;
}

function estimateType(rect) {
    const ratio = rect.width / rect.height;
    if (ratio > 2 && rect.height < 100) return 'Button / Field';
    if (rect.width > 200 && rect.height > 100) return 'Card / Container';
    if (Math.abs(1 - ratio) < 0.2 && rect.width < 100) return 'Icon / Avatar';
    return 'Element';
}

// 5. UI Rendering
function renderResults() {
    // Clear canvases
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    state.detectedElements.forEach(el => {
        // Draw Overlay (Premium glass look)
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeRect(el.x, el.y, el.w, el.h);

        // Draw Dimensions Label
        ctx.fillStyle = '#6366f1';
        const displayW = Math.round(el.w / state.dpr);
        const displayH = Math.round(el.h / state.dpr);
        const label = `${displayW}x${displayH}`;
        ctx.font = '10px Inter, sans-serif';
        const textWidth = ctx.measureText(label).width;

        ctx.fillRect(el.x, el.y - 14, textWidth + 6, 14);
        ctx.fillStyle = 'white';
        ctx.fillText(label, el.x + 3, el.y - 4);

        // Draw Distances to neighbors
        drawDistances(ctx, el, state.detectedElements);
    });
}

function highlightElement(el, active) {
    const ctx = overlayCanvas.getContext('2d');
    if (active) {
        ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
        ctx.fillRect(el.x, el.y, el.w, el.h);
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#6366f1';
        ctx.strokeRect(el.x, el.y, el.w, el.h);
    } else {
        ctx.shadowBlur = 0;
        renderResults(); // redraw all to clear highlight
    }
}

/**
 * Draws distances between the current element and its closest neighbors (right and bottom),
 * and also to the screen edges if the element is outermost.
 */
function drawDistances(ctx, el, allElements) {
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = '#ff7e33'; // Contrast color for distances
    ctx.strokeStyle = '#ff7e33';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;

    const canvasWidth = overlayCanvas.width;
    const canvasHeight = overlayCanvas.height;

    // --- 1. Horizontal Distances ---
    let rightNeighbor = null;
    let minRightDist = Infinity;
    let leftNeighbor = null;
    let minLeftDist = Infinity;

    allElements.forEach(other => {
        if (other === el) return;

        const vOverlap = Math.max(el.y, other.y) < Math.min(el.y + el.h, other.y + other.h);
        if (!vOverlap) return;

        // Neighbor to the right
        if (other.x >= el.x + el.w) {
            const dist = other.x - (el.x + el.w);
            if (dist < minRightDist) {
                minRightDist = dist;
                rightNeighbor = other;
            }
        }
        // Neighbor to the left
        if (other.x + other.w <= el.x) {
            const dist = el.x - (other.x + other.w);
            if (dist < minLeftDist) {
                minLeftDist = dist;
                leftNeighbor = other;
            }
        }
    });

    // Draw Right distance
    if (rightNeighbor && minRightDist < 500) {
        const yCoord = Math.max(el.y, rightNeighbor.y) + Math.min(el.h, rightNeighbor.h) / 2;
        drawLineWithLabel(ctx, el.x + el.w, yCoord, rightNeighbor.x, yCoord, `${Math.round(minRightDist)}`);
    } else if (!rightNeighbor) {
        // Outermost Right
        const yCoord = el.y + el.h / 2;
        drawLineWithLabel(ctx, el.x + el.w, yCoord, canvasWidth, yCoord, `${Math.round(canvasWidth - (el.x + el.w))}`);
    }

    // Draw Left distance (only if outermost to avoid double lines)
    if (!leftNeighbor) {
        const yCoord = el.y + el.h / 2;
        drawLineWithLabel(ctx, 0, yCoord, el.x, yCoord, `${Math.round(el.x)}`);
    }

    // --- 2. Vertical Distances ---
    let bottomNeighbor = null;
    let minBottomDist = Infinity;
    let topNeighbor = null;
    let minTopDist = Infinity;

    allElements.forEach(other => {
        if (other === el) return;

        const hOverlap = Math.max(el.x, other.x) < Math.min(el.x + el.w, other.x + other.w);
        if (!hOverlap) return;

        // Neighbor below
        if (other.y >= el.y + el.h) {
            const dist = other.y - (el.y + el.h);
            if (dist < minBottomDist) {
                minBottomDist = dist;
                bottomNeighbor = other;
            }
        }
        // Neighbor above
        if (other.y + other.h <= el.y) {
            const dist = el.y - (other.y + other.h);
            if (dist < minTopDist) {
                minTopDist = dist;
                topNeighbor = other;
            }
        }
    });

    // Draw Bottom distance
    if (bottomNeighbor && minBottomDist < 500) {
        const xCoord = Math.max(el.x, bottomNeighbor.x) + Math.min(el.w, bottomNeighbor.w) / 2;
        drawLineWithLabelVertical(ctx, xCoord, el.y + el.h, xCoord, bottomNeighbor.y, `${Math.round(minBottomDist)}`);
    } else if (!bottomNeighbor) {
        const xCoord = el.x + el.w / 2;
        drawLineWithLabelVertical(ctx, xCoord, el.y + el.h, xCoord, canvasHeight, `${Math.round(canvasHeight - (el.y + el.h))}`);
    }

    // Draw Top distance (only if outermost)
    if (!topNeighbor) {
        const xCoord = el.x + el.w / 2;
        drawLineWithLabelVertical(ctx, xCoord, 0, xCoord, el.y, `${Math.round(el.y)}`);
    }
}

function drawLineWithLabel(ctx, x1, y1, x2, y2, label) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const displayVal = Math.round(parseFloat(label) / state.dpr);
    const scaledLabel = `${displayVal}`;
    const labelWidth = ctx.measureText(scaledLabel).width;
    ctx.fillText(scaledLabel, x1 + (x2 - x1 - labelWidth) / 2, y1 - 4);
}

function drawLineWithLabelVertical(ctx, x1, y1, x2, y2, label) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const displayVal = Math.round(parseFloat(label) / state.dpr);
    const scaledLabel = `${displayVal}`;

    ctx.save();
    ctx.translate(x1 + 12, y1 + (y2 - y1) / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(scaledLabel, 0, 0);
    ctx.restore();
}

function toggleLoading(show) {
    loadingOverlay.classList.toggle('hidden', !show);
    analyzeBtn.textContent = show ? 'Processing...' : 'Analyze UI Elements';
    analyzeBtn.disabled = show;
}
