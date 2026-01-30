/**
 * Master WAV - Audio Processing Application
 * Vanilla JS Implementation with Real-time Mastering Preview
 */

class AudioProcessor {
    constructor() {
        this.files = [];
        this.isProcessing = false;

        // Real-time Audio Context & Nodes
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.sourceNodes = new Map(); // Store nodes per file ID

        this.lowShelf = this.audioCtx.createBiquadFilter();
        this.highShelf = this.audioCtx.createBiquadFilter();
        this.compressor = this.audioCtx.createDynamicsCompressor();
        this.limiter = this.audioCtx.createDynamicsCompressor(); // Acts as a final limiter for preview
        this.masterGain = this.audioCtx.createGain();

        this.setupRealtimeChain();

        // DOM Elements
        this.dropZone = document.getElementById('drop-zone');
        this.fileInput = document.getElementById('file-input');
        this.fileList = document.getElementById('file-list');
        this.fileCount = document.getElementById('file-count');
        this.processBtn = document.getElementById('process-btn');
        this.clearBtn = document.getElementById('clear-btn');
        this.progressOverlay = document.getElementById('progress-overlay');
        this.progressBar = document.getElementById('progress-bar');
        this.progressText = document.getElementById('progress-text');
        this.progressPercentage = document.getElementById('progress-percentage');
        this.currentFileNameDisplay = document.getElementById('current-file-name');

        this.init();
    }

    setupRealtimeChain() {
        this.lowShelf.type = 'lowshelf';
        this.highShelf.type = 'highshelf';

        // Limiter settings for preview safety
        this.limiter.threshold.value = -1.0;
        this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0.003;

        // Connect chain: Source (dynamic) -> LowShelf -> HighShelf -> Compressor -> Limiter -> MasterGain -> Destination
        this.lowShelf.connect(this.highShelf);
        this.highShelf.connect(this.compressor);
        this.compressor.connect(this.limiter);
        this.limiter.connect(this.masterGain);
        this.masterGain.connect(this.audioCtx.destination);

        this.applyBypass(); // Start in bypass mode
    }

    init() {
        // Event Listeners
        this.dropZone.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));

        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropZone.classList.add('drag-over');
        });

        this.dropZone.addEventListener('dragleave', () => {
            this.dropZone.classList.remove('drag-over');
        });

        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('drag-over');
            this.handleFiles(e.dataTransfer.files);
        });

        this.clearBtn.addEventListener('click', () => this.clearAll());
        this.processBtn.addEventListener('click', () => this.startMastering());

        // Preset Toggle Logic
        let currentActivePreset = document.querySelector('input[name="preset"]:checked')?.value || null;

        document.querySelectorAll('input[name="preset"]').forEach(radio => {
            radio.addEventListener('click', () => {
                if (radio.value === currentActivePreset) {
                    // Clicked the same preset: deselect it
                    radio.checked = false;
                    currentActivePreset = null;
                    this.applyBypass();
                } else {
                    // Clicked a different or new preset: select it
                    currentActivePreset = radio.value;
                    this.applyPreset(radio.value);
                }
                this.updateDownloadButton();
            });
        });

        // Initialize button state
        this.updateDownloadButton();
    }

    updateDownloadButton() {
        const checked = document.querySelector('input[name="preset"]:checked');
        this.processBtn.disabled = !checked || this.files.length === 0;
    }

    applyBypass() {
        this.lowShelf.gain.value = 0;
        this.highShelf.gain.value = 0;
        this.compressor.threshold.value = 0;
        this.compressor.ratio.value = 1;
        this.masterGain.gain.value = 1.0;
    }

    applyPreset(preset) {
        this.applyPresetSettings(preset, this.lowShelf, this.highShelf, this.compressor);
        // Note: Real-time "Normalize" is approximated by the limiter and a slight gain boost if needed.
        // For preview, we mostly care about the tone.
        this.masterGain.gain.value = 1.0;
    }

    handleFiles(fileList) {
        const newFiles = Array.from(fileList).filter(file => file.type === 'audio/wav' || file.name.endsWith('.wav'));

        newFiles.forEach(file => {
            if (!this.files.find(f => f.name === file.name && f.size === file.size)) {
                this.files.push({
                    file: file,
                    name: file.name,
                    id: Math.random().toString(36).substr(2, 9),
                    url: URL.createObjectURL(file)
                });
            }
        });

        this.updateUI();
        this.updateDownloadButton();
    }

    updateUI() {
        this.fileCount.textContent = `(${this.files.length})`;

        if (this.files.length === 0) {
            this.fileList.innerHTML = '<div class="empty-state">No files loaded yet.</div>';
        } else {
            this.fileList.innerHTML = '';
            this.files.forEach(f => {
                const item = document.createElement('div');
                item.className = 'file-item';
                item.innerHTML = `
                    <span class="file-name">${f.name}</span>
                    <audio id="audio-${f.id}" class="audio-player" controls src="${f.url}" crossorigin="anonymous"></audio>
                    <button class="remove-btn" data-id="${f.id}">&times;</button>
                `;
                this.fileList.appendChild(item);

                const audioElement = item.querySelector(`#audio-${f.id}`);

                // Connect audio element to AudioContext for processed playback
                audioElement.addEventListener('play', () => {
                    if (this.audioCtx.state === 'suspended') {
                        this.audioCtx.resume();
                    }
                    this.connectAudioElement(f.id, audioElement);
                });

                item.querySelector('.remove-btn').addEventListener('click', () => this.removeFile(f.id));
            });
        }
    }

    connectAudioElement(id, element) {
        if (!this.sourceNodes.has(id)) {
            const source = this.audioCtx.createMediaElementSource(element);
            source.connect(this.lowShelf);
            this.sourceNodes.set(id, source);
        }
    }

    removeFile(id) {
        const index = this.files.findIndex(f => f.id === id);
        if (index > -1) {
            URL.revokeObjectURL(this.files[index].url);
            this.files.splice(index, 1);
            this.sourceNodes.delete(id);
            this.updateUI();
            this.updateDownloadButton();
        }
    }

    clearAll() {
        this.files.forEach(f => URL.revokeObjectURL(f.url));
        this.files = [];
        this.sourceNodes.clear();
        this.updateUI();
        this.updateDownloadButton();
    }

    async startMastering() {
        if (this.isProcessing || this.files.length === 0) return;

        const checkedPreset = document.querySelector('input[name="preset"]:checked');
        if (!checkedPreset) return;

        this.isProcessing = true;
        const preset = checkedPreset.value;
        const zip = new JSZip();

        this.progressOverlay.classList.remove('hidden');

        try {
            for (let i = 0; i < this.files.length; i++) {
                const fileObj = this.files[i];
                this.updateProgress(i, this.files.length, fileObj.name);

                const arrayBuffer = await fileObj.file.arrayBuffer();
                const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
                const masteredBuffer = await this.applyMastering(audioBuffer, preset);

                this.normalize(masteredBuffer);
                const wavBlob = this.encodeWAV(masteredBuffer);

                if (this.files.length === 1) {
                    this.downloadFile(wavBlob, fileObj.name);
                } else {
                    zip.file(fileObj.name, wavBlob);
                }
            }

            if (this.files.length > 1) {
                const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
                const content = await zip.generateAsync({ type: "blob" });
                this.downloadFile(content, `wavs-${timestamp}.zip`);
            }

        } catch (error) {
            console.error('Mastering error:', error);
            alert('An error occurred during processing: ' + error.message);
        } finally {
            this.isProcessing = false;
            this.progressOverlay.classList.add('hidden');
            this.resetProgress();
        }
    }

    updateProgress(index, total, name) {
        const percentage = Math.round((index / total) * 100);
        this.progressText.textContent = `File ${index + 1} of ${total}`;
        this.progressBar.style.width = `${percentage}%`;
        this.progressPercentage.textContent = `${percentage}%`;
        this.currentFileNameDisplay.textContent = name;
    }

    resetProgress() {
        this.progressBar.style.width = '0%';
        this.progressText.textContent = 'File 0 of 0';
        this.progressPercentage.textContent = '0%';
        this.currentFileNameDisplay.textContent = '';
    }

    async applyMastering(buffer, preset) {
        const offlineCtx = new OfflineAudioContext(
            buffer.numberOfChannels,
            buffer.length,
            buffer.sampleRate
        );

        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;

        const lowShelf = offlineCtx.createBiquadFilter();
        const highShelf = offlineCtx.createBiquadFilter();
        const compressor = offlineCtx.createDynamicsCompressor();

        lowShelf.type = 'lowshelf';
        highShelf.type = 'highshelf';

        this.applyPresetSettings(preset, lowShelf, highShelf, compressor);

        source.connect(lowShelf);
        lowShelf.connect(highShelf);
        highShelf.connect(compressor);
        compressor.connect(offlineCtx.destination);

        source.start();
        return await offlineCtx.startRendering();
    }

    applyPresetSettings(preset, lowShelf, highShelf, compressor) {
        lowShelf.frequency.value = 200;
        highShelf.frequency.value = 5000;

        switch (preset) {
            case 'rock':
                lowShelf.gain.value = 3;
                highShelf.gain.value = 4;
                compressor.threshold.value = -24;
                compressor.ratio.value = 12;
                compressor.attack.value = 0.003;
                compressor.release.value = 0.25;
                break;
            case 'pops':
                lowShelf.gain.value = 2;
                highShelf.gain.value = 3;
                compressor.threshold.value = -18;
                compressor.ratio.value = 4;
                compressor.attack.value = 0.01;
                compressor.release.value = 0.25;
                break;
            case 'electronic':
                lowShelf.frequency.value = 100;
                lowShelf.gain.value = 6;
                highShelf.gain.value = 5;
                compressor.threshold.value = -20;
                compressor.ratio.value = 8;
                compressor.release.value = 0.1;
                break;
            case 'acoustic':
                lowShelf.gain.value = 1;
                highShelf.gain.value = 2;
                compressor.threshold.value = -12;
                compressor.ratio.value = 2;
                compressor.release.value = 0.25;
                break;
            case 'classical':
                lowShelf.gain.value = 0;
                highShelf.gain.value = 0;
                compressor.threshold.value = -6;
                compressor.ratio.value = 1.5;
                compressor.release.value = 0.25;
                break;
            case 'cinema':
                lowShelf.frequency.value = 80;
                lowShelf.gain.value = 4;
                highShelf.gain.value = 3;
                compressor.threshold.value = -15;
                compressor.ratio.value = 4;
                compressor.release.value = 0.25;
                break;
            case 'jazz':
                lowShelf.gain.value = 1;
                highShelf.gain.value = 1;
                compressor.threshold.value = -10;
                compressor.ratio.value = 2;
                compressor.release.value = 0.25;
                break;
        }
    }

    normalize(buffer) {
        const targetPeak = 0.89125; // -1.0dB
        let maxPeak = 0;

        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < data.length; i++) {
                const abs = Math.abs(data[i]);
                if (abs > maxPeak) maxPeak = abs;
            }
        }

        if (maxPeak > 0) {
            const gain = targetPeak / maxPeak;
            for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                const data = buffer.getChannelData(channel);
                for (let i = 0; i < data.length; i++) {
                    data[i] *= gain;
                }
            }
        }
    }

    encodeWAV(buffer) {
        const numOfChan = buffer.numberOfChannels;
        const length = buffer.length * numOfChan * 2 + 44;
        const buffer_wav = new ArrayBuffer(length);
        const view = new DataView(buffer_wav);
        const channels = [];
        let i, sample, offset = 0, pos = 0;

        const setUint16 = (data) => { view.setUint16(pos, data, true); pos += 2; };
        const setUint32 = (data) => { view.setUint32(pos, data, true); pos += 4; };

        setUint32(0x46464952); // "RIFF"
        setUint32(length - 8);
        setUint32(0x45564157); // "WAVE"
        setUint32(0x20746d66); // "fmt "
        setUint32(16);
        setUint16(1);
        setUint16(numOfChan);
        setUint32(buffer.sampleRate);
        setUint32(buffer.sampleRate * 2 * numOfChan);
        setUint16(numOfChan * 2);
        setUint16(16);
        setUint32(0x61746164); // "data"
        setUint32(length - pos - 4);

        for (i = 0; i < buffer.numberOfChannels; i++) {
            channels.push(buffer.getChannelData(i));
        }

        while (pos < length) {
            for (i = 0; i < numOfChan; i++) {
                sample = Math.max(-1, Math.min(1, channels[i][offset]));
                sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF);
                view.setInt16(pos, sample, true);
                pos += 2;
            }
            offset++;
        }

        return new Blob([buffer_wav], { type: 'audio/wav' });
    }

    downloadFile(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    }
}

window.addEventListener('load', () => {
    new AudioProcessor();
});

