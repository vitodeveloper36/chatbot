import { UIManager } from './uiManager.js';
import { ApiClient } from './apiClient.js';
import { ConfigLoader } from './configLoader.js';
import { SpeechManager } from './speechManager.js';
import { RecordingManager } from './recordingManager.js';
import { decisionTree, findNode, getChildren, searchNodes } from './decisionTree.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN Y ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

const ENDPOINTS = {
    mensaje: 'https://localhost:7053/api/chatbot/mensaje',
    config: 'https://localhost:7053/api/chatbot/config',
    audio: 'https://localhost:7053/api/chatbot/audio'
};

const ESTADOS = {
    ARBOL: 'arbol',
    IA: 'ia',
    AGENTE: 'agente'
};

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICIOS MOCK PARA DESARROLLO
// ═══════════════════════════════════════════════════════════════════════════════

class MockApiClient {
    constructor(url) {
        this.url = url;
    }

    async send(payload) {
        console.log('Mock API call:', payload);
        // Simular respuesta de API
        return {
            respuesta: 'Esta es una respuesta simulada de la IA.',
            sessionId: payload.sessionId || 'mock-session-' + Date.now(),
            origen: 'IA'
        };
    }
}

class MockConfigLoader {
    constructor(url) {
        this.url = url;
    }

    async load() {
        console.log('Mock config load');
        return {
            mensajeBienvenida: '¡Hola! Soy tu asistente de la Municipalidad de Puente Alto. Te ayudaré paso a paso.'
        };
    }
}

class MockSpeechManager {
    constructor() {
        this.voiceMode = false;
        this.isAgentMode = false;
    }

    speak(text) {

        if (this.isAgentMode) {
            console.log('🔇 Mock TTS silenciado (modo agente):', text);
            return;
        }
        console.log('Mock TTS:', text);
    }

    toggleVoice() {
        this.voiceMode = !this.voiceMode;
        return this.voiceMode;
    }

    // CORREGIDO: Método para controlar el modo agente
    setAgentMode(isAgentMode) {
        this.isAgentMode = isAgentMode;
        console.log('🔧 Mock TTS modo agente:', isAgentMode ? 'SILENCIADO' : 'ACTIVO');
    }
}

class MockRecordingManager {
    constructor() {
        this.onStopCallback = null;
    }

    async init() {
        console.log('Mock recorder initialized');
    }

    start() {
        console.log('Mock recording started');
    }

    stop() {
        console.log('Mock recording stopped');
    }

    onStop(callback) {
        this.onStopCallback = callback;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLASE PRINCIPAL DEL CHATBOT HÍBRIDO
// ═══════════════════════════════════════════════════════════════════════════════

class ChatBotHibrido {
    constructor() {
        this.estado = ESTADOS.ARBOL;
        this.historialConversacion = [];
        this.nivelActual = 'root';

        // Estado del usuario
        this.state = {
            usuario: sessionStorage.getItem('chatbot_usuario') || '',
            email: sessionStorage.getItem('chatbot_correo') || '',
            sessionId: sessionStorage.getItem('chatbot_sessionId') || null,
            stage: 0
        };

        // Usar servicios mock para desarrollo local
        this.services = {
            apiClient: new MockApiClient(ENDPOINTS.mensaje),
            configLoader: new MockConfigLoader(ENDPOINTS.config),
            speechManager: new MockSpeechManager(),
            recorder: new MockRecordingManager(),
            audioEndpoint: ENDPOINTS.audio
        };

        this.ui = null;
        this.intentosFallidos = 0;
        this.maxIntentosSinRespuesta = 2;
    }

    // ───────────────────────────────────────────────────────────────────────────
    // INICIALIZACIÓN
    // ───────────────────────────────────────────────────────────────────────────

    async init() {
        try {
            // Inicializar servicios de audio
            await this.initAudioServices();

            // Crear UI Manager
            this.ui = new UIManager(this.state, this.services);
            await this.ui.init();

            // Configurar manejadores
            this.setupEventHandlers();

            // Iniciar conversación
            await this.iniciarConversacion();

            console.log('ChatBot Híbrido inicializado correctamente');
            return true;
        } catch (error) {
            console.error('Error inicializando ChatBot:', error);
            return false;
        }
    }

    async initAudioServices() {
        try {
            await this.services.recorder.init();
        } catch (err) {
            console.warn('Audio no disponible:', err);
        }
    }

    setupEventHandlers() {
        // Interceptar envío de mensajes del usuario
        const originalOnSend = this.ui._onSend.bind(this.ui);
        this.ui._onSend = async () => {
            await this.procesarMensajeUsuario();
        };
    }

    // ───────────────────────────────────────────────────────────────────────────
    // LÓGICA PRINCIPAL DE CONVERSACIÓN
    // ───────────────────────────────────────────────────────────────────────────

    async iniciarConversacion() {
        let config = {};
        try {
            config = await this.services.configLoader.load();
        } catch (error) {
            console.warn('No se pudo cargar configuración:', error);
            config = { mensajeBienvenida: '¡Hola! Soy tu asistente de la Municipalidad de Puente Alto.' };
        }

        const mensajeBienvenida = config.mensajeBienvenida ||
            '¡Hola! Soy tu asistente de la Municipalidad de Puente Alto. Te ayudaré paso a paso.';

        this.ui.appendMessage(mensajeBienvenida, 'bot');

        // Si el usuario ya está registrado, ir directo al árbol
        if (this.state.usuario && this.state.email) {
            this.mostrarOpcionesArbol();
        } else {
            // El registro lo maneja el UIManager automáticamente
            console.log('Usuario necesita registrarse');
        }
    }

    async procesarMensajeUsuario() {
        const input = this.ui.inputEl.value.trim();
        if (!input) return;

        // Mostrar mensaje del usuario
        this.ui.appendMessage(input, 'user');
        this.ui.inputEl.value = '';

        // Agregar al historial
        this.historialConversacion.push({
            rol: 'usuario',
            mensaje: input,
            timestamp: new Date()
        });

        // Si aún está en registro, manejar eso primero
        if (this.ui.userStage < 2) {
            return; // El UIManager maneja el registro automáticamente
        }

        // Procesamiento según el estado actual
        switch (this.estado) {
            case ESTADOS.ARBOL:
                await this.procesarEnArbol(input);
                break;
            case ESTADOS.IA:
                await this.procesarConIA(input);
                break;
            case ESTADOS.AGENTE:
                await this.procesarConAgente(input);
                break;
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // MANEJO DEL ÁRBOL DE DECISIONES
    // ───────────────────────────────────────────────────────────────────────────

    async procesarEnArbol(input) {
        // 1. Intentar buscar respuesta exacta en el árbol actual
        const respuestaExacta = this.buscarRespuestaExacta(input);
        if (respuestaExacta) {
            this.intentosFallidos = 0;
            return this.manejarSeleccionArbol(respuestaExacta.id);
        }

        // 2. Búsqueda inteligente por palabras clave
        const resultadosBusqueda = this.buscarPorPalabrasClave(input);
        if (resultadosBusqueda.length > 0) {
            this.intentosFallidos = 0;
            return this.mostrarResultadosBusqueda(resultadosBusqueda);
        }

        // 3. Intentar navegación (volver, menú, inicio, etc.)
        if (this.esComandoNavegacion(input)) {
            this.intentosFallidos = 0;
            return this.manejarNavegacion(input);
        }

        // 4. No se encontró respuesta en el árbol
        this.intentosFallidos++;

        if (this.intentosFallidos >= this.maxIntentosSinRespuesta) {
            await this.escalarAIA();
        } else {
            this.mostrarSugerenciasArbol(input);
        }
    }

    buscarRespuestaExacta(input) {
        const nodoActual = findNode(this.nivelActual);
        if (!nodoActual?.children) return null;

        const inputLower = input.toLowerCase();
        return nodoActual.children.find(child => {
            const textoChild = child.text.toLowerCase();
            return textoChild.includes(inputLower) ||
                inputLower.includes(textoChild) ||
                this.calcularSimilitud(inputLower, textoChild) > 0.7;
        });
    }

    buscarPorPalabrasClave(input) {
        const palabrasClave = this.extraerPalabrasClave(input);
        const resultados = [];

        function buscarEnNodo(nodo, nivel = 0) {
            if (!nodo) return;

            // Calcular relevancia del nodo actual
            const relevancia = palabrasClave.reduce((acc, palabra) => {
                if (nodo.text.toLowerCase().includes(palabra.toLowerCase())) {
                    return acc + 1;
                }
                return acc;
            }, 0);

            if (relevancia > 0) {
                resultados.push({
                    nodo,
                    relevancia,
                    nivel,
                    path: nodo.text
                });
            }

            // Buscar en hijos
            if (nodo.children) {
                nodo.children.forEach(child => buscarEnNodo(child, nivel + 1));
            }
        }

        buscarEnNodo(decisionTree);
        return resultados
            .sort((a, b) => b.relevancia - a.relevancia || a.nivel - b.nivel)
            .slice(0, 5);
    }

    extraerPalabrasClave(input) {
        const stopWords = ['el', 'la', 'de', 'que', 'y', 'a', 'en', 'un', 'es', 'se', 'no', 'te', 'lo', 'le', 'da', 'su', 'por', 'son', 'con', 'para', 'como', 'está', 'me', 'si', 'sin', 'sobre', 'este', 'ya', 'entre', 'cuando', 'todo', 'esta', 'ser', 'tiene', 'sus', 'era', 'tanto', 'dos', 'puede', 'hasta', 'otros', 'parte', 'desde', 'más', 'muy', 'fue', 'son', 'tiempo', 'cada', 'él', 'ella'];

        return input.toLowerCase()
            .split(/\s+/)
            .filter(palabra => palabra.length > 2 && !stopWords.includes(palabra))
            .filter(palabra => /^[a-záéíóúñü]+$/i.test(palabra));
    }

    calcularSimilitud(str1, str2) {
        const len1 = str1.length;
        const len2 = str2.length;
        const matrix = Array(len2 + 1).fill().map(() => Array(len1 + 1).fill(0));

        for (let i = 0; i <= len1; i++) matrix[0][i] = i;
        for (let j = 0; j <= len2; j++) matrix[j][0] = j;

        for (let j = 1; j <= len2; j++) {
            for (let i = 1; i <= len1; i++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j - 1][i] + 1,
                    matrix[j][i - 1] + 1,
                    matrix[j - 1][i - 1] + cost
                );
            }
        }

        const maxLen = Math.max(len1, len2);
        return maxLen === 0 ? 1 : (maxLen - matrix[len2][len1]) / maxLen;
    }

    manejarSeleccionArbol(nodeId) {
        const nodo = findNode(nodeId);
        if (!nodo) {
            this.ui.appendMessage('❌ Opción no encontrada', 'bot');
            return this.mostrarOpcionesArbol();
        }

        // Si tiene link, es un destino final
        if (nodo.link) {
            this.ui.appendMessage(`📋 ${nodo.text}`, 'bot');
            this.ui.appendMessage(`🔗 Enlace: ${nodo.link}`, 'bot');

            setTimeout(() => {
                this.ui.appendMessage('¿Necesitas ayuda con algo más?', 'bot');
                this.volverAlInicio();
            }, 2000);

            return;
        }

        // Si tiene hijos, mostrar sub-opciones
        if (nodo.children?.length) {
            this.nivelActual = nodeId;
            this.ui.appendMessage(nodo.text, 'bot');
            this.mostrarOpciones(nodo.children);
            return;
        }

        // Nodo sin hijos ni link
        this.ui.appendMessage(`ℹ️ ${nodo.text}`, 'bot');
        this.volverAlInicio();
    }

    mostrarResultadosBusqueda(resultados) {
        this.ui.appendMessage('🔍 Encontré estas opciones relacionadas:', 'bot');

        const opciones = resultados.map(r => ({
            id: r.nodo.id,
            text: `${r.nodo.text} ${r.nodo.link ? '🔗' : ''}`,
            score: r.relevancia
        }));

        this.ui.showOptions(opciones, (id) => this.manejarSeleccionArbol(id));
    }

    mostrarSugerenciasArbol(input) {
        const sugerencias = [
            '💡 Intenta ser más específico',
            '📋 Usa palabras clave como "licencia", "pago", "trámite"',
            '🔄 Escribe "menú" para ver todas las opciones',
            '🆘 Escribe "ayuda" si necesitas asistencia'
        ];

        this.ui.appendMessage('❓ No encontré esa opción. Aquí tienes algunas sugerencias:', 'bot');
        sugerencias.forEach(sug => this.ui.appendMessage(sug, 'bot'));

        // Mostrar opciones actuales nuevamente
        setTimeout(() => this.mostrarOpcionesArbol(), 1500);
    }

    esComandoNavegacion(input) {
        const comandos = ['volver', 'atrás', 'menú', 'inicio', 'principal', 'ayuda', 'opciones'];
        return comandos.some(cmd => input.toLowerCase().includes(cmd));
    }

    manejarNavegacion(input) {
        const inputLower = input.toLowerCase();

        if (inputLower.includes('menú') || inputLower.includes('inicio') || inputLower.includes('principal')) {
            this.volverAlInicio();
        } else if (inputLower.includes('volver') || inputLower.includes('atrás')) {
            this.volverAtras();
        } else if (inputLower.includes('ayuda')) {
            this.mostrarAyuda();
        } else {
            this.mostrarOpcionesArbol();
        }
    }

    mostrarOpcionesArbol() {
        const nodoActual = findNode(this.nivelActual);
        if (nodoActual?.children) {
            this.mostrarOpciones(nodoActual.children);
        } else {
            this.volverAlInicio();
        }
    }

    mostrarOpciones(opciones) {
        this.ui.showOptions(opciones, (id) => this.manejarSeleccionArbol(id));
    }

    volverAlInicio() {
        this.nivelActual = 'root';
        this.estado = ESTADOS.ARBOL;
        this.intentosFallidos = 0;

        this.ui.appendMessage(decisionTree.text, 'bot');
        this.mostrarOpciones(decisionTree.children);
    }

    volverAtras() {
        // Por simplicidad, volver al inicio
        this.volverAlInicio();
    }

    mostrarAyuda() {
        const ayuda = `
🆘 **Ayuda del ChatBot**

**En el árbol de decisiones puedes:**
• Seleccionar opciones del menú
• Escribir palabras clave para buscar
• Usar comandos: "menú", "volver", "ayuda"

**Si no encuentro tu respuesta:**
• Te conectaré con inteligencia artificial
• Y si es necesario, con un agente humano

**Comandos útiles:**
• "menú" - Volver al inicio
• "volver" - Ir atrás
• "ayuda" - Mostrar esta ayuda
        `.trim();

        this.ui.appendMessage(ayuda, 'bot');

        setTimeout(() => {
            this.ui.appendMessage('¿En qué más puedo ayudarte?', 'bot');
            this.mostrarOpcionesArbol();
        }, 3000);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // ESCALADO A INTELIGENCIA ARTIFICIAL
    // ───────────────────────────────────────────────────────────────────────────

    async escalarAIA() {
        this.estado = ESTADOS.IA;
        this.ui.appendMessage('🤖 Te conectaré con nuestro asistente de IA para una ayuda más personalizada...', 'bot');

        // Procesar directamente con IA mock
        setTimeout(() => {
            this.ui.appendMessage('🤖 Modo IA activado. Ahora puedes hacer preguntas más complejas.', 'bot');
        }, 1000);
    }

    async procesarConIA(input) {
        this.ui._showTyping();

        try {
            // Usar servicio mock
            const respuesta = await this.services.apiClient.send({
                sessionId: this.state.sessionId,
                usuario: this.state.usuario,
                correo: this.state.email,
                mensaje: input
            });

            this.ui._removeTyping();
            this.ui.appendMessage(respuesta.respuesta, 'bot');

            // Opción para volver al árbol
            setTimeout(() => {
                this.ui.appendMessage('¿Prefieres volver al menú principal? Escribe "menú"', 'bot');
            }, 3000);

        } catch (error) {
            this.ui._removeTyping();
            console.error('Error con IA:', error);
            this.ui.appendMessage('❌ Error de conexión con IA.', 'bot');
        }
    }

    async escalarAAgente() {
        this.estado = ESTADOS.AGENTE;
        this.ui.appendMessage('👨‍💼 Función de agente no disponible en modo demo.', 'bot');
        this.volverAlInicio();
    }

    async procesarConAgente(input) {
        this.ui.appendMessage('👨‍💼 Modo agente no disponible en demo.', 'bot');
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    const chatbot = new ChatBotHibrido();
    const inicializado = await chatbot.init();

    if (!inicializado) {
        console.error('Error crítico inicializando el chatbot');
    }
});