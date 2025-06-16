/**
 * Manages the SignalR connection with the live agent backend.
 */
export class SignalRManager {
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

