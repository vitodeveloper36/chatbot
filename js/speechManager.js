export class SpeechManager {
  constructor() {
    this.synthesis = window.speechSynthesis;
    this.recognition = null;
    this.voices = [];
    this.spanishVoices = []; // ← AGREGAR ESTA LÍNEA
    this.voiceMode = false;
    this.isSupported = 'speechSynthesis' in window;
    this.recognitionSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    this.currentUtterance = null;
    this.queue = [];
    this.isProcessingQueue = false;
    this.emotions = {
      happy: { rate: 1.1, pitch: 1.2 },
      sad: { rate: 0.8, pitch: 0.8 },
      excited: { rate: 1.3, pitch: 1.3 },
      calm: { rate: 0.9, pitch: 1.0 },
      default: { rate: 1.0, pitch: 1.0 }
    };
  }

  testSpeech() {
    console.log('🧪 Probando speech...');
    console.log('Voice mode:', this.voiceMode);
    console.log('Is supported:', this.isSupported);
    console.log('Voices loaded:', this.voices.length);

    if (!this.voiceMode) {
      console.log('⚠️ Voice mode está desactivado');
      return;
    }

    const testText = 'Hola, este es un mensaje de prueba';
    this.speak(testText);
  }

  // AGREGAR: Método init() que faltaba
  async init() {
    if (!this.isSupported) {
      console.warn('Speech Synthesis no soportado en este navegador');
      return false;
    }

    try {
      // Esperar a que las voces se carguen
      await this._initVoices();

      // Inicializar reconocimiento de voz si está soportado
      if (this.recognitionSupported) {
        this._initRecognition();
      }

      console.log('✅ SpeechManager inicializado correctamente');
      return true;
    } catch (error) {
      console.error('❌ Error inicializando SpeechManager:', error);
      return false;
    }
  }

  async _initVoices() {
    return new Promise((resolve) => {
      // Si ya hay voces disponibles
      if (this.synthesis.getVoices().length > 0) {
        this._cacheVoices();
        resolve();
        return;
      }

      // Esperar al evento voiceschanged
      const handleVoicesChanged = () => {
        this._cacheVoices();
        this.synthesis.removeEventListener('voiceschanged', handleVoicesChanged);
        resolve();
      };

      this.synthesis.addEventListener('voiceschanged', handleVoicesChanged);

      // Timeout de seguridad
      setTimeout(() => {
        this.synthesis.removeEventListener('voiceschanged', handleVoicesChanged);
        this._cacheVoices(); // Usar las voces que estén disponibles
        resolve();
      }, 3000);
    });
  }

  _cacheVoices() {
    this.voices = this.synthesis.getVoices();
    console.log(`🎵 ${this.voices.length} voces disponibles`);

    // Filtrar voces en español - CORREGIDO
    this.spanishVoices = this.voices.filter(voice =>
      voice.lang.startsWith('es') ||
      voice.name.toLowerCase().includes('spanish')
    );

    if (this.spanishVoices.length > 0) {
      console.log(`🇪🇸 ${this.spanishVoices.length} voces en español encontradas`);
    } else {
      console.warn('No se encontraron voces en español');
      this.spanishVoices = []; // Asegurar que sea un array vacío
    }
  }

  _initRecognition() {
    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();

      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.lang = 'es-ES';

      console.log('🎤 Reconocimiento de voz inicializado');
    } catch (error) {
      console.error('Error inicializando reconocimiento:', error);
      this.recognitionSupported = false;
    }
  }

  toggleVoice() {
    this.voiceMode = !this.voiceMode;
    console.log(`🔊 Modo voz: ${this.voiceMode ? 'ON' : 'OFF'}`);

    if (!this.voiceMode) {
      this.stopAll();
    }

    return this.voiceMode;
  }

  async speak(text, options = {}) {
    if (!this.isSupported || !this.voiceMode || !text.trim()) {
      return false;
    }

    try {
      // Asegurar que las voces estén cargadas
      if (this.voices.length === 0) {
        await this._initVoices();
      }

      const utterance = new SpeechSynthesisUtterance(text);

      // Configurar voz
      const voice = this._selectBestVoice(options.lang || 'es-ES');
      if (voice) {
        utterance.voice = voice;
      }

      // Configurar parámetros
      const emotion = this.emotions[options.emotion] || this.emotions.default;
      utterance.rate = options.rate || emotion.rate;
      utterance.pitch = options.pitch || emotion.pitch;
      utterance.volume = options.volume || 0.8;

      // Configurar eventos del utterance para monitorear el proceso de voz
      utterance.onstart = () => {
        console.log('🗣️ Comenzando a hablar:', text.substring(0, 50) + '...');
        this.currentUtterance = utterance;
      };

      utterance.onend = () => {
        console.log('✅ Terminó de hablar');
        this.currentUtterance = null;
      };

      utterance.onerror = (event) => {
        console.error('❌ Error al hablar:', event.error);
        this.currentUtterance = null;
      };

      // ¡CRÍTICO! Aquí es donde realmente se reproduce el audio
      this.synthesis.speak(utterance);

      return true;

    } catch (error) {
      console.error('Error en speak():', error);
      return false;
    }
  }

  speakWithEmotion(text, emotion = 'default') {
    return this.speak(text, { emotion });
  }

  async _processQueue() {
    if (this.isProcessingQueue || this.queue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const utterance = this.queue.shift();

      await new Promise((resolve) => {
        utterance.onend = resolve;
        utterance.onerror = resolve;
        this.synthesis.speak(utterance);
      });

      // Pequeña pausa entre utterances
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.isProcessingQueue = false;
  }

  _selectBestVoice(lang = 'es-ES') {
    // Inicializar spanishVoices si no existe
    if (!this.spanishVoices) {
      this.spanishVoices = [];
    }

    // Buscar voz específica del idioma
    let voice = this.voices.find(v => v.lang === lang && v.localService);

    if (!voice) {
      // Buscar cualquier voz del idioma
      voice = this.voices.find(v => v.lang.startsWith(lang.split('-')[0]));
    }

    if (!voice && this.spanishVoices.length > 0) {
      // Usar la primera voz en español disponible
      voice = this.spanishVoices[0];
    }

    return voice;
  }

  // Reconocimiento mejorado con filtros de ruido
  initRecognition(onResult, onError) {
    if (!this.recognitionSupported || !this.recognition) {
      console.warn('Reconocimiento de voz no soportado');
      return false;
    }

    this.recognition.onresult = (event) => {
      const result = event.results[0][0].transcript;
      const confidence = event.results[0][0].confidence;

      console.log(`🎤 Reconocido: "${result}" (confianza: ${confidence.toFixed(2)})`);

      if (confidence > 0.5) { // Filtro de confianza
        onResult(result, confidence);
      } else {
        console.warn('Baja confianza en reconocimiento');
      }
    };

    this.recognition.onerror = (event) => {
      console.error('Error en reconocimiento:', event.error);
      if (onError) onError(event.error);
    };

    this.recognition.onend = () => {
      console.log('Reconocimiento terminado');
    };

    return true;
  }

  startRecognition() {
    if (!this.recognition) {
      console.warn('Reconocimiento no inicializado');
      return false;
    }

    try {
      this.recognition.start();
      console.log('🎤 Iniciando reconocimiento de voz');
      return true;
    } catch (error) {
      console.error('Error iniciando reconocimiento:', error);
      return false;
    }
  }

  stopRecognition() {
    if (this.recognition) {
      this.recognition.stop();
      console.log('⏹️ Deteniendo reconocimiento de voz');
    }
  }

  stopAll() {
    // Detener síntesis
    if (this.synthesis.speaking) {
      this.synthesis.cancel();
    }

    // Limpiar cola
    this.queue = [];
    this.currentUtterance = null;
    this.isProcessingQueue = false;

    // Detener reconocimiento
    this.stopRecognition();

    console.log('🔇 Todos los servicios de voz detenidos');
  }

  pause() {
    if (this.synthesis.speaking) {
      this.synthesis.pause();
    }
  }

  resume() {
    if (this.synthesis.paused) {
      this.synthesis.resume();
    }
  }

  // Propiedades de estado
  get isSpeaking() {
    return this.synthesis.speaking;
  }

  get isPaused() {
    return this.synthesis.paused;
  }

  get availableVoices() {
    return this.voices;
  }

  get spanishVoicesAvailable() {
    return this.spanishVoices;
  }
}