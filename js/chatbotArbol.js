// Archivo actualizado: se eliminaron todas las referencias a ENDPOINTS

import { UIManager } from './uiManager.js';
import { decisionTree, findNode, getChildren } from './decisionTree.js';

// ESTADOS DE CHATBOT
const ESTADOS = {
    ARBOL: 'arbol',
    AGENTE: 'agente',
    CONECTANDO: 'conectando',
    DESCONECTANDO: 'desconectando',
    ERROR: 'error'
};

// GESTOR DE CONEXIÓN SIGNALR MEJORADO
class SignalRManager {
    constructor(chatbot) {
        this.chatbot = chatbot;
        this.connection = null;
        this.isConnecting = false;
        this.maxReconnectAttempts = 3;
        this.reconnectAttempts = 0;
        this.sessionId = null;
        this.heartbeatInterval = null;
        this._conversacionIniciada = false;
    }

    async connect() {
        if (this.isConnecting) return false;
        if (this.connection?.state === signalR.HubConnectionState.Connected) return true;
        this.isConnecting = true;
        this.chatbot.ui.appendMessage('🔄 Estableciendo conexión segura...', 'system');
        try {
            await this.disconnect();
            this.connection = new signalR.HubConnectionBuilder()
                .withUrl("https://localhost:7053/chatHub")
                .withAutomaticReconnect([0, 2000, 10000, 30000])
                .configureLogging(signalR.LogLevel.Information)
                .build();

            this.setupEvents();
            await this.connection.start();
            this.chatbot.ui.appendMessage('✅ Conexión establecida', 'system');

            const usuario = this.chatbot.state.usuario || 'Usuario Anónimo';
            const correo = this.chatbot.state.email || 'anonimo@correo.cl';
            await this.connection.invoke('RegisterUser', usuario, correo, null);

            this.startHeartbeat();
            this.reconnectAttempts = 0;
            return true;
        } catch (error) {
            this.handleConnectionError(error);
            return false;
        } finally {
            this.isConnecting = false;
        }
    }

    setupEvents() {
        const conn = this.connection;
        conn.off();
        conn.onreconnecting(() => this.chatbot.ui.appendMessage('🔄 Reconectando...', 'system'));
        conn.onreconnected(() => {
            this.chatbot.ui.appendMessage('✅ Reconexión exitosa', 'system');
            this.reconnectAttempts = 0;
        });
        conn.onclose(error => {
            this.stopHeartbeat();
            if (this.chatbot.estado === ESTADOS.AGENTE) {
                this.chatbot.ui.appendMessage('⚠️ Conexión perdida', 'system');
                this.handleReconnection();
            }
        });

        conn.on('SessionAssigned', data => {
            this.sessionId = data.sessionId;
            this.chatbot.state.sessionId = data.sessionId;
            this.chatbot.guardarSessionId();
            this.chatbot.ui.appendMessage(`🔑 Sesión creada: ${data.sessionId}`, 'system');
            this.chatbot.mostrarBotonCopiarSessionId(data.sessionId);
        });

        conn.on('AgentStatusUpdate', data => {
            if (data.status === 'connected') {
                this.chatbot.ui.appendMessage(`✅ ${data.message}`, 'system');
                this.chatbot.ui.clearOptions();
                this.chatbot.ui.appendMessage('💬 Agente listo. Puedes escribir tus mensajes.', 'system');
            } else {
                this.chatbot.ui.appendMessage(`📊 ${data.message}`, 'system');
            }
        });

        conn.on('ReceiveMessage', payload => this.handleIncomingMessage(payload));
        conn.on('AgentDisconnected', () => {
            this.chatbot.ui.appendMessage('🔌 El agente cerró la sesión', 'system');
            setTimeout(() => this.chatbot.finalizarChatAgente(), 1500);
        });
    }

    handleIncomingMessage(payload) {
        const { type, message, agent, timestamp, fileName, fileSize, fileType } = payload;
        switch (type) {
            case 'system_message':
                this.chatbot.ui.appendMessage(message, 'system', { timestamp: new Date(timestamp), agent: agent?.name || 'Sistema' });
                if (/desconect|cerr.*sesi[oó]n|timeout/i.test(message)) {
                    setTimeout(() => this.chatbot.finalizarChatAgente(), 1500);
                }
                break;
            case 'agent_message':
                this.chatbot.ui.appendMessage(message, 'agent', { timestamp: new Date(timestamp), agent: agent?.name || 'Agente', avatar: agent?.avatar || '🧑‍💼' });
                break;
            case 'file_upload':
                this.chatbot.ui.appendMessage(`📎 Archivo enviado: ${fileName} (${fileSize})`, 'user', { isFile: true, fileName, fileSize, fileType });
                break;
            default:
                this.chatbot.ui.appendMessage(message, 'system', { timestamp: new Date(timestamp) });
        }
    }

    async sendMessage(message) {
        if (!this.connection || this.connection.state !== signalR.HubConnectionState.Connected) throw new Error('No hay conexión activa');
        if (!this.sessionId) throw new Error('No hay sesión activa');
        await this.connection.invoke('SendMessageToAgent', this.sessionId, message);
    }

    handleConnectionError(error) {
        let mensaje = '❌ Error de conexión: ';
        if (error.message?.includes('404')) mensaje += 'Servidor no encontrado';
        else if (error.message?.includes('timeout')) mensaje += 'Tiempo agotado';
        else if (error.message?.includes('InvalidDataException')) mensaje += 'Error de parámetros';
        else mensaje += 'Fallo en la conexión';
        this.chatbot.ui.appendMessage(mensaje, 'system');
        this.chatbot.mostrarOpcionesErrorConexion();
    }

    async handleReconnection() {
        if (++this.reconnectAttempts > this.maxReconnectAttempts) {
            this.chatbot.ui.appendMessage('❌ Máximo de reintentos alcanzado', 'system');
            this.chatbot.finalizarChatAgente();
            return;
        }
        this.chatbot.ui.appendMessage(`🔄 Reintento ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`, 'system');
        const success = await this.connect();
        if (!success) setTimeout(() => this.handleReconnection(), 5000);
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(async () => {
            if (this.connection?.state === signalR.HubConnectionState.Connected) {
                try { await this.connection.invoke('Heartbeat'); } catch {} }
        }, 30000);
    }

    stopHeartbeat() { if (this.heartbeatInterval) clearInterval(this.heartbeatInterval); }

    async disconnect() {
        this.stopHeartbeat();
        if (this.connection) {
            if (this.sessionId) await this.connection.invoke('DisconnectUser', this.sessionId);
            await this.connection.stop();
            this.connection = null;
        }
        this.sessionId = null;
        this.reconnectAttempts = 0;
    }

    getConnectionState() { return this.connection?.state || 'Disconnected'; }
    isConnected() { return this.connection?.state === signalR.HubConnectionState.Connected; }
}

//--------------------------------------------------------------------------
// MOCK PARA DESARROLLO (sin referencias a ENDPOINTS)
//--------------------------------------------------------------------------

class MockSpeechManager {
    constructor() { this.voiceMode = false; this.isAgentMode = false; }
    speak(text) {
        if (this.isAgentMode) return;
        console.log('Mock TTS:', text);
    }
    toggleVoice() { this.voiceMode = !this.voiceMode; return this.voiceMode; }
    setAgentMode(isAgentMode) { this.isAgentMode = isAgentMode; }
}

class MockRecordingManager {
    constructor() { this.onStopCallback = null; }
    async init() { console.log('Mock recorder initialized'); }
    start() { console.log('Mock recording started'); }
    stop() { console.log('Mock recording stopped'); }
    onStop(callback) { this.onStopCallback = callback; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLASE PRINCIPAL DEL CHATBOT HÍBRIDO
// ═══════════════════════════════════════════════════════════════════════════════

class ChatBotHibrido {
    constructor() {
        this.estado = ESTADOS.ARBOL;
        this.historialConversacion = [];
        this.nivelActual = 'root';
        this.state = {
            usuario: null,
            email: null,
            sessionId: null,
            stage: 2
        };

        // CORREGIDO: Inicializar las propiedades que faltaban
        this._conversacionIniciada = false;
        this._mensajesGuardados = [];
        this._estadoConversacion = null;

        // AGREGAR: Propiedades de archivos
        this.fileUploadEnabled = false;
        this.maxFileSize = 100 * 1024 * 1024; // 10MB
        this.allowedTypes = ['.pdf', '.doc', '.docx'];
        this.fileButton = null;
        this.fileInput = null;

        // Usar servicios mock para desarrollo local
        this.services = {
            speechManager: new MockSpeechManager(),
            recorder: new MockRecordingManager(),
        };

        this.ui = null;
        this.intentosFallidos = 0;
        this.maxIntentosSinRespuesta = 2;
        this.resultadosBusquedaActuales = null;
        this.agentSocket = null;
    }

    // ───────────────────────────────────────────────────────────────────────────
    // INICIALIZACIÓN
    // ───────────────────────────────────────────────────────────────────────────

    async init() {
        try {
            console.log('🚀 Inicializando chatbot...');

            await this.initAudioServices();

            this.ui = new UIManager(this.state, this.services);
            await this.ui.init();

            this.setupFileUpload();

            this.setupEventHandlers();

            // CORREGIDO: Cargar datos de usuario PRIMERO
            console.log('🔍 Buscando datos de usuario guardados...');
            const datosGuardados = this.cargarDatosUsuario();

            if (datosGuardados && datosGuardados.nombre && datosGuardados.email) {
                console.log('✅ Datos de usuario encontrados:', datosGuardados);
                this.state.usuario = datosGuardados.nombre;
                this.state.email = datosGuardados.email;

                // Iniciar conversación directamente
                await this.iniciarConversacion();
            } else {
                console.log('⚠️ No se encontraron datos de usuario válidos, mostrando formulario');
                // Mostrar formulario de registro
                await this.mostrarFormularioRegistroDentroChat();
            }

            console.log('✅ ChatBot inicializado correctamente');
            return true;
        } catch (error) {
            console.error('❌ Error inicializando ChatBot:', error);
            return false;
        }
    }


    // NUEVO: Método para limpiar estado de conversación
    limpiarEstadoConversacion() {
        try {
            localStorage.removeItem('chatbot_estado_conversacion');
            this._mensajesGuardados = [];
            this._conversacionIniciada = false;
            this._estadoConversacion = null;
            console.log('🗑️ Estado de conversación limpiado');
        } catch (error) {
            console.warn('⚠️ Error limpiando estado:', error);
        }
    }

    setupFileUpload() {
        // Crear input de archivo (oculto)
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.pdf,.doc,.docx';
        this.fileInput.style.display = 'none';
        document.body.appendChild(this.fileInput);

        // Crear botón de archivo
        this.fileButton = document.createElement('button');
        this.fileButton.className = 'btn-icon';
        this.fileButton.innerHTML = '📎';
        this.fileButton.title = 'Enviar archivo (solo con agente)';
        this.fileButton.disabled = true;
        this.fileButton.style.opacity = '0.5';
        this.fileButton.style.background = '#94a3b8';

        // Agregar botón al contenedor de input
        const inputContainer = this.ui.container.querySelector('.chat-input-container');
        if (inputContainer) {
            const sendButton = inputContainer.querySelector('#send-btn');
            if (sendButton) {
                inputContainer.insertBefore(this.fileButton, sendButton);
            }
        }

        // Eventos
        this.fileButton.addEventListener('click', () => {
            if (this.fileUploadEnabled && this.estado === ESTADOS.AGENTE) {
                this.fileInput.click();
            } else {
                this.ui.appendMessage('📎 El envío de archivos solo está disponible cuando hablas con un agente', 'system');
            }
        });

        this.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.uploadFile(file);
            }
        });
    }

    async desconectarDeAgente() {
        try {
            this.deshabilitarSubidaArchivos();

            if (this.agentSocket) {
                await this.agentSocket.stop();
                this.agentSocket = null;
            }

            if (this.services.speechManager && typeof this.services.speechManager.setAgentMode === 'function') {
                this.services.speechManager.setAgentMode(false);
            }

            this.estado = ESTADOS.ARBOL; // MODIFICADO: Volver al árbol, no IA
            this.ui.appendMessage('👋 Desconectado del agente. Volviendo al menú principal...', 'system');

            // Volver al menú principal
            setTimeout(() => {
                this.volverAlInicio();
            }, 1000);

        } catch (error) {
            console.error('Error desconectando:', error);
        }
    }

    async mostrarFormularioRegistroDentroChat() {
        // Verificar que UI esté inicializada
        if (!this.ui) {
            console.error('Error: UI no inicializada');
            return;
        }

        // Agregar estilos CSS
        const styleId = 'chat-form-styles';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
            .chat-form-container {
                background-color: #f8f9fa;
                border-radius: 12px;
                padding: 16px;
                margin: 10px 0;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                border-left: 4px solid #4CAF50;
            }
            .chat-form-title {
                font-weight: bold;
                margin-bottom: 12px;
                color: #2E7D32;
            }
            .chat-form-field {
                margin-bottom: 12px;
            }
            .chat-form-field label {
                display: block;
                font-weight: 500;
                margin-bottom: 6px;
                color: #333;
            }
            .chat-form-field input {
                width: 100%;
                padding: 8px 12px;
                border: 1px solid #ddd;
                border-radius: 4px;
                font-size: 14px;
                box-sizing: border-box;
            }
            .chat-form-field input:focus {
                outline: none;
                border-color: #4CAF50;
                box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.2);
            }
            .chat-form-error {
                color: #e53935;
                font-size: 12px;
                margin-top: 4px;
                display: none;
            }
            .chat-form-submit {
                background: #4CAF50;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
                width: 100%;
            }
            .chat-form-submit:hover {
                background: #43A047;
            }
            .chat-form-submit:disabled {
                background: #ccc;
                cursor: not-allowed;
            }
            .input-error {
                border-color: #e53935 !important;
                box-shadow: 0 0 0 2px rgba(229, 57, 53, 0.2) !important;
            }
        `;
            document.head.appendChild(style);
        }

        // Mostrar mensaje de bienvenida usando el método correcto
        this.ui.appendMessage('¡Hola! Soy el asistente virtual de la Municipalidad de Puente Alto 🏢', 'bot');

        // Pequeña pausa para que sea más natural
        await this.esperarMs(800);

        this.ui.appendMessage('Antes de comenzar, necesito algunos datos para personalizar tu experiencia:', 'bot');

        // CORREGIDO: Crear el formulario HTML
        const formHTML = `
        <div class="chat-form-container">
            <div class="chat-form-title">📝 Registro de usuario</div>
            
            <div class="chat-form-field">
                <label for="chat-nombre">Nombre completo</label>
                <input type="text" id="chat-nombre" placeholder="Escribe tu nombre" autocomplete="name">
                <div id="chat-nombre-error" class="chat-form-error">Por favor ingresa un nombre válido (mínimo 3 caracteres)</div>
            </div>
            
            <div class="chat-form-field">
                <label for="chat-email">Correo electrónico</label>
                <input type="email" id="chat-email" placeholder="usuario@ejemplo.com" autocomplete="email">
                <div id="chat-email-error" class="chat-form-error">Por favor ingresa un correo válido</div>
            </div>
            
            <button id="chat-form-submit" class="chat-form-submit" disabled>Comenzar</button>
        </div>
    `;

        // CORREGIDO: Usar appendMessage con HTML personalizado
        // En lugar de acceder directamente a chatMessages, usamos el DOM después de agregar el mensaje
        this.ui.appendMessage('', 'bot'); // Mensaje vacío para crear el contenedor

        // CORREGIDO: Buscar el último mensaje agregado y reemplazar su contenido
        setTimeout(() => {
            // Buscar todos los posibles contenedores de mensajes
            const possibleSelectors = [
                '.chat-messages .message:last-child',
                '.messages-container .message:last-child',
                '#chat-messages .message:last-child',
                '.chat-container .message:last-child',
                '[class*="message"]:last-child'
            ];

            let lastMessage = null;
            for (const selector of possibleSelectors) {
                lastMessage = document.querySelector(selector);
                if (lastMessage) break;
            }

            if (lastMessage) {
                // Reemplazar el contenido del último mensaje con el formulario
                lastMessage.innerHTML = formHTML;

                // Asegurar scroll hacia abajo
                const chatContainer = lastMessage.closest('.chat-messages') ||
                    lastMessage.closest('.messages-container') ||
                    lastMessage.closest('#chat-messages') ||
                    lastMessage.closest('.chat-container');

                if (chatContainer) {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
            } else {
                // Plan B: Si no encuentra el último mensaje, crear uno nuevo
                console.warn('No se pudo encontrar el último mensaje, creando contenedor');
                const formContainer = document.createElement('div');
                formContainer.className = 'message bot-message';
                formContainer.innerHTML = formHTML;

                // Buscar cualquier contenedor donde agregarlo
                const chatContainer = document.querySelector('.chat-messages') ||
                    document.querySelector('.messages-container') ||
                    document.querySelector('#chat-messages') ||
                    document.querySelector('.chat-container') ||
                    document.querySelector('[class*="chat"]');

                if (chatContainer) {
                    chatContainer.appendChild(formContainer);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                } else {
                    // Plan C: Agregar al body como último recurso
                    document.body.appendChild(formContainer);
                    formContainer.style.cssText = `
                    position: fixed;
                    bottom: 100px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 90%;
                    max-width: 500px;
                    z-index: 1000;
                    background: white;
                    border: 2px solid #4CAF50;
                    border-radius: 12px;
                    padding: 16px;
                `;
                }
            }

            // Configurar el formulario después de agregarlo al DOM
            this.configurarFormularioRegistro();

        }, 100);
    }
    // NUEVO: Método separado para configurar el formulario
    configurarFormularioRegistro() {
        return new Promise(resolve => {
            // Esperar un momento adicional para que el DOM se actualice
            setTimeout(() => {
                // Obtener elementos del formulario
                const nombreInput = document.getElementById('chat-nombre');
                const emailInput = document.getElementById('chat-email');
                const nombreError = document.getElementById('chat-nombre-error');
                const emailError = document.getElementById('chat-email-error');
                const submitBtn = document.getElementById('chat-form-submit');

                // Verificar si los elementos existen
                if (!nombreInput || !emailInput || !submitBtn) {
                    console.error('No se pudieron encontrar los elementos del formulario');
                    this.ui.appendMessage('❌ Error al cargar el formulario. Continuando sin registro...', 'system');

                    // Usar datos por defecto
                    this.state.usuario = 'Usuario';
                    this.state.email = 'usuario@ejemplo.com';
                    this.guardarDatosUsuario();

                    setTimeout(() => {
                        this.iniciarConversacion();
                    }, 1000);
                    return;
                }

                // Función de validación
                const validarFormulario = () => {
                    let isValid = true;

                    // Validar nombre
                    const nombreValue = nombreInput.value.trim();
                    if (!nombreValue || nombreValue.length < 3 || !/^[a-záéíóúñüA-ZÁÉÍÓÚÑÜ\s]+$/.test(nombreValue)) {
                        if (nombreError) {
                            nombreError.style.display = 'block';
                            nombreError.textContent = nombreValue.length < 3
                                ? 'El nombre debe tener al menos 3 caracteres'
                                : 'El nombre solo puede contener letras y espacios';
                        }
                        nombreInput.classList.add('input-error');
                        isValid = false;
                    } else {
                        if (nombreError) nombreError.style.display = 'none';
                        nombreInput.classList.remove('input-error');
                    }

                    // Validar email
                    const emailValue = emailInput.value.trim();
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailValue || !emailRegex.test(emailValue)) {
                        if (emailError) {
                            emailError.style.display = 'block';
                            emailError.textContent = !emailValue
                                ? 'El correo electrónico es requerido'
                                : 'Por favor ingresa un correo electrónico válido';
                        }
                        emailInput.classList.add('input-error');
                        isValid = false;
                    } else {
                        if (emailError) emailError.style.display = 'none';
                        emailInput.classList.remove('input-error');
                    }

                    // Habilitar/deshabilitar botón
                    if (submitBtn) {
                        submitBtn.disabled = !isValid;
                        submitBtn.style.opacity = isValid ? '1' : '0.6';
                    }

                    return isValid;
                };

                // Eventos
                nombreInput.addEventListener('input', validarFormulario);
                emailInput.addEventListener('input', validarFormulario);

                // Evento submit
                submitBtn.addEventListener('click', (e) => {
                    e.preventDefault();

                    if (validarFormulario()) {
                        const nombre = nombreInput.value.trim();
                        const email = emailInput.value.trim();

                        // Deshabilitar formulario
                        submitBtn.disabled = true;
                        submitBtn.textContent = 'Procesando...';
                        nombreInput.disabled = true;
                        emailInput.disabled = true;

                        // IMPORTANTE: Guardar datos correctamente
                        this.state.usuario = nombre;
                        this.state.email = email;

                        // CORREGIDO: Usar el método correcto para guardar
                        const guardadoExitoso = this.guardarDatosUsuario();
                        console.log('📝 Resultado del guardado:', guardadoExitoso);

                        // Eliminar formulario con animación
                        const formContainer = submitBtn.closest('.chat-form-container') ||
                            submitBtn.closest('.message');

                        if (formContainer) {
                            formContainer.style.transition = 'opacity 0.3s ease-out';
                            formContainer.style.opacity = '0';

                            setTimeout(() => {
                                formContainer.remove();

                                // Mostrar confirmación
                                this.ui.appendMessage(`¡Perfecto ${nombre}! 👋`, 'bot');
                                setTimeout(() => {
                                    this.ui.appendMessage('Tus datos han sido registrados correctamente. ✅', 'bot');

                                    // Continuar con la conversación
                                    setTimeout(() => {
                                        this.iniciarConversacion();
                                    }, 500);
                                }, 500);
                            }, 300);
                        }
                    }
                });

                // Permitir Enter en email
                emailInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter' && !submitBtn.disabled) {
                        e.preventDefault();
                        submitBtn.click();
                    }
                });

                // Navegación con Tab
                nombreInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Tab') {
                        e.preventDefault();
                        emailInput.focus();
                    }
                });

                // Focus inicial
                nombreInput.focus();
                validarFormulario();

            }, 150);
        });
    }

    esperarMs(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // NUEVO: Método para guardar datos de usuario en localStorage
    guardarDatosUsuario() {
        console.log('💾 Guardando datos de usuario:', {
            nombre: this.state.usuario,
            email: this.state.email
        });

        try {
            const datos = {
                nombre: this.state.usuario,
                email: this.state.email,
                timestamp: Date.now()
            };

            localStorage.setItem('chatbot_datos_usuario', JSON.stringify(datos));
            console.log('✅ Datos guardados exitosamente');
            return true;
        } catch (error) {
            console.error('❌ Error guardando datos de usuario:', error);
            return false;
        }
    }

    // NUEVO: Método para cargar datos de usuario desde localStorage
    cargarDatosUsuario() {
        try {
            const datos = localStorage.getItem('chatbot_datos_usuario');
            if (!datos) {
                console.log('❌ No se encontraron datos de usuario guardados');
                return null;
            }

            const datosObj = JSON.parse(datos);
            console.log('✅ Datos de usuario cargados:', datosObj);

            // Verificar que los datos son válidos
            if (datosObj.nombre && datosObj.email) {
                return datosObj;
            } else {
                console.log('⚠️ Datos de usuario inválidos, eliminando...');
                localStorage.removeItem('chatbot_datos_usuario');
                return null;
            }
        } catch (error) {
            console.error('❌ Error cargando datos de usuario:', error);
            localStorage.removeItem('chatbot_datos_usuario');
            return null;
        }
    }

    async initAudioServices() {
        try {
            await this.services.recorder.init();
        } catch { }
    }

    setupEventHandlers() {
        // Solo interceptar envío de mensajes del usuario
        const originalOnSend = this.ui._onSend?.bind(this.ui);
        if (originalOnSend) {
            this.ui._onSend = async () => {
                await this.procesarMensajeUsuario();
            };
        }

        // ELIMINADO: No interceptar appendMessage para evitar loops infinitos
        // La persistencia se manejará de forma diferente
    }

    // ───────────────────────────────────────────────────────────────────────────
    // LÓGICA PRINCIPAL DE CONVERSACIÓN
    // ───────────────────────────────────────────────────────────────────────────

    async iniciarConversacion() {
        // Verificar si ya se ejecutó para evitar duplicados
        if (this._conversacionIniciada) {
            return;
        }
        this._conversacionIniciada = true;

        // Usar SIEMPRE la configuración local, ignorar servidor
        const config = {
            mensajeBienvenida: '¡Hola ${nombre}! Bienvenido a la Municipalidad de Puente Alto 🏢\n\nSoy tu asistente virtual y estoy aquí para ayudarte.'
        };

        // Personalizar mensaje de bienvenida con el nombre del usuario
        let mensajeBienvenida = config.mensajeBienvenida;

        if (this.state.usuario) {
            mensajeBienvenida = mensajeBienvenida.replace(/\${nombre}/g, this.state.usuario);
        } else {
            mensajeBienvenida = mensajeBienvenida.replace(/\${nombre}!/g, '');
        }

        // Mostrar mensaje de bienvenida
        this.ui.appendMessage(mensajeBienvenida, 'bot');

        // Mostrar directamente el árbol como botones
        setTimeout(() => {
            this.mostrarArbolComoBotones();
        }, 1000);
    }

    mostrarArbolComoBotones() {
        this.ui.appendMessage(decisionTree.text, 'bot');
        setTimeout(() => {
            this.ui.appendMessage('👆 Selecciona una opción haciendo clic en los botones:', 'bot');
            setTimeout(() => {
                this.ui.showOptions(decisionTree.children, id => this.manejarSeleccionArbol(id));
            }, 500);
        }, 800);
    }
    // ───────────────────────────────────────────────────────────────────────────
    // MANEJO DEL ÁRBOL DE DECISIONES
    // ───────────────────────────────────────────────────────────────────────────

    async procesarEnArbol(input) {
        // 1. Verificar si es un número (selección directa)
        const numeroSeleccion = this.procesarSeleccionNumerica(input);
        if (numeroSeleccion !== null) {
            this.intentosFallidos = 0;
            return this.manejarSeleccionNumerica(numeroSeleccion);
        }

        // 2. Intentar buscar respuesta exacta en el árbol actual
        const respuestaExacta = this.buscarRespuestaExacta(input);
        if (respuestaExacta) {
            this.intentosFallidos = 0;
            return this.manejarSeleccionArbol(respuestaExacta.id);
        }

        // 3. Búsqueda inteligente por palabras clave
        const resultadosBusqueda = this.buscarPorPalabrasClave(input);
        if (resultadosBusqueda.length > 0) {
            this.intentosFallidos = 0;
            return this.mostrarResultadosBusquedaComoBotones(resultadosBusqueda);
        }

        // 4. Intentar navegación
        if (this.esComandoNavegacion(input)) {
            this.intentosFallidos = 0;
            return this.manejarNavegacion(input);
        }

        // 5. MODIFICADO: No se encontró respuesta - escalar a agente en lugar de IA
        this.intentosFallidos++;

        if (this.intentosFallidos >= this.maxIntentosSinRespuesta) {
            this.ui.appendMessage('🤔 No pude encontrar una respuesta en el menú.', 'bot');
            setTimeout(() => {
                this.ui.appendMessage('¿Te gustaría hablar con un agente humano?', 'bot');
                this.ui.showOptions([
                    { id: 'escalar-agente', text: '👨‍💼 Sí, conectar con agente' },
                    { id: 'menu-principal', text: '🏠 Volver al menú principal' },
                    { id: 'intentar-nuevo', text: '🔄 Intentar de nuevo' }
                ], (selectedId) => {
                    switch (selectedId) {
                        case 'escalar-agente':
                            this.escalarAAgente();
                            break;
                        case 'menu-principal':
                            this.volverAlInicio();
                            break;
                        case 'intentar-nuevo':
                            this.intentosFallidos = 0;
                            this.mostrarOpcionesActuales();
                            break;
                    }
                });
            }, 1000);
        } else {
            this.mostrarSugerenciasArbol(input);
        }
    }

    procesarSeleccionNumerica(input) {
        const numero = parseInt(input.trim());
        if (isNaN(numero)) return null;

        const nodoActual = findNode(this.nivelActual);
        if (!nodoActual?.children) return null;

        if (numero >= 1 && numero <= nodoActual.children.length) {
            return numero - 1;
        }

        return null;
    }

    manejarSeleccionNumerica(indice) {
        const nodoActual = findNode(this.nivelActual);
        if (!nodoActual?.children || !nodoActual.children[indice]) {
            this.ui.appendMessage('❌ Número de opción no válido', 'bot');
            return this.mostrarOpcionesActuales();
        }

        const nodoSeleccionado = nodoActual.children[indice];
        return this.manejarSeleccionArbol(nodoSeleccionado.id);
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

        const buscarEnNodo = (nodo, nivel = 0) => {
            if (!nodo) return;

            let relevancia = 0;

            palabrasClave.forEach(palabra => {
                if (nodo.text.toLowerCase().includes(palabra.toLowerCase())) {
                    relevancia += 2;
                }
                if (nodo.keywords && nodo.keywords.some(kw => kw.toLowerCase().includes(palabra.toLowerCase()))) {
                    relevancia += 3;
                }
                if (nodo.descripcion && nodo.descripcion.toLowerCase().includes(palabra.toLowerCase())) {
                    relevancia += 1;
                }
            });

            if (relevancia > 0) {
                resultados.push({
                    nodo,
                    relevancia,
                    nivel,
                    path: nodo.text
                });
            }

            if (nodo.children) {
                nodo.children.forEach(child => buscarEnNodo(child, nivel + 1));
            }
        };

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
            return this.mostrarOpcionesActuales();
        }

        // Mostrar la selección del usuario como mensaje
        this.ui.appendMessage(nodo.text, 'user');

        // Si tiene link, es un destino final
        if (nodo.link) {
            this.ui.appendMessage(`✅ ${nodo.text}`, 'bot');

            // Crear enlace clickeable como HTML en el mensaje
            const linkHtml = `🔗 haga clic en el siguiente link <a href="${nodo.link}" target="_blank" rel="noopener noreferrer" style="
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 12px 20px;
                background: linear-gradient(135deg, #4caf50, #45a049);
                color: white;
                text-decoration: none;
                border-radius: 25px;
                font-weight: 600;
                font-size: 0.95rem;
                box-shadow: 0 3px 10px rgba(76, 175, 80, 0.3);
                transition: all 0.3s ease;
                margin: 8px 0;
                width: 100%;
                justify-content: center;
            " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 5px 15px rgba(76, 175, 80, 0.4)'" 
               onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 3px 10px rgba(76, 175, 80, 0.3)'">
                ${nodo.text}
            </a>`;

            this.ui.appendMessage(linkHtml, 'bot');

            setTimeout(() => {
                this.ui.appendMessage('¿Necesitas ayuda con algo más?', 'bot');
                this.mostrarBotonesNavegacion();
            }, 10000);

            return;
        }

        // Si tiene hijos, mostrar sub-opciones como botones
        if (nodo.children?.length) {
            this.nivelActual = nodeId;
            this.ui.appendMessage(`📂 ${nodo.text}`, 'bot');

            setTimeout(() => {
                this.ui.appendMessage('👆 Selecciona una opción:', 'bot');
                setTimeout(() => {
                    this.ui.showOptions(nodo.children, (selectedId) => {
                        this.manejarSeleccionArbol(selectedId);
                    });
                }, 500);
            }, 800);
            return;
        }

        // Nodo sin hijos ni link
        this.ui.appendMessage(`ℹ️ ${nodo.text}`, 'bot');
        setTimeout(() => {
            this.ui.appendMessage('¿Necesitas ayuda con algo más?', 'bot');
            this.mostrarBotonesNavegacion();
        }, 1000);
    }

    mostrarOpcionesActuales() {
        const nodoActual = findNode(this.nivelActual);
        if (nodoActual?.children) {
            this.ui.appendMessage('📋 Estas son las opciones disponibles:', 'bot');
            setTimeout(() => {
                this.ui.showOptions(nodoActual.children, (selectedId) => {
                    this.manejarSeleccionArbol(selectedId);
                });
            }, 500);
        } else {
            this.volverAlInicio();
        }
    }

    mostrarResultadosBusquedaComoBotones(resultados) {
        this.ui.appendMessage('🔍 Encontré estas opciones relacionadas:', 'bot');

        // Convertir resultados a formato de opciones
        const opciones = resultados.map(resultado => ({
            id: resultado.nodo.id,
            text: `${resultado.nodo.text} ${resultado.nodo.link ? '🔗' : ''}`
        }));

        setTimeout(() => {
            this.ui.showOptions(opciones, (selectedId) => {
                this.manejarSeleccionArbol(selectedId);
            });
        }, 500);

        this.resultadosBusquedaActuales = resultados;
    }

    mostrarSugerenciasArbol(input) {
        const sugerencias = [
            '❓ No encontré esa opción. Aquí tienes algunas sugerencias:',
            '💡 Intenta ser más específico con palabras clave',
            '📋 Usa palabras como "licencia", "pago", "trámite"',
            '🔄 También puedes usar los botones del menú'
        ];

        sugerencias.forEach((sugerencia, index) => {
            setTimeout(() => {
                this.ui.appendMessage(sugerencia, 'bot');
            }, index * 400);
        });

        // Mostrar opciones actuales nuevamente como botones
        setTimeout(() => {
            this.ui.appendMessage('👆 O selecciona una opción:', 'bot');
            setTimeout(() => this.mostrarOpcionesActuales(), 500);
        }, sugerencias.length * 400 + 500);
    }

    // MODIFICAR: Método mostrarBotonesNavegacion (línea ~850)
    mostrarBotonesNavegacion() {
        const sessionIdGuardado = this.cargarSessionId();

        const opcionesNavegacion = [
            { id: 'menu', text: '🏠 Volver al Menú Principal' },
            { id: 'ayuda', text: '🆘 Ayuda' },
            { id: 'agente', text: '👨‍💼 Conectar con Agente' },
            { id: 'reiniciar', text: '🔄 Reiniciar Chatbot' }
        ];

        if (sessionIdGuardado) {
            opcionesNavegacion.push({
                id: 'mostrar-ultimo-sessionid',
                text: `📋 Ver último Session ID usado`
            });
        }

        setTimeout(() => {
            this.ui.showOptions(opcionesNavegacion, (selectedId) => {
                switch (selectedId) {
                    case 'menu':
                        this.volverAlInicio();
                        break;
                    case 'ayuda':
                        this.mostrarAyuda();
                        break;
                    case 'agente':
                        this.escalarAAgente();
                        break;
                    case 'reiniciar':
                        this.ui.appendMessage('🔄 ¿Qué tipo de reinicio quieres?', 'system');
                        this.ui.showOptions([
                            { id: 'reinicio-suave', text: '🔄 Reiniciar conversación (mantener datos)' },
                            { id: 'reinicio-completo', text: '🗑️ Reinicio completo (borrar todo)' }
                        ], (selectedId) => {
                            if (selectedId === 'reinicio-suave') {
                                this.ui.appendMessage('🔄 Reiniciando conversación...', 'system');
                                setTimeout(() => this.reiniciarChatbot(true), 1000);
                            } else {
                                this.ui.appendMessage('🗑️ Reinicio completo...', 'system');
                                setTimeout(() => this.reiniciarChatbot(false), 1000);
                            }
                        });
                        break;
                    case 'mostrar-ultimo-sessionid':
                        this.ui.appendMessage(`🔑 Último Session ID usado: ${sessionIdGuardado}`, 'system');
                        break;
                }
            });
        }, 500);
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
            this.volverAlInicio();
        } else if (inputLower.includes('ayuda')) {
            this.mostrarAyuda();
        } else {
            this.mostrarOpcionesActuales();
        } º
    }

    volverAlInicio() {
        // IMPORTANTE: Asegurar que mock TTS esté activo al volver al inicio
        this.services.speechManager.setAgentMode(false);

        // Si hay conexión de agente activa, cerrarla
        if (this.agentSocket && this.estado === ESTADOS.AGENTE) {
            this.finalizarChatAgente();
            return;
        }

        // IMPORTANTE: Limpiar todo el estado y la sesión
        this.limpiarEstadoConversacion();
        sessionStorage.removeItem('chatbot_inicializado');

        this.nivelActual = 'root';
        this.estado = ESTADOS.ARBOL;
        this.intentosFallidos = 0;
        this.resultadosBusquedaActuales = null;
        this._conversacionIniciada = false;

        this.ui.clearOptions();
        this.ui.appendMessage('🏠 Volviendo al menú principal...', 'bot');

        setTimeout(() => {
            this.mostrarArbolComoBotones();
        }, 800);
    }

    // AGREGAR: Método para configurar subida de archivos
    setupFileUpload() {
        // Crear input de archivo (oculto)
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.pdf,.doc,.docx';
        this.fileInput.style.display = 'none';
        document.body.appendChild(this.fileInput);

        // Crear botón de archivo
        this.fileButton = document.createElement('button');
        this.fileButton.className = 'btn-icon';
        this.fileButton.innerHTML = '📎';
        this.fileButton.title = 'Enviar archivo (solo con agente)';
        this.fileButton.disabled = true;
        this.fileButton.style.opacity = '0.5';
        this.fileButton.style.background = '#94a3b8';

        // Agregar botón al contenedor de input
        const inputContainer = this.ui.container.querySelector('.chat-input-container');
        if (inputContainer) {
            const sendButton = inputContainer.querySelector('#send-btn');
            if (sendButton) {
                inputContainer.insertBefore(this.fileButton, sendButton);
            }
        }

        // Eventos
        this.fileButton.addEventListener('click', () => {
            if (this.fileUploadEnabled && this.estado === ESTADOS.AGENTE) {
                this.fileInput.click();
            } else {
                this.ui.appendMessage('📎 El envío de archivos solo está disponible cuando hablas con un agente', 'system');
            }
        });

        this.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.uploadFile(file);
            }
        });
    }

    // AGREGAR: Método para subir archivo
    async uploadFile(file) {
        try {
            // Validaciones
            if (!this.fileUploadEnabled) {
                this.ui.appendMessage('❌ Envío de archivos deshabilitado', 'system');
                return;
            }

            if (this.estado !== ESTADOS.AGENTE) {
                this.ui.appendMessage('❌ Solo puedes enviar archivos cuando hablas con un agente', 'system');
                return;
            }

            if (file.size > this.maxFileSize) {
                this.ui.appendMessage('❌ Archivo demasiado grande. Máximo 10MB', 'system');
                return;
            }

            const extension = '.' + file.name.split('.').pop().toLowerCase();
            if (!this.allowedTypes.includes(extension)) {
                this.ui.appendMessage('❌ Solo se permiten archivos PDF, DOC y DOCX', 'system');
                return;
            }

            // Mostrar progreso
            this.ui.appendMessage(`📎 Enviando ${file.name}...`, 'user');

            // Convertir a base64
            const fileData = await this.fileToBase64(file);

            // Enviar via SignalR
            if (this.services.signalR && this.services.signalR.connection) {
                await this.services.signalR.connection.invoke('UploadFile',
                    this.state.sessionId,
                    file.name,
                    fileData,
                    extension
                );
            } else {
                throw new Error('No hay conexión SignalR disponible');
            }

            // Limpiar input
            this.fileInput.value = '';

        } catch (error) {
            console.error('Error subiendo archivo:', error);
            this.ui.appendMessage('❌ Error al enviar archivo: ' + error.message, 'system');
        }
    }

    // AGREGAR: Helper para convertir archivo a base64
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                // Remover el prefijo data:...;base64,
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // MODIFICADO: Método para reiniciar con opciones
    reiniciarChatbot(mantenerDatos = true) {
        try {
            // Siempre limpiar estos
            localStorage.removeItem('chatbot_estado_conversacion');
            localStorage.removeItem('chatbot_sessionId');
            sessionStorage.clear();

            // Si no queremos mantener los datos de usuario
            if (!mantenerDatos) {
                localStorage.removeItem('chatbot_datos_usuario');
            }

            // Recargar página
            location.reload();
        } catch (error) {
            console.error('Error reiniciando chatbot:', error);
            alert('Error reiniciando el chatbot. Por favor recarga la página manualmente.');
        }
    }


    mostrarAyuda() {
        const ayuda = [
            '🆘 **Ayuda del ChatBot**',
            '',
            '**¿Cómo navegar?**',
            '• Haz clic en los botones para seleccionar opciones',
            '• También puedes escribir palabras clave para buscar',
            '• Usa comandos como "menú", "ayuda" si necesitas',
            '',
            '**Funciones disponibles:**',
            '• 🔍 Búsqueda inteligente por palabras clave',
            '• 👨‍💼 Conectar con agente humano para consultas complejas', // MODIFICADO
            '• 🏠 Navegación fácil con botones',
            '• 📎 Envío de archivos (cuando hablas con un agente)', // AGREGADO
            '',
            '**¡Tip!** Los botones son la forma más fácil de navegar'
        ];

        ayuda.forEach((linea, index) => {
            setTimeout(() => {
                this.ui.appendMessage(linea, 'bot');
            }, index * 200);
        });

        setTimeout(() => {
            this.ui.appendMessage('¿En qué más puedo ayudarte?', 'bot');
            this.mostrarBotonesNavegacion();
        }, ayuda.length * 200 + 500);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // ESCALADO CON AGENTE
    // ───────────────────────────────────────────────────────────────────────────
    async escalarAAgente() {
        if (!this.verificarDatosUsuario()) {
            return; // Se mostrarán las opciones para completar datos
        }

        if (this.agentSocket && this.agentSocket.state === signalR.HubConnectionState.Connected) {
            this.ui.appendMessage('✅ Ya estás conectado con un agente', 'system');
            return this.mostrarOpcionesAgente();
        }

        if (this.agentSocket) {
            await this.agentSocket.stop().catch(() => { });
            this.agentSocket = null;
        }

        this.estado = ESTADOS.AGENTE;
        this.ui.clearOptions();

        // MODIFICADO: Verificar si speechManager existe antes de llamarlo
        if (this.services.speechManager && typeof this.services.speechManager.setAgentMode === 'function') {
            this.services.speechManager.setAgentMode(true);
        }

        this.ui.appendMessage('👨‍💼 Conectando con un agente humano...', 'bot');
        this.ui.appendMessage(`👤 Conectando como: ${this.state.usuario}`, 'system');
        this.ui.appendMessage('🔄 Estableciendo conexión con el servidor...', 'system');

        // Crear conexión y suscribir eventos antes de start()
        this.agentSocket = new signalR.HubConnectionBuilder()
            .withUrl("https://localhost:7053/chatHub")
            .withAutomaticReconnect()
            .configureLogging(signalR.LogLevel.Information)
            .build();

        this.configurarEventosSignalR();

        try {
            await this.agentSocket.start();
            console.log('🔗 Conexión SignalR establecida');

            // CORREGIDO: Registrar usuario con datos completos
            const usuario = this.state.usuario || 'Usuario Anónimo';
            const correo = this.state.email || 'anonimo@municipalidad.cl';

            console.log('📝 Registrando usuario para agente:', { usuario, correo });
            await this.agentSocket.invoke('RegisterUser', usuario, correo, this.state.sessionId);

            // AGREGAR: Habilitar subida de archivos una vez conectado
            this.habilitarSubidaArchivos();

        } catch (err) {
            return this.manejarErrorConexion(err);
        }
    }

    // AGREGAR: Método para habilitar subida de archivos
    habilitarSubidaArchivos() {
        this.fileUploadEnabled = true;

        if (this.fileButton) {
            this.fileButton.disabled = false;
            this.fileButton.style.opacity = '1';
            this.fileButton.style.background = 'linear-gradient(135deg, var(--municipal-green), #10b981)';
            this.fileButton.title = 'Enviar archivo PDF, DOC o DOCX';

            // Animación visual
            this.fileButton.classList.add('file-enabled');
            setTimeout(() => {
                this.fileButton.classList.remove('file-enabled');
            }, 600);
        }

        console.log('📎 Subida de archivos habilitada');
    }

    // AGREGAR: Método para deshabilitar subida de archivos
    deshabilitarSubidaArchivos() {
        this.fileUploadEnabled = false;

        if (this.fileButton) {
            this.fileButton.disabled = true;
            this.fileButton.style.opacity = '0.5';
            this.fileButton.style.background = '#94a3b8';
            this.fileButton.title = 'Enviar archivo (solo con agente)';
            this.fileButton.classList.remove('file-enabled');
        }

        console.log('📎 Subida de archivos deshabilitada');
    }

    // NUEVO: Método separado para configurar eventos SignalR
    configurarEventosSignalR() {
        const sock = this.agentSocket;
        sock.off();  // limpia todos los handlers previos

        sock.on('SessionAssigned', data => {
            this.state.sessionId = data.sessionId;
            this.guardarSessionId();
            console.log('🔑 Session ID recibido:', data.sessionId);

            // CORREGIDO: Mostrar mensaje más claro
            this.ui.appendMessage(`🔑 Sesión creada exitosamente`, 'system');
            this.ui.appendMessage(`📋 Session ID: ${data.sessionId}`, 'system');
            this.ui.appendMessage(`💡 ${data.message}`, 'system');

            this.mostrarBotonCopiarSessionId(data.sessionId);
        });

        sock.on('AgentStatusUpdate', data => {
            if (data.status === 'connected') {
                this.ui.appendMessage(`✅ ${data.message}`, 'system');

                // CORREGIDO: Mostrar información del agente
                if (data.agent) {
                    this.ui.appendMessage(`👨‍💼 Agente: ${data.agent.name || 'Asistente'}`, 'system');
                }

                // Limpiar opciones cuando el agente se conecta
                this.ui.clearOptions();
                this.ui.appendMessage('💬 El agente está listo. Puedes empezar a escribir tus mensajes.', 'system');
            } else {
                this.ui.appendMessage(`📊 ${data.message}`, 'system');
            }
        });

        sock.on('ReceiveMessage', payload => {
            if (payload.type === 'agent_message') {
                this.ui.appendMessage(`👨‍💼 ${payload.agent.name}: ${payload.message}`, 'bot');

                // CORREGIDO: Solo mostrar opciones si el agente indica finalización
                if (/finalizar|desconectar|terminar|cerrar.*chat|fin.*conversaci[oó]n/i.test(payload.message)) {
                    this.ui.appendMessage('🔚 El agente ha finalizado la conversación', 'system');
                    setTimeout(() => {
                        this.finalizarChatAgente();
                    }, 2000);
                }
                // CORREGIDO: No mostrar opciones automáticamente para mensajes normales
                // El usuario puede seguir escribiendo libremente
            }
            else if (payload.type === 'system_message') {
                this.ui.appendMessage(`ℹ️ ${payload.message}`, 'system');

                // CORREGIDO: Solo mostrar opciones si es un mensaje de desconexión del sistema
                if (/desconect|cerr.*sesi[oó]n|timeout/i.test(payload.message)) {
                    setTimeout(() => {
                        this.mostrarOpcionesAgente();
                    }, 1000);
                }
            }
            else if (payload.type === 'agent_disconnected') {
                this.ui.appendMessage('🔌 El agente se ha desconectado', 'system');
                setTimeout(() => {
                    this.finalizarChatAgente();
                }, 1500);
            }
        });

        this.agentSocket.on('AgentModeActivated', (data) => {
            console.log('🔓 Modo agente activado:', data);
            this.habilitarSubidaArchivos();

            if (data.message && data.showMessage !== false) {
                this.ui.appendMessage('📎 Ahora puedes enviar archivos al agente', 'system');
            }
        });

        this.agentSocket.on('AgentModeDeactivated', (data) => {
            console.log('🔒 Modo agente desactivado:', data);
            this.deshabilitarSubidaArchivos();

            if (data.message) {
                this.ui.appendMessage(data.message, 'system');
            }
        });

        // MODIFICAR: Evento ReceiveMessage para manejar archivos
        this.agentSocket.on('ReceiveMessage', (data) => {
            console.log('📨 Mensaje recibido:', data);

            const { type, message, agent, timestamp, fileName, fileSize, fileType } = data;

            switch (type) {
                case 'system_message':
                    this.ui.appendMessage(message, 'system');
                    break;

                case 'agent_message':
                    this.ui.appendMessage(message, 'agent', {
                        agent: agent?.name || 'Agente',
                        avatar: agent?.avatar || '🧑‍💼'
                    });
                    break;

                case 'bot_message':
                    this.ui.appendMessage(message, 'bot');
                    break;

                case 'file_upload':
                    // Confirmación de archivo enviado
                    const fileMessage = `📎 Archivo enviado: ${fileName} (${fileSize})`;
                    this.ui.appendMessage(fileMessage, 'user', {
                        isFile: true,
                        fileName: fileName,
                        fileSize: fileSize
                    });
                    break;

                default:
                    this.ui.appendMessage(message, 'system');
            }
        });

        // NUEVO: Evento específico para cuando el agente cierra la sesión
        sock.on('AgentDisconnected', () => {
            this.ui.appendMessage('🔌 El agente ha cerrado la sesión', 'system');
            setTimeout(() => {
                this.finalizarChatAgente();
            }, 1500);
        });

        // Eventos de conexión
        sock.onreconnected(() => {
            this.ui.appendMessage('✅ Reconectado con el servidor', 'system');
        });

        sock.onclose(() => {
            if (this.estado === ESTADOS.AGENTE) {
                this.ui.appendMessage('⚠️ Se perdió la conexión con el servidor', 'system');
                setTimeout(() => {
                    this.finalizarChatAgente();
                }, 2000);
            }
        });
    }



    verificarDatosUsuario() {
        if (!this.state.usuario || !this.state.email) {
            this.ui.appendMessage('⚠️ Necesitas completar tus datos antes de conectar con un agente', 'system');

            this.ui.showOptions([
                { id: 'completar-datos', text: '📝 Completar datos' },
                { id: 'usar-anonimo', text: '👤 Conectar como anónimo' },
                { id: 'cancelar', text: '❌ Cancelar' }
            ], (selectedId) => {
                switch (selectedId) {
                    case 'completar-datos':
                        this.mostrarFormularioActualizacionDatos();
                        break;
                    case 'usar-anonimo':
                        this.state.usuario = 'Usuario Anónimo';
                        this.state.email = 'anonimo@municipalidad.cl';
                        this.escalarAAgente();
                        break;
                    case 'cancelar':
                        this.volverAlInicio();
                        break;
                }
            });
            return false;
        }
        return true;
    }

    async mostrarFormularioActualizacionDatos() {
        this.ui.appendMessage('📝 Actualiza tus datos:', 'bot');

        // Reutilizar la lógica del formulario original
        await this.mostrarFormularioRegistroDentroChat();
    }

    finalizarChatAgente() {
        console.log('🔚 Finalizando chat con agente');

        // IMPORTANTE: Reactivar mock TTS al finalizar
        this.services.speechManager.setAgentMode(false);

        this.desconectarAgente();

        // Mostrar mensaje de despedida
        setTimeout(() => {
            this.ui.appendMessage('👋 Gracias por usar nuestro servicio de chat con agente.', 'bot');
            setTimeout(() => {
                this.ui.appendMessage('¿Hay algo más en lo que pueda ayudarte?', 'bot');
                this.mostrarBotonesNavegacion();
            }, 1000);
        }, 500);
    }

    // NUEVO: Método para manejar errores de conexión
    manejarErrorConexion(err) {
        this.services.speechManager.setAgentMode(false);
        this.estado = ESTADOS.ARBOL;

        let mensajeError = '❌ No se pudo conectar con el servidor. ';

        if (err.message.includes('InvalidDataException')) {
            mensajeError += 'Error de parámetros en el servidor.';
        } else if (err.message.includes('404')) {
            mensajeError += 'Servidor no encontrado.';
        } else if (err.message.includes('timeout')) {
            mensajeError += 'Tiempo de conexión agotado.';
        } else if (err.message.includes('Failed to invoke')) {
            mensajeError += 'Error al invocar método del servidor.';
        } else {
            mensajeError += 'Error de conexión.';
        }

        this.ui.appendMessage(mensajeError, 'bot');

        setTimeout(() => {
            this.ui.appendMessage('¿Quieres intentar conectarte nuevamente?', 'bot');
            this.ui.showOptions([
                { id: 'reintentar', text: '🔄 Intentar otra vez' },
                { id: 'menu', text: '🏠 Volver al menú principal' }
            ], (selectedId) => {
                if (selectedId === 'reintentar') {
                    this.escalarAAgente();
                } else {
                    this.volverAlInicio();
                }
            });
        }, 2000);
    }

    // CORREGIDO: Verificar UI antes de manipular DOM
    mostrarBotonCopiarSessionId(sessionId) {
        // Verificar que UI y chatMessages estén disponibles
        if (!this.ui || !this.ui.chatMessages) {
            console.error('❌ UI no disponible para mostrar botón copiar SessionId');
            console.log('🔑 Session ID para copiar:', sessionId);
            return;
        }

        // Generar ID único para evitar conflictos
        const uniqueId = `copySessionBtn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Crear botón para copiar SessionId
        const copyContainer = document.createElement('div');
        copyContainer.className = 'copy-session-container p-3 bg-light border rounded mb-3';
        copyContainer.innerHTML = `
            <div class="d-flex align-items-center justify-content-between">
                <div>
                    <strong>🔑 Session ID:</strong>
                    <code class="ms-2">${sessionId}</code>
                </div>
                <button id="${uniqueId}" class="btn btn-sm btn-outline-primary">
                    📋 Copiar
                </button>
            </div>
            <small class="text-muted d-block mt-2">
                Comparte este ID con el agente para que pueda conectarse contigo
            </small>
        `;

        this.ui.chatMessages.appendChild(copyContainer);
        this.ui.chatMessages.scrollTop = this.ui.chatMessages.scrollHeight;

        // CORREGIDO: Usar el ID único generado
        const copyBtn = document.getElementById(uniqueId);

        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(sessionId);
                    copyBtn.innerHTML = '✅ Copiado';
                    copyBtn.classList.remove('btn-outline-primary');
                    copyBtn.classList.add('btn-success');

                    setTimeout(() => {
                        copyBtn.innerHTML = '📋 Copiar';
                        copyBtn.classList.remove('btn-success');
                        copyBtn.classList.add('btn-outline-primary');
                    }, 2000);
                } catch (err) {
                    console.error('Error al copiar:', err);
                    copyBtn.innerHTML = '❌ Error';
                    copyBtn.classList.add('btn-danger');
                }
            });
        }

        // Mostrar opciones después de mostrar el SessionId
        setTimeout(() => {
            if (this.ui) {
                this.ui.appendMessage('🎯 Ahora puedes:', 'system');
                this.mostrarOpcionesEsperaAgente();
            }
        }, 1000);
    }

    // CORREGIDO: Verificar UI antes de mostrar opciones
    mostrarOpcionesEsperaAgente() {
        if (!this.ui) {
            console.error('❌ UI no disponible para mostrar opciones de espera');
            return;
        }

        this.ui.showOptions([
            { id: 'esperar-agente', text: '⏳ Esperar a que el agente se conecte' },
            { id: 'copiar-id', text: '📋 Copiar Session ID nuevamente' },
            { id: 'cancelar-agente', text: '❌ Cancelar y volver al menú' }
        ], (selectedId) => {
            switch (selectedId) {
                case 'esperar-agente':
                    if (this.ui) {
                        this.ui.clearOptions();
                        this.ui.appendMessage('⏳ Esperando conexión del agente...', 'system');
                        this.ui.appendMessage('💡 Cuando el agente se conecte, podrás empezar a chatear', 'bot');
                    }
                    break;
                case 'copiar-id':
                    if (this.state.sessionId) {
                        navigator.clipboard.writeText(this.state.sessionId);
                        if (this.ui) {
                            this.ui.appendMessage('📋 Session ID copiado al portapapeles', 'system');
                        }
                    }
                    break;
                case 'cancelar-agente':
                    this.finalizarChatAgente();
                    this.volverAlInicio();
                    break;
            }
        });
    }

    async uploadFile(file) {
        try {
            // Validaciones
            if (!this.fileUploadEnabled) {
                this.ui.appendMessage('❌ Envío de archivos deshabilitado', 'system');
                return;
            }

            if (this.estado !== ESTADOS.AGENTE) {
                this.ui.appendMessage('❌ Solo puedes enviar archivos cuando hablas con un agente', 'system');
                return;
            }

            if (!this.agentSocket || this.agentSocket.state !== signalR.HubConnectionState.Connected) {
                this.ui.appendMessage('❌ No hay conexión con el agente', 'system');
                return;
            }

            if (file.size > this.maxFileSize) {
                this.ui.appendMessage('❌ Archivo demasiado grande. Máximo 10MB', 'system');
                return;
            }

            const extension = '.' + file.name.split('.').pop().toLowerCase();
            if (!this.allowedTypes.includes(extension)) {
                this.ui.appendMessage('❌ Solo se permiten archivos PDF, DOC y DOCX', 'system');
                return;
            }

            // Mostrar progreso
            this.ui.appendMessage(`📎 Enviando ${file.name}...`, 'user');

            // Convertir a base64
            const fileData = await this.fileToBase64(file);

            // Enviar via SignalR
            await this.agentSocket.invoke('UploadFile',
                this.state.sessionId,
                file.name,
                fileData,
                extension
            );

            // Limpiar input
            if (this.fileInput) {
                this.fileInput.value = '';
            }

        } catch (error) {
            console.error('Error subiendo archivo:', error);
            this.ui.appendMessage('❌ Error al enviar archivo: ' + error.message, 'system');
        }
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }


    // NUEVO: Opciones mientras se espera al agente
    mostrarOpcionesEsperaAgente() {
        this.ui.showOptions([
            { id: 'esperar-agente', text: '⏳ Esperar a que el agente se conecte' },
            { id: 'copiar-id', text: '📋 Copiar Session ID nuevamente' },
            { id: 'cancelar-agente', text: '❌ Cancelar y volver al menú' }
        ], (selectedId) => {
            switch (selectedId) {
                case 'esperar-agente':
                    this.ui.clearOptions();
                    this.ui.appendMessage('⏳ Esperando conexión del agente...', 'system');
                    this.ui.appendMessage('💡 Cuando el agente se conecte, podrás empezar a chatear', 'bot');
                    break;
                case 'copiar-id':
                    if (this.state.sessionId) {
                        navigator.clipboard.writeText(this.state.sessionId);
                        this.ui.appendMessage('📋 Session ID copiado al portapapeles', 'system');
                    }
                    break;
                case 'cancelar-agente':
                    this.finalizarChatAgente();
                    this.volverAlInicio();
                    break;
            }
        });
    }

    // CORREGIDO: Procesar mensajes con agente
    async procesarConAgente(input) {
        // NUEVO: Comando especial para mostrar opciones de emergencia
        if (input.toLowerCase().includes('/opciones') || input.toLowerCase().includes('/help')) {
            return this.mostrarOpcionesEmergenciaAgente();
        }

        if (!this.agentSocket) {
            this.ui.appendMessage('⚠️ Reconectando con el servidor...', 'system');
            return this.escalarAAgente();
        }

        if (this.agentSocket.state !== signalR.HubConnectionState.Connected) {
            try {
                await this.agentSocket.start();
            }
            catch {
                return this.escalarAAgente();
            }
        }

        if (!this.state.sessionId) {
            this.ui.appendMessage('⚠️ Session ID no disponible. Esperando...', 'system');
            return setTimeout(() => this.procesarConAgente(input), 2000);
        }

        try {
            await this.agentSocket.invoke('SendMessageToAgent', this.state.sessionId, input);
            console.log('✅ Mensaje enviado al agente:', input);

            // OPCIONAL: Mostrar confirmación muy discreta
            // this.ui.appendMessage('📤', 'system'); // Solo un icono pequeño

        } catch (err) {
            console.error('❌ Error al enviar mensaje:', err);
            this.ui.appendMessage('❌ Error al enviar mensaje. Intenta de nuevo.', 'system');

            // CORREGIDO: Solo mostrar opciones si hay error persistente
            setTimeout(() => {
                this.ui.appendMessage('💡 Escribe "/opciones" si necesitas ayuda', 'system');
            }, 1000);
        }
    }

    mostrarOpcionesAgente() {
        // Solo mostrar si realmente necesitamos dar opciones al usuario
        this.ui.clearOptions();

        setTimeout(() => {
            this.ui.showOptions([
                { id: 'mostrar-sessionid', text: '🔑 Ver Session ID' },
                { id: 'desconectar-agente', text: '🔌 Desconectar del agente' },
                { id: 'menu', text: '🏠 Volver al menú principal' }
            ], (selectedId) => {
                switch (selectedId) {
                    case 'mostrar-sessionid':
                        if (this.state.sessionId) {
                            this.ui.appendMessage(`🔑 Tu Session ID: ${this.state.sessionId}`, 'system');
                            // CORREGIDO: No mostrar botón de copiar, solo el ID
                            this.ui.appendMessage('💡 Puedes continuar escribiendo mensajes al agente', 'system');
                        }
                        break;
                    case 'desconectar-agente':
                        this.finalizarChatAgente();
                        break;
                    case 'menu':
                        this.finalizarChatAgente();
                        this.volverAlInicio();
                        break;
                }
            });
        }, 1000);
    }

    mostrarOpcionesEmergenciaAgente() {
        this.ui.appendMessage('🆘 Opciones de emergencia:', 'system');
        this.ui.showOptions([
            { id: 'continuar-normal', text: '💬 Continuar conversación normal' },
            { id: 'mostrar-sessionid', text: '🔑 Ver Session ID' },
            { id: 'forzar-desconexion', text: '⚠️ Forzar desconexión' }
        ], (selectedId) => {
            switch (selectedId) {
                case 'continuar-normal':
                    this.ui.clearOptions();
                    this.ui.appendMessage('💬 Continuando conversación normal...', 'system');
                    break;
                case 'mostrar-sessionid':
                    if (this.state.sessionId) {
                        this.ui.appendMessage(`🔑 Session ID: ${this.state.sessionId}`, 'system');
                    }
                    break;
                case 'forzar-desconexion':
                    this.ui.appendMessage('⚠️ Forzando desconexión...', 'system');
                    this.finalizarChatAgente();
                    break;
            }
        });
    }


    desconectarAgente() {
        console.log('🔴 Desconectando del agente');

        // IMPORTANTE: Reactivar mock TTS al desconectar
        this.services.speechManager.setAgentMode(false);

        this.estado = ESTADOS.ARBOL;

        if (this.agentSocket) {
            try {
                // Usar el método correcto del hub
                this.agentSocket.invoke('DisconnectUser', this.state.sessionId);
                this.agentSocket.stop();
            } catch (err) {
                console.warn('Error al desconectar socket:', err);
            }
            this.agentSocket = null;
        }

        this.ui.clearOptions();
        this.ui.appendMessage('🔌 Desconectado del agente humano.', 'system');
    }

    validarGuid(guid) {
        if (!guid || typeof guid !== 'string') return false;
        const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return guidRegex.test(guid);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // MÉTODOS DE UTILIDAD PARA SESSION ID
    // ───────────────────────────────────────────────────────────────────────────

    // NUEVO: Método para guardar sessionId en localStorage
    guardarSessionId() {
        if (this.state.sessionId) {
            try {
                localStorage.setItem('chatbot_sessionId', this.state.sessionId);
                console.log('📁 SessionId guardado:', this.state.sessionId);
            } catch (err) {
                console.warn('No se pudo guardar sessionId:', err);
            }
        }
    }

    // NUEVO: Método para cargar sessionId desde localStorage
    cargarSessionId() {
        try {
            const sessionId = localStorage.getItem('chatbot_sessionId');
            if (sessionId && this.validarGuid(sessionId)) {
                this.state.sessionId = sessionId;
                console.log('📁 SessionId cargado:', sessionId);
                return sessionId;
            }
        } catch (err) {
            console.warn('No se pudo cargar sessionId:', err);
        }
        return null;
    }

    async procesarMensajeUsuario() {
        const input = this.ui.inputEl.value.trim();
        if (!input) return;

        this.ui.appendMessage(input, 'user');
        this.ui.inputEl.value = '';

        console.log('🔍 Estado actual:', this.estado, 'Input:', input);

        if (this.estado !== ESTADOS.AGENTE) {
            this.ui.clearOptions();
        }

        this.historialConversacion.push({
            rol: 'usuario',
            mensaje: input,
            timestamp: new Date()
        });

        // MODIFICADO: Solo árbol y agente
        switch (this.estado) {
            case ESTADOS.ARBOL:
                console.log('➡️ Procesando en árbol');
                await this.procesarEnArbol(input);
                break;
            case ESTADOS.AGENTE:
                console.log('➡️ Procesando con agente');
                await this.procesarConAgente(input);
                break;
            default:
                console.warn('⚠️ Estado desconocido:', this.estado);
                this.volverAlInicio();
        }
    }

}

// ═══════════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════════


function limpiarTodoElEstado() {
    // Limpiar localStorage
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
        if (key.startsWith('chatbot_')) {
            localStorage.removeItem(key);
        }
    });

    // Limpiar sessionStorage
    sessionStorage.clear();

    console.log('🧹 Estado completamente limpiado');
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🔍 Verificando localStorage:');
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('chatbot_')) {
            const value = localStorage.getItem(key);
            console.log(`- ${key}:`, value);
        }
    }

    const chatbot = new ChatBotHibrido();
    const inicializado = await chatbot.init();

    if (!inicializado) {
        console.error('Error crítico inicializando el chatbot');
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GESTOR DE ESTADOS MEJORADO
// ═══════════════════════════════════════════════════════════════════════════════

class StateManager {
    constructor(chatbot) {
        this.chatbot = chatbot;
        this.currentState = ESTADOS.ARBOL;
        this.previousState = null;
        this.stateHistory = [];
        this.sessionId = null;
        this.userData = null;
        this.transitionInProgress = false;
    }

    setState(newState, data = {}) {
        if (this.transitionInProgress) {
            console.warn('⚠️ Transición de estado en progreso, ignorando cambio');
            return false;
        }

        const oldState = this.currentState;
        this.previousState = oldState;
        this.currentState = newState;

        this.stateHistory.push({
            from: oldState,
            to: newState,
            timestamp: new Date(),
            data: data
        });

        console.log(`🔄 Estado: ${oldState} → ${newState}`, data);
        this.handleStateTransition(oldState, newState, data);

        return true;
    }

    async handleStateTransition(from, to, data) {
        this.transitionInProgress = true;

        try {
            // Lógica de salida del estado anterior
            await this.exitState(from);

            // Lógica de entrada al nuevo estado
            await this.enterState(to, data);

            // Actualizar UI según el estado
            this.updateUI();

        } catch (error) {
            console.error('❌ Error en transición de estado:', error);
            this.chatbot.ui.appendMessage('⚠️ Error interno. Reiniciando...', 'system');
            this.setState(ESTADOS.ARBOL);
        } finally {
            this.transitionInProgress = false;
        }
    }

    async exitState(state) {
        switch (state) {
            case ESTADOS.AGENTE:
                if (this.chatbot.signalRManager) {
                    await this.chatbot.signalRManager.disconnect();
                }
                break;
        }
    }

    async enterState(state, data) {
        switch (state) {
            case ESTADOS.ARBOL:
                this.chatbot.ui.clearOptions();
                this.chatbot.arbolDecision.mostrarNodoInicial();
                break;
            case ESTADOS.AGENTE:
                this.chatbot.ui.appendMessage('👨‍💼 Conectando con agente...', 'system');
                break;

            case ESTADOS.CONECTANDO:
                this.chatbot.ui.showLoading('Estableciendo conexión...');
                break;

            case ESTADOS.ERROR:
                this.chatbot.ui.hideLoading();
                this.chatbot.ui.appendMessage(`❌ ${data.message || 'Error desconocido'}`, 'system');
                break;
        }
    }

    updateUI() {
        const inputSection = document.querySelector('.input-section');
        if (inputSection) {
            switch (this.currentState) {
                case ESTADOS.ARBOL:
                    inputSection.style.display = 'none';
                    break;
                case ESTADOS.AGENTE:
                    inputSection.style.display = 'block';
                    break;
                case ESTADOS.CONECTANDO:
                    inputSection.style.display = 'none';
                    break;
            }
        }
    }

    getState() {
        return this.currentState;
    }

    canTransitionTo(newState) {
        const validTransitions = {
            [ESTADOS.ARBOL]: [ESTADOS.AGENTE, ESTADOS.CONECTANDO],
            [ESTADOS.AGENTE]: [ESTADOS.ARBOL, ESTADOS.DESCONECTANDO],
            [ESTADOS.CONECTANDO]: [ESTADOS.AGENTE, ESTADOS.ERROR, ESTADOS.ARBOL],
            [ESTADOS.DESCONECTANDO]: [ESTADOS.ARBOL],
            [ESTADOS.ERROR]: [ESTADOS.ARBOL]
        };

        return validTransitions[this.currentState]?.includes(newState) || false;
    }

    saveState() {
        const stateData = {
            currentState: this.currentState,
            sessionId: this.sessionId,
            userData: this.userData,
            timestamp: new Date().toISOString()
        };

        localStorage.setItem('chatbot_state', JSON.stringify(stateData));
    }

    loadState() {
        try {
            const saved = localStorage.getItem('chatbot_state');
            if (saved) {
                const stateData = JSON.parse(saved);
                this.sessionId = stateData.sessionId;
                this.userData = stateData.userData;

                // Solo restaurar ciertos estados
                if ([ESTADOS.ARBOL].includes(stateData.currentState)) {
                    this.currentState = stateData.currentState;
                }
            }
        } catch (error) {
            console.warn('⚠️ Error cargando estado:', error);
        }
    }

    clearState() {
        this.sessionId = null;
        this.userData = null;
        this.stateHistory = [];
        localStorage.removeItem('chatbot_state');
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDADOR DE FORMULARIOS MEJORADO
// ═══════════════════════════════════════════════════════════════════════════════

class FormValidator {
    static validateName(name) {
        const errors = [];

        if (!name || name.trim().length === 0) {
            errors.push('El nombre es obligatorio');
        } else if (name.trim().length < 2) {
            errors.push('El nombre debe tener al menos 2 caracteres');
        } else if (name.trim().length > 50) {
            errors.push('El nombre no puede exceder 50 caracteres');
        } else if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(name.trim())) {
            errors.push('El nombre solo puede contener letras y espacios');
        }

        return {
            isValid: errors.length === 0,
            errors: errors,
            value: name.trim()
        };
    }

    static validateEmail(email) {
        const errors = [];
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!email || email.trim().length === 0) {
            errors.push('El email es obligatorio');
        } else if (!emailRegex.test(email.trim())) {
            errors.push('El formato del email no es válido');
        } else if (email.trim().length > 100) {
            errors.push('El email no puede exceder 100 caracteres');
        }

        return {
            isValid: errors.length === 0,
            errors: errors,
            value: email.trim().toLowerCase()
        };
    }

    static validateForm(formData) {
        const nameValidation = this.validateName(formData.name);
        const emailValidation = this.validateEmail(formData.email);

        return {
            isValid: nameValidation.isValid && emailValidation.isValid,
            errors: {
                name: nameValidation.errors,
                email: emailValidation.errors
            },
            values: {
                name: nameValidation.value,
                email: emailValidation.value
            }
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GESTOR DE NOTIFICACIONES Y FEEDBACK
// ═══════════════════════════════════════════════════════════════════════════════

class NotificationManager {
    constructor() {
        this.notifications = [];
        this.container = null;
        this.init();
    }

    init() {
        // Crear contenedor de notificaciones si no existe
        this.container = document.querySelector('.notifications-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'notifications-container';
            this.container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                pointer-events: none;
            `;
            document.body.appendChild(this.container);
        }
    }

    show(message, type = 'info', duration = 5000) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            background: ${this.getBackgroundColor(type)};
            color: white;
            padding: 12px 16px;
            margin-bottom: 8px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            transform: translateX(100%);
            transition: transform 0.3s ease;
            pointer-events: auto;
            cursor: pointer;
        `;

        notification.textContent = message;
        this.container.appendChild(notification);

        // Animar entrada
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 10);

        // Auto remover
        const removeNotification = () => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        };

        notification.addEventListener('click', removeNotification);

        if (duration > 0) {
            setTimeout(removeNotification, duration);
        }

        return notification;
    }

    getBackgroundColor(type) {
        const colors = {
            success: '#22c55e',
            error: '#ef4444',
            warning: '#f59e0b',
            info: '#3b82f6'
        };
        return colors[type] || colors.info;
    }

    success(message, duration) {
        return this.show(message, 'success', duration);
    }

    error(message, duration) {
        return this.show(message, 'error', duration);
    }

    warning(message, duration) {
        return this.show(message, 'warning', duration);
    }

    info(message, duration) {
        return this.show(message, 'info', duration);
    }
}
