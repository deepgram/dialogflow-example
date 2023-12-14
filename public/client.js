const apiOrigin = "http://localhost:3000";
const wssOrigin = "http://localhost:3000";

const conversation = document.getElementById('conversation');
const micButton = document.getElementById('mic-button');

let mediaRecorder = null;
let mediaRecorderHasBeenStarted = false;
let recording = false;
let audioObject = null;

/** 
 * If a user utterance is in progress, this is the div within `#conversation` where that utterance 
 * is being printed.
 */
let ongoingUtteranceDiv = null;

/** The concatenated is_final=true results that comprise the current utterance. */
let finalizedTranscript = "";

/** The most recent is_final=false result for which we have not yet seen an is_final=true */
let unfinalizedTranscript = "";

const queryParams = new URLSearchParams(window.location.search);
const useEchoCancellation = queryParams.get('cancelecho') !== "off";
const cancelEchoButtonText = useEchoCancellation ?
  "Disable echo cancellation" : "Enable echo cancellation";
document.getElementById("echo-cancel-button").innerHTML = cancelEchoButtonText;
console.log("using echo cancellation? " + useEchoCancellation);

function toggleEchoCancellation() {
  const newEchoCancelValue = useEchoCancellation ? "off" : "on";
  window.location.href = `${window.location.pathname}?cancelecho=${newEchoCancelValue}`;
}

navigator.mediaDevices
  .getUserMedia({
    audio: {
      echoCancellation: useEchoCancellation
    }
  })
  .then((stream) => {
    mediaRecorder = new MediaRecorder(stream);
    let socket = io(wssOrigin, (options = { transports: ["websocket"] }));
    socket.on("connect", async () => {
      mediaRecorder.addEventListener("dataavailable", (event) => {
        if (recording) {
          socket.emit("audio-from-user", event.data);
        }
      });

      socket.addEventListener("user-utterance-part",
        (msg) => handleUserUtterancePart(msg.isFinal, msg.transcript));

      socket.addEventListener("user-utterance-complete", handleUserUtteranceComplete);

      socket.addEventListener("bot-reply", (msg) => handleBotReply(msg.text, msg.audio));
    })
  });

function handleUserUtterancePart(isFinal, transcript) {
  if (transcript !== "" && audioObject !== null) {
    // If the agent's previous response is still being played when we've received a new
    // transcript from the user, assume the user is trying to cut the bot off (barge-in).
    audioObject.pause();
  }

  if (isFinal) {
    finalizedTranscript = (finalizedTranscript + " " + transcript).trim();
    unfinalizedTranscript = "";
  } else {
    unfinalizedTranscript = transcript;
  }
  updateOngoingUtteranceDiv();
}

function updateOngoingUtteranceDiv() {
  if (ongoingUtteranceDiv === null) {
    ongoingUtteranceDiv = document.createElement("div");
    ongoingUtteranceDiv.className = "response";
    conversation.appendChild(ongoingUtteranceDiv);
  }

  ongoingUtteranceDiv.innerHTML = '<span class="finalized">'
    + finalizedTranscript
    + '</span> <span class="unfinalized">'
    + unfinalizedTranscript
    + '</span>';
}

function handleUserUtteranceComplete() {
  if (unfinalizedTranscript !== "") {
    throw new Error("Got utterance complete with nonempty unfinalized transcript");
  }

  finalizedTranscript = "";
  unfinalizedTranscript = "";
  ongoingUtteranceDiv = null;
}

function handleBotReply(text, audio) {
  const agentMessageDiv = document.createElement("div");
  agentMessageDiv.className = "response agent-response";
  conversation.appendChild(agentMessageDiv);
  agentMessageDiv.innerHTML = text;

  playAudio(audio);
}

function playAudio(audio) {
  const audioBlob = new Blob([audio]);
  const audioUrl = URL.createObjectURL(audioBlob);
  audioObject = new Audio(audioUrl);
  audioObject.play();
}

function recordingStart() {
  if (!mediaRecorderHasBeenStarted) {
    // Send 100 ms of audio to Deepgram at a time
    mediaRecorder.start(100);
    mediaRecorderHasBeenStarted = true;
  }
  micButton.setAttribute('src', 'mic_on.png');
  recording = true;
}

function recordingStop() {
  micButton.setAttribute('src', 'mic_off.png');
  recording = false;
}

function toggleRecording() {
  toggleWaveSurferPause();
  if (recording) {
    recordingStop();
  } else {
    recordingStart();
  }
}
