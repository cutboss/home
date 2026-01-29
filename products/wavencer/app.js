/**
 * Wavencer - Core Application Logic (Bulk Processing version)
 */

let audioContext = null;
let selectedFiles = [];

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileListContainer = document.getElementById('file-list-container');
const fileSummary = document.getElementById('file-summary');
const fileList = document.getElementById('file-list');
const processBtn = document.getElementById('process-btn');
const downloadLink = document.getElementById('download-link');
const statusMsg = document.getElementById('status-msg');
const startSilenceInput = document.getElementById('start-silence');
const endSilenceInput = document.getElementById('end-silence');
const ignoreNoiseCheckbox = document.getElementById('ignore-noise');

const progressContainer = document.getElementById('progress-container');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressText = document.getElementById('progress-text');

const STORAGE_KEY = 'wavencer_settings';

// Initialization
function init() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    loadSettings();

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', handleDrop);

    fileInput.addEventListener('change', handleFileSelect);
    processBtn.addEventListener('click', processFiles);

    // Persistence listeners
    startSilenceInput.addEventListener('input', saveSettings);
    endSilenceInput.addEventListener('input', saveSettings);
    ignoreNoiseCheckbox.addEventListener('change', saveSettings);
}

function loadSettings() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const settings = JSON.parse(saved);
            if (settings.startSilence !== undefined) startSilenceInput.value = settings.startSilence;
            if (settings.endSilence !== undefined) endSilenceInput.value = settings.endSilence;
            if (settings.ignoreNoise !== undefined) ignoreNoiseCheckbox.checked = settings.ignoreNoise;
        } catch (e) {
            console.error('Error loading settings', e);
        }
    }
}

function saveSettings() {
    const settings = {
        startSilence: startSilenceInput.value,
        endSilence: endSilenceInput.value,
        ignoreNoise: ignoreNoiseCheckbox.checked
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function handleDrop(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.wav'));
    if (files.length > 0) handleFiles(files);
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files).filter(f => f.name.toLowerCase().endsWith('.wav'));
    if (files.length > 0) handleFiles(files);
}

function handleFiles(files) {
    selectedFiles = files;
    updateFileList();

    processBtn.disabled = selectedFiles.length === 0;
    downloadLink.classList.add('hidden');
    progressContainer.classList.add('hidden');
    updateStatus(`${selectedFiles.length} files selected.`);
}

function updateFileList() {
    if (selectedFiles.length === 0) {
        fileListContainer.classList.add('hidden');
        return;
    }

    fileListContainer.classList.remove('hidden');
    fileSummary.textContent = `Selected: ${selectedFiles.length} files`;
    fileList.innerHTML = '';

    // Show all files
    selectedFiles.forEach(file => {
        const li = document.createElement('li');
        li.textContent = file.name;
        fileList.appendChild(li);
    });
}

async function processFiles() {
    if (selectedFiles.length === 0) return;

    const startMs = parseInt(startSilenceInput.value) || 0;
    const endMs = parseInt(endSilenceInput.value) || 0;
    const ignoreNoise = ignoreNoiseCheckbox.checked;
    const linearThreshold = ignoreNoise ? 0.004 : 0.0001;

    updateStatus('Processing files...');
    processBtn.disabled = true;
    progressContainer.classList.remove('hidden');
    downloadLink.classList.add('hidden');

    const zip = selectedFiles.length > 1 ? new JSZip() : null;
    let singleBlob = null;
    let singleFileName = "";

    for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];

        // Progress update
        const progress = ((i / selectedFiles.length) * 100).toFixed(0);
        progressBarFill.style.width = `${progress}%`;
        progressText.textContent = `Processing: ${i + 1} / ${selectedFiles.length} (${file.name})`;

        try {
            const arrayBuffer = await file.arrayBuffer();
            let sourceBuffer = await audioContext.decodeAudioData(arrayBuffer);

            const sampleRate = sourceBuffer.sampleRate;
            const numChannels = sourceBuffer.numberOfChannels;

            // 1. Detect signal bounds
            const bounds = detectSignalBounds(sourceBuffer, linearThreshold);
            const signalLength = bounds.end - bounds.start + 1;

            // 2. Calculate required silence in samples
            const startSilenceSamples = Math.floor((startMs / 1000) * sampleRate);
            const endSilenceSamples = Math.floor((endMs / 1000) * sampleRate);

            const newTotalLength = startSilenceSamples + signalLength + endSilenceSamples;

            // 3. Create new AudioBuffer
            const newBuffer = audioContext.createBuffer(numChannels, newTotalLength, sampleRate);

            for (let c = 0; c < numChannels; c++) {
                const oldData = sourceBuffer.getChannelData(c);
                const newData = newBuffer.getChannelData(c);
                for (let j = 0; j < signalLength; j++) {
                    newData[startSilenceSamples + j] = oldData[bounds.start + j];
                }
            }

            // Clear reference to old buffer
            sourceBuffer = null;

            // 4. Encode to WAV
            const wavBlob = encodeWAV(newBuffer);

            if (zip) {
                zip.file(file.name, wavBlob);
            } else {
                singleBlob = wavBlob;
                singleFileName = file.name;
            }

            // Small delay to allow GC and UI updates
            await new Promise(r => setTimeout(r, 0));
        } catch (err) {
            console.error(`Error processing ${file.name}:`, err);
            updateStatus(`Error processing ${file.name}`, true);
        }
    }

    progressBarFill.style.width = '100%';
    updateStatus('Finalizing...');

    let finalBlob;
    let finalFileName;

    if (zip) {
        finalBlob = await zip.generateAsync({ type: 'blob' });
        finalFileName = 'my_wavs.zip';
    } else {
        finalBlob = singleBlob;
        finalFileName = singleFileName;
    }

    const url = URL.createObjectURL(finalBlob);
    downloadLink.href = url;
    downloadLink.download = finalFileName;
    downloadLink.classList.remove('hidden');
    downloadLink.textContent = zip ? 'Download ZIP Package' : 'Download WAV File';

    updateStatus('Processing complete!');
    progressContainer.classList.add('hidden');
    processBtn.disabled = false;
}

function updateStatus(msg, isError = false) {
    statusMsg.textContent = msg;
    statusMsg.style.color = isError ? '#ef4444' : '#94a3b8';
}

document.addEventListener('DOMContentLoaded', init);
