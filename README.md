# ChatBot Municipalidad

This project contains an experimental chat interface for the Municipalidad de Puente Alto. The HTML page loads a hybrid chatbot that can answer questions via a decision tree and escalate conversations to a live agent through SignalR.

## Structure
- `index.html` – main demo page including the chatbot UI.
- `css/` – separated stylesheets (`main.css` and `chatbot.css`).
- `js/` – JavaScript modules. Notable files are `chatbotArbol.js`, `uiManager.js`, `signalRManager.js` and `notificationManager.js`.

When chatting with a live agent you can attach PDF, Word or Excel files (max 10MB).

## Development
There is no build system or package.json yet. Open `index.html` in a web server to test locally. The live agent features require a running SignalR backend.
