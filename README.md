# dialogflow-example

This repository demonstrates using Deepgram to talk to a Google Dialogflow CX agent.

## Before you begin

1. Make sure your Google Cloud account and local environment are set up to use the Dialogflow CX Node.js Client. In other words, follow the "before you begin" instructions [here](https://googleapis.dev/nodejs/dialogflow-cx/latest/).
2. Create a Deepgram API key.
3. Create a Dialogflow CX agent. A [prebuilt agent](https://cloud.google.com/dialogflow/cx/docs/concept/agents-prebuilt) is a good way to get started quickly.

## Running the code

1. Copy `.env.example` into a file named `.env`. Update `.env` to replace the sample values with your own.
2. Install node modules:
    ```
    npm install
    ```
3. Run the server:
    ```
    npm run start
    ```
4. Point your browser to [http://localhost:3000/](http://localhost:3000/) to try out the demo. Chrome works best.
