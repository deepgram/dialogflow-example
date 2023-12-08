
let wavesurfer, record;
let scrollingWaveform = false;
let wavesurferIsPaused = true;

const createWaveSurfer = () => {
    // Create an instance of WaveSurfer
    if (wavesurfer) {
        wavesurfer.destroy()
    }
    wavesurfer = WaveSurfer.create({
        container: '#mic',
        waveColor: 'rgb(200, 0, 200)',
        progressColor: 'rgb(100, 0, 100)',
        plugins: [
            WaveSurfer.Record.create({ scrollingWaveform, renderRecordedAudio: false })
        ]
    })

    record = wavesurfer.plugins[0];
    const deviceId = 'default';
    record.startRecording({ deviceId }).then(() => {
        record.pauseRecording();
    });
}

const toggleWaveSurferPause = () => {
    if (record.isPaused()) {
        record.resumeRecording();
        return;
    }

    record.pauseRecording();
}

createWaveSurfer();
