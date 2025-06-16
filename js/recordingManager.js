export class RecordingManager {
  constructor() {
    this.mediaRecorder = null;
    this.mediaStream = null;
    this.chunks = [];
    this.onStopCallback = null;
    this.onStartCallback = null;
    this.onErrorCallback = null;
    
    // ✅ CORREGIDO: Usar propiedades privadas para evitar conflictos con getters/setters
    this._isSupported = !!navigator.mediaDevices?.getUserMedia;
    this._isRecording = false;
  }

  // AGREGAR: Método init() que faltaba
  async init() {
    if (!this._isSupported) {
      console.warn('getUserMedia no soportado en este navegador');
      return false;
    }

    try {
      // Verificar permisos de micrófono
      const result = await navigator.permissions.query({ name: 'microphone' });
      console.log(`🎤 Permisos de micrófono: ${result.state}`);
      
      if (result.state === 'denied') {
        throw new Error('Permisos de micrófono denegados');
      }
      
      console.log('✅ RecordingManager inicializado correctamente');
      return true;
    } catch (error) {
      console.error('❌ Error inicializando RecordingManager:', error);
      return false;
    }
  }

  async start() {
    if (this._isRecording) {
      console.warn('Ya se está grabando');
      return false;
    }

    try {
      // Solicitar acceso al micrófono
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        }
      });

      // Crear MediaRecorder
      const options = this._getRecorderOptions();
      this.mediaRecorder = new MediaRecorder(this.mediaStream, options);

      // Configurar eventos
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      this.mediaRecorder.onstart = () => {
        this._isRecording = true; // ✅ CORREGIDO: Usar propiedad privada
        console.log('🎤 Grabación iniciada');
        if (this.onStartCallback) {
          this.onStartCallback();
        }
      };

      this.mediaRecorder.onstop = () => {
        this._isRecording = false; // ✅ CORREGIDO: Usar propiedad privada
        console.log('⏹️ Grabación detenida');
        
        // Crear blob de audio
        const audioBlob = new Blob(this.chunks, { type: this.mediaRecorder.mimeType });
        
        // Limpiar chunks
        this.chunks = [];
        
        // Detener stream
        this._stopStream();
        
        if (this.onStopCallback) {
          this.onStopCallback(audioBlob);
        }
      };

      this.mediaRecorder.onerror = (event) => {
        console.error('❌ Error en grabación:', event.error);
        this._isRecording = false; // ✅ CORREGIDO: Usar propiedad privada
        this._stopStream();
        
        if (this.onErrorCallback) {
          this.onErrorCallback(event.error);
        }
      };

      // Iniciar grabación
      this.mediaRecorder.start();
      return true;

    } catch (error) {
      console.error('Error iniciando grabación:', error);
      this._isRecording = false; // ✅ CORREGIDO: Usar propiedad privada
      this._stopStream();
      
      if (this.onErrorCallback) {
        this.onErrorCallback(error);
      }
      
      return false;
    }
  }

  stop() {
    if (!this._isRecording || !this.mediaRecorder) { // ✅ CORREGIDO: Usar propiedad privada
      console.warn('No hay grabación activa');
      return false;
    }

    try {
      this.mediaRecorder.stop();
      return true;
    } catch (error) {
      console.error('Error deteniendo grabación:', error);
      this._isRecording = false; // ✅ CORREGIDO: Usar propiedad privada
      this._stopStream();
      return false;
    }
  }

  cancel() {
    if (this.mediaRecorder) {
      this.chunks = []; // Limpiar chunks antes de detener
      this.stop();
    }
    this._stopStream();
    this._isRecording = false; // ✅ CORREGIDO: Usar propiedad privada
  }

  _stopStream() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        track.stop();
      });
      this.mediaStream = null;
    }
  }

  _getRecorderOptions() {
    const mimeTypes = [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/webm',
      'audio/ogg',
      'audio/wav',
      'audio/mp4'
    ];

    for (const mimeType of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        console.log(`🎵 Usando formato: ${mimeType}`);
        return { mimeType };
      }
    }

    console.warn('⚠️ Usando formato por defecto');
    return {};
  }

  // Callbacks
  onStart(callback) {
    this.onStartCallback = callback;
  }

  onStop(callback) {
    this.onStopCallback = callback;
  }

  onError(callback) {
    this.onErrorCallback = callback;
  }

  // ✅ CORREGIDO: Propiedades de estado con getters/setters correctos
  get isRecording() {
    return this._isRecording;
  }

  set isRecording(value) {
    this._isRecording = value;
  }

  get isSupported() {
    return this._isSupported;
  }

  set isSupported(value) {
    this._isSupported = value;
  }
}