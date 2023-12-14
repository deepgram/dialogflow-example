import "log-timestamp";
import 'dotenv/config'
import path from "path";
import express from "express";
import deepgramSdk from "@deepgram/sdk";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";
import Dialogflow from './dialogflow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

const dialogflowAgent = new Dialogflow(
  getEnv("DIALOGFLOW_PROJECT_ID"),
  getEnv("DIALOGFLOW_LOCATION"),
  getEnv("DIALOGFLOW_AGENT_ID"));

let socketToClient = null;
let socketToDeepgram = null;

const STATES = {
  AwaitingUtterance: "AwaitingUtterance",
  AwaitingBotReply: "AwaitingBotReply"
};
let voicebotState = STATES.AwaitingUtterance;

/** The concatenated `is_final=true` results that comprise the current utterance. */
let finalizedTranscript = "";

/** The most recent `is_final=false` result for which we have not yet seen an `is_final=true` */
let unfinalizedTranscript = "";

/** 
 * The timestamp in seconds that the last finalized word ended (or `Infinity` if there have been no 
 * finalized words in the current utterance) 
 */
let latestFinalizedWordEnd = Infinity;

/** The latest timestamp that we've seen included in a result (also known as the transcript cursor) */
let latestTimeSeen = 0.0;

function resetToInitialState() {
  if (socketToClient) {
    socketToClient.removeAllListeners();
  }
  if (socketToDeepgram) {
    socketToDeepgram.removeAllListeners();
  }
  socketToClient = null;
  socketToDeepgram = null;
  voicebotState = STATES.AwaitingUtterance;
  finalizedTranscript = "";
  unfinalizedTranscript = "";
  latestFinalizedWordEnd = Infinity;
  latestTimeSeen = 0.0;
}

function changeVoicebotState(newState) {
  if (!Object.values(STATES).includes(newState)) {
    throw new Error(`Tried to change to invalid state: '${newState}'`);
  }

  console.log(`State change: ${voicebotState} -> ${newState}`);

  voicebotState = newState;
}

function getEnv(name) {
  let val = process.env[name];
  if ((val === undefined) || (val === null)) {
    throw ("Missing env var for " + name);
  }
  return val;
}

function handleClientConnection(conn) {
  console.log(`Received websocket connection from client`);

  resetToInitialState();
  initDgConnection();
  socketToClient = conn;
  socketToClient.on("audio-from-user", handleAudioFromUser);
}

function initDgConnection() {
  socketToDeepgram = openSocketToDeepgram();

  socketToDeepgram.addListener("open", () => {
    console.log(`Opened websocket connection to Deepgram`);
  });
  socketToDeepgram.addListener("close", (msg) => {
    console.log(`Websocket to Deepgram closed. Code: ${msg.code}, Reason: '${msg.reason}'`);
  });
  socketToDeepgram.addListener("error", (msg) => {
    console.log("Error from Deepgram: ", msg);
  });

  socketToDeepgram.addListener("transcriptReceived", (json) => {
    let message = JSON.parse(json);
    if (message.type === "Results") {
      let start = message.start;
      let duration = message.duration;
      let isFinal = message.is_final;
      let speechFinal = message.speech_final;
      let transcript = message.channel.alternatives[0].transcript;
      let words = message.channel.alternatives[0].words;

      console.log('Deepgram result:');
      console.log('  is_final:    ', isFinal);
      console.log('  speech_final:', speechFinal);
      console.log('  transcript:  ', transcript, '\n');

      handleDgResults(start, duration, isFinal, speechFinal, transcript, words);
    }
  });
};

function openSocketToDeepgram() {
  const { Deepgram } = deepgramSdk;
  const dg = new Deepgram(getEnv("DEEPGRAM_API_KEY"));
  return dg.transcription.live({
    model: "nova",
    language: "en-US",
    smart_format: true,
    interim_results: true,
    endpointing: 500,
    no_delay: true,
  });
};

function handleDgResults(start, duration, isFinal, speechFinal, transcript, words) {
  switch (voicebotState) {
    case STATES.AwaitingUtterance:
      // Give the transcript to the client for (optional) display
      socketToClient.emit("user-utterance-part", { transcript, isFinal });

      updateTranscriptState(transcript, isFinal);
      updateSilenceDetectionState(start, duration, words, isFinal);

      if (finalizedTranscript === "") {
        return;
      }

      let silenceDetected = unfinalizedTranscript === "" && latestTimeSeen - latestFinalizedWordEnd > 1.25;

      if (silenceDetected || speechFinal) {
        if (speechFinal) {
          console.log("End of utterance reached due to endpoint");
        } else {
          console.log("End of utterance reached due to silence detection");
        }

        changeVoicebotState(STATES.AwaitingBotReply);
        socketToClient.emit("user-utterance-complete");
        sendUtteranceDownstream(finalizedTranscript);
      }

      break;
    case STATES.AwaitingBotReply:
      // Discard user speech since the bot is already processing a complete user utterance. Note
      // that more sophisticated approaches are possible. For example, we could analyze the 
      // transcript, and if we conclude that the user is continuing their utterance, we could then 
      // cancel Dialogflow processing and wait for a new complete utterance.
      break;
    default:
      throw new Error("Unexpected state: " + voicebotState);
  }
};

/** Updates `finalizedTranscript` and `unfinalizedTranscript` in light of a new result */
function updateTranscriptState(transcript, isFinal) {
  if (isFinal) {
    unfinalizedTranscript = "";
    if (transcript !== "") {
      finalizedTranscript = (finalizedTranscript + " " + transcript).trim();
    }
  } else {
    unfinalizedTranscript = transcript;
  }
};

/** Updates `latestFinalizedWordEnd` and `latestTimeSeen` in light of a new result */
function updateSilenceDetectionState(start, duration, words, isFinal) {
  if (isFinal && words.length > 0) {
    let lastWord = words.at(-1);

    if (lastWord.word.length > 1 && /\d/.test(lastWord.word)) {

      // Here we address a subtlety of the nova general model. The model assumes words cannot be
      // longer than 0.5 seconds. Essentially:
      //
      // `word_end(n) = min(word_start(n+1), word_start(n) + 0.5 sec)`
      //
      // This assumption is usually fine, but it breaks down when the user speaks a long string of
      // numbers and letters, as these are often grouped into a single word which takes far longer
      // than 0.5 seconds to pronounce. Therefore, if the last word is a string involving number(s),
      // we play it safe and consider the word to have ended all the way at the end of the result.

      latestFinalizedWordEnd = start + duration;
    } else {
      latestFinalizedWordEnd = lastWord.end;
    }
  }
  latestTimeSeen = start + duration;
}

async function sendUtteranceDownstream(utterance) {
  let botResponse = await dialogflowAgent.detectIntentText(socketToClient.id, utterance);
  handleBotReply(botResponse.textResponse, botResponse.audioResponse);
}

function handleBotReply(text, audio) {
  if (voicebotState !== STATES.AwaitingBotReply) {
    throw new Error("Got bot reply in unexpected state");
  }

  socketToClient.emit("bot-reply", { text, audio });

  finalizedTranscript = "";
  unfinalizedTranscript = "";
  latestFinalizedWordEnd = Infinity;
  latestTimeSeen = 0;
  changeVoicebotState(STATES.AwaitingUtterance);
};

function handleAudioFromUser(event) {
  if (socketToDeepgram && socketToDeepgram.getReadyState() === 1) {
    if (event.length !== 126) {
      socketToDeepgram.send(event);
    }
  }
};

function sendKeepAliveToDeepgram() {
  if (socketToDeepgram && socketToDeepgram.getReadyState() === 1) {
    socketToDeepgram.send(
      JSON.stringify({
        type: "KeepAlive"
      }));
    console.log("Sent keep alive to Deepgram");
  }
}

setInterval(sendKeepAliveToDeepgram, 8000);

const app = express();
app.use(express.static("public/"));
app.get("/", function (_req, res) {
  res.sendFile(__dirname + "/index.html");
});

const httpServer = createServer(app);

new Server(httpServer, {
  transports: "websocket",
  cors: {}
})
  .on("connection", handleClientConnection)
  .on('disconnect', () => console.log('User disconnected.'));

httpServer.listen(PORT);

console.log("Server listening on port:", PORT);
