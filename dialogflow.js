import { SessionsClient } from '@google-cloud/dialogflow-cx';

class DialogflowAgentResponse {
    constructor(textResponse, audioResponse) {
        this.textResponse = textResponse;
        this.audioResponse = audioResponse;
    }
}

export default class Dialogflow {
    constructor(projectId, location, agentId) {
        this.projectId = projectId;
        this.location = location;
        this.agentId = agentId;

        this.client = new SessionsClient({ apiEndpoint: `${location}-dialogflow.googleapis.com` });
    }

    /**
     * @param {String} sessionId Identifier for the DialogFlow conversation
     * @param {String} query User input text to send to the agent
     * @param {String} languageCode
     * @returns {Promise<DialogflowAgentResponse>} The list of responses to speak to the user
     */
    async detectIntentText(sessionId, query, languageCode = 'en') {
        const sessionPath = this.client.projectLocationAgentSessionPath(
            this.projectId,
            this.location,
            this.agentId,
            sessionId
        );
        const request = {
            session: sessionPath,
            queryInput: {
                text: {
                    text: query,
                },
                languageCode,
            },
            outputAudioConfig: {
                audioEncoding: 'OUTPUT_AUDIO_ENCODING_OGG_OPUS'
            }
        };

        const [response] = await this.client.detectIntent(request);

        const responseMessages = (response.queryResult.responseMessages ?? []);
        const textResponses = responseMessages.filter(m => m.text !== null && m.text !== undefined);
        const textResponseStrings = [].concat(...textResponses.map(r => r.text.text));

        const matchedIntent = response.queryResult.match.intent?.displayName ?? "NONE MATCHED";
        const newPage = response.queryResult.currentPage.displayName;

        console.log("Dialogflow agent response:");
        console.log("  Agent response(s): ", textResponseStrings);
        console.log("  Matched intent:    ", matchedIntent);
        console.log("  New page:          ", newPage);
        console.log();

        return new DialogflowAgentResponse(textResponseStrings.join("\n\n"), response.outputAudio);
    }
}
