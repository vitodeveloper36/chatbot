# ChatBot Municipalidad

This project contains an experimental chat interface for the Municipalidad de Puente Alto. The HTML page loads a hybrid chatbot that can answer questions via a decision tree and escalate conversations to a live agent through SignalR.

## Structure
- `index.html` – main demo page including the chatbot UI.
- `css/` – separated stylesheets (`main.css` and `chatbot.css`).
- `js/` – JavaScript modules. Notable files are `chatbotArbol.js`, `uiManager.js`, `signalRManager.js` and `notificationManager.js`.

When chatting with a live agent you can attach PDF, Word or Excel files (max 10MB).

## Development
Install the dependencies and start a local web server with:

```bash
npm install
npm start
```

The `start` script runs `http-server` to serve the project files.

To run the placeholder test suite execute:

```bash
npm test
```

The live agent features still require a running SignalR backend.
