let wavesurfer, record;
let scrollingWaveform = false;

const createWaveSurfer = () => {
    if (wavesurfer) {
        wavesurfer.destroy();
    }
    wavesurfer = WaveSurfer.create({
        container: '#mic',
        waveColor: 'rgb(58, 0, 211)',
        plugins: [
            WaveSurfer.Record.create({ scrollingWaveform, renderRecordedAudio: false })
        ]
    });

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
