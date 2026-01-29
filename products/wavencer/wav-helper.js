/**
 * Utility functions for WAV file manipulation
 */

/**
 * Encodes an AudioBuffer into a WAV file (Blob)
 * @param {AudioBuffer} audioBuffer 
 * @returns {Blob}
 */
function encodeWAV(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    let result;
    if (numChannels === 2) {
        result = interleave(audioBuffer.getChannelData(0), audioBuffer.getChannelData(1));
    } else {
        result = audioBuffer.getChannelData(0);
    }

    return createWavBlob(result, numChannels, sampleRate, bitDepth);
}

/**
 * Creates a WAV Blob from PCM data
 */
function createWavBlob(samples, numChannels, sampleRate, bitDepth) {
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);

    /* RIFF identifier */
    writeString(view, 0, 'RIFF');
    /* RIFF chunk length */
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    /* RIFF type */
    writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw) */
    view.setUint16(20, 1, true);
    /* channel count */
    view.setUint16(22, numChannels, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, sampleRate * blockAlign, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, blockAlign, true);
    /* bits per sample */
    view.setUint16(34, bitDepth, true);
    /* data chunk identifier */
    writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, samples.length * bytesPerSample, true);

    // Write samples
    floatTo16BitPCM(view, 44, samples);

    return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
}

function interleave(inputL, inputR) {
    const length = inputL.length + inputR.length;
    const result = new Float32Array(length);
    let index = 0;
    let inputIndex = 0;

    while (index < length) {
        result[index++] = inputL[inputIndex];
        result[index++] = inputR[inputIndex];
        inputIndex++;
    }
    return result;
}

/**
 * Finds the start and end of actual audio signal (ignoring silence)
 * Uses a window-based peak detection with a sustain requirement to be robust against noise and clicks.
 * @param {AudioBuffer} audioBuffer 
 * @param {number} threshold - linear threshold (e.g. 0.004 for -48dB)
 * @param {number} windowSizeMs - size of analysis window in ms
 * @param {number} minSustainedMs - required duration of signal to ignore 'pops'
 * @returns {{start: number, end: number}} - indices in samples
 */
function detectSignalBounds(audioBuffer, threshold, windowSizeMs = 10, minSustainedMs = 40) {
    const numChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    const windowSize = Math.floor((windowSizeMs / 1000) * sampleRate);
    const sustainWindows = Math.ceil(minSustainedMs / windowSizeMs);

    let start = length;
    let end = 0;

    const getWindowPeak = (data, windowIdx) => {
        const startIdx = windowIdx * windowSize;
        if (startIdx < 0 || startIdx >= length) return 0;
        let max = 0;
        const limit = Math.min(startIdx + windowSize, length);
        for (let j = startIdx; j < limit; j++) {
            const val = Math.abs(data[j]);
            if (val > max) max = val;
        }
        return max;
    };

    for (let c = 0; c < numChannels; c++) {
        const data = audioBuffer.getChannelData(c);

        // Search from start (window-based with sustain check)
        const totalWindows = Math.floor(length / windowSize);
        for (let i = 0; i < totalWindows; i++) {
            if (getWindowPeak(data, i) >= threshold) {
                // Potential start. Check for sustain.
                let activeCount = 0;
                for (let k = 1; k < sustainWindows; k++) {
                    if (getWindowPeak(data, i + k) >= threshold) activeCount++;
                }

                // If the majority of the following windows are active, it's the start
                if (activeCount >= Math.floor(sustainWindows / 2)) {
                    const sampleStart = i * windowSize;
                    if (sampleStart < start) start = sampleStart;
                    break;
                }
            }
        }

        // Search from end (window-based with sustain check)
        for (let i = totalWindows - 1; i >= 0; i--) {
            if (getWindowPeak(data, i) >= threshold) {
                // Potential end. Check for sustain (looking backwards).
                let activeCount = 0;
                for (let k = 1; k < sustainWindows; k++) {
                    if (getWindowPeak(data, i - k) >= threshold) activeCount++;
                }

                if (activeCount >= Math.floor(sustainWindows / 2)) {
                    const sampleEnd = (i + 1) * windowSize;
                    if (sampleEnd > end) end = sampleEnd;
                    break;
                }
            }
        }
    }

    if (start > end) return { start: 0, end: length - 1 };

    // Add a small buffer (10ms) to avoid cutting transients
    start = Math.max(0, start - windowSize);
    end = Math.min(length - 1, end + windowSize);

    return { start, end };
}
