/**
 * Clip Boss - Core Application Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const loading = document.getElementById('loading');
    const statusText = document.getElementById('status-text');
    const resultsSection = document.getElementById('results');
    const clipsContainer = document.getElementById('clips-container');
    const downloadAllBtn = document.getElementById('download-all');
    const currentFilenameDisplay = document.getElementById('current-filename');

    let audioBuffer = null;
    let generatedClips = [];
    let originalFileName = '';

    // --- Event Listeners ---

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });


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
        const files = e.dataTransfer.files;
        if (files.length > 0) handleFile(files[0]);
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFile(e.target.files[0]);
    });

    downloadAllBtn.addEventListener('click', downloadAllClips);

    // --- File Handling ---

    async function handleFile(file) {
        if (file.type !== 'audio/wav' && !file.name.endsWith('.wav')) {
            showStatus('WAVファイルのみ対応しています。', 'error');
            return;
        }

        originalFileName = file.name.replace(/\.wav$/i, '');
        resetUI();
        showLoading(true, 'ファイルを読み込み中...');

        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

            if (audioBuffer.duration < 15) {
                showStatus('WAVファイルが短すぎます（最低15秒必要です）。', 'error');
                showLoading(false);
                return;
            }

            showLoading(true, '盛り上がり箇所を解析中...');
            await processAudio(audioBuffer);

            currentFilenameDisplay.textContent = file.name;
            showLoading(false);
            resultsSection.style.display = 'block';
            resultsSection.scrollIntoView({ behavior: 'smooth' });
        } catch (err) {
            console.error(err);
            showStatus('ファイルの処理中にエラーが発生しました。', 'error');
            showLoading(false);
        }
    }

    // --- Audio Processing Logic ---

    async function processAudio(buffer) {
        const sampleRate = buffer.sampleRate;
        const duration = buffer.duration;
        const clipCount = 3;
        const minClipDuration = 15;
        const maxClipDuration = 60;
        const stepSeconds = 0.1;

        const leftData = buffer.getChannelData(0);
        const rightData = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : leftData;

        const energies = [];
        const stepSamples = Math.floor(stepSeconds * sampleRate);

        // --- 1. Mid/Side Differential Energy Mapping ---
        let maxRaw = 0;
        let maxVocal = 0;
        const tempEnergies = [];

        for (let i = 0; i < leftData.length; i += stepSamples) {
            const end = Math.min(i + stepSamples, leftData.length);
            const size = end - i;
            if (size <= 0) break;

            let midSum = 0;
            let sideSum = 0;
            let rawSum = 0;

            for (let j = i; j < end; j++) {
                const l = leftData[j];
                const r = rightData[j];
                const mid = (l + r) / 2;
                const side = (l - r) / 2;
                midSum += mid * mid;
                sideSum += side * side;
                rawSum += l * l;
            }

            const midRMS = Math.sqrt(midSum / size);
            const sideRMS = Math.sqrt(sideSum / size);
            const rawRMS = Math.sqrt(rawSum / size);
            const vocalRMS = Math.max(0, midRMS - sideRMS);

            if (rawRMS > maxRaw) maxRaw = rawRMS;
            if (vocalRMS > maxVocal) maxVocal = vocalRMS;

            tempEnergies.push({ t: i / sampleRate, r: rawRMS, v: vocalRMS });
        }

        // Normalize
        for (let i = 0; i < tempEnergies.length; i++) {
            const e = tempEnergies[i];
            energies.push({
                index: i,
                time: e.t,
                raw: maxRaw > 0 ? e.r / maxRaw : 0,
                vocal: maxVocal > 0 ? e.v / maxVocal : 0
            });
        }

        // --- 2. Peak Detection Helper Functions ---
        const getAvgVocal = (idx, windowSeconds, direction = -1) => {
            const steps = Math.floor(windowSeconds / stepSeconds);
            let sum = 0;
            let count = 0;
            const start = direction === -1 ? Math.max(0, idx - steps) : idx;
            const end = direction === -1 ? idx : Math.min(energies.length, idx + steps);
            for (let k = start; k < end; k++) {
                sum += energies[k].vocal;
                count++;
            }
            return count > 0 ? sum / count : 0;
        };

        const findBestStart = (targetIdx, rangeSteps) => {
            let bestIdx = targetIdx;
            let minScore = Infinity;
            const sStart = Math.max(0, targetIdx - rangeSteps);
            const sEnd = Math.min(energies.length - 1, targetIdx + rangeSteps);
            for (let j = sStart; j <= sEnd; j++) {
                const avgVocal = getAvgVocal(j, 2, -1);
                const score = energies[j].vocal * 0.7 + avgVocal * 0.3;
                if (score < minScore) {
                    minScore = score;
                    bestIdx = j;
                }
            }
            return bestIdx;
        };

        const findBestEnd = (actualStartIdx) => {
            const startStamp = energies[actualStartIdx].time;
            const minSteps = Math.floor(minClipDuration / stepSeconds);
            const maxSteps = Math.floor(maxClipDuration / stepSeconds);
            const scanS = actualStartIdx + minSteps;
            const scanE = Math.min(energies.length - 1, actualStartIdx + maxSteps);

            let bestIdx = scanS;
            let minScore = Infinity;

            for (let j = scanS; j <= scanE; j++) {
                const avgVocalFuture = getAvgVocal(j, 2, 1);
                const dur = energies[j].time - startStamp;
                const lenPen = (dur / maxClipDuration) * 0.05;
                const score = (energies[j].vocal * 0.8 + avgVocalFuture * 1.2) + lenPen;
                if (score < minScore) {
                    minScore = score;
                    bestIdx = j;
                }
            }
            return bestIdx;
        };

        // --- 3. Segment Selection ---
        const sortedEnergies = [...energies].sort((a, b) => b.raw - a.raw);
        const selectedSegments = [];
        let distanceThreshold = 45;

        // Micro-Refinement Helper (1ms resolution)
        const refineBoundary = (targetTime, radiusSeconds = 0.25) => {
            const centerSample = Math.floor(targetTime * sampleRate);
            const rSamples = Math.floor(radiusSeconds * sampleRate);
            const sStart = Math.max(0, centerSample - rSamples);
            const sEnd = Math.min(leftData.length - 1, centerSample + rSamples);

            let bestTime = targetTime;
            let minEnergy = Infinity;
            const stepMs = Math.floor(sampleRate / 1000); // ~1ms steps
            const winSize = Math.floor(sampleRate * 0.005); // 5ms stability window

            for (let s = sStart; s < sEnd; s += stepMs) {
                let sum = 0;
                const eWin = Math.min(s + winSize, leftData.length);
                for (let k = s; k < eWin; k++) {
                    const l = leftData[k];
                    const r = rightData[k];
                    sum += (l * l + r * r) / 2;
                }
                const energy = sum / (eWin - s);
                if (energy < minEnergy) {
                    minEnergy = energy;
                    bestTime = s / sampleRate;
                }
            }
            return bestTime;
        };

        while (distanceThreshold >= 10) {
            let passSegments = [];
            for (const entry of sortedEnergies) {
                // If we already have enough segments in this pass, and it's the discovery phase, 
                // we still check entry.raw to see if it's "high quality" (>30% of max).
                // However, we MUST ensure we get at least 3.

                const tooClose = passSegments.some(s => Math.abs(s.peakTime - entry.time) < distanceThreshold);
                if (!tooClose) {
                    const threshold = entry.raw * 0.4;
                    let peakIdx = entry.index;
                    let startSearchIdx = peakIdx;
                    while (startSearchIdx > 0 && (energies[peakIdx].time - energies[startSearchIdx].time) < 10 && energies[startSearchIdx].raw > threshold) {
                        startSearchIdx--;
                    }

                    const searchRange = Math.floor(8 / stepSeconds);
                    const finalStartIdxVal = findBestStart(startSearchIdx, searchRange);
                    const finalEndIdxVal = findBestEnd(finalStartIdxVal);

                    const refinedStart = refineBoundary(energies[finalStartIdxVal].time);
                    const refinedEnd = refineBoundary(energies[finalEndIdxVal].time);

                    passSegments.push({
                        peakTime: entry.time,
                        raw: entry.raw,
                        start: refinedStart,
                        end: Math.min(duration, refinedEnd)
                    });
                }
            }

            // If we found at least 3 segments, we are done with the "mandatory" search.
            // We take all segments found in this pass.
            if (passSegments.length >= clipCount) {
                selectedSegments.push(...passSegments);
                break;
            }

            // Otherwise, relax the distance and try again to find at least 3.
            distanceThreshold -= 5;
            if (distanceThreshold < 10) {
                // Last resort: take whatever we found in the final pass
                selectedSegments.push(...passSegments);
            }
        }

        selectedSegments.sort((a, b) => a.start - b.start);

        // --- 4. Generate Clips ---
        generatedClips = [];
        clipsContainer.innerHTML = '';
        for (let i = 0; i < selectedSegments.length; i++) {
            const seg = selectedSegments[i];
            const clipBlob = await createClipBlob(buffer, seg.start, seg.end);
            const clipData = {
                id: i + 1,
                start: seg.start,
                end: seg.end,
                duration: seg.end - seg.start,
                blob: clipBlob,
                url: URL.createObjectURL(clipBlob)
            };
            generatedClips.push(clipData);
            renderClipCard(clipData);
        }
    }

    // --- WAV Encoding Helpers ---

    async function createClipBlob(buffer, start, end) {
        const sampleRate = buffer.sampleRate;
        const startSample = Math.floor(start * sampleRate);
        const endSample = Math.floor(end * sampleRate);
        const frameCount = endSample - startSample;

        const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, frameCount, sampleRate);
        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(offlineCtx.destination);
        source.start(0, start, end - start);

        const renderedBuffer = await offlineCtx.startRendering();

        // --- Apply Fading ---
        const fadeSeconds = 0.5;
        const fadeSamples = Math.floor(fadeSeconds * sampleRate);

        for (let channel = 0; channel < renderedBuffer.numberOfChannels; channel++) {
            const data = renderedBuffer.getChannelData(channel);
            // Fade in
            for (let i = 0; i < Math.min(fadeSamples, data.length); i++) {
                data[i] *= (i / fadeSamples);
            }
            // Fade out
            for (let i = 0; i < Math.min(fadeSamples, data.length); i++) {
                const idx = data.length - 1 - i;
                data[idx] *= (i / fadeSamples);
            }
        }

        return bufferToWave(renderedBuffer, frameCount);
    }

    // Convert AudioBuffer to WAV Blob
    function bufferToWave(abuffer, len) {
        const numOfChan = abuffer.numberOfChannels;
        const length = len * numOfChan * 2 + 44;
        const buffer = new ArrayBuffer(length);
        const view = new DataView(buffer);
        const channels = [];
        let i, sample, offset = 0, pos = 0;

        // write WAVE header
        setUint32(0x46464952);                         // "RIFF"
        setUint32(length - 8);                         // file length - 8
        setUint32(0x45564157);                         // "WAVE"

        setUint32(0x20746d66);                         // "fmt " chunk
        setUint32(16);                                 // length = 16
        setUint16(1);                                  // PCM (uncompressed)
        setUint16(numOfChan);
        setUint32(abuffer.sampleRate);
        setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
        setUint16(numOfChan * 2);                      // block-align
        setUint16(16);                                 // 16-bit (hardcoded)

        setUint32(0x61746164);                         // "data" - chunk
        setUint32(length - pos - 4);                   // chunk length

        // write interleaved data
        for (i = 0; i < abuffer.numberOfChannels; i++)
            channels.push(abuffer.getChannelData(i));

        while (pos < length) {
            for (i = 0; i < numOfChan; i++) {             // interleave channels
                sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
                sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF); // scale to 16-bit signed int
                view.setInt16(pos, sample, true);          // write 16-bit sample
                pos += 2;
            }
            offset++;
        }

        return new Blob([buffer], { type: "audio/wav" });

        function setUint16(data) {
            view.setUint16(pos, data, true);
            pos += 2;
        }

        function setUint32(data) {
            view.setUint32(pos, data, true);
            pos += 4;
        }
    }

    // --- UI Helpers ---

    function renderClipCard(clip) {
        const card = document.createElement('div');
        card.className = 'clip-card';

        const timestamp = formatTime(clip.start) + ' - ' + formatTime(clip.end);

        card.innerHTML = `
            <div class="clip-info">
                <span class="clip-title">クリップ #${clip.id}</span>
                <span class="clip-duration">${timestamp}</span>
            </div>
            <audio controls src="${clip.url}"></audio>
            <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                <button class="btn btn-secondary" onclick="window.open('${clip.url}')">
                    <span>💾</span> 個別ダウンロード
                </button>
            </div>
        `;

        // Attach direct download behavior
        card.querySelector('.btn-secondary').onclick = (e) => {
            e.preventDefault();
            const a = document.createElement('a');
            a.href = clip.url;
            // Filename format: OriginalName_00m42s123-01m14s456.wav
            const startStr = formatFilenameTime(clip.start);
            const endStr = formatFilenameTime(clip.end);
            a.download = `${originalFileName}_${startStr}-${endStr}.wav`;
            a.click();
        };

        clipsContainer.appendChild(card);
    }

    async function downloadAllClips() {
        if (generatedClips.length === 0) return;

        const zip = new JSZip();
        generatedClips.forEach(clip => {
            const startStr = formatFilenameTime(clip.start);
            const endStr = formatFilenameTime(clip.end);
            const filename = `${originalFileName}_${startStr}-${endStr}.wav`;
            zip.file(filename, clip.blob);
        });

        const content = await zip.generateAsync({ type: "blob" });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = "clip_boss_all.zip";
        a.click();
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }

    function formatFilenameTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return `${mins.toString().padStart(2, '0')}m${secs.toString().padStart(2, '0')}s${ms.toString().padStart(3, '0')}`;
    }

    function showLoading(show, text = '') {
        loading.style.display = show ? 'block' : 'none';
        statusText.style.display = show ? 'block' : 'none';
        if (text) statusText.textContent = text;
        statusText.style.color = 'var(--text-secondary)';
    }

    function showStatus(text, type = 'info') {
        statusText.textContent = text;
        statusText.style.display = 'block';
        statusText.style.color = type === 'error' ? 'var(--error)' : 'var(--text-secondary)';
    }

    function resetUI() {
        resultsSection.style.display = 'none';
        clipsContainer.innerHTML = '';
        generatedClips = [];
    }
});
