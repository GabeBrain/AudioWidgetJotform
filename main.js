// --- CONFIGURAÇÃO DO SUPABASE ---
        // const SUPABASE_URL = 'https://mcsiygkjmwhyvaqroddi.supabase.co';
        // const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jc2l5Z2tqbXdoeXZhcXJvZGRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxODMyNDUsImV4cCI6MjA3MTc1OTI0NX0.GDCe18wOgb9Sz0UDrINUXDKE3wEcOJuTlyRIlaU2pGs';
    
function onJotformReady() {
    JFCustomWidget.subscribe("ready", function(){
        
        // --- ELEMENTOS DA INTERFACE ---
        const permissionStep = document.getElementById('permission-step');
        const recordingStep = document.getElementById('recording-step');
        const checkPermissionButton = document.getElementById('checkPermissionButton');
        const startButton = document.getElementById('startButton');
        const stopButton = document.getElementById('stopButton');
        const statusContainer = document.getElementById('status-container');
        const statusText = document.getElementById('status-text');

        
        // --- CONFIGURAÇÃO DO SUPABASE ---
        const SUPABASE_URL = 'https://mcsiygkjmwhyvaqroddi.supabase.co';
        const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jc2l5Z2tqbXdoeXZhcXJvZGRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxODMyNDUsImV4cCI6MjA3MTc1OTI0NX0.GDCe18wOgb9Sz0UDrINUXDKE3wEcOJuTlyRIlaU2pGs';
    
        const { createClient } = supabase;
        const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        let mediaRecorder;
        let audioChunks = [];

        // --- FUNÇÃO PARA ATUALIZAR A INTERFACE ---
        function updateUI(message, stateClass) {
            statusText.textContent = message;
            statusContainer.className = `status-${stateClass}`;
        }

        // --- LÓGICA PRINCIPAL ---

        // PASSO 1: O usuário clica para checar a permissão
        checkPermissionButton.addEventListener('click', async () => {
            updateUI('Verificando permissões...', 'info');
            try {
                const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
                
                if (permissionStatus.state === 'granted') {
                    updateUI('Permissão já concedida. Pronto para gravar.', 'success');
                    permissionStep.classList.add('hidden');
                    recordingStep.classList.remove('hidden');
                } else if (permissionStatus.state === 'prompt') {
                    updateUI("Permissão necessária. Clique em 'Iniciar Gravação' para solicitar.", 'info');
                    permissionStep.classList.add('hidden');
                    recordingStep.classList.remove('hidden');
                } else if (permissionStatus.state === 'denied') {
                    updateUI('Permissão negada. Habilite o microfone nas configurações do site para continuar.', 'error');
                    checkPermissionButton.disabled = true;
                }
            } catch (err) {
                console.error("Erro ao verificar permissão:", err);
                updateUI(`Erro ao checar permissão: ${err.message}`, 'error');
            }
        });

        // PASSO 2: O usuário clica para iniciar a gravação (que também pede permissão se necessário)
        startButton.addEventListener('click', async () => {
            updateUI('Solicitando permissão...', 'info');
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                
                mediaRecorder.ondataavailable = event => audioChunks.push(event.data);

                mediaRecorder.onstop = async () => {
                    updateUI('Processando e fazendo upload...', 'info');
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const fileName = `gravacao-${Date.now()}.webm`;

                    const { data, error } = await supabaseClient.storage.from('audio-auditoria').upload(fileName, audioBlob);
                    if (error) throw error;

                    const { data: { publicUrl } } = supabaseClient.storage.from('audio-auditoria').getPublicUrl(fileName);
                    updateUI('Upload Concluído!', 'success');
                    JFCustomWidget.sendSubmit({ valid: true, value: publicUrl });
                    startButton.disabled = false;
                    stopButton.disabled = true;
                };

                audioChunks = [];
                mediaRecorder.start();
                updateUI('Gravando... 🔴', 'info');
                startButton.disabled = true;
                stopButton.disabled = false;
            } catch (err) {
                console.error("ERRO AO INICIAR GRAVAÇÃO:", err);
                updateUI(`Erro: ${err.name}. Verifique as permissões.`, 'error');
                // Se a permissão foi negada no pop-up, atualiza a UI permanentemente
                if (err.name === 'NotAllowedError') {
                    startButton.disabled = true;
                }
            }
        });

        stopButton.addEventListener('click', () => {
            if (mediaRecorder) mediaRecorder.stop();
        });
    });
}
