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

let socketToClient = null;
let socketToDeepgram = null;

function getEnv(name) {
  let val = process.env[name];
  if ((val === undefined) || (val === null)) {
    throw ("Missing env var for " + name);
  }
  return val;
}

const myDialogFlow = new Dialogflow(
  getEnv("DIALOGFLOW_PROJECT_ID"),
  getEnv("DIALOGFLOW_LOCATION"),
  getEnv("DIALOGFLOW_AGENT_ID"));

/** Receives incoming websocket connections from the client */
let websocketServer;

function resetToInitialState() {
  if (socketToClient) {
    socketToClient.removeAllListeners();
  }
  if (socketToDeepgram) {
    socketToDeepgram.removeAllListeners();
  }
  socketToClient = null;
  socketToDeepgram = null;
}

async function getTextToSpeech(message) {
  const TTS_API = 'https://api.beta.deepgram.com/v1/speak';
  const response = await fetch(TTS_API, {
    method: 'POST',
    headers: {
      'authorization': `token ${getEnv("DEEPGRAM_API_KEY")}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ text: message })
  });
  return response.blob();
}

const openSocketToDeepgram = () => {
  const { Deepgram } = deepgramSdk;
  const dg = new Deepgram(getEnv("DEEPGRAM_API_KEY"));
  return dg.transcription.live({
    language: "en-US",
    smart_format: true,
    model: "nova",
    interim_results: true,
    endpointing: 500,
    no_delay: false,
    utterance_end_ms: 1000,
  });
};

const app = express();
app.use(express.static("public/"));

app.get("/", function (req, res) {
  res.sendFile(__dirname + "/index.html");
});

app.get("/chat", async (req, res) => {
  let message = req.query.message;
  let socketId = req.query.socketId;

  try {
    const responses = await myDialogFlow.detectIntentText(socketId, message);
    res.send({
      responses: responses
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({ err: err.message ? err.message : err });
  }
});

app.get("/speak", async (req, res) => {
  let text = req.query.text;

  // remove code blocks from the text
  if (text.includes("```")) {
    text = text.replace(/```[\s\S]*?```/g, '\n\n');
  }

  try {
    let response = await getTextToSpeech(text);

    res.type(response.type)
    response.arrayBuffer().then((buf) => {
      res.send(Buffer.from(buf))
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({ err: err.message ? err.message : err });
  }
});

const httpServer = createServer(app);

const initDgConnection = () => {
  socketToDeepgram = openSocketToDeepgram();

  addDeepgramTranscriptListener();
  addDeepgramOpenListener();
  addDeepgramCloseListener();
  addDeepgramErrorListener();

  socketToClient.on("audio-from-user", async (event) =>
    handleAudioFromUser(event)
  );
};

const createWebsocketServer = () => {
  if (!websocketServer) {
    websocketServer = new Server(httpServer, {
      transports: "websocket",
      cors: {}
    });
    websocketServer.on("connection", (conn) => {
      console.log(`Received websocket connection from client`);

      resetToInitialState();
      socketToClient = conn;
      initDgConnection();

      websocketServer.on('disconnect', () => {
        console.log('User disconnected.');
      });

      socketToClient.emit("socketId", socketToClient.id);
    });
  }
};

const addDeepgramTranscriptListener = () => {
  socketToDeepgram.addListener("transcriptReceived", (json) => {
    let message = JSON.parse(json);
    if (message.type === "Results") {
      let isFinal = message.is_final;
      let speechFinal = message.speech_final;
      let transcript = message.channel.alternatives[0].transcript;

      if (transcript !== "" || isFinal || speechFinal) {
        console.log('Deepgram result:');
        console.log('  is_final:    ', isFinal);
        console.log('  speech_final:', speechFinal);
        console.log('  transcript:  ', transcript, '\n');
      }

      socketToClient.emit("dg-results", { transcript, speechFinal, isFinal });
    } else if (message.type == "UtteranceEnd") {
      console.log("Received utterance end from Deepgram", "\n");
      socketToClient.emit("dg-utterance-end");
    }
  });
};

const addDeepgramOpenListener = () => {
  socketToDeepgram.addListener("open", () => {
    console.log(`Opened websocket connection to Deepgram`);
  });
};

const addDeepgramCloseListener = () => {
  socketToDeepgram.addListener("close", (msg) => {
    console.log(`Websocket to Deepgram closed. Code: ${msg.code}, Reason: '${msg.reason}'`);
  });
};

const addDeepgramErrorListener = () => {
  socketToDeepgram.addListener("error", (msg) => {
    console.log("Error from Deepgram: ", msg);
  });
};

const handleAudioFromUser = (event) => {
  if (socketToDeepgram && socketToDeepgram.getReadyState() === 1) {
    if (event.length !== 126) {
      socketToDeepgram.send(event);
    }
  } else {
    // console.log("did not send audio to DG because socket to DG was not ready");
  }
};

const sendKeepAliveToDeepgram = () => {
  if (socketToDeepgram && socketToDeepgram.getReadyState() === 1) {
    socketToDeepgram.send(
      JSON.stringify({
        type: "KeepAlive"
      }));
    console.log("Sent keep alive to Deepgram")
  }
}

setInterval(sendKeepAliveToDeepgram, 8000);

httpServer.listen(PORT);
console.log('Starting Server on Port ', PORT);

createWebsocketServer();
console.log("Running")
