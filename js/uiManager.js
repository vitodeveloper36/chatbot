import { Utils } from './utils.js';

async function loadPlyr() {
  if (window.Plyr) return;
  await new Promise(res => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/plyr@3.7.8/dist/plyr.css';
    const js = document.createElement('script');
    js.src = 'https://cdn.jsdelivr.net/npm/plyr@3.7.8/dist/plyr.polyfilled.min.js';
    js.onload = res;
    document.head.append(css, js);
  });
}

export class UIManager {
  constructor(state, services) {
    this.state = state;
    this.state.sessionId = sessionStorage.getItem('chatbot_sessionId') || this.state.sessionId;
    this.services = services;
    this.api = services.apiClient;
    this.config = services.configLoader;
    this.speech = services.speechManager;

    // Audio
    this.isRecording = false;
    this.pendingAudio = null;
    this.audioWrapper = null;

    // Etapas - Configurado para saltar registro
    this.userStage = 2; // Siempre en etapa final

    // Agente
    this.agentMode = false;
    this.agentSocket = null;

    // UI
    this.typingElement = null;
    this.indicator = null;
    this.currentButtonsContainer = null; // Para manejar botones actuales

    this.lastMessageTime = 0;
    this.MIN_MESSAGE_INTERVAL = 1000;
    this.debouncedScroll = this._debounce(this._scrollToBottom, 100);
  }

  _debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func.apply(this, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  async init() {
    try {
      await loadPlyr();
      this._injectStyles();
      this._buildDOM();
      this._cacheEls();
      this._attachHandlers();
      this._loadHistory();
      return true;
    } catch (err) {
      console.error('Error inicializando UI:', err);
      return false;
    }
  }

  _injectStyles() {
    const style = Utils.createEl('style', { text: this._css() });
    document.head.appendChild(style);
  }

  _buildDOM() {
    const toggle = Utils.createEl('button', {
      className: 'chat-toggle', text: '💬',
      attrs: { 'aria-label': 'Abrir chat' }
    });
    toggle.id = 'chatbot-toggle';
    document.body.appendChild(toggle);

    const container = Utils.createEl('div', {
      className: 'chat-container',
      attrs: {
        id: 'chatbot-container',
        role: 'dialog',
        'aria-labelledby': 'chat-title',
        'aria-hidden': 'true',
        'aria-live': 'polite',
        'aria-atomic': 'true'
      }
    });

    container.innerHTML = `
      <div class="chat-header">
        <span id="chat-title">🤖 ChatBot<br>Municipalidad</span>
        <div class="chat-controls" style="display: flex; gap: 8px; align-items: center;">
          <button id="voz-btn" class="btn-label" type="button" title="Voz">
            🗣️
          </button>
          <button id="mic-btn" class="btn-label" type="button" title="Micrófono">
            🎤
          </button>
          <button id="close-btn" class="btn-label" type="button" title="Cerrar">
            ✖️
          </button>
        </div>
      </div>

      <div id="chat-output" class="chat-output" role="log" aria-live="polite" aria-atomic="false"></div>

      <div class="chat-input-container">
        <input
          id="chat-input"
          type="text"
          placeholder="Escribe tu mensaje…"
          aria-label="Escribe tu mensaje"
          autocomplete="off"
        />
        <button id="send-btn" class="btn-icon" type="button" title="Enviar">
          ➡️
        </button>
      </div>
    `;


    document.body.appendChild(container);
  }

  _cacheEls() {
    const $ = id => document.getElementById(id);
    this.toggleBtn = $('chatbot-toggle');
    this.container = $('chatbot-container');
    this.outputEl = $('chat-output');
    this.inputEl = $('chat-input');
    this.inputWrap = document.querySelector('.chat-input-container');
    this.btnClose = $('close-btn');
    this.btnMic = $('mic-btn') || { addEventListener: () => { } };  // fallback vacío
    this.btnVoz = $('voz-btn') || { addEventListener: () => { } };
    this.btnSend = $('send-btn');
  }

  _attachHandlers() {
    this.toggleBtn.addEventListener('click', () => this._openChat());
    this.btnClose.addEventListener('click', () => this._closeChat());
    this.btnMic.addEventListener('click', () => this._toggleRecording());
    this.btnVoz.addEventListener('click', () => this._onVoiceToggle());

    this.btnSend.addEventListener('click', () => {
      if (this.pendingAudio) {
        this._onSendAudio();
      } else {
        this._onSend();
      }
    });

    this.inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        if (this.pendingAudio) {
          this._onSendAudio();
        } else {
          this._onSend();
        }
      }
      if (e.key === 'Escape') this._closeChat();
    });

    if (this.services.recorder && this.services.recorder.onStop) {
      this.services.recorder.onStop(blob => this._showAudioPreview(blob));
    }
  }

  _loadHistory() {
    const raw = sessionStorage.getItem('chat_history');
    if (!raw) return;
    try {
      JSON.parse(raw).forEach(({ t, f }) => this.appendMessage(t, f));
    } catch { }
  }

  _saveHistory(text, from) {
    const arr = JSON.parse(sessionStorage.getItem('chat_history') || '[]');
    arr.push({ t: text, f: from });
    sessionStorage.setItem('chat_history', JSON.stringify(arr));
  }

  _resetInputUI() {
    this.inputWrap.classList.remove('recording', 'preview');
    this.inputEl.placeholder = 'Escribe tu mensaje…';
    this.inputEl.style.display = '';
    this.btnMic.hidden = false;
    this.btnSend.disabled = false;
    this.audioWrapper?.remove();
    this.audioWrapper = null;
    this.pendingAudio = null;
  }

  _toggleRecording() {
    if (!this.isRecording) {
      this.isRecording = true;
      this.services.recorder.start();
      this.inputEl.placeholder = '🔴 Grabando… pulsa 🎤 para revisar';
      this.inputWrap.classList.add('recording');
    } else {
      this.isRecording = false;
      this.services.recorder.stop();
    }
  }

  _showAudioPreview(blob) {
    this._resetInputUI();
    this.pendingAudio = blob;
    this.inputWrap.classList.add('preview');
    this.inputEl.style.display = 'none';

    const wrap = Utils.createEl('div', { className: 'audio-preview-wrapper' });
    const audioId = 'plyr-' + crypto.randomUUID();
    const audio = Utils.createEl('audio', {
      attrs: { id: audioId, controls: '', preload: 'metadata' }
    });
    audio.src = URL.createObjectURL(blob);
    wrap.appendChild(audio);

    const reBtn = Utils.createEl('button', {
      className: 'btn-small', text: '🔄', title: 'Regrabar'
    });
    const delBtn = Utils.createEl('button', {
      className: 'btn-small', text: '❌', title: 'Cancelar'
    });
    reBtn.onclick = () => { this._resetInputUI(); this.btnMic.click(); };
    delBtn.onclick = () => this._resetInputUI();
    wrap.append(reBtn, delBtn);

    this.inputWrap.insertBefore(wrap, this.btnSend);
    this.btnMic.hidden = true;
    this.audioWrapper = wrap;

    setTimeout(() => {
      if (window.Plyr) {
        new Plyr('#' + audioId, {
          controls: ['play', 'progress', 'current-time'],
          tooltips: { controls: false }
        });
      }
    }, 0);
  }

  async _onSendAudio() {
    if (!this.pendingAudio) return;

    const audioBlob = this.pendingAudio;
    const userWrap = Utils.createEl('div', { className: 'chat-message user' });
    const audioEl = Utils.createEl('audio', {
      attrs: { controls: '', preload: 'metadata' }
    });
    audioEl.src = URL.createObjectURL(audioBlob);
    userWrap.appendChild(audioEl);
    this.outputEl.appendChild(userWrap);
    this._scrollToBottom();

    this.pendingAudio = null;
    this._resetInputUI();

    const loading = Utils.createEl('div', { className: 'chat-message bot' });
    const avatar = Utils.createEl('div', {
      className: 'avatar', text: '🤖', attrs: { 'aria-hidden': 'true' }
    });
    const bubble = Utils.createEl('div', {
      className: 'chat-bubble', text: '🎧 Enviando audio…'
    });
    loading.append(avatar, bubble);
    this.outputEl.appendChild(loading);
    this._scrollToBottom();

    const form = new FormData();
    form.append('AudioFile', audioBlob, 'recording.webm');
    if (this.state.sessionId) form.append('sessionId', this.state.sessionId);
    form.append('usuario', this.state.usuario);
    form.append('correo', this.state.email);

    try {
      const resp = await fetch(this.services.audioEndpoint, {
        method: 'POST', body: form
      });
      const raw = await resp.text();

      if (!resp.ok) {
        bubble.textContent = '⚠️ Error enviando audio.';
      } else {
        const data = JSON.parse(raw);
        if (data.sessionId) {
          this.state.sessionId = data.sessionId;
          sessionStorage.setItem('chatbot_sessionId', data.sessionId);
        }
        const respuesta = (data.respuesta || '').trim();
        bubble.textContent = respuesta || '✓ Audio recibido';
      }
    } catch (e) {
      console.error(e);
      bubble.textContent = '⚠️ Error enviando audio.';
    }

    bubble.appendChild(
      Utils.createEl('span', {
        className: 'timestamp', text: Utils.formatTime()
      })
    );
  }

  async _openChat() {
    this.container.setAttribute('aria-hidden', 'false');
    this.toggleBtn.style.display = 'none';
    this.inputEl.focus();
  }

  _closeChat() {
    this.container.setAttribute('aria-hidden', 'true');
    this.toggleBtn.style.display = 'flex';
  }

  async _onSend() {
    const now = Date.now();
    if (now - this.lastMessageTime < this.MIN_MESSAGE_INTERVAL) {
      return;
    }
    this.lastMessageTime = now;

    const txt = this.inputEl.value.trim();
    if (!txt) return;

    // El procesamiento se delega al ChatBotHibrido
  }

  appendMessage(text, from) {
    if (!this.outputEl) {
      console.error('Error: outputEl no está inicializado');
      return;
    }

    const clean = (text || '').trim();
    if (!clean) return;

    // Evitar duplicados
    const last = this.outputEl.lastElementChild;
    const prev = last?.previousElementSibling;
    const sameContent = (el) => {
      if (!el) return false;
      const bubble = el.querySelector('.chat-bubble')?.childNodes[0]?.textContent || '';
      return bubble.trim().localeCompare(clean, undefined, { sensitivity: 'base' }) === 0;
    };
    if (sameContent(last) || sameContent(prev)) return;

    const time = Utils.formatTime();
    const msg = Utils.createEl('div', { className: `chat-message ${from}` });

    // Detectar audio HTML
    const isAudioHTML = clean.startsWith('<audio') || clean.includes('<audio');

    let bubble;

    if (isAudioHTML) {
      // Manejo de audio
      const audioId = 'chat-audio-' + crypto.randomUUID();
      const audioWrapper = Utils.createEl('div', { className: 'audio-custom-wrapper' });
      audioWrapper.innerHTML = `
        <button class="audio-play-btn paused"></button>
        <div class="audio-progress-container">
          <div class="audio-progress-bar"></div>
        </div>
        <div class="audio-time">0:00</div>
        <audio id="${audioId}" preload="metadata" hidden>${clean}</audio>
      `;

      if (from === 'bot') {
        msg.append(
          Utils.createEl('div', { className: 'avatar', text: '🤖', attrs: { 'aria-hidden': 'true' } }),
          audioWrapper
        );
      } else if (from === 'agent') {
        msg.append(
          Utils.createEl('span', { className: 'username agent', text: 'Agente' }),
          audioWrapper
        );
      } else {
        msg.append(
          Utils.createEl('span', { className: 'username', text: this.state.usuario || 'Usuario' }),
          audioWrapper
        );
      }

      this.outputEl.appendChild(msg);
      this._scrollToBottom();
      return audioWrapper;

    } else {
      // Crear la burbuja de mensaje normal
      bubble = Utils.createEl('div', {
        className: 'chat-bubble'
      });

      // Verificar si el contenido tiene HTML válido
      if (clean.includes('<') && clean.includes('>')) {
        bubble.innerHTML = clean;
      } else {
        bubble.textContent = clean;
      }

      if (from === 'user') {
        msg.append(
          Utils.createEl('span', { className: 'username', text: this.state.usuario || 'Usuario' }),
          bubble
        );
      } else if (from === 'agent') {
        msg.append(
          Utils.createEl('span', { className: 'username agent', text: 'Agente' }),
          bubble
        );
      } else {
        msg.append(
          Utils.createEl('div', { className: 'avatar', text: '🤖', attrs: { 'aria-hidden': 'true' } }),
          bubble
        );
      }

      bubble.appendChild(
        Utils.createEl('span', { className: 'timestamp', text: time })
      );

      this.outputEl.appendChild(msg);
      this._scrollToBottom();
      this._saveHistory(clean, from);

      // TTS solo si no estamos en modo IA
      const isIA = (this.state.stage === 'ia' || this.state.modoIA === true || this.state.estado === 'ia');
      if (this.speech && this.speech.speak && !isIA) {
        const textToSpeak = clean.replace(/\s*\d{1,2}:\d{2}\s*(?:am|pm)?\s*$/i, '').trim();
        this.speech.speak(textToSpeak);
      }

    }

    return bubble;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // MÉTODOS PARA BOTONES DENTRO DEL CHAT
  // ═══════════════════════════════════════════════════════════════════════════════

  showOptions(opts = [], onSelect = () => { }) {
    if (!opts.length) return;

    // Limpiar botones anteriores
    this.clearOptions();

    // Crear contenedor de botones como un mensaje del bot
    const buttonsMessage = Utils.createEl('div', { className: 'chat-message bot buttons-message' });

    const avatar = Utils.createEl('div', {
      className: 'avatar',
      text: '🤖',
      attrs: { 'aria-hidden': 'true' }
    });

    const buttonsContainer = Utils.createEl('div', {
      className: 'chat-buttons-container'
    });

    // Crear botones
    opts.forEach((opt, index) => {
      const btn = Utils.createEl('button', {
        className: 'chat-decision-btn',
        text: opt.text
      });

      // Agregar animación escalonada
      btn.style.animationDelay = `${index * 100}ms`;

      btn.addEventListener('click', () => {
        // Agregar efecto visual al hacer clic
        btn.classList.add('clicked');

        setTimeout(() => {
          this.clearOptions();
          onSelect(opt.id);
        }, 150);
      });

      buttonsContainer.appendChild(btn);
    });

    buttonsMessage.append(avatar, buttonsContainer);
    this.outputEl.appendChild(buttonsMessage);

    // Guardar referencia para poder limpiar después
    this.currentButtonsContainer = buttonsMessage;

    this._scrollToBottom();

    return buttonsContainer;
  }

  clearOptions() {
    if (this.currentButtonsContainer) {
      // Efecto de fade out antes de remover
      this.currentButtonsContainer.style.opacity = '0.5';
      this.currentButtonsContainer.style.pointerEvents = 'none';

      setTimeout(() => {
        if (this.currentButtonsContainer && this.currentButtonsContainer.parentNode) {
          this.currentButtonsContainer.remove();
        }
        this.currentButtonsContainer = null;
      }, 200);
    }
  }

  _showTyping() {
    if (this.typingElement) return;
    this.typingElement = Utils.createEl('div', { className: 'chat-message bot typing-message' });
    const avatar = Utils.createEl('div', { className: 'avatar', text: '🤖', attrs: { 'aria-hidden': 'true' } });
    const bubble = Utils.createEl('div', { className: 'chat-bubble', text: 'Bot está escribiendo...' });
    this.typingElement.append(avatar, bubble);
    this.outputEl.appendChild(this.typingElement);
    this._scrollToBottom();
  }

  _removeTyping() {
    if (this.typingElement) {
      this.typingElement.remove();
      this.typingElement = null;
    }
  }

  _onVoiceToggle() {
    if (!this.speech || !this.speech.toggleVoice) return;

    this.speech.toggleVoice();
    const on = this.speech.voiceMode;
    this.btnVoz.classList.toggle('active', on);

    if (!on) {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      return;
    }

    Array.from(this.outputEl.querySelectorAll('.chat-bubble')).forEach(b => {
      const t = b.textContent.replace(/\s*\d{1,2}:\d{2}\s*(?:am|pm)?\s*$/i, '').trim();
      if (this.speech && this.speech.speak) {
        this.speech.speak(t);
      }
    });
  }

  _scrollToBottom() {
    if (this.outputEl) {
      Utils.scrollToBottom(this.outputEl);
    }
  }

  _css() {
    return `
      :root{
        --primary:#1e40af;--secondary:#0f766e;--accent:#dc2626;--bg:#fff;--bot-bg:#dbeafe;--bot-text:#1e3a8a;--font:14px;
        --municipal-blue:#1e40af;--municipal-teal:#0f766e;--municipal-red:#dc2626;--municipal-green:#059669;
      }
      #chatbot-toggle{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border:none;border-radius:50%;
        background:linear-gradient(135deg,var(--municipal-blue)0%,var(--municipal-teal)100%);color:#fff;display:flex;align-items:center;justify-content:center;
        box-shadow:0 4px 12px rgba(30,64,175,.4);cursor:pointer;z-index:10000;transition:transform .3s ease;}
      #chatbot-toggle:hover{transform:scale(1.1);box-shadow:0 6px 20px rgba(30,64,175,.5);}
      #chatbot-container{position:fixed;bottom:20px;right:20px;width:380px;height:520px;display:none;flex-direction:column;
        border-radius:12px;background:var(--bg);box-shadow:0 6px 24px rgba(30,64,175,.3);font-family:"Segoe UI",sans-serif;overflow:hidden;z-index:9999;
        border:2px solid rgba(30,64,175,.1);}
      #chatbot-container[aria-hidden="false"]{display:flex;}
      .chat-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;
        background:linear-gradient(135deg,var(--municipal-blue)0%,var(--municipal-teal)100%);color:#fff;
        border-bottom:3px solid var(--municipal-red);}
      .chat-header #chat-title{font-weight:600;font-size:1.1em;display:flex;align-items:center;gap:8px;}
      .chat-header button{background:rgba(255,255,255,.1);border:none;font-size:1.2em;cursor:pointer;color:#fff;
        padding:6px;border-radius:6px;transition:all .2s ease;}
      .chat-header button:hover{background:rgba(255,255,255,.2);transform:scale(1.05);}
      .chat-output{flex:1;padding:12px;overflow-y:auto;background:linear-gradient(to bottom,#f8fafc,#f1f5f9);}
      .chat-input-container{display:flex;align-items:center;gap:8px;padding:10px;border-top:2px solid #e2e8f0;background:#fff;}
      .chat-input-container input{flex:1 1 0;padding:10px 16px;border:2px solid #cbd5e1;border-radius:25px;font-size:var(--font);
        transition:border-color .3s ease;}
      .chat-input-container input:focus{outline:none;border-color:var(--municipal-blue);box-shadow:0 0 0 3px rgba(30,64,175,.1);}
      .chat-input-container.recording input{border:2px solid var(--municipal-red);animation:pulse 1s infinite;}
      @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(220,38,38,.5);}70%{box-shadow:0 0 0 10px rgba(220,38,38,0);}100%{box-shadow:0 0 0 0 rgba(220,38,38,0);}}
      .chat-input-container.preview input{display:none;}
      .btn-icon,.btn-ctrl{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border:none;border-radius:8px;margin-left:4px;
        background:linear-gradient(135deg,var(--municipal-blue),var(--municipal-teal));color:#fff;box-shadow:0 3px 8px rgba(30,64,175,.3);cursor:pointer;transition:all .2s ease;}
      .btn-icon{border-radius:50%;}
      .btn-icon:hover,.btn-ctrl:hover{transform:scale(1.08);background:linear-gradient(135deg,#1d4ed8,#0d9488);box-shadow:0 4px 12px rgba(30,64,175,.4);}
      .btn-ctrl.active{background:linear-gradient(135deg,var(--municipal-green),#10b981);}
      #send-btn{margin-left:auto;background:linear-gradient(135deg,var(--municipal-red),#ef4444);}
      #send-btn:hover{background:linear-gradient(135deg,#dc2626,#f87171);}
      .chat-message{margin-bottom:12px;animation:fadeInUp .3s ease-out;}
      .chat-message.bot{display:flex;align-items:flex-start;}
      .chat-message.user{display:flex;flex-direction:column;align-items:flex-end;}
      .chat-message .chat-bubble{position:relative;padding:12px 16px 22px;border-radius:18px;max-width:80%;box-shadow:0 2px 8px rgba(0,0,0,.1);word-wrap:break-word;line-height:1.5;}
      .chat-message.bot .chat-bubble{background:var(--bot-bg);color:var(--bot-text);border:1px solid rgba(30,64,175,.1);}
      .chat-message.user .chat-bubble{background:linear-gradient(135deg,var(--municipal-blue),var(--municipal-teal));color:#fff;}
      .chat-message .timestamp{position:absolute;bottom:4px;right:10px;font-size:.7em;color:#64748b;}
      .chat-message.user .timestamp{color:rgba(255,255,255,0.8);}
      .chat-message.bot .avatar{font-size:1.8em;margin-right:10px;flex-shrink:0;background:linear-gradient(135deg,var(--municipal-blue),var(--municipal-teal));
        border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;color:#fff;border:2px solid #fff;box-shadow:0 2px 8px rgba(30,64,175,.2);}
      @keyframes fadeInUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
      .typing-indicator{display:flex;gap:4px;margin:8px 0;}
      .typing-indicator .dot{width:8px;height:8px;background:var(--municipal-blue);border-radius:50%;animation:blink 1.4s infinite both;}
      @keyframes blink{0%,20%{opacity:.2;}20%,50%{opacity:1;}50%,100%{opacity:.2;}}
      .audio-preview-wrapper{display:flex;align-items:center;gap:8px;background:rgba(30,64,175,.05);padding:8px 12px;border-radius:20px;border:1px solid rgba(30,64,175,.1);}
      .btn-small{width:34px;height:34px;border:none;border-radius:50%;background:var(--municipal-blue);color:#fff;cursor:pointer;
        display:flex;align-items:center;justify-content:center;transition:all .2s ease;}
      .btn-small:hover{transform:scale(1.15);background:var(--municipal-teal);}
      .username{font-size:.75em;color:var(--municipal-blue);font-weight:600;margin-bottom:4px;text-transform:capitalize;letter-spacing:.4px;text-align:right;}
      .typing-message .chat-bubble { font-size: 0.8rem; padding: 8px 12px; max-width: 60%; }
      .username.agent { font-size: .75em; font-weight: 600; color: var(--municipal-red); margin-bottom: 4px; text-transform: uppercase; letter-spacing: .5px;}
      
      /* ═══════════════════════════════════════════════════════════════════════════════ */
      /* ESTILOS PARA BOTONES DENTRO DEL CHAT - COLORES MUNICIPALES */
      /* ═══════════════════════════════════════════════════════════════════════════════ */
      
      .buttons-message {
        margin-bottom: 16px;
      }
      
      .chat-buttons-container {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 290px;
        margin-top: 6px;
      }
      
      .chat-decision-btn {
        width: 100%;
        border: 2px solid var(--municipal-blue);
        background: linear-gradient(135deg, #fff, #f8fafc);
        color: var(--municipal-blue);
        padding: 14px 18px;
        border-radius: 22px;
        font-weight: 600;
        font-size: 0.9rem;
        text-align: left;
        cursor: pointer;
        transition: all .3s ease;
        position: relative;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(30,64,175,.1);
        
        /* Animación de entrada */
        opacity: 0;
        transform: translateY(10px);
        animation: buttonSlideIn 0.4s ease-out forwards;
      }
      
      @keyframes buttonSlideIn {
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      .chat-decision-btn:hover {
        background: linear-gradient(135deg, var(--municipal-blue), var(--municipal-teal));
        color: #fff;
        transform: translateX(6px);
        box-shadow: 0 6px 20px rgba(30,64,175,.3);
        border-color: var(--municipal-teal);
      }
      
      .chat-decision-btn:active {
        transform: translateX(3px) scale(0.98);
      }
      
      .chat-decision-btn.clicked {
        background: linear-gradient(135deg, var(--municipal-red), #ef4444);
        color: #fff;
        transform: scale(0.95);
        border-color: var(--municipal-red);
      }
      
      /* Efecto de onda al hacer clic */
      .chat-decision-btn::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 0;
        height: 0;
        border-radius: 50%;
        background: rgba(30,64,175, 0.2);
        transform: translate(-50%, -50%);
        transition: width 0.6s, height 0.6s;
      }
      
      .chat-decision-btn:active::before {
        width: 300px;
        height: 300px;
      }
      
      /* Indicadores especiales para diferentes tipos de opciones */
      .chat-decision-btn:has-text("🔗")::after {
        content: '→';
        position: absolute;
        right: 15px;
        top: 50%;
        transform: translateY(-50%);
        font-weight: bold;
        color: var(--municipal-green);
      }
      
      /* Responsive para botones */
      @media (max-width: 480px) {
        .chat-buttons-container {
          max-width: 100%;
        }
        
        .chat-decision-btn {
          font-size: 0.85rem;
          padding: 12px 16px;
        }
      }
      
      /* Scrollbar personalizada con colores municipales */
      .chat-output::-webkit-scrollbar {
        width: 8px;
      }
      .chat-output::-webkit-scrollbar-track {
        background: #f1f5f9;
        border-radius: 4px;
      }
      .chat-output::-webkit-scrollbar-thumb {
        background: linear-gradient(to bottom, var(--municipal-blue), var(--municipal-teal));
        border-radius: 4px;
      }
      .chat-output::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(to bottom, #1d4ed8, #0d9488);
      }
      
      /* Efectos especiales para enlaces */
      .chat-bubble a {
        color: var(--municipal-red) !important;
        text-decoration: none;
        font-weight: 600;
        border-radius: 20px;
        padding: 10px 16px;
        background: linear-gradient(135deg, var(--municipal-green), #10b981);
        color: #fff !important;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin: 8px 0;
        transition: all .3s ease;
        box-shadow: 0 3px 10px rgba(5,150,105,.3);
      }
      
      .chat-bubble a:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(5,150,105,.4);
        background: linear-gradient(135deg, #059669, #0d9488);
      }
      
      /* Efectos de mensaje */
      .chat-bubble strong {
        font-weight: 700;
        color: var(--municipal-blue);
      }
      .chat-bubble em {
        font-style: italic;
        color: var(--municipal-teal);
      }
      
      /* Responsive */
      @media (max-width: 480px) {
        #chatbot-container {
          width: calc(100vw - 20px);
          height: calc(100vh - 40px);
          bottom: 10px;
          right: 10px;
        }
        
        .chat-header {
          padding: 10px 12px;
        }
        
        .chat-buttons-container {
          max-width: 100%;
        }
      }
      
      /* Animación del indicador de municipalidad */
      @keyframes municipalPulse {
        0% { 
          box-shadow: 0 0 0 0 rgba(30,64,175,.7);
        }
        70% { 
          box-shadow: 0 0 0 10px rgba(30,64,175,0);
        }
        100% { 
          box-shadow: 0 0 0 0 rgba(30,64,175,0);
        }
      }

      .btn-label {
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(255, 255, 255, 0.15);
        border: none;
        border-radius: 8px;
        color: #fff;
        font-weight: 500;
        padding: 6px 10px;
        cursor: pointer;
        transition: background 0.3s ease;
      }

      .btn-label:hover {
        background: rgba(255, 255, 255, 0.25);
      }

      
      #chatbot-toggle {
        animation: municipalPulse 2s infinite;
      }
        .btn-icon[title*="archivo"] {
        background: linear-gradient(135deg, var(--municipal-green), #10b981);
        transition: all 0.3s ease;
      }

      .btn-icon[title*="archivo"]:hover:not(:disabled) {
        background: linear-gradient(135deg, #059669, #0d9488);
        transform: scale(1.08);
        box-shadow: 0 4px 12px rgba(5, 150, 105, 0.4);
      }

      .btn-icon[title*="archivo"]:disabled {
        background: #94a3b8 !important;
        cursor: not-allowed;
        opacity: 0.5;
        transform: none;
      }

      /* Indicador de archivo en mensajes */
      .chat-message.file {
        border-left: 4px solid var(--municipal-green);
        background: rgba(5, 150, 105, 0.05);
      }

      .file-info {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.9);
        border-radius: 12px;
        margin: 4px 0;
        border: 1px solid rgba(5, 150, 105, 0.2);
      }

      .file-icon {
        font-size: 1.5em;
        color: var(--municipal-green);
      }

      .file-details {
        flex: 1;
      }

      .file-name {
        font-weight: 600;
        color: var(--municipal-blue);
        font-size: 0.9em;
      }

      .file-size {
        font-size: 0.8em;
        color: #64748b;
        margin-top: 2px;
      }

      /* Animación para botón de archivo habilitado */
      @keyframes fileButtonEnabled {
        0% { transform: scale(1); }
        50% { transform: scale(1.05); }
        100% { transform: scale(1); }
      }

      .btn-icon[title*="archivo"]:not(:disabled).file-enabled {
        animation: fileButtonEnabled 0.6s ease-in-out;
      }
    `;
  }
}