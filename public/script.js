let conversation = document.getElementById('conversation');
let mic = document.getElementById('mic-button');
let socketId = null;

const apiOrigin = "http://localhost:3000";
const wssOrigin = "http://localhost:3000";
let audioElement = null;

let mediaRecorder = null;
let mediaRecorderHasBeenStarted = false;
let recording = false;
let recordingChangeInProgress = false;

const STATES = {
  AwaitingUtterance: "AwaitingUtterance",
  AwaitingBotReply: "AwaitingBotReply"
};

let currentState = STATES.AwaitingUtterance;

/** 
 * If a user utterance is in progress, this is the div within `#conversation` where that utterance 
 * is being printed.
 */
let ongoingUtteranceDiv = null;

/** The concatenated is_final=true results that comprise the current utterance. */
let finalizedTranscript = "";

/** The most recent is_final=false result for which we have not yet seen an is_final=true */
let unfinalizedTranscript = "";

/** 
 * Boolean for whether we have sent interim results to the NLP engine since the last is_final 
 * result. If so, the results in this series are considered to be already processed, and should be 
 * ignored until after the next is_final. 
 */
let processedCurrentInterimResult = false;

async function updateAudio(text) {
  audioElement = document.createElement('audio');
  audioElement.setAttribute('controls', '');
  audioElement.setAttribute('autoplay', 'true');
  let source = document.createElement('source');

  let response = await getAudioForText(text);
  let data = await response.blob();
  const url = URL.createObjectURL(data);
  source.setAttribute('src', url);

  source.setAttribute('type', 'audio/mp3');

  audioElement.appendChild(source);

  audioElement.play();
}

async function getAudioForText(text) {
  const url = apiOrigin + '/speak?text=' + text;
  return await fetch(url)
}

navigator.mediaDevices
  .getUserMedia({ audio: true })
  .then((stream) => {
    mediaRecorder = new MediaRecorder(stream);
    socket = io(wssOrigin, (options = { transports: ["websocket"] }));
    socket.on("connect", async () => {
      socket.addEventListener("socketId", (socket_id) => {
        socketId = socket_id;
        console.log("Socket ID for this session: " + socketId)
      });

      mediaRecorder.addEventListener("dataavailable", (event) => {
        if (recording) {
          socket.emit("audio-from-user", event.data);
        }
      });

      socket.addEventListener("dg-results", (msg) => handleDgResults(msg));

      socket.addEventListener("dg-utterance-end", (msg) => handleDgUtteranceEnd());
    })
  });

function handleDgResults(results) {
  switch (currentState) {
    case STATES.AwaitingUtterance:
      if (processedCurrentInterimResult) {
        if (results.isFinal) {
          processedCurrentInterimResult = false;
        }
        return;
      }

      if (results.transcript !== "" && audioElement) {
        // If the agent's previous response is still being played when we've received a new
        // transcript from the user, assume the user is trying to cut the bot off (barge-in).
        audioElement.pause();
      }

      if (!results.isFinal) {
        unfinalizedTranscript = results.transcript;
        updateOngoingUtteranceDiv();
        return;
      }

      unfinalizedTranscript = "";
      if (results.transcript !== "") {
        finalizedTranscript += " " + results.transcript;
        finalizedTranscript.trim();
      }
      updateOngoingUtteranceDiv();

      if (results.speechFinal && finalizedTranscript !== "") {
        ongoingUtteranceDiv = null; // This utterance is finished, the div will not be changed again
        currentState = STATES.AwaitingBotReply;
        queryAgent(socketId, finalizedTranscript);
      }

      break;

    case STATES.AwaitingBotReply:
      if (results.isFinal && processedCurrentInterimResult) {
        processedCurrentInterimResult = false;
      }

      break;

    default:
      console.log("ERROR Unexpected state", currentState);
  }
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

function handleDgUtteranceEnd() {
  switch (currentState) {
    case STATES.AwaitingUtterance:
      let fullTranscript = (finalizedTranscript + " " + unfinalizedTranscript).trim();
      if (fullTranscript === "") {
        return;
      }

      if (unfinalizedTranscript !== "") {
        // If there is an unfinalized interim result at this point, consider it finalized. Mark it
        // as processed so we remember to ignore later iterations of that result.  
        finalizedTranscript = fullTranscript;
        unfinalizedTranscript = "";
        processedCurrentInterimResult = true;
        updateOngoingUtteranceDiv();
      }

      ongoingUtteranceDiv = null; // This utterance is finished, the div will not be changed again
      currentState = STATES.AwaitingBotReply;
      queryAgent(socketId, fullTranscript);

      break;

    case STATES.AwaitingBotReply:
      // Do nothing, discard this message
      break;

    default:
      console.log("ERROR Unexpected state", currentState);
  }
}

function handleBotResponse(response) {
  const agentMessageDiv = document.createElement("div");
  agentMessageDiv.className = "response agent-response";
  conversation.appendChild(agentMessageDiv);
  agentMessageDiv.innerHTML = response;

  finalizedTranscript = "";
  unfinalizedTranscript = "";
  currentState = STATES.AwaitingUtterance;
}

async function queryAgent(socketId, msg) {
  const response = await fetch(`${apiOrigin}/chat?socketId=${socketId}&message=${encodeURIComponent(msg)}`, {
    method: "GET"
  });
  const json = await response.json();

  if (json && !json.err) {
    const reply = json.responses.join("\n\n");

    handleBotResponse(reply);

    updateAudio(reply);
  } else {
    console.log("Got unexpected response from `/chat` enpoint: ", json);
  }
}

async function recordingStart() {
  if (!mediaRecorderHasBeenStarted) {
    // Send 100 ms of audio to Deepgram at a time
    mediaRecorder.start(100);
    mediaRecorderHasBeenStarted = true;
  }
  mic.setAttribute('src', 'mic_on.png');
  recording = true;
}

async function recordingStop() {
  mic.setAttribute('src', 'mic_off.png');
  recording = false;
}

async function toggleRecording() {
  if (recordingChangeInProgress) {
    return;
  }
  recordingChangeInProgress = true;
  toggleWaveSurferPause();
  if (recording) {
    await recordingStop();
  } else {
    await recordingStart();
  }
  recordingChangeInProgress = false;
}
