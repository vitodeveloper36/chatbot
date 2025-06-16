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
    if (document.getElementById('chatbot-styles')) return;
    const link = Utils.createEl('link', {
      attrs: {
        rel: 'stylesheet',
        href: 'css/chatbot.css',
        id: 'chatbot-styles'
      }
    });
    document.head.appendChild(link);
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

}